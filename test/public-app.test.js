const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...tokens) {
    tokens.filter(Boolean).forEach((token) => this.values.add(token));
  }

  remove(...tokens) {
    tokens.forEach((token) => this.values.delete(token));
  }

  contains(token) {
    return this.values.has(token);
  }
}

class FakeElement {
  constructor(tagName, id = "") {
    this.tagName = String(tagName || "div").toUpperCase();
    this.id = id;
    this.children = [];
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.className = "";
    this.disabled = false;
    this.checked = false;
    this.value = "";
    this.textContent = "";
    this._innerHTML = "";
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  append(...nodes) {
    this._innerHTML = "";
    this.children.push(...nodes);
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  querySelector() {
    return new FakeElement("button");
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  focus() {}

  select() {}

  setSelectionRange() {}

  remove() {}
}

class FakeFormData {
  constructor(documentRef) {
    this.documentRef = documentRef;
  }

  get(name) {
    if (name === "postText") {
      return this.documentRef.getElementById("post-text").value;
    }

    if (name === "tone") {
      return this.documentRef.getElementById("tone").value;
    }

    if (name === "accessToken") {
      return this.documentRef.getElementById("access-token").value;
    }

    if (name === "promoCreditClub") {
      return this.documentRef.getElementById("promo-credit-club").checked ? "on" : null;
    }

    if (name === "promoCreditBooster") {
      return this.documentRef.getElementById("promo-credit-booster").checked ? "on" : null;
    }

    return null;
  }
}

function createEnvironment({ fetchResponse, fetchImpl, setItemError } = {}) {
  const scriptPath = path.join(__dirname, "..", "public", "app.js");
  const source = fs.readFileSync(scriptPath, "utf8");
  const elements = new Map();

  function register(tagName, id) {
    const element = new FakeElement(tagName, id);
    elements.set(id, element);
    return element;
  }

  const form = register("form", "generator-form");
  const results = register("div", "results");
  const status = register("p", "status");
  const submitButton = register("button", "submit-button");
  const clearHistoryButton = register("button", "clear-history-button");
  const history = register("div", "history");
  const promoCreditClub = register("input", "promo-credit-club");
  const promoCreditBooster = register("input", "promo-credit-booster");
  const accessToken = register("input", "access-token");
  const postText = register("textarea", "post-text");
  const tone = register("select", "tone");

  results.classList.add("empty");
  history.classList.add("empty");
  tone.value = "grounded";
  void form;
  void submitButton;
  void clearHistoryButton;
  void promoCreditClub;
  void promoCreditBooster;
  void accessToken;

  const document = {
    body: new FakeElement("body"),
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    execCommand() {
      return true;
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
  };

  const localStorage = {
    store: new Map(),
    getItem(key) {
      return this.store.has(key) ? this.store.get(key) : null;
    },
    setItem(key, value) {
      if (setItemError) {
        throw setItemError;
      }

      this.store.set(key, String(value));
    },
    removeItem(key) {
      this.store.delete(key);
    },
  };

  const windowObject = {
    localStorage,
    setTimeout() {
      return 0;
    },
  };

  const context = {
    console,
    document,
    window: windowObject,
    navigator: {},
    fetch: fetchImpl || (async () => fetchResponse),
    FormData: class extends FakeFormData {
      constructor() {
        super(document);
      }
    },
  };

  windowObject.document = document;
  windowObject.fetch = context.fetch;
  windowObject.navigator = context.navigator;

  vm.runInNewContext(source, context, { filename: scriptPath });

  return {
    elements: {
      form,
      results,
      status,
      history,
      postText,
      tone,
      accessToken,
    },
    async submit() {
      const submitHandler = form.listeners.get("submit");
      assert.equal(typeof submitHandler, "function");
      await submitHandler({
        preventDefault() {},
      });
    },
  };
}

test("frontend renders server errors as text instead of html", async () => {
  const environment = createEnvironment({
    fetchResponse: {
      ok: false,
      async json() {
        return {
          error: "<img src=x onerror=alert(1)>",
        };
      },
    },
  });

  environment.elements.postText.value = "Need a reply.";
  environment.elements.tone.value = "grounded";

  await environment.submit();

  assert.equal(environment.elements.status.textContent, "Generation failed.");
  assert.equal(environment.elements.results.classList.contains("empty"), true);
  assert.equal(environment.elements.results.children.length, 1);
  assert.equal(
    environment.elements.results.children[0].textContent,
    "<img src=x onerror=alert(1)>",
  );
  assert.equal(environment.elements.results.innerHTML, "");
});

test("frontend keeps successful replies visible when history storage fails", async () => {
  const environment = createEnvironment({
    fetchResponse: {
      ok: true,
      async json() {
        return {
          replies: [
            { label: "Short", text: "Closing the card can change utilization." },
          ],
        };
      },
    },
    setItemError: new Error("Quota exceeded."),
  });

  environment.elements.postText.value = "Need a reply.";
  environment.elements.tone.value = "grounded";

  await environment.submit();

  assert.equal(
    environment.elements.status.textContent,
    "Comments generated. History could not be saved on this device.",
  );
  assert.equal(environment.elements.results.classList.contains("empty"), false);
  assert.equal(environment.elements.results.children.length, 1);
  assert.equal(
    environment.elements.results.children[0].children[1].textContent,
    "Closing the card can change utilization.",
  );
  assert.equal(environment.elements.history.classList.contains("empty"), true);
});

test("frontend degrades cleanly when api returns non-json body", async () => {
  const environment = createEnvironment({
    fetchResponse: {
      ok: false,
      async text() {
        return "<html>not-json</html>";
      },
    },
  });

  environment.elements.postText.value = "Need a reply.";
  environment.elements.tone.value = "grounded";

  await environment.submit();

  assert.equal(environment.elements.status.textContent, "Generation failed.");
  assert.equal(environment.elements.results.children.length, 1);
  assert.equal(environment.elements.results.children[0].textContent, "Request failed.");
});

test("frontend includes access token header when provided", async () => {
  let requestHeaders = null;
  const environment = createEnvironment({
    fetchImpl: async (_url, options) => {
      requestHeaders = options.headers;
      return {
        ok: true,
        async json() {
          return {
            replies: [{ label: "Short", text: "Reply." }],
          };
        },
      };
    },
  });

  environment.elements.postText.value = "Need a reply.";
  environment.elements.tone.value = "grounded";
  environment.elements.accessToken.value = "shared-secret";

  await environment.submit();

  assert.equal(requestHeaders["x-app-access-token"], "shared-secret");
});

test("frontend omits access token header when field is blank", async () => {
  let requestHeaders = null;
  const environment = createEnvironment({
    fetchImpl: async (_url, options) => {
      requestHeaders = options.headers;
      return {
        ok: true,
        async json() {
          return {
            replies: [{ label: "Short", text: "Reply." }],
          };
        },
      };
    },
  });

  environment.elements.postText.value = "Need a reply.";
  environment.elements.tone.value = "grounded";

  await environment.submit();

  assert.equal("x-app-access-token" in requestHeaders, false);
});
