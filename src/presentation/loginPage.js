function buildLoginPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Login · Reddit Commentator</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #eef3fb;
        --panel: rgba(255, 255, 255, 0.84);
        --line: rgba(24, 31, 56, 0.08);
        --text: #121826;
        --muted: #667189;
        --accent: #2563ff;
        --shadow: 0 28px 80px rgba(20, 26, 48, 0.08);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top center, rgba(37, 99, 255, 0.1), transparent 22%),
          radial-gradient(circle at 20% 18%, rgba(122, 92, 255, 0.08), transparent 22%),
          linear-gradient(180deg, #f8f9fd 0%, #f3f5fb 42%, #eef2f8 100%);
      }

      .login-shell {
        width: min(100%, 460px);
        padding: 18px;
        border-radius: 32px;
        border: 1px solid rgba(255, 255, 255, 0.56);
        background: rgba(255, 255, 255, 0.38);
        box-shadow: var(--shadow);
        backdrop-filter: blur(18px);
      }

      .login-card {
        padding: 28px;
        border-radius: 26px;
        border: 1px solid rgba(255, 255, 255, 0.6);
        background: var(--panel);
      }

      .eyebrow,
      .status {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .eyebrow {
        margin: 0 0 12px;
        color: var(--accent);
        font-size: 0.76rem;
      }

      h1 {
        margin: 0;
        font-size: clamp(2rem, 6vw, 3rem);
        line-height: 0.96;
        letter-spacing: -0.04em;
      }

      .copy {
        margin: 16px 0 0;
        color: var(--muted);
        line-height: 1.7;
      }

      form {
        display: grid;
        gap: 14px;
        margin-top: 24px;
      }

      label {
        display: grid;
        gap: 8px;
      }

      label span {
        font-size: 0.92rem;
        font-weight: 600;
      }

      input,
      button {
        font: inherit;
      }

      input {
        width: 100%;
        padding: 15px 16px;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.92);
        color: var(--text);
      }

      input:focus {
        outline: none;
        border-color: rgba(37, 99, 255, 0.26);
        box-shadow: 0 0 0 4px rgba(37, 99, 255, 0.08);
      }

      button {
        margin-top: 8px;
        border: 0;
        border-radius: 999px;
        padding: 14px 20px;
        font-weight: 700;
        color: #fff;
        cursor: pointer;
        background: linear-gradient(180deg, #2d74ff 0%, #1f63eb 100%);
        box-shadow:
          0 14px 28px rgba(37, 99, 255, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.2);
      }

      button:disabled {
        opacity: 0.56;
        cursor: not-allowed;
      }

      .status {
        min-height: 1.2rem;
        margin: 4px 0 0;
        color: var(--accent);
        font-size: 0.76rem;
      }
    </style>
  </head>
  <body>
    <main class="login-shell">
      <section class="login-card">
        <p class="eyebrow">Protected Workspace</p>
        <h1>Sign In</h1>
        <p class="copy">
          Enter the admin credentials to open Reddit Commentator. The full app stays locked until
          the session is authorized.
        </p>

        <form id="login-form">
          <label>
            <span>Login</span>
            <input id="login-username" name="username" type="text" autocomplete="username" required />
          </label>

          <label>
            <span>Password</span>
            <input id="login-password" name="password" type="password" autocomplete="current-password" required />
          </label>

          <button id="login-button" type="submit">Open Workspace</button>
          <p id="login-status" class="status" aria-live="polite"></p>
        </form>
      </section>
    </main>

    <script src="/login.js" defer></script>
  </body>
</html>`;
}

module.exports = {
  buildLoginPage,
};
