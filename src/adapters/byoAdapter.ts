import type { LlmMeter } from "../meter";

export type BringYourOwnProviderOptions<TResponse> = {
  meter: LlmMeter;
  providerName: string;
  extractModel: (response: TResponse) => string;
  extractInputTokens: (response: TResponse) => number;
  extractOutputTokens: (response: TResponse) => number;
};

export class BringYourOwnProvider<TResponse = any> {
  readonly meter: LlmMeter;
  readonly providerName: string;
  private readonly extractModel: (response: TResponse) => string;
  private readonly extractInputTokens: (response: TResponse) => number;
  private readonly extractOutputTokens: (response: TResponse) => number;

  constructor(opts: BringYourOwnProviderOptions<TResponse>) {
    this.meter = opts.meter;
    this.providerName = opts.providerName;
    this.extractModel = opts.extractModel;
    this.extractInputTokens = opts.extractInputTokens;
    this.extractOutputTokens = opts.extractOutputTokens;
  }

  record(response: TResponse): void {
    const model = this.extractModel(response);
    const inputTokens = this.extractInputTokens(response);
    const outputTokens = this.extractOutputTokens(response);
    this.meter.record({ model, inputTokens, outputTokens, provider: this.providerName });
  }
}

