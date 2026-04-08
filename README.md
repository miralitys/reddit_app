# Reddit Commentator

Local-first Node.js web app for generating credit-focused Reddit comments and persona-based post rewrites through the OpenAI Responses API.

## What It Does

- Generates one Reddit-ready comment for a selected persona
- Generates a full batch of 10 comments, one per persona
- Supports a `Комментарии` mode for replies and a `Посты` mode for post rewrites
- Accepts either pasted text or a Reddit post URL in comment mode
- Pulls Reddit title, body, attached image context, and visible text from images when possible
- Rewrites posts in persona voice while keeping the original title unchanged in post mode
- Stores recent generations in browser local storage for quick reuse

## Setup

1. Create a `.env` file from `.env.example`
2. Add your OpenAI API key to `OPENAI_API_KEY`
3. Optionally change `OPENAI_MODEL`
4. Install dependencies:

```bash
npm install
```

5. Start the app:

```bash
npm start
```

6. Open [http://127.0.0.1:3000](http://127.0.0.1:3000)

## Environment Variables

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `HOST`
- `PORT`
- `APP_ACCESS_TOKEN`
- `OPENAI_TIMEOUT_MS`
- `OPENAI_RETRY_COUNT`
- `MAX_POST_TEXT_CHARS`
- `MAX_CONCURRENT_GENERATIONS`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX_REQUESTS`
- `REQUEST_BODY_LIMIT`

## App Modes

### Комментарии

- Generate one comment in the selected persona
- Or generate all 10 persona comments at once
- Optional Reddit URL intake with title/body/image extraction
- Optional disclosed promo mention modes

### Посты

- Provide:
  - target keyword
  - original title
  - original post body
- The app rewrites the body in the selected persona voice
- The title stays unchanged
- Or generate one rewritten version for all 10 personas

## Stack

- Node.js
- Express
- Vanilla HTML, CSS, and JavaScript
- OpenAI Responses API
- `node:test`

## Tests

Run:

```bash
npm test
```

## Notes

- The app is local-first by default
- `.env` is not committed
- The API key should stay only in local environment files and never be pasted into GitHub
