import { AsyncLocalStorage } from "node:async_hooks";

export type CapLike = {
  checkLimits(): void;
};

const storage = new AsyncLocalStorage<CapLike | undefined>();

export function getCurrentCapLike(): CapLike | undefined {
  return storage.getStore();
}

export async function runWithCapLike<T>(cap: CapLike, fn: () => T | Promise<T>): Promise<T> {
  return await storage.run(cap, fn);
}

