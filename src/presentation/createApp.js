const crypto = require("node:crypto");
const express = require("express");
const { buildLoginPage } = require("./loginPage");

const {
  ConfigurationError,
  EmptyModelResponseError,
  SourceContextError,
} = require("../application/generateReplies");
const {
  OpenAIResponseError,
  withOpenAIRequestContext,
} = require("../infrastructure/openaiResponsesClient");
const { GenerationQueueError, VALID_JOB_STATUSES } = require("../infrastructure/generationQueue");
const { SavedOutputsStoreError, VALID_SAVED_STATUSES } = require("../infrastructure/savedOutputsStore");
const {
  RequestValidationError,
  VALID_CONTENT_MODES,
  validateGenerateRequest,
} = require("./validation");
const { getPersonaById } = require("../domain/personas");

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1"])
const AUTH_COOKIE_NAME = "reddit_commentator_session"
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14

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

function parseCookies(headerValue) {
  const cookieHeader = String(headerValue || "").trim()

  if (!cookieHeader) {
    return {}
  }

  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, pair) => {
      const separatorIndex = pair.indexOf("=")
      if (separatorIndex <= 0) {
        return cookies
      }

      const key = pair.slice(0, separatorIndex).trim()
      const value = pair.slice(separatorIndex + 1).trim()
      cookies[key] = decodeURIComponent(value)
      return cookies
    }, {})
}

function createSignature(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex")
}

function constantTimeEquals(left, right) {
  const leftBuffer = Buffer.from(String(left || ""))
  const rightBuffer = Buffer.from(String(right || ""))

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function hashPassword(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex")
}

function buildSessionCookieValue(username, sessionSecret) {
  const payload = Buffer.from(
    JSON.stringify({
      username,
      expiresAt: Date.now() + SESSION_TTL_MS,
    }),
  ).toString("base64url")

  return `${payload}.${createSignature(payload, sessionSecret)}`
}

function parseSessionCookieValue(cookieValue, sessionSecret) {
  const [payload, signature] = String(cookieValue || "").split(".")

  if (!payload || !signature) {
    return null
  }

  if (!constantTimeEquals(createSignature(payload, sessionSecret), signature)) {
    return null
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))

    if (!parsed?.username || !parsed?.expiresAt || parsed.expiresAt <= Date.now()) {
      return null
    }

    return {
      username: String(parsed.username),
      expiresAt: Number(parsed.expiresAt),
    }
  } catch {
    return null
  }
}

function shouldUseSecureCookie(req) {
  return req.secure || String(req.get("x-forwarded-proto") || "").toLowerCase() === "https"
}

