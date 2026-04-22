const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const { withOpenAIRequestContext } = require("./openaiResponsesClient");

const VALID_JOB_STATUSES = new Set(["queued", "processing", "completed", "failed"]);

class GenerationQueueError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "GenerationQueueError";
    this.status = options.status ?? 500;
    this.code = options.code || "generation_queue_error";
  }
}

function trimToLength(value, maxLength) {
  const normalized = String(value || "").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trim()}...`;
}

function sanitizeJobStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return VALID_JOB_STATUSES.has(normalized) ? normalized : "queued";
}

function sanitizeRequestPayload(request = {}) {
  return {
    contentMode: String(request.contentMode || "comments").trim() || "comments",
    postText: String(request.postText || "").trim(),
    redditUrl: String(request.redditUrl || "").trim(),
    targetKeyword: String(request.targetKeyword || "").trim(),
    sourceTitle: String(request.sourceTitle || "").trim(),
    sourcePost: String(request.sourcePost || "").trim(),
    personaId: String(request.personaId || "").trim(),
    generateAllPersonas: request.generateAllPersonas === true,
    promoCreditClub: request.promoCreditClub === true,
    promoCreditBooster: request.promoCreditBooster === true,
  };
}

function buildSourcePreview(request) {
  if (request.contentMode === "posts") {
    return trimToLength(`${request.sourceTitle} ${request.sourcePost}`.trim(), 800);
  }

  if (request.redditUrl) {
    return request.redditUrl;
  }

  return trimToLength(request.postText, 800);
}

function normalizeStoredJob(job) {
  if (!job || typeof job !== "object") {
    return null;
  }

  const request = sanitizeRequestPayload(job.request);

  return {
    id: String(job.id || "").trim(),
    createdAt: String(job.createdAt || "").trim(),
    updatedAt: String(job.updatedAt || job.createdAt || "").trim(),
    startedAt: String(job.startedAt || "").trim(),
    finishedAt: String(job.finishedAt || "").trim(),
    status: sanitizeJobStatus(job.status),
    contentMode: request.contentMode,
    generationMode: request.generateAllPersonas ? "all-personas" : "single",
    personaId: String(job.personaId || request.personaId || "").trim(),
    personaName: String(job.personaName || "").trim(),
    sourceLink: String(job.sourceLink || request.redditUrl || "").trim(),
    sourceTitle: String(job.sourceTitle || request.sourceTitle || "").trim(),
    sourcePreview: String(job.sourcePreview || buildSourcePreview(request)).trim(),
    targetKeyword: String(job.targetKeyword || request.targetKeyword || "").trim(),
    savedItemsCount: Number.isFinite(job.savedItemsCount) ? job.savedItemsCount : 0,
    savedItemIds: Array.isArray(job.savedItemIds)
      ? job.savedItemIds.map((value) => String(value || "").trim()).filter(Boolean)
      : [],
    errorMessage: String(job.errorMessage || "").trim(),
    request,
  };
}

function createGenerationQueue({
  filePath,
  generationService,
  savedOutputsStore,
  logger,
}) {
  let writeQueue = Promise.resolve();
  let activeJobId = "";

  async function ensureQueueFile() {
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

  async function readAllJobs() {
    await ensureQueueFile();
    const raw = await fs.readFile(filePath, "utf8");

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map(normalizeStoredJob)
        .filter((job) => job && job.id && job.createdAt && job.request?.personaId);
    } catch (error) {
      logger?.warn("Generation queue contains invalid JSON", {
        file_path: filePath,
        message: error?.message || "Unknown error",
      });
      return [];
    }
  }

  async function writeAllJobs(jobs) {
    await ensureQueueFile();
    const nextPayload = JSON.stringify(jobs, null, 2);
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, `${nextPayload}\n`, "utf8");
    await fs.rename(tempPath, filePath);
  }

  function queueWrite(task) {
    const run = writeQueue.then(task, task);
    writeQueue = run.catch(() => {});
    return run;
  }

  async function listJobs({ status = "all", limit = 50 } = {}) {
    const normalizedStatus = String(status || "all").trim().toLowerCase();
    const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 50;
    const jobs = await readAllJobs();

    return jobs
      .filter((job) => normalizedStatus === "all" || job.status === normalizedStatus)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, normalizedLimit)
      .map(({ request: _request, ...job }) => job);
  }

  async function enqueue(request, persona = null) {
    const sanitizedRequest = sanitizeRequestPayload(request);
    const now = new Date().toISOString();
    const job = normalizeStoredJob({
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: "queued",
      personaId: sanitizedRequest.personaId,
      personaName:
        sanitizedRequest.generateAllPersonas
          ? "All personas"
          : String(persona?.name || "").trim(),
      sourceLink: sanitizedRequest.redditUrl,
      sourceTitle: sanitizedRequest.sourceTitle,
      sourcePreview: buildSourcePreview(sanitizedRequest),
      targetKeyword: sanitizedRequest.targetKeyword,
      request: sanitizedRequest,
    });

    await queueWrite(async () => {
      const existingJobs = await readAllJobs();
      const nextJobs = [job, ...existingJobs];
      await writeAllJobs(nextJobs);
    });

    void processNext();

    const { request: _request, ...publicJob } = job;
    return publicJob;
  }

  async function resetInterruptedJobs() {
    await queueWrite(async () => {
      const jobs = await readAllJobs();
      let changed = false;
      const nextJobs = jobs.map((job) => {
        if (job.status === "processing") {
          changed = true;
          return {
            ...job,
            status: "queued",
            updatedAt: new Date().toISOString(),
            startedAt: "",
            errorMessage: "",
          };
        }

        return job;
      });

      if (changed) {
        await writeAllJobs(nextJobs);
      }
    });
  }

  async function markJobState(jobId, updater) {
    return queueWrite(async () => {
      const jobs = await readAllJobs();
      const index = jobs.findIndex((job) => job.id === jobId);

      if (index === -1) {
        throw new GenerationQueueError("Queued job was not found.", {
          status: 404,
          code: "queue_job_not_found",
        });
      }

      const updatedJob = normalizeStoredJob(updater(jobs[index]));
      jobs[index] = updatedJob;
      await writeAllJobs(jobs);
      return updatedJob;
    });
  }

  async function processJob(job) {
    const startedAt = new Date().toISOString();
    await markJobState(job.id, (current) => ({
      ...current,
      status: "processing",
      startedAt,
      updatedAt: startedAt,
      errorMessage: "",
    }));

    try {
      const result = await withOpenAIRequestContext({}, () =>
        generationService.generateComments({
          ...job.request,
          requestId: `queue:${job.id}`,
        }),
      );

      let savedItems = [];

      if (!savedOutputsStore) {
        throw new GenerationQueueError("Saved outputs storage is not configured.", {
          status: 503,
          code: "saved_outputs_unavailable",
        });
      }

      savedItems = await savedOutputsStore.saveGeneration({
        ...job.request,
        replies: result.replies,
        generationMode: result.generationMode,
        sourceContext: result.sourceContext,
        persona: result.persona || null,
      });

      const finishedAt = new Date().toISOString();
      await markJobState(job.id, (current) => ({
        ...current,
        status: "completed",
        finishedAt,
        updatedAt: finishedAt,
        savedItemsCount: savedItems.length,
        savedItemIds: savedItems.map((item) => item.id),
        errorMessage: "",
      }));

      logger?.info("Queued generation completed", {
        job_id: job.id,
        content_mode: job.contentMode,
        generation_mode: job.generationMode,
        saved_items_count: savedItems.length,
      });
    } catch (error) {
      const finishedAt = new Date().toISOString();
      const message = String(error?.message || "Generation failed.").trim() || "Generation failed.";

      await markJobState(job.id, (current) => ({
        ...current,
        status: "failed",
        finishedAt,
        updatedAt: finishedAt,
        errorMessage: message,
      }));

      logger?.error("Queued generation failed", {
        job_id: job.id,
        content_mode: job.contentMode,
        generation_mode: job.generationMode,
        message,
      });
    }
  }

  async function processNext() {
    if (activeJobId) {
      return;
    }

    const jobs = await readAllJobs();
    const nextJob = jobs
      .filter((job) => job.status === "queued")
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))[0];

    if (!nextJob) {
      return;
    }

    activeJobId = nextJob.id;

    try {
      await processJob(nextJob);
    } finally {
      activeJobId = "";
      setImmediate(() => {
        void processNext();
      });
    }
  }

  async function start() {
    await resetInterruptedJobs();
    void processNext();
  }

  return {
    enqueue,
    listJobs,
    start,
  };
}

module.exports = {
  GenerationQueueError,
  VALID_JOB_STATUSES,
  createGenerationQueue,
};
