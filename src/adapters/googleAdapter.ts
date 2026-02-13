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

function unwrapGeminiResponse(response: any): any {
  // Some SDKs return { response: ... } wrappers.
  return response?.response ?? response;
}

function extractGeminiUsage(
  response: any,
  fallbackModel?: string
): { model: string; promptTokens: number; completionTokens: number } {
  const r = unwrapGeminiResponse(response);
  const model = r?.model ?? r?.modelVersion ?? r?.data?.model ?? fallbackModel ?? "unknown";

  const usage =
    r?.usageMetadata ??
    r?.usage_metadata ??
    r?.usage ??
    r?.data?.usageMetadata ??
    r?.data?.usage ??
    undefined;

  const promptTokens =
    usage?.promptTokenCount ?? usage?.prompt_tokens ?? usage?.input_tokens ?? usage?.inputTokens ?? 0;

  const completionTokens =
    usage?.candidatesTokenCount ??
    usage?.completionTokenCount ??
    usage?.completion_tokens ??
    usage?.output_tokens ??
    usage?.outputTokens ??
    0;

  // If only total token count exists, we can’t reliably split input vs output.
  // Prefer recording everything as input (baseline estimate) rather than guessing.
  const total = usage?.totalTokenCount ?? usage?.total_tokens;
  if (promptTokens === 0 && completionTokens === 0 && typeof total === "number") {
    return { model, promptTokens: total, completionTokens: 0 };
  }

  return { model, promptTokens, completionTokens };
}

function getModelFromRequest(args: any[]): string | undefined {
  if (args.length === 1 && args[0] && typeof args[0] === "object") {
    return args[0].model ?? args[0].modelId ?? args[0].model_name ?? undefined;
  }
  return undefined;
}

class ModelsWrapper {
  private readonly _models: any;
  private readonly _parent: GeminiWrapper;

  constructor(models: any, parent: GeminiWrapper) {
    this._models = models;
    this._parent = parent;
  }

  generateContent(...args: any[]): any {
    const cache = this._parent.tracker.cacheStore?.();
    const request = args.length === 1 && args[0] && typeof args[0] === "object" ? args[0] : { args };
    const modelFromReq = getModelFromRequest(args);

    if (cache) {
      const key = cache.makeKey(request);
      const cachedOrPromise = cache.get(key);

      // Async cache
      if (isPromiseLike(cachedOrPromise)) {
        return Promise.resolve(cachedOrPromise).then(async (cached) => {
          if (cached != null) return this._parent._trackResponse(cached, true, modelFromReq);
          this._parent.tracker.noteCacheMiss?.();
          const resp = this._models.generateContent.apply(this._models, args);
          const resolved = await Promise.resolve(resp);
          await Promise.resolve(cache.set(key, resolved));
          return this._parent._trackResponse(resolved, false, modelFromReq);
        });
      }

      // Sync cache
      if (cachedOrPromise != null) return this._parent._trackResponse(cachedOrPromise, true, modelFromReq);
      this._parent.tracker.noteCacheMiss?.();
      const resp = this._models.generateContent.apply(this._models, args);
      if (isPromiseLike(resp)) {
        return Promise.resolve(resp).then(async (resolved) => {
          const setResult = (cache as any).set(key, resolved);
          if (isPromiseLike(setResult)) await setResult;
          return this._parent._trackResponse(resolved, false, modelFromReq);
        });
      }
      const setResult = (cache as any).set(key, resp);
      if (isPromiseLike(setResult)) {
        return Promise.resolve(setResult).then(() => this._parent._trackResponse(resp, false, modelFromReq));
      }
      return this._parent._trackResponse(resp, false, modelFromReq);
    }

    const resp = this._models.generateContent.apply(this._models, args);
    if (isPromiseLike(resp)) {
      return Promise.resolve(resp).then((resolved) => this._parent._trackResponse(resolved, false, modelFromReq));
    }
    return this._parent._trackResponse(resp, false, modelFromReq);
  }

