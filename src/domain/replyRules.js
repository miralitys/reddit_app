class ReplyContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReplyContractError";
  }
}

const KNOWN_PROMOTIONS = [
  {
    name: "Credit Club",
    descriptor: "a credit monitoring service",
    url: "https://joincreditclub.com/",
  },
  {
    name: "Credit Booster Ai",
    descriptor: "a service where someone can work on fixing their credit history themselves with AI",
    url: "https://creditbooster.ai/",
  },
];

const COMMON_PERSONA_WRITING_RULES = `Common writing rules for every persona:
- Write like a real person on Reddit, not like an expert, editor, or AI assistant.
- Do not make the comment too polished, too complete, or too perfectly structured.
- Do not make the comment too successful sounding.
- Do not try to cover every side of the issue.
- Write like someone replying fairly quickly from real experience.
- Small rough edges are allowed.
- Conversational fragments are allowed.
- Slightly imperfect transitions between thoughts are allowed.
- Do not use bookish transitions.
- Do not force a clean perfect conclusion at the end of every comment.
- Do not make the text too neutral or too polite.
- It is fine if the writing feels a little more alive, a little shorter, or a little more human.
- Better to underexplain than overexplain.
- Better to sound alive than perfect.
- Better one strong human turn of phrase than five correct sentences in a row.
- Not every comment needs to sound like a clean successful finished thought.
- Not every thought needs to sound like a strong ready made line.
- Sometimes a comment can just be useful and alive without a strong ending.
- Do not wrap up every comment with a beautiful final sentence.
- Imperfect transitions are allowed.
- A slightly uneven rhythm is allowed.
- More everyday words are allowed.
- Sometimes a less pretty formulation is better than a polished one.`;

function buildPromotionInstructions({ promoCreditClub, promoCreditBooster }) {
  const instructions = [];

  if (promoCreditClub) {
    instructions.push(`- This is a disclosed promotional mention.
- Every generated reply must make it clear in a natural way that the Credit Club mention is promotional.
- Do not use literal labels like Promo disclosure: or Disclosure:.
- Work the transparency into a normal human sentence, not an ad.
- Credit Club should be described briefly as a credit monitoring service.
- Use low-pressure wording, like one option, if you want a tool for this, or if you want something to keep an eye on changes.
- Include https://joincreditclub.com/.
- No hype, no urgency, no sign up language, no exaggerated claims.
- Do not claim personal use, personal results, or fake first-hand experience unless the user explicitly gave that context.`);
  }

  if (promoCreditBooster) {
    instructions.push(`- This is a disclosed promotional mention.
- Every generated reply must make it clear in a natural way that the Credit Booster Ai mention is promotional.
- Do not use literal labels like Promo disclosure: or Disclosure:.
- Work the transparency into a normal human sentence, not an ad.
- Describe Credit Booster Ai briefly as a service where someone can work on fixing their credit history themselves with AI.
- Use low-pressure wording, like one option, if you want a tool for this, or if you want help organizing the cleanup process.
- Include https://creditbooster.ai/.
- Keep it brief, natural, and non-salesy.
- No hype, no urgency, no sign up language, no exaggerated claims.
- Do not claim personal use, personal results, or fake first-hand experience unless the user explicitly gave that context.`);
  }

  if (!instructions.length) {
    instructions.push("- Do not mention any products or services.");
  }

  return instructions.join("\n");
}

function getReplyCount() {
  return 1;
}

function buildUserPrompt({ postText, persona, promoCreditClub, promoCreditBooster, replyCount }) {
  const promotionEnabled = promoCreditClub || promoCreditBooster;
  const schemaExample = `{"replies":[${Array.from({ length: replyCount }, () => `{"text":"..."}`).join(",")}]}`
  ;

  return `Analyze the Reddit post below and write ${replyCount} distinct Reddit-ready comment option(s).

Selected persona:
${persona.instruction}

Common persona writing rules:
${COMMON_PERSONA_WRITING_RULES}

Promotion rules:
${buildPromotionInstructions({ promoCreditClub, promoCreditBooster })}

Requirements:
- Return valid JSON only.
- Use this exact schema: ${schemaExample}.
- The replies array must contain exactly ${replyCount} items.
- Each item must have only a text field.
- Each reply must be in English.
- All replies must sound like the selected persona, including their natural rhythm, length, attitude, and imperfections.
- The replies must be meaningfully different in wording and structure, not just expanded copies.
- ${
    promotionEnabled
      ? "If promotion is enabled, every reply must include a natural transparency note and then a soft, low-pressure recommendation of the selected service. Never start the reply with Promo disclosure: or Disclosure:."
      : "Do not mention any services or products."
  }
- Do not include labels, numbering, markdown, or explanations in the reply text.

Reddit post:
"""
${postText.trim()}
"""`;
}

