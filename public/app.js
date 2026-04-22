const form = document.getElementById("generator-form");
const results = document.getElementById("results");
const statusNode = document.getElementById("status");
const submitButton = document.getElementById("submit-button");
const submitAllButton = document.getElementById("submit-all-button");
const queueButton = document.getElementById("queue-button");
const queueAllButton = document.getElementById("queue-all-button");
const clearHistoryButton = document.getElementById("clear-history-button");
const historyNode = document.getElementById("history");
const sourceContextNode = document.getElementById("source-context");
const queueJobsNode = document.getElementById("queue-jobs");
const refreshQueueButton = document.getElementById("refresh-queue-button");
const personaSelect = document.getElementById("persona");
const promoCreditClubCheckbox = document.getElementById("promo-credit-club");
const promoCreditBoosterCheckbox = document.getElementById("promo-credit-booster");
const contentModeInput = document.getElementById("content-mode");
const commentFields = document.getElementById("comment-fields");
const postFields = document.getElementById("post-fields");
const formKicker = document.getElementById("form-kicker");
const formTitle = document.getElementById("form-title");
const outputKicker = document.getElementById("output-kicker");
const outputTitle = document.getElementById("output-title");
const modeTabs = Array.from(document.querySelectorAll(".mode-tab"));
const promoOptions = document.querySelector(".promo-options");
const generatorSections = document.getElementById("generator-sections");
const savedSection = document.getElementById("saved-section");
const savedStatusNode = document.getElementById("saved-status");
const savedPersonaFilter = document.getElementById("saved-persona-filter");
const savedStatusFilter = document.getElementById("saved-status-filter");
const refreshSavedButton = document.getElementById("refresh-saved-button");
const savedTableWrap = document.getElementById("saved-table-wrap");
const askCreditSection = document.getElementById("ask-credit-section");
const askCreditStatusNode = document.getElementById("ask-credit-status");
const askCreditPersonaSelect = document.getElementById("ask-credit-persona");
const askCreditGenerateButton = document.getElementById("ask-credit-generate-button");
const askCreditGenerateAllButton = document.getElementById("ask-credit-generate-all-button");
const askCreditPersonaFilter = document.getElementById("ask-credit-persona-filter");
const askCreditStatusFilter = document.getElementById("ask-credit-status-filter");
const refreshAskCreditButton = document.getElementById("refresh-ask-credit-button");
const askCreditTableWrap = document.getElementById("ask-credit-table-wrap");
const logoutButton = document.getElementById("logout-button");

const HISTORY_KEY = "reddit-commentator-history";
const HISTORY_LIMIT = 8;
const COMMENT_MODE = "comments";
const POST_MODE = "posts";
const ASK_CREDIT_MODE = "ask-credit";
const SAVED_MODE = "saved";
const QUEUE_POLL_INTERVAL_MS = 5000;

let queuePollTimer = null;

function getSafeContentMode(value) {
  if (value === POST_MODE || value === SAVED_MODE || value === ASK_CREDIT_MODE) {
    return value;
  }

  return COMMENT_MODE;
}

function stripLegacyPromoDisclosure(text) {
  return String(text || "")
    .replace(/^promo disclosure:\s*/i, "")
    .replace(/^disclosure:\s*/i, "")
    .replace(/^(promotional|sponsored)\s+mention of [^.]+\.\s*/i, "")
    .replace(/^disclosure:\s*/i, "")
    .replace(/^(promotional|sponsored)\s+mention of [^.]+\.\s*/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sanitizeOutput(output) {
  if (!output || typeof output !== "object") {
    return output;
  }

  return {
    ...output,
    text: stripLegacyPromoDisclosure(output.text || ""),
  };
}

function sanitizeOutputs(outputs) {
  return Array.isArray(outputs) ? outputs.map(sanitizeOutput) : [];
}

function sanitizeHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return entry;
  }

  return {
    ...entry,
    contentMode: getSafeContentMode(entry.contentMode),
    replies: sanitizeOutputs(entry.replies),
  };
}

function sanitizeSavedItem(item) {
  if (!item || typeof item !== "object") {
    return item;
  }

  return {
    ...item,
    contentMode: getSafeContentMode(item.contentMode),
    outputText: stripLegacyPromoDisclosure(item.outputText || ""),
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getStatusNode(mode = contentModeInput.value) {
  const safeMode = getSafeContentMode(mode);

  if (safeMode === ASK_CREDIT_MODE && askCreditStatusNode) {
    return askCreditStatusNode;
  }

  if (safeMode === SAVED_MODE && savedStatusNode) {
    return savedStatusNode;
  }

  return statusNode;
}

function setStatus(message, mode = contentModeInput.value) {
  const nextMessage = String(message || "");
  [statusNode, savedStatusNode, askCreditStatusNode]
    .filter(Boolean)
    .forEach((node) => {
      node.textContent = node === getStatusNode(mode) ? nextMessage : "";
    });
}

function buildJsonHeaders() {
  return {
    "Content-Type": "application/json",
  };
}

function getContentModeLabel(contentMode) {
  const safeMode = getSafeContentMode(contentMode);

  if (safeMode === POST_MODE) {
    return "Посты";
  }

  if (safeMode === ASK_CREDIT_MODE) {
    return "Ask Credit";
  }

  return "Комментарии";
}

async function copyText(text) {
  const normalizedText = String(text || "");

  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(normalizedText);
      return;
    } catch (_error) {
      // Fall back below.
    }
  }

  const helper = document.createElement("textarea");
  helper.value = normalizedText;
  helper.setAttribute("readonly", "");
  helper.style.position = "fixed";
  helper.style.top = "0";
  helper.style.left = "-9999px";
  helper.style.opacity = "0.01";
  helper.style.pointerEvents = "none";
  document.body.append(helper);
  helper.focus();
  helper.select();
  helper.setSelectionRange(0, helper.value.length);

  const successful = document.execCommand("copy");
  helper.remove();

  if (!successful) {
    throw new Error("Copy failed.");
  }
}

