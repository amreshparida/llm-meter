import { UnknownModelError } from "./errors";

export type ProviderId = "openai" | "anthropic" | "google" | "custom" | (string & {});

export type ModelPricing = {
  inputPer1k: number;
  outputPer1k: number;
  provider: ProviderId;
};

// Pricing database (as of February 2026)
const PRICING_DB: Record<string, ModelPricing> = {
  // OpenAI models
  "gpt-4o": { inputPer1k: 0.0025, outputPer1k: 0.01, provider: "openai" },
  "gpt-4o-mini": { inputPer1k: 0.00015, outputPer1k: 0.0006, provider: "openai" },
  "gpt-4-turbo": { inputPer1k: 0.01, outputPer1k: 0.03, provider: "openai" },
  "gpt-4": { inputPer1k: 0.03, outputPer1k: 0.06, provider: "openai" },
  "gpt-3.5-turbo": { inputPer1k: 0.0005, outputPer1k: 0.0015, provider: "openai" },
  o1: { inputPer1k: 0.015, outputPer1k: 0.06, provider: "openai" },
  "o1-mini": { inputPer1k: 0.003, outputPer1k: 0.012, provider: "openai" },
  "o3-mini": { inputPer1k: 0.0011, outputPer1k: 0.0044, provider: "openai" },

  // Anthropic models
  "claude-opus-4-5": { inputPer1k: 0.015, outputPer1k: 0.075, provider: "anthropic" },
  "claude-opus-4-5-20251101": { inputPer1k: 0.015, outputPer1k: 0.075, provider: "anthropic" },
  "claude-sonnet-4-5": { inputPer1k: 0.003, outputPer1k: 0.015, provider: "anthropic" },
  "claude-sonnet-4-5-20250929": { inputPer1k: 0.003, outputPer1k: 0.015, provider: "anthropic" },
  "claude-haiku-4-5": { inputPer1k: 0.0008, outputPer1k: 0.004, provider: "anthropic" },
  "claude-haiku-4-5-20251001": { inputPer1k: 0.0008, outputPer1k: 0.004, provider: "anthropic" },
  "claude-3-5-sonnet-20241022": { inputPer1k: 0.003, outputPer1k: 0.015, provider: "anthropic" },
  "claude-3-opus-20240229": { inputPer1k: 0.015, outputPer1k: 0.075, provider: "anthropic" },

  // Google models
  "gemini-2.0-flash": { inputPer1k: 0.0, outputPer1k: 0.0, provider: "google" },
  "gemini-2.0-flash-exp": { inputPer1k: 0.0, outputPer1k: 0.0, provider: "google" },
  "gemini-1.5-pro": { inputPer1k: 0.00125, outputPer1k: 0.005, provider: "google" },
  "gemini-1.5-flash": { inputPer1k: 0.000075, outputPer1k: 0.0003, provider: "google" }
};

function resolveModelPricingKey(model: string): string | undefined {
  if (model in PRICING_DB) return model;

  // Common patterns:
  // - OpenAI: gpt-4o-mini-2024-07-18 (date suffix)
  // - Anthropic: sometimes already versioned in the table (YYYYMMDD), but we also
  //   try a fallback to the base id if present.
  const stripDashDate = model.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (stripDashDate !== model && stripDashDate in PRICING_DB) return stripDashDate;

  const stripCompactDate = model.replace(/-\d{8}$/, "");
  if (stripCompactDate !== model && stripCompactDate in PRICING_DB) return stripCompactDate;

  // Generic fallback: progressively strip trailing "-segment" pieces until we find a hit.
  // This helps with provider-specific ids like "...-latest" or "...-2024-xx".
  let cur = model;
  while (cur.includes("-")) {
    cur = cur.slice(0, cur.lastIndexOf("-"));
    if (cur in PRICING_DB) return cur;
  }

  return undefined;
}

export function pricingFor(model: string): ModelPricing {
  const key = resolveModelPricingKey(model);
  if (!key) {
    throw new UnknownModelError(
      `Model '${model}' not found in pricing database. Use defineModel() to add custom pricing.`
    );
  }
  // Cache alias for future lookups (fast path).
  if (key !== model) PRICING_DB[model] = PRICING_DB[key]!;
  return { ...PRICING_DB[key]! };
}

export function defineModel(
  model: string,
  price: Omit<ModelPricing, "provider"> & { provider?: ProviderId }
): void {
  PRICING_DB[model] = {
    inputPer1k: price.inputPer1k,
    outputPer1k: price.outputPer1k,
    provider: price.provider ?? "custom"
  };
}

export function listPricing(provider?: ProviderId): Record<string, ModelPricing> {
  if (!provider) return { ...PRICING_DB };
  const out: Record<string, ModelPricing> = {};
  for (const [k, v] of Object.entries(PRICING_DB)) {
    if (v.provider === provider) out[k] = { ...v };
  }
  return out;
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = pricingFor(model);
  const inputCost = (inputTokens / 1000) * price.inputPer1k;
  const outputCost = (outputTokens / 1000) * price.outputPer1k;
  return inputCost + outputCost;
}

