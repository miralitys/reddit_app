const form = document.getElementById("login-form");
const button = document.getElementById("login-button");
const statusNode = document.getElementById("login-status");
const usernameInput = document.getElementById("login-username");
const passwordInput = document.getElementById("login-password");

function setStatus(message) {
  statusNode.textContent = message || "";
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  setStatus("Signing in...");

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: usernameInput.value,
        password: passwordInput.value,
      }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.error || "Sign in failed.");
    }

    window.location.assign("/");
  } catch (error) {
    setStatus(error.message || "Sign in failed.");
    button.disabled = false;
  }
});

usernameInput?.focus();