function flashCopied(button, copiedLabel) {
  const originalLabel = button.textContent;
  button.textContent = copiedLabel;
  button.disabled = true;

  window.setTimeout(() => {
    button.textContent = originalLabel;
    button.disabled = false;
  }, 1200);
}

function getHistory() {
  try {
    const saved = window.localStorage.getItem(HISTORY_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed.map(sanitizeHistoryEntry) : [];
  } catch {
    return [];
  }
}

function saveHistory(items) {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_LIMIT)));
    return true;
  } catch {
    return false;
  }
}

function formatDate(value) {
  return new Date(value).toLocaleString();
}

function formatOutputCount(count, contentMode) {
  const safeMode = getSafeContentMode(contentMode);
  const noun = safeMode === POST_MODE
    ? count === 1 ? "post" : "posts"
    : safeMode === ASK_CREDIT_MODE
      ? count === 1 ? "question" : "questions"
      : count === 1 ? "comment" : "comments";
  return `${count} ${noun}`;
}

function getPersonaLabel(personaId) {
  const matchingOption = Array.from(personaSelect.options).find((option) => option.value === personaId);
  return matchingOption?.textContent?.trim() || "Alex Moreno";
}

function getModeConfig(mode) {
  if (getSafeContentMode(mode) === POST_MODE) {
    return {
      formKicker: "Посты",
      formTitle: "Post Rewrite",
      outputKicker: "Посты",
      outputTitle: "Generated posts",
      submitLabel: "Generate post",
      submitAllLabel: "Generate all 10 persona posts",
      queueLabel: "Add post to queue",
      queueAllLabel: "Queue all 10 persona posts",
      emptyResults: "Your rewritten post or full persona post batch will appear here.",
      generatingSingle: "Generating post...",
      generatingAll: "Generating 10 persona posts...",
      successSingle: "Post generated.",
      successAll: "All 10 persona posts generated.",
    };
  }

  if (getSafeContentMode(mode) === SAVED_MODE) {
    return {
      formKicker: "Сохраненные",
      formTitle: "Saved library",
      outputKicker: "Сохраненные",
      outputTitle: "Saved outputs",
      submitLabel: "Generate comment",
      submitAllLabel: "Generate all 10 personas",
      queueLabel: "Add comment to queue",
      queueAllLabel: "Queue all 10 personas",
      emptyResults: "Your shared saved outputs will appear here.",
      generatingSingle: "",
      generatingAll: "",
      successSingle: "",
      successAll: "",
    };
  }

  if (getSafeContentMode(mode) === ASK_CREDIT_MODE) {
    return {
      formKicker: "Ask Credit",
      formTitle: "Persona Questions",
      outputKicker: "Ask Credit",
      outputTitle: "Generated questions",
      submitLabel: "Generate question",
      submitAllLabel: "Generate all 10 personas",
      queueLabel: "Add question to queue",
      queueAllLabel: "Queue all 10 personas",
      emptyResults: "Your Ask Credit questions will appear here.",
      generatingSingle: "Generating Ask Credit question...",
      generatingAll: "Generating Ask Credit questions for all personas...",
      successSingle: "Ask Credit question generated.",
      successAll: "All 10 Ask Credit questions generated.",
    };
  }

  return {
    formKicker: "Комментарии",
    formTitle: "Thread Intake",
    outputKicker: "Комментарии",
    outputTitle: "Generated comments",
    submitLabel: "Generate comment",
    submitAllLabel: "Generate all 10 personas",
    queueLabel: "Add comment to queue",
    queueAllLabel: "Queue all 10 personas",
    emptyResults: "Your Reddit-ready comment or full persona batch will appear here.",
    generatingSingle: "Generating comment...",
    generatingAll: "Generating all 10 personas...",
    successSingle: "Comment generated.",
    successAll: "All 10 persona comments generated.",
  };
}

function renderSourceContext(sourceContext, mode = contentModeInput.value) {
  if (getSafeContentMode(mode) !== COMMENT_MODE) {
    sourceContextNode.hidden = true;
    sourceContextNode.classList.add("empty");
    sourceContextNode.innerHTML = "<p>Resolved Reddit post details will appear here when you generate from a Reddit URL.</p>";
    return;
  }

  sourceContextNode.hidden = false;

  if (!sourceContext || sourceContext.type !== "reddit-url") {
    sourceContextNode.classList.add("empty");
    sourceContextNode.innerHTML =
      "<p>Resolved Reddit post details will appear here when you generate from a Reddit URL.</p>";
    return;
  }

  sourceContextNode.classList.remove("empty");
  sourceContextNode.innerHTML = `
    <div class="source-head">
      <span class="history-tag">Reddit URL</span>
      <a class="source-link" href="${escapeHtml(sourceContext.redditUrl || "#")}" target="_blank" rel="noreferrer">Open source</a>
    </div>
    <div class="source-grid">
      <div class="source-card">
        <strong>Title</strong>
        <p>${escapeHtml(sourceContext.title || "None")}</p>
      </div>
      <div class="source-card">
        <strong>Post text</strong>
        <p>${escapeHtml(sourceContext.body || "None")}</p>
      </div>
      <div class="source-card">
        <strong>Image</strong>
        <p>${escapeHtml(sourceContext.imageDescription || (sourceContext.imageUrl ? "Image attached." : "No image"))}</p>
      </div>
      <div class="source-card">
        <strong>Text in image</strong>
        <p>${escapeHtml(sourceContext.imageText || "No visible text found.")}</p>
      </div>
    </div>
  `;
}

