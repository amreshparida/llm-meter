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

Out of the box, `llm-meter` includes a **small, curated pricing table** for **widely used + stable + current-generation** model IDs.

It also handles **versioned model ids** returned by some APIs by falling back to the base id when possible (for example, `gpt-4o-mini-2024-07-18` → `gpt-4o-mini`).

If a model isn’t in the built-in table (or your org has custom rates), define it yourself:

```ts
import { defineModel, estimateCostUsd, pricingFor } from "llm-meter";

console.log(pricingFor("gpt-4o"));
console.log(estimateCostUsd("gpt-4o", 1000, 500));

defineModel("my-model", { inputPer1k: 0.001, outputPer1k: 0.002, provider: "my-llm" });
```

Note: Some providers vary pricing by **modality** and/or **prompt length** (for example, Gemini has tiers based on context length). `llm-meter` uses best-effort baseline text-token rates for quick estimation.

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
- Gemini-like: `client.models.generateContent(...)`
- Groq-like (OpenAI-compatible): `client.chat.completions.create(...)`
- DeepSeek-like (OpenAI-compatible): `client.chat.completions.create(...)`

#### End-to-end: OpenAI (real SDK usage)

Install dependencies:

```bash
npm i llm-meter openai
```

Then instrument the OpenAI client and make calls as usual:

```ts
import OpenAI from "openai";
import { LlmMeter, cap } from "llm-meter";

const meter = new LlmMeter({
  // optional but recommended in long-lived services
  cache: { backend: "memory", maxEntries: 2_000, ttlMs: 10 * 60_000 }
});

const openai = meter.instrumentOpenAI(
  new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
);

await cap({ maxCostUsd: 0.05, meter }).run(async () => {
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "Write a haiku about TypeScript." }]
  });

  console.log(resp.choices?.[0]?.message?.content);
});

console.log("Totals:", meter.summary);
console.log("Savings:", meter.savings);
console.log(meter.tableReport());
```

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

Gemini-like example (shape only):

```ts
import { LlmMeter } from "llm-meter";
// Example shape: client.models.generateContent({ model, contents })

const meter = new LlmMeter({ cache: "memory" });

const geminiLike = {
  models: {
    generateContent: async () => ({
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 }
    })
  }
};

const gemini = meter.instrumentGemini(geminiLike);
await gemini.models.generateContent({ model: "gemini-2.0-flash", contents: "hi" });

console.log(meter.summary);
```

Groq example (OpenAI-compatible):

```ts
import { LlmMeter } from "llm-meter";
import OpenAI from "openai";

const meter = new LlmMeter({ cache: "memory" });

// Groq is OpenAI-compatible. Use your Groq key + the Groq base URL.
const groqClient = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1"
});

const groq = meter.instrumentGroq(groqClient);

await groq.chat.completions.create({
  model: "llama-3.1-8b-instant",
  messages: [{ role: "user", content: "Hello" }]
});

console.log(meter.summary);
```

DeepSeek example (OpenAI-compatible):

```ts
import { LlmMeter } from "llm-meter";
import OpenAI from "openai";

const meter = new LlmMeter({ cache: "memory" });

// DeepSeek is OpenAI-compatible. Use your DeepSeek key + DeepSeek base URL.
// Depending on your OpenAI SDK version, you may need "https://api.deepseek.com/v1".
const deepseekClient = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com"
});

const deepseek = meter.instrumentDeepSeek(deepseekClient);

await deepseek.chat.completions.create({
  model: "deepseek-chat",
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

### LangChain integration (callbacks)

LangChain exposes callbacks that receive the final `LLMResult`, which typically includes **token usage** and often the **model id**. `llm-meter` ships a small helper that converts those callback events into `meter.record(...)` calls.

This integration is **dependency-free** (you don’t need `langchain` installed to use `llm-meter`; you only need it in your app).

```ts
import { LlmMeter, createLangChainCallbacks } from "llm-meter";
import { ChatOpenAI } from "@langchain/openai";

const meter = new LlmMeter({ cache: "memory" });

const callbacks = [
  createLangChainCallbacks(meter, {
    provider: "openai",
    model: "gpt-4o-mini",
    // If LangChain returns a model id we don't have pricing for:
    // unknownModel: "zero"
  })
];

const llm = new ChatOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  model: "gpt-4o-mini",
  callbacks
});

await llm.invoke("Say hello in one sentence.");

console.log(meter.summary);
console.log(meter.tableReport());
```

### LangGraph integration

LangGraph runs are also **Runnable**-based and support passing `callbacks` through the invoke/stream config. You can use the same handler as LangChain; `llm-meter` also exports a convenience alias named `createLangGraphCallbacks`.

```ts
import { LlmMeter, createLangGraphCallbacks } from "llm-meter";
import { StateGraph } from "@langchain/langgraph";

const meter = new LlmMeter();
const callbacks = [createLangGraphCallbacks(meter, { provider: "openai", model: "gpt-4o-mini" })];

// ...build/compile your graph...
const graph = new StateGraph({}).compile();

await graph.invoke({ input: "hello" }, { callbacks });

console.log(meter.summary);
```

### Streaming responses

`llm-meter` supports streaming **when the stream eventually reports token usage**. The adapters will wrap AsyncIterable streams and record usage **once the stream completes**.

Important notes:

- Some SDKs/providers only include token usage in the **final** streaming chunk, and sometimes only when you enable a flag (for OpenAI Chat Completions streaming, set `stream_options: { include_usage: true }`).
- If a stream never reports usage, `llm-meter` cannot count tokens/cost accurately (and will record nothing for that stream).
- Caching is bypassed for streaming calls (caches store full responses, not streams).

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

MIT (see [LICENSE](LICENSE))
