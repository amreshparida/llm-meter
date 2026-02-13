import test from "node:test";
import assert from "node:assert/strict";

import { LlmMeter } from "../dist/index.mjs";

test("tracker: initialization", () => {
  const meter = new LlmMeter();
  assert.equal(meter.summary.tokens, 0);
  assert.equal(meter.summary.costUsd, 0);
  assert.equal(meter.summary.calls, 0);
});

test("tracker: track usage", () => {
  const meter = new LlmMeter();
  meter.record({ model: "gpt-4o", inputTokens: 100, outputTokens: 50, provider: "openai" });

  const u = meter.summary;
  assert.equal(u.tokens, 150);
  assert.equal(u.inputTokens, 100);
  assert.equal(u.outputTokens, 50);
  assert.equal(u.calls, 1);
  assert.ok(u.costUsd > 0);
});

test("tracker: multiple providers", () => {
  const meter = new LlmMeter();
  meter.record({ model: "gpt-4o", inputTokens: 100, outputTokens: 50, provider: "openai" });
  meter.record({
    model: "claude-sonnet-4-5",
    inputTokens: 200,
    outputTokens: 100,
    provider: "anthropic"
  });

  assert.equal(meter.summary.tokens, 450);
  assert.equal(meter.summary.calls, 2);

  const by = meter.breakdown;
  assert.equal(by.openai.tokens, 150);
  assert.equal(by.anthropic.tokens, 300);
});

test("tracker: cache stats", () => {
  const meter = new LlmMeter();
  meter.noteCacheMiss();
  meter.noteCacheHit(100, 0.01);

  const s = meter.savings;
  assert.equal(s.hitCount, 1);
  assert.equal(s.missCount, 1);
  assert.equal(s.tokensSaved, 100);
  assert.equal(s.usdSaved, 0.01);
});

test("tracker: reset", () => {
  const meter = new LlmMeter();
  meter.record({ model: "gpt-4o", inputTokens: 100, outputTokens: 50, provider: "openai" });
  meter.noteCacheHit(50, 0.005);

  meter.clear();
  assert.equal(meter.summary.tokens, 0);
  assert.equal(meter.savings.hitCount, 0);
  assert.equal(Object.keys(meter.breakdown).length, 0);
});

test("tracker: concurrency (single-thread)", async () => {
  const meter = new LlmMeter();
  const tasks = Array.from({ length: 10 }, async () => {
    for (let i = 0; i < 100; i++) {
      meter.record({ model: "gpt-4o", inputTokens: 10, outputTokens: 5, provider: "openai" });
      await Promise.resolve();
    }
  });
  await Promise.all(tasks);
  assert.equal(meter.summary.calls, 1000);
  assert.equal(meter.summary.tokens, 15000);
});

