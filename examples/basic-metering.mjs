/**
 * Example: basic manual metering (no SDKs required)
 *
 * Run:
 *   npm run build
 *   node examples/basic-metering.mjs
 */

import { LlmMeter, renderUsageTable } from "../dist/index.mjs";

const meter = new LlmMeter();

// Manually record a couple of synthetic calls.
meter.record({ model: "gpt-4o", inputTokens: 120, outputTokens: 35, provider: "openai" });
meter.record({ model: "claude-sonnet-4-5", inputTokens: 80, outputTokens: 40, provider: "anthropic" });

console.log(renderUsageTable(meter));
console.log("\nRaw summary:", meter.summary);
console.log("Raw breakdown:", meter.breakdown);
console.log("Spent (USD):", meter.spentUsd.toFixed(6));

