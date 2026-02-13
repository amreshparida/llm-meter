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

function extractAnthropicUsage(response: any): { model: string; promptTokens: number; completionTokens: number } {
  const model = response?.model ?? response?.data?.model ?? "unknown";
  const usage = response?.usage ?? response?.data?.usage;
  const promptTokens = usage?.input_tokens ?? usage?.inputTokens ?? 0;
  const completionTokens = usage?.output_tokens ?? usage?.outputTokens ?? 0;
  return { model, promptTokens, completionTokens };
}

class MessagesWrapper {
  private readonly _messages: any;
  private readonly _parent: AnthropicWrapper;

  constructor(messages: any, parent: AnthropicWrapper) {
    this._messages = messages;
    this._parent = parent;
  }

  create(...args: any[]): any {
    const request = args.length === 1 && args[0] && typeof args[0] === "object" ? args[0] : { args };
    const isStreaming = (request as any)?.stream === true;

    // Streaming responses: wrap AsyncIterable and record usage on completion (when available).
    if (isStreaming) {
      const resp = this._messages.create.apply(this._messages, args);
      if (isPromiseLike(resp)) {
        return Promise.resolve(resp).then((resolved) =>
          (resolved && typeof (resolved as any)[Symbol.asyncIterator] === "function"
            ? meterStream(resolved, this._parent.tracker, {
                provider: "anthropic",
                extract: (chunk: any) => {
                  const { model, promptTokens, completionTokens } = extractAnthropicUsage(chunk);
                  return { model, inputTokens: promptTokens, outputTokens: completionTokens };
                }
              })
            : this._parent._trackResponse(resolved, false))
        );
      }
      return resp && typeof (resp as any)[Symbol.asyncIterator] === "function"
        ? meterStream(resp, this._parent.tracker, {
            provider: "anthropic",
            extract: (chunk: any) => {
              const { model, promptTokens, completionTokens } = extractAnthropicUsage(chunk);
              return { model, inputTokens: promptTokens, outputTokens: completionTokens };
            }
          })
        : this._parent._trackResponse(resp, false);
    }

    const cache = this._parent.tracker.cacheStore?.();

    if (cache) {
      const key = cache.makeKey(request);
      const cachedOrPromise = cache.get(key);

      if (isPromiseLike(cachedOrPromise)) {
        return Promise.resolve(cachedOrPromise).then(async (cached) => {
          if (cached != null) return this._parent._trackResponse(cached, true);
          this._parent.tracker.noteCacheMiss?.();
          const resp = this._messages.create.apply(this._messages, args);
          const resolved = await Promise.resolve(resp);
          await Promise.resolve(cache.set(key, resolved));
          return this._parent._trackResponse(resolved, false);
        });
      }

      if (cachedOrPromise != null) return this._parent._trackResponse(cachedOrPromise, true);
      this._parent.tracker.noteCacheMiss?.();
      const resp = this._messages.create.apply(this._messages, args);
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

    const resp = this._messages.create.apply(this._messages, args);
    if (isPromiseLike(resp)) {
      return Promise.resolve(resp).then((resolved) => this._parent._trackResponse(resolved, false));
    }
    return this._parent._trackResponse(resp, false);
  }
}

class AnthropicWrapper extends BaseProvider<object> {
  messages: any;

  constructor(client: any, meter: LlmMeter) {
    super(client, meter);
    const messagesWrapper = new MessagesWrapper((client as any).messages, this);
    this.messages = new Proxy(messagesWrapper, {
      get: (target, prop, receiver) => {
        if (prop in target) return Reflect.get(target, prop, receiver);
        return bindIfFunction(Reflect.get((client as any).messages, prop), (client as any).messages);
      }
    });
  }

  _trackResponse(response: any, fromCache: boolean): any {
    const { model, promptTokens, completionTokens } = extractAnthropicUsage(response);

    if (fromCache) {
      const savedCostUsd = estimateCostUsd(model, promptTokens, completionTokens);
      this.tracker.noteCacheHit?.(promptTokens + completionTokens, savedCostUsd);
    } else {
      this.tracker.record({
        model,
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        provider: "anthropic"
      });
    }

    getCurrentCapLike()?.checkLimits();
    return response;
  }
}

export function wrapAnthropic<TClient extends object>(client: TClient, meter: LlmMeter): TClient {
  const wrapper = new AnthropicWrapper(client, meter);
  return new Proxy(wrapper as any, {
    get: (target, prop, receiver) => {
      if (prop in target) return Reflect.get(target, prop, receiver);
      return bindIfFunction(Reflect.get(client as any, prop), client);
    }
  });
}

