const { extractReplies, stripQuotes } = require("./replyRules");

class PostContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "PostContractError";
  }
}

function countWords(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function countRegex(text, regex) {
  return (String(text || "").match(regex) || []).length;
}

function analyzeSourcePost(sourcePost, keyword) {
  const text = String(sourcePost || "").trim();
  const lower = text.toLowerCase();
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const wordCount = countWords(text);
  const questionCount = countRegex(text, /\?/g);
  const firstPersonCount = countRegex(lower, /\b(i|im|ive|id|me|my|mine)\b/g);
  const secondPersonCount = countRegex(lower, /\b(you|your|youre)\b/g);
  const usesBullets = /^\s*([-*•]|\d+\.)\s+/m.test(text);
  const usesHeadings = /^\s{0,3}#{1,6}\s+|^[A-Z][A-Za-z0-9 ,/&()-]{2,}:\s*$/m.test(text);
  const asksForHelp = questionCount > 0 || /\b(anyone|someone|please message me|what should i do|can somebody|can someone|need help|fresh start)\b/i.test(text);
  const exactKeywordOccurrences = keyword
    ? countRegex(text.toLowerCase(), new RegExp(keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))
    : 0;

  const structureRules = [];

  structureRules.push(`- Source length is about ${wordCount} words.`);
  structureRules.push(`- Source paragraph count is ${paragraphs.length || 1}. Stay close to that unless there is a very strong reason not to.`);

  if (usesBullets) {
    structureRules.push("- The source uses list formatting. Preserve a list-like structure.");
  } else {
    structureRules.push("- The source does not use list formatting. Do not suddenly turn it into bullets.");
  }

  if (usesHeadings) {
    structureRules.push("- The source uses section-like formatting. Stay close to that structure.");
  } else {
    structureRules.push("- The source does not use headings. Do not introduce bloggy headings.");
  }

  if (firstPersonCount > secondPersonCount) {
    structureRules.push("- The source is mainly first person. Keep the rewrite in first person.");
  }

  if (asksForHelp) {
    structureRules.push("- The source is asking for help or a way out. Keep that posture. Do not switch into adviser voice.");
  }

  if (wordCount <= 140) {
    structureRules.push("- The source is short. Keep the rewrite short too. Do not inflate it into a guide, explainer, or mini article.");
  } else if (wordCount <= 320) {
    structureRules.push("- The source is medium length. Stay in roughly the same size range.");
  } else {
    structureRules.push("- The source is already article-like. Keep it article-like, but still close to the original size.");
  }

  if (exactKeywordOccurrences === 0) {
    structureRules.push("- The exact keyword is not strongly present in the source body. Work it in lightly and naturally, not mechanically.");
  } else {
    structureRules.push(`- The source body already uses the exact keyword about ${exactKeywordOccurrences} time(s). Match or slightly improve that naturally.`);
  }

  return {
    wordCount,
    structureRules: structureRules.join("\n"),
  };
}

function buildSinglePostResponseSchema(postCount) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      replies: {
        type: "array",
        minItems: postCount,
        maxItems: postCount,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: {
              type: "string",
            },
            text: {
              type: "string",
            },
          },
          required: ["title", "text"],
        },
      },
    },
    required: ["replies"],
  };
}

function buildAllPersonasPostResponseSchema(personas) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      replies: {
        type: "array",
        minItems: personas.length,
        maxItems: personas.length,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            personaId: {
              type: "string",
              enum: personas.map((persona) => persona.id),
            },
            title: {
              type: "string",
            },
            text: {
              type: "string",
            },
          },
          required: ["personaId", "title", "text"],
        },
      },
    },
    required: ["replies"],
  };
}

function buildPostUserPrompt({ keyword, sourceTitle, sourcePost, persona, postCount }) {
  const sourceAnalysis = analyzeSourcePost(sourcePost, keyword);
  const schemaExample = `{"replies":[${Array.from({ length: postCount }, () => `{"title":"${sourceTitle.replace(/"/g, "")}","text":"..."}`).join(",")}]}`
  ;

  return `Analyze the source post below and rewrite it into ${postCount} original search-focused post variant(s).

Selected persona:
${persona.instruction}

Post mode rules:
- This is post mode, not comment mode.
- Keep the exact title unchanged. Do not improve it, shorten it, or rewrite it.
- The title must stay exactly: ${sourceTitle}
- Rewrite the body into a fresh original post instead of doing sentence by sentence paraphrasing.
- Keep the same main topic and search intent as the source post.
- Preserve the original structure as closely as possible.
- Keep the same order of ideas unless a small change clearly improves readability.
- If the source uses short sections, bullets, a quick answer opening, or a certain paragraph rhythm, stay close to that format.
- Do not turn the rewrite into a freer article with a different architecture.
- Target this exact keyword naturally in the body: ${keyword}
- Keep the keyword in at least the same important positions as the source or slightly better.
- Make the keyword visible early in the post if it fits naturally.
- Keep keyword coverage strong, but never stuffed or repetitive.
- Keep the writing useful, specific, and human.
- Persona should change voice and rhythm, not destroy the source structure.
- Do not mention SEO, Google, ranking, traffic, or optimization inside the post.
- Keep the persona voice, rhythm, skepticism, and imperfections, but keep the source article blueprint recognizable.
- Keep the rewrite close to the original size. Do not massively expand a short source post.

Source structure signals:
${sourceAnalysis.structureRules}

Requirements:
- Return valid JSON only.
- Use this exact schema: ${schemaExample}.
- The replies array must contain exactly ${postCount} items.
- Each item must contain only title and text.
- Every title must exactly match the source title with no changes.
- The body text must be in English only.
- The body text must feel original, useful, and human, not like AI SEO filler.
- The body text must read like a rewrite of this specific source post, not just a new post on the same keyword.
- Do not switch point of view, content role, or post type.
- If the source sounds like a person asking for help, the rewrite must still sound like a person asking for help.
- If the source sounds personal, keep it personal.
- If the source is short, keep it short.
- Do not include labels, numbering, markdown fences, or explanations.

Target keyword:
${keyword}

Source title:
${sourceTitle}

Source post:
"""
${sourcePost.trim()}
"""`;
}

