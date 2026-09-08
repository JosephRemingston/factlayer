import test from "node:test";
import assert from "node:assert/strict";
import { callLLM, providerStatus, resetProviderCooldowns, RateLimitError, PROVIDERS } from "../services/llm.service.js";
import { createRateLimiter } from "../middlewares/rateLimit.middleware.js";

const withStubs = async (minimax, gemini, run) => {
  const original = { minimax: PROVIDERS.minimax.call, gemini: PROVIDERS.gemini.call };
  const configured = { minimax: PROVIDERS.minimax.configured, gemini: PROVIDERS.gemini.configured };
  PROVIDERS.minimax.call = minimax;
  PROVIDERS.gemini.call = gemini;
  PROVIDERS.minimax.configured = () => true;
  PROVIDERS.gemini.configured = () => true;
  resetProviderCooldowns();
  try {
    return await run();
  } finally {
    PROVIDERS.minimax.call = original.minimax;
    PROVIDERS.gemini.call = original.gemini;
    PROVIDERS.minimax.configured = configured.minimax;
    PROVIDERS.gemini.configured = configured.gemini;
    resetProviderCooldowns();
  }
};

const messages = [{ role: "user", content: "hi" }];

test("a rate limited provider hands the same request to the fallback", async () => {
  let geminiCalls = 0;
  await withStubs(
    async () => { throw new RateLimitError("minimax", "rate limit exceeded(RPM)", 1000); },
    async () => { geminiCalls += 1; return { text: "from gemini", model: "gemini-2.5-flash" }; },
    async () => {
      const result = await callLLM(messages, { label: "test" });
      assert.equal(result.provider, "gemini");
      assert.equal(result.text, "from gemini");
      assert.equal(geminiCalls, 1, "the fallback runs the same call once, so no work is lost");
    },
  );
});

test("later calls skip the parked provider until its cooldown expires, then return to it", async () => {
  let minimaxCalls = 0;
  await withStubs(
    async () => {
      minimaxCalls += 1;
      if (minimaxCalls === 1) throw new RateLimitError("minimax", "rate limited", 100);
      return { text: "from minimax", model: "MiniMax-M3" };
    },
    async () => ({ text: "from gemini", model: "gemini-2.5-flash" }),
    async () => {
      assert.equal((await callLLM(messages)).provider, "gemini");
      // Still parked: the second call must not touch minimax again.
      assert.equal((await callLLM(messages)).provider, "gemini");
      assert.equal(minimaxCalls, 1);
      const parked = providerStatus().find((p) => p.provider === "minimax");
      assert.equal(parked.available, false);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      // Cooldown elapsed, so the preferred provider is used again.
      assert.equal((await callLLM(messages)).provider, "minimax");
    },
  );
});

test("when both providers are rate limited the call waits and then succeeds", async () => {
  let attempts = 0;
  await withStubs(
    async () => { attempts += 1; if (attempts <= 1) throw new RateLimitError("minimax", "rate limited", 150); return { text: "recovered", model: "MiniMax-M3" }; },
    async () => { throw new RateLimitError("gemini", "quota exceeded", 150); },
    async () => {
      const result = await callLLM(messages, { label: "test" });
      assert.equal(result.text, "recovered");
      assert.equal(result.provider, "minimax");
    },
  );
});

test("a non rate-limit failure is not silently masked by the fallback", async () => {
  await withStubs(
    async () => { const e = new Error("bad request"); e.status = 400; throw e; },
    async () => ({ text: "from gemini", model: "gemini-2.5-flash" }),
    async () => { await assert.rejects(() => callLLM(messages), /bad request/); },
  );
});

test("the rate limiter allows a burst then refuses with Retry-After", () => {
  const limiter = createRateLimiter({ windowMs: 60000, max: 3, name: "questions" });
  const headers = {};
  const res = { set: (k, v) => { headers[k] = v; } };
  const req = { owner: "someone" };
  let allowed = 0;
  for (let i = 0; i < 3; i += 1) limiter(req, res, () => { allowed += 1; });
  assert.equal(allowed, 3);
  assert.equal(headers["X-RateLimit-Remaining"], "0");
  assert.throws(() => limiter(req, res, () => { allowed += 1; }), /Too many questions/);
  assert.ok(Number(headers["Retry-After"]) > 0);
  // A different workspace has its own budget.
  limiter({ owner: "another" }, res, () => { allowed += 1; });
  assert.equal(allowed, 4);
});

test("a call keeps cycling providers while both are limited instead of dropping the work", async () => {
  const previous = process.env.LLM_RATE_LIMIT_BUDGET_MS;
  process.env.LLM_RATE_LIMIT_BUDGET_MS = "20000";
  let attempts = 0;
  try {
    await withStubs(
      async () => {
        attempts += 1;
        // Busy for the first few rounds, which previously exhausted the fixed round budget.
        if (attempts <= 4) throw new RateLimitError("minimax", "rate limited", 100);
        return { text: "eventually served", model: "MiniMax-M3" };
      },
      async () => { throw new RateLimitError("gemini", "quota exceeded", 100); },
      async () => {
        const result = await callLLM(messages, { label: "test" });
        assert.equal(result.text, "eventually served");
        assert.ok(attempts >= 5, "kept retrying rather than failing after a fixed number of rounds");
      },
    );
  } finally {
    if (previous === undefined) delete process.env.LLM_RATE_LIMIT_BUDGET_MS;
    else process.env.LLM_RATE_LIMIT_BUDGET_MS = previous;
  }
});

test("the budget still bounds a permanently limited provider set", async () => {
  const previous = process.env.LLM_RATE_LIMIT_BUDGET_MS;
  process.env.LLM_RATE_LIMIT_BUDGET_MS = "1500";
  try {
    await withStubs(
      async () => { throw new RateLimitError("minimax", "rate limited", 1000); },
      async () => { throw new RateLimitError("gemini", "quota exceeded", 1000); },
      async () => { await assert.rejects(() => callLLM(messages, { label: "test" }), /stayed rate limited/); },
    );
  } finally {
    if (previous === undefined) delete process.env.LLM_RATE_LIMIT_BUDGET_MS;
    else process.env.LLM_RATE_LIMIT_BUDGET_MS = previous;
  }
});
