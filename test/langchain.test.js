import test from "node:test";
import assert from "node:assert/strict";

import { LlmMeter, createLangChainCallbacks, createLangGraphCallbacks } from "../dist/index.mjs";

test("langchain: callback records token usage (OpenAI-like llmOutput.tokenUsage)", () => {
  const meter = new LlmMeter();
  const cb = createLangChainCallbacks(meter, { provider: "openai", model: "gpt-4o" });

  cb.handleLLMEnd({
    llmOutput: {
      tokenUsage: { promptTokens: 100, completionTokens: 50 }
    }
  });

  assert.equal(meter.summary.calls, 1);
  assert.equal(meter.summary.tokens, 150);
  assert.equal(meter.breakdown.openai.calls, 1);
});

test("langchain: unknownModel=zero auto-registers model with 0 pricing", () => {
  const meter = new LlmMeter();
  const cb = createLangChainCallbacks(meter, { provider: "custom", model: "my-unknown-model", unknownModel: "zero" });

  cb.handleLLMEnd({
    llmOutput: {
      modelName: "my-unknown-model",
      tokenUsage: { promptTokens: 10, completionTokens: 5 }
    }
  });

  assert.equal(meter.summary.calls, 1);
  assert.equal(meter.summary.tokens, 15);
  assert.equal(meter.summary.costUsd, 0);
});

test("langgraph: callback helper is wired (alias)", () => {
  const meter = new LlmMeter();
  const cb = createLangGraphCallbacks(meter, { provider: "openai", model: "gpt-4o" });

  cb.handleLLMEnd({
    llmOutput: {
      tokenUsage: { promptTokens: 1, completionTokens: 2 }
    }
  });

  assert.equal(meter.summary.calls, 1);
  assert.equal(meter.summary.tokens, 3);
});

