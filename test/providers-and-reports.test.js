import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { LlmMeter, renderUsageTable } from "../dist/index.mjs";

test("providers: openai wrapper tracks usage + caching saves cost", () => {
  const meter = new LlmMeter({ cache: "memory" });

  const mockResponse = {
    model: "gpt-4o",
    usage: { prompt_tokens: 100, completion_tokens: 50 }
  };

  const mockClient = {
    chat: {
      completions: {
        create: () => mockResponse
      }
    }
  };

  const wrapped = meter.instrumentOpenAI(mockClient);

  wrapped.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });
  assert.equal(meter.summary.calls, 1);
  assert.equal(meter.summary.tokens, 150);

  // identical request: cache hit (no extra calls counted, but saved stats updated)
  wrapped.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });
  assert.equal(meter.summary.calls, 1);
  assert.equal(meter.savings.hitCount, 1);
  assert.ok(meter.savings.usdSaved > 0);
});

test("providers: anthropic wrapper tracks usage", () => {
  const meter = new LlmMeter();

  const mockResponse = {
    model: "claude-sonnet-4-5",
    usage: { input_tokens: 100, output_tokens: 50 }
  };

  const mockClient = {
    messages: {
      create: () => mockResponse
    }
  };

  const wrapped = meter.instrumentAnthropic(mockClient);
  wrapped.messages.create({ model: "claude-sonnet-4-5", messages: [{ role: "user", content: "hi" }] });

  assert.equal(meter.summary.calls, 1);
  assert.equal(meter.summary.tokens, 150);
});

test("reports: table report + CSV/JSON exports", () => {
  const meter = new LlmMeter();
  meter.record({ model: "gpt-4o", inputTokens: 100, outputTokens: 50, provider: "openai" });

  const table = renderUsageTable(meter);
  assert.ok(table.includes("llm-meter Usage Report"));
  assert.ok(table.includes("openai"));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-meter-test-"));
  const csvPath = path.join(dir, "usage.csv");
  const jsonPath = path.join(dir, "usage.json");

  meter.saveCsv(csvPath);
  meter.saveJson(jsonPath);

  assert.ok(fs.readFileSync(csvPath, "utf8").includes("provider,calls,tokens,input_tokens,output_tokens"));
  const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(parsed.total.tokens, 150);
});

