import { describe, expect, it } from "vitest";
import type { HttpClientPort, HttpRequestOptions, HttpResponse } from "../ports/httpClientPort.js";
import { OAuthApiClient } from "./oauthApiClient.js";
import { DEFAULT_CLIENT_ID, type OAuthClientConfig } from "./types.js";

class FakeHttp implements HttpClientPort {
  lastRequest: HttpRequestOptions | undefined;
  response: HttpResponse = { status: 200, bodyText: "{}" };

  async request(options: HttpRequestOptions): Promise<HttpResponse> {
    this.lastRequest = options;
    return this.response;
  }
}

const config: OAuthClientConfig = {
  apiOrigin: "https://api.wanlai.ai",
  apiBase: "https://api.wanlai.ai/v1",
  siteBase: "https://wanlai.ai",
  clientId: DEFAULT_CLIENT_ID,
  scope: "user:profile user:inference",
  clientName: "wanlaicodex",
  clientVersion: "0.0.1",
};

function tokenBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    access_token: "access-xyz",
    refresh_token: "refresh-xyz",
    token_type: "Bearer",
    expires_in: 3600,
    ...overrides,
  });
}

describe("OAuthApiClient", () => {
  it("exchangeCode POSTs token endpoint with wanlaicode-cli and no Authorization", async () => {
    const http = new FakeHttp();
    http.response = { status: 200, bodyText: tokenBody() };
    const client = new OAuthApiClient({
      http,
      config,
      getAccessToken: async () => "should-not-use",
    });

    await client.exchangeCode("auth-code", "verifier-1", "http://127.0.0.1:49152/callback");

    expect(http.lastRequest).toBeDefined();
    expect(http.lastRequest!.method).toBe("POST");
    expect(http.lastRequest!.url).toBe("https://api.wanlai.ai/v1/oauth/token");
    expect(http.lastRequest!.timeoutMs).toBe(15_000);
    expect(http.lastRequest!.headers?.Authorization).toBeUndefined();

    const body = http.lastRequest!.body as Record<string, unknown>;
    expect(body.grant_type).toBe("authorization_code");
    expect(body.client_id).toBe("wanlaicode-cli");
    expect(body.client_id).not.toBe("wanlai-ide");
    expect(body.code).toBe("auth-code");
    expect(body.redirect_uri).toBe("http://127.0.0.1:49152/callback");
    expect(body.code_verifier).toBe("verifier-1");
  });

  it("maps expires_in 3600 to expiresAt ≈ now + 3600000", async () => {
    const http = new FakeHttp();
    http.response = { status: 200, bodyText: tokenBody({ expires_in: 3600 }) };
    const client = new OAuthApiClient({
      http,
      config,
      getAccessToken: async () => "",
    });

    const before = Date.now();
    const tokens = await client.exchangeCode("c", "v", "http://127.0.0.1:1/callback");
    const after = Date.now();

    expect(tokens.accessToken).toBe("access-xyz");
    expect(tokens.refreshToken).toBe("refresh-xyz");
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3_600_000 - 2_000);
    expect(tokens.expiresAt).toBeLessThanOrEqual(after + 3_600_000 + 2_000);
  });

  it("refreshToken POSTs with grant_type refresh_token and same client_id", async () => {
    const http = new FakeHttp();
    http.response = { status: 200, bodyText: tokenBody() };
    const client = new OAuthApiClient({
      http,
      config,
      getAccessToken: async () => "",
    });

    await client.refreshToken("refresh-abc");

    const body = http.lastRequest!.body as Record<string, unknown>;
    expect(http.lastRequest!.url).toBe("https://api.wanlai.ai/v1/oauth/token");
    expect(body.grant_type).toBe("refresh_token");
    expect(body.client_id).toBe("wanlaicode-cli");
    expect(body.client_id).not.toBe("wanlai-ide");
    expect(body.refresh_token).toBe("refresh-abc");
    expect(body.scope).toBe("user:profile user:inference");
    expect(http.lastRequest!.headers?.Authorization).toBeUndefined();
  });

  it("getProfile GETs profile with Bearer access token", async () => {
    const http = new FakeHttp();
    http.response = {
      status: 200,
      bodyText: JSON.stringify({
        account: {
          uuid: "u1",
          email_address: "a@b.com",
          display_name: "Ada",
        },
        organization: { organization_type: "individual" },
        entitlement: { status: "active" },
      }),
    };
    const client = new OAuthApiClient({
      http,
      config,
      getAccessToken: async () => "access-secret",
    });

    const profile = await client.getProfile();

    expect(http.lastRequest!.method).toBe("GET");
    expect(http.lastRequest!.url).toBe("https://api.wanlai.ai/api/oauth/profile");
    expect(http.lastRequest!.headers?.Authorization).toBe("Bearer access-secret");
    expect(http.lastRequest!.timeoutMs).toBe(15_000);
    expect(profile.account.display_name).toBe("Ada");
  });

  it("createRuntimeApiKey POSTs and returns raw_key", async () => {
    const http = new FakeHttp();
    http.response = {
      status: 200,
      bodyText: JSON.stringify({ raw_key: "sk-runtime-1" }),
    };
    const client = new OAuthApiClient({
      http,
      config,
      getAccessToken: async () => "access-secret",
    });

    const key = await client.createRuntimeApiKey();

    expect(http.lastRequest!.method).toBe("POST");
    expect(http.lastRequest!.url).toBe(
      "https://api.wanlai.ai/api/oauth/wanlaicode/create_api_key",
    );
    expect(http.lastRequest!.headers?.Authorization).toBe("Bearer access-secret");
    expect(key).toBe("sk-runtime-1");
  });

  it("throws StructuredError on HTTP 4xx via parseError", async () => {
    const http = new FakeHttp();
    http.response = {
      status: 401,
      bodyText: JSON.stringify({
        reason: "TOKEN_EXPIRED",
        message: "expired",
      }),
    };
    const client = new OAuthApiClient({
      http,
      config,
      getAccessToken: async () => "access-secret",
    });

    await expect(client.getProfile()).rejects.toMatchObject({
      statusCode: 401,
      reason: "TOKEN_EXPIRED",
      message: "expired",
      source: "oauth",
      credentialKind: "oauth",
    });
  });
});
