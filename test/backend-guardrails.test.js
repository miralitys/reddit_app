const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
const assert = require("node:assert/strict")

const { loadConfig } = require("../src/config")
const {
  ConfigurationError,
  createGenerationService,
} = require("../src/application/generateReplies")
const { createApp } = require("../src/presentation/createApp")
const {
  OpenAIResponseError,
  createOpenAIResponsesClient,
  withOpenAIRequestContext,
} = require("../src/infrastructure/openaiResponsesClient")

function createLoggerStub() {
  return {
    info() {},
    warn() {},
    error() {},
  }
}

function createReplyPayload() {
  return {
    model: "test-model",
    replies: [
      { label: "Short", text: "Short reply." },
      { label: "Medium", text: "Medium reply." },
      { label: "Long", text: "Long reply." },
    ],
  }
}

async function startServer(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server))
    const sockets = new Set()

    server.on("connection", (socket) => {
      sockets.add(socket)
      socket.on("close", () => sockets.delete(socket))
    })
    server.on("error", reject)
    server.__sockets = sockets
  })
}

async function closeServer(server) {
  server.closeAllConnections?.()

  for (const socket of server.__sockets || []) {
    socket.destroy()
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

test("loadConfig bootstraps .env values without overriding explicit env", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "reddit-commentator-config-"))
  const envFilePath = path.join(tempDir, ".env")

  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  await fs.writeFile(
    envFilePath,
    ["OPENAI_API_KEY=temp-key", "PORT=4321", "OPENAI_MODEL=file-model", "HOST=0.0.0.0"].join("\n"),
  )

  const config = loadConfig({
    env: {
      OPENAI_MODEL: "explicit-model",
    },
    envFilePath,
  })

  assert.equal(config.openAiApiKey, "temp-key")
  assert.equal(config.port, 4321)
  assert.equal(config.host, "0.0.0.0")
  assert.equal(config.openAiModel, "explicit-model")
})

test("health stays live while readiness reports missing OpenAI config", async (t) => {
  const app = createApp({
    generationService: {
      async generateComments() {
        return createReplyPayload()
      },
    },
    logger: createLoggerStub(),
    model: "test-model",
    openAiConfigured: false,
    publicDir: "/Users/ramisyaparov/Desktop/Project/Reddit Comentator/public",
  })

  const server = await startServer(app)
  t.after(() => closeServer(server))
  const { port } = server.address()

  const healthResponse = await fetch(`http://127.0.0.1:${port}/health`, {
    headers: {
      Connection: "close",
    },
  })
  assert.equal(healthResponse.status, 200)
  assert.equal((await healthResponse.json()).ok, true)

  const readyResponse = await fetch(`http://127.0.0.1:${port}/ready`, {
    headers: {
      Connection: "close",
    },
  })
  assert.equal(readyResponse.status, 503)
  assert.equal((await readyResponse.json()).ok, false)
})

test("POST /api/generate sanitizes upstream failures", async (t) => {
  const app = createApp({
    generationService: {
      async generateComments() {
        throw new OpenAIResponseError("billing state leaked", { status: 401 })
      },
    },
    logger: createLoggerStub(),
    model: "test-model",
    openAiConfigured: true,
    publicDir: "/Users/ramisyaparov/Desktop/Project/Reddit Comentator/public",
  })

  const server = await startServer(app)
  t.after(() => closeServer(server))
  const { port } = server.address()

  const response = await fetch(`http://127.0.0.1:${port}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Connection: "close",
    },
    body: JSON.stringify({
      postText: "Need a reply.",
      tone: "grounded",
    }),
  })

  assert.equal(response.status, 502)
  const payload = await response.json()
  assert.equal(payload.code, "upstream_error")
  assert.equal(payload.error, "The upstream service could not complete the request.")
  assert.doesNotMatch(payload.error, /billing state leaked/)
  assert.match(payload.requestId, /^[0-9a-f-]{36}$/)
})

test("POST /api/generate rejects malformed JSON consistently", async (t) => {
  const app = createApp({
    generationService: {
      async generateComments() {
        return createReplyPayload()
      },
    },
    logger: createLoggerStub(),
    model: "test-model",
    openAiConfigured: true,
    publicDir: "/Users/ramisyaparov/Desktop/Project/Reddit Comentator/public",
  })

  const server = await startServer(app)
  t.after(() => closeServer(server))
  const { port } = server.address()

  const response = await fetch(`http://127.0.0.1:${port}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Connection: "close",
    },
    body: '{"postText":"oops"',
  })

  assert.equal(response.status, 400)
  const payload = await response.json()
  assert.equal(payload.code, "malformed_json")
  assert.equal(payload.error, "Malformed JSON body.")
  assert.match(payload.requestId, /^[0-9a-f-]{36}$/)
})

