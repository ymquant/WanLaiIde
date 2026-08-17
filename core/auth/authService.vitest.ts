import { describe, expect, it, vi } from "vitest";
import type {
  CallbackServerPort,
  OAuthCallbackResult,
} from "../ports/callbackServerPort.js";
import type {
  HttpClientPort,
  HttpRequestOptions,
  HttpResponse,
} from "../ports/httpClientPort.js";
import type { LoggerPort } from "../ports/loggerPort.js";
import type { SecretStoragePort } from "../ports/secretStoragePort.js";
import { AuthService } from "./authService.js";
import { CredentialStore } from "./credentialStore.js";
import { OAuthApiClient } from "./oauthApiClient.js";
import { RequestCanceller } from "./requestCanceller.js";
import {
  CREDENTIALS_STORAGE_KEY,
  DEFAULT_CLIENT_ID,
  DEFAULT_SCOPE,
  type LoginDeps,
  type OAuthClientConfig,
} from "./types.js";

const config: OAuthClientConfig = {
  apiOrigin: "https://api.wanlai.ai",
  apiBase: "https://api.wanlai.ai/v1",
  siteBase: "https://wanlai.ai",
  clientId: DEFAULT_CLIENT_ID,
  scope: DEFAULT_SCOPE,
  clientName: "wanlaicodex",
  clientVersion: "0.0.1",
};

class FakeStorage implements SecretStoragePort {
  readonly map = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.map.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

class FakeHttp implements HttpClientPort {
  requestCount = 0;
  requests: HttpRequestOptions[] = [];
  handlers: Array<(opts: HttpRequestOptions) => Promise<HttpResponse> | HttpResponse> =
    [];

  async request(options: HttpRequestOptions): Promise<HttpResponse> {
    this.requestCount++;
    this.requests.push(options);
    const handler = this.handlers.shift();
    if (handler) {
      return handler(options);
    }
    return { status: 500, bodyText: '{"message":"unhandled"}' };
  }
}

class FakeCallbackServer implements CallbackServerPort {
  closed = false;
  private resolveResult!: (value: OAuthCallbackResult) => void;
  private rejectResult!: (reason?: unknown) => void;
  private readonly resultPromise: Promise<OAuthCallbackResult>;

  constructor() {
    this.resultPromise = new Promise<OAuthCallbackResult>((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
    // Prevent unhandled rejection when closed without await
    this.resultPromise.catch(() => undefined);
  }

  async start(_timeoutMs: number): Promise<{
    port: number;
    result: Promise<OAuthCallbackResult>;
  }> {
    return { port: 49152, result: this.resultPromise };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectResult(Object.assign(new Error("LoginCancelled"), { name: "LoginCancelled" }));
  }

  complete(state: string): void {
    this.resolveResult({ code: "abc", state });
  }
}

function createLogger(): LoggerPort {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function tokenResponse(overrides: Record<string, unknown> = {}) {
  return {
    status: 200,
    bodyText: JSON.stringify({
      access_token: "access-xyz",
      refresh_token: "refresh-xyz",
      token_type: "Bearer",
      expires_in: 3600,
      ...overrides,
    }),
  };
}

function profileResponse(entitlement: { status: string } | null) {
  return {
    status: 200,
    bodyText: JSON.stringify({
      account: {
        uuid: "user-uuid-secret",
        email_address: "user@example.com",
        display_name: "Ada",
      },
      organization: { organization_type: "individual" },
      entitlement,
    }),
  };
}

function createApiKeyResponse() {
  return {
    status: 200,
    bodyText: JSON.stringify({ raw_key: "sk-runtime-1" }),
  };
}

function setup() {
  const storage = new FakeStorage();
  const http = new FakeHttp();
  const logger = createLogger();
  const canceller = new RequestCanceller();
  const servers: FakeCallbackServer[] = [];
  let openedUrl = "";

  let oauth!: OAuthApiClient;
  const store = new CredentialStore({
    storage,
    refreshToken: (token) => oauth.refreshToken(token),
    logger,
  });
  oauth = new OAuthApiClient({
    http,
    config,
    getAccessToken: async () => {
      const token = await store.getValidAccessToken();
      if (!token) throw new Error("no access token");
      return token;
    },
  });

  const auth = new AuthService({
    credentialStore: store,
    oauthApiClient: oauth,
    canceller,
    logger,
    config,
  });

  const loginDeps: LoginDeps = {
    openBrowser: async (url) => {
      openedUrl = url;
      const state = new URL(url).searchParams.get("state");
      if (state) {
        servers[servers.length - 1]?.complete(state);
      }
    },
    createCallbackServer: () => {
      const server = new FakeCallbackServer();
      servers.push(server);
      return server;
    },
    redirectUriFactory: (port) => `http://127.0.0.1:${port}/callback`,
  };

  return {
    auth,
    store,
    storage,
    http,
    logger,
    canceller,
    servers,
    loginDeps,
    getOpenedUrl: () => openedUrl,
    setOpenedUrl: (url: string) => {
      openedUrl = url;
    },
  };
}

describe("AuthService", () => {
  it("login URL contains client_id, S256, and redirect_uri", async () => {
    const { auth, http, loginDeps, getOpenedUrl } = setup();
    http.handlers.push(
      () => tokenResponse(),
      () => profileResponse({ status: "active" }),
      () => createApiKeyResponse(),
    );

    await auth.login(loginDeps);

    const url = new URL(getOpenedUrl());
    expect(url.searchParams.get("client_id")).toBe("wanlaicode-cli");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:49152/callback",
    );
  });

  it("login with active entitlement → loggedIn and create_api_key called", async () => {
    const { auth, http, loginDeps } = setup();
    http.handlers.push(
      () => tokenResponse(),
      () => profileResponse({ status: "active" }),
      () => createApiKeyResponse(),
    );

    await auth.login(loginDeps);

    expect(auth.getStatus()).toBe("loggedIn");
    const createKeyCalls = http.requests.filter((r) =>
      r.url.includes("/create_api_key"),
    );
    expect(createKeyCalls).toHaveLength(1);
  });

  it("login without entitlement → loggedInNoEntitlement and no create_api_key", async () => {
    const { auth, http, loginDeps } = setup();
    http.handlers.push(
      () => tokenResponse(),
      () => profileResponse(null),
    );

    await auth.login(loginDeps);

    expect(auth.getStatus()).toBe("loggedInNoEntitlement");
    const createKeyCalls = http.requests.filter((r) =>
      r.url.includes("/create_api_key"),
    );
    expect(createKeyCalls).toHaveLength(0);
  });

  it("restoreFromStorage makes zero http requests", async () => {
    const { auth, store, http, storage } = setup();
    await storage.store(
      CREDENTIALS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        accessToken: "access-1",
        refreshToken: "refresh-1",
        expiresAt: Date.now() + 120_000,
        entitlementStatus: "active",
      }),
    );

    http.requestCount = 0;
    await auth.restoreFromStorage();

    expect(http.requestCount).toBe(0);
    expect(store.getCredentials()?.accessToken).toBe("access-1");
    expect(auth.getStatus()).toBe("loggedIn");
  });

  it("validateSession keeps loggedIn when getProfile network fails", async () => {
    const { auth, http, storage } = setup();
    await storage.store(
      CREDENTIALS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        accessToken: "access-1",
        refreshToken: "refresh-1",
        expiresAt: Date.now() + 120_000,
        entitlementStatus: "active",
      }),
    );
    await auth.restoreFromStorage();
    expect(auth.getStatus()).toBe("loggedIn");

    http.handlers.push(async () => {
      throw Object.assign(new Error("network down"), {
        statusCode: 0,
        message: "network down",
        source: "oauth",
        credentialKind: "oauth",
      });
    });

    await auth.validateSession();

    expect(auth.getStatus()).toBe("loggedIn");
  });

