/**
 * Example: custom async cache backend (Redis/memcached style)
 *
 * Your cache can be Promise-based and llm-meter will await it during
 * instrumentation.
 *
 * This example uses an async Map-backed cache as a stand-in for Redis.
 */

import { LlmMeter, renderUsageTable } from "../dist/index.mjs";

const store = new Map();
const asyncCache = {
  makeKey: (req) => JSON.stringify(req),
  get: async (k) => store.get(k),
  set: async (k, v) => void store.set(k, v),
  clear: async () => void store.clear()
};

const meter = new LlmMeter({ cache: asyncCache });

let calls = 0;
const openaiLike = {
  chat: {
    completions: {
      create: async () => {
        calls += 1;
        return {
          model: "gpt-4o",
          usage: { prompt_tokens: 100, completion_tokens: 50 }
        };
      }
    }
  }
};

const client = meter.instrumentOpenAI(openaiLike);

await client.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });
await client.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });

console.log("Underlying SDK calls:", calls);
console.log(renderUsageTable(meter));
console.log("Savings:", meter.savings);