test("POST /api/generate applies concurrency backpressure", async (t) => {
  let markStarted
  let releaseFirstRequest
  const generationStarted = new Promise((resolve) => {
    markStarted = resolve
  })
  const firstRequestReleased = new Promise((resolve) => {
    releaseFirstRequest = resolve
  })

  const app = createApp({
    generationService: {
      async generateComments() {
        markStarted()
        await firstRequestReleased
        return createReplyPayload()
      },
    },
    logger: createLoggerStub(),
    model: "test-model",
    openAiConfigured: true,
    maxConcurrentGenerations: 1,
    rateLimitMaxRequests: 20,
    publicDir: "/Users/ramisyaparov/Desktop/Project/Reddit Comentator/public",
  })

  const server = await startServer(app)
  t.after(() => closeServer(server))
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}/api/generate`
  const body = JSON.stringify({
    postText: "Need a reply.",
    tone: "grounded",
  })

  const firstResponsePromise = fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Connection: "close",
    },
    body,
  })

  await generationStarted

  const secondResponse = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Connection: "close",
    },
    body,
  })

  assert.equal(secondResponse.status, 503)
  const secondPayload = await secondResponse.json()
  assert.equal(secondPayload.code, "busy")

  releaseFirstRequest()

  const firstResponse = await firstResponsePromise
  assert.equal(firstResponse.status, 200)
  assert.equal((await firstResponse.json()).replies.length, 3)
})

test("POST /api/generate returns 503 when the OpenAI client is not configured", async (t) => {
  const app = createApp({
    generationService: {
      async generateComments() {
        throw new ConfigurationError("OpenAI client is not configured.")
      },
    },
    logger: createLoggerStub(),
    model: "test-model",
    openAiConfigured: false,
    publicDir: "/Users/ramisyaparov/Desktop/Project/Reddit Comentator/public",
  })

  const server = await startServer(app)
  t.after(() => closeServer(server))
  const { port } = server.address()

  const response = await fetch(`http://127.0.0.1:${port}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Connection: "close",
    },
    body: JSON.stringify({
      postText: "Need a reply.",
      tone: "grounded",
    }),
  })

  assert.equal(response.status, 503)
  const payload = await response.json()
  assert.equal(payload.code, "service_not_ready")
})

test("POST /api/generate rejects invalid input types", async (t) => {
  const app = createApp({
    generationService: {
      async generateComments() {
        return createReplyPayload()
      },
    },
    logger: createLoggerStub(),
    model: "test-model",
    openAiConfigured: true,
    publicDir: "/Users/ramisyaparov/Desktop/Project/Reddit Comentator/public",
  })

  const server = await startServer(app)
  t.after(() => closeServer(server))
  const { port } = server.address()

  const response = await fetch(`http://127.0.0.1:${port}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Connection: "close",
    },
    body: JSON.stringify({
      postText: { bad: true },
      tone: "grounded",
      promoCreditClub: "false",
    }),
  })

  assert.equal(response.status, 400)
  const payload = await response.json()
  assert.match(payload.error, /must be a string|must be a boolean/i)
})

test("POST /api/generate requires access token for non-loopback requests", async (t) => {
  const app = createApp({
    generationService: {
      async generateComments() {
        return createReplyPayload()
      },
    },
    logger: createLoggerStub(),
    model: "test-model",
    openAiConfigured: true,
    accessToken: "secret-token",
    isLoopbackRequestFn() {
      return false
    },
    publicDir: "/Users/ramisyaparov/Desktop/Project/Reddit Comentator/public",
  })

  const server = await startServer(app)
  t.after(() => closeServer(server))
  const { port } = server.address()

  const response = await fetch(`http://127.0.0.1:${port}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Connection: "close",
    },
    body: JSON.stringify({
      postText: "Need a reply.",
      tone: "grounded",
    }),
  })

  assert.equal(response.status, 401)
  const payload = await response.json()
  assert.equal(payload.code, "invalid_access_token")
})

