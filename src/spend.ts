import { CostLimitExceeded, TokenCapExceeded } from "./errors";
import { getCurrentCapLike, runWithCapLike } from "./als";
import { LlmMeter, type UsageSummary } from "./meter";

export type CapOptions = {
  maxCostUsd?: number;
  maxTokens?: number;
  meter?: LlmMeter;
};

export class SpendLimit {
  readonly maxCostUsd: number | undefined;
  readonly maxTokens: number | undefined;
  readonly meter: LlmMeter;
  private initial: UsageSummary;

  constructor(opts: CapOptions = {}) {
    this.maxCostUsd = opts.maxCostUsd;
    this.maxTokens = opts.maxTokens;
    this.meter = opts.meter ?? new LlmMeter();
    this.initial = this.meter.summary;
  }

  get currentUsage(): UsageSummary {
    const cur = this.meter.summary;
    return Object.freeze({
      tokens: cur.tokens - this.initial.tokens,
      inputTokens: cur.inputTokens - this.initial.inputTokens,
      outputTokens: cur.outputTokens - this.initial.outputTokens,
      costUsd: cur.costUsd - this.initial.costUsd,
      calls: cur.calls - this.initial.calls
    });
  }

  get remainingBudget(): number | undefined {
    if (this.maxCostUsd === undefined) return undefined;
    return Math.max(0, this.maxCostUsd - this.currentUsage.costUsd);
  }

  get remainingTokens(): number | undefined {
    if (this.maxTokens === undefined) return undefined;
    return Math.max(0, this.maxTokens - this.currentUsage.tokens);
  }

  checkLimits(): void {
    const usage = this.currentUsage;
    if (this.maxCostUsd !== undefined && usage.costUsd > this.maxCostUsd) {
      throw new CostLimitExceeded(
        `Spending cap exceeded: $${usage.costUsd.toFixed(4)} > $${this.maxCostUsd.toFixed(4)}`,
        { currentCost: usage.costUsd, maxCost: this.maxCostUsd }
      );
    }

    if (this.maxTokens !== undefined && usage.tokens > this.maxTokens) {
      throw new TokenCapExceeded(`Token cap exceeded: ${usage.tokens} > ${this.maxTokens}`, {
        currentTokens: usage.tokens,
        maxTokens: this.maxTokens
      });
    }
  }

  /**
   * Run a function inside this spending scope. Limits are checked after the
   * function finishes (and also opportunistically by provider wrappers).
   */
  async run<T>(fn: (ctx: SpendLimit) => T | Promise<T>): Promise<T> {
    return await runWithCapLike(this, async () => {
      const result = await fn(this);
      this.checkLimits();
      return result;
    });
  }

  /** Wrap a function so it executes under this cap. */
  wrap<Args extends unknown[], Ret>(fn: (...args: Args) => Ret | Promise<Ret>) {
    return async (...args: Args): Promise<Ret> => {
      return await this.run(() => fn(...args));
    };
  }
}

export function currentSpendLimit(): SpendLimit | undefined {
  return getCurrentCapLike() as SpendLimit | undefined;
}

export function cap(opts: CapOptions = {}): SpendLimit {
  return new SpendLimit(opts);
}