function buildAllPersonasPostUserPrompt({ keyword, sourceTitle, sourcePost, personas }) {
  const sourceAnalysis = analyzeSourcePost(sourcePost, keyword);
  const orderedPersonaIds = personas.map((persona) => persona.id);
  const personaRoster = personas
    .map(
      (persona, index) => `${index + 1}. ${persona.name} [personaId=${persona.id}]
${persona.instruction}`,
    )
    .join("\n\n");
  const schemaExample = `{"replies":[${personas
    .map((persona) => `{"personaId":"${persona.id}","title":"${sourceTitle.replace(/"/g, "")}","text":"..."}`)
    .join(",")}]}`
  ;

  return `Analyze the source post below and write exactly one original search-focused post for each persona in the roster.

Persona roster:
${personaRoster}

Post mode rules:
- This is post mode, not comment mode.
- Keep the exact title unchanged for every persona output.
- The title must stay exactly: ${sourceTitle}
- Rewrite the body into a fresh original post instead of doing sentence by sentence paraphrasing.
- Keep the same main topic and search intent as the source post.
- Preserve the original structure as closely as possible in every version.
- Keep the same order of ideas unless a small shift clearly improves readability.
- If the source uses short sections, bullets, a quick answer opening, or a certain paragraph rhythm, stay close to that format.
- Do not turn the rewrite into a freer article with a different architecture.
- Target this exact keyword naturally in every body: ${keyword}
- Keep the keyword in at least the same important positions as the source or slightly better.
- Use the keyword naturally near the opening and elsewhere when it fits, but do not keyword stuff.
- Make the ten posts meaningfully different in voice, texture, and phrasing, but not different in article architecture.
- Keep the persona voice, rhythm, skepticism, and imperfections, but keep the source article blueprint recognizable.
- Keep each rewrite close to the original size. Do not massively expand a short source post.
- Do not mention SEO, Google, ranking, traffic, or optimization inside the post.

Source structure signals:
${sourceAnalysis.structureRules}

Requirements:
- Return valid JSON only.
- Use this exact schema: ${schemaExample}.
- The replies array must contain exactly ${personas.length} items in this exact order: ${orderedPersonaIds.join(", ")}.
- Each item must contain personaId, title, and text only.
- Every title must exactly match the source title with no changes.
- Every body must be in English only.
- Every body must read like a rewrite of this specific source post, not just a new post on the same keyword.
- Do not switch point of view, content role, or post type.
- If the source sounds like a person asking for help, every rewrite must still sound like a person asking for help.
- If the source sounds personal, keep it personal.
- If the source is short, keep it short.
- Do not include labels, numbering, markdown fences, or explanations.

Target keyword:
${keyword}

Source title:
${sourceTitle}

Source post:
"""
${sourcePost.trim()}
"""`;
}

function normalizePostText(text, itemLabel) {
  const normalized = stripQuotes(String(text || ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) {
    throw new PostContractError(`${itemLabel} is empty after normalization.`);
  }

  return normalized;
}

function normalizeGeneratedPosts(payload, { postCount, sourceTitle }) {
  const replies = extractReplies(payload);

  if (replies.length !== postCount) {
    throw new PostContractError(`Model response must contain exactly ${postCount} posts.`);
  }

  return replies.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new PostContractError(`Post ${index + 1} must be an object.`);
    }

    if (typeof item.text !== "string" || !item.text.trim()) {
      throw new PostContractError(`Post ${index + 1} must include text.`);
    }

    return {
      title: sourceTitle,
      text: normalizePostText(item.text, `Post ${index + 1}`),
    };
  });
}

function normalizeAllPersonasPosts(payload, { personas, sourceTitle }) {
  const replies = extractReplies(payload);

  if (replies.length !== personas.length) {
    throw new PostContractError(
      `Model response must contain exactly ${personas.length} posts.`,
    );
  }

  return replies.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new PostContractError(`Post ${index + 1} must be an object.`);
    }

    if (typeof item.personaId !== "string" || !item.personaId.trim()) {
      throw new PostContractError(`Post ${index + 1} must include personaId.`);
    }

    if (typeof item.text !== "string" || !item.text.trim()) {
      throw new PostContractError(`Post ${index + 1} must include text.`);
    }

    const expectedPersona = personas[index];
    if (item.personaId !== expectedPersona.id) {
      throw new PostContractError(
        `Posts must be returned in this order: ${personas.map((persona) => persona.id).join(", ")}.`,
      );
    }

    return {
      personaId: expectedPersona.id,
      personaName: expectedPersona.name,
      title: sourceTitle,
      text: normalizePostText(item.text, `Post for ${expectedPersona.name}`),
    };
  });
}

module.exports = {
  PostContractError,
  buildAllPersonasPostResponseSchema,
  buildAllPersonasPostUserPrompt,
  buildPostUserPrompt,
  buildSinglePostResponseSchema,
  normalizeAllPersonasPosts,
  normalizeGeneratedPosts,
};
