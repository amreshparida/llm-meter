/**
 * Example: caching (memory + disk + bounded memory)
 *
 * Run:
 *   npm run build
 *   node examples/caching.mjs
 */

import { LlmMeter, renderUsageTable } from "../dist/index.mjs";

function makeOpenAiLikeClient() {
  const response = {
    model: "gpt-4o",
    usage: { prompt_tokens: 120, completion_tokens: 30 }
  };

  return {
    chat: {
      completions: {
        create: () => response
      }
    }
  };
}

function runScenario(label, meter) {
  const client = meter.instrumentOpenAI(makeOpenAiLikeClient());

  // First call -> miss, second identical call -> hit.
  client.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: "Hello" }] });
  client.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: "Hello" }] });

  console.log(`\n=== ${label} ===`);
  console.log(renderUsageTable(meter));
  console.log("Savings:", meter.savings);
}

runScenario("In-memory cache", new LlmMeter({ cache: "memory" }));
runScenario("Disk cache (persists across runs)", new LlmMeter({ cache: "disk" }));

runScenario(
  "Bounded in-memory cache (LRU + TTL)",
  new LlmMeter({ cache: { backend: "memory", maxEntries: 1000, ttlMs: 60_000 } })
);

console.log("\nTip: see examples/custom-cache-sync.mjs and examples/custom-cache-async.mjs for custom backends.");

