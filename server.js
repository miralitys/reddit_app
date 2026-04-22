const path = require("path");

const { loadConfig } = require("./src/config");
const { createGenerationService } = require("./src/application/generateReplies");
const {
  createOpenAIResponsesClient,
} = require("./src/infrastructure/openaiResponsesClient");
const { createRedditPostClient } = require("./src/infrastructure/redditPostClient");
const { createGenerationQueue } = require("./src/infrastructure/generationQueue");
const { createSavedOutputsStore } = require("./src/infrastructure/savedOutputsStore");
const { createApp } = require("./src/presentation/createApp");
const { createLogger } = require("./src/shared/logger");

const config = loadConfig();
const logger = createLogger({ component: "reddit-commentator" });
const openAiClient = createOpenAIResponsesClient({
  apiKey: config.openAiApiKey,
  baseUrl: config.openAiBaseUrl,
  timeoutMs: config.openAiTimeoutMs,
  retryCount: config.openAiRetryCount,
  logger,
});
const redditPostClient = createRedditPostClient({ logger });
const savedOutputsStore = createSavedOutputsStore({
  filePath: config.savedGenerationsFile,
  logger,
});
const generationService = createGenerationService({
  openAiClient,
  redditPostClient,
  model: config.openAiModel,
  logger,
});
const generationQueue = createGenerationQueue({
  filePath: config.generationQueueFile,
  generationService,
  savedOutputsStore,
  logger,
});

const app = createApp({
  generationService,
  generationQueue,
  logger,
  model: config.openAiModel,
  publicDir: path.join(__dirname, "public"),
  requestBodyLimit: config.requestBodyLimit,
  accessToken: config.appAccessToken,
  allowRemoteAccess: config.allowRemoteAccess,
  savedOutputsStore,
  maxPostTextChars: config.maxPostTextChars,
  maxConcurrentGenerations: config.maxConcurrentGenerations,
  rateLimitWindowMs: config.rateLimitWindowMs,
  rateLimitMaxRequests: config.rateLimitMaxRequests,
  openAiConfigured: Boolean(config.openAiApiKey),
});

void generationQueue.start().catch((error) => {
  logger.error("Generation queue failed to start", {
    message: error?.message || "Unknown error",
  });
});

if (require.main === module) {
  app.listen(config.port, config.host, () => {
    logger.info("Reddit Commentator server started", {
      host: config.host,
      port: config.port,
      model: config.openAiModel,
    });
  });
}

module.exports = { app };
