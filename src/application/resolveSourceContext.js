const { RedditPostClientError } = require("../infrastructure/redditPostClient");

class SourceContextError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "SourceContextError";
    this.status = options.status ?? 400;
    this.code = options.code || "source_context_error";
  }
}

function trimToLength(value, maxLength) {
  const normalized = String(value || "").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trim()}...`;
}

function buildRedditSourcePrompt(post, imageContext = null) {
  const sections = [
    "Source type: Reddit post URL",
    `Reddit URL: ${post.sourceUrl || post.permalink || ""}`,
    `Title: ${post.title || "None"}`,
    `Post body: ${post.body || "None"}`,
  ];

  if (post.imageUrl) {
    sections.push("Image attached: yes");
    sections.push(`Image URL: ${post.imageUrl}`);
    sections.push(`What is shown in the image: ${imageContext?.imageDescription || "Image analysis unavailable."}`);
    sections.push(`Text visible in the image: ${imageContext?.imageText || "No visible text found."}`);
  } else {
    sections.push("Image attached: no");
  }

  return sections.join("\n");
}

function parseStructuredObject(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (
    typeof payload.imageDescription === "string" ||
    typeof payload.imageText === "string"
  ) {
    return payload;
  }

  const outputText = String(payload.output_text || "").trim();
  if (outputText) {
    try {
      return JSON.parse(outputText);
    } catch {
      return null;
    }
  }

  const contentBlocks = payload.output?.flatMap((item) => item?.content || []) || [];
  const text = contentBlocks
    .filter((item) => item?.type === "output_text" && item?.text)
    .map((item) => item.text)
    .join("\n")
    .trim();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function analyzeImageContext({ imageUrl, openAiClient, model, requestId, logger }) {
  if (!imageUrl) {
    return null;
  }

  try {
    const payload = await openAiClient.createStructuredMultimodalResponse({
      model,
      requestId,
      maxOutputTokens: 500,
      responseSchemaName: "reddit_image_context",
      responseSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          imageDescription: {
            type: "string",
          },
          imageText: {
            type: "string",
          },
        },
        required: ["imageDescription", "imageText"],
      },
      systemPrompt: "Analyze Reddit post images for comment writing context.",
      userText: `Look at this Reddit post image and return JSON only.
- imageDescription should briefly describe what is actually visible in the image.
- imageText should extract any readable text from the image.
- If there is no readable text, return an empty string for imageText.
- Keep imageDescription factual and concise.`,
      imageUrl,
    });

    const parsedPayload = parseStructuredObject(payload);
    const imageDescription = trimToLength(parsedPayload?.imageDescription || "", 500);
    const imageText = trimToLength(parsedPayload?.imageText || "", 1200);

    return {
      imageDescription,
      imageText,
    };
  } catch (error) {
    logger?.warn("Reddit image analysis failed", {
      requestId,
      image_url: imageUrl,
      message: error?.message || "Unknown error",
    });
    return null;
  }
}

function normalizeManualPostText(postText) {
  return trimToLength(postText, 12000);
}

async function resolveSourceContext({
  postText,
  redditUrl,
  redditPostClient,
  openAiClient,
  model,
  requestId,
  logger,
}) {
  const trimmedUrl = String(redditUrl || "").trim();
  const trimmedPostText = String(postText || "").trim();

  if (!trimmedUrl) {
    return {
      promptPostText: normalizeManualPostText(trimmedPostText),
      sourceContext: null,
    };
  }

  if (!redditPostClient) {
    throw new SourceContextError("Reddit URL resolution is not configured.", {
      status: 500,
      code: "reddit_source_unavailable",
    });
  }

  let post;
  try {
    post = await redditPostClient.fetchPostByUrl(trimmedUrl, { requestId });
  } catch (error) {
    if (error instanceof RedditPostClientError) {
      throw new SourceContextError(error.message, {
        status: error.status,
        code: error.code,
      });
    }

    throw error;
  }

  const imageContext = await analyzeImageContext({
    imageUrl: post.imageUrl,
    openAiClient,
    model,
    requestId,
    logger,
  });

  return {
    promptPostText: buildRedditSourcePrompt(post, imageContext),
    sourceContext: {
      type: "reddit-url",
      redditUrl: post.sourceUrl || trimmedUrl,
      title: post.title || "",
      body: post.body || "",
      imageUrl: post.imageUrl || "",
      imageDescription: imageContext?.imageDescription || "",
      imageText: imageContext?.imageText || "",
    },
  };
}

module.exports = {
  SourceContextError,
  resolveSourceContext,
};
