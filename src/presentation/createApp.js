const crypto = require("node:crypto");
const express = require("express");

const {
  ConfigurationError,
  EmptyModelResponseError,
  SourceContextError,
} = require("../application/generateReplies");
const {
  OpenAIResponseError,
  withOpenAIRequestContext,
} = require("../infrastructure/openaiResponsesClient");
const { RequestValidationError, validateGenerateRequest } = require("./validation");

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1"])

class HttpRequestError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = "HttpRequestError"
    this.status = options.status ?? 400
    this.code = options.code || "bad_request"
  }
}

function normalizeRemoteAddress(value) {
  const address = String(value || "").split("%")[0]

  if (address.startsWith("::ffff:")) {
    return address.slice("::ffff:".length)
  }

  return address
}

function isLoopbackRequest(req) {
  return LOOPBACK_ADDRESSES.has(normalizeRemoteAddress(req.socket?.remoteAddress))
}

function readPresentedAccessToken(req) {
  const bearerToken = req.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]
  return String(req.get("x-app-access-token") || bearerToken || "").trim()
}

function createRateLimiter({ windowMs, maxRequests }) {
  const buckets = new Map()

  return {
    consume(key) {
      const now = Date.now()
      const activeTimestamps = (buckets.get(key) || []).filter(
        (timestamp) => now - timestamp < windowMs,
      )

      if (activeTimestamps.length >= maxRequests) {
        buckets.set(key, activeTimestamps)
        return false
      }

      activeTimestamps.push(now)
      buckets.set(key, activeTimestamps)
      return true
    },
  }
}

function getPublicErrorDetails(error) {
  if (error instanceof RequestValidationError) {
    return {
      status: error.status,
      code: "invalid_request",
      message: error.message,
    }
  }

  if (error instanceof HttpRequestError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
    }
  }

  if (error instanceof EmptyModelResponseError) {
    return {
      status: 502,
      code: "empty_model_response",
      message: "The model did not return a usable response. Please try again.",
    }
  }

  if (error instanceof ConfigurationError) {
    return {
      status: 503,
      code: "service_not_ready",
      message: "The server is not ready yet.",
    }
  }

  if (error instanceof SourceContextError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
    }
  }

  if (error instanceof OpenAIResponseError) {
    if (error.status === 499) {
      return {
        status: 499,
        code: "client_closed_request",
        message: "The request was cancelled before completion.",
      }
    }

    if (error.status === 504) {
      return {
        status: 504,
        code: "upstream_timeout",
        message: "The upstream request timed out. Please try again.",
      }
    }

    return {
      status: 502,
      code: "upstream_error",
      message: "The upstream service could not complete the request.",
    }
  }

  return {
    status: 500,
    code: "internal_error",
    message: "Unexpected server error.",
  }
}

