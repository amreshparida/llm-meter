import type { LlmMeter } from "./meter";

export type StreamUsageHint = {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type StreamMeterOptions<TChunk> = {
  provider: string;
  model?: string;
  extract: (chunk: TChunk) => StreamUsageHint | null | undefined;
};

function isAsyncIterable<T = any>(value: any): value is AsyncIterable<T> {
  return value != null && typeof value[Symbol.asyncIterator] === "function";
}

function coerceNumber(value: any): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Wrap an AsyncIterable stream so that `meter.record(...)` runs once when the stream completes,
 * using the last non-zero usage hint extracted from emitted chunks.
 *
 * This is only as accurate as the provider's streaming chunks. If the stream never reports usage,
 * nothing is recorded.
 */
export function meterStream<TChunk>(
  stream: unknown,
  meter: LlmMeter,
  opts: StreamMeterOptions<TChunk>
): unknown {
  if (!isAsyncIterable<TChunk>(stream)) return stream;

  return {
    async *[Symbol.asyncIterator]() {
      let last: StreamUsageHint | undefined;

      for await (const chunk of stream) {
        const hint = opts.extract(chunk) ?? undefined;
        if (hint) {
          const inTok = coerceNumber(hint.inputTokens);
          const outTok = coerceNumber(hint.outputTokens);
          const totalTok = coerceNumber(hint.totalTokens);
          if (inTok + outTok > 0 || totalTok > 0) last = hint;
        }

        yield chunk;
      }

      if (!last) return;

      const model = last.model ?? opts.model ?? "unknown";
      const inputTokens =
        last.inputTokens !== undefined
          ? coerceNumber(last.inputTokens)
          : last.totalTokens !== undefined
            ? coerceNumber(last.totalTokens)
            : 0;
      const outputTokens = last.outputTokens !== undefined ? coerceNumber(last.outputTokens) : 0;

      if (inputTokens === 0 && outputTokens === 0) return;

      meter.record({
        model,
        inputTokens,
        outputTokens,
        provider: opts.provider
      });
    }
  };
}

