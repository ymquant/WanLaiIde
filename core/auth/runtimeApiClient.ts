import type { HttpClientPort } from "../ports/httpClientPort.js";
import { parseError } from "./errorMapper.js";
import type { DeviceInfo, OAuthClientConfig } from "./types.js";

const TIMEOUT_MS = 15_000;
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

export interface ModelInfo {
  id: string;
  object?: string;
  [key: string]: unknown;
}

export interface RuntimeApiClientDeps {
  http: HttpClientPort;
  config: OAuthClientConfig;
  device: DeviceInfo;
  getRuntimeApiKey: () => Promise<string>;
}

function sanitizeHeader(value: string, maxLen: number): string {
  return value.replace(CONTROL_CHARS, "").slice(0, maxLen);
}

export class RuntimeApiClient {
  private readonly http: HttpClientPort;
  private readonly config: OAuthClientConfig;
  private readonly device: DeviceInfo;
  private readonly getRuntimeApiKey: () => Promise<string>;

  constructor(deps: RuntimeApiClientDeps) {
    this.http = deps.http;
    this.config = deps.config;
    this.device = deps.device;
    this.getRuntimeApiKey = deps.getRuntimeApiKey;
  }

  async getModels(): Promise<ModelInfo[]> {
    const apiKey = await this.getRuntimeApiKey();
    const response = await this.http.request({
      method: "GET",
      url: `${this.config.apiBase}/models`,
      headers: this.buildHeaders(apiKey),
      timeoutMs: TIMEOUT_MS,
    });

    let parsed: unknown;
    try {
      parsed = response.bodyText ? JSON.parse(response.bodyText) : undefined;
    } catch {
      parsed = { message: response.bodyText };
    }

    if (response.status >= 400) {
      // models errors follow chat/runtime credentialKind
      throw parseError("chat", response.status, parsed);
    }

    const record = parsed as { data?: ModelInfo[] } | undefined;
    return Array.isArray(record?.data) ? record!.data! : [];
  }

  buildHeaders(apiKey: string): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Wanlai-Client": sanitizeHeader(this.config.clientName, 128),
      "X-Wanlai-Client-Version": sanitizeHeader(this.config.clientVersion, 128),
      "X-Wanlai-Device-Id": sanitizeHeader(this.device.id, 128),
      "X-Wanlai-Device-Name": sanitizeHeader(this.device.name, 64),
      "X-Wanlai-OS": sanitizeHeader(this.device.os, 128),
      "X-Wanlai-Arch": sanitizeHeader(this.device.arch, 128),
    };
  }
}
