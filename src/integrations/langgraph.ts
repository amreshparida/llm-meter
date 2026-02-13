import type { LlmMeter } from "../meter";
import { createLangChainCallbacks, type LangChainMeterOptions } from "./langchain";

/**
 * LangGraph (JS) uses LangChain's runnable/config conventions under the hood.
 * In practice, you can pass LangChain-style callback handlers in the `callbacks`
 * field of the invoke/stream config.
 *
 * This helper is just an alias for `createLangChainCallbacks(...)` so users can
 * discover the integration by searching for "langgraph".
 */
export function createLangGraphCallbacks(meter: LlmMeter, opts: LangChainMeterOptions = {}) {
  return createLangChainCallbacks(meter, opts);
}