test("POST /api/generate returns 429 when rate limit is exceeded", async (t) => {
  const app = createApp({
    generationService: {
      async generateComments() {
        return createReplyPayload()
      },
    },
    logger: createLoggerStub(),
    model: "test-model",
    openAiConfigured: true,
    rateLimitMaxRequests: 1,
    rateLimitWindowMs: 60_000,
    publicDir: "/Users/ramisyaparov/Desktop/Project/Reddit Comentator/public",
  })

  const server = await startServer(app)
  t.after(() => closeServer(server))
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}/api/generate`
  const body = JSON.stringify({
    postText: "Need a reply.",
    tone: "grounded",
  })

  const firstResponse = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Connection: "close",
    },
    body,
  })
  assert.equal(firstResponse.status, 200)

  const secondResponse = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Connection: "close",
    },
    body,
  })
  assert.equal(secondResponse.status, 429)
  const payload = await secondResponse.json()
  assert.equal(payload.code, "rate_limited")
})

test("POST /api/generate returns 413 when request body exceeds limit", async (t) => {
  const app = createApp({
    generationService: {
      async generateComments() {
        return createReplyPayload()
      },
    },
    logger: createLoggerStub(),
    model: "test-model",
    openAiConfigured: true,
    requestBodyLimit: "128b",
    publicDir: "/Users/ramisyaparov/Desktop/Project/Reddit Comentator/public",
  })

  const server = await startServer(app)
  t.after(() => closeServer(server))
  const { port } = server.address()

  const response = await fetch(`http://127.0.0.1:${port}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Connection: "close",
    },
    body: JSON.stringify({
      postText: "x".repeat(400),
      tone: "grounded",
    }),
  })

  assert.equal(response.status, 413)
  const payload = await response.json()
  assert.equal(payload.code, "body_too_large")
})

test("POST /api/generate maps upstream timeouts to 504", async (t) => {
  const app = createApp({
    generationService: {
      async generateComments() {
        throw new OpenAIResponseError("OpenAI request timed out.", { status: 504 })
      },
    },
    logger: createLoggerStub(),
    model: "test-model",
    openAiConfigured: true,
    publicDir: "/Users/ramisyaparov/Desktop/Project/Reddit Comentator/public",
  })

  const server = await startServer(app)
  t.after(() => closeServer(server))
  const { port } = server.address()

  const response = await fetch(`http://127.0.0.1:${port}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Connection: "close",
    },
    body: JSON.stringify({
      postText: "Need a reply.",
      tone: "grounded",
    }),
  })

  assert.equal(response.status, 504)
  const payload = await response.json()
  assert.equal(payload.code, "upstream_timeout")
})

test("openai client aborts upstream fetch when request context is cancelled", async () => {
  const requestController = new AbortController()
  let fetchObservedAbort = false

  const client = createOpenAIResponsesClient({
    apiKey: "test-key",
    baseUrl: "https://example.com/v1",
    timeoutMs: 1000,
    retryCount: 0,
    fetchImpl: async (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => {
            fetchObservedAbort = true
            const error = new Error("aborted")
            error.name = "AbortError"
            reject(error)
          },
          { once: true },
        )
      }),
    logger: createLoggerStub(),
  })

  const pendingResponse = withOpenAIRequestContext(
    { signal: requestController.signal },
    () =>
      client.createStructuredResponse({
        model: "test-model",
        systemPrompt: "system",
        userPrompt: "user",
        replyLabels: ["Short", "Medium", "Long"],
        requestId: "test-request-id",
      }),
  )

  requestController.abort()

  await assert.rejects(
    pendingResponse,
    (error) => error instanceof OpenAIResponseError && error.status === 499,
  )
  assert.equal(fetchObservedAbort, true)
})

test("generation service reports missing OPENAI_API_KEY as a local configuration error", async () => {
  let fetchCalls = 0
  const service = createGenerationService({
    openAiClient: createOpenAIResponsesClient({
      apiKey: "",
      baseUrl: "https://example.com/v1",
      fetchImpl: async () => {
        fetchCalls += 1
        throw new Error("should not reach upstream")
      },
      logger: createLoggerStub(),
    }),
    model: "test-model",
    logger: createLoggerStub(),
  })

  await assert.rejects(
    service.generateComments({
      postText: "Need a reply.",
      tone: "grounded",
    }),
    (error) => error instanceof ConfigurationError && /OPENAI_API_KEY is missing/.test(error.message),
  )
  assert.equal(fetchCalls, 0)
})
