export class MeterError extends Error {
  override name = "MeterError";
}

export class CostLimitExceeded extends MeterError {
  override name = "CostLimitExceeded";
  currentCost: number;
  maxCost: number;

  constructor(message: string, opts: { currentCost: number; maxCost: number }) {
    super(message);
    this.currentCost = opts.currentCost;
    this.maxCost = opts.maxCost;
  }
}

export class TokenCapExceeded extends MeterError {
  override name = "TokenCapExceeded";
  currentTokens: number;
  maxTokens: number;

  constructor(message: string, opts: { currentTokens: number; maxTokens: number }) {
    super(message);
    this.currentTokens = opts.currentTokens;
    this.maxTokens = opts.maxTokens;
  }
}

export class ProviderUnavailableError extends MeterError {
  override name = "ProviderUnavailableError";
}

export class UnknownModelError extends MeterError {
  override name = "UnknownModelError";
}

export class CacheFailure extends MeterError {
  override name = "CacheFailure";
}