function getOutputDisplayLabel(output, index, entry = null) {
  if (output?.personaName) {
    return output.personaName;
  }

  if (entry?.generationMode === "all-personas" && output?.personaId) {
    return getPersonaLabel(output.personaId);
  }

  if (!output?.personaName && entry?.generationMode !== "all-personas") {
    if (getSafeContentMode(entry?.contentMode) === POST_MODE) {
      return "Post";
    }

    if (getSafeContentMode(entry?.contentMode) === ASK_CREDIT_MODE) {
      return "Question";
    }

    return "Comment";
  }

  return `Output ${index + 1}`;
}

function syncPromoSelection(changedCheckbox, otherCheckbox) {
  if (changedCheckbox.checked) {
    otherCheckbox.checked = false;
  }
}

function buildOutputCopyText(output, contentMode) {
  const text = stripLegacyPromoDisclosure(output?.text || "");

  if (getSafeContentMode(contentMode) === POST_MODE) {
    return `${output?.title || ""}\n\n${text}`.trim();
  }

  return text;
}

function getHistorySnippet(entry) {
  if (getSafeContentMode(entry.contentMode) === POST_MODE) {
    const titlePart = String(entry.sourceTitle || "").trim();
    const bodyPart = String(entry.sourcePost || "").trim();
    return `${titlePart} ${bodyPart}`.trim().slice(0, 180);
  }

  if (getSafeContentMode(entry.contentMode) === ASK_CREDIT_MODE) {
    return `${entry.replies?.[0]?.text || ""}`.trim().slice(0, 180);
  }

  return `${entry.postText || ""}`.trim().slice(0, 180);
}

function setContentMode(mode, options = {}) {
  const safeMode = getSafeContentMode(mode);
  const config = getModeConfig(safeMode);
  const shouldResetOutput = options.resetOutput !== false;

  contentModeInput.value = safeMode;

  modeTabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.mode === safeMode);
  });

  const isSavedMode = safeMode === SAVED_MODE;
  const isAskCreditMode = safeMode === ASK_CREDIT_MODE;

  generatorSections.classList.toggle("hidden", isSavedMode || isAskCreditMode);
  savedSection.classList.toggle("hidden", !isSavedMode);
  askCreditSection.classList.toggle("hidden", !isAskCreditMode);
  commentFields.classList.toggle("hidden", safeMode !== COMMENT_MODE);
  postFields.classList.toggle("hidden", safeMode !== POST_MODE);
  promoOptions.classList.toggle("hidden", safeMode !== COMMENT_MODE);

  formKicker.textContent = config.formKicker;
  formTitle.textContent = config.formTitle;
  outputKicker.textContent = config.outputKicker;
  outputTitle.textContent = config.outputTitle;
  submitButton.textContent = config.submitLabel;
  submitAllButton.textContent = config.submitAllLabel;
  queueButton.textContent = config.queueLabel;
  queueAllButton.textContent = config.queueAllLabel;

  renderSourceContext(null, safeMode);

  if (shouldResetOutput && !isSavedMode && !isAskCreditMode) {
    renderEmpty(config.emptyResults);
  }

  if (isSavedMode) {
    loadSavedItems();
    return;
  }

  if (isAskCreditMode) {
    loadAskCreditItems();
    return;
  }

  setStatus("", safeMode);
}

function collectPayload(generationMode) {
  const formData = new FormData(form);
  const contentMode = getSafeContentMode(formData.get("contentMode"));

  return {
    contentMode,
    postText: formData.get("postText"),
    redditUrl: formData.get("redditUrl"),
    targetKeyword: formData.get("targetKeyword"),
    sourceTitle: formData.get("sourceTitle"),
    sourcePost: formData.get("sourcePost"),
    personaId: formData.get("personaId"),
    promoCreditClub: contentMode === COMMENT_MODE && formData.get("promoCreditClub") === "on",
    promoCreditBooster: contentMode === COMMENT_MODE && formData.get("promoCreditBooster") === "on",
    generateAllPersonas: generationMode === "all-personas",
  };
}

function fillFormFromEntry(entry) {
  const sanitizedEntry = sanitizeHistoryEntry(entry);
  const contentMode = getSafeContentMode(sanitizedEntry.contentMode);

  setContentMode(contentMode, { resetOutput: false });

  document.getElementById("post-text").value = sanitizedEntry.postText || "";
  document.getElementById("reddit-url").value = sanitizedEntry.redditUrl || "";
  document.getElementById("target-keyword").value = sanitizedEntry.targetKeyword || "";
  document.getElementById("source-title").value = sanitizedEntry.sourceTitle || "";
  document.getElementById("source-post").value = sanitizedEntry.sourcePost || "";
  personaSelect.value = sanitizedEntry.personaId || "alex-moreno";
  promoCreditClubCheckbox.checked = Boolean(sanitizedEntry.promoCreditClub);
  promoCreditBoosterCheckbox.checked = Boolean(sanitizedEntry.promoCreditBooster);

  renderSourceContext(sanitizedEntry.sourceContext || null, contentMode);
  renderOutputs(sanitizedEntry.replies || [], contentMode, sanitizedEntry.generationMode);
  setStatus("Loaded from history.");
}

