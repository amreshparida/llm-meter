import fs from "node:fs";
import { formatCost, formatNumber } from "./text";
import type { LlmMeter } from "./meter";

export function renderUsageTable(meter: LlmMeter): string {
  const providerRollup = meter.breakdown;
  const providers = Object.keys(providerRollup);
  const cacheRollup = meter.savings;

  if (providers.length === 0) return "No usage data to report.";

  const providerWidth = Math.max(
    "Provider".length,
    providers.reduce((m, p) => Math.max(m, p.length), 0)
  );

  const lines: string[] = [];
  const innerWidth = providerWidth + 32;
  const title = "llm-meter Usage Report";
  lines.push("┌" + "─".repeat(innerWidth) + "┐");
  lines.push("│" + ` ${title}`.padEnd(innerWidth) + "│");
  lines.push("├" + "─".repeat(innerWidth) + "┤");
  lines.push(`│ ${"Provider".padEnd(providerWidth)} │ Calls │ Tokens │ Cost   │`);
  lines.push("├" + "─".repeat(innerWidth) + "┤");

  for (const provider of providers.sort()) {
    const usage = providerRollup[provider]!;
    const tokensStr = formatNumber(usage.tokens);
    const costStr = formatCost(usage.costUsd);
    lines.push(
      `│ ${provider.padEnd(providerWidth)} │ ${String(usage.calls).padStart(5)} │ ${tokensStr.padStart(
        6
      )} │ ${costStr.padStart(6)} │`
    );
  }

  const total = meter.summary;
  lines.push("├" + "─".repeat(innerWidth) + "┤");
  lines.push(
    `│ ${"Total".padEnd(providerWidth)} │ ${String(total.calls).padStart(5)} │ ${formatNumber(
      total.tokens
    ).padStart(6)} │ ${formatCost(total.costUsd).padStart(6)} │`
  );

  if (cacheRollup.hitCount > 0) {
    lines.push(
      `│ ${"Cache Saved".padEnd(providerWidth)} │ ${"".padStart(5)} │ ${formatNumber(
        cacheRollup.tokensSaved
      ).padStart(6)} │ ${formatCost(cacheRollup.usdSaved).padStart(6)} │`
    );
  }

  lines.push("└" + "─".repeat(innerWidth) + "┘");
  return lines.join("\n");
}

export function saveUsageCsv(meter: LlmMeter, filepath: string): void {
  const providerRollup = meter.breakdown;
  const providers = Object.keys(providerRollup).sort();

  const rows: string[] = [];
  rows.push("provider,calls,tokens,input_tokens,output_tokens,cost_usd");
  for (const provider of providers) {
    const u = providerRollup[provider]!;
    rows.push(
      [provider, u.calls, u.tokens, u.inputTokens, u.outputTokens, u.costUsd.toFixed(6)].join(",")
    );
  }

  fs.writeFileSync(filepath, rows.join("\n"));
}

export function saveUsageJson(meter: LlmMeter, filepath: string): void {
  const providerRollup = meter.breakdown;
  const cacheRollup = meter.savings;

  const data = {
    total: meter.summary,
    by_provider: providerRollup,
    cache_stats: {
      hit_count: cacheRollup.hitCount,
      miss_count: cacheRollup.missCount,
      tokens_saved: cacheRollup.tokensSaved,
      usd_saved: cacheRollup.usdSaved
    }
  };

  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