function clearSessionCookie(res, req) {
  res.cookie(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(req),
    path: "/",
    maxAge: 0,
  })
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

  if (error instanceof SavedOutputsStoreError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
    }
  }

  if (error instanceof GenerationQueueError) {
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

    if (error.upstreamStatus === 401) {
      return {
        status: 502,
        code: "openai_invalid_api_key",
        message: "OpenAI rejected the API key configured on the server.",
      }
    }

    if (error.upstreamStatus === 403) {
      return {
        status: 502,
        code: "openai_access_denied",
        message: "The configured OpenAI project does not have access to this model or request.",
      }
    }

    if (error.upstreamStatus === 404) {
      return {
        status: 502,
        code: "openai_model_not_found",
        message: "The configured OpenAI model or endpoint was not found.",
      }
    }

    if (error.upstreamStatus === 429) {
      return {
        status: 502,
        code: "openai_rate_limited",
        message: "OpenAI rate limited the request or the project is out of quota.",
      }
    }

    return {
      status: 502,
      code: "upstream_error",
      message: error.upstreamMessage || "The upstream service could not complete the request.",
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
  generationQueue = null,
  logger,
  model,
  publicDir,
  requestBodyLimit = "1mb",
  accessToken = "",
  allowRemoteAccess = false,
  authUsername = "",
  authPasswordHash = "",
  authSessionSecret = "",
  savedOutputsStore = null,
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
  const authEnabled = Boolean(String(authUsername || "").trim() && String(authPasswordHash || "").trim())

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

  function getAuthenticatedSession(req) {
    if (!authEnabled) {
      return { username: String(authUsername || "").trim() || "Admin" }
    }

    const cookies = parseCookies(req.headers.cookie)
    const parsedSession = parseSessionCookieValue(cookies[AUTH_COOKIE_NAME], authSessionSecret)

    if (!parsedSession) {
      return null
    }

    if (parsedSession.username !== authUsername) {
      return null
    }

    return parsedSession
  }

  function assertAllowedRequest(req) {
    if (getAuthenticatedSession(req)) {
      return
    }

    const presentedAccessToken = readPresentedAccessToken(req)

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
  }

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

  app.get("/login", (req, res) => {
    if (getAuthenticatedSession(req)) {
      return res.redirect("/")
    }

    res.type("html").send(buildLoginPage())
  })

  app.post("/api/auth/login", (req, res) => {
    const username = String(req.body?.username || "").trim()
    const password = String(req.body?.password || "")

    if (!username || !password) {
      return res.status(400).json({
        error: "Enter both login and password.",
        code: "missing_credentials",
        requestId: req.requestId,
      })
    }

    const usernameMatches = constantTimeEquals(username, authUsername)
    const passwordMatches = constantTimeEquals(hashPassword(password), authPasswordHash)

    if (!usernameMatches || !passwordMatches) {
      return res.status(401).json({
        error: "Invalid login or password.",
        code: "invalid_credentials",
        requestId: req.requestId,
      })
    }

    res.cookie(AUTH_COOKIE_NAME, buildSessionCookieValue(authUsername, authSessionSecret), {
      httpOnly: true,
      sameSite: "lax",
      secure: shouldUseSecureCookie(req),
      path: "/",
      maxAge: SESSION_TTL_MS,
    })

    return res.json({
      ok: true,
      username: authUsername,
    })
  })

  app.post("/api/auth/logout", (req, res) => {
    clearSessionCookie(res, req)
    return res.json({ ok: true })
  })

  app.get("/api/auth/session", (req, res) => {
    const session = getAuthenticatedSession(req)

    if (!session) {
      return res.status(401).json({
        ok: false,
        code: "auth_required",
        requestId: req.requestId,
      })
    }

    return res.json({
      ok: true,
      username: session.username,
    })
  })

  app.use((req, res, next) => {
    const openPaths = new Set([
      "/health",
      "/ready",
      "/login",
      "/api/auth/login",
    ])

    if (!authEnabled || openPaths.has(req.path)) {
      return next()
    }

    if (getAuthenticatedSession(req)) {
      return next()
    }

    if (req.path === "/api/auth/logout" || req.path === "/api/auth/session" || req.path.startsWith("/api/")) {
      return res.status(401).json({
        error: "Authentication required.",
        code: "auth_required",
        requestId: req.requestId,
      })
    }

    return res.redirect("/login")
  })

  app.use(express.static(publicDir));

  app.get("/api/saved", async (req, res) => {
    try {
      assertAllowedRequest(req)

      if (!savedOutputsStore) {
        throw new SavedOutputsStoreError("Saved outputs storage is not configured.", {
          status: 503,
          code: "saved_outputs_unavailable",
        })
      }

      const personaId = String(req.query.personaId || "").trim();
      const status = String(req.query.status || "all").trim().toLowerCase() || "all";
      const contentModeFilter = String(req.query.contentMode || "").trim().toLowerCase();
      const contentModes = contentModeFilter
        ? contentModeFilter
            .split(",")
            .map((value) => String(value || "").trim().toLowerCase())
            .filter(Boolean)
        : [];

      if (personaId && personaId !== "all" && !getPersonaById(personaId)) {
        throw new RequestValidationError("personaId filter is invalid.");
      }

      if (status !== "all" && !VALID_SAVED_STATUSES.has(status)) {
        throw new RequestValidationError("status filter is invalid.");
      }

      if (contentModes.some((mode) => !VALID_CONTENT_MODES.has(mode))) {
        throw new RequestValidationError("contentMode filter is invalid.");
      }

      const items = await savedOutputsStore.listItems({
        personaId: personaId === "all" ? "" : personaId,
        status,
        contentMode: contentModes,
      });

      return res.json({ items });
    } catch (error) {
      const publicError = getPublicErrorDetails(error)

      logger?.error("Saved list request failed", {
        requestId: req.requestId,
        status: publicError.status,
        error_code: error?.name || "Error",
        public_error_code: publicError.code,
        message: error?.message || "Unexpected server error.",
      });

      return res.status(publicError.status).json({
        error: publicError.message,
        code: publicError.code,
        requestId: req.requestId,
      });
    }
  })

  app.get("/api/queue", async (req, res) => {
    try {
      assertAllowedRequest(req)

      if (!generationQueue) {
        throw new GenerationQueueError("Generation queue is not configured.", {
          status: 503,
          code: "generation_queue_unavailable",
        })
      }

      const status = String(req.query.status || "all").trim().toLowerCase() || "all";
      const limit = Number.parseInt(String(req.query.limit || "30"), 10);

      if (status !== "all" && !VALID_JOB_STATUSES.has(status)) {
        throw new RequestValidationError("queue status filter is invalid.");
      }

      const jobs = await generationQueue.listJobs({
        status,
        limit,
      });

      return res.json({ jobs });
    } catch (error) {
      const publicError = getPublicErrorDetails(error)

      logger?.error("Queue list request failed", {
        requestId: req.requestId,
        status: publicError.status,
        error_code: error?.name || "Error",
        public_error_code: publicError.code,
        message: error?.message || "Unexpected server error.",
      });

      return res.status(publicError.status).json({
        error: publicError.message,
        code: publicError.code,
        requestId: req.requestId,
      });
    }
  })

  app.post("/api/generate-async", async (req, res) => {
    try {
      assertAllowedRequest(req)

      if (!generationQueue) {
        throw new GenerationQueueError("Generation queue is not configured.", {
          status: 503,
          code: "generation_queue_unavailable",
        })
      }

      if (!rateLimiter.consume(normalizeRemoteAddress(req.socket?.remoteAddress) || "unknown")) {
        throw new HttpRequestError("Too many generation attempts. Please wait a moment.", {
          status: 429,
          code: "rate_limited",
        })
      }

      const payload = validateGenerateRequest(req.body, {
        maxPostTextChars,
      });
      const persona = payload.generateAllPersonas ? null : getPersonaById(payload.personaId);
      const job = await generationQueue.enqueue(payload, persona);

      return res.status(202).json({
        ok: true,
        job,
      });
    } catch (error) {
      const publicError = getPublicErrorDetails(error)

      logger?.error("Async generate request failed", {
        requestId: req.requestId,
        status: publicError.status,
        error_code: error?.name || "Error",
        public_error_code: publicError.code,
        message: error?.message || "Unexpected server error.",
      });

      return res.status(publicError.status).json({
        error: publicError.message,
        code: publicError.code,
        requestId: req.requestId,
      });
    }
  })

  app.patch("/api/saved/:id/status", async (req, res) => {
    try {
      assertAllowedRequest(req)

      if (!savedOutputsStore) {
        throw new SavedOutputsStoreError("Saved outputs storage is not configured.", {
          status: 503,
          code: "saved_outputs_unavailable",
        })
      }

      const nextStatus = String(req.body?.status || "").trim().toLowerCase();

      if (!VALID_SAVED_STATUSES.has(nextStatus)) {
        throw new RequestValidationError("Saved status must be new or published.");
      }

      const item = await savedOutputsStore.updateStatus(req.params.id, nextStatus);
      return res.json({ item });
    } catch (error) {
      const publicError = getPublicErrorDetails(error)

      logger?.error("Saved status update failed", {
        requestId: req.requestId,
        status: publicError.status,
        error_code: error?.name || "Error",
        public_error_code: publicError.code,
        message: error?.message || "Unexpected server error.",
      });

      return res.status(publicError.status).json({
        error: publicError.message,
        code: publicError.code,
        requestId: req.requestId,
      });
    }
  })

  app.post("/api/generate", async (req, res) => {
    const requestId = req.requestId
    const remoteAddress = normalizeRemoteAddress(req.socket?.remoteAddress)
    const admissionKey = remoteAddress || "unknown"
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
      assertAllowedRequest(req)

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

      let savedItems = [];
      let savedItemsError = false;

      if (savedOutputsStore) {
        try {
          savedItems = await savedOutputsStore.saveGeneration({
            ...payload,
            replies: result.replies,
            generationMode: result.generationMode,
            sourceContext: result.sourceContext,
            persona: result.persona || null,
          });
        } catch (error) {
          savedItemsError = true;
          logger?.warn("Failed to persist generated outputs", {
            requestId,
            message: error?.message || "Unknown error",
          });
        }
      }

      return res.json({
        ...result,
        savedItemsCount: savedItems.length,
        savedItemsError,
      });
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
