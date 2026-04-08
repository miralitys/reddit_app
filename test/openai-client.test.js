const test = require("node:test");
const assert = require("node:assert/strict");

const {
  OpenAIResponseError,
  createOpenAIResponsesClient,
  withOpenAIRequestContext,
} = require("../src/infrastructure/openaiResponsesClient");

function createLoggerStub() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

test("openai client retries one 429 and then succeeds", async () => {
  let attempts = 0;
  const client = createOpenAIResponsesClient({
    apiKey: "test-key",
    baseUrl: "https://example.test",
    retryCount: 1,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: { message: "Rate limited." } }), {
          status: 429,
        });
      }

      return new Response(JSON.stringify({ replies: [{ label: "Short", text: "ok" }] }), {
        status: 200,
      });
    },
    logger: createLoggerStub(),
  });

  const payload = await client.createStructuredResponse({
    model: "test-model",
    systemPrompt: "system",
    userPrompt: "user",
    replyLabels: ["Short"],
  });

  assert.equal(attempts, 2);
  assert.deepEqual(payload.replies, [{ label: "Short", text: "ok" }]);
});

test("openai client stops retrying when client aborts", async () => {
  const abortController = new AbortController();
  let attempts = 0;
  const client = createOpenAIResponsesClient({
    apiKey: "test-key",
    baseUrl: "https://example.test",
    retryCount: 2,
    fetchImpl: async (_url, { signal }) => {
      attempts += 1;
      await new Promise((resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" })),
          { once: true },
        );
        void resolve;
      });
    },
    logger: createLoggerStub(),
  });

  const run = withOpenAIRequestContext({ signal: abortController.signal }, () =>
    client.createStructuredResponse({
      model: "test-model",
      systemPrompt: "system",
      userPrompt: "user",
      replyLabels: ["Short"],
    }),
  );

  abortController.abort();

  await assert.rejects(
    () => run,
    (error) => error instanceof OpenAIResponseError && error.status === 499,
  );
  assert.equal(attempts, 1);
});

test("openai client aborts retry backoff before starting another attempt", async () => {
  const abortController = new AbortController();
  let attempts = 0;
  const client = createOpenAIResponsesClient({
    apiKey: "test-key",
    baseUrl: "https://example.test",
    retryCount: 2,
    fetchImpl: async () => {
      attempts += 1;

      if (attempts === 1) {
        setTimeout(() => abortController.abort(), 10);
        return new Response(JSON.stringify({ error: { message: "Rate limited." } }), {
          status: 429,
          headers: {
            "retry-after": "60",
          },
        });
      }

      return new Response(JSON.stringify({ replies: [{ label: "Short", text: "ok" }] }), {
        status: 200,
      });
    },
    logger: createLoggerStub(),
  });

  await assert.rejects(
    () =>
      withOpenAIRequestContext({ signal: abortController.signal }, () =>
        client.createStructuredResponse({
          model: "test-model",
          systemPrompt: "system",
          userPrompt: "user",
          replyLabels: ["Short"],
        }),
      ),
    (error) => error instanceof OpenAIResponseError && error.status === 499,
  );

  assert.equal(attempts, 1);
});

test("openai client cancels retry backoff immediately after abort", async () => {
  const abortController = new AbortController();
  let attempts = 0;
  const client = createOpenAIResponsesClient({
    apiKey: "test-key",
    baseUrl: "https://example.test",
    retryCount: 2,
    fetchImpl: async () => {
      attempts += 1;
      return new Response(JSON.stringify({ error: { message: "Rate limited." } }), {
        status: 429,
      });
    },
    logger: createLoggerStub(),
  });

  const run = withOpenAIRequestContext({ signal: abortController.signal }, () =>
    client.createStructuredResponse({
      model: "test-model",
      systemPrompt: "system",
      userPrompt: "user",
      replyLabels: ["Short"],
    }),
  );

  setTimeout(() => abortController.abort(), 50);

  await assert.rejects(
    () => run,
    (error) => error instanceof OpenAIResponseError && error.status === 499,
  );
  assert.equal(attempts, 1);
});

test("openai client does not retry after the total timeout budget expires", async () => {
  let attempts = 0;
  const client = createOpenAIResponsesClient({
    apiKey: "test-key",
    baseUrl: "https://example.test",
    timeoutMs: 25,
    retryCount: 2,
    fetchImpl: async (_url, { signal }) => {
      attempts += 1;
      await new Promise((resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" })),
          { once: true },
        );
        void resolve;
      });
    },
    logger: createLoggerStub(),
  });

  await assert.rejects(
    () =>
      client.createStructuredResponse({
        model: "test-model",
        systemPrompt: "system",
        userPrompt: "user",
        replyLabels: ["Short"],
      }),
    (error) => error instanceof OpenAIResponseError && error.status === 504,
  );

  assert.equal(attempts, 1);
});