function createApp({
  generationService,
  logger,
  model,
  publicDir,
  requestBodyLimit = "1mb",
  accessToken = "",
  allowRemoteAccess = false,
  maxPostTextChars = 12000,
  maxConcurrentGenerations = 2,
  rateLimitWindowMs = 60000,
  rateLimitMaxRequests = 12,
  openAiConfigured = false,
  isLoopbackRequestFn = isLoopbackRequest,
}) {
  const app = express();
  const rateLimiter = createRateLimiter({
    windowMs: rateLimitWindowMs,
    maxRequests: rateLimitMaxRequests,
  })
  let activeGenerationCount = 0

  app.disable("x-powered-by")
  app.use((req, res, next) => {
    const requestId = req.get("x-request-id") || crypto.randomUUID()
    req.requestId = requestId
    res.setHeader("x-request-id", requestId)
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader("Referrer-Policy", "no-referrer")
    res.setHeader("X-Frame-Options", "DENY")
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    )
    next()
  })
  app.use(express.json({ limit: requestBodyLimit }));
  app.use(express.static(publicDir));

  app.get("/health", (_req, res) => {
    const ready = Boolean(openAiConfigured && model && generationService?.generateComments)
    res.json({
      ok: true,
      service: "reddit-commentator",
      model,
      ready,
      localOnly: !allowRemoteAccess && !accessToken,
      remoteAccessEnabled: allowRemoteAccess,
    });
  });

  app.get("/ready", (_req, res) => {
    const ready = Boolean(openAiConfigured && model && generationService?.generateComments)

    return res.status(ready ? 200 : 503).json({
      ok: ready,
      service: "reddit-commentator",
      model,
      localOnly: !allowRemoteAccess && !accessToken,
      remoteAccessEnabled: allowRemoteAccess,
    })
  })

  app.post("/api/generate", async (req, res) => {
    const requestId = req.requestId
    const remoteAddress = normalizeRemoteAddress(req.socket?.remoteAddress)
    const admissionKey = remoteAddress || "unknown"
    const presentedAccessToken = readPresentedAccessToken(req)
    const disconnectController = new AbortController()
    let releaseGenerationSlot = null

    const handleClientDisconnect = () => {
      if (!disconnectController.signal.aborted) {
        disconnectController.abort(new Error("Client disconnected"))
      }
    }

    const handleResponseClose = () => {
      if (!res.writableEnded) {
        handleClientDisconnect()
      }
    }

    req.once("aborted", handleClientDisconnect)
    res.once("close", handleResponseClose)

    try {
      if (!isLoopbackRequestFn(req)) {
        if (!allowRemoteAccess && !accessToken) {
          throw new HttpRequestError("This app only accepts local requests.", {
            status: 403,
            code: "local_access_only",
          })
        }

        if (!allowRemoteAccess && presentedAccessToken !== accessToken) {
          throw new HttpRequestError("Missing or invalid access token.", {
            status: 401,
            code: "invalid_access_token",
          })
        }
      }

      if (!rateLimiter.consume(admissionKey)) {
        throw new HttpRequestError("Too many generation attempts. Please wait a moment.", {
          status: 429,
          code: "rate_limited",
        })
      }

      const payload = validateGenerateRequest(req.body, {
        maxPostTextChars,
      });
      if (activeGenerationCount >= maxConcurrentGenerations) {
        throw new HttpRequestError("Generation capacity is full. Please retry shortly.", {
          status: 503,
          code: "busy",
        })
      }

      activeGenerationCount += 1
      releaseGenerationSlot = () => {
        activeGenerationCount = Math.max(0, activeGenerationCount - 1)
      }

      const result = await withOpenAIRequestContext(
        { signal: disconnectController.signal },
        () =>
          generationService.generateComments({
            ...payload,
            requestId,
          }),
      )

      if (disconnectController.signal.aborted || res.destroyed) {
        return
      }

      return res.json(result);
    } catch (error) {
      if (disconnectController.signal.aborted || req.aborted || res.destroyed) {
        logger?.warn("Generate request cancelled", {
          requestId,
          remote_address: remoteAddress,
        })
        return
      }

      const publicError = getPublicErrorDetails(error)

      logger?.error("Generate request failed", {
        requestId,
        status: publicError.status,
        error_code: error?.name || "Error",
        public_error_code: publicError.code,
        message: error?.message || "Unexpected server error.",
      });

      return res.status(publicError.status).json({
        error: publicError.message,
        code: publicError.code,
        requestId,
      });
    } finally {
      req.removeListener("aborted", handleClientDisconnect)
      res.removeListener("close", handleResponseClose)
      releaseGenerationSlot?.()
    }
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error)
    }

    const isMalformedJson = error?.type === "entity.parse.failed"
    const isBodyTooLarge = error?.type === "entity.too.large" || error?.status === 413

    if (!isMalformedJson && !isBodyTooLarge) {
      return next(error)
    }

    const requestId = req.requestId || crypto.randomUUID()
    res.setHeader("x-request-id", requestId)

    logger?.warn("Rejected invalid request body", {
      requestId,
      error_code: error?.type || error?.name || "invalid_body",
      status: isBodyTooLarge ? 413 : 400,
    })

    return res.status(isBodyTooLarge ? 413 : 400).json({
      error: isBodyTooLarge ? "Request body is too large." : "Malformed JSON body.",
      code: isBodyTooLarge ? "body_too_large" : "malformed_json",
      requestId,
    })
  })

  return app;
}

module.exports = {
  createApp,
};
