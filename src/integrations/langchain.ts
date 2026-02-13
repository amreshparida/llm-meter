import type { LlmMeter } from "../meter";
import { defineModel, pricingFor } from "../rates";

export type LangChainMeterOptions = {
  /**
   * Optional fallback model id to use if LangChain does not provide one on the result.
   */
  model?: string;
  /**
   * Optional provider label used in `meter.breakdown` (e.g. "openai", "anthropic").
   * If omitted, we'll try to infer it from the pricing DB.
   */
  provider?: string;
  /**
   * What to do when pricing is missing for a model:
   * - "throw": keep default behavior (UnknownModelError will bubble)
   * - "zero": auto-register the model with 0 pricing so tokens are still counted
   */
  unknownModel?: "throw" | "zero";
};

function firstString(...values: any[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.length) return v;
  }
  return undefined;
}

function coerceNumber(value: any): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function extractTokenUsage(output: any): { promptTokens: number; completionTokens: number } {
  const llmOutput = output?.llmOutput ?? output?.llm_output ?? output?.output ?? output;

  const tu =
    llmOutput?.tokenUsage ??
    llmOutput?.token_usage ??
    llmOutput?.usage ??
    llmOutput?.token_usage ??
    llmOutput?.token_usage ??
    undefined;

  const promptTokens = coerceNumber(
    tu?.promptTokens ?? tu?.prompt_tokens ?? tu?.input_tokens ?? tu?.inputTokens ?? tu?.prompt_token_count
  );
  const completionTokens = coerceNumber(
    tu?.completionTokens ??
      tu?.completion_tokens ??
      tu?.output_tokens ??
      tu?.outputTokens ??
      tu?.candidatesTokenCount ??
      tu?.candidates_token_count
  );

  // Some providers only provide totalTokens; count as input to avoid guessing.
  const total = coerceNumber(tu?.totalTokens ?? tu?.total_tokens ?? tu?.totalTokenCount ?? tu?.total_token_count);
  if (promptTokens === 0 && completionTokens === 0 && total > 0) {
    return { promptTokens: total, completionTokens: 0 };
  }

  return { promptTokens, completionTokens };
}

function extractModelId(output: any, opts: LangChainMeterOptions): string {
  const llmOutput = output?.llmOutput ?? output?.llm_output ?? output?.output ?? output;

  const fromOutput = firstString(
    llmOutput?.model,
    llmOutput?.model_name,
    llmOutput?.modelName,
    llmOutput?.modelId,
    output?.model,
    output?.model_name,
    output?.modelName
  );

  const fromGenerations = firstString(
    output?.generations?.[0]?.[0]?.generationInfo?.model,
    output?.generations?.[0]?.[0]?.generationInfo?.model_name,
    output?.generations?.[0]?.[0]?.generationInfo?.modelName
  );

  return fromOutput ?? fromGenerations ?? opts.model ?? "unknown";
}

function inferProvider(model: string, opts: LangChainMeterOptions): string {
  if (opts.provider) return opts.provider;
  try {
    return pricingFor(model).provider;
  } catch {
    return "unknown";
  }
}

function ensurePricing(model: string, provider: string, opts: LangChainMeterOptions): void {
  if (opts.unknownModel !== "zero") return;
  try {
    pricingFor(model);
  } catch {
    defineModel(model, { inputPer1k: 0, outputPer1k: 0, provider });
  }
}

/**
 * Create a LangChain callback handler that records token usage into `LlmMeter`.
 *
 * Usage (LangChain):
 * - Pass this in `callbacks: [handler]` when creating a model, or in the `.invoke(..., { callbacks })` config.
 *
 * This is dependency-free (no `langchain` import) and uses structural typing.
 */
export function createLangChainCallbacks(meter: LlmMeter, opts: LangChainMeterOptions = {}): {
  handleLLMEnd: (output: any, ...args: any[]) => void | Promise<void>;
  handleChatModelEnd: (output: any, ...args: any[]) => void | Promise<void>;
  handleLLMError: (err: any, ...args: any[]) => void | Promise<void>;
  handleChainError: (err: any, ...args: any[]) => void | Promise<void>;
} {
  const recordFromOutput = (output: any) => {
    const model = extractModelId(output, opts);
    const { promptTokens, completionTokens } = extractTokenUsage(output);
    if (promptTokens === 0 && completionTokens === 0) return;

    const provider = inferProvider(model, opts);
    ensurePricing(model, provider, opts);

    meter.record({
      model,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      provider
    });
  };

  return {
    handleLLMEnd: (output: any) => recordFromOutput(output),
    handleChatModelEnd: (output: any) => recordFromOutput(output),
    // No special behavior; present so users can pass this as a generic callback handler.
    handleLLMError: () => {},
    handleChainError: () => {}
  };
}

