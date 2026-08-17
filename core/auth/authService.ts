import type { LoggerPort } from "../ports/loggerPort.js";
import type { CallbackServerPort } from "../ports/callbackServerPort.js";
import type { CredentialStore } from "./credentialStore.js";
import { AuthEventEmitter } from "./eventEmitter.js";
import { maskEmail } from "./maskEmail.js";
import type { OAuthApiClient, ProfileResponse } from "./oauthApiClient.js";
import { createOAuthAttempt, statesEqual } from "./pkce.js";
import type { RequestCanceller } from "./requestCanceller.js";
import type {
  AuthStatus,
  LoginDeps,
  OAuthClientConfig,
  UserProfile,
} from "./types.js";

export interface AuthServiceDeps {
  credentialStore: CredentialStore;
  oauthApiClient: OAuthApiClient;
  canceller: RequestCanceller;
  logger: LoggerPort;
  config: OAuthClientConfig;
}

function hasActiveEntitlement(profile: ProfileResponse): boolean {
  return profile.entitlement?.status === "active";
}

export class AuthService {
  readonly onStatusChange = new AuthEventEmitter<AuthStatus>();

  private status: AuthStatus = "loggedOut";
  private profile: UserProfile | null = null;
  private loginGeneration = 0;
  private activeServer: CallbackServerPort | null = null;

  private readonly credentialStore: CredentialStore;
  private readonly oauthApiClient: OAuthApiClient;
  private readonly canceller: RequestCanceller;
  private readonly logger: LoggerPort;
  private readonly config: OAuthClientConfig;

  constructor(deps: AuthServiceDeps) {
    this.credentialStore = deps.credentialStore;
    this.oauthApiClient = deps.oauthApiClient;
    this.canceller = deps.canceller;
    this.logger = deps.logger;
    this.config = deps.config;
  }

  getStatus(): AuthStatus {
    return this.status;
  }

  getUserProfile(): UserProfile | null {
    return this.profile;
  }

  getPublicUserInfo(): { displayName: string; emailMasked: string } | null {
    if (!this.profile) {
      return null;
    }
    return {
      displayName: this.profile.displayName,
      emailMasked: this.profile.emailMasked,
    };
  }

  async getRuntimeApiKey(): Promise<string | null> {
    return (await this.credentialStore.getRuntimeApiKey()) ?? null;
  }

  async login(deps: LoginDeps): Promise<void> {
    const generation = ++this.loginGeneration;
    this.canceller.abortAll();
    this.closeActiveServer();

    this.setStatus("loggingIn");

    let server: CallbackServerPort | null = null;
    try {
      const attempt = createOAuthAttempt();
      server = deps.createCallbackServer();
      this.activeServer = server;

      const { port, result } = await server.start(15 * 60 * 1000);
      const redirectUri = deps.redirectUriFactory(port);
      const authorizeUrl = this.buildAuthorizeUrl(
        attempt.codeChallenge,
        attempt.state,
        redirectUri,
      );
      await deps.openBrowser(authorizeUrl);

      const callback = await result;
      this.ensureLoginGeneration(generation);

      if (!statesEqual(attempt.state, callback.state)) {
        throw new Error("OAuth state mismatch");
      }

      const tokens = await this.oauthApiClient.exchangeCode(
        callback.code,
        attempt.codeVerifier,
        redirectUri,
      );
      this.ensureLoginGeneration(generation);

      await this.credentialStore.saveLogin(tokens);
      this.ensureLoginGeneration(generation);

      await this.applyProfileAndEntitlement();
      this.ensureLoginGeneration(generation);
    } catch (err) {
      if (
        generation === this.loginGeneration &&
        !(err instanceof Error && err.name === "LoginCancelled")
      ) {
        const creds = this.credentialStore.getCredentials();
        if (!creds) {
          this.profile = null;
          this.setStatus("loggedOut");
        } else {
          await this.syncStatusFromStore();
        }
      }
      throw err;
    } finally {
      if (server) {
        server.close();
        if (this.activeServer === server) {
          this.activeServer = null;
        }
      }
    }
  }

  async logout(): Promise<void> {
    this.loginGeneration++;
    this.canceller.abortAll();
    this.closeActiveServer();
    await this.credentialStore.clear();
    this.profile = null;
    this.setStatus("loggedOut");
  }

