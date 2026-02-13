/**
 * Example: custom synchronous cache backend
 *
 * This is useful if you already have an in-process cache implementation
 * (LRU/TTL/etc) and want llm-meter to use it for request deduplication.
 *
 * Note: most network caches (Redis/memcached) are async; use the async example
 * instead for those.
 */

import { LlmMeter, renderUsageTable } from "../dist/index.mjs";

// A tiny sync cache using a Map.
// (In production you likely want eviction/TTL.)
const store = new Map();
const syncCache = {
  makeKey: (req) => JSON.stringify(req),
  get: (k) => store.get(k),
  set: (k, v) => void store.set(k, v),
  clear: () => void store.clear()
};

const meter = new LlmMeter({ cache: syncCache });

const openaiLike = {
  chat: {
    completions: {
      create: () => ({
        model: "gpt-4o",
        usage: { prompt_tokens: 100, completion_tokens: 50 }
      })
    }
  }
};

const client = meter.instrumentOpenAI(openaiLike);

client.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });
client.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });

console.log(renderUsageTable(meter));
console.log("Savings:", meter.savings);

