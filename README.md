# Reddit Commentator

Local-first Node.js web app for generating credit-focused Reddit comments and persona-based post rewrites through the OpenAI Responses API.

## What It Does

- Generates one Reddit-ready comment for a selected persona
- Generates a full batch of 10 comments, one per persona
- Supports a `Комментарии` mode for replies, a `Посты` mode for post rewrites, and an `Ask Credit` mode for persona-based credit questions
- Includes a `Сохраненные` mode with server-side saved outputs shared across devices
- Supports background queueing so you can add generation jobs without waiting on the page
- Accepts either pasted text or a Reddit post URL in comment mode
- Pulls Reddit title, body, attached image context, and visible text from images when possible
- Rewrites posts in persona voice while keeping the original title unchanged in post mode
- Stores recent generations in browser local storage for quick reuse
- Stores generated comments and posts in a server-side JSON file for shared review and status tracking

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

## Render Deployment

This repo includes [render.yaml](./render.yaml) for a Render web service.

Key deployment notes:

- Render should use `npm install` to build and `npm start` to run
- The app binds to `0.0.0.0` on Render
- `ALLOW_REMOTE_ACCESS=true` is enabled in the Render blueprint so the public web service can call `/api/generate`
- You must set `OPENAI_API_KEY` in Render before the service is actually ready
- Health check path is `/ready`

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
- `SAVED_GENERATIONS_FILE`
- `GENERATION_QUEUE_FILE`

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

### Сохраненные

- Shows generated comments and posts in a shared table
- Persists data on the server so it is visible from another computer
- Includes filters by persona and status
- Lets you mark each row as `new` or `published`

### Ask Credit

- Generate one Ask Credit question from the selected persona
- Or generate one question for all 10 personas at once
- Results are saved server-side and displayed in a copy-friendly table with persona and status filters

### Background Queue

- Add comment or post jobs to a background queue instead of waiting for the page
- Queue jobs continue processing on the server
- Completed jobs land in `Сохраненные`
- Failed jobs stay visible in the queue with an error message

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
- Shared saved outputs are written to `SAVED_GENERATIONS_FILE`
- Background queue state is written to `GENERATION_QUEUE_FILE`
- On Render, use a persistent disk for `SAVED_GENERATIONS_FILE` if you want saved records to survive deploys and restarts
- On Render, point both `SAVED_GENERATIONS_FILE` and `GENERATION_QUEUE_FILE` into your persistent disk mount path if you want queue and saved records to survive deploys and restarts
- `.env` is not committed
- The API key should stay only in local environment files and never be pasted into GitHub
