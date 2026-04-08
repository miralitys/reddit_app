const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { InvalidModelResponseError } = require("../src/application/generateReplies");
const { createApp } = require("../src/presentation/createApp");

const publicDir = path.join(__dirname, "..", "public");

function createLoggerStub() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

async function startServer(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

async function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

test("POST /api/generate returns generated replies", async (t) => {
  const app = createApp({
    generationService: {
      async generateComments({ postText, tone }) {
        assert.equal(postText, "My score dropped after I closed a card.");
        assert.equal(tone, "grounded");
        return {
          model: "test-model",
          replies: [
            { label: "Short", text: "Closing the card can change utilization and average age." },
            { label: "Medium", text: "The drop is usually more about utilization or profile changes than some hidden penalty." },
            { label: "Long", text: "The bigger issue is how much available credit you lost and whether the rest of the file is strong enough to absorb it." },
          ],
        };
      },
    },
    logger: createLoggerStub(),
    model: "test-model",
    publicDir,
  });

  const server = await startServer(app);
  t.after(() => stopServer(server));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      postText: "My score dropped after I closed a card.",
      tone: "grounded",
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.model, "test-model");
  assert.equal(payload.replies.length, 3);
});

test("POST /api/generate rejects invalid promo combination", async (t) => {
  const app = createApp({
    generationService: {
      async generateComments() {
        throw new Error("Should not reach generation service.");
      },
    },
    logger: createLoggerStub(),
    model: "test-model",
    publicDir,
  });

  const server = await startServer(app);
  t.after(() => stopServer(server));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      postText: "Need a reply.",
      tone: "grounded",
      promoCreditClub: true,
      promoCreditBooster: true,
    }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /Only one promotional mode/);
});

test("POST /api/generate returns 502 when model output breaks the reply contract", async (t) => {
  const app = createApp({
    generationService: {
      async generateComments() {
        throw new InvalidModelResponseError(
          "Replies must be returned in this order: Short, Medium, Long.",
        );
      },
    },
    logger: createLoggerStub(),
    model: "test-model",
    publicDir,
  });

  const server = await startServer(app);
  t.after(() => stopServer(server));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      postText: "Need a reply.",
      tone: "grounded",
    }),
  });

  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.equal(payload.error, "The model did not return a usable response. Please try again.");
});

test("POST /api/generate returns JSON for malformed bodies and preserves request id", async (t) => {
  const app = createApp({
    generationService: {
      async generateComments() {
        throw new Error("Should not reach generation service.");
      },
    },
    logger: createLoggerStub(),
    model: "test-model",
    publicDir,
  });

  const server = await startServer(app);
  t.after(() => stopServer(server));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-request-id": "route-test-id",
    },
    body: "{broken-json",
  });

  assert.equal(response.status, 400);
  assert.equal(response.headers.get("x-request-id"), "route-test-id");
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  const payload = await response.json();
  assert.equal(payload.code, "malformed_json");
  assert.equal(payload.requestId, "route-test-id");
});

test("GET /ready returns 503 when OpenAI config is missing", async (t) => {
  const app = createApp({
    generationService: {
      async generateComments() {
        return {
          replies: [],
          model: "test-model",
        };
      },
    },
    logger: createLoggerStub(),
    model: "test-model",
    publicDir,
    openAiConfigured: false,
  });

  const server = await startServer(app);
  t.after(() => stopServer(server));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/ready`);

  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.ok, false);
});
