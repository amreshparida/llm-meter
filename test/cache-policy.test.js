import test from "node:test";
import assert from "node:assert/strict";

import { BoundedMemoryCache } from "../dist/index.mjs";

test("BoundedMemoryCache: evicts least-recently-used", () => {
  const cache = new BoundedMemoryCache({ maxEntries: 2 });

  cache.set("a", 1);
  cache.set("b", 2);

  // Touch "a" so "b" becomes LRU.
  assert.equal(cache.get("a"), 1);

  cache.set("c", 3);

  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("c"), 3);
});

test("BoundedMemoryCache: TTL expires entries", async () => {
  const cache = new BoundedMemoryCache({ maxEntries: 10, ttlMs: 20 });

  cache.set("x", 123);
  assert.equal(cache.get("x"), 123);

  await new Promise((r) => setTimeout(r, 30));
  assert.equal(cache.get("x"), undefined);
});

