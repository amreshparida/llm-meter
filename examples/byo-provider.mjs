/**
 * Example: Bring-your-own provider (custom response shape)
 *
 * This is how you meter an internal LLM gateway / proxy / self-hosted model
 * where you control the response schema.
 *
 * Run:
 *   npm run build
 *   node examples/byo-provider.mjs
 */

import { BringYourOwnProvider, LlmMeter, defineModel, renderUsageTable } from "../dist/index.mjs";

const meter = new LlmMeter();

// Define pricing for your custom model id.
defineModel("my-model", { inputPer1k: 0.001, outputPer1k: 0.002, provider: "my-llm" });

const byo = new BringYourOwnProvider({
  meter,
  providerName: "my-llm",
  extractModel: (r) => r.model,
  extractInputTokens: (r) => r.usage.input,
  extractOutputTokens: (r) => r.usage.output
});

// Simulated API responses (your schema can be anything).
const responses = [
  { model: "my-model", usage: { input: 123, output: 45 } },
  { model: "my-model", usage: { input: 50, output: 10 } }
];

for (const r of responses) byo.record(r);

console.log(renderUsageTable(meter));
console.log("\nBreakdown:", meter.breakdown);

