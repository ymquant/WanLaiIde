import { describe, expect, it } from "vitest";
import type { HttpClientPort, HttpRequestOptions, HttpResponse } from "../ports/httpClientPort.js";
import { RuntimeApiClient } from "./runtimeApiClient.js";
import {
  DEFAULT_CLIENT_ID,
  type DeviceInfo,
  type OAuthClientConfig,
} from "./types.js";

class FakeHttp implements HttpClientPort {
  lastRequest: HttpRequestOptions | undefined;
  response: HttpResponse = { status: 200, bodyText: "{}" };

  async request(options: HttpRequestOptions): Promise<HttpResponse> {
    this.lastRequest = options;
    return this.response;
  }
}

const config: OAuthClientConfig = {
  apiOrigin: "https://api.wanlai.ai",
  apiBase: "https://api.wanlai.ai/v1",
  siteBase: "https://wanlai.ai",
  clientId: DEFAULT_CLIENT_ID,
  scope: "user:profile user:inference",
  clientName: "wanlaicodex",
  clientVersion: "0.0.1",
};

const device: DeviceInfo = {
  id: "device-abc",
  name: "Dev\nMachine",
  os: "win32",
  arch: "x64",
};

describe("RuntimeApiClient", () => {
  it("getModels GETs models with X-Wanlai-* and Bearer runtime key", async () => {
    const http = new FakeHttp();
    http.response = {
      status: 200,
      bodyText: JSON.stringify({
        data: [{ id: "model-a", object: "model" }],
      }),
    };
    const client = new RuntimeApiClient({
      http,
      config,
      device,
      getRuntimeApiKey: async () => "sk-test",
    });

    const models = await client.getModels();

    expect(http.lastRequest!.method).toBe("GET");
    expect(http.lastRequest!.url).toBe("https://api.wanlai.ai/v1/models");
    expect(http.lastRequest!.timeoutMs).toBe(15_000);
    expect(http.lastRequest!.headers?.Authorization).toBe("Bearer sk-test");
    expect(http.lastRequest!.headers?.["X-Wanlai-Client"]).toBe("wanlaicodex");
    expect(http.lastRequest!.headers?.["X-Wanlai-Device-Id"]).toBe("device-abc");
    expect(models).toEqual([{ id: "model-a", object: "model" }]);
  });

  it("strips newline from Device-Name header", async () => {
    const http = new FakeHttp();
    http.response = {
      status: 200,
      bodyText: JSON.stringify({ data: [] }),
    };
    const client = new RuntimeApiClient({
      http,
      config,
      device,
      getRuntimeApiKey: async () => "sk-test",
    });

    await client.getModels();

    expect(http.lastRequest!.headers?.["X-Wanlai-Device-Name"]).toBe("DevMachine");
    expect(http.lastRequest!.headers?.["X-Wanlai-Device-Name"]).not.toContain("\n");
  });

  it("throws StructuredError on HTTP 4xx via parseError", async () => {
    const http = new FakeHttp();
    http.response = {
      status: 401,
      bodyText: JSON.stringify({
        error: { code: "invalid_api_key", message: "bad key" },
      }),
    };
    const client = new RuntimeApiClient({
      http,
      config,
      device,
      getRuntimeApiKey: async () => "sk-bad",
    });

    await expect(client.getModels()).rejects.toMatchObject({
      statusCode: 401,
      source: "chat",
      credentialKind: "runtime",
    });
  });
});
