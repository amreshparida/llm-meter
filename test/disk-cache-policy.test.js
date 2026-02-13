import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DiskCache } from "../dist/index.mjs";

function mkdtemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("DiskCache: ttlMs expires by mtime (best-effort)", () => {
  const dir = mkdtemp("llm-meter-diskcache-");
  const cache = new DiskCache({ cacheDir: dir, ttlMs: 10 });

  cache.set("k", { v: 1 });
  const file = path.join(dir, "k.bin");
  assert.ok(fs.existsSync(file));

  // Backdate mtime to force expiry.
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(file, old, old);

  assert.equal(cache.get("k"), undefined);
  assert.ok(!fs.existsSync(file));
});

test("DiskCache: maxEntries prunes oldest (best-effort)", () => {
  const dir = mkdtemp("llm-meter-diskcache-");
  const cache = new DiskCache({ cacheDir: dir, maxEntries: 2 });

  cache.set("a", { v: "a" });
  cache.set("b", { v: "b" });
  cache.set("c", { v: "c" });

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".bin"));
  assert.ok(files.length <= 2);
});

