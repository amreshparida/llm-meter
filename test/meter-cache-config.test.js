import test from "node:test";
import assert from "node:assert/strict";

import { BoundedMemoryCache, DiskCache, LlmMeter } from "../dist/index.mjs";

test("LlmMeter: cache config object creates bounded memory cache", () => {
  const meter = new LlmMeter({ cache: { backend: "memory", maxEntries: 10, ttlMs: 1000 } });
  const store = meter.cacheStore();
  assert.ok(store instanceof BoundedMemoryCache);
});

test("LlmMeter: cache config object creates disk cache with pruning options", () => {
  const meter = new LlmMeter({ cache: { backend: "disk", maxEntries: 10, ttlMs: 1000 } });
  const store = meter.cacheStore();
  assert.ok(store instanceof DiskCache);
});

