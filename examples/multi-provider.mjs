/**
 * Example: multi-provider metering
 *
 * This uses two different client "shapes" (OpenAI-like + Anthropic-like) and
 * shows how one meter aggregates everything into a single rollup.
 *
 * Run:
 *   npm run build
 *   node examples/multi-provider.mjs
 */

import { LlmMeter } from "../dist/index.mjs";

const meter = new LlmMeter();

const openaiLike = {
  chat: {
    completions: {
      create: () => ({
        model: "gpt-4o",
        usage: { prompt_tokens: 50, completion_tokens: 25 }
      })
    }
  }
};

const anthropicLike = {
  messages: {
    create: () => ({
      model: "claude-sonnet-4-5",
      usage: { input_tokens: 80, output_tokens: 40 }
    })
  }
};

const openai = meter.instrumentOpenAI(openaiLike);
const anthropic = meter.instrumentAnthropic(anthropicLike);

openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: "Hi" }] });
openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: "Hello again" }] });
anthropic.messages.create({ model: "claude-sonnet-4-5", messages: [{ role: "user", content: "Hi" }] });

console.log(meter.tableReport());
console.log("\nBreakdown (raw):", meter.breakdown);

