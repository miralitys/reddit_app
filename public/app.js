const form = document.getElementById("generator-form");
const results = document.getElementById("results");
const statusNode = document.getElementById("status");
const submitButton = document.getElementById("submit-button");
const submitAllButton = document.getElementById("submit-all-button");
const clearHistoryButton = document.getElementById("clear-history-button");
const historyNode = document.getElementById("history");
const sourceContextNode = document.getElementById("source-context");
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

const HISTORY_KEY = "reddit-commentator-history";
const HISTORY_LIMIT = 8;
const COMMENT_MODE = "comments";
const POST_MODE = "posts";

function getSafeContentMode(value) {
  return value === POST_MODE ? POST_MODE : COMMENT_MODE;
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setStatus(message) {
  statusNode.textContent = message;
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
  const noun = getSafeContentMode(contentMode) === POST_MODE
    ? count === 1 ? "post" : "posts"
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
      emptyResults: "Your rewritten post or full persona post batch will appear here.",
      generatingSingle: "Generating post...",
      generatingAll: "Generating 10 persona posts...",
      successSingle: "Post generated.",
      successAll: "All 10 persona posts generated.",
    };
  }

  return {
    formKicker: "Комментарии",
    formTitle: "Thread Intake",
    outputKicker: "Комментарии",
    outputTitle: "Generated comments",
    submitLabel: "Generate comment",
    submitAllLabel: "Generate all 10 personas",
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
    return getSafeContentMode(entry?.contentMode) === POST_MODE ? "Post" : "Comment";
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

  commentFields.classList.toggle("hidden", safeMode !== COMMENT_MODE);
  postFields.classList.toggle("hidden", safeMode !== POST_MODE);
  promoOptions.classList.toggle("hidden", safeMode !== COMMENT_MODE);

  formKicker.textContent = config.formKicker;
  formTitle.textContent = config.formTitle;
  outputKicker.textContent = config.outputKicker;
  outputTitle.textContent = config.outputTitle;
  submitButton.textContent = config.submitLabel;
  submitAllButton.textContent = config.submitAllLabel;

  if (safeMode !== COMMENT_MODE) {
    renderSourceContext(null, safeMode);
  } else {
    renderSourceContext(null, safeMode);
  }

  if (shouldResetOutput) {
    renderEmpty(config.emptyResults);
    setStatus("");
  }
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
      : sanitizedEntry.redditUrl
        ? "Reddit URL"
        : "Manual text";

    card.innerHTML = `
      <div class="history-meta">
        <span class="history-tag">${escapeHtml(contentMode === POST_MODE ? "Посты" : "Комментарии")}</span>
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
        <button type="button" class="ghost use-history-button">Use again</button>
        <button type="button" class="ghost copy-history-button">Copy ${contentMode === POST_MODE ? "posts" : "replies"}</button>
      </div>
    `;

    card.querySelector(".use-history-button").addEventListener("click", () => {
      fillFormFromEntry(sanitizedEntry);
    });

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
        setStatus(`${contentMode === POST_MODE ? "Posts" : "Replies"} from history copied.`);
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

modeTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setContentMode(tab.dataset.mode);
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const contentMode = getSafeContentMode(formData.get("contentMode"));
  const generationMode = event.submitter?.value === "all-personas" ? "all-personas" : "single";
  const payload = {
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
  const accessToken = String(formData.get("accessToken") || "").trim();
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
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { "x-app-access-token": accessToken } : {}),
      },
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
    setStatus(
      historySaved
        ? generationMode === "all-personas"
          ? modeConfig.successAll
          : modeConfig.successSingle
        : generationMode === "all-personas"
          ? `${modeConfig.successAll} History could not be saved on this device.`
          : `${modeConfig.successSingle} History could not be saved on this device.`,
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
