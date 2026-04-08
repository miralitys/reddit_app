const {
  PostContractError,
  buildAllPersonasPostResponseSchema,
  buildAllPersonasPostUserPrompt,
  buildPostUserPrompt,
  buildSinglePostResponseSchema,
  normalizeAllPersonasPosts,
  normalizeGeneratedPosts,
} = require("../domain/postRules");
const {
  ReplyContractError,
  buildAllPersonasUserPrompt,
  buildUserPrompt,
  getReplyCount,
  getSelectedPromotion,
  normalizeAllPersonasReplies,
  normalizeGeneratedReplies,
} = require("../domain/replyRules");
const { PERSONAS, getPersonaById } = require("../domain/personas");
const { postSystemPrompt } = require("../domain/postSystemPrompt");
const { systemPrompt } = require("../domain/systemPrompt");
const { SourceContextError, resolveSourceContext } = require("./resolveSourceContext");

class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigurationError";
  }
}

class EmptyModelResponseError extends Error {
  constructor(message) {
    super(message);
    this.name = "EmptyModelResponseError";
  }
}

class InvalidModelResponseError extends EmptyModelResponseError {
  constructor(message) {
    super(message);
    this.name = "InvalidModelResponseError";
  }
}

function buildAllPersonasResponseSchema(personas) {
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

function createGenerationService({ openAiClient, redditPostClient, model, logger }) {
  async function generateComments({
    contentMode = "comments",
    postText,
    redditUrl,
    targetKeyword,
    sourceTitle,
    sourcePost,
    personaId,
    generateAllPersonas = false,
    promoCreditClub = false,
    promoCreditBooster = false,
    requestId,
  }) {
    if (!model) {
      throw new ConfigurationError("OPENAI_MODEL is missing.");
    }

    if (!openAiClient?.isConfigured) {
      throw new ConfigurationError("OPENAI_API_KEY is missing.");
    }

    if (contentMode === "posts") {
      const persona = getPersonaById(personaId);

      if (!persona) {
        throw new ConfigurationError("Selected persona is not available.");
      }

      if (generateAllPersonas) {
        logger?.info("Generating search posts for all personas", {
          requestId,
          generation_mode: "all-personas",
          content_mode: "posts",
          persona_count: PERSONAS.length,
          keyword: targetKeyword,
          model,
        });

        const payload = await openAiClient.createStructuredResponse({
          model,
          systemPrompt: postSystemPrompt,
          userPrompt: buildAllPersonasPostUserPrompt({
            keyword: targetKeyword,
            sourceTitle,
            sourcePost,
            personas: PERSONAS,
          }),
          responseSchemaName: "seo_all_personas_posts",
          responseSchema: buildAllPersonasPostResponseSchema(PERSONAS),
          maxOutputTokens: 14000,
          requestId,
        });

        let replies;

        try {
          replies = normalizeAllPersonasPosts(payload, {
            personas: PERSONAS,
            sourceTitle,
          });
        } catch (error) {
          if (error instanceof PostContractError) {
            throw new InvalidModelResponseError(
              error.message || "Model response did not match the required post contract.",
            );
          }

          throw error;
        }

        if (!replies.length) {
          throw new EmptyModelResponseError("The model returned an empty response. Try again.");
        }

        return {
          replies,
          model,
          contentMode: "posts",
          generationMode: "all-personas",
          sourceContext: null,
        };
      }

      logger?.info("Generating search post", {
        requestId,
        generation_mode: "single",
        content_mode: "posts",
        persona_id: persona.id,
        persona_name: persona.name,
        keyword: targetKeyword,
        model,
      });

      const payload = await openAiClient.createStructuredResponse({
        model,
        systemPrompt: postSystemPrompt,
        userPrompt: buildPostUserPrompt({
          keyword: targetKeyword,
          sourceTitle,
          sourcePost,
          persona,
          postCount: 1,
        }),
        responseSchemaName: "seo_single_post",
        responseSchema: buildSinglePostResponseSchema(1),
        maxOutputTokens: 6000,
        requestId,
      });

      let replies;

      try {
        replies = normalizeGeneratedPosts(payload, {
          postCount: 1,
          sourceTitle,
        });
      } catch (error) {
        if (error instanceof PostContractError) {
          throw new InvalidModelResponseError(
            error.message || "Model response did not match the required post contract.",
          );
        }

        throw error;
      }

      if (!replies.length) {
        throw new EmptyModelResponseError("The model returned an empty response. Try again.");
      }

      return {
        replies,
        model,
        contentMode: "posts",
        generationMode: "single",
        sourceContext: null,
        persona: {
          id: persona.id,
          name: persona.name,
        },
      };
    }

    const promotion = getSelectedPromotion({ promoCreditClub, promoCreditBooster });
    const { promptPostText, sourceContext } = await resolveSourceContext({
      postText,
      redditUrl,
      redditPostClient,
      openAiClient,
      model,
      requestId,
      logger,
    });

    if (generateAllPersonas) {
      logger?.info("Generating Reddit replies for all personas", {
        requestId,
        generation_mode: "all-personas",
        persona_count: PERSONAS.length,
        source_type: sourceContext?.type || "manual-text",
        promo_credit_club: promoCreditClub,
        promo_credit_booster: promoCreditBooster,
        model,
      });

      const payload = await openAiClient.createStructuredResponse({
        model,
        systemPrompt,
        userPrompt: buildAllPersonasUserPrompt({
          postText: promptPostText,
          personas: PERSONAS,
          promoCreditClub,
          promoCreditBooster,
        }),
        responseSchemaName: "reddit_all_personas_replies",
        responseSchema: buildAllPersonasResponseSchema(PERSONAS),
        maxOutputTokens: 5000,
        requestId,
      });

      let replies;

      try {
        replies = normalizeAllPersonasReplies(payload, {
          personas: PERSONAS,
          promotion,
        });
      } catch (error) {
        if (error instanceof ReplyContractError) {
          throw new InvalidModelResponseError(
            error.message || "Model response did not match the required reply contract.",
          );
        }

        throw error;
      }

      if (!replies.length) {
        throw new EmptyModelResponseError("The model returned an empty response. Try again.");
      }

      return {
        replies,
        model,
        contentMode: "comments",
        generationMode: "all-personas",
        sourceContext,
      };
    }

    const replyCount = getReplyCount();
    const persona = getPersonaById(personaId);

    if (!persona) {
      throw new ConfigurationError("Selected persona is not available.");
    }

    logger?.info("Generating Reddit replies", {
      requestId,
      generation_mode: "single",
      persona_id: persona.id,
      persona_name: persona.name,
      reply_count: replyCount,
      source_type: sourceContext?.type || "manual-text",
      promo_credit_club: promoCreditClub,
      promo_credit_booster: promoCreditBooster,
      model,
    });

    const payload = await openAiClient.createStructuredResponse({
      model,
      systemPrompt,
      userPrompt: buildUserPrompt({
        postText: promptPostText,
        persona,
        promoCreditClub,
        promoCreditBooster,
        replyCount,
      }),
      replyCount,
      requestId,
    });

    let replies;

    try {
      replies = normalizeGeneratedReplies(payload, {
        replyCount,
        promotion,
      });
    } catch (error) {
      if (error instanceof ReplyContractError) {
        throw new InvalidModelResponseError(
          error.message || "Model response did not match the required reply contract.",
        );
      }

      throw error;
    }

    if (!replies.length) {
      throw new EmptyModelResponseError(
        "The model returned an empty response. Try again.",
      );
    }

    return {
      replies,
      model,
      contentMode: "comments",
      generationMode: "single",
      sourceContext,
      persona: {
        id: persona.id,
        name: persona.name,
      },
    };
  }

  return {
    generateComments,
  };
}

module.exports = {
  ConfigurationError,
  EmptyModelResponseError,
  InvalidModelResponseError,
  SourceContextError,
  createGenerationService,
};