  it("validateSession → loggedOut when refresh is invalid", async () => {
    const { auth, http, storage } = setup();
    await storage.store(
      CREDENTIALS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        accessToken: "access-1",
        refreshToken: "refresh-1",
        expiresAt: Date.now() - 1_000,
        entitlementStatus: "active",
      }),
    );
    await auth.restoreFromStorage();
    expect(auth.getStatus()).toBe("loggedIn");

    http.handlers.push(() => ({
      status: 401,
      bodyText: JSON.stringify({
        reason: "SOFTWARE_OAUTH_REFRESH_TOKEN_INVALID",
        message: "invalid refresh",
      }),
    }));

    await auth.validateSession();

    expect(auth.getStatus()).toBe("loggedOut");
  });

  it("second login closes the first callback server", async () => {
    const { auth, http, servers, loginDeps, setOpenedUrl } = setup();

    // First login: hang on callback result (do not complete)
    const hangingDeps: LoginDeps = {
      ...loginDeps,
      openBrowser: async (url) => {
        setOpenedUrl(url);
        // intentionally do not complete first server
      },
    };

    const firstLogin = auth.login(hangingDeps);
    // let first login reach await result
    await Promise.resolve();
    await Promise.resolve();
    expect(servers).toHaveLength(1);
    expect(servers[0]!.closed).toBe(false);

    http.handlers.push(
      () => tokenResponse(),
      () => profileResponse({ status: "active" }),
      () => createApiKeyResponse(),
    );

    const secondLogin = auth.login(loginDeps);
    expect(servers[0]!.closed).toBe(true);

    await expect(firstLogin).rejects.toThrow();
    await secondLogin;
    expect(auth.getStatus()).toBe("loggedIn");
    expect(servers).toHaveLength(2);
  });

  it("getPublicUserInfo only exposes displayName and emailMasked", async () => {
    const { auth, http, loginDeps } = setup();
    http.handlers.push(
      () => tokenResponse(),
      () => profileResponse({ status: "active" }),
      () => createApiKeyResponse(),
    );

    await auth.login(loginDeps);

    const info = auth.getPublicUserInfo();
    expect(info).toEqual({
      displayName: "Ada",
      emailMasked: "u***@example.com",
    });
    expect(info).not.toHaveProperty("uuid");
    expect(info).not.toHaveProperty("email");
    expect(JSON.stringify(info)).not.toContain("user-uuid-secret");
    expect(JSON.stringify(info)).not.toContain("user@example.com");
  });
});
