import { AuthService } from "core/auth/authService";
import { CredentialStore } from "core/auth/credentialStore";
import { OAuthApiClient } from "core/auth/oauthApiClient";
import { RequestCanceller } from "core/auth/requestCanceller";
import { RuntimeApiClient } from "core/auth/runtimeApiClient";
import { SanitizedLogger } from "core/auth/sanitizedLogger";
import {
  DEFAULT_CLIENT_ID,
  DEFAULT_SCOPE,
  type DeviceInfo,
  type OAuthClientConfig,
} from "core/auth/types";
import type { LoggerPort } from "core/ports/loggerPort";
import * as vscode from "vscode";

import { getDeviceInfo } from "./deviceInfo";
import { HttpClientAdapter } from "./httpClientAdapter";
import { OutputChannelLogger } from "./outputChannelLogger";
import { SecretStorageAdapter } from "./secretStorageAdapter";

export interface AuthModule {
  authService: AuthService;
  credentialStore: CredentialStore;
  runtimeApiClient: RuntimeApiClient;
  deviceInfo: DeviceInfo;
  oauthConfig: OAuthClientConfig;
  logger: LoggerPort;
}

export async function createAuthModule(
  context: vscode.ExtensionContext,
): Promise<AuthModule> {
  const cfg = vscode.workspace.getConfiguration("wanlaiide");
  const apiBaseUrl = cfg.get<string>(
    "apiBaseUrl",
    "https://api.wanlai.ai/v1",
  );
  const siteBaseUrl = cfg.get<string>("siteBaseUrl", "https://wanlai.ai");
  const apiOrigin = apiBaseUrl.replace(/\/v1\/?$/, "");

  const packageJson = context.extension.packageJSON as { version?: string };
  const oauthConfig: OAuthClientConfig = {
    apiOrigin,
    apiBase: apiBaseUrl,
    siteBase: siteBaseUrl,
    clientId: DEFAULT_CLIENT_ID,
    scope: DEFAULT_SCOPE,
    clientName: "wanlaicodex",
    clientVersion: packageJson.version ?? "0.0.0",
  };

  const rawLogger = new OutputChannelLogger("WanLai");
  context.subscriptions.push(rawLogger.outputChannel);
  const logger = new SanitizedLogger(rawLogger);

  const http = new HttpClientAdapter();
  const storage = new SecretStorageAdapter(context.secrets);
  const canceller = new RequestCanceller();
  const deviceInfo = getDeviceInfo(vscode.env.machineId);

  let oauthApiClient!: OAuthApiClient;
  const credentialStore = new CredentialStore({
    storage,
    refreshToken: (token) => oauthApiClient.refreshToken(token),
    logger,
  });

  oauthApiClient = new OAuthApiClient({
    http,
    config: oauthConfig,
    getAccessToken: async () => {
      const token = await credentialStore.getValidAccessToken();
      if (!token) {
        throw new Error("no access token");
      }
      return token;
    },
  });

  const runtimeApiClient = new RuntimeApiClient({
    http,
    config: oauthConfig,
    device: deviceInfo,
    getRuntimeApiKey: async () => {
      const key = await credentialStore.getRuntimeApiKey();
      if (!key) {
        throw new Error("no runtime api key");
      }
      return key;
    },
  });

  const authService = new AuthService({
    credentialStore,
    oauthApiClient,
    canceller,
    logger,
    config: oauthConfig,
  });

  return {
    authService,
    credentialStore,
    runtimeApiClient,
    deviceInfo,
    oauthConfig,
    logger,
  };
}
