export interface HttpRequestOptions {
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  bodyText: string;
}

export interface HttpClientPort {
  request(options: HttpRequestOptions): Promise<HttpResponse>;
}
