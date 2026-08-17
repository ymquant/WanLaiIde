import { describe, expect, it, vi } from "vitest";
import { CREDENTIALS_STORAGE_KEY, type OAuthTokens } from "./types.js";
import type { SecretStoragePort } from "../ports/secretStoragePort.js";
import type { LoggerPort } from "../ports/loggerPort.js";
import { CredentialStore } from "./credentialStore.js";

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

function createLogger(): LoggerPort {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function tokens(overrides: Partial<OAuthTokens> = {}): OAuthTokens {
  return {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAt: Date.now() + 120_000,
    ...overrides,
  };
}

describe("CredentialStore", () => {
  it("saveLogin stores a single version:1 blob under wanlaiide.credentials", async () => {
    const storage = new FakeStorage();
    const store = new CredentialStore({
      storage,
      refreshToken: vi.fn(),
      logger: createLogger(),
    });

    await store.saveLogin(tokens());

    const raw = await storage.get(CREDENTIALS_STORAGE_KEY);
    expect(raw).toBeDefined();
    const blob = JSON.parse(raw!);
    expect(blob.version).toBe(1);
    expect(blob.accessToken).toBe("access-1");
    expect(blob.refreshToken).toBe("refresh-1");
    expect(typeof blob.expiresAt).toBe("number");

    expect(storage.map.size).toBe(1);
    expect(storage.map.has("access_token")).toBe(false);
    expect(storage.map.has("refresh_token")).toBe(false);
    expect(storage.map.has("expires_at")).toBe(false);
    expect(storage.map.has("api_key")).toBe(false);
  });

  it("does not refresh when token is unexpired", async () => {
    const storage = new FakeStorage();
    const refreshToken = vi.fn();
    const store = new CredentialStore({
      storage,
      refreshToken,
      logger: createLogger(),
    });

    await store.saveLogin(tokens({ expiresAt: Date.now() + 120_000 }));
    const access = await store.getValidAccessToken();

    expect(access).toBe("access-1");
    expect(refreshToken).not.toHaveBeenCalled();
  });

  it("refreshes once for concurrent calls when expired (single-flight)", async () => {
    const storage = new FakeStorage();
    let resolveRefresh!: (value: OAuthTokens) => void;
    const refreshToken = vi.fn(
      () =>
        new Promise<OAuthTokens>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const store = new CredentialStore({
      storage,
      refreshToken,
      logger: createLogger(),
    });

    await store.saveLogin(tokens({ expiresAt: Date.now() - 1_000 }));

    const p1 = store.getValidAccessToken();
    const p2 = store.getValidAccessToken();

    expect(refreshToken).toHaveBeenCalledTimes(1);

    resolveRefresh({
      accessToken: "access-2",
      refreshToken: "refresh-2",
      expiresAt: Date.now() + 3_600_000,
    });

    const [a1, a2] = await Promise.all([p1, p2]);
    expect(a1).toBe("access-2");
    expect(a2).toBe("access-2");
    expect(refreshToken).toHaveBeenCalledTimes(1);
  });

  it("preserves runtimeApiKey across successful refresh", async () => {
    const storage = new FakeStorage();
    const refreshToken = vi.fn(async () => ({
      accessToken: "access-2",
      refreshToken: "refresh-2",
      expiresAt: Date.now() + 3_600_000,
    }));
    const store = new CredentialStore({
      storage,
      refreshToken,
      logger: createLogger(),
    });

    await store.saveLogin(tokens({ expiresAt: Date.now() + 120_000 }));
    await store.saveRuntimeApiKey("sk-runtime-old");

    // Force expiry by rewriting blob with past expiresAt
    const blob = JSON.parse((await storage.get(CREDENTIALS_STORAGE_KEY))!);
    blob.expiresAt = Date.now() - 1_000;
    await storage.store(CREDENTIALS_STORAGE_KEY, JSON.stringify(blob));
    await store.reloadFromStorage();

    await store.getValidAccessToken();

    const after = JSON.parse((await storage.get(CREDENTIALS_STORAGE_KEY))!);
    expect(after.runtimeApiKey).toBe("sk-runtime-old");
    expect(after.accessToken).toBe("access-2");
  });

  it("clears credentials when refresh token is invalid", async () => {
    const storage = new FakeStorage();
    const refreshToken = vi.fn(async () => {
      throw {
        reason: "SOFTWARE_OAUTH_REFRESH_TOKEN_INVALID",
        statusCode: 401,
        message: "invalid",
        source: "oauth",
        credentialKind: "oauth",
      };
    });
    const store = new CredentialStore({
      storage,
      refreshToken,
      logger: createLogger(),
    });

    await store.saveLogin(tokens({ expiresAt: Date.now() - 1_000 }));
    const access = await store.getValidAccessToken();

    expect(access).toBeNull();
    expect(storage.map.size).toBe(0);
    expect(store.getCredentials()).toBeNull();
  });

  it("does not clear credentials on network error (statusCode 0)", async () => {
    const storage = new FakeStorage();
    const refreshToken = vi.fn(async () => {
      throw {
        reason: undefined,
        statusCode: 0,
        message: "network",
        source: "oauth",
        credentialKind: "oauth",
      };
    });
    const store = new CredentialStore({
      storage,
      refreshToken,
      logger: createLogger(),
    });

    await store.saveLogin(tokens({ expiresAt: Date.now() - 1_000 }));

    await expect(store.getValidAccessToken()).rejects.toMatchObject({
      statusCode: 0,
    });

    expect(storage.map.size).toBe(1);
    const blob = JSON.parse((await storage.get(CREDENTIALS_STORAGE_KEY))!);
    expect(blob.accessToken).toBe("access-1");
    expect(store.getCredentials()?.accessToken).toBe("access-1");
  });

  it("does not let in-flight refresh overwrite a newer saveLogin (revision)", async () => {
    const storage = new FakeStorage();
    let resolveRefresh!: (value: OAuthTokens) => void;
    const refreshToken = vi.fn(
      () =>
        new Promise<OAuthTokens>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const store = new CredentialStore({
      storage,
      refreshToken,
      logger: createLogger(),
    });

    await store.saveLogin(tokens({ expiresAt: Date.now() - 1_000 }));

    const refreshCall = store.getValidAccessToken();
    // Allow refresh to start
    await Promise.resolve();

    await store.saveLogin(
      tokens({
        accessToken: "access-new",
        refreshToken: "refresh-new",
        expiresAt: Date.now() + 3_600_000,
      }),
    );

    resolveRefresh({
      accessToken: "access-stale",
      refreshToken: "refresh-stale",
      expiresAt: Date.now() + 3_600_000,
    });

    await refreshCall.catch(() => undefined);

    const blob = JSON.parse((await storage.get(CREDENTIALS_STORAGE_KEY))!);
    expect(blob.accessToken).toBe("access-new");
    expect(blob.refreshToken).toBe("refresh-new");
    expect(store.getCredentials()?.accessToken).toBe("access-new");
  });

  it("reloadFromStorage picks up externally written blob", async () => {
    const storage = new FakeStorage();
    const store = new CredentialStore({
      storage,
      refreshToken: vi.fn(),
      logger: createLogger(),
    });

    await store.saveLogin(tokens({ accessToken: "access-old" }));

    await storage.store(
      CREDENTIALS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        accessToken: "access-external",
        refreshToken: "refresh-external",
        expiresAt: Date.now() + 120_000,
      }),
    );

    await store.reloadFromStorage();

    expect(store.getCredentials()?.accessToken).toBe("access-external");
    expect(await store.getValidAccessToken()).toBe("access-external");
  });
});
