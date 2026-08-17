import { describe, expect, it } from "vitest";

import { mapRuntimeModelsToWanLaiModelConfigs } from "./WanLaiProfileLoader.js";

describe("mapRuntimeModelsToWanLaiModelConfigs", () => {
  const deviceInfo = {
    id: "dev-id",
    name: "My PC",
    os: "win32",
    arch: "x64",
  };

  it("maps models to openai provider with runtime key and X-Wanlai headers", () => {
    const models = mapRuntimeModelsToWanLaiModelConfigs({
      models: [
        { id: "wanlai-chat", name: "WanLai Chat", context_length: 16384 },
        { id: "wanlai-fast" },
      ],
      runtimeKey: "sk-runtime-in-memory-only",
      apiBase: "https://api.wanlai.ai/v1",
      clientName: "wanlaicodex",
      clientVersion: "1.2.3",
      deviceInfo,
    });

    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({
      name: "WanLai Chat",
      provider: "openai",
      model: "wanlai-chat",
      apiBase: "https://api.wanlai.ai/v1",
      apiKey: "sk-runtime-in-memory-only",
      contextLength: 16384,
    });
    expect(models[0].requestOptions?.headers).toEqual({
      "X-Wanlai-Client": "wanlaicodex",
      "X-Wanlai-Client-Version": "1.2.3",
      "X-Wanlai-Device-Id": "dev-id",
      "X-Wanlai-Device-Name": "My PC",
      "X-Wanlai-OS": "win32",
      "X-Wanlai-Arch": "x64",
    });
    expect(models[1]).toMatchObject({
      name: "wanlai-fast",
      model: "wanlai-fast",
      contextLength: 8192,
    });
  });

  it("sanitizes control characters in header values", () => {
    const [model] = mapRuntimeModelsToWanLaiModelConfigs({
      models: [{ id: "m1" }],
      runtimeKey: "sk-x",
      apiBase: "https://api.wanlai.ai/v1",
      clientName: "wan\nlaicodex",
      clientVersion: "1\0.0",
      deviceInfo: { ...deviceInfo, name: "Bad\rName" },
    });

    expect(model.requestOptions?.headers?.["X-Wanlai-Client"]).toBe(
      "wanlaicodex",
    );
    expect(model.requestOptions?.headers?.["X-Wanlai-Client-Version"]).toBe(
      "1.0",
    );
    expect(model.requestOptions?.headers?.["X-Wanlai-Device-Name"]).toBe(
      "BadName",
    );
  });
});
