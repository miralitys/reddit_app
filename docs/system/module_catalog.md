# Module Catalog

## Runtime Modules

- `server.js`: bootstrap and dependency wiring.
- `src/config.js`: environment loading and runtime configuration defaults.
- `src/domain/systemPrompt.js`: system prompt for credit-focused Reddit writing.
- `src/domain/replyRules.js`: reply labels, prompt-building, disclosure logic, and output normalization.
- `src/application/generateReplies.js`: generation orchestration and empty-response handling.
- `src/infrastructure/openaiResponsesClient.js`: OpenAI Responses API transport with retry behavior, abort-aware backoff, and total request timeout enforcement.
- `src/presentation/createApp.js`: Express app, routes, access control, admission guardrails, security headers, and error mapping.
- `src/presentation/validation.js`: request validation for `/api/generate`.
- `src/shared/logger.js`: lightweight structured logging.

## Frontend Assets

- `public/index.html`: UI shell, tone controls, promo toggles, and optional non-loopback access-token input.
- `public/app.js`: form handling, token-aware fetch logic, history, rendering, and clipboard helpers.
- `public/styles.css`: visual presentation.

## Tests

- `test/reply-rules.test.js`: prompt-building and normalization logic.
- `test/generate-route.test.js`: smoke coverage for `POST /api/generate`.
- `test/backend-guardrails.test.js`: readiness, validation, access control, rate limiting, body-size, and timeout/error mapping.
- `test/openai-client.test.js`: retry, abort, and total timeout-budget transport behavior.
- `test/public-app.test.js`: frontend error handling, access-token header behavior, and history resilience.
- `test/validation.test.js`: direct validation-unit coverage.
