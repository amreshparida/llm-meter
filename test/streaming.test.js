import test from "node:test";
import assert from "node:assert/strict";

import { LlmMeter } from "../dist/index.mjs";

async function collect(asyncIterable) {
  const out = [];
  for await (const x of asyncIterable) out.push(x);
  return out;
}

test("streaming: OpenAI adapter records usage when stream completes", async () => {
  const meter = new LlmMeter();

  async function* mockStream() {
    yield { model: "gpt-4o", choices: [{ delta: { content: "hi" } }] };
    yield { model: "gpt-4o", usage: { prompt_tokens: 100, completion_tokens: 50 } };
  }

  const mockClient = {
    chat: {
      completions: {
        create: () => mockStream()
      }
    }
  };

  const wrapped = meter.instrumentOpenAI(mockClient);
  const stream = wrapped.chat.completions.create({ stream: true, model: "gpt-4o", messages: [] });
  await collect(stream);

  assert.equal(meter.summary.calls, 1);
  assert.equal(meter.summary.tokens, 150);
  assert.equal(meter.breakdown.openai.calls, 1);
});

test("streaming: OpenAI adapter does not record if stream never reports usage", async () => {
  const meter = new LlmMeter();

  async function* mockStream() {
    yield { model: "gpt-4o", choices: [{ delta: { content: "hi" } }] };
    yield { model: "gpt-4o", choices: [{ delta: { content: "there" } }] };
  }

  const mockClient = {
    chat: {
      completions: {
        create: () => mockStream()
      }
    }
  };

  const wrapped = meter.instrumentOpenAI(mockClient);
  const stream = wrapped.chat.completions.create({ stream: true, model: "gpt-4o", messages: [] });
  await collect(stream);

  assert.equal(meter.summary.calls, 0);
  assert.equal(meter.summary.tokens, 0);
});

