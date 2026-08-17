import http from "node:http";
import type { AddressInfo } from "node:net";
import type {
  CallbackServerPort,
  OAuthCallbackResult,
} from "../ports/callbackServerPort.js";

function loginCancelled(message: string): Error {
  return Object.assign(new Error(message), { name: "LoginCancelled" });
}

// TODO: 在 TSX 中使用 `import logoUrl from "../assets/wanlai-code-logo.png"` 后传入该资源地址。
const BRAND_LOGO_URL = "";

function createResultHtml(
  status: "success" | "failure",
  title: string,
  message: string,
  logoUrl = BRAND_LOGO_URL,
): string {
  const isSuccess = status === "success";
  const statusLabel = isSuccess ? "登录成功" : "登录失败";
  const iconPath = isSuccess
    ? '<path d="m8.5 12.5 2.4 2.4 4.9-5.4"/>'
    : '<path d="m9.5 9.5 5 5m0-5-5 5"/>';
  const logo = logoUrl
    ? `<img class="brand-logo" src="${logoUrl}" alt="万来 Code">`
    : '<span class="brand-logo brand-logo-placeholder" aria-hidden="true">W</span>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${statusLabel} - 万来登录</title>
  <style>
    :root {
      color-scheme: light dark;
      --page: #fafafa;
      --surface: #ffffff;
      --text: #111217;
      --muted: #6c6e76;
      --border: #ddd7f5;
      --grid: rgba(17, 18, 23, .055);
      --accent: ${isSuccess ? "#188763" : "#c84550"};
      --accent-soft: ${isSuccess ? "#e5f7f0" : "#fcebed"};
      --brand: #7657ff;
      --button: #19191c;
      --button-text: #ffffff;
      --shadow: 0 20px 55px rgba(18, 20, 27, .08);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --page: #090a0c;
        --surface: #0b0c0e;
        --text: #f5f5f6;
        --muted: #a2a3aa;
        --border: #302752;
        --grid: rgba(255, 255, 255, .055);
        --accent-soft: ${isSuccess ? "#12382e" : "#452329"};
        --button: #f1f1f2;
        --button-text: #101114;
        --shadow: 0 20px 55px rgba(0, 0, 0, .28);
      }
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; min-height: 100%; }
    body {
      margin: 0;
      min-height: 100vh;
      min-height: 100dvh;
      display: grid;
      place-items: center;
      padding: 24px;
      background-color: var(--page);
      background-image:
        linear-gradient(var(--grid) 1px, transparent 1px),
        linear-gradient(90deg, var(--grid) 1px, transparent 1px);
      background-size: 64px 64px;
      color: var(--text);
      font-family: Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
    }
    .page {
      width: min(100%, 560px);
      text-align: center;
    }
    .brand {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      margin-bottom: 18px;
    }
    .brand-logo {
      display: block;
      width: 48px;
      height: 48px;
      object-fit: contain;
    }
    .brand-logo-placeholder {
      display: grid;
      place-items: center;
      border-radius: 50%;
      color: #f4c82e;
      background: #18191c;
      font-size: 22px;
      font-weight: 800;
    }
    .brand-name {
      margin: 0;
      font-size: 25px;
      font-weight: 750;
      line-height: 1.2;
      letter-spacing: 0;
    }
    main {
      padding: 34px 36px 30px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      box-shadow: var(--shadow);
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      min-height: 26px;
      margin-bottom: 20px;
      padding: 4px 16px;
      border: 1px solid rgba(118, 87, 255, .24);
      border-radius: 999px;
      color: var(--brand);
      background: rgba(118, 87, 255, .06);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 2px;
    }
    .status-icon {
      display: grid;
      place-items: center;
      width: 58px;
      height: 58px;
      margin: 0 auto 20px;
      border-radius: 50%;
      color: var(--accent);
      background: var(--accent-soft);
    }
    .status-icon svg {
      width: 36px;
      height: 36px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 28px;
      line-height: 1.35;
      letter-spacing: 0;
    }
    .message {
      margin: 0;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.7;
    }
    .countdown {
      min-height: 24px;
      margin: 22px 0 20px;
      color: var(--muted);
      font-size: 14px;
      line-height: 24px;
    }
    .countdown strong { color: var(--accent); }
    button {
      width: 100%;
      min-height: 44px;
      padding: 10px 18px;
      border: 0;
      border-radius: 6px;
      color: var(--button-text);
      background: var(--button);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      transition: filter .15s ease, transform .15s ease;
    }
    button:hover { filter: brightness(.88); }
    button:active { transform: translateY(1px); }
    button:focus-visible { outline: 3px solid var(--accent-soft); outline-offset: 3px; }
    .hint {
      min-height: 20px;
      margin: 14px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.6;
    }
    @media (max-width: 480px) {
      body { padding: 16px; }
      .brand { margin-bottom: 16px; }
      main { padding: 30px 22px 26px; }
      h1 { font-size: 25px; }
    }
    @media (prefers-reduced-motion: reduce) {
      button { transition: none; }
    }
  </style>
