const test = require("node:test");
const assert = require("node:assert/strict");

const {
  RequestValidationError,
  validateGenerateRequest,
} = require("../src/presentation/validation");

test("validateGenerateRequest trims valid input and applies defaults", () => {
  const payload = validateGenerateRequest({
    postText: "  Need a reply.  ",
  });

  assert.deepEqual(payload, {
    postText: "Need a reply.",
    tone: "grounded",
    promoCreditClub: false,
    promoCreditBooster: false,
  });
});

test("validateGenerateRequest rejects non-object bodies", () => {
  assert.throws(
    () => validateGenerateRequest("bad body"),
    (error) => {
      assert.equal(error instanceof RequestValidationError, true);
      assert.match(error.message, /JSON object/);
      return true;
    },
  );
});

test("validateGenerateRequest rejects non-string tone values", () => {
  assert.throws(
    () =>
      validateGenerateRequest({
        postText: "Need a reply.",
        tone: 42,
      }),
    (error) => {
      assert.equal(error instanceof RequestValidationError, true);
      assert.match(error.message, /tone must be a string/i);
      return true;
    },
  );
});

test("validateGenerateRequest rejects non-boolean promo flags", () => {
  assert.throws(
    () =>
      validateGenerateRequest({
        postText: "Need a reply.",
        promoCreditClub: "true",
      }),
    (error) => {
      assert.equal(error instanceof RequestValidationError, true);
      assert.match(error.message, /promoCreditClub must be a boolean/i);
      return true;
    },
  );
});