  async syncStatusFromStore(): Promise<void> {
    const creds = this.credentialStore.getCredentials();
    if (!creds) {
      this.profile = null;
      this.setStatus("loggedOut");
      return;
    }
    if (creds.entitlementStatus === "active") {
      this.setStatus("loggedIn");
      return;
    }
    if (creds.entitlementStatus) {
      this.setStatus("loggedInNoEntitlement");
      return;
    }
    this.setStatus("loggedIn");
  }

  async restoreFromStorage(): Promise<void> {
    await this.credentialStore.restore();
    await this.syncStatusFromStore();
  }

  async validateSession(): Promise<void> {
    const creds = this.credentialStore.getCredentials();
    if (!creds) {
      this.setStatus("loggedOut");
      return;
    }

    let accessToken: string | null;
    try {
      accessToken = await this.credentialStore.getValidAccessToken();
    } catch (err) {
      this.logger.warn("validateSession: token refresh network failure", {
        err: String(err),
      });
      return;
    }

    if (!accessToken) {
      // Cleared due to invalid refresh (or no creds)
      this.profile = null;
      this.setStatus("loggedOut");
      return;
    }

    let profile: ProfileResponse;
    try {
      profile = await this.oauthApiClient.getProfile();
    } catch (err) {
      const structured = err as { statusCode?: number; reason?: string };
      if (
        structured &&
        typeof structured === "object" &&
        structured.statusCode === 401
      ) {
        // Try once more via getValidAccessToken path already done; treat as logout
        if (
          structured.reason === "SOFTWARE_OAUTH_REFRESH_TOKEN_INVALID" ||
          structured.reason === "SOFTWARE_OAUTH_ACCESS_TOKEN_INVALID" ||
          structured.reason === "TOKEN_EXPIRED"
        ) {
          await this.credentialStore.clear();
          this.profile = null;
          this.setStatus("loggedOut");
          return;
        }
        await this.credentialStore.clear();
        this.profile = null;
        this.setStatus("loggedOut");
        return;
      }

      // Network / 5xx / status 0 → keep current status
      this.logger.warn("validateSession: getProfile failed, keeping status", {
        err: String(err),
      });
      return;
    }

    await this.applyProfileResponse(profile);
  }

  private async applyProfileAndEntitlement(): Promise<void> {
    const profile = await this.oauthApiClient.getProfile();
    await this.applyProfileResponse(profile);
  }

  private async applyProfileResponse(profile: ProfileResponse): Promise<void> {
    const email = profile.account.email_address;
    const active = hasActiveEntitlement(profile);
    const entitlementStatus = active ? "active" : profile.entitlement?.status;

    this.profile = {
      displayName: profile.account.display_name,
      email,
      emailMasked: maskEmail(email),
      uuid: profile.account.uuid,
      organizationType: profile.organization?.organization_type ?? "",
      entitlementStatus,
    };

    await this.credentialStore.updateEntitlementStatus(entitlementStatus);

    if (active) {
      const existingKey = await this.credentialStore.getRuntimeApiKey();
      if (!existingKey) {
        const rawKey = await this.oauthApiClient.createRuntimeApiKey();
        await this.credentialStore.saveRuntimeApiKey(rawKey);
      }
      this.setStatus("loggedIn");
    } else {
      this.setStatus("loggedInNoEntitlement");
    }
  }

  private buildAuthorizeUrl(
    codeChallenge: string,
    state: string,
    redirectUri: string,
  ): string {
    const url = new URL(
      `${this.config.siteBase.replace(/\/$/, "")}/software/oauth/authorize`,
    );
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("scope", this.config.scope);
    url.searchParams.set("prompt", "login");
    return url.toString();
  }

  private setStatus(status: AuthStatus): void {
    this.status = status;
    this.onStatusChange.fire(status);
  }

  private closeActiveServer(): void {
    if (this.activeServer) {
      this.activeServer.close();
      this.activeServer = null;
    }
  }

  private ensureLoginGeneration(generation: number): void {
    if (generation !== this.loginGeneration) {
      throw Object.assign(new Error("LoginCancelled"), {
        name: "LoginCancelled",
      });
    }
  }
}
