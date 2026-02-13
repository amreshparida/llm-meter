import { BoundedMemoryCache, DiskCache, MemoryCache, type AnyCache } from "./store";
import { getCurrentCapLike } from "./als";
import { estimateCostUsd } from "./rates";
import { renderUsageTable, saveUsageCsv, saveUsageJson } from "./reporting";
import { wrapAnthropic } from "./adapters/anthropicAdapter";
import { wrapOpenAI } from "./adapters/openaiAdapter";

export type UsageSummary = Readonly<{
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  calls: number;
}>;

class UsageCounter {
  tokens = 0;
  inputTokens = 0;
  outputTokens = 0;
  costUsd = 0;
  calls = 0;

  constructor(init?: Partial<UsageSummary>) {
    if (!init) return;
    if (init.tokens !== undefined) this.tokens = init.tokens;
    if (init.inputTokens !== undefined) this.inputTokens = init.inputTokens;
    if (init.outputTokens !== undefined) this.outputTokens = init.outputTokens;
    if (init.costUsd !== undefined) this.costUsd = init.costUsd;
    if (init.calls !== undefined) this.calls = init.calls;
  }

  add(other: UsageSummary): void {
    this.tokens += other.tokens;
    this.inputTokens += other.inputTokens;
    this.outputTokens += other.outputTokens;
    this.costUsd += other.costUsd;
    this.calls += other.calls;
  }

  snapshot(): UsageSummary {
    return Object.freeze({
      tokens: this.tokens,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      costUsd: this.costUsd,
      calls: this.calls
    });
  }
}

export type CacheSummary = Readonly<{
  hitCount: number;
  missCount: number;
  usdSaved: number;
  tokensSaved: number;
}>;

class CacheCounter {
  hitCount = 0;
  missCount = 0;
  usdSaved = 0;
  tokensSaved = 0;

  snapshot(): CacheSummary {
    return Object.freeze({
      hitCount: this.hitCount,
      missCount: this.missCount,
      usdSaved: this.usdSaved,
      tokensSaved: this.tokensSaved
    });
  }
}

export type MeterEvent = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  provider: string;
};

export type LlmMeterOptions =
  | { cache?: undefined | null }
  | { cache: "memory" }
  | { cache: "disk"; cacheDir?: string }
  | {
      cache: {
        backend: "memory";
        maxEntries: number;
        ttlMs?: number;
      };
    }
  | {
      cache: {
        backend: "disk";
        cacheDir?: string;
        maxEntries?: number;
        ttlMs?: number;
      };
    }
  | { cache: AnyCache };

export class LlmMeter {
  private usageState = new UsageCounter();
  private usageByProviderState = new Map<string, UsageCounter>();
  private cacheStatsState = new CacheCounter();
  private cache: AnyCache | undefined;

  constructor(opts: LlmMeterOptions = {}) {
    if (!("cache" in opts) || opts.cache == null) {
      this.cache = undefined;
    } else if (opts.cache === "memory") {
      this.cache = new MemoryCache();
    } else if (opts.cache === "disk") {
      const cacheDir = (opts as { cache: "disk"; cacheDir?: string }).cacheDir;
      this.cache = new DiskCache(cacheDir ? { cacheDir } : {});
    } else if (typeof opts.cache === "object" && "backend" in opts.cache) {
      if (opts.cache.backend === "memory") {
        this.cache = new BoundedMemoryCache(
          opts.cache.ttlMs === undefined
            ? { maxEntries: opts.cache.maxEntries }
            : { maxEntries: opts.cache.maxEntries, ttlMs: opts.cache.ttlMs }
        );
      } else {
        const diskOpts: { cacheDir?: string; maxEntries?: number; ttlMs?: number } = {};
        if (opts.cache.cacheDir !== undefined) diskOpts.cacheDir = opts.cache.cacheDir;
        if (opts.cache.maxEntries !== undefined) diskOpts.maxEntries = opts.cache.maxEntries;
        if (opts.cache.ttlMs !== undefined) diskOpts.ttlMs = opts.cache.ttlMs;
        this.cache = new DiskCache(diskOpts);
      }
    } else {
      this.cache = opts.cache;
    }
  }

  get summary(): UsageSummary {
    return this.usageState.snapshot();
  }

  get breakdown(): Readonly<Record<string, UsageSummary>> {
    const out: Record<string, UsageSummary> = {};
    for (const [k, v] of this.usageByProviderState.entries()) out[k] = v.snapshot();
    return out;
  }

  get spentUsd(): number {
    return this.usageState.costUsd;
  }

  get savings(): CacheSummary {
    return this.cacheStatsState.snapshot();
  }

  cacheStore(): AnyCache | undefined {
    return this.cache;
  }

  record(params: MeterEvent): void {
    const totalTokens = params.inputTokens + params.outputTokens;
    const cost = estimateCostUsd(params.model, params.inputTokens, params.outputTokens);
    const usage: UsageSummary = {
      tokens: totalTokens,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      costUsd: cost,
      calls: 1
    };

    this.usageState.add(usage);
    const existing = this.usageByProviderState.get(params.provider) ?? new UsageCounter();
    existing.add(usage);
    this.usageByProviderState.set(params.provider, existing);

    // Enhancement: enforce caps even for manual recording.
    getCurrentCapLike()?.checkLimits();
  }

  noteCacheHit(tokensSaved: number, usdSaved: number): void {
    this.cacheStatsState.hitCount += 1;
    this.cacheStatsState.tokensSaved += tokensSaved;
    this.cacheStatsState.usdSaved += usdSaved;
  }

  noteCacheMiss(): void {
    this.cacheStatsState.missCount += 1;
  }

  clear(): void {
    this.usageState = new UsageCounter();
    this.usageByProviderState.clear();
    this.cacheStatsState = new CacheCounter();
  }

  saveCsv(filepath: string): void {
    saveUsageCsv(this, filepath);
  }

  saveJson(filepath: string): void {
    saveUsageJson(this, filepath);
  }

  tableReport(): string {
    return renderUsageTable(this);
  }

  instrumentOpenAI<TClient extends object>(client: TClient): TClient {
    return wrapOpenAI(client, this) as unknown as TClient;
  }

  instrumentAnthropic<TClient extends object>(client: TClient): TClient {
    return wrapAnthropic(client, this) as unknown as TClient;
  }
}

