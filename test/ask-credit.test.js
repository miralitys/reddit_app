const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { createGenerationService } = require("../src/application/generateReplies");
const { createSavedOutputsStore } = require("../src/infrastructure/savedOutputsStore");
const { createApp } = require("../src/presentation/createApp");
const { validateGenerateRequest } = require("../src/presentation/validation");

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

test("validateGenerateRequest accepts ask-credit without source text", () => {
  const payload = validateGenerateRequest({
    contentMode: "ask-credit",
    personaId: "marina-volk",
  });

  assert.deepEqual(payload, {
    contentMode: "ask-credit",
    postText: "",
    redditUrl: "",
    targetKeyword: "",
    sourceTitle: "",
    sourcePost: "",
    personaId: "marina-volk",
    generateAllPersonas: false,
    promoCreditClub: false,
    promoCreditBooster: false,
  });
});

test("generation service returns a normalized Ask Credit question for one persona", async () => {
  const openAiClient = {
    isConfigured: true,
    async createStructuredResponse(request) {
      assert.equal(request.responseSchemaName, "ask_credit_single_question");
      assert.match(request.userPrompt, /Write exactly 1 Ask Credit question/i);
      return {
        replies: [
          {
            text: "I rebuilt from a secured card and now I am wondering if closing it too early could mess up my profile",
          },
        ],
      };
    },
  };

  const service = createGenerationService({
    openAiClient,
    redditPostClient: null,
    model: "test-model",
    logger: createLoggerStub(),
  });

  const result = await service.generateComments({
    contentMode: "ask-credit",
    personaId: "alex-moreno",
    generateAllPersonas: false,
    requestId: "ask-credit-test",
  });

  assert.equal(result.contentMode, "ask-credit");
  assert.equal(result.generationMode, "single");
  assert.equal(result.persona.id, "alex-moreno");
  assert.equal(result.persona.name, "Alex Moreno");
  assert.equal(result.replies.length, 1);
  assert.equal(
    result.replies[0].text,
    "I rebuilt from a secured card and now I am wondering if closing it too early could mess up my profile?",
  );
});

test("saved outputs store filters Ask Credit items separately", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ask-credit-store-"));
  const filePath = path.join(tempDir, "saved.json");

  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const store = createSavedOutputsStore({
    filePath,
    logger: createLoggerStub(),
  });

  await store.saveGeneration({
    contentMode: "ask-credit",
    generationMode: "single",
    personaId: "alex-moreno",
    replies: [{ text: "Would closing my oldest secured card hurt my profile too much?" }],
    persona: { id: "alex-moreno", name: "Alex Moreno" },
  });

  await store.saveGeneration({
    contentMode: "comments",
    generationMode: "single",
    personaId: "marina-volk",
    postText: "Need a reply.",
    replies: [{ text: "The late payment matters more than the inquiry." }],
    persona: { id: "marina-volk", name: "Marina Volk" },
  });

  const askCreditItems = await store.listItems({ contentMode: ["ask-credit"] });
  const commentItems = await store.listItems({ contentMode: ["comments"] });

  assert.equal(askCreditItems.length, 1);
  assert.equal(askCreditItems[0].contentMode, "ask-credit");
  assert.equal(askCreditItems[0].sourcePreview, "Generated from persona profile.");
  assert.equal(commentItems.length, 1);
  assert.equal(commentItems[0].contentMode, "comments");
});

test("Ask Credit route saves outputs and filters them back out of the library", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ask-credit-app-"));
  const filePath = path.join(tempDir, "saved.json");

  t.after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const savedOutputsStore = createSavedOutputsStore({
    filePath,
    logger: createLoggerStub(),
  });

  const app = createApp({
    generationService: {
      async generateComments(request) {
        assert.equal(request.contentMode, "ask-credit");
        assert.equal(request.personaId, "kevin-brooks");
        return {
          model: "test-model",
          contentMode: "ask-credit",
          generationMode: "single",
          replies: [{ text: "Should I wait before applying again if I just took a hard pull?" }],
          persona: {
            id: "kevin-brooks",
            name: "Kevin Brooks",
          },
          sourceContext: null,
        };
      },
    },
    logger: createLoggerStub(),
    model: "test-model",
    openAiConfigured: true,
    publicDir: path.join(__dirname, "..", "public"),
    savedOutputsStore,
  });

  const server = await startServer(app);
  t.after(() => stopServer(server));
  const { port } = server.address();

  const generateResponse = await fetch(`http://127.0.0.1:${port}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contentMode: "ask-credit",
      personaId: "kevin-brooks",
    }),
  });

  assert.equal(generateResponse.status, 200);
  const generatePayload = await generateResponse.json();
  assert.equal(generatePayload.savedItemsCount, 1);
  assert.equal(generatePayload.contentMode, "ask-credit");

  const savedResponse = await fetch(
    `http://127.0.0.1:${port}/api/saved?contentMode=ask-credit&personaId=kevin-brooks&status=all`,
  );

  assert.equal(savedResponse.status, 200);
  const savedPayload = await savedResponse.json();
  assert.equal(savedPayload.items.length, 1);
  assert.equal(savedPayload.items[0].contentMode, "ask-credit");
  assert.equal(savedPayload.items[0].personaId, "kevin-brooks");
});
