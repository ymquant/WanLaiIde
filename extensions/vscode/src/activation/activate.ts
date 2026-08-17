import { getContinueRcPath, getTsConfigPath } from "core/util/paths";
import { CREDENTIALS_STORAGE_KEY } from "core/auth/types";
import * as vscode from "vscode";

import { createAuthModule } from "../auth/createAuthModule";
import {
  notifyWanLaiLoginOutcome,
  runWanLaiLogin,
} from "../auth/runWanLaiLogin";
import { VsCodeExtension } from "../extension/VsCodeExtension";
import { isUnsupportedPlatform } from "../util/util";

import { GlobalContext } from "core/util/GlobalContext";
import { VsCodeContinueApi } from "./api";
import setupInlineTips from "./InlineTipManager";

export async function activateExtension(context: vscode.ExtensionContext) {
  const authModule = await createAuthModule(context);
  await authModule.authService.restoreFromStorage();
  void authModule.authService.validateSession().catch((err) => {
    authModule.logger.warn("validateSession failed", { err: String(err) });
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("wanlaiide.auth.login", async () => {
      const result = await runWanLaiLogin(authModule);
      await notifyWanLaiLoginOutcome(result);
    }),
    vscode.commands.registerCommand("wanlaiide.auth.logout", () =>
      authModule.authService.logout(),
    ),
    context.secrets.onDidChange(async (e) => {
      if (e.key !== CREDENTIALS_STORAGE_KEY) {
        return;
      }
      await authModule.credentialStore.reloadFromStorage();
      await authModule.authService.syncStatusFromStore();
    }),
    vscode.window.onDidChangeWindowState(async (state) => {
      if (!state.focused) {
        return;
      }
      await authModule.credentialStore.reloadFromStorage();
      await authModule.authService.syncStatusFromStore();
    }),
  );

  const platformCheck = isUnsupportedPlatform();
  const globalContext = new GlobalContext();
  const hasShownUnsupportedPlatformWarning = globalContext.get(
    "hasShownUnsupportedPlatformWarning",
  );

  if (platformCheck.isUnsupported && !hasShownUnsupportedPlatformWarning) {
    const platformTarget = "windows-arm64";

    globalContext.update("hasShownUnsupportedPlatformWarning", true);
    void vscode.window.showInformationMessage(
      `Continue detected that you are using ${platformTarget}. Due to native dependencies, Continue may not be able to start`,
    );
  }

  // Add necessary files
  getTsConfigPath();
  getContinueRcPath();

  // Register commands and providers
  setupInlineTips(context);

  const vscodeExtension = new VsCodeExtension(context, authModule);

  // Load Continue configuration
  if (!context.globalState.get("hasBeenInstalled")) {
    void context.globalState.update("hasBeenInstalled", true);
  }

  // Register config.yaml schema by removing old entries and adding new one (uri.fsPath changes with each version)
  const yamlMatcher = ".continue/**/*.yaml";
  const yamlConfig = vscode.workspace.getConfiguration("yaml");
  const yamlSchemas = yamlConfig.get<object>("schemas", {});

  const newPath = vscode.Uri.joinPath(
    context.extension.extensionUri,
    "config-yaml-schema.json",
  ).toString();

  try {
    await yamlConfig.update(
      "schemas",
      {
        ...yamlSchemas,
        [newPath]: [yamlMatcher],
      },
      vscode.ConfigurationTarget.Global,
    );
  } catch (error) {
    console.error(
      "Failed to register Continue config.yaml schema, most likely, YAML extension is not installed",
      error,
    );
  }

  const api = new VsCodeContinueApi(vscodeExtension);
  const continuePublicApi = {
    registerCustomContextProvider: api.registerCustomContextProvider.bind(api),
  };

  // 'export' public api-surface
  // or entire extension for testing
  return process.env.NODE_ENV === "test"
    ? {
        ...continuePublicApi,
        extension: vscodeExtension,
      }
    : continuePublicApi;
}
