import type { AuthService } from "core/auth/authService";
import type { RuntimeApiClient } from "core/auth/runtimeApiClient";
import type { DeviceInfo, OAuthClientConfig } from "core/auth/types";
import type { ConfigHandler } from "core/config/ConfigHandler";
import { ProfileLifecycleManager } from "core/config/ProfileLifecycleManager";
import WanLaiProfileLoader from "core/config/profile/WanLaiProfileLoader";
import type { IDE, ILLMLogger } from "core";

export interface WanLaiConfigBridgeDeps {
  configHandler: ConfigHandler;
  authService: AuthService;
  runtimeClient: RuntimeApiClient;
  deviceInfo: DeviceInfo;
  oauthConfig: OAuthClientConfig;
  ide: IDE;
  llmLogger: ILLMLogger;
}

/**
 * After Core/ConfigHandler exist: register WanLai in-memory profile and reload on auth changes.
 */
export function attachWanLaiConfigBridge(deps: WanLaiConfigBridgeDeps): void {
  const loader = new WanLaiProfileLoader({
    ide: deps.ide,
    llmLogger: deps.llmLogger,
    authService: deps.authService,
    runtimeClient: deps.runtimeClient,
    deviceInfo: deps.deviceInfo,
    oauthConfig: deps.oauthConfig,
  });
  const manager = new ProfileLifecycleManager(loader, deps.ide);
  deps.configHandler.registerWanLaiProfile(manager);

  deps.authService.onStatusChange.subscribe(() => {
    void deps.configHandler.reloadConfig("WanLai auth status changed");
  });

  // refreshAll → cascadeInit/loadProfiles so wanlaiide is inserted and preferred
  void deps.configHandler.refreshAll("WanLai profile registered");
}