function renderHistory() {
  const history = getHistory();

  if (!history.length) {
    historyNode.classList.add("empty");
    historyNode.innerHTML = "<p>Your latest generations will be saved here on this device.</p>";
    clearHistoryButton.disabled = true;
    return;
  }

  historyNode.classList.remove("empty");
  clearHistoryButton.disabled = false;
  historyNode.innerHTML = "";

  history.forEach((entry) => {
    const sanitizedEntry = sanitizeHistoryEntry(entry);
    const contentMode = getSafeContentMode(sanitizedEntry.contentMode);
    const card = document.createElement("article");
    card.className = "history-card";

    const snippet = getHistorySnippet(sanitizedEntry);
    const personaLabel = getPersonaLabel(sanitizedEntry.personaId || "alex-moreno");
    const repliesMarkup = (sanitizedEntry.replies || [])
      .map((output, index) => {
        const label = escapeHtml(getOutputDisplayLabel(output, index, sanitizedEntry));
        const titleMarkup = output?.title
          ? `<span class="history-output-title">${escapeHtml(output.title)}</span>`
          : "";
        const text = escapeHtml(output?.text || "");
        return `<p class="history-reply"><strong>${label}</strong>${titleMarkup}<br />${text}</p>`;
      })
      .join("");
    const modeLabel = sanitizedEntry.generationMode === "all-personas" ? "All personas" : personaLabel;
    const sourceTag = contentMode === POST_MODE
      ? "Посты"
      : contentMode === ASK_CREDIT_MODE
        ? "Persona profile"
      : sanitizedEntry.redditUrl
        ? "Reddit URL"
        : "Manual text";
    const historyCopyLabel = contentMode === POST_MODE
      ? "posts"
      : contentMode === ASK_CREDIT_MODE
        ? "questions"
        : "replies";
    const historyCopiedLabel = contentMode === POST_MODE
      ? "Posts"
      : contentMode === ASK_CREDIT_MODE
        ? "Questions"
        : "Replies";

    card.innerHTML = `
      <div class="history-meta">
        <span class="history-tag">${escapeHtml(getContentModeLabel(contentMode))}</span>
        <span class="history-tag">${escapeHtml(modeLabel)}</span>
        <span class="history-tag">${escapeHtml(sourceTag)}</span>
        <span class="history-tag">${escapeHtml(formatOutputCount((sanitizedEntry.replies || []).length || 0, contentMode))}</span>
        ${contentMode === COMMENT_MODE && sanitizedEntry.promoCreditClub ? '<span class="history-tag">Soft Promo Credit Club</span>' : ""}
        ${contentMode === COMMENT_MODE && sanitizedEntry.promoCreditBooster ? '<span class="history-tag">Soft Promo Credit Booster Ai</span>' : ""}
        ${contentMode === POST_MODE && sanitizedEntry.targetKeyword ? `<span class="history-tag">${escapeHtml(sanitizedEntry.targetKeyword)}</span>` : ""}
        <span class="history-tag">${escapeHtml(formatDate(sanitizedEntry.createdAt))}</span>
      </div>
      <p class="history-snippet">${escapeHtml(snippet)}${snippet.length >= 180 ? "..." : ""}</p>
      <div class="history-replies">${repliesMarkup}</div>
      <div class="history-actions">
        ${contentMode === ASK_CREDIT_MODE ? "" : '<button type="button" class="ghost use-history-button">Use again</button>'}
        <button type="button" class="ghost copy-history-button">Copy ${historyCopyLabel}</button>
      </div>
    `;

    const useHistoryButton = card.querySelector(".use-history-button");
    if (useHistoryButton) {
      useHistoryButton.addEventListener("click", () => {
        fillFormFromEntry(sanitizedEntry);
      });
    }

    card.querySelector(".copy-history-button").addEventListener("click", async (event) => {
      try {
        const combinedOutputs = (sanitizedEntry.replies || [])
          .map((output, index) => {
            const label = getOutputDisplayLabel(output, index, sanitizedEntry);
            const copyTextValue = buildOutputCopyText(output, contentMode);
            return sanitizedEntry.generationMode === "all-personas"
              ? `${label}\n${copyTextValue}`
              : copyTextValue;
          })
          .filter(Boolean)
          .join("\n\n");
        await copyText(combinedOutputs);
        flashCopied(event.currentTarget, "Copied");
        setStatus(`${historyCopiedLabel} from history copied.`);
      } catch (error) {
        setStatus(error.message || "Copy failed.");
      }
    });

    historyNode.append(card);
  });
}

function pushHistoryEntry(entry) {
  const history = getHistory();
  history.unshift(sanitizeHistoryEntry(entry));
  const saved = saveHistory(history);
  renderHistory();
  return saved;
}

function renderOutputs(outputs, contentMode = contentModeInput.value, generationMode = "single") {
  const normalizedOutputs = sanitizeOutputs(outputs);
  const safeMode = getSafeContentMode(contentMode);
  results.classList.remove("empty");
  results.innerHTML = "";

  normalizedOutputs.forEach((output, index) => {
    const card = document.createElement("article");
    card.className = "reply-card";

    const labelText = getOutputDisplayLabel(output, index, {
      contentMode: safeMode,
      generationMode,
    });

    if (output?.personaName) {
      const label = document.createElement("div");
      label.className = "reply-label";
      label.textContent = labelText;
      card.append(label);
    }

    if (safeMode === POST_MODE && output?.title) {
      const title = document.createElement("h3");
      title.className = "reply-title";
      title.textContent = output.title;
      card.append(title);
    }

    const text = document.createElement("p");
    text.textContent = output.text || "";

    const actions = document.createElement("div");
    actions.className = "reply-actions";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "ghost";
    copyButton.textContent = output?.personaName
      ? `Copy ${labelText}`
      : safeMode === POST_MODE
        ? "Copy post"
        : safeMode === ASK_CREDIT_MODE
          ? "Copy question"
        : "Copy comment";
    copyButton.addEventListener("click", async (event) => {
      try {
        await copyText(buildOutputCopyText(output, safeMode));
        flashCopied(event.currentTarget, "Copied");
        setStatus(`${labelText} copied.`);
      } catch (error) {
        setStatus(error.message || "Copy failed.");
      }
    });

    actions.append(copyButton);
    card.append(text, actions);
    results.append(card);
  });
}