function buildAllPersonasUserPrompt({ postText, personas, promoCreditClub, promoCreditBooster }) {
  const promotionEnabled = promoCreditClub || promoCreditBooster;
  const orderedPersonaIds = personas.map((persona) => persona.id);
  const personaRoster = personas
    .map(
      (persona, index) => `${index + 1}. ${persona.name} [personaId=${persona.id}]
${persona.instruction}`,
    )
    .join("\n\n");
  const schemaExample = `{"replies":[${personas
    .map((persona) => `{"personaId":"${persona.id}","text":"..."}`)
    .join(",")}]}`
  ;

  return `Analyze the Reddit post below and write exactly one Reddit-ready comment for each persona in the roster.

Persona roster:
${personaRoster}

Common persona writing rules:
${COMMON_PERSONA_WRITING_RULES}

Promotion rules:
${buildPromotionInstructions({ promoCreditClub, promoCreditBooster })}

Requirements:
- Return valid JSON only.
- Use this exact schema: ${schemaExample}.
- The replies array must contain exactly ${personas.length} items in this exact order: ${orderedPersonaIds.join(", ")}.
- Each item must contain personaId and text only.
- Each reply must be in English.
- Every reply must sound like its assigned persona, including the natural pacing, usual length, edge level, and imperfections described in that persona profile.
- Make the ten replies genuinely different in voice and angle. Do not make them feel like the same comment with minor edits.
- ${
    promotionEnabled
      ? "If promotion is enabled, every reply must include a natural transparency note and then a soft, low-pressure recommendation of the selected service. Never start the reply with Promo disclosure: or Disclosure:."
      : "Do not mention any services or products."
  }
- Do not include labels, numbering, markdown, or explanations in the reply text.

Reddit post:
"""
${postText.trim()}
"""`;
}

function parseReplyEnvelope(jsonText, sourceName) {
  try {
    return JSON.parse(jsonText);
  } catch {
    throw new ReplyContractError(`Model returned invalid JSON in ${sourceName}.`);
  }
}

function extractReplies(payload) {
  if (Array.isArray(payload?.replies)) {
    return payload.replies;
  }

  const outputText = String(payload?.output_text || "").trim();
  if (outputText) {
    const parsed = parseReplyEnvelope(outputText, "output_text");
    if (Array.isArray(parsed?.replies)) {
      return parsed.replies;
    }

    throw new ReplyContractError("Model response JSON must include a replies array.");
  }

  const contentBlocks = payload?.output?.flatMap((item) => item?.content || []) || [];
  const text = contentBlocks
    .filter((item) => item?.type === "output_text" && item?.text)
    .map((item) => item.text)
    .join("\n");

  if (!text) {
    throw new ReplyContractError("Model response did not include any reply content.");
  }

  const parsed = parseReplyEnvelope(text, "output content");
  if (Array.isArray(parsed?.replies)) {
    return parsed.replies;
  }

  throw new ReplyContractError("Model response JSON must include a replies array.");
}

