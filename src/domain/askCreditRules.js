class AskCreditContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "AskCreditContractError";
  }
}

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
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeQuestionText(text) {
  const normalized = stripQuotes(text);

  if (!normalized) {
    return "";
  }

  if (normalized.includes("?")) {
    return normalized;
  }

  return `${normalized.replace(/[.!]+$/g, "").trim()}?`.trim();
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
            },
          },
          required: ["personaId", "text"],
        },
      },
    },
    required: ["replies"],
  };
}

function buildAskCreditUserPrompt({ persona, questionCount = 1 }) {
  const schemaExample = `{"replies":[${Array.from({ length: questionCount }, () => `{"text":"..."}`).join(",")}]}`
  ;

  return `Write exactly ${questionCount} Ask Credit question(s) for the selected persona.

Selected persona:
${persona.instruction}

Requirements:
- Return valid JSON only.
- Use this exact schema: ${schemaExample}.
- The replies array must contain exactly ${questionCount} item(s).
- Each item must contain text only.
- Each question must be in English.
- Each question must sound like this persona specifically, including their life situation, concerns, blind spots, and natural tone.
- This is a question the persona is asking, not a comment they are writing back to someone else.
- Keep it grounded in a realistic credit or debt situation this persona would plausibly care about.
- Write in first person when it helps the question feel real.
- Make it specific enough to feel like a real situation, not a generic topic prompt.
- Keep it to 1 to 3 sentences total.
- End with a natural question.
- Do not include headings, labels, numbering, markdown, or explanations.`;
}

function buildAllPersonasAskCreditUserPrompt({ personas }) {
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

  return `Write exactly one Ask Credit question for each persona in the roster.

Persona roster:
${personaRoster}

Requirements:
- Return valid JSON only.
- Use this exact schema: ${schemaExample}.
- The replies array must contain exactly ${personas.length} items in this exact order: ${orderedPersonaIds.join(", ")}.
- Each item must contain personaId and text only.
- Each question must be in English.
- Each question must sound like its assigned persona specifically, including their life situation, concerns, blind spots, and natural tone.
- These are questions the personas are asking, not comments they are writing to other people.
- Make the ten questions meaningfully different in topic, angle, and lived context.
- Keep every question grounded in a realistic credit or debt situation that persona would plausibly care about.
- Write in first person when it helps the question feel real.
- Keep each question to 1 to 3 sentences total.
- End each one with a natural question.
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

    const text = normalizeQuestionText(item.text);
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

    const text = normalizeQuestionText(item.text);
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
  AskCreditContractError,
  buildAllPersonasAskCreditResponseSchema,
  buildAllPersonasAskCreditUserPrompt,
  buildAskCreditUserPrompt,
  buildSingleAskCreditResponseSchema,
  normalizeAllPersonasAskCreditQuestions,
  normalizeGeneratedAskCreditQuestions,
};