</head>
<body>
  <div class="page">
    <header class="brand">
      ${logo}
      <p class="brand-name">万来 Code</p>
    </header>
    <main aria-labelledby="result-title">
      <div class="eyebrow">Software OAuth</div>
      <div class="status-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">${iconPath}</svg>
      </div>
      <h1 id="result-title">${title}</h1>
      <p class="message">${message}</p>
      <p class="countdown" id="countdown" aria-live="polite">
        页面将在 <strong id="seconds">5</strong> 秒后自动关闭
      </p>
      <button id="close-button" type="button">立即关闭</button>
      <p class="hint" id="hint">关闭后可返回万来继续操作</p>
    </main>
  </div>
  <script>
    (() => {
      const secondsElement = document.getElementById("seconds");
      const countdownElement = document.getElementById("countdown");
      const closeButton = document.getElementById("close-button");
      const hintElement = document.getElementById("hint");
      let seconds = 5;
      let intervalId;
      let closeTimerId;

      const tryClose = () => {
        window.close();
        window.setTimeout(() => {
          if (!document.hidden) {
            window.clearInterval(intervalId);
            window.clearTimeout(closeTimerId);
            countdownElement.textContent = "浏览器未允许自动关闭";
            hintElement.textContent = "请直接关闭此标签页，登录结果不会受到影响";
            closeButton.textContent = "再次尝试关闭";
          }
        }, 250);
      };

      closeButton.addEventListener("click", tryClose);
      intervalId = window.setInterval(() => {
        seconds -= 1;
        secondsElement.textContent = String(Math.max(seconds, 0));
        if (seconds <= 0) window.clearInterval(intervalId);
      }, 1000);
      closeTimerId = window.setTimeout(tryClose, 5000);
    })();
  </script>
</body>
</html>`;
}

const SUCCESS_HTML = createResultHtml(
  "success",
  "登录成功",
  "身份验证已完成，您现在可以安全返回万来。",
);

const FAILURE_HTML = createResultHtml(
  "failure",
  "登录未完成",
  "身份验证失败，请返回万来后重新尝试登录。",
);

export class OAuthCallbackServer implements CallbackServerPort {
  private server: http.Server | null = null;
  private closed = false;
  private settleResult:
    | ((
        outcome:
          | { ok: true; value: OAuthCallbackResult }
          | { ok: false; error: Error },
      ) => void)
    | null = null;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  async start(
    timeoutMs = 15 * 60 * 1000,
  ): Promise<{ port: number; result: Promise<OAuthCallbackResult> }> {
    if (this.server) {
      throw new Error("OAuthCallbackServer already started");
    }
    this.closed = false;

    const result = new Promise<OAuthCallbackResult>((resolve, reject) => {
      this.settleResult = (outcome) => {
        this.settleResult = null;
        if (outcome.ok) {
          resolve(outcome.value);
        } else {
          reject(outcome.error);
        }
      };
    });
    // Avoid unhandled rejection if closed without awaiting
    result.catch(() => undefined);

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    const port = await new Promise<number>((resolve, reject) => {
      const server = this.server!;
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        const addr = server.address();
        if (addr && typeof addr === "object") {
          resolve(addr.port);
        } else {
          reject(new Error("Failed to bind OAuth callback server"));
        }
      });
    });

    this.timeoutHandle = setTimeout(() => {
      this.finish(false, undefined, new Error("登录超时"));
    }, timeoutMs);
    if (typeof this.timeoutHandle.unref === "function") {
      this.timeoutHandle.unref();
    }

    return { port, result };
  }

  /** Test helper: address() of the underlying Node server. */
  getListenAddress(): string | AddressInfo | null {
    return this.server?.address() ?? null;
  }

  close(): void {
    this.clearTimeout();
    if (this.settleResult) {
      this.settleResult({
        ok: false,
        error: loginCancelled("已取消登录"),
      });
      this.settleResult = null;
    }
    this.shutdownServer();
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    if (this.closed) {
      res.writeHead(404);
      res.end();
      return;
    }
    const host = req.headers.host ?? "127.0.0.1";
    let url: URL;
    try {
      url = new URL(req.url ?? "/", `http://${host}`);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }

    if (url.pathname !== "/callback") {
      // favicon and other noise: do not close server
      res.writeHead(url.pathname === "/favicon.ico" ? 204 : 404);
      res.end();
      return;
    }

    const error = url.searchParams.get("error");
    if (error) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(FAILURE_HTML);
      const cancelled = error === "access_denied" || error === "login_required";
      this.finish(
        false,
        undefined,
        cancelled ? loginCancelled("已取消登录") : new Error(error),
      );
      return;
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(FAILURE_HTML);
      this.finish(false, undefined, new Error("missing code or state"));
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(SUCCESS_HTML);
    this.finish(true, { code, state });
  }

  private finish(ok: true, value: OAuthCallbackResult): void;
  private finish(ok: false, value: undefined, error: Error): void;
  private finish(
    ok: boolean,
    value?: OAuthCallbackResult,
    error?: Error,
  ): void {
    if (this.closed && !this.settleResult) {
      return;
    }
    this.clearTimeout();
    const settle = this.settleResult;
    this.settleResult = null;

    this.shutdownServer();

    if (!settle) {
      return;
    }
    if (ok && value) {
      settle({ ok: true, value });
    } else {
      settle({ ok: false, error: error ?? new Error("OAuth callback failed") });
    }
  }

  private shutdownServer(): void {
    if (!this.server) {
      this.closed = true;
      return;
    }
    const server = this.server;
    this.server = null;
    this.closed = true;
    if (
      typeof (server as http.Server & { closeAllConnections?: () => void })
        .closeAllConnections === "function"
    ) {
      (
        server as http.Server & { closeAllConnections: () => void }
      ).closeAllConnections();
    }
    server.close();
  }

  private clearTimeout(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }
}
