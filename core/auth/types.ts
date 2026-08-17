export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix ms
}

export interface Credentials extends OAuthTokens {
  runtimeApiKey?: string;
  entitlementStatus?: "active" | string;
}

export type AuthStatus =
  | "loggedOut"
  | "loggingIn"
  | "loggedIn"
  | "loggedInNoEntitlement";

/** Safe for Webview: no token / uuid / raw email. */
export interface AuthStatusPayload {
  status: AuthStatus;
  user?: { displayName: string; emailMasked: string };
  entitlement?: { status: string };
}

export interface UserProfile {
  displayName: string;
  email: string;
  emailMasked: string;
  uuid: string;
  organizationType: string;
  entitlementStatus?: "active" | string;
}

export const CREDENTIALS_STORAGE_KEY = "wanlaiide.credentials";

export interface StoredCredentialBlob {
  version: 1;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  runtimeApiKey?: string;
  entitlementStatus?: string;
}

export interface LoginDeps {
  openBrowser: (url: string) => Promise<void>;
  createCallbackServer: () => import("../ports/callbackServerPort.js").CallbackServerPort;
  redirectUriFactory: (port: number) => string;
}

export interface DeviceInfo {
  id: string;
  name: string;
  os: string;
  arch: string;
}

export interface OAuthClientConfig {
  apiOrigin: string;
  apiBase: string;
  siteBase: string;
  clientId: string;
  scope: string;
  clientName: string;
  clientVersion: string;
}

export const DEFAULT_CLIENT_ID = "wanlaicode-cli";
export const DEFAULT_SCOPE = "user:profile user:inference";
