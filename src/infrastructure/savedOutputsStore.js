const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const VALID_SAVED_STATUSES = new Set(["new", "published"]);
const VALID_SAVED_CONTENT_MODES = new Set(["comments", "posts", "ask-credit"]);

class SavedOutputsStoreError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "SavedOutputsStoreError";
    this.status = options.status ?? 500;
    this.code = options.code || "saved_outputs_store_error";
  }
}

function trimToLength(value, maxLength) {
  const normalized = String(value || "").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trim()}...`;
}

function sanitizeStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (VALID_SAVED_STATUSES.has(normalized)) {
    return normalized;
  }

  return "new";
}

function sanitizeContentMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (VALID_SAVED_CONTENT_MODES.has(normalized)) {
    return normalized;
  }

  return "comments";
}

function normalizeStoredItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  return {
    id: String(item.id || "").trim(),
    createdAt: String(item.createdAt || "").trim(),
    updatedAt: String(item.updatedAt || item.createdAt || "").trim(),
    status: sanitizeStatus(item.status),
    contentMode: sanitizeContentMode(item.contentMode),
    generationMode: String(item.generationMode || "single").trim() || "single",
    personaId: String(item.personaId || "").trim(),
    personaName: String(item.personaName || "").trim(),
    sourceLink: String(item.sourceLink || "").trim(),
    sourceTitle: String(item.sourceTitle || "").trim(),
    sourcePreview: String(item.sourcePreview || "").trim(),
    targetKeyword: String(item.targetKeyword || "").trim(),
    outputTitle: String(item.outputTitle || "").trim(),
    outputText: String(item.outputText || "").trim(),
  };
}

function createSavedOutputsStore({ filePath, logger }) {
  let writeQueue = Promise.resolve();

  async function ensureStoreFile() {
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    try {
      await fs.access(filePath);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }

      await fs.writeFile(filePath, "[]\n", "utf8");
    }
  }

  async function readAllItems() {
    await ensureStoreFile();
    const raw = await fs.readFile(filePath, "utf8");

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map(normalizeStoredItem)
        .filter((item) => item && item.id && item.createdAt && item.outputText);
    } catch (error) {
      logger?.warn("Saved outputs store contains invalid JSON", {
        file_path: filePath,
        message: error?.message || "Unknown error",
      });
      return [];
    }
  }

  async function writeAllItems(items) {
    await ensureStoreFile();
    const nextPayload = JSON.stringify(items, null, 2);
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, `${nextPayload}\n`, "utf8");
    await fs.rename(tempPath, filePath);
  }

  function queueWrite(task) {
    const run = writeQueue.then(task, task);
    writeQueue = run.catch(() => {});
    return run;
  }

  async function listItems({ personaId = "", status = "all", contentMode = [] } = {}) {
    const normalizedStatus = String(status || "all").trim().toLowerCase();
    const normalizedPersonaId = String(personaId || "").trim();
    const normalizedContentModes = Array.isArray(contentMode)
      ? contentMode
          .map((value) => sanitizeContentMode(value))
          .filter(Boolean)
      : String(contentMode || "").trim()
        ? [sanitizeContentMode(contentMode)]
        : [];
    const items = await readAllItems();

    return items
      .filter((item) => !normalizedPersonaId || item.personaId === normalizedPersonaId)
      .filter((item) => normalizedStatus === "all" || item.status === normalizedStatus)
      .filter((item) => !normalizedContentModes.length || normalizedContentModes.includes(item.contentMode))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }

  async function saveGeneration({
    contentMode,
    generationMode,
    personaId,
    redditUrl,
    postText,
    targetKeyword,
    sourceTitle,
    sourcePost,
    sourceContext,
    replies,
    persona,
  }) {
    if (!Array.isArray(replies) || !replies.length) {
      return [];
    }

    const now = new Date().toISOString();
    const normalizedContentMode = sanitizeContentMode(contentMode);
    const sourceLink = String(sourceContext?.redditUrl || redditUrl || "").trim();
    const sharedSourceTitle = String(
      sourceTitle || sourceContext?.title || (normalizedContentMode === "posts" ? sourceTitle : ""),
    ).trim();
    const sharedSourcePreview = trimToLength(
      normalizedContentMode === "ask-credit"
        ? "Generated from persona profile."
        : normalizedContentMode === "posts"
        ? sourcePost
        : sourceContext?.body || postText,
      1200,
    );

    const records = replies.map((reply) => ({
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: "new",
      contentMode: normalizedContentMode,
      generationMode: String(generationMode || "single").trim() || "single",
      personaId: String(reply.personaId || persona?.id || personaId || "").trim(),
      personaName: String(reply.personaName || persona?.name || "").trim(),
      sourceLink,
      sourceTitle: sharedSourceTitle,
      sourcePreview: sharedSourcePreview,
      outputTitle: String(reply.title || "").trim(),
      outputText: trimToLength(reply.text, 10000),
      targetKeyword: String(targetKeyword || "").trim(),
    }));

    return queueWrite(async () => {
      const existingItems = await readAllItems();
      const nextItems = [...records, ...existingItems];
      await writeAllItems(nextItems);
      return records;
    });
  }

  async function updateStatus(id, status) {
    const normalizedId = String(id || "").trim();
    const normalizedStatus = String(status || "").trim().toLowerCase();

    if (!normalizedId) {
      throw new SavedOutputsStoreError("Saved item id is required.", {
        status: 400,
        code: "saved_item_id_required",
      });
    }

    if (!VALID_SAVED_STATUSES.has(normalizedStatus)) {
      throw new SavedOutputsStoreError("Saved item status is invalid.", {
        status: 400,
        code: "saved_item_status_invalid",
      });
    }

    return queueWrite(async () => {
      const items = await readAllItems();
      const itemIndex = items.findIndex((item) => item.id === normalizedId);

      if (itemIndex === -1) {
        throw new SavedOutputsStoreError("Saved item was not found.", {
          status: 404,
          code: "saved_item_not_found",
        });
      }

      const updatedItem = {
        ...items[itemIndex],
        status: normalizedStatus,
        updatedAt: new Date().toISOString(),
      };

      items[itemIndex] = updatedItem;
      await writeAllItems(items);
      return updatedItem;
    });
  }

  return {
    listItems,
    saveGeneration,
    updateStatus,
  };
}

module.exports = {
  SavedOutputsStoreError,
  VALID_SAVED_STATUSES,
  createSavedOutputsStore,
};
