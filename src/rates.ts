import { UnknownModelError } from "./errors";

export type ProviderId = "openai" | "anthropic" | "google" | "custom" | (string & {});

export type ModelPricing = {
  inputPer1k: number;
  outputPer1k: number;
  provider: ProviderId;
};

// Pricing database (as of February 2026)
// Notes:
// - Stored as USD per 1k tokens (i.e. divide official "$/1M tokens" by 1000).
// - These are best-effort "standard" text-token rates from provider pricing pages.
// - Some providers vary pricing by context length / modality; we store the common
//   baseline text rates for quick estimation.
const PRICING_DB: Record<string, ModelPricing> = {
  // OpenAI models
  // Latest stable family (keep small, commonly used defaults)
  "gpt-5.2": { inputPer1k: 0.00175, outputPer1k: 0.014, provider: "openai" },
  "gpt-5-mini": { inputPer1k: 0.00025, outputPer1k: 0.002, provider: "openai" },
  // Widely used workhorses
  "gpt-4.1-mini": { inputPer1k: 0.0004, outputPer1k: 0.0016, provider: "openai" },
  "gpt-4o": { inputPer1k: 0.0025, outputPer1k: 0.01, provider: "openai" },
  "gpt-4o-mini": { inputPer1k: 0.00015, outputPer1k: 0.0006, provider: "openai" },
  // Reasoning / o-series (stable + widely used)
  o1: { inputPer1k: 0.015, outputPer1k: 0.06, provider: "openai" },
  o3: { inputPer1k: 0.002, outputPer1k: 0.008, provider: "openai" },
  "o4-mini": { inputPer1k: 0.0011, outputPer1k: 0.0044, provider: "openai" },

  // Anthropic models
  "claude-opus-4-5": { inputPer1k: 0.005, outputPer1k: 0.025, provider: "anthropic" },
  "claude-sonnet-4-5": { inputPer1k: 0.003, outputPer1k: 0.015, provider: "anthropic" },
  "claude-haiku-4-5": { inputPer1k: 0.001, outputPer1k: 0.005, provider: "anthropic" },

  // Google models
  // Gemini 2.5 pricing can vary by prompt length; these are the <= 200k token rates.
  "gemini-2.5-pro": { inputPer1k: 0.00125, outputPer1k: 0.01, provider: "google" },
  "gemini-2.5-flash": { inputPer1k: 0.0003, outputPer1k: 0.0025, provider: "google" },
  "gemini-2.5-flash-lite": { inputPer1k: 0.0001, outputPer1k: 0.0004, provider: "google" },
  "gemini-2.0-flash": { inputPer1k: 0.0001, outputPer1k: 0.0004, provider: "google" },
  "gemini-2.0-flash-lite": { inputPer1k: 0.000075, outputPer1k: 0.0003, provider: "google" },

  // Groq (OpenAI-compatible API; production models)
  "llama-3.1-8b-instant": { inputPer1k: 0.00005, outputPer1k: 0.00008, provider: "groq" },
  "llama-3.3-70b-versatile": { inputPer1k: 0.00059, outputPer1k: 0.00079, provider: "groq" },
  "openai/gpt-oss-20b": { inputPer1k: 0.000075, outputPer1k: 0.0003, provider: "groq" },
  "openai/gpt-oss-120b": { inputPer1k: 0.00015, outputPer1k: 0.0006, provider: "groq" },

  // DeepSeek (OpenAI-compatible API)
  // Prices use the "cache miss" input rate + output rate (DeepSeek pricing varies with cache hits).
  "deepseek-chat": { inputPer1k: 0.00027, outputPer1k: 0.0011, provider: "deepseek" },
  "deepseek-reasoner": { inputPer1k: 0.00055, outputPer1k: 0.00219, provider: "deepseek" }
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