function stripQuotes(text) {
  return String(text)
    .replace(/["'`“”‘’«»„‟‹›]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function getSelectedPromotion({ promoCreditClub, promoCreditBooster }) {
  if (promoCreditClub) {
    return KNOWN_PROMOTIONS.find((promotion) => promotion.name === "Credit Club") || null;
  }

  if (promoCreditBooster) {
    return KNOWN_PROMOTIONS.find((promotion) => promotion.name === "Credit Booster Ai") || null;
  }

  return null;
}

function ensurePromotionDisclosure(text, promotion) {
  if (!promotion) {
    return text;
  }

  let normalized = String(text || "").trim();
  normalized = normalized
    .replace(/^promo disclosure:\s*/i, "")
    .replace(/^disclosure:\s*/i, "")
    .replace(/^(promotional|sponsored)\s+mention of [^.]+\.\s*/i, "")
    .replace(/^disclosure:\s*/i, "")
    .replace(/^(promotional|sponsored)\s+mention of [^.]+\.\s*/i, "")
    .trim();

  const lower = normalized.toLowerCase();
  const conflictingPromotion = KNOWN_PROMOTIONS.find(
    (knownPromotion) =>
      knownPromotion.name !== promotion.name &&
      (lower.includes(knownPromotion.name.toLowerCase()) ||
        lower.includes(knownPromotion.url.toLowerCase())),
  );

  if (conflictingPromotion) {
    throw new ReplyContractError(
      `Reply references ${conflictingPromotion.name} instead of ${promotion.name}.`,
    );
  }

  const hasNaturalDisclosure = /(for transparency|sponsored mention|promotional mention|sponsored|promotional|promo mention|promo)/i.test(
    normalized,
  );

  if (!hasNaturalDisclosure) {
    normalized = `For transparency, this includes a sponsored mention of ${promotion.name}. ${normalized}`.trim();
  }

  if (!normalized.toLowerCase().includes(promotion.name.toLowerCase())) {
    normalized = `${normalized} If you want a tool for this, ${promotion.name} is one option. It is ${promotion.descriptor}.`.trim();
  }

  if (!normalized.includes(promotion.url)) {
    normalized = `${normalized} ${promotion.url}`.trim();
  }

  return normalized.replace(/\s{2,}/g, " ").trim();
}

function normalizeGeneratedReplies(payload, { replyCount, promotion }) {
  const replies = extractReplies(payload);

  if (replies.length !== replyCount) {
    throw new ReplyContractError(
      `Model response must contain exactly ${replyCount} replies.`,
    );
  }

  return replies.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ReplyContractError(`Reply ${index + 1} must be an object.`);
    }

    if (typeof item.text !== "string" || !item.text.trim()) {
      throw new ReplyContractError(`Reply ${index + 1} must include text.`);
    }

    const text = ensurePromotionDisclosure(stripQuotes(item.text), promotion);
    if (!text) {
      throw new ReplyContractError(`Reply ${index + 1} is empty after normalization.`);
    }

    return { text };
  });
}

function normalizeAllPersonasReplies(payload, { personas, promotion }) {
  const replies = extractReplies(payload);

  if (replies.length !== personas.length) {
    throw new ReplyContractError(
      `Model response must contain exactly ${personas.length} replies.`,
    );
  }

  return replies.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ReplyContractError(`Reply ${index + 1} must be an object.`);
    }

    if (typeof item.personaId !== "string" || !item.personaId.trim()) {
      throw new ReplyContractError(`Reply ${index + 1} must include personaId.`);
    }

    if (typeof item.text !== "string" || !item.text.trim()) {
      throw new ReplyContractError(`Reply ${index + 1} must include text.`);
    }

    const expectedPersona = personas[index];
    if (item.personaId !== expectedPersona.id) {
      throw new ReplyContractError(
        `Replies must be returned in this order: ${personas.map((persona) => persona.id).join(", ")}.`,
      );
    }

    const text = ensurePromotionDisclosure(stripQuotes(item.text), promotion);
    if (!text) {
      throw new ReplyContractError(`Reply for ${expectedPersona.name} is empty after normalization.`);
    }

    return {
      personaId: expectedPersona.id,
      personaName: expectedPersona.name,
      text,
    };
  });
}

module.exports = {
  ReplyContractError,
  buildAllPersonasUserPrompt,
  buildPromotionInstructions,
  buildUserPrompt,
  ensurePromotionDisclosure,
  extractReplies,
  getReplyCount,
  getSelectedPromotion,
  normalizeAllPersonasReplies,
  normalizeGeneratedReplies,
  stripQuotes,
};
