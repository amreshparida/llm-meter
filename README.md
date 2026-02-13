# llm-meter

Measure tokens, estimate spend, and enforce caps around LLM calls — with **zero external services**.

`llm-meter` is a small Node.js + TypeScript library that:

- Tracks tokens and USD cost per call
- Aggregates totals across providers/models
- Supports caching (memory or disk) to avoid paying twice for identical requests
- Enforces spending caps (cost + token caps) across sync/async flows
- Produces quick reports (table + CSV/JSON exports)
- Works on **Node 18+** and ships **dual builds** (ESM + CJS)

## Install

```bash
npm i llm-meter
```

## Quick start (manual metering)

```ts
import { LlmMeter } from "llm-meter";

const meter = new LlmMeter();

meter.record({
  model: "gpt-4o",
  inputTokens: 100,
  outputTokens: 50,
  provider: "openai"
});

console.log(meter.summary);
// { tokens: 150, inputTokens: 100, outputTokens: 50, costUsd: 0.00075, calls: 1 }
```

## Core concepts

### `LlmMeter`

One meter instance tracks everything:

- **`summary`**: total usage/cost/calls
- **`breakdown`**: per-provider totals
- **`spentUsd`**: convenience getter for total USD spend
- **`savings`**: cache hits/misses + estimated USD saved

### Clearing / rotating a meter

For long-lived services, you may want to periodically snapshot and reset:

```ts
import { LlmMeter } from "llm-meter";

const meter = new LlmMeter();

// ... record/instrument calls ...
const snapshot = { summary: meter.summary, breakdown: meter.breakdown, savings: meter.savings };

meter.clear(); // start a new accounting window
```

### Pricing & cost estimation

Out of the box, `llm-meter` includes a small pricing table for common model IDs.
You can also define your own.

```ts
import { defineModel, estimateCostUsd, pricingFor } from "llm-meter";

console.log(pricingFor("gpt-4o"));
console.log(estimateCostUsd("gpt-4o", 1000, 500));

defineModel("my-model", { inputPer1k: 0.001, outputPer1k: 0.002, provider: "my-llm" });
```

### Spending caps (budget enforcement)

Caps apply across async code using AsyncLocalStorage, so nested awaits still count toward the same scope.

```ts
import { LlmMeter, cap, CostLimitExceeded, TokenCapExceeded } from "llm-meter";

const meter = new LlmMeter();

try {
  await cap({ maxCostUsd: 0.01, maxTokens: 500, meter }).run(() => {
    meter.record({ model: "gpt-4o", inputTokens: 120, outputTokens: 35, provider: "openai" });
    meter.record({ model: "gpt-4o", inputTokens: 400, outputTokens: 200, provider: "openai" });
  });
} catch (e) {
  if (e instanceof CostLimitExceeded) {
    console.error("Cost cap hit", e.currentCost, e.maxCost);
  } else if (e instanceof TokenCapExceeded) {
    console.error("Token cap hit", e.currentTokens, e.maxTokens);
  }
}
```

### Caching (save money on identical calls)

Enable caching by passing `cache: "memory"` or `cache: "disk"`:

```ts
import { LlmMeter } from "llm-meter";

const meter = new LlmMeter({ cache: "memory" });
```

### Production-friendly caching (optional)

If you run a long-lived process, prefer a **bounded** cache to avoid unbounded growth.

```ts
import { LlmMeter } from "llm-meter";

// LRU + optional TTL
const meter = new LlmMeter({
  cache: { backend: "memory", maxEntries: 5_000, ttlMs: 5 * 60_000 }
});
```

Disk cache can also be configured with best-effort pruning:

```ts
import { LlmMeter } from "llm-meter";

const meter = new LlmMeter({
  cache: { backend: "disk", cacheDir: "/tmp/llm-meter", maxEntries: 50_000, ttlMs: 7 * 24 * 60 * 60_000 }
});
```

### Custom cache backend (advanced)

You can plug in any cache that matches one of these interfaces:

- **Sync cache**: `get/set/clear` are synchronous
- **Async cache**: `get/set/clear` return Promises (recommended for Redis/memcached-style clients)

Practical advice:

- **Key stability matters**: if your `makeKey` depends on object key order, you may miss cache hits. Prefer a stable stringify/hashing approach.
- **Cache values can be big**: you are storing the full SDK response object. Consider storing only what you need, or ensure your cache has eviction/TTL.
- **Async cache = extra latency**: every call becomes “check cache → maybe set cache”, so keep it fast.

```ts
import { LlmMeter } from "llm-meter";

const myCache = {
  makeKey: (req) => JSON.stringify(req),
  get: (k) => undefined,
  set: (k, v) => {},
  clear: () => {}
};

const meter = new LlmMeter({ cache: myCache });
```

Async cache example (shape only):

```ts
import { LlmMeter } from "llm-meter";

const myAsyncCache = {
  makeKey: (req) => JSON.stringify(req),
  get: async (k) => undefined,
  set: async (k, v) => {},
  clear: async () => {}
};

const meter = new LlmMeter({ cache: myAsyncCache });
```

Caching is applied when you instrument a client (see next section). When an identical request repeats:

- the response is returned from cache
- the meter does **not** count another paid call
- `meter.savings` records estimated tokens/USD saved

### Instrumenting client SDKs (OpenAI / Anthropic shapes)

`llm-meter` can instrument clients that match these common shapes:

- OpenAI-like: `client.chat.completions.create(...)`
- Anthropic-like: `client.messages.create(...)`

```ts
import { LlmMeter } from "llm-meter";
import OpenAI from "openai";

const meter = new LlmMeter({ cache: "memory" });

const openai = meter.instrumentOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));

await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Hello" }]
});

console.log(meter.summary);
```

### Bring-your-own provider (custom response schema)

If you have an internal gateway or your own response shape:

```ts
import { BringYourOwnProvider, LlmMeter, defineModel } from "llm-meter";

const meter = new LlmMeter();
defineModel("my-model", { inputPer1k: 0.001, outputPer1k: 0.002, provider: "my-llm" });

const byo = new BringYourOwnProvider({
  meter,
  providerName: "my-llm",
  extractModel: (r) => r.model,
  extractInputTokens: (r) => r.usage.input,
  extractOutputTokens: (r) => r.usage.output
});

byo.record({ model: "my-model", usage: { input: 123, output: 45 } });
console.log(meter.breakdown);
```

### Reports & exports

```ts
import { LlmMeter, renderUsageTable } from "llm-meter";

const meter = new LlmMeter();
// ... record or instrument calls ...

console.log(renderUsageTable(meter));

meter.saveCsv("usage.csv");
meter.saveJson("usage.json");
```

## Examples

See the `examples/` folder in this repository for reference:

- `examples/basic-metering.mjs`
- `examples/caching.mjs`
- `examples/custom-cache-sync.mjs`
- `examples/custom-cache-async.mjs`
- `examples/spend-cap.mjs`
- `examples/multi-provider.mjs`
- `examples/byo-provider.mjs`

These are meant for reading/copying patterns into your app (they are not intended to be runnable from the npm package).

## Runtime & module support

- **Node**: 18+
- **ESM**: `import { ... } from "llm-meter"`
- **CJS**: `const { LlmMeter } = require("llm-meter")`

## Author

- **Amaresh Parida**: `https://amareshparida.com`
- **Repository**: `https://github.com/amreshparida/llm-meter.git`

## License

MIT