function renderEmpty(message) {
  results.classList.add("empty");
  results.innerHTML = "";
  const text = document.createElement("p");
  text.textContent = message;
  results.append(text);
}

function renderQueueEmpty(message) {
  queueJobsNode.classList.add("empty");
  queueJobsNode.innerHTML = `<p>${escapeHtml(message)}</p>`;
}

function formatQueueStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();

  if (normalized === "processing") {
    return "Processing";
  }

  if (normalized === "completed") {
    return "Completed";
  }

  if (normalized === "failed") {
    return "Failed";
  }

  return "Queued";
}

function getQueueJobSnippet(job) {
  if (job.contentMode === POST_MODE) {
    return job.sourceTitle || job.sourcePreview || "Queued post rewrite";
  }

  if (job.contentMode === ASK_CREDIT_MODE) {
    return job.sourcePreview || "Queued Ask Credit question";
  }

  return job.sourcePreview || job.sourceLink || "Queued comment generation";
}

function renderQueueJobs(jobs) {
  const normalizedJobs = Array.isArray(jobs) ? jobs : [];

  if (!normalizedJobs.length) {
    renderQueueEmpty("No queued jobs yet. Add links or posts to the queue and keep moving.");
    return;
  }

  queueJobsNode.classList.remove("empty");
  queueJobsNode.innerHTML = "";

  normalizedJobs.forEach((job) => {
    const card = document.createElement("article");
    card.className = "history-card queue-job-card";
    const personaLabel = job.generationMode === "all-personas"
      ? "All personas"
      : job.personaName || getPersonaLabel(job.personaId || "alex-moreno");
    const snippet = getQueueJobSnippet(job);
    const sourceLine = job.sourceLink
      ? `<a class="source-link" href="${escapeHtml(job.sourceLink)}" target="_blank" rel="noreferrer">Open source</a>`
      : "";

    card.innerHTML = `
      <div class="history-meta">
        <span class="history-tag queue-status queue-status-${escapeHtml(job.status)}">${escapeHtml(formatQueueStatus(job.status))}</span>
        <span class="history-tag">${escapeHtml(getContentModeLabel(job.contentMode))}</span>
        <span class="history-tag">${escapeHtml(personaLabel)}</span>
        <span class="history-tag">${escapeHtml(formatDate(job.createdAt))}</span>
        ${job.targetKeyword ? `<span class="history-tag">${escapeHtml(job.targetKeyword)}</span>` : ""}
        ${job.savedItemsCount ? `<span class="history-tag">${escapeHtml(`${job.savedItemsCount} saved`)}</span>` : ""}
      </div>
      <p class="history-snippet">${escapeHtml(snippet)}</p>
      ${sourceLine ? `<div class="queue-source-link">${sourceLine}</div>` : ""}
      ${job.errorMessage ? `<p class="queue-error">${escapeHtml(job.errorMessage)}</p>` : ""}
      <div class="history-actions queue-actions">
        ${job.status === "completed" ? '<button type="button" class="ghost open-saved-button">Open saved</button>' : ""}
      </div>
    `;

    const openSavedButton = card.querySelector(".open-saved-button");
    if (openSavedButton) {
      openSavedButton.addEventListener("click", () => {
        setContentMode(SAVED_MODE);
      });
    }

    queueJobsNode.append(card);
  });
}

function renderSavedEmpty(container, message) {
  container.classList.add("empty");
  container.innerHTML = `<p>${escapeHtml(message)}</p>`;
}

function buildSavedSourceMarkup(item) {
  const sourceLabel = item.sourceTitle || item.sourcePreview || "No source";

  if (item.sourceLink) {
    return `
      <a class="saved-link" href="${escapeHtml(item.sourceLink)}" target="_blank" rel="noreferrer">${escapeHtml(sourceLabel)}</a>
      <div class="saved-source-meta">${escapeHtml(item.sourceLink)}</div>
    `;
  }

  return `
    <span class="saved-source-text">${escapeHtml(sourceLabel)}</span>
  `;
}

function buildSavedOutputMarkup(item) {
  const titleMarkup = item.outputTitle
    ? `<div class="saved-output-title">${escapeHtml(item.outputTitle)}</div>`
    : "";
  const buttonLabel = item.contentMode === POST_MODE
    ? "Скопировать пост"
    : item.contentMode === ASK_CREDIT_MODE
      ? "Скопировать вопрос"
      : "Скопировать комментарий";

  return `
    ${titleMarkup}
    <div class="saved-output-text">${escapeHtml(item.outputText || "")}</div>
    <div class="saved-output-actions">
      <button type="button" class="ghost saved-copy-button" data-saved-id="${escapeHtml(item.id)}">${escapeHtml(buttonLabel)}</button>
    </div>
  `;
}

