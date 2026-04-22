const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const dotenv = require("dotenv")

const DEFAULT_ENV_FILE_PATH = path.resolve(__dirname, "..", ".env")
const DEFAULT_HOST = "127.0.0.1"
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.4";
const DEFAULT_OPENAI_TIMEOUT_MS = 45000;
const DEFAULT_OPENAI_RETRY_COUNT = 2;
const DEFAULT_REQUEST_BODY_LIMIT = "1mb";
const DEFAULT_MAX_CONCURRENT_GENERATIONS = 2
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60000
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 12
const DEFAULT_MAX_POST_TEXT_CHARS = 12000
const DEFAULT_ALLOW_REMOTE_ACCESS = false
const DEFAULT_SAVED_GENERATIONS_FILE = path.resolve(__dirname, "..", "data", "saved-generations.json")
const DEFAULT_GENERATION_QUEUE_FILE = path.resolve(__dirname, "..", "data", "generation-queue.json")
const DEFAULT_LOGIN_USERNAME = "Admin"
const DEFAULT_LOGIN_PASSWORD_HASH = "f8f403916255e73f1eb96f4e9ffb6d1ef79ec54d948c70d7d98f76ff34ad7b4c"
const DEFAULT_SESSION_SECRET = crypto.randomBytes(32).toString("hex")

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function bootstrapEnv(targetEnv = process.env, envFilePath = DEFAULT_ENV_FILE_PATH) {
  try {
    const parsed = dotenv.parse(fs.readFileSync(envFilePath))

    for (const [key, value] of Object.entries(parsed)) {
      if (targetEnv[key] === undefined || targetEnv[key] === "") {
        targetEnv[key] = value
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error
    }
  }

  return targetEnv
}

function readBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function resolveDefaultHost(env) {
  return String(env.RENDER_SERVICE_TYPE || "").trim().toLowerCase() === "web"
    ? "0.0.0.0"
    : DEFAULT_HOST;
}

function resolveLoadConfigOptions(optionsOrEnv) {
  if (
    optionsOrEnv &&
    typeof optionsOrEnv === "object" &&
    ("env" in optionsOrEnv || "envFilePath" in optionsOrEnv)
  ) {
    return {
      env: optionsOrEnv.env || process.env,
      envFilePath: optionsOrEnv.envFilePath || DEFAULT_ENV_FILE_PATH,
    }
  }

  return {
    env: optionsOrEnv || process.env,
    envFilePath: DEFAULT_ENV_FILE_PATH,
  }
}

function loadConfig(optionsOrEnv = process.env) {
  const { env, envFilePath } = resolveLoadConfigOptions(optionsOrEnv)

  bootstrapEnv(env, envFilePath)
  const defaultHost = resolveDefaultHost(env)

  return {
    host: String(env.HOST || defaultHost).trim() || defaultHost,
    port: readPositiveInteger(env.PORT, 3000),
    appAccessToken: String(env.APP_ACCESS_TOKEN || "").trim(),
    allowRemoteAccess: readBoolean(env.ALLOW_REMOTE_ACCESS, DEFAULT_ALLOW_REMOTE_ACCESS),
    openAiApiKey: String(env.OPENAI_API_KEY || "").trim(),
    openAiModel: String(env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL,
    openAiBaseUrl:
      String(env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL).trim().replace(/\/+$/, "") ||
      DEFAULT_OPENAI_BASE_URL,
    openAiTimeoutMs: readPositiveInteger(env.OPENAI_TIMEOUT_MS, DEFAULT_OPENAI_TIMEOUT_MS),
    openAiRetryCount: readPositiveInteger(
      env.OPENAI_RETRY_COUNT,
      DEFAULT_OPENAI_RETRY_COUNT,
    ),
    requestBodyLimit:
      String(env.REQUEST_BODY_LIMIT || DEFAULT_REQUEST_BODY_LIMIT).trim() ||
      DEFAULT_REQUEST_BODY_LIMIT,
    maxConcurrentGenerations: readPositiveInteger(
      env.MAX_CONCURRENT_GENERATIONS,
      DEFAULT_MAX_CONCURRENT_GENERATIONS,
    ),
    maxPostTextChars: readPositiveInteger(
      env.MAX_POST_TEXT_CHARS,
      DEFAULT_MAX_POST_TEXT_CHARS,
    ),
    savedGenerationsFile:
      String(env.SAVED_GENERATIONS_FILE || DEFAULT_SAVED_GENERATIONS_FILE).trim() ||
      DEFAULT_SAVED_GENERATIONS_FILE,
    generationQueueFile:
      String(env.GENERATION_QUEUE_FILE || DEFAULT_GENERATION_QUEUE_FILE).trim() ||
      DEFAULT_GENERATION_QUEUE_FILE,
    appLoginUsername:
      String(env.APP_LOGIN_USERNAME || DEFAULT_LOGIN_USERNAME).trim() || DEFAULT_LOGIN_USERNAME,
    appLoginPasswordHash:
      String(env.APP_LOGIN_PASSWORD_HASH || DEFAULT_LOGIN_PASSWORD_HASH).trim().toLowerCase() ||
      DEFAULT_LOGIN_PASSWORD_HASH,
    appSessionSecret:
      String(env.APP_SESSION_SECRET || DEFAULT_SESSION_SECRET).trim() || DEFAULT_SESSION_SECRET,
    rateLimitWindowMs: readPositiveInteger(
      env.RATE_LIMIT_WINDOW_MS,
      DEFAULT_RATE_LIMIT_WINDOW_MS,
    ),
    rateLimitMaxRequests: readPositiveInteger(
      env.RATE_LIMIT_MAX_REQUESTS,
      DEFAULT_RATE_LIMIT_MAX_REQUESTS,
    ),
  };
}

module.exports = {
  DEFAULT_OPENAI_MODEL,
  DEFAULT_ENV_FILE_PATH,
  bootstrapEnv,
  loadConfig,
};
