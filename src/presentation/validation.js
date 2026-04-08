const { DEFAULT_PERSONA_ID, getPersonaById } = require("../domain/personas");

class RequestValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "RequestValidationError";
    this.status = status;
  }
}

function validateGenerateRequest(body, options = {}) {
  const maxPostTextChars = Number.isFinite(options.maxPostTextChars)
    ? options.maxPostTextChars
    : 12000;
  const maxSourcePostChars = Number.isFinite(options.maxSourcePostChars)
    ? options.maxSourcePostChars
    : 40000;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestValidationError("Request body must be a JSON object.");
  }

  if (body.contentMode !== undefined && typeof body.contentMode !== "string") {
    throw new RequestValidationError("contentMode must be a string.");
  }

  if (body.postText !== undefined && typeof body.postText !== "string") {
    throw new RequestValidationError("postText must be a string.");
  }

  if (body.redditUrl !== undefined && typeof body.redditUrl !== "string") {
    throw new RequestValidationError("redditUrl must be a string.");
  }

  if (body.targetKeyword !== undefined && typeof body.targetKeyword !== "string") {
    throw new RequestValidationError("targetKeyword must be a string.");
  }

  if (body.sourceTitle !== undefined && typeof body.sourceTitle !== "string") {
    throw new RequestValidationError("sourceTitle must be a string.");
  }

  if (body.sourcePost !== undefined && typeof body.sourcePost !== "string") {
    throw new RequestValidationError("sourcePost must be a string.");
  }

  if (body.personaId !== undefined && typeof body.personaId !== "string") {
    throw new RequestValidationError("personaId must be a string.");
  }

  if (body.generateAllPersonas !== undefined && typeof body.generateAllPersonas !== "boolean") {
    throw new RequestValidationError("generateAllPersonas must be a boolean.");
  }

  if (body.promoCreditClub !== undefined && typeof body.promoCreditClub !== "boolean") {
    throw new RequestValidationError("promoCreditClub must be a boolean.");
  }

  if (body.promoCreditBooster !== undefined && typeof body.promoCreditBooster !== "boolean") {
    throw new RequestValidationError("promoCreditBooster must be a boolean.");
  }

  const contentMode = String(body.contentMode || "comments").trim().toLowerCase() || "comments";
  const postText = String(body.postText || "").trim();
  const redditUrl = String(body.redditUrl || "").trim();
  const targetKeyword = String(body.targetKeyword || "").trim();
  const sourceTitle = String(body.sourceTitle || "").trim();
  const sourcePost = String(body.sourcePost || "").trim();
  const personaId = String(body.personaId || DEFAULT_PERSONA_ID).trim() || DEFAULT_PERSONA_ID;
  const generateAllPersonas = body.generateAllPersonas === true;
  const promoCreditClub = body.promoCreditClub === true;
  const promoCreditBooster = body.promoCreditBooster === true;

  if (contentMode !== "comments" && contentMode !== "posts") {
    throw new RequestValidationError("contentMode must be comments or posts.");
  }

  if (contentMode === "comments") {
    if (!postText && !redditUrl) {
      throw new RequestValidationError("Paste Reddit post text or add a Reddit post URL first.");
    }

    if (postText && postText.length > maxPostTextChars) {
      throw new RequestValidationError(
        `Reddit post text must be ${maxPostTextChars} characters or fewer.`,
        413,
      );
    }
  }

  if (contentMode === "posts") {
    if (!targetKeyword) {
      throw new RequestValidationError("Add a target keyword first.");
    }

    if (!sourceTitle) {
      throw new RequestValidationError("Add the source title first.");
    }

    if (!sourcePost) {
      throw new RequestValidationError("Paste the original post first.");
    }

    if (sourcePost.length > maxSourcePostChars) {
      throw new RequestValidationError(
        `Original post text must be ${maxSourcePostChars} characters or fewer.`,
        413,
      );
    }
  }

  if (!getPersonaById(personaId)) {
    throw new RequestValidationError("personaId is invalid.");
  }

  if (contentMode === "comments" && promoCreditClub && promoCreditBooster) {
    throw new RequestValidationError(
      "Only one promotional mode can be enabled at a time.",
    );
  }

  return {
    contentMode,
    postText,
    redditUrl,
    targetKeyword,
    sourceTitle,
    sourcePost,
    personaId,
    generateAllPersonas,
    promoCreditClub: contentMode === "comments" ? promoCreditClub : false,
    promoCreditBooster: contentMode === "comments" ? promoCreditBooster : false,
  };
}

module.exports = {
  RequestValidationError,
  validateGenerateRequest,
};
