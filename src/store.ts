import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import v8 from "node:v8";
import { hashRequest } from "./text";

export type CacheRequest = Record<string, unknown>;

export interface Cache<T = unknown> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  clear(): void;
  makeKey(request: CacheRequest): string;
}

/**
 * Async cache interface (Redis/memcached-style clients).
 *
 * `makeKey` is kept synchronous so you can hash the request locally.
 */
export interface AsyncCache<T = unknown> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T): Promise<void>;
  clear(): Promise<void>;
  makeKey(request: CacheRequest): string;
}

export type AnyCache<T = unknown> = Cache<T> | AsyncCache<T>;

export class MemoryCache<T = unknown> implements Cache<T> {
  private cache = new Map<string, T>();

  get(key: string): T | undefined {
    return this.cache.get(key);
  }

  set(key: string, value: T): void {
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }

  makeKey(request: CacheRequest): string {
    return hashRequest(request);
  }
}

export type BoundedMemoryCacheOptions = {
  /**
   * Maximum number of unique keys to keep. When exceeded, least-recently-used
   * entries are evicted.
   */
  maxEntries: number;
  /** Optional TTL for each entry (milliseconds). */
  ttlMs?: number;
};

type CacheEntry<T> = {
  value: T;
  expiresAt?: number;
};

/**
 * In-memory cache with LRU eviction + optional TTL.
 *
 * This is a safer default for long-lived processes than an unbounded Map.
 */
export class BoundedMemoryCache<T = unknown> implements Cache<T> {
  private readonly maxEntries: number;
  private readonly ttlMs: number | undefined;
  private readonly cache = new Map<string, CacheEntry<T>>();

  constructor(opts: BoundedMemoryCacheOptions) {
    this.maxEntries = Math.max(1, Math.floor(opts.maxEntries));
    this.ttlMs = opts.ttlMs;
  }

  makeKey(request: CacheRequest): string {
    return hashRequest(request);
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // bump recency (Map maintains insertion order)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    const expiresAt =
      this.ttlMs !== undefined && Number.isFinite(this.ttlMs) ? Date.now() + this.ttlMs : undefined;

    if (this.cache.has(key)) this.cache.delete(key);
    if (expiresAt === undefined) {
      this.cache.set(key, { value });
    } else {
      this.cache.set(key, { value, expiresAt });
    }

    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.cache.delete(oldestKey);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

export type DiskCacheOptions = {
  cacheDir?: string;
  /**
   * Optional cap on number of entries stored on disk.
   * Enforced best-effort on writes via directory scan.
   */
  maxEntries?: number;
  /**
   * Optional TTL for entries (milliseconds). Implemented using file mtime.
   * Enforced best-effort on reads/writes.
   */
  ttlMs?: number;
};

export class DiskCache<T = unknown> implements Cache<T> {
  private cacheDir: string;
  private readonly maxEntries: number | undefined;
  private readonly ttlMs: number | undefined;

  constructor(opts: DiskCacheOptions = {}) {
    this.cacheDir = opts.cacheDir ?? path.join(os.tmpdir(), "llm_meter_cache");
    this.maxEntries = opts.maxEntries;
    this.ttlMs = opts.ttlMs;
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  makeKey(request: CacheRequest): string {
    return hashRequest(request);
  }

  private filePath(key: string): string {
    return path.join(this.cacheDir, `${key}.bin`);
  }

  private listCacheFiles(): string[] {
    try {
      return fs
        .readdirSync(this.cacheDir)
        .filter((f) => f.endsWith(".bin"))
        .map((f) => path.join(this.cacheDir, f));
    } catch {
      return [];
    }
  }

  private isExpired(filePath: string): boolean {
    if (this.ttlMs === undefined) return false;
    try {
      const stat = fs.statSync(filePath);
      return Date.now() - stat.mtimeMs > this.ttlMs;
    } catch {
      return true;
    }
  }

  private prune(): void {
    const files = this.listCacheFiles();

    // TTL purge
    if (this.ttlMs !== undefined) {
      for (const f of files) {
        if (this.isExpired(f)) {
          try {
            fs.unlinkSync(f);
          } catch {
            // ignore
          }
        }
      }
    }

    // max entries purge (oldest first)
    if (this.maxEntries !== undefined) {
      const remaining = this.listCacheFiles();
      if (remaining.length <= this.maxEntries) return;
      const withMtime = remaining
        .map((f) => {
          try {
            return { f, m: fs.statSync(f).mtimeMs };
          } catch {
            return { f, m: 0 };
          }
        })
        .sort((a, b) => a.m - b.m);
      const toDelete = withMtime.slice(0, Math.max(0, withMtime.length - this.maxEntries));
      for (const { f } of toDelete) {
        try {
          fs.unlinkSync(f);
        } catch {
          // ignore
        }
      }
    }
  }

  get(key: string): T | undefined {
    const p = this.filePath(key);
    if (!fs.existsSync(p)) return undefined;
    if (this.isExpired(p)) {
      try {
        fs.unlinkSync(p);
      } catch {
        // ignore
      }
      return undefined;
    }
    try {
      const buf = fs.readFileSync(p);
      return v8.deserialize(buf) as T;
    } catch {
      return undefined;
    }
  }

  set(key: string, value: T): void {
    const p = this.filePath(key);
    try {
      const buf = v8.serialize(value);
      fs.writeFileSync(p, buf);
      // best-effort enforcement
      this.prune();
    } catch {
      // best-effort cache; ignore errors
    }
  }

  clear(): void {
    try {
      for (const file of fs.readdirSync(this.cacheDir)) {
        if (!file.endsWith(".bin")) continue;
        try {
          fs.unlinkSync(path.join(this.cacheDir, file));
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }
}

