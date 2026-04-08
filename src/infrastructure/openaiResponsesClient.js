const { AsyncLocalStorage } = require("node:async_hooks")

const openAiRequestContext = new AsyncLocalStorage()

class OpenAIResponseError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "OpenAIResponseError";
    this.status = options.status ?? 502;
    this.retryable = Boolean(options.retryable);
    this.upstreamStatus = options.upstreamStatus ?? this.status;
    this.upstreamCode = options.upstreamCode || "";
    this.upstreamType = options.upstreamType || "";
    this.upstreamMessage = options.upstreamMessage || "";
  }
}

function summarizeUpstreamPayload(payload) {
  const upstreamError = payload?.error;

  if (!upstreamError || typeof upstreamError !== "object") {
    return {
      message: "",
      code: "",
      type: "",
    };
  }

  return {
    message: String(upstreamError.message || "").trim(),
    code: String(upstreamError.code || "").trim(),
    type: String(upstreamError.type || "").trim(),
  };
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    function cleanup() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", handleAbort);
    }

    function handleAbort() {
      cleanup();
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    }

    if (signal?.aborted) {
      handleAbort();
      return;
    }

    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

function withOpenAIRequestContext(context, callback) {
  return openAiRequestContext.run(context || {}, callback)
}

function getCurrentAbortSignal() {
  return openAiRequestContext.getStore()?.signal
}

function createCompositeAbortSignal(signals) {
  const controller = new AbortController()
  const cleanups = []

  function abortFrom(signal) {
    if (!controller.signal.aborted) {
      controller.abort(signal?.reason)
    }

    for (const cleanup of cleanups) {
      cleanup()
    }
  }

  for (const signal of signals.filter(Boolean)) {
    if (signal.aborted) {
      abortFrom(signal)
      break
    }

    const onAbort = () => abortFrom(signal)
    signal.addEventListener("abort", onAbort, { once: true })
    cleanups.push(() => signal.removeEventListener("abort", onAbort))
  }

  return {
    signal: controller.signal,
    cleanup() {
      for (const cleanup of cleanups) {
        cleanup()
      }
    },
  }
}

function buildResponseSchema(replyCount) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      replies: {
        type: "array",
        minItems: replyCount,
        maxItems: replyCount,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            text: {
              type: "string",
            },
          },
          required: ["text"],
        },
      },
    },
    required: ["replies"],
  };
}

function createTextInput(systemPrompt, userPrompt) {
  return [
    {
      role: "system",
      content: [{ type: "input_text", text: systemPrompt }],
    },
    {
      role: "user",
      content: [{ type: "input_text", text: userPrompt }],
    },
  ];
}

function createMultimodalInput(systemPrompt, userText, imageUrl) {
  return [
    {
      role: "system",
      content: [{ type: "input_text", text: systemPrompt }],
    },
    {
      role: "user",
      content: [
        { type: "input_text", text: userText },
        { type: "input_image", image_url: imageUrl },
      ],
    },
  ];
}

