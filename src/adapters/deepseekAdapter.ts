import { estimateCostUsd } from "../rates";
import { getCurrentCapLike } from "../als";
import type { LlmMeter } from "../meter";
import { BaseProvider } from "./baseAdapter";
import { meterStream } from "../stream";

function isPromiseLike<T = unknown>(value: unknown): value is PromiseLike<T> {
  return typeof (value as any)?.then === "function";
}

function bindIfFunction<T>(value: T, thisArg: any): T {
  if (typeof value === "function") return (value as any).bind(thisArg);
  return value;
}

function extractDeepSeekUsage(response: any): { model: string; promptTokens: number; completionTokens: number } {
  // DeepSeek's API is OpenAI-compatible for chat completions.
  const model = response?.model ?? response?.data?.model ?? "unknown";
  const usage = response?.usage ?? response?.data?.usage;
  const promptTokens = usage?.prompt_tokens ?? usage?.promptTokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? usage?.completionTokens ?? 0;
  return { model, promptTokens, completionTokens };
}

class CompletionsWrapper {
  private readonly _completions: any;
  private readonly _parent: DeepSeekWrapper;

  constructor(completions: any, parent: DeepSeekWrapper) {
    this._completions = completions;
    this._parent = parent;
  }

  create(...args: any[]): any {
    const request = args.length === 1 && args[0] && typeof args[0] === "object" ? args[0] : { args };
    const isStreaming = (request as any)?.stream === true;

    // Streaming responses (OpenAI-compatible): wrap AsyncIterable and record usage on completion.
    if (isStreaming) {
      const resp = this._completions.create.apply(this._completions, args);
      if (isPromiseLike(resp)) {
        return Promise.resolve(resp).then((resolved) =>
          (resolved && typeof (resolved as any)[Symbol.asyncIterator] === "function"
            ? meterStream(resolved, this._parent.tracker, {
                provider: "deepseek",
                extract: (chunk: any) => {
                  const { model, promptTokens, completionTokens } = extractDeepSeekUsage(chunk);
                  return { model, inputTokens: promptTokens, outputTokens: completionTokens };
                }
              })
            : this._parent._trackResponse(resolved, false))
        );
      }
      return resp && typeof (resp as any)[Symbol.asyncIterator] === "function"
        ? meterStream(resp, this._parent.tracker, {
            provider: "deepseek",
            extract: (chunk: any) => {
              const { model, promptTokens, completionTokens } = extractDeepSeekUsage(chunk);
              return { model, inputTokens: promptTokens, outputTokens: completionTokens };
            }
          })
        : this._parent._trackResponse(resp, false);
    }

    const cache = this._parent.tracker.cacheStore?.();

    if (cache) {
      const key = cache.makeKey(request);
      const cachedOrPromise = cache.get(key);

      // Async cache
      if (isPromiseLike(cachedOrPromise)) {
        return Promise.resolve(cachedOrPromise).then(async (cached) => {
          if (cached != null) return this._parent._trackResponse(cached, true);
          this._parent.tracker.noteCacheMiss?.();
          const resp = this._completions.create.apply(this._completions, args);
          const resolved = await Promise.resolve(resp);
          await Promise.resolve(cache.set(key, resolved));
          return this._parent._trackResponse(resolved, false);
        });
      }

      // Sync cache
      if (cachedOrPromise != null) return this._parent._trackResponse(cachedOrPromise, true);
      this._parent.tracker.noteCacheMiss?.();
      const resp = this._completions.create.apply(this._completions, args);
      if (isPromiseLike(resp)) {
        return Promise.resolve(resp).then(async (resolved) => {
          const setResult = (cache as any).set(key, resolved);
          if (isPromiseLike(setResult)) await setResult;
          return this._parent._trackResponse(resolved, false);
        });
      }
      const setResult = (cache as any).set(key, resp);
      if (isPromiseLike(setResult)) {
        return Promise.resolve(setResult).then(() => this._parent._trackResponse(resp, false));
      }
      return this._parent._trackResponse(resp, false);
    }

    const resp = this._completions.create.apply(this._completions, args);
    if (isPromiseLike(resp)) {
      return Promise.resolve(resp).then((resolved) => this._parent._trackResponse(resolved, false));
    }
    return this._parent._trackResponse(resp, false);
  }
}

class ChatWrapper {
  private readonly _chat: any;
  completions: any;

  constructor(chat: any, parent: DeepSeekWrapper) {
    this._chat = chat;
    const completionsWrapper = new CompletionsWrapper(chat?.completions, parent);
    this.completions = new Proxy(completionsWrapper, {
      get: (target, prop, receiver) => {
        if (prop in target) return Reflect.get(target, prop, receiver);
        return bindIfFunction(Reflect.get(chat?.completions, prop), chat?.completions);
      }
    });
  }
}

class DeepSeekWrapper extends BaseProvider<object> {
  chat: any;

  constructor(client: any, meter: LlmMeter) {
    super(client, meter);
    const chatWrapper = new ChatWrapper((client as any).chat, this);
    this.chat = new Proxy(chatWrapper, {
      get: (target, prop, receiver) => {
        if (prop in target) return Reflect.get(target, prop, receiver);
        return bindIfFunction(Reflect.get((client as any).chat, prop), (client as any).chat);
      }
    });
  }

  _trackResponse(response: any, fromCache: boolean): any {
    const { model, promptTokens, completionTokens } = extractDeepSeekUsage(response);

    if (fromCache) {
      const savedCostUsd = estimateCostUsd(model, promptTokens, completionTokens);
      this.tracker.noteCacheHit?.(promptTokens + completionTokens, savedCostUsd);
    } else {
      this.tracker.record({
        model,
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        provider: "deepseek"
      });
    }

    getCurrentCapLike()?.checkLimits();
    return response;
  }
}

export function wrapDeepSeek<TClient extends object>(client: TClient, meter: LlmMeter): TClient {
  const wrapper = new DeepSeekWrapper(client, meter);
  return new Proxy(wrapper as any, {
    get: (target, prop, receiver) => {
      if (prop in target) return Reflect.get(target, prop, receiver);
      return bindIfFunction(Reflect.get(client as any, prop), client);
    }
  });
}

