import type { LoggerPort } from "../ports/loggerPort.js";
import type { SecretStoragePort } from "../ports/secretStoragePort.js";
import { getErrorAction, type StructuredError } from "./errorMapper.js";
import {
  CREDENTIALS_STORAGE_KEY,
  type Credentials,
  type OAuthTokens,
  type StoredCredentialBlob,
} from "./types.js";

const EXPIRY_BUFFER_MS = 60_000;

export interface CredentialStoreDeps {
  storage: SecretStoragePort;
  refreshToken: (token: string) => Promise<OAuthTokens>;
  logger: LoggerPort;
}

export class CredentialStore {
  private revision = 0;
  private refreshPromise: Promise<void> | null = null;
  private credentials: Credentials | null = null;

  private readonly storage: SecretStoragePort;
  private readonly refreshTokenFn: (token: string) => Promise<OAuthTokens>;
  private readonly logger: LoggerPort;

  constructor(deps: CredentialStoreDeps) {
    this.storage = deps.storage;
    this.refreshTokenFn = deps.refreshToken;
    this.logger = deps.logger;
  }

  getCredentials(): Credentials | null {
    return this.credentials;
  }

  async restore(): Promise<void> {
    const raw = await this.storage.get(CREDENTIALS_STORAGE_KEY);
    if (!raw) {
      this.credentials = null;
      return;
    }
    try {
      const blob = JSON.parse(raw) as StoredCredentialBlob;
      if (
        blob?.version !== 1 ||
        typeof blob.accessToken !== "string" ||
        typeof blob.refreshToken !== "string" ||
        typeof blob.expiresAt !== "number"
      ) {
        throw new Error("invalid credential blob");
      }
      this.credentials = {
        accessToken: blob.accessToken,
        refreshToken: blob.refreshToken,
        expiresAt: blob.expiresAt,
        runtimeApiKey: blob.runtimeApiKey,
        entitlementStatus: blob.entitlementStatus,
      };
    } catch {
      this.credentials = null;
      this.logger.warn("Failed to parse credentials from storage");
    }
  }

  async reloadFromStorage(): Promise<void> {
    this.revision++;
    await this.restore();
  }

  async getValidAccessToken(): Promise<string | null> {
    if (!this.credentials) {
      return null;
    }
    if (this.credentials.expiresAt - Date.now() > EXPIRY_BUFFER_MS) {
      return this.credentials.accessToken;
    }
    try {
      await this.refresh();
    } catch (err) {
      if (this.shouldClearOnRefreshError(err)) {
        await this.clear();
        return null;
      }
      throw err;
    }
    return this.credentials?.accessToken ?? null;
  }

  async getRuntimeApiKey(): Promise<string | undefined> {
    return this.credentials?.runtimeApiKey;
  }

  async saveLogin(tokens: OAuthTokens): Promise<void> {
    this.revision++;
    this.credentials = { ...tokens, runtimeApiKey: undefined };
    await this.persist();
  }

  async saveRuntimeApiKey(rawKey: string): Promise<void> {
    if (!this.credentials) {
      return;
    }
    this.credentials = { ...this.credentials, runtimeApiKey: rawKey };
    await this.persist();
  }

  async updateEntitlementStatus(status: string | undefined): Promise<void> {
    if (!this.credentials) {
      return;
    }
    this.credentials = { ...this.credentials, entitlementStatus: status };
    await this.persist();
  }

  async clear(): Promise<void> {
    this.revision++;
    this.credentials = null;
    this.refreshPromise = null;
    await this.storage.delete(CREDENTIALS_STORAGE_KEY);
  }

  private async persist(): Promise<void> {
    if (!this.credentials) {
      return;
    }
    const blob: StoredCredentialBlob = {
      version: 1,
      accessToken: this.credentials.accessToken,
      refreshToken: this.credentials.refreshToken,
      expiresAt: this.credentials.expiresAt,
      runtimeApiKey: this.credentials.runtimeApiKey,
      entitlementStatus: this.credentials.entitlementStatus,
    };
    await this.storage.store(CREDENTIALS_STORAGE_KEY, JSON.stringify(blob));
  }

  private async refresh(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const myRevision = this.revision;
    const current = this.credentials;
    if (!current) {
      return;
    }

    this.refreshPromise = (async () => {
      try {
        const tokens = await this.refreshTokenFn(current.refreshToken);
        if (myRevision !== this.revision) {
          return;
        }
        this.credentials = {
          ...tokens,
          runtimeApiKey: current.runtimeApiKey,
          entitlementStatus: current.entitlementStatus,
        };
        await this.persist();
      } catch (err) {
        if (this.shouldClearOnRefreshError(err)) {
          if (myRevision === this.revision) {
            await this.clear();
          }
          return;
        }
        throw err;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private shouldClearOnRefreshError(err: unknown): boolean {
    const structured = err as Partial<StructuredError> | null;
    if (
      structured &&
      typeof structured === "object" &&
      structured.reason === "SOFTWARE_OAUTH_REFRESH_TOKEN_INVALID"
    ) {
      return true;
    }
    if (
      structured &&
      typeof structured === "object" &&
      typeof structured.statusCode === "number"
    ) {
      const action = getErrorAction(structured as StructuredError);
      return action.type === "clear_and_relogin";
    }
    return false;
  }
}
