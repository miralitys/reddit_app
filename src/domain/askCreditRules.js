class AskCreditContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "AskCreditContractError";
  }
}

const ASK_CREDIT_MIN_CHARS = 100;
const ASK_CREDIT_MAX_CHARS = 300;

const ASK_CREDIT_PERSONA_PROMPTS = {
  "alex-moreno": `Persona brief:
- Calm, practical, immigrant-adjusting guy who likes cars, productivity, personal finance, and everyday life in the US.
- Best question lanes: cars, life upgrades, practical adult decisions, social norms, productivity habits, moving through a new culture, and everyday what would you do situations.
- Make it relatable, grounded, and easy for lots of people to answer with personal experience.
- A calm, slightly overthinking but practical tone fits him.`,
  "marina-volk": `Persona brief:
- Direct, disciplined woman into budgeting, behavior psychology, career discipline, and adult self control.
- Best question lanes: bad habits, excuses people tell themselves, boundaries, discipline, spending patterns, adult reality checks, and behavior that starts arguments in a good way.
- Make it blunt, sharp, and likely to pull strong opinions and personal stories.
- A short, dry, slightly tough tone fits her.`,
  "daniel-price": `Persona brief:
- Analytical fintech nerd into tech, spreadsheets, rewards culture, digital tools, and internet mechanics.
- Best question lanes: subscriptions, optimization, tech habits, online shopping, rewards behavior, nerdy consumer habits, data-driven routines, and modern convenience tradeoffs.
- Make it smart, specific, and discussion friendly without becoming technical.
- A curious, slightly nerdy, forum-native tone fits him.`,
  "olga-sokolova": `Persona brief:
- Warm practical woman into family life, home planning, budgeting, and community forum style discussions.
- Best question lanes: home life, family tradeoffs, household routines, budgeting decisions, big purchases, emotional labor, and everyday adult stress.
- Make it broad enough for many adults to jump in with stories and advice.
- A warm, mature, everyday tone fits her.`,
  "kevin-brooks": `Persona brief:
- Fast, confident guy into efficiency, digital tools, fitness, career growth, and ambitious life decisions.
- Best question lanes: winning versus balance, career moves, speed versus stability, productivity systems, fitness discipline, lifestyle upgrades, and competitive adult choices.
- Make it high-reply, punchy, and slightly provocative without sounding fake.
- A sharp, energetic tone fits him.`,
  "sophia-grant": `Persona brief:
- Mature self-employed woman into small business life, design, business psychology, coffee, and practical adult lifestyle decisions.
- Best question lanes: client boundaries, pricing, burnout, self-employed tradeoffs, business versus personal life, creative work fatigue, and grown-up money decisions.
- Make it feel seasoned, relatable, and likely to attract stories from other adults.
- A steady, skeptical, slightly dry tone fits her.`,
  "eric-nolan": `Persona brief:
- Precise systems engineer into tech, systems thinking, forums, routines, and data-minded ways of living.
- Best question lanes: routines, tools, process annoyances, efficiency, modern habits, optimization gone too far, tech friction, and everyday systems people secretly hate.
- Make it clear, specific, and likely to start opinion-heavy replies.
- A dry, exact, restrained tone fits him.`,
  "natalia-reed": `Persona brief:
- Careful, skeptical woman into consumer advocacy, practical finance, podcasts, and seeing bad decisions before they happen.
- Best question lanes: red flags, scams, bad timing, warning signs, offers that feel off, adult caution, and situations where people ignore obvious risk.
- Make it discussion-friendly and likely to pull cautionary stories and strong opinions.
- A cool, practical, lightly skeptical tone fits her.`,
  "michael-turner": `Persona brief:
- Steady grown man into family life, cars, sports, routines, simple rules, and practical finance.
- Best question lanes: family routines, discipline, cars, habits, stability, aging, long-term choices, and simple adult rules people actually live by.
- Make it plainspoken, broadly relatable, and easy for normal adults to answer.
- A short, calm, no-nonsense tone fits him.`,
  "jessica-hall": `Persona brief:
- Goal-oriented woman into planning, digital tools, career growth, travel, and timeline-based life decisions.
- Best question lanes: planning, tradeoffs, timing, life goals, career moves, travel decisions, big next-step choices, and what matters more right now questions.
- Make it strategic, relatable, and likely to spark opinion-rich replies from ambitious adults.
- A cool, practical, forward-looking tone fits her.`,
};

function parseEnvelope(jsonText, sourceName) {
  try {
    return JSON.parse(jsonText);
  } catch {
    throw new AskCreditContractError(`Model returned invalid JSON in ${sourceName}.`);
  }
}

