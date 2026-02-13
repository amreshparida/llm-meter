import test from "node:test";
import assert from "node:assert/strict";

import { LlmMeter } from "../dist/index.mjs";

test("async cache: openai instrumentation works with async get/set", async () => {
  const store = new Map();
  const asyncCache = {
    makeKey: (req) => JSON.stringify(req),
    get: async (k) => store.get(k),
    set: async (k, v) => void store.set(k, v),
    clear: async () => void store.clear()
  };

  const meter = new LlmMeter({ cache: asyncCache });

  let calls = 0;
  const clientShape = {
    chat: {
      completions: {
        create: async () => {
          calls += 1;
          return { model: "gpt-4o", usage: { prompt_tokens: 100, completion_tokens: 50 } };
        }
      }
    }
  };

  const wrapped = meter.instrumentOpenAI(clientShape);

  await wrapped.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });
  await wrapped.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });

  assert.equal(calls, 1);
  assert.equal(meter.summary.calls, 1);
  assert.equal(meter.savings.hitCount, 1);
});

