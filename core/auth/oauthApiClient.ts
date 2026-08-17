import type { HttpClientPort } from "../ports/httpClientPort.js";
import { parseError, type ApiSource } from "./errorMapper.js";
import type { OAuthClientConfig, OAuthTokens } from "./types.js";

const TIMEOUT_MS = 15_000;

export interface ProfileAccount {
  uuid: string;
  email_address: string;
  display_name: string;
  created_at?: string;
  has_claude_max?: boolean;
  has_claude_pro?: boolean;
  has_api_access?: boolean;
}

export interface ProfileOrganization {
  uuid?: string;
  organization_type?: string;
  rate_limit_tier?: string;
  has_extra_usage_enabled?: boolean;
  billing_type?: string;
  subscription_created_at?: string;
}

export interface ProfileEntitlement {
  product_code?: string;
  status?: string;
}

export interface ProfileResponse {
  account: ProfileAccount;
  organization?: ProfileOrganization;
  entitlement?: ProfileEntitlement | null;
}

export interface OAuthApiClientDeps {
  http: HttpClientPort;
  config: OAuthClientConfig;
  getAccessToken: () => Promise<string>;
}

export class OAuthApiClient {
  private readonly http: HttpClientPort;
  private readonly config: OAuthClientConfig;
  private readonly getAccessToken: () => Promise<string>;

  constructor(deps: OAuthApiClientDeps) {
    this.http = deps.http;
    this.config = deps.config;
    this.getAccessToken = deps.getAccessToken;
  }

  async exchangeCode(
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<OAuthTokens> {
    return this.postToken({
      grant_type: "authorization_code",
      client_id: this.config.clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    return this.postToken({
      grant_type: "refresh_token",
      client_id: this.config.clientId,
      refresh_token: refreshToken,
      scope: this.config.scope,
    });
  }

  async getProfile(): Promise<ProfileResponse> {
    const accessToken = await this.getAccessToken();
    const body = await this.requestJson<ProfileResponse>(
      "oauth",
      "GET",
      `${this.config.apiOrigin}/api/oauth/profile`,
      {
        Authorization: `Bearer ${accessToken}`,
      },
    );
    return body;
  }

  async createRuntimeApiKey(): Promise<string> {
    const accessToken = await this.getAccessToken();
    const body = await this.requestJson<{ raw_key: string }>(
      "oauth",
      "POST",
      `${this.config.apiOrigin}/api/oauth/wanlaicode/create_api_key`,
      {
        Authorization: `Bearer ${accessToken}`,
      },
    );
    if (typeof body.raw_key !== "string" || body.raw_key.length === 0) {
      throw parseError("oauth", 200, body);
    }
    return body.raw_key;
  }

  private async postToken(body: Record<string, string>): Promise<OAuthTokens> {
    const raw = await this.requestJson<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
    }>("oauth", "POST", `${this.config.apiOrigin}/v1/oauth/token`, undefined, body);

    return {
      accessToken: raw.access_token,
      refreshToken: raw.refresh_token,
      expiresAt: Date.now() + raw.expires_in * 1000,
    };
  }

  private async requestJson<T>(
    source: ApiSource,
    method: "GET" | "POST",
    url: string,
    headers?: Record<string, string>,
    body?: unknown,
  ): Promise<T> {
    const response = await this.http.request({
      method,
      url,
      headers,
      body,
      timeoutMs: TIMEOUT_MS,
    });

    let parsed: unknown;
    try {
      parsed = response.bodyText ? JSON.parse(response.bodyText) : undefined;
    } catch {
      parsed = { message: response.bodyText };
    }

    if (response.status >= 400) {
      throw parseError(source, response.status, parsed);
    }

    return parsed as T;
  }
}
