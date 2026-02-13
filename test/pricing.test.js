import test from "node:test";
import assert from "node:assert/strict";

import { defineModel, estimateCostUsd, listPricing, pricingFor } from "../dist/index.mjs";

test("pricing: pricingFor + estimateCostUsd", () => {
  const p = pricingFor("gpt-4o");
  assert.equal(p.provider, "openai");
  assert.ok(p.inputPer1k > 0);
  assert.ok(p.outputPer1k > 0);

  const cost = estimateCostUsd("gpt-4o", 1000, 500);
  assert.ok(cost > 0);
});

test("pricing: versioned model ids fall back to base id", () => {
  // OpenAI sometimes returns model ids with date suffixes.
  const p = pricingFor("gpt-4o-mini-2024-07-18");
  assert.equal(p.provider, "openai");
  assert.ok(p.inputPer1k > 0);
  assert.ok(p.outputPer1k > 0);

  const cost = estimateCostUsd("gpt-4o-mini-2024-07-18", 1000, 500);
  assert.ok(cost > 0);
});

test("pricing: defineModel + listPricing filter", () => {
  defineModel("my-model", { inputPer1k: 0.001, outputPer1k: 0.002, provider: "my-llm" });
  const p = pricingFor("my-model");
  assert.equal(p.provider, "my-llm");

  const byProvider = listPricing("my-llm");
  assert.ok("my-model" in byProvider);
});