function getCopiedStatusMessage(contentMode) {
  if (contentMode === POST_MODE) {
    return "Пост скопирован.";
  }

  if (contentMode === ASK_CREDIT_MODE) {
    return "Вопрос скопирован.";
  }

  return "Комментарий скопирован.";
}

function renderSavedTable(container, items, options = {}) {
  const normalizedItems = Array.isArray(items) ? items.map(sanitizeSavedItem) : [];
  const statusFilterNode = options.statusFilterNode || null;
  const reload = typeof options.reload === "function" ? options.reload : null;
  const statusMode = options.statusMode || contentModeInput.value;

  if (!normalizedItems.length) {
    renderSavedEmpty(container, options.emptyMessage || "По текущим фильтрам ничего не найдено.");
    return;
  }

  container.classList.remove("empty");
  container.innerHTML = `
    <div class="saved-record-list">
      ${normalizedItems
        .map(
          (item) => `
            <article class="saved-record" data-saved-id="${escapeHtml(item.id)}">
              <div class="saved-record-head">
                <div class="saved-record-meta">
                  <div class="saved-date-block">
                    <span class="saved-meta-label">Дата</span>
                    <span class="saved-date-value">${escapeHtml(formatDate(item.createdAt))}</span>
                  </div>
                  <div class="saved-persona-block">
                    <span class="saved-meta-label">Персонаж</span>
                    <span class="saved-persona-name">${escapeHtml(item.personaName || getPersonaLabel(item.personaId))}</span>
                  </div>
                  <span class="saved-type">${escapeHtml(getContentModeLabel(item.contentMode))}</span>
                </div>
                <div class="saved-status-block">
                  <span class="saved-meta-label">Статус</span>
                  <select class="saved-status-select" data-saved-id="${escapeHtml(item.id)}">
                    <option value="new"${item.status === "new" ? " selected" : ""}>Новый</option>
                    <option value="published"${item.status === "published" ? " selected" : ""}>Опубликованный</option>
                  </select>
                </div>
              </div>

              <div class="saved-record-grid">
                <section class="saved-pane saved-source-pane">
                  <p class="saved-pane-title">Источник</p>
                  ${buildSavedSourceMarkup(item)}
                </section>
                <section class="saved-pane saved-output-pane">
                  <p class="saved-pane-title">Сгенерированный текст</p>
                  ${buildSavedOutputMarkup(item)}
                </section>
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;

  container.querySelectorAll(".saved-status-select").forEach((select) => {
    select.addEventListener("change", async (event) => {
      const target = event.currentTarget;
      const originalValue = target.dataset.currentValue || target.defaultValue || "new";
      const nextValue = target.value;
      target.disabled = true;

      try {
        const response = await fetch(`/api/saved/${encodeURIComponent(target.dataset.savedId)}/status`, {
          method: "PATCH",
          headers: buildJsonHeaders(),
          body: JSON.stringify({ status: nextValue }),
        });

        const data = await readJsonResponse(response);

        if (!response.ok) {
          throw new Error(data?.error || "Не удалось обновить статус.");
        }

        target.dataset.currentValue = nextValue;
        target.defaultValue = nextValue;
        if (statusFilterNode && (statusFilterNode.value || "all") !== "all" && statusFilterNode.value !== nextValue) {
          await reload?.({ silentStatus: true });
        }
        setStatus("Статус сохраненной записи обновлен.", statusMode);
      } catch (error) {
        target.value = originalValue;
        setStatus(error.message || "Не удалось обновить статус.", statusMode);
      } finally {
        target.disabled = false;
      }
    });

    select.dataset.currentValue = select.value;
  });

  container.querySelectorAll(".saved-copy-button").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const target = event.currentTarget;
      const card = target.closest(".saved-record");
      const savedId = card?.dataset.savedId || target.dataset.savedId;
      const item = normalizedItems.find((candidate) => candidate.id === savedId);

      if (!item) {
        setStatus("Не удалось найти текст для копирования.", statusMode);
        return;
      }

      try {
        const textToCopy = item.contentMode === POST_MODE
          ? `${item.outputTitle || ""}\n\n${item.outputText || ""}`.trim()
          : String(item.outputText || "");
        await copyText(textToCopy);
        flashCopied(target, "Скопировано");
        setStatus(getCopiedStatusMessage(item.contentMode), statusMode);
      } catch (error) {
        setStatus(error.message || "Копирование не сработало.", statusMode);
      }
    });
  });
}

async function loadLibraryItems(config, options = {}) {
  const silentStatus = Boolean(options.silentStatus);
  config.wrapNode.classList.add("empty");
  config.wrapNode.innerHTML = `<p>${escapeHtml(config.loadingMessage)}</p>`;

  try {
    const query = new URLSearchParams();
    query.set("personaId", config.personaFilterNode.value || "all");
    query.set("status", config.statusFilterNode.value || "all");
    query.set("contentMode", config.contentMode);

    const response = await fetch(`/api/saved?${query.toString()}`, {
      headers: {},
    });
    const data = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(data?.error || config.failureMessage);
    }

    renderSavedTable(config.wrapNode, data?.items || [], {
      emptyMessage: config.emptyMessage,
      reload: config.reload,
      statusFilterNode: config.statusFilterNode,
      statusMode: config.statusMode,
    });
    if (!silentStatus) {
      setStatus(config.successMessage, config.statusMode);
    }
  } catch (error) {
    renderSavedEmpty(config.wrapNode, error.message || config.failureMessage);
    if (!silentStatus) {
      setStatus(config.failureMessage, config.statusMode);
    }
  }
}

