/**
 * Implements IProfileLoader (`description`, `doLoadConfig`, `setIsActive`).
 * In-memory WanLai auth profile — runtime apiKey stays in memory only (never yaml).
 */
import type { ConfigResult, ModelConfig } from "@continuedev/config-yaml";

import type { ContinueConfig, IDE, ILLMLogger } from "../../index.js";
import type { AuthService } from "../../auth/authService.js";
import type {
  ModelInfo,
  RuntimeApiClient,
} from "../../auth/runtimeApiClient.js";
import type { DeviceInfo, OAuthClientConfig } from "../../auth/types.js";
import type { ProfileDescription } from "../ProfileLifecycleManager.js";
import { rectifySelectedModelsFromGlobalContext } from "../selectedModels.js";
import { configYamlToContinueConfig } from "../yaml/loadYaml.js";
import type { IProfileLoader } from "./IProfileLoader.js";

const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

function sanitizeHeader(value: string, maxLen: number): string {
  return value.replace(CONTROL_CHARS, "").slice(0, maxLen);
}

export interface WanLaiProfileLoaderDeps {
  ide: IDE;
  llmLogger: ILLMLogger;
  authService: AuthService;
  runtimeClient: RuntimeApiClient;
  deviceInfo: DeviceInfo;
  oauthConfig: OAuthClientConfig;
}

export interface MapWanLaiModelsParams {
  models: ModelInfo[];
  runtimeKey: string;
  apiBase: string;
  clientName: string;
  clientVersion: string;
  deviceInfo: DeviceInfo;
}

/** Pure mapping for vitest — openai provider models with X-Wanlai-* headers. */
export function mapRuntimeModelsToWanLaiModelConfigs(
  params: MapWanLaiModelsParams,
): ModelConfig[] {
  const { runtimeKey, apiBase, clientName, clientVersion, deviceInfo } = params;
  const headers = {
    "X-Wanlai-Client": sanitizeHeader(clientName, 128),
    "X-Wanlai-Client-Version": sanitizeHeader(clientVersion, 128),
    "X-Wanlai-Device-Id": sanitizeHeader(deviceInfo.id, 128),
    "X-Wanlai-Device-Name": sanitizeHeader(deviceInfo.name, 64),
    "X-Wanlai-OS": sanitizeHeader(deviceInfo.os, 128),
    "X-Wanlai-Arch": sanitizeHeader(deviceInfo.arch, 128),
  };

  return params.models.map((m) => {
    const name =
      typeof m.name === "string" && m.name.length > 0 ? m.name : m.id;
    const contextLength =
      typeof m.context_length === "number" ? m.context_length : 8192;

    return {
      name,
      provider: "openai",
      model: m.id,
      apiBase,
      apiKey: runtimeKey,
      contextLength,
      roles: ["chat", "summarize", "apply", "edit"],
      requestOptions: { headers },
    };
  });
}

export default class WanLaiProfileLoader implements IProfileLoader {
  static ID = "wanlaiide";

  description: ProfileDescription;

  constructor(private readonly deps: WanLaiProfileLoaderDeps) {
    this.description = {
      id: WanLaiProfileLoader.ID,
      fullSlug: {
        ownerSlug: "",
        packageSlug: "",
        versionSlug: "",
      },
      iconUrl: "",
      title: "WanLai",
      errors: undefined,
      uri: "wanlaiide://profile",
      rawYaml: undefined,
    };
  }

  async doLoadConfig(): Promise<ConfigResult<ContinueConfig>> {
    const models = await this.resolveModelConfigs();
    const ideInfo = await this.deps.ide.getIdeInfo();
    const uniqueId = await this.deps.ide.getUniqueId();

    const { config, errors } = await configYamlToContinueConfig({
      unrolledAssistant: {
        name: "WanLai",
        version: "1.0.0",
        schema: "v1",
        models,
      },
      ide: this.deps.ide,
      ideInfo,
      uniqueId,
      llmLogger: this.deps.llmLogger,
    });

    this.description.errors = errors;

    if (!config) {
      return {
        config: undefined,
        errors,
        configLoadInterrupted: true,
      };
    }

    // Same as LocalProfileLoader/doLoadConfig: pick default selected models
    // so chat/dropdown work without an extra user click.
    const rectified = rectifySelectedModelsFromGlobalContext(
      config,
      this.description.id,
    );

    return {
      config: rectified,
      errors,
      configLoadInterrupted: false,
    };
  }

  setIsActive(_isActive: boolean): void {}

  private async resolveModelConfigs(): Promise<ModelConfig[]> {
    const status = this.deps.authService.getStatus();
    if (
      status === "loggedOut" ||
      status === "loggingIn" ||
      status === "loggedInNoEntitlement"
    ) {
      return [];
    }

    const runtimeKey = await this.deps.authService.getRuntimeApiKey();
    if (!runtimeKey) {
      return [];
    }

    try {
      const models = await this.deps.runtimeClient.getModels();
      return mapRuntimeModelsToWanLaiModelConfigs({
        models,
        runtimeKey,
        apiBase: this.deps.oauthConfig.apiBase,
        clientName: this.deps.oauthConfig.clientName,
        clientVersion: this.deps.oauthConfig.clientVersion,
        deviceInfo: this.deps.deviceInfo,
      });
    } catch {
      return [];
    }
  }
}
