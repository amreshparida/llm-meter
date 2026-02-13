/**
 * Example: spending caps (cost + token caps)
 *
 * Run:
 *   npm run build
 *   node examples/spend-cap.mjs
 */

import { LlmMeter, CostLimitExceeded, TokenCapExceeded, cap } from "../dist/index.mjs";

const meter = new LlmMeter();

console.log("Starting summary:", meter.summary);

try {
  await cap({ maxCostUsd: 0.01, maxTokens: 500, meter }).run((scope) => {
    meter.record({ model: "gpt-4o", inputTokens: 120, outputTokens: 35, provider: "openai" });
    console.log("After first record:");
    console.log("  used:", scope.currentUsage);
    console.log("  remainingBudget:", scope.remainingBudget);
    console.log("  remainingTokens:", scope.remainingTokens);

    // Push it over the edge intentionally.
    meter.record({ model: "gpt-4o", inputTokens: 400, outputTokens: 200, provider: "openai" });
  });
} catch (err) {
  if (err instanceof CostLimitExceeded) {
    console.error("\nCost cap hit:", { current: err.currentCost, max: err.maxCost });
  } else if (err instanceof TokenCapExceeded) {
    console.error("\nToken cap hit:", { current: err.currentTokens, max: err.maxTokens });
  } else {
    throw err;
  }
}

console.log("\nFinal summary:", meter.summary);

