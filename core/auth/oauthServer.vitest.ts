import { describe, expect, it } from "vitest";
import { OAuthCallbackServer } from "./oauthServer.js";

describe("OAuthCallbackServer", () => {
  it("ignores favicon and still accepts /callback", async () => {
    const server = new OAuthCallbackServer();
    const { port, result } = await server.start(2000);

    const favicon = await fetch(`http://127.0.0.1:${port}/favicon.ico`);
    expect(favicon.status).toBeGreaterThanOrEqual(200);
    expect(favicon.status).toBeLessThan(500);

    const callback = fetch(
      `http://127.0.0.1:${port}/callback?code=abc&state=xyz`,
    );
    const resolved = await result;
    expect(resolved).toEqual({ code: "abc", state: "xyz" });
    await callback;
    server.close();
  });

  it("resolves on /callback?code&state and closes the server", async () => {
    const server = new OAuthCallbackServer();
    const { port, result } = await server.start(2000);

    const resPromise = fetch(
      `http://127.0.0.1:${port}/callback?code=tok&state=st`,
    );
    const resolved = await result;
    expect(resolved).toEqual({ code: "tok", state: "st" });

    const res = await resPromise;
    const html = await res.text();
    expect(html).toContain("登录成功");
    expect(html).toContain("可以关闭此页面");
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html).not.toContain("tok");

    // Server closed after callback (address cleared; OS may briefly keep the port).
    expect(server.getListenAddress()).toBeNull();
    expect(port).toBeGreaterThan(0);
  });

  it("rejects on /callback?error=access_denied as LoginCancelled", async () => {
    const server = new OAuthCallbackServer();
    const { port, result } = await server.start(2000);

    const resPromise = fetch(
      `http://127.0.0.1:${port}/callback?error=access_denied`,
    );
    await expect(result).rejects.toMatchObject({
      name: "LoginCancelled",
      message: "已取消登录",
    });

    const res = await resPromise;
    const html = await res.text();
    expect(html).toContain("登录失败");
    expect(html).toContain("可以关闭此页面");
    expect(html.toLowerCase()).not.toContain("<script");
  });

  it("listens on 127.0.0.1 only", async () => {
    const server = new OAuthCallbackServer();
    const { port } = await server.start(2000);
    const address = server.getListenAddress();
    expect(address).not.toBeNull();
    if (typeof address === "object" && address !== null) {
      expect(address.address).toBe("127.0.0.1");
      expect(address.port).toBe(port);
    }
    server.close();
  });
});
