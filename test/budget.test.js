import test from "node:test";
import assert from "node:assert/strict";

import { CostLimitExceeded, TokenCapExceeded, LlmMeter, cap } from "../dist/index.mjs";

test("budget: context run tracks delta usage", async () => {
  const meter = new LlmMeter();
  const ctx = cap({ maxCostUsd: 1.0, meter });

  await ctx.run(() => {
    meter.record({ model: "gpt-4o", inputTokens: 100, outputTokens: 50, provider: "openai" });
    assert.equal(ctx.currentUsage.tokens, 150);
    assert.ok(ctx.remainingBudget < 1.0);
  });
});

test("budget: exceeded throws CostLimitExceeded", async () => {
  const meter = new LlmMeter();
  const ctx = cap({ maxCostUsd: 0.001, meter });

  await assert.rejects(
    async () => {
      await ctx.run(() => {
        meter.record({ model: "gpt-4o", inputTokens: 1000, outputTokens: 1000, provider: "openai" });
      });
    },
    (err) => {
      assert.ok(err instanceof CostLimitExceeded);
      assert.ok(err.currentCost > 0.001);
      assert.equal(err.maxCost, 0.001);
      return true;
    }
  );
});

test("budget: token limit throws TokenCapExceeded", async () => {
  const meter = new LlmMeter();
  const ctx = cap({ maxTokens: 100, meter });

  await assert.rejects(
    async () => {
      await ctx.run(() => {
        meter.record({ model: "gpt-4o", inputTokens: 100, outputTokens: 50, provider: "openai" });
      });
    },
    (err) => {
      assert.ok(err instanceof TokenCapExceeded);
      assert.equal(err.currentTokens, 150);
      assert.equal(err.maxTokens, 100);
      return true;
    }
  );
});

test("budget: remaining budget/tokens", async () => {
  const meter = new LlmMeter();
  const ctx = cap({ maxCostUsd: 0.1, maxTokens: 1000, meter });

  assert.equal(ctx.remainingBudget, 0.1);
  assert.equal(ctx.remainingTokens, 1000);

  await ctx.run(() => {
    meter.record({ model: "gpt-4o", inputTokens: 100, outputTokens: 50, provider: "openai" });
    assert.equal(ctx.remainingTokens, 850);
    assert.ok(ctx.remainingBudget < 0.1);
  });
});

test("budget: no limits", async () => {
  const meter = new LlmMeter();
  const ctx = cap({ meter });

  await ctx.run(() => {
    meter.record({ model: "gpt-4o", inputTokens: 10000, outputTokens: 5000, provider: "openai" });
    assert.equal(ctx.remainingBudget, undefined);
    assert.equal(ctx.remainingTokens, undefined);
    assert.equal(ctx.currentUsage.tokens, 15000);
  });
});