function extractQuestions(payload) {
  if (Array.isArray(payload?.replies)) {
    return payload.replies;
  }

  const outputText = String(payload?.output_text || "").trim();
  if (outputText) {
    const parsed = parseEnvelope(outputText, "output_text");
    if (Array.isArray(parsed?.replies)) {
      return parsed.replies;
    }

    throw new AskCreditContractError("Model response JSON must include a replies array.");
  }

  const contentBlocks = payload?.output?.flatMap((item) => item?.content || []) || [];
  const text = contentBlocks
    .filter((item) => item?.type === "output_text" && item?.text)
    .map((item) => item.text)
    .join("\n");

  if (!text) {
    throw new AskCreditContractError("Model response did not include any Ask Credit questions.");
  }

  const parsed = parseEnvelope(text, "output content");
  if (Array.isArray(parsed?.replies)) {
    return parsed.replies;
  }

  throw new AskCreditContractError("Model response JSON must include a replies array.");
}

function stripQuotes(text) {
  return String(text)
    .replace(/["'`“”‘’«»„‟‹›]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function trimQuestionToMaxLength(text, maxChars = ASK_CREDIT_MAX_CHARS) {
  const normalized = String(text || "").trim();

  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  let trimmed = normalized.slice(0, maxChars - 1).trim();
  const lastSpaceIndex = trimmed.lastIndexOf(" ");

  if (lastSpaceIndex >= Math.max(40, maxChars - 90)) {
    trimmed = trimmed.slice(0, lastSpaceIndex).trim();
  }

  trimmed = trimmed.replace(/[?!.,:;)\]]+$/g, "").trim();
  return `${trimmed}?`;
}

function normalizeQuestionText(text) {
  let normalized = stripQuotes(text)
    .replace(/^(question|ask credit|prompt)\s*:\s*/i, "")
    .trim();

  if (!normalized) {
    return "";
  }

  const lastQuestionMarkIndex = normalized.lastIndexOf("?");
  if (lastQuestionMarkIndex !== -1) {
    normalized = normalized.slice(0, lastQuestionMarkIndex + 1).trim();
  }

  if (!normalized.endsWith("?")) {
    normalized = `${normalized.replace(/[.!,:;)\]]+$/g, "").trim()}?`.trim();
  }

  return trimQuestionToMaxLength(normalized, ASK_CREDIT_MAX_CHARS);
}

function ensureQuestionLength(text) {
  if (text.length < ASK_CREDIT_MIN_CHARS) {
    throw new AskCreditContractError(
      `Question must be at least ${ASK_CREDIT_MIN_CHARS} characters.`,
    );
  }

  if (text.length > ASK_CREDIT_MAX_CHARS) {
    throw new AskCreditContractError(
      `Question must be ${ASK_CREDIT_MAX_CHARS} characters or fewer.`,
    );
  }

  return text;
}

function buildSingleAskCreditResponseSchema(questionCount = 1) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      replies: {
        type: "array",
        minItems: questionCount,
        maxItems: questionCount,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            text: {
              type: "string",
              minLength: ASK_CREDIT_MIN_CHARS,
              maxLength: ASK_CREDIT_MAX_CHARS,
            },
          },
          required: ["text"],
        },
      },
    },
    required: ["replies"],
  };
}

function buildAllPersonasAskCreditResponseSchema(personas) {
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
            text: {
              type: "string",
              minLength: ASK_CREDIT_MIN_CHARS,
              maxLength: ASK_CREDIT_MAX_CHARS,
            },
          },
          required: ["personaId", "text"],
        },
      },
    },
    required: ["replies"],
  };
}

function getAskCreditPersonaPrompt(persona) {
  return ASK_CREDIT_PERSONA_PROMPTS[persona?.id] || `Persona brief:
- Keep the question aligned with this persona's interests, life stage, and natural tone.
- Make it broad, relatable, and likely to get lots of replies.
- Do not make it about credit history or technical credit topics.`;
}

function buildPersonaPromptBlock(persona) {
  return `${persona.name} [personaId=${persona.id}]
Summary: ${persona.summary}
${getAskCreditPersonaPrompt(persona)}`;
}

function buildAskCreditUserPrompt({ persona, questionCount = 1 }) {
  const schemaExample = `{"replies":[${Array.from({ length: questionCount }, () => `{"text":"..."}`).join(",")}]}`
  ;

  return `Write exactly ${questionCount} Ask Credit question(s) for the selected persona.

Selected persona:
${buildPersonaPromptBlock(persona)}

Requirements:
- Return valid JSON only.
- Use this exact schema: ${schemaExample}.
- The replies array must contain exactly ${questionCount} item(s).
- Each item must contain text only.
- Each question must be in English.
- Each question must sound like this persona specifically, including their interests, life situation, blind spots, and natural tone.
- This is a question the persona is asking, not a comment they are writing back to someone else.
- Make it broad and popular enough to attract a lot of replies, opinions, and personal stories.
- Use the persona brief above as a dedicated prompt for this character.
- Do not make it about credit history, credit scores, credit reports, banks, lenders, debt cleanup, collections, or approvals.
- Write in first person when it helps the question feel real.
- Make it specific enough to feel like a real situation, not a generic topic prompt.
- Keep it to one short question when possible.
- The final text must be between ${ASK_CREDIT_MIN_CHARS} and ${ASK_CREDIT_MAX_CHARS} characters, including spaces.
- The final text must end with a natural question mark.
- Do not include headings, labels, numbering, markdown, or explanations.`;
}