function createOpenAIResponsesClient({
  apiKey,
  baseUrl,
  timeoutMs = 20000,
  retryCount = 2,
  fetchImpl = globalThis.fetch,
  logger,
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required.");
  }

  const isConfigured = Boolean(String(apiKey || "").trim());

  async function requestStructuredResponse({
    model,
    input,
    replyCount,
    responseSchema,
    responseSchemaName = "reddit_replies",
    maxOutputTokens = 1800,
    requestId,
  }) {
    const attempts = retryCount + 1;
    const requestAbortSignal = getCurrentAbortSignal()
    const requestTimeoutController = new AbortController();
    const requestTimeout = setTimeout(
      () => requestTimeoutController.abort(new Error("Request timed out")),
      timeoutMs,
    );
    const {
      signal: executionAbortSignal,
      cleanup: cleanupExecutionAbortSignal,
    } = createCompositeAbortSignal([
      requestTimeoutController.signal,
      requestAbortSignal,
    ])

    try {
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const startedAt = Date.now();

        try {
          const response = await fetchImpl(`${baseUrl}/responses`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            signal: executionAbortSignal,
            body: JSON.stringify({
              model,
              input,
              max_output_tokens: maxOutputTokens,
              text: {
                format: {
                  type: "json_schema",
                  name: responseSchemaName,
                  schema: responseSchema || buildResponseSchema(replyCount),
                },
              },
            }),
          });
          let payload = null;
          try {
            payload = await response.json();
          } catch (_error) {
            payload = null;
          }
          const durationMs = Date.now() - startedAt;

          if (!response.ok) {
            const retryable = response.status === 429 || response.status >= 500;
            const upstreamSummary = summarizeUpstreamPayload(payload);

            logger?.warn("OpenAI response request failed", {
              requestId,
              attempt,
              status: response.status,
              retryable,
              duration_ms: durationMs,
              upstream_code: upstreamSummary.code,
              upstream_type: upstreamSummary.type,
              upstream_message: upstreamSummary.message,
            });

            if (retryable && attempt < attempts) {
              const retryAfterHeader = Number.parseFloat(response.headers.get("retry-after") || "");
              const retryDelayMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
                ? retryAfterHeader * 1000
                : attempt * 300;
              await delay(retryDelayMs, executionAbortSignal);
              continue;
            }

            throw new OpenAIResponseError("OpenAI request failed.", {
              status: response.status,
              retryable,
              upstreamStatus: response.status,
              upstreamCode: upstreamSummary.code,
              upstreamType: upstreamSummary.type,
              upstreamMessage: upstreamSummary.message,
            });
          }

          if (!payload || typeof payload !== "object") {
            throw new OpenAIResponseError("OpenAI returned an invalid response payload.", {
              status: 502,
              retryable: false,
            });
          }

          logger?.info("OpenAI response request succeeded", {
            requestId,
            attempt,
            duration_ms: durationMs,
            status: response.status,
          });
          return payload;
        } catch (error) {
          const durationMs = Date.now() - startedAt;
          const isAbortError = error?.name === "AbortError";
          const isOpenAiError = error instanceof OpenAIResponseError;
          const isClientAbort = isAbortError && requestAbortSignal?.aborted;
          const isTimedOut = isAbortError && requestTimeoutController.signal.aborted && !isClientAbort;
          const retryable = !isClientAbort && !isTimedOut && (isAbortError || !isOpenAiError || error.retryable);

          logger?.warn("OpenAI response request error", {
            requestId,
            attempt,
            duration_ms: durationMs,
            retryable,
            error_code: error?.name || "Error",
            message: error?.message || "Unexpected error",
          });

          if (retryable && attempt < attempts) {
            await delay(attempt * 300, executionAbortSignal);
            continue;
          }

          if (isClientAbort) {
            throw new OpenAIResponseError("Request cancelled by client.", {
              status: 499,
              retryable: false,
            });
          }

          if (isAbortError) {
            throw new OpenAIResponseError("OpenAI request timed out.", {
              status: 504,
              retryable: false,
            });
          }

          if (isOpenAiError) {
            throw error;
          }

          throw new OpenAIResponseError(error?.message || "Unexpected server error.", {
            status: 502,
            retryable: false,
          });
        }
      }

      throw new OpenAIResponseError("OpenAI request failed after retries.", {
        status: 502,
        retryable: false,
      });
    } finally {
      clearTimeout(requestTimeout);
      cleanupExecutionAbortSignal();
    }
  }

  async function createStructuredResponse({
    model,
    systemPrompt,
    userPrompt,
    replyCount,
    responseSchema,
    responseSchemaName = "reddit_replies",
    maxOutputTokens = 1800,
    requestId,
  }) {
    return requestStructuredResponse({
      model,
      input: createTextInput(systemPrompt, userPrompt),
      replyCount,
      responseSchema,
      responseSchemaName,
      maxOutputTokens,
      requestId,
    });
  }

  async function createStructuredMultimodalResponse({
    model,
    systemPrompt,
    userText,
    imageUrl,
    replyCount,
    responseSchema,
    responseSchemaName = "reddit_multimodal_response",
    maxOutputTokens = 600,
    requestId,
  }) {
    return requestStructuredResponse({
      model,
      input: createMultimodalInput(systemPrompt, userText, imageUrl),
      replyCount,
      responseSchema,
      responseSchemaName,
      maxOutputTokens,
      requestId,
    });
  }

  return {
    createStructuredResponse,
    createStructuredMultimodalResponse,
    isConfigured,
  };
}

module.exports = {
  OpenAIResponseError,
  createOpenAIResponsesClient,
  withOpenAIRequestContext,
};
