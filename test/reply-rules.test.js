const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ReplyContractError,
  buildUserPrompt,
  ensurePromotionDisclosure,
  getReplyLabels,
  getSelectedPromotion,
  normalizeGeneratedReplies,
} = require("../src/domain/replyRules");

test("default reply labels include short medium and long", () => {
  assert.deepEqual(
    getReplyLabels({ promoCreditClub: false, promoCreditBooster: false }),
    ["Short", "Medium", "Long"],
  );
});

test("promo mode drops short and injects disclosure-safe normalization", () => {
  const replyLabels = getReplyLabels({ promoCreditClub: true, promoCreditBooster: false });
  const promotion = getSelectedPromotion({ promoCreditClub: true, promoCreditBooster: false });
  const replies = normalizeGeneratedReplies(
    {
      output_text: JSON.stringify({
        replies: [
          { label: "medium", text: `"Keep an eye on utilization before you apply again."` },
          { label: "long", text: "The bigger issue is whether the file is clean enough right now." },
        ],
      }),
    },
    { replyLabels, promotion },
  );

  assert.equal(replies.length, 2);
  assert.equal(replies[0].label, "Medium");
  assert.match(replies[0].text, /^Disclosure: promotional mention of Credit Club\./);
  assert.match(replies[0].text, /https:\/\/joincreditclub\.com\//);
  assert.doesNotMatch(replies[0].text, /"/);
});

test("buildUserPrompt reflects tone, schema order and no-promo rule", () => {
  const prompt = buildUserPrompt({
    postText: "My score dropped after closing a card. Why?",
    tone: "skeptical",
    promoCreditClub: false,
    promoCreditBooster: false,
    replyLabels: ["Short", "Medium", "Long"],
  });

  assert.match(prompt, /Tone: skeptical/);
  assert.match(prompt, /The replies array must contain exactly 3 items in this order: Short, Medium, Long\./);
  assert.match(prompt, /Do not mention any services or products\./);
});

test("ensurePromotionDisclosure preserves existing disclosure and url", () => {
  const promotion = getSelectedPromotion({ promoCreditClub: false, promoCreditBooster: true });
  const text = ensurePromotionDisclosure(
    "Disclosure: promotional mention of Credit Booster Ai. If you want a tool for this, Credit Booster Ai is one option. https://creditbooster.ai/",
    promotion,
  );

  assert.equal(
    text,
    "Disclosure: promotional mention of Credit Booster Ai. If you want a tool for this, Credit Booster Ai is one option. https://creditbooster.ai/",
  );
});

test("ensurePromotionDisclosure rejects references to the wrong promoted service", () => {
  const promotion = getSelectedPromotion({ promoCreditClub: true, promoCreditBooster: false });

  assert.throws(
    () =>
      ensurePromotionDisclosure(
        "Disclosure: promotional mention of Credit Booster Ai. Credit Booster Ai can help organize the cleanup. https://creditbooster.ai/",
        promotion,
      ),
    (error) => {
      assert.equal(error instanceof ReplyContractError, true);
      assert.match(error.message, /Credit Booster Ai instead of Credit Club/);
      return true;
    },
  );
});

test("ensurePromotionDisclosure rejects conflicting promotion mentions", () => {
  const promotion = getSelectedPromotion({ promoCreditClub: true, promoCreditBooster: false });

  assert.throws(
    () =>
      ensurePromotionDisclosure(
        "Disclosure: promotional mention of Credit Booster Ai. Credit Booster Ai is one option. https://creditbooster.ai/",
        promotion,
      ),
    (error) => {
      assert.equal(error instanceof ReplyContractError, true);
      assert.match(error.message, /Credit Booster Ai/);
      return true;
    },
  );
});

test("normalizeGeneratedReplies rejects malformed json output", () => {
  assert.throws(
    () =>
      normalizeGeneratedReplies(
        {
          output_text: '{"replies": [',
        },
        {
          replyLabels: ["Short", "Medium", "Long"],
          promotion: null,
        },
      ),
    (error) => {
      assert.equal(error instanceof ReplyContractError, true);
      assert.match(error.message, /invalid JSON/i);
      return true;
    },
  );
});

test("normalizeGeneratedReplies rejects partial reply arrays", () => {
  assert.throws(
    () =>
      normalizeGeneratedReplies(
        {
          output_text: JSON.stringify({
            replies: [
              { label: "Short", text: "First reply." },
              { label: "Medium", text: "Second reply." },
            ],
          }),
        },
        {
          replyLabels: ["Short", "Medium", "Long"],
          promotion: null,
        },
      ),
    (error) => {
      assert.equal(error instanceof ReplyContractError, true);
      assert.match(error.message, /exactly 3 replies/i);
      return true;
    },
  );
});

test("normalizeGeneratedReplies rejects wrong label order", () => {
  assert.throws(
    () =>
      normalizeGeneratedReplies(
        {
          output_text: JSON.stringify({
            replies: [
              { label: "Medium", text: "Second-sized reply first." },
              { label: "Short", text: "Short reply second." },
              { label: "Long", text: "Long reply third." },
            ],
          }),
        },
        {
          replyLabels: ["Short", "Medium", "Long"],
          promotion: null,
        },
      ),
    (error) => {
      assert.equal(error instanceof ReplyContractError, true);
      assert.match(error.message, /returned in this order/i);
      return true;
    },
  );
});