function buildAllPersonasAskCreditUserPrompt({ personas }) {
  const orderedPersonaIds = personas.map((persona) => persona.id);
  const personaRoster = personas
    .map((persona, index) => `${index + 1}. ${buildPersonaPromptBlock(persona)}`)
    .join("\n\n");
  const schemaExample = `{"replies":[${personas
    .map((persona) => `{"personaId":"${persona.id}","text":"..."}`)
    .join(",")}]}`
  ;

  return `Write exactly one Ask Credit question for each persona in the roster.

Persona roster:
${personaRoster}

Requirements:
- Return valid JSON only.
- Use this exact schema: ${schemaExample}.
- The replies array must contain exactly ${personas.length} items in this exact order: ${orderedPersonaIds.join(", ")}.
- Each item must contain personaId and text only.
- Each question must be in English.
- Each question must sound like its assigned persona specifically, including their interests, life situation, blind spots, and natural tone.
- These are questions the personas are asking, not comments they are writing to other people.
- Treat each persona brief above as a dedicated prompt for that character.
- Make the ten questions meaningfully different in topic, angle, and lived context.
- Make them broad, popular, and likely to attract a lot of replies, opinions, and personal stories.
- Do not make them about credit history, credit scores, credit reports, banks, lenders, debt cleanup, collections, or approvals.
- Write in first person when it helps the question feel real.
- Keep each one to one short question when possible.
- Each final text must be between ${ASK_CREDIT_MIN_CHARS} and ${ASK_CREDIT_MAX_CHARS} characters, including spaces.
- Each final text must end with a natural question mark.
- Do not include headings, labels, numbering, markdown, or explanations.`;
}

function normalizeGeneratedAskCreditQuestions(payload, { questionCount }) {
  const replies = extractQuestions(payload);

  if (replies.length !== questionCount) {
    throw new AskCreditContractError(
      `Model response must contain exactly ${questionCount} questions.`,
    );
  }

  return replies.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new AskCreditContractError(`Question ${index + 1} must be an object.`);
    }

    if (typeof item.text !== "string" || !item.text.trim()) {
      throw new AskCreditContractError(`Question ${index + 1} must include text.`);
    }

    const text = ensureQuestionLength(normalizeQuestionText(item.text));
    if (!text) {
      throw new AskCreditContractError(`Question ${index + 1} is empty after normalization.`);
    }

    return { text };
  });
}

function normalizeAllPersonasAskCreditQuestions(payload, { personas }) {
  const replies = extractQuestions(payload);

  if (replies.length !== personas.length) {
    throw new AskCreditContractError(
      `Model response must contain exactly ${personas.length} questions.`,
    );
  }

  return replies.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new AskCreditContractError(`Question ${index + 1} must be an object.`);
    }

    if (typeof item.personaId !== "string" || !item.personaId.trim()) {
      throw new AskCreditContractError(`Question ${index + 1} must include personaId.`);
    }

    if (typeof item.text !== "string" || !item.text.trim()) {
      throw new AskCreditContractError(`Question ${index + 1} must include text.`);
    }

    const expectedPersona = personas[index];
    if (item.personaId !== expectedPersona.id) {
      throw new AskCreditContractError(
        `Questions must be returned in this order: ${personas.map((persona) => persona.id).join(", ")}.`,
      );
    }

    const text = ensureQuestionLength(normalizeQuestionText(item.text));
    if (!text) {
      throw new AskCreditContractError(
        `Question for ${expectedPersona.name} is empty after normalization.`,
      );
    }

    return {
      personaId: expectedPersona.id,
      personaName: expectedPersona.name,
      text,
    };
  });
}

module.exports = {
  ASK_CREDIT_MIN_CHARS,
  ASK_CREDIT_MAX_CHARS,
  AskCreditContractError,
  buildAllPersonasAskCreditResponseSchema,
  buildAllPersonasAskCreditUserPrompt,
  buildAskCreditUserPrompt,
  buildSingleAskCreditResponseSchema,
  normalizeAllPersonasAskCreditQuestions,
  normalizeGeneratedAskCreditQuestions,
};
