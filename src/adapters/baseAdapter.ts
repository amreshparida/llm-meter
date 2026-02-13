export abstract class BaseProvider<TClient extends object = object> {
  protected readonly _client: TClient;
  
  public readonly tracker: any;

  constructor(client: TClient, tracker: any) {
    this._client = client;
    this.tracker = tracker;
  }

  get originalClient(): TClient {
    return this._client;
  }
}