  generateContentStream(...args: any[]): any {
    const modelFromReq = getModelFromRequest(args);
    const resp = this._models.generateContentStream?.apply(this._models, args);
    if (resp == null) return resp;

    const wrap = (stream: any) => {
      if (!stream || typeof stream[Symbol.asyncIterator] !== "function") return stream;
      const options =
        modelFromReq === undefined
          ? {
              provider: "google",
              extract: (chunk: any) => {
                const { model, promptTokens, completionTokens } = extractGeminiUsage(chunk, modelFromReq);
                return { model, inputTokens: promptTokens, outputTokens: completionTokens };
              }
            }
          : {
              provider: "google",
              model: modelFromReq,
              extract: (chunk: any) => {
                const { model, promptTokens, completionTokens } = extractGeminiUsage(chunk, modelFromReq);
                return { model, inputTokens: promptTokens, outputTokens: completionTokens };
              }
            };
      return meterStream(stream, this._parent.tracker, options);
    };

    return isPromiseLike(resp) ? Promise.resolve(resp).then(wrap) : wrap(resp);
  }
}

class GeminiWrapper extends BaseProvider<object> {
  models: any;
  generateContent: any;
  generateContentStream: any;

  constructor(client: any, meter: LlmMeter) {
    super(client, meter);
    const models = (client as any).models;
    if (models && typeof models === "object") {
      const modelsWrapper = new ModelsWrapper(models, this);
      this.models = new Proxy(modelsWrapper, {
        get: (target, prop, receiver) => {
          if (prop in target) return Reflect.get(target, prop, receiver);
          return bindIfFunction(Reflect.get(models, prop), models);
        }
      });
    } else {
      this.models = models;
    }

    // Also support "model object" shapes where generateContent exists directly.
    if (typeof (client as any).generateContent === "function") {
      this.generateContent = (...args: any[]) => {
        const modelFromReq = getModelFromRequest(args);
        const resp = (client as any).generateContent.apply(client, args);
        if (isPromiseLike(resp)) {
          return Promise.resolve(resp).then((resolved) => this._trackResponse(resolved, false, modelFromReq));
        }
        return this._trackResponse(resp, false, modelFromReq);
      };
    }

    if (typeof (client as any).generateContentStream === "function") {
      this.generateContentStream = (...args: any[]) => {
        const modelFromReq = getModelFromRequest(args);
        const resp = (client as any).generateContentStream.apply(client, args);
        const wrap = (stream: any) => {
          if (!stream || typeof stream[Symbol.asyncIterator] !== "function") return stream;
          const options =
            modelFromReq === undefined
              ? {
                  provider: "google",
                  extract: (chunk: any) => {
                    const { model, promptTokens, completionTokens } = extractGeminiUsage(chunk, modelFromReq);
                    return { model, inputTokens: promptTokens, outputTokens: completionTokens };
                  }
                }
              : {
                  provider: "google",
                  model: modelFromReq,
                  extract: (chunk: any) => {
                    const { model, promptTokens, completionTokens } = extractGeminiUsage(chunk, modelFromReq);
                    return { model, inputTokens: promptTokens, outputTokens: completionTokens };
                  }
                };
          return meterStream(stream, this.tracker, options);
        };
        return isPromiseLike(resp) ? Promise.resolve(resp).then(wrap) : wrap(resp);
      };
    }
  }

  _trackResponse(response: any, fromCache: boolean, modelFallback?: string): any {
    const { model, promptTokens, completionTokens } = extractGeminiUsage(response, modelFallback);

    if (fromCache) {
      const savedCostUsd = estimateCostUsd(model, promptTokens, completionTokens);
      this.tracker.noteCacheHit?.(promptTokens + completionTokens, savedCostUsd);
    } else {
      this.tracker.record({
        model,
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        provider: "google"
      });
    }

    getCurrentCapLike()?.checkLimits();
    return response;
  }
}

export function wrapGemini<TClient extends object>(client: TClient, meter: LlmMeter): TClient {
  const wrapper = new GeminiWrapper(client, meter);
  return new Proxy(wrapper as any, {
    get: (target, prop, receiver) => {
      if (prop in target) return Reflect.get(target, prop, receiver);
      return bindIfFunction(Reflect.get(client as any, prop), client);
    }
  });
}

