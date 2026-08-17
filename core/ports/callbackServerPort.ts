export interface OAuthCallbackResult {
  code: string;
  state: string;
}

export interface CallbackServerPort {
  start(timeoutMs: number): Promise<{
    port: number;
    result: Promise<OAuthCallbackResult>;
  }>;
  close(): void;
}
