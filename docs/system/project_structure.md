# Project Structure

## Repository Layout

```text
.
├── PROJECT_KNOWLEDGE.md
├── docs/
│   └── system/
├── public/
├── src/
│   ├── application/
│   ├── domain/
│   ├── infrastructure/
│   ├── presentation/
│   └── shared/
├── test/
├── package.json
├── README.md
└── server.js
```

## Notes

- `server.js` is intentionally thin and only boots the app.
- Business rules now live under `src/domain/`.
- External transport concerns now live under `src/infrastructure/`.
- `PROJECT_KNOWLEDGE.md` is the top-level explainer for new humans and agents.
- This layout is prepared for agent-driven changes by role.
