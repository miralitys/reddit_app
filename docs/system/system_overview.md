# System Overview

## Current State

This project is a small local-first Node.js application that generates Reddit-ready replies for
credit and debt discussions through the OpenAI Responses API.

## Runtime Shape

- Backend: Express API in `server.js` plus `src/`
- Frontend: static HTML/CSS/vanilla JS in `public/`
- Persistence: no server-side database
- Client-side state: recent generations in browser `localStorage`
- Network posture: loopback-first by default, token-protected when intentionally exposed beyond loopback

## Key Capabilities

- Generate `Short`, `Medium`, and `Long` reply variants for normal mode.
- Generate only `Medium` and `Long` variants when a disclosed promo mode is enabled.
- Apply domain-specific credit-writing rules through a dedicated system prompt.
- Normalize model output into consistent Reddit-ready reply cards.
- Reject malformed or oversized requests before calling OpenAI.
- Enforce basic admission guardrails through rate limiting, concurrency limits, and optional access-token checks.
- Distinguish liveness (`/health`) from readiness (`/ready`).
- Abort upstream work when the client disconnects and enforce a total request timeout budget.

## Integration Notes

- `GET /health` provides liveness plus lightweight runtime metadata.
- `GET /ready` reports whether the app is actually ready to generate replies.
- `POST /api/generate` is the only business endpoint.
- The OpenAI model is configured through `.env` with `OPENAI_MODEL`.
- The project is registered in the central `Orhitertor` multi-project registry as external project
  `reddit-commentator`.
- The orchestrator-facing integration contract is:
  - `repo_path=/Users/ramisyaparov/Desktop/Project/Reddit Comentator`
  - `docs_root=docs/system`
  - `install_command=npm install`
  - `test_command=npm test`
- Current local verification status: `node --test` => `41 passed, 0 failed`
