# Data Flows

## Reply Generation

1. The browser submits `postText`, `tone`, optional promo flags, and optionally `x-app-access-token` to `POST /api/generate`.
2. The Express route applies access control, rate limiting, concurrency checks, body parsing, and request validation.
3. The application service selects reply labels and promo context.
4. The OpenAI client sends a structured JSON-schema request to the Responses API.
5. The transport retries retryable upstream failures, but still respects client aborts and a single total timeout budget.
6. The service normalizes the returned payload into Reddit-ready replies and rejects malformed model output.
7. The browser renders the replies and attempts to save the result in local history.

## Promo Mode

1. The user can enable either `Credit Club` or `Credit Booster Ai`.
2. Promo mode removes the short variant and keeps only medium and long.
3. Response normalization ensures a disclosure and target URL are present and rejects conflicting known-promotion mentions.

## Runtime Health

1. A client calls `GET /health`.
2. The server returns liveness metadata such as `ok`, service name, configured model, readiness flag, and whether the app is effectively local-only.

## Readiness Flow

1. A client calls `GET /ready`.
2. The server returns `200` only when the app has both a configured model and a usable OpenAI API key.
