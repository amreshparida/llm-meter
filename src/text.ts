import crypto from "node:crypto";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : JSON.stringify(String(value));
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value === "undefined") return JSON.stringify("undefined");
  if (typeof value === "function") return JSON.stringify("[Function]");
  if (typeof value === "symbol") return JSON.stringify(String(value));

  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value instanceof RegExp) return JSON.stringify(value.toString());
  if (value instanceof Error) {
    return stableStringify({ name: value.name, message: value.message, stack: value.stack });
  }

  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as any)[k])}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(String(value));
}

export function hashRequest(data: Record<string, unknown>): string {
  const serialized = stableStringify(data);
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

export function formatCost(costUsd: number): string {
  if (costUsd < 0.01) return `$${costUsd.toFixed(4)}`;
  return `$${costUsd.toFixed(2)}`;
}

export function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return String(num);
}

