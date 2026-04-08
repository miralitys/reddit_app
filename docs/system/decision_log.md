# Decision Log

## 2026-03-21

### Decision

Prepare `Reddit Commentator` for external orchestration by splitting the monolithic server into
modules, adding smoke tests, and creating a `docs/system` knowledge base.

### Why

- The previous one-file backend was hard to review, test, and evolve through agent roles.
- Multi-project orchestration works better when the target repo has explicit modules and project
  memory.
- A health endpoint and test command make the repo easier to automate.

### Consequences

- Prompt rules, transport, validation, and app wiring now have separate responsibilities.
- The project now has a stable `npm test` entrypoint.
- Knowledge updates can be maintained in `docs/system/`.
- The repository can now be targeted as an external managed project by the central `Orhitertor`
  orchestration service under project id `reddit-commentator`.

## 2026-03-21

### Decision

Harden the app for safer non-loopback use and more reliable OpenAI request handling without turning
it into a full multi-user production service.

### Why

- The original local-first MVP needed clearer liveness/readiness behavior and safer runtime defaults.
- OpenAI-backed requests needed stricter admission control and stronger cancellation/timeout behavior.
- The orchestrator and review agents needed explicit regression coverage for edge cases such as
  invalid access tokens, oversized bodies, rate limits, and timeout handling.

### Consequences

- The app now defaults to loopback-first access, with optional token-protected non-loopback use.
- `/api/generate` is protected by stricter validation, body-size handling, rate limiting, and
  in-flight generation caps.
- Upstream transport now respects client disconnects, abort-aware backoff, and a single total
  request timeout budget.
- The knowledge base and test surface now reflect the hardened runtime behavior.
