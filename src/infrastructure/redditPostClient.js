const SUPPORTED_REDDIT_HOSTS = new Set([
  "reddit.com",
  "www.reddit.com",
  "old.reddit.com",
  "new.reddit.com",
  "sh.reddit.com",
  "np.reddit.com",
  "redd.it",
  "www.redd.it",
]);

class RedditPostClientError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "RedditPostClientError";
    this.status = options.status ?? 400;
    this.code = options.code || "reddit_post_error";
  }
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeRedditUrl(rawUrl) {
  let parsedUrl;

  try {
    parsedUrl = new URL(String(rawUrl || "").trim());
  } catch {
    throw new RedditPostClientError("Reddit post URL is invalid.", {
      status: 400,
      code: "invalid_reddit_url",
    });
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (!SUPPORTED_REDDIT_HOSTS.has(hostname)) {
    throw new RedditPostClientError("Only Reddit post URLs are supported here.", {
      status: 400,
      code: "unsupported_reddit_url",
    });
  }

  return parsedUrl;
}

function extractRedditPostId(rawUrl) {
  const parsedUrl = normalizeRedditUrl(rawUrl);
  const hostname = parsedUrl.hostname.toLowerCase();
  const segments = parsedUrl.pathname.split("/").filter(Boolean);

  if (hostname.endsWith("redd.it")) {
    const shortId = segments[0];
    if (shortId) {
      return shortId;
    }
  }

  const commentsIndex = segments.findIndex((segment) => segment === "comments");
  if (commentsIndex !== -1 && segments[commentsIndex + 1]) {
    return segments[commentsIndex + 1];
  }

  throw new RedditPostClientError("Could not find a Reddit post id in that URL.", {
    status: 400,
    code: "invalid_reddit_url",
  });
}

function isImageUrl(url) {
  return /\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(String(url || ""));
}

function extractGalleryImageUrl(post) {
  const firstGalleryItem = post?.gallery_data?.items?.[0];
  const mediaId = firstGalleryItem?.media_id;
  const media = mediaId ? post?.media_metadata?.[mediaId] : null;
  const sourceUrl = media?.s?.u || media?.p?.[media?.p?.length - 1]?.u;

  return sourceUrl ? decodeHtml(sourceUrl) : "";
}

function extractPreviewImageUrl(post) {
  const previewUrl = post?.preview?.images?.[0]?.source?.url;
  return previewUrl ? decodeHtml(previewUrl) : "";
}

function extractPrimaryImageUrl(post) {
  const directUrl = decodeHtml(post?.url_overridden_by_dest || post?.url || "");
  const galleryUrl = extractGalleryImageUrl(post);
  const previewUrl = extractPreviewImageUrl(post);

  if (galleryUrl) {
    return galleryUrl;
  }

  if (post?.post_hint === "image" && directUrl) {
    return directUrl;
  }

  if (isImageUrl(directUrl)) {
    return directUrl;
  }

  if (previewUrl) {
    return previewUrl;
  }

  return "";
}

function normalizePostPayload(post, rawUrl) {
  const title = String(post?.title || "").trim();
  const body = String(post?.selftext || "").trim();
  const imageUrl = extractPrimaryImageUrl(post);

  return {
    sourceUrl: String(rawUrl || "").trim(),
    postId: String(post?.id || "").trim(),
    permalink: post?.permalink ? `https://www.reddit.com${post.permalink}` : "",
    subreddit: String(post?.subreddit || "").trim(),
    author: String(post?.author || "").trim(),
    title,
    body,
    imageUrl,
  };
}

function createRedditPostClient({
  fetchImpl = globalThis.fetch,
  logger,
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required.");
  }

  async function fetchPostByUrl(redditUrl, { requestId } = {}) {
    const postId = extractRedditPostId(redditUrl);
    const jsonUrl = `https://www.reddit.com/comments/${postId}/.json?raw_json=1`;

    let response;
    try {
      response = await fetchImpl(jsonUrl, {
        headers: {
          "User-Agent": "RedditCommentator/1.0",
          Accept: "application/json",
        },
      });
    } catch (error) {
      logger?.warn("Failed to fetch Reddit post", {
        requestId,
        reddit_post_id: postId,
        message: error?.message || "Unknown error",
      });
      throw new RedditPostClientError("Could not fetch that Reddit post.", {
        status: 502,
        code: "reddit_fetch_failed",
      });
    }

    if (!response.ok) {
      throw new RedditPostClientError(
        response.status === 404 ? "Reddit post was not found." : "Could not fetch that Reddit post.",
        {
          status: response.status === 404 ? 404 : 502,
          code: response.status === 404 ? "reddit_post_not_found" : "reddit_fetch_failed",
        },
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new RedditPostClientError("Reddit returned an unreadable response.", {
        status: 502,
        code: "reddit_invalid_payload",
      });
    }

    const post = payload?.[0]?.data?.children?.[0]?.data;
    if (!post || typeof post !== "object") {
      throw new RedditPostClientError("Could not parse that Reddit post.", {
        status: 502,
        code: "reddit_invalid_payload",
      });
    }

    return normalizePostPayload(post, redditUrl);
  }

  return {
    extractRedditPostId,
    fetchPostByUrl,
  };
}

module.exports = {
  RedditPostClientError,
  SUPPORTED_REDDIT_HOSTS,
  createRedditPostClient,
  extractRedditPostId,
};