async function loadSavedItems(options = {}) {
  return loadLibraryItems({
    wrapNode: savedTableWrap,
    personaFilterNode: savedPersonaFilter,
    statusFilterNode: savedStatusFilter,
    contentMode: `${COMMENT_MODE},${POST_MODE}`,
    loadingMessage: "Загружаю сохраненные записи...",
    successMessage: "Сохраненные записи загружены.",
    failureMessage: "Не удалось загрузить сохраненные записи.",
    emptyMessage: "По текущим фильтрам ничего не найдено.",
    reload: loadSavedItems,
    statusMode: SAVED_MODE,
  }, options);
}

async function loadAskCreditItems(options = {}) {
  return loadLibraryItems({
    wrapNode: askCreditTableWrap,
    personaFilterNode: askCreditPersonaFilter,
    statusFilterNode: askCreditStatusFilter,
    contentMode: ASK_CREDIT_MODE,
    loadingMessage: "Загружаю вопросы Ask Credit...",
    successMessage: "Вопросы Ask Credit загружены.",
    failureMessage: "Не удалось загрузить вопросы Ask Credit.",
    emptyMessage: "По текущим фильтрам нет вопросов Ask Credit.",
    reload: loadAskCreditItems,
    statusMode: ASK_CREDIT_MODE,
  }, options);
}

async function loadQueueJobs(options = {}) {
  const silentStatus = Boolean(options.silentStatus);

  try {
    const response = await fetch("/api/queue?limit=24", {
      headers: {},
    });
    const data = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(data?.error || "Could not load queue.");
    }

    renderQueueJobs(data?.jobs || []);
    if (!silentStatus) {
      setStatus("Queue updated.");
    }
  } catch (error) {
    renderQueueEmpty(error.message || "Could not load queue.");
    if (!silentStatus) {
      setStatus("Queue failed to load.");
    }
  }
}

async function enqueueGeneration(generationMode) {
  const payload = collectPayload(generationMode);

  try {
    const response = await fetch("/api/generate-async", {
      method: "POST",
      headers: buildJsonHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(data?.error || "Could not add generation to queue.");
    }

    await loadQueueJobs({ silentStatus: true });
    setStatus(
      generationMode === "all-personas"
        ? "Added all 10 personas to the background queue."
        : "Added to the background queue.",
    );
  } catch (error) {
    setStatus(error.message || "Could not add generation to queue.");
  }
}

function syncAccessTokenInputs(changedInput) {
  const nextValue = String(changedInput?.value || "");

  accessTokenInputs.forEach((input) => {
    if (input !== changedInput && input.value !== nextValue) {
      input.value = nextValue;
    }
  });
}

function buildAskCreditPayload(generationMode) {
  return {
    contentMode: ASK_CREDIT_MODE,
    personaId: askCreditPersonaSelect.value || "alex-moreno",
    generateAllPersonas: generationMode === "all-personas",
  };
}

async function generateAskCredit(generationMode) {
  const payload = buildAskCreditPayload(generationMode);

  askCreditGenerateButton.disabled = true;
  askCreditGenerateAllButton.disabled = true;
  askCreditTableWrap.classList.add("empty");
  askCreditTableWrap.innerHTML = `<p>${escapeHtml(
    generationMode === "all-personas"
      ? "Generating Ask Credit questions for all 10 personas..."
      : "Generating Ask Credit question...",
  )}</p>`;

  setStatus(
    generationMode === "all-personas"
      ? "Generating Ask Credit questions for all 10 personas..."
      : `Generating Ask Credit question for ${getPersonaLabel(payload.personaId)}...`,
    ASK_CREDIT_MODE,
  );

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: buildJsonHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(data?.error || "Не удалось сгенерировать вопрос Ask Credit.");
    }

    askCreditPersonaFilter.value = generationMode === "all-personas" ? "all" : payload.personaId;
    if ((askCreditStatusFilter.value || "all") === "published") {
      askCreditStatusFilter.value = "all";
    }

    await loadAskCreditItems({ silentStatus: true });
    const saveSuffix = data?.savedItemsError
      ? " Сохранение в общую библиотеку не сработало."
      : data?.savedItemsCount > 0
        ? " Сразу добавлено в таблицу ниже."
        : "";

    setStatus(
      generationMode === "all-personas"
        ? `Вопросы Ask Credit для всех 10 персонажей готовы.${saveSuffix}`
        : `Вопрос Ask Credit для ${getPersonaLabel(payload.personaId)} готов.${saveSuffix}`,
      ASK_CREDIT_MODE,
    );
  } catch (error) {
    renderSavedEmpty(askCreditTableWrap, error.message || "Не удалось сгенерировать вопрос Ask Credit.");
    setStatus(error.message || "Не удалось сгенерировать вопрос Ask Credit.", ASK_CREDIT_MODE);
  } finally {
    askCreditGenerateButton.disabled = false;
    askCreditGenerateAllButton.disabled = false;
  }
}

function startQueuePolling() {
  if (queuePollTimer) {
    window.clearInterval(queuePollTimer);
  }

  queuePollTimer = window.setInterval(() => {
    loadQueueJobs({ silentStatus: true });
  }, QUEUE_POLL_INTERVAL_MS);
}

