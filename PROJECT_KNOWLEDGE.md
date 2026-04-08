# PROJECT_KNOWLEDGE

## 1. What This Project Is

- Name: Reddit Commentator
- Type: local-first Node.js web app
- Purpose: turn a pasted Reddit post into a small set of Reddit-ready replies for credit and debt discussions
- Primary users: a single operator or small trusted group using a local browser
- Responsibility boundary: generation, normalization, and presentation of reply drafts; not account management, moderation, or publishing to Reddit

## 2. What The Project Does

- Generates `Short`, `Medium`, and `Long` replies in normal mode
- Generates `Medium` and `Long` only when a disclosed promo mode is enabled
- Applies domain-specific voice and finance-writing rules through prompt modules
- Validates request input before spending OpenAI tokens
- Enforces loopback-first access plus optional token protection for non-loopback use
- Keeps recent generations in browser `localStorage` for quick reuse

## 3. How The Project Is Structured

- Entry point: `server.js`
- Configuration: `src/config.js`
- Domain rules and normalization: `src/domain/systemPrompt.js`, `src/domain/replyRules.js`
- Application orchestration: `src/application/generateReplies.js`
- OpenAI transport: `src/infrastructure/openaiResponsesClient.js`
- HTTP boundary: `src/presentation/createApp.js`, `src/presentation/validation.js`
- Frontend UI: `public/index.html`, `public/app.js`, `public/styles.css`
- Supporting docs: `docs/system/*`

## 4. Core Runtime Logic

1. The browser submits Reddit text, tone, promo flags, and optionally an access token.
2. The Express app applies access control, body parsing, request validation, rate limiting, and concurrency checks.
3. The generation service builds the user prompt and selects the expected reply labels.
4. The OpenAI client sends a JSON-schema constrained request to the Responses API.
5. The domain layer normalizes the returned payload and rejects malformed or contradictory output.
6. The browser renders the replies and tries to store the generation in local history.

## 5. Data And State

- Server-side persistence: none
- Client-side persistence: recent generations in `localStorage`
- Main request fields:
  - `postText`
  - `tone`
  - `promoCreditClub`
  - `promoCreditBooster`
- Main response fields:
  - `model`
  - `replies[]`
- Error envelope:
  - `error`
  - `code`
  - `requestId`

## 6. Interfaces And Integrations

- `GET /health`: liveness plus lightweight runtime metadata
- `GET /ready`: readiness based on usable OpenAI config
- `POST /api/generate`: core generation endpoint
- External dependency: OpenAI Responses API

## 7. Running The Project

- Install: `npm install`
- Start: `npm run dev` or `npm start`
- Test: `npm test`
- Important env:
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL`
  - `HOST`
  - `APP_ACCESS_TOKEN`
  - `OPENAI_TIMEOUT_MS`
  - `OPENAI_RETRY_COUNT`
  - `MAX_POST_TEXT_CHARS`
  - `MAX_CONCURRENT_GENERATIONS`
  - `RATE_LIMIT_WINDOW_MS`
  - `RATE_LIMIT_MAX_REQUESTS`
  - `REQUEST_BODY_LIMIT`

## 8. Key Components

### `src/presentation/createApp.js`
- Role: Express app assembly and runtime guardrails
- Input: HTTP requests plus injected services/config
- Effect: access control, validation, rate limiting, concurrency checks, response/error mapping

### `src/infrastructure/openaiResponsesClient.js`
- Role: OpenAI transport
- Input: prompt payload and request context
- Effect: structured Responses API call, retry/backoff, abort handling, total timeout enforcement

### `src/domain/replyRules.js`
- Role: prompt shaping and output normalization
- Input: request options and model payload
- Effect: label selection, promo disclosure rules, reply contract enforcement

### `public/app.js`
- Role: browser workflow
- Input: form values and API responses
- Effect: fetch submission, safe error rendering, history persistence, clipboard helpers

## 9. Important Hidden Knowledge

- The app is intentionally local-first and should not be treated as a hardened public service by default.
- Non-loopback use is supported only through an explicit access token path.
- Promo normalization is fail-closed for known conflicting service mentions.
- Transport retries are allowed for retryable upstream failures, but client disconnects and the total request timeout budget still win.

## 10. Confirmed Facts And Open Gaps

### Confirmed
- The current full local test suite passes: `node --test` => `41 passed, 0 failed`
- Request validation, access control, sanitized errors, and timeout-budget enforcement are implemented

### Open Gaps
- Browser history still lives in `localStorage`, which is a privacy tradeoff for shared devices
- The app is safer for controlled non-loopback use, but it is still not intended as a general public internet service
