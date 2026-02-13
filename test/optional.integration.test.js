import test from "node:test";
import assert from "node:assert/strict";

import { LlmMeter } from "../dist/index.mjs";

/**
 * Optional integration tests.
 *
 * These are intentionally skipped by default. To enable:
 * - install the SDKs in this repo
 * - set the corresponding API key env vars
 *
 * OPENAI:
 *   npm i openai
 *   OPENAI_API_KEY=... node --test test/optional.integration.test.js
 */

test("integration (optional): OpenAI SDK", { skip: !process.env.OPENAI_API_KEY }, async () => {
  let OpenAI;
  try {
    OpenAI = (await import("openai")).default;
  } catch {
    test.skip("openai package not installed");
    return;
  }

  const meter = new LlmMeter();
  const openai = meter.instrumentOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "Say hello in one word." }]
  });

  assert.ok(resp);
  assert.ok(meter.summary.calls >= 1);
});