async function readJsonResponse(response) {
  if (typeof response?.text === "function") {
    const rawText = await response.text();
    if (!rawText) {
      return null;
    }

    try {
      return JSON.parse(rawText);
    } catch {
      return null;
    }
  }

  if (typeof response?.json === "function") {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  return null;
}

clearHistoryButton.addEventListener("click", () => {
  window.localStorage.removeItem(HISTORY_KEY);
  renderHistory();
  setStatus("History cleared.");
});

promoCreditClubCheckbox.addEventListener("change", () => {
  syncPromoSelection(promoCreditClubCheckbox, promoCreditBoosterCheckbox);
});

promoCreditBoosterCheckbox.addEventListener("change", () => {
  syncPromoSelection(promoCreditBoosterCheckbox, promoCreditClubCheckbox);
});

accessTokenInputs.forEach((input) => {
  input.addEventListener("input", (event) => {
    syncAccessTokenInputs(event.currentTarget);
  });
});

modeTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setContentMode(tab.dataset.mode);
  });
});

savedPersonaFilter.addEventListener("change", () => {
  if (getSafeContentMode(contentModeInput.value) === SAVED_MODE) {
    loadSavedItems();
  }
});

savedStatusFilter.addEventListener("change", () => {
  if (getSafeContentMode(contentModeInput.value) === SAVED_MODE) {
    loadSavedItems();
  }
});

refreshSavedButton.addEventListener("click", () => {
  loadSavedItems();
});

askCreditPersonaFilter.addEventListener("change", () => {
  if (getSafeContentMode(contentModeInput.value) === ASK_CREDIT_MODE) {
    loadAskCreditItems();
  }
});

askCreditStatusFilter.addEventListener("change", () => {
  if (getSafeContentMode(contentModeInput.value) === ASK_CREDIT_MODE) {
    loadAskCreditItems();
  }
});

refreshAskCreditButton.addEventListener("click", () => {
  loadAskCreditItems();
});

refreshQueueButton.addEventListener("click", () => {
  loadQueueJobs();
});

logoutButton?.addEventListener("click", async () => {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: buildJsonHeaders(),
    });
  } catch (_error) {
    // Redirect regardless so the session is effectively dropped in the browser flow.
  }

  window.location.assign("/login");
});

queueButton.addEventListener("click", () => {
  enqueueGeneration("single");
});

queueAllButton.addEventListener("click", () => {
  enqueueGeneration("all-personas");
});

askCreditGenerateButton.addEventListener("click", () => {
  generateAskCredit("single");
});

askCreditGenerateAllButton.addEventListener("click", () => {
  generateAskCredit("all-personas");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const generationMode = event.submitter?.value === "all-personas" ? "all-personas" : "single";
  const payload = collectPayload(generationMode);
  const contentMode = payload.contentMode;
  const hasRedditUrl = contentMode === COMMENT_MODE && String(payload.redditUrl || "").trim().length > 0;
  const modeConfig = getModeConfig(contentMode);

  submitButton.disabled = true;
  submitAllButton.disabled = true;

  setStatus(
    contentMode === POST_MODE
      ? generationMode === "all-personas"
        ? modeConfig.generatingAll
        : modeConfig.generatingSingle
      : hasRedditUrl
        ? generationMode === "all-personas"
          ? "Fetching Reddit post and generating all 10 personas..."
          : "Fetching Reddit post and generating comment..."
        : generationMode === "all-personas"
          ? modeConfig.generatingAll
          : modeConfig.generatingSingle,
  );

  renderSourceContext(null, contentMode);
  renderEmpty(
    contentMode === POST_MODE
      ? generationMode === "all-personas"
        ? "Generating 10 persona posts..."
        : "Building your rewritten post..."
      : hasRedditUrl
        ? "Fetching Reddit post..."
        : generationMode === "all-personas"
          ? "Generating all 10 personas..."
          : "Working on it...",
  );

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: buildJsonHeaders(),
      body: JSON.stringify(payload),
    });

    const data = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(data?.error || "Request failed.");
    }

    if (!data || !Array.isArray(data.replies)) {
      throw new Error("Unexpected server response.");
    }

    const sanitizedOutputs = sanitizeOutputs(data.replies);
    renderSourceContext(data.sourceContext || null, contentMode);
    renderOutputs(sanitizedOutputs, data.contentMode || contentMode, data.generationMode || generationMode);
    const historySaved = pushHistoryEntry({
      createdAt: new Date().toISOString(),
      contentMode,
      generationMode,
      postText: String(payload.postText || ""),
      redditUrl: String(payload.redditUrl || ""),
      targetKeyword: String(payload.targetKeyword || ""),
      sourceTitle: String(payload.sourceTitle || ""),
      sourcePost: String(payload.sourcePost || ""),
      personaId: String(payload.personaId || "alex-moreno"),
      promoCreditClub: Boolean(payload.promoCreditClub),
      promoCreditBooster: Boolean(payload.promoCreditBooster),
      sourceContext: data.sourceContext || null,
      replies: sanitizedOutputs,
    });

    const saveSuffix = data.savedItemsError
      ? " Общая библиотека сохранений не обновилась."
      : data.savedItemsCount > 0
        ? " Сохранено в общий раздел."
        : "";

    setStatus(
      historySaved
        ? generationMode === "all-personas"
          ? `${modeConfig.successAll}${saveSuffix}`
          : `${modeConfig.successSingle}${saveSuffix}`
        : generationMode === "all-personas"
          ? `${modeConfig.successAll} History could not be saved on this device.${saveSuffix}`
          : `${modeConfig.successSingle} History could not be saved on this device.${saveSuffix}`,
    );
  } catch (error) {
    renderEmpty(error.message || "Something went wrong.");
    setStatus("Generation failed.");
  } finally {
    submitButton.disabled = false;
    submitAllButton.disabled = false;
  }
});

renderHistory();
setContentMode(contentModeInput.value, { resetOutput: true });
loadQueueJobs({ silentStatus: true });
startQueuePolling();
