# WanLai IDE 架子 + OAuth 鉴权 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 continue `v2.0.0-vscode` 导入本仓库并接上万来 OAuth PKCE 登录，使 Extension Development Host 能登录、恢复会话，并用 continue Chat 打通一次真实模型调用。

**Architecture:** 保持 continue 目录不动。认证核心放在 `core/auth`（不依赖 `vscode`），VS Code 适配放在 `extensions/vscode/src/auth`。凭据以 SecretStorage 单 JSON blob 原子读写。模型列表与运行 Key 通过 `WanLaiProfileLoader` 注入 `ConfigHandler`，聊天走 continue 现有 OpenAI provider，不自建聊天 HTTP 栈。

**Tech Stack:** continue 2.0.0、VS Code Extension API、Node `>=20.20.1`、npm、原生 `fetch`、vitest（`*.vitest.ts`）、`@vscode/test-electron`

**Spec:** `docs/superpowers/specs/2026-08-13-core-auth-design.md`（v1.1）

**Git:** 执行本计划的 agent **不得** `add`/`commit`/`push`/`reset`。每个 Task 末尾的 Commit 步骤改为：向维护者说明变更与检查项，由维护者按仓库 commit 规范亲自提交。

## Global Constraints

- continue 基线标签：`v2.0.0-vscode`；保留根目录 `LICENSE`（Apache 2.0）与源文件版权头
- 不重命名 `extensions/vscode`、`core/`、`gui/`；不切 pnpm
- `client_id` 在授权 URL、换票、刷新中一律为 `wanlaicode-cli`
- SecretStorage 只使用 key `wanlaiide.credentials`（单 blob）
- core 禁止 `import * as vscode`
- Webview 不得出现 token、uuid、原始邮箱
- 网络/5xx 不得 `clear()` 登录态；仅明确的 refresh token 无效才登出
- 运行 API 的 401 重建 runtime key，禁止当成 OAuth 刷新
- 新增 core 测试文件必须叫 `*.vitest.ts`（continue 的 `core/vitest.config.ts` 只 include 这个模式）
- Node `>=20.20.1`；包管理只用 npm
- 品牌 SVG 源文件：`assets/brand/wanlaiide.svg`
- 默认 `apiBaseUrl`：`https://api.wanlai.ai/v1`；`siteBaseUrl`：`https://wanlai.ai`

## File map

| 路径                                           | 职责                                                         |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `core/ports/*.ts`                              | SecretStorage / HTTP / Logger / CallbackServer 接口          |
| `core/auth/pkce.ts`                            | PKCE + timing-safe state                                     |
| `core/auth/eventEmitter.ts`                    | 不依赖 vscode 的订阅器                                       |
| `core/auth/types.ts`                           | 凭据、状态、blob 类型                                        |
| `core/auth/errorMapper.ts`                     | 四种错误结构 + 凭据类型分流                                  |
| `core/auth/sanitizedLogger.ts`                 | 四层脱敏                                                     |
| `core/auth/credentialStore.ts`                 | 单 blob、代次、single-flight 刷新                            |
| `core/auth/oauthApiClient.ts`                  | token / profile / create_api_key                             |
| `core/auth/runtimeApiClient.ts`                | 仅 `getModels`（可选 smokeChat）                             |
| `core/auth/authService.ts`                     | 登录编排、restore、validateSession                           |
| `core/auth/requestCanceller.ts`                | in-flight AbortController 集合                               |
| `core/config/profile/WanLaiProfileLoader.ts`   | 内存 profile，注入 models + headers                          |
| `core/config/ConfigHandler.ts`                 | 小改：允许注册并优先选中万来 profile                         |
| `extensions/vscode/src/auth/*.ts`              | OAuth 回调 server、SecretStorage/HTTP 适配、deviceInfo、组装 |
| `extensions/vscode/src/activation/activate.ts` | 激活时先 restore，不阻塞网络                                 |
| `extensions/vscode/package.json`               | 扩展标识、`wanlaiide.*` 配置、登录命令                       |
| `gui/src/components/AuthStatusBadge.tsx`       | 登录态展示                                                   |

---

### Task 1: 导入 continue v2.0.0-vscode 并确认能启动

**Files:**

- Create/overwrite: continue 源树（根 `LICENSE`、`core/`、`gui/`、`extensions/`、`packages/`、`scripts/` 等）
- Keep: `assets/brand/`、`docs/superpowers/`

**Interfaces:**

- Consumes: 无
- Produces: 可在本机 `npm` 安装依赖，并用 VS Code 任务 `Launch extension` 打开 Extension Development Host

- [x] **Step 1: 确认 Node 版本**

Run:

```powershell
node -v
```

Expected: `v20.20.1` 或更高。若低于此版本，先安装 Node 20 LTS 再继续。

- [x] **Step 2: 把 continue 标签合入仓库（不覆盖万来文档与品牌）**

在仓库根目录 `C:\Users\1\Desktop\WanLaiIde` 执行：

```powershell
$tmp = Join-Path $env:TEMP "continue-v2.0.0-vscode"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
git clone --branch v2.0.0-vscode --depth 1 https://github.com/continuedev/continue.git $tmp
robocopy $tmp . /E /XD .git /NFL /NDL /NJH /NJS /nc /ns /np
if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $LASTEXITCODE" }
# 确认万来文件还在
Test-Path .\assets\brand\wanlaiide.svg
Test-Path .\docs\superpowers\specs\2026-08-13-core-auth-design.md
Test-Path .\LICENSE
```

Expected: 两个 `Test-Path` 为 `True`；`LICENSE` 存在且内容为 Apache 2.0。robocopy 退出码 `0–7` 都算成功。

- [x] **Step 3: 安装依赖**

```powershell
npm i -g vite
.\scripts\install-dependencies.ps1
```

Expected: 脚本结束无 fatal error。若脚本不存在，则分别执行：

```powershell
npm install
Set-Location core; npm install; Set-Location ..
Set-Location gui; npm install; Set-Location ..
Set-Location extensions\vscode; npm install; Set-Location ..\..
```

- [x] **Step 4: 用 VS Code 启动扩展**

在 Cursor/VS Code 中：Run and Debug → `Launch extension`（continue 自带的 launch 配置）。应打开 Extension Development Host，侧边栏出现 Continue 图标。

若 Host 无法激活：看 Debug Console 错误，修到能激活为止，本任务不改品牌、不加 auth。

- [x] **Step 5: 确认 .gitignore 后再暂存、提交**

禁止上来就 `git add -A`。continue 的忽略规则不能覆盖万来新增目录，二次开发后目录会和上游不完全一样。

1. 打开根目录 `.gitignore`，确认至少包含：continue 原有的 `**/node_modules`、`.env`、`**/out`、`*.vsix`；以及万来 overlay（`.superpowers/sdd/`、`.env.*`、生成物、本机密钥）。**不要**忽略 `assets/brand/`、`docs/superpowers/`、`LICENSE`。
2. `git status`：看未跟踪/已修改清单，核对没有 `node_modules`、`.env`、密钥、`.superpowers/sdd`、`out/`、`*.vsix`。
3. 按路径暂存 continue 源码与许可证，不要无审查地全加：

```powershell
git add LICENSE package.json package-lock.json .gitignore .nvmrc
git add core gui extensions packages scripts binary assets
git add --all -- ':!.superpowers/sdd' ':!**/node_modules/**' ':!**/.env'
git status
git diff --cached --stat
git diff --cached --name-only | Select-String -Pattern 'node_modules|\.env$|secret|credentials|\.vsix$|\.superpowers/sdd'
```

最后一条必须没有输出。若有命中，先 `git reset` 对应路径并补 `.gitignore`，不要提交。

1. 再提交(提交前需向开发者请求确认)：

```powershell
git commit -m "chore(bootstrap): import continue v2.0.0-vscode as WanLai IDE baseline"
```

---

### Task 2: 轻量换皮（标识与图标，不改目录）

**Files:**

- Modify: `extensions/vscode/package.json`（`name`、`publisher`、`displayName`、`description`、`icon`）
- Create: `extensions/vscode/media/icon.png`（由 `assets/brand/wanlaiide.svg` 导出 128×128 PNG）
- Modify: 仅当 launch/tasks 里写死了 `Continue` 扩展 id 时，改成新 id

**Interfaces:**

- Consumes: Task 1 可启动的扩展
- Produces: 扩展 id `wanlaiide.wanlaiide`（若 publisher 尚未注册 marketplace，开发宿主仍可用；id 必须与命令前缀一致）

- [ ] **Step 1: 生成图标**

用现有 SVG 导出 PNG。若本机有 Inkscape/ImageMagick 可用其 CLI；否则用 Node 一次性脚本（不新增运行时依赖，用已有工具）。最小可用方式：把 SVG 拷到 `extensions/vscode/media/wanlaiide.svg`，并在 `package.json` 的 `icon` 暂指向后续生成的 png。

用 PowerShell + 已安装的工具生成 128 PNG。若没有转换器，先把 SVG 放到 `extensions/vscode/media/icon.svg` 并在本任务注释「图标 PNG 待导出」，但 `package.json` `icon` 字段 continue 需要 png——则用 Sharp/无依赖方案：不要为图标引入新生产依赖。开发阶段可暂时继续用 continue 的 `media/icon.png`，另存一份 `media/wanlaiide.svg` 拷贝，等有转换器再替换。**本任务必须改显示名，图标能换则换，不能换则留下 SVG 拷贝并在 PR 说明。**

- [ ] **Step 2: 改** `extensions/vscode/package.json` **标识**

将下列字段改为：

```json
{
  "name": "wanlaiide",
  "publisher": "wanlaiide",
  "displayName": "WanLai IDE",
  "description": "AI-native coding tool by WanLai",
  "version": "0.0.1"
}
```

保留 `"license": "Apache-2.0"`。不要删 `contributes.commands` 里 continue 原命令（后续可改 category，本任务只改扩展元数据）。

在 `contributes.configuration.properties` 增加：

```json
"wanlaiide.apiBaseUrl": {
  "type": "string",
  "default": "https://api.wanlai.ai/v1",
  "description": "万来服务 API 根地址",
  "scope": "machine"
},
"wanlaiide.siteBaseUrl": {
  "type": "string",
  "default": "https://wanlai.ai",
  "description": "万来授权站点地址",
  "scope": "machine"
}
```

在 `contributes.commands` 增加：

```json
{
  "command": "wanlaiide.auth.login",
  "title": "WanLai: Sign In"
},
{
  "command": "wanlaiide.auth.logout",
  "title": "WanLai: Sign Out"
}
```

本任务只加声明，不实现 handler（Task 8 再注册）。

- [ ] **Step 3: 重新 Launch extension，确认 Host 里显示名为 WanLai IDE**

Expected: 扩展能激活；命令面板能搜到 `WanLai: Sign In`（执行会报未注册，可接受，直到 Task 8）。

- [ ] **Step 4: Commit**

```powershell
git add extensions/vscode/package.json extensions/vscode/media
git commit -m "chore: rebrand VS Code extension metadata to WanLai IDE"
```

---

### Task 3: core ports、事件器、PKCE

**Files:**

- Create: `core/ports/secretStoragePort.ts`
- Create: `core/ports/httpClientPort.ts`
- Create: `core/ports/loggerPort.ts`
- Create: `core/ports/callbackServerPort.ts`
- Create: `core/auth/types.ts`
- Create: `core/auth/eventEmitter.ts`
- Create: `core/auth/pkce.ts`
- Create: `core/auth/requestCanceller.ts`
- Test: `core/auth/pkce.vitest.ts`

**Interfaces:**

- Consumes: 无
- Produces: 见下方完整类型，后续 Task 必须原样使用这些名字

- [x] **Step 1: 写失败的 PKCE 测试**

Create `core/auth/pkce.vitest.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { createOAuthAttempt, statesEqual } from "./pkce.js";

describe("pkce", () => {
  it("creates verifier of at least 43 chars and independent state", () => {
    const a = createOAuthAttempt();
    expect(a.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(a.state).not.toBe(a.codeVerifier);
    expect(a.codeChallenge).not.toBe(a.codeVerifier);
  });

  it("accepts matching state and rejects mismatch", () => {
    const a = createOAuthAttempt();
    expect(statesEqual(a.state, a.state)).toBe(true);
    expect(statesEqual(a.state, a.state + "x")).toBe(false);
  });
});
```

- [x] **Step 2: 跑测试，确认失败**

```powershell
Set-Location core
npx vitest run auth/pkce.vitest.ts
```

Expected: FAIL，模块找不到。

- [x] **Step 3: 实现 ports 与 PKCE**

`core/ports/secretStoragePort.ts`:

```typescript
export interface SecretStoragePort {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
```

`core/ports/httpClientPort.ts`:

```typescript
export interface HttpRequestOptions {
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  bodyText: string;
}

export interface HttpClientPort {
  request(options: HttpRequestOptions): Promise<HttpResponse>;
}
```

`core/ports/loggerPort.ts`:

```typescript
export interface LoggerPort {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
```

`core/ports/callbackServerPort.ts`:

```typescript
export interface OAuthCallbackResult {
  code: string;
  state: string;
}

export interface CallbackServerPort {
  start(timeoutMs: number): Promise<{
    port: number;
    result: Promise<OAuthCallbackResult>;
  }>;
  close(): void;
}
```

`core/auth/types.ts`：按 spec 6.3.1 实现 `OAuthTokens`、`Credentials`、`AuthStatus`、`UserProfile`、`CREDENTIALS_STORAGE_KEY`（值为 `"wanlaiide.credentials"`）、`StoredCredentialBlob`（`version: 1`）。另加：

```typescript
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
```

`core/auth/eventEmitter.ts`:

```typescript
export type Unsubscribe = () => void;

export class AuthEventEmitter<T> {
  private listeners = new Set<(value: T) => void>();

  subscribe(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  fire(value: T): void {
    for (const listener of this.listeners) {
      listener(value);
    }
  }
}
```

`core/auth/requestCanceller.ts`:

```typescript
export class RequestCanceller {
  private controllers = new Set<AbortController>();

  track(controller: AbortController): void {
    this.controllers.add(controller);
    controller.signal.addEventListener("abort", () => {
      this.controllers.delete(controller);
    });
  }

  abortAll(): void {
    for (const controller of this.controllers) {
      controller.abort();
    }
    this.controllers.clear();
  }
}
```

`core/auth/pkce.ts`：按 spec 3.5 实现 `createOAuthAttempt` 与 `statesEqual`。

- [x] **Step 4: 再跑 PKCE 测试**

```powershell
Set-Location core
npx vitest run auth/pkce.vitest.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add core/ports core/auth
git commit -m "feat: add auth ports, PKCE, and in-process event helpers"
```

---

### Task 4: errorMapper 与 sanitizedLogger

**Files:**

- Create: `core/auth/errorMapper.ts`
- Create: `core/auth/sanitizedLogger.ts`
- Test: `core/auth/errorMapper.vitest.ts`
- Test: `core/auth/sanitizedLogger.vitest.ts`

**Interfaces:**

- Consumes: `LoggerPort`
- Produces: `parseError`、`getErrorAction`、`StructuredError`、`ErrorAction`、`SanitizedLogger`

- [x] **Step 1: 写失败测试**

`core/auth/errorMapper.vitest.ts` 必须覆盖：

- oauth body `{ reason: "SOFTWARE_OAUTH_REFRESH_TOKEN_INVALID" }` → `clear_and_relogin`
- oauth `TOKEN_EXPIRED` + `credentialKind: "oauth"` → `refresh_oauth_and_retry`
- chat 401 + `credentialKind: "runtime"` → `recreate_runtime_key_and_retry`
- `SOFTWARE_PRODUCT_NOT_ENTITLED` → `keep_logged_in_no_entitlement`
- status `0` 或无 status 的网络错误 → `keep_status_show_error`
- 500 → `retry_with_backoff`

`core/auth/sanitizedLogger.vitest.ts`：用内存 delegate 断言 `access_token`、`Bearer eyJ`、`sk-abc`、`code_verifier` 被替换成 `***`，普通句子不变。

- [x] **Step 2: 跑测试确认失败**

```powershell
Set-Location core
npx vitest run auth/errorMapper.vitest.ts auth/sanitizedLogger.vitest.ts
```

- [x] **Step 3: 实现**

`errorMapper.ts` 按 spec 6.7：`parseError(source, status, body)` 分别读 `body.reason`、`body.error.sub_code`、`body.error.code`。`getErrorAction` 先看 reason 表，再看 `credentialKind === "runtime" && statusCode === 401`。

`sanitizedLogger.ts` 按 spec 6.8 四层正则；`SENSITIVE_KEYS` 含 `access_token`、`refresh_token`、`raw_key`、`code_verifier`、`password`、`authorization`、`api_key`、`id_token`、`code`。

- [ ] **Step 4: 测试通过后 commit**

```powershell
git add core/auth
git commit -m "feat: add auth error mapping and log sanitization"
```

---

### Task 5: CredentialStore

**Files:**

- Create: `core/auth/credentialStore.ts`
- Test: `core/auth/credentialStore.vitest.ts`

**Interfaces:**

- Consumes: `SecretStoragePort`、`OAuthApiClient.refreshToken`（本任务用 fake client）、`LoggerPort`
- Produces: `CredentialStore` 方法：`restore`、`getValidAccessToken`、`getRuntimeApiKey`、`saveLogin`、`saveRuntimeApiKey`、`clear`、`reloadFromStorage`、`getCredentials`

为避免循环依赖：`CredentialStore` 构造函数接收

```typescript
{
  storage: SecretStoragePort;
  refreshToken: (token: string) => Promise<OAuthTokens>;
  logger: LoggerPort;
}
```

不要在构造函数里直接 `new OAuthApiClient`。

- [x] **Step 1: 写失败测试（内存 FakeStorage）**

FakeStorage：`Map<string,string>` 实现 `SecretStoragePort`。

必测：

1. `saveLogin` 后 `storage.get("wanlaiide.credentials")` 能 `JSON.parse` 出 `version: 1`、三个 token 字段；**没有**拆开的四个 key
2. 未过期（`expiresAt = Date.now() + 120_000`）时 `getValidAccessToken` 不调用 refresh
3. 已过期时调用 refresh 一次；并发两个 `getValidAccessToken` 只 refresh 一次（single-flight）
4. refresh 成功后 blob 里仍保留旧 `runtimeApiKey`（先 `saveRuntimeApiKey` 再过期）
5. refresh 抛 `{ reason: "SOFTWARE_OAUTH_REFRESH_TOKEN_INVALID" }` 时 `clear`，storage 空
6. refresh 抛网络错误（`statusCode: 0`）时 **不** clear，旧凭据仍在
7. `saveLogin` 过程中有 in-flight refresh：refresh 结束后不得覆盖新登录（revision）
8. `reloadFromStorage` 用外部写入的新 blob 覆盖内存

- [x] **Step 2: 跑测试确认失败**

```powershell
Set-Location core
npx vitest run auth/credentialStore.vitest.ts
```

- [x] **Step 3: 实现 CredentialStore**

过期缓冲：`expiresAt - Date.now() <= 60_000` 视为需要刷新。

`persist()` 只 `store(CREDENTIALS_STORAGE_KEY, JSON.stringify(blob))`。

`restore()` 解析失败时 `credentials = null` 并 `logger.warn`，不 throw。

- [ ] **Step 4: 测试通过后 commit**

```powershell
git add core/auth
git commit -m "feat: add atomic credential blob store with single-flight refresh"
```

---

### Task 6: OAuth 与 Runtime API client

**Files:**

- Create: `core/auth/oauthApiClient.ts`
- Create: `core/auth/runtimeApiClient.ts`
- Test: `core/auth/oauthApiClient.vitest.ts`
- Test: `core/auth/runtimeApiClient.vitest.ts`

**Interfaces:**

- Consumes: `HttpClientPort`、`OAuthClientConfig`、`getAccessToken` / `getRuntimeApiKey`、`DeviceInfo`、`parseError`
- Produces: `exchangeCode`、`refreshToken`、`getProfile`、`createRuntimeApiKey`、`getModels`

- [ ] **Step 1: 写失败测试**

Fake `HttpClientPort` 记录最后一次 `request`。

`oauthApiClient.vitest.ts`：

- `exchangeCode` POST `{apiOrigin}/v1/oauth/token`，body JSON 含 `grant_type: "authorization_code"`、`client_id: "wanlaicode-cli"`（断言 **不是** `wanlai-ide`）、`redirect_uri`、`code_verifier`；无 Authorization header
- 响应 `expires_in: 3600` → `expiresAt` 约 `Date.now()+3600000`（允许 2s 误差）
- `refreshToken` body 含 `grant_type: "refresh_token"` 与同一 `client_id`
- `getProfile` GET `{apiOrigin}/api/oauth/profile`，`Authorization: Bearer <access>`
- `createRuntimeApiKey` POST `{apiOrigin}/api/oauth/wanlaicode/create_api_key`，返回 `raw_key`

`runtimeApiClient.vitest.ts`：

- `getModels` GET `{apiBase}/models`，headers 含 `X-Wanlai-Client`、`X-Wanlai-Device-Id`、`Authorization: Bearer sk-test`
- Device-Name 若含 `\n` 会被去掉

- [ ] **Step 2: 跑测试确认失败**

```powershell
Set-Location core
npx vitest run auth/oauthApiClient.vitest.ts auth/runtimeApiClient.vitest.ts
```

- [ ] **Step 3: 实现两个 client**

超时：OAuth/profile 15_000ms，models 15_000ms。HTTP 4xx 用 `parseError` 后 throw `StructuredError`。`createRuntimeApiKey` 解析 `{ raw_key }`。

本阶段 **不要** 实现产品路径 `chatCompletion`。若需要排错，可加 `smokeChatCompletion`，但不要从 AuthService 调用。

- [ ] **Step 4: 测试通过后 commit**

```powershell
git add core/auth
git commit -m "feat: add WanLai OAuth and models API clients"
```

---

### Task 7: AuthService

**Files:**

- Create: `core/auth/authService.ts`
- Test: `core/auth/authService.vitest.ts`

**Interfaces:**

- Consumes: `CredentialStore`、`OAuthApiClient`、`RuntimeApiClient`（仅 create key 走 oauth）、`LoginDeps`、`RequestCanceller`、`LoggerPort`
- Produces: `login`、`logout`、`restoreFromStorage`、`validateSession`、`getStatus`、`getPublicUserInfo`、`onStatusChange`

有套餐判定：`profile.entitlement != null && profile.entitlement.status === "active"`。

邮箱脱敏：`maskEmail` 放 `core/auth/maskEmail.ts`（`user@example.com` → `u***@example.com`）。

- [ ] **Step 1: 写失败测试**

Fake callback server：`start()` 立即给 `port: 49152`，`result` 为已 resolve 的 `{ code: "abc", state }`。`openBrowser` 记录 URL。

必测：

1. `login` 打开的 URL 含 `client_id=wanlaicode-cli`、`code_challenge_method=S256`、`redirect_uri=http://127.0.0.1:49152/callback`
2. 换票后 status 为 `loggedIn`（fake profile 带 active entitlement），且调用了 create_api_key
3. profile 无 entitlement → `loggedInNoEntitlement`，不调用 create_api_key
4. `restoreFromStorage` 不调用 http（spy request count === 0）
5. `validateSession` 在 getProfile 网络失败时保持 `loggedIn`
6. `validateSession` 在 refresh invalid 时变为 `loggedOut`
7. 第二次 `login` 会 `close()` 第一次的 server
8. `getPublicUserInfo()` 只有 `displayName` 与 `emailMasked`，无 uuid

- [ ] **Step 2: 跑测试确认失败**

```powershell
Set-Location core
npx vitest run auth/authService.vitest.ts
```

- [ ] **Step 3: 实现 AuthService**

`login`：`loginGeneration++`；`canceller.abortAll()`；关掉旧 server；状态 `loggingIn`；PKCE 只存在该次函数栈；`finally` 里 `server.close()` 并清空 verifier。

`restoreFromStorage`：`credentialStore.restore()`；无凭据 `loggedOut`；有凭据则按 blob 的 `entitlementStatus === "active"` 设 `loggedIn` 否则先 `loggedIn`（乐观）。

`validateSession`：严格按 spec 9.3。

`logout`：`abortAll`、`clear`、status `loggedOut`、fire 事件。

- [ ] **Step 4: 测试通过后 commit**

```powershell
git add core/auth
git commit -m "feat: add AuthService login, restore, and session validation"
```

---

### Task 8: VS Code 适配器 + 激活接线（不含模型注入）

**Files:**

- Create: `extensions/vscode/src/auth/oauthServer.ts`
- Create: `extensions/vscode/src/auth/secretStorageAdapter.ts`
- Create: `extensions/vscode/src/auth/httpClientAdapter.ts`
- Create: `extensions/vscode/src/auth/deviceInfo.ts`
- Create: `extensions/vscode/src/auth/outputChannelLogger.ts`
- Create: `extensions/vscode/src/auth/createAuthModule.ts`
- Modify: `extensions/vscode/src/activation/activate.ts`
- Modify: `extensions/vscode/src/extension/VsCodeExtension.ts`（若命令注册在此，则在此注册 login/logout）
- Test: `extensions/vscode/src/auth/oauthServer.vitest.ts` 或放在 core 侧无法测 listen 的，用 node 测试文件。continue 扩展侧未必跑 vitest——**OAuth server 用** `core` **无法测绑定地址时，在** `extensions/vscode` **写一个可** `npx vitest` **的小测试，或用 node:http 的集成断言写在** `core` **外的** `extensions/vscode/src/auth/oauthServer.test.ts` **并用** `npx tsx` **跑。优先：把 server 实现保持无 vscode 依赖，测试文件放** `extensions/vscode/src/auth/oauthServer.vitest.ts`**，从该目录跑** `npx vitest`**（若无配置，把纯逻辑测放到 Task 8 的手动：用** `curl` **打 callback）。**

为降低工具摩擦：`OAuthCallbackServer` 只依赖 `node:http`，把文件放在 `core/auth/oauthServer.ts` 实现 `CallbackServerPort`，extension 只 re-export。这样可用 vitest。

**更正（按分层）：** spec 把 server 放在 extension，因为它用 `node:http`。core 可以用 `node:http`（continue core 已是 Node）。**把** `OAuthCallbackServer` **放** `core/auth/oauthServer.ts`，extension 的 `createCallbackServer: () => new OAuthCallbackServer()`。这样不违反「core 不 import vscode」。

- [ ] **Step 1: 写 oauthServer 的 vitest**

`core/auth/oauthServer.vitest.ts`：

1. `start(2000)` 后对 `http://127.0.0.1:${port}/favicon.ico` GET，server 仍可接受 `/callback`
2. GET `/callback?code=x&state=y` → result resolve，随后再 listen 应已 close
3. GET `/callback?error=access_denied` → result reject
4. `server.address()` 确认不是 `0.0.0.0` 对外（`listen` 第二个参数 `"127.0.0.1"`）

- [ ] **Step 2: 实现 server 与适配器**

`oauthServer.ts`：忽略非 `/callback`；成功/失败页为无脚本 HTML，文案「登录成功，可以关闭此页面」/「登录失败，可以关闭此页面」，不含 code。

`secretStorageAdapter.ts`：`context.secrets` 转 `SecretStoragePort`。

`httpClientAdapter.ts`：`fetch` + timeout abort；返回 `{ status, bodyText }`；网络失败 status `0`、bodyText `""`。

`deviceInfo.ts`：spec 6.9，`getDeviceInfo(vscode.env.machineId)`。

`outputChannelLogger.ts`：`vscode.window.createOutputChannel("WanLai")` + `SanitizedLogger` 包裹。

`createAuthModule.ts` 组装：读 `vscode.workspace.getConfiguration("wanlaiide")` 得到 apiBaseUrl/siteBaseUrl，`apiOrigin = apiBaseUrl.replace(/\/v1\/?$/, "")`，`clientId = "wanlaicode-cli"`。返回 `{ authService, credentialStore, runtimeApiClient, deviceInfo, oauthConfig }`。

- [ ] **Step 3: 接到 activate**

在 `activateExtension` **最前面**（在 `new VsCodeExtension` 之前）：

```typescript
const authModule = await createAuthModule(context);
await authModule.authService.restoreFromStorage();
void authModule.authService.validateSession().catch((err) => {
  authModule.logger.warn("validateSession failed", { err: String(err) });
});
```

把 `authModule` 传进 `VsCodeExtension`（给构造函数加可选参数，避免大拆）。

注册：

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand("wanlaiide.auth.login", () =>
    authModule.authService
      .login({
        openBrowser: (url) =>
          vscode.env.openExternal(vscode.Uri.parse(url)).then(() => undefined),
        createCallbackServer: () => new OAuthCallbackServer(),
        redirectUriFactory: (port) => `http://127.0.0.1:${port}/callback`,
      })
      .then(
        () => vscode.window.showInformationMessage("万来账号登录成功"),
        (err) =>
          vscode.window.showErrorMessage(
            `万来登录失败：${err instanceof Error ? err.message : String(err)}`,
          ),
      ),
  ),
  vscode.commands.registerCommand("wanlaiide.auth.logout", () =>
    authModule.authService.logout(),
  ),
  context.secrets.onDidChange(async (e) => {
    if (e.key !== "wanlaiide.credentials") return;
    await authModule.credentialStore.reloadFromStorage();
    await authModule.authService.syncStatusFromStore();
  }),
  vscode.window.onDidChangeWindowState(async (state) => {
    if (!state.focused) return;
    await authModule.credentialStore.reloadFromStorage();
    await authModule.authService.syncStatusFromStore();
  }),
);
```

`syncStatusFromStore`：根据内存凭据有无更新 status 并 `onStatusChange.fire`（若 restore 已覆盖可复用）。若 AuthService 没有该方法，实现为：无凭据 → loggedOut；有凭据保持当前或按 entitlement 设置，不发网络。

登录中关闭 Webview 已由单例保证；`login` 的 then/catch 用 `showInformationMessage` / `showErrorMessage`。

- [ ] **Step 4: Launch extension，命令面板执行 Sign In**

Expected: 系统浏览器打开 `https://wanlai.ai/software/oauth/authorize?...client_id=wanlaicode-cli...`。若后端参考值可用，应能走完并显示已登录信息（OutputChannel `WanLai` 无明文 token）。若后端拒绝 client，至少确认请求发出且错误走结构化提示、扩展不崩溃。

- [ ] **Step 5: Commit**

```powershell
git add core/auth extensions/vscode/src
git commit -m "feat: wire WanLai OAuth login into the VS Code extension host"
```

---

### Task 9: WanLaiProfileLoader 注入 ConfigHandler

**Files:**

- Create: `core/config/profile/WanLaiProfileLoader.ts`
- Modify: `core/config/ConfigHandler.ts`（增加 `registerWanLaiProfile` + `loadProfiles` 时插入并优先选中）
- Create: `extensions/vscode/src/auth/wanLaiConfigBridge.ts`
- Modify: `extensions/vscode/src/extension/VsCodeExtension.ts`（Core 创建后 attach）

**Interfaces:**

- Consumes: `AuthService.getStatus`、`getRuntimeApiKey`、`RuntimeApiClient.getModels`、`ConfigHandler.reloadConfig` / `onConfigUpdate`
- Produces: 已登录有套餐时 continue `models[]` 含万来模型，`apiKey` 仅内存，`requestOptions.headers` 含 `X-Wanlai-*`

先读 fork 后的 `core/config/profile/LocalProfileLoader.ts`，`WanLaiProfileLoader` 实现 **同一个** loader 接口（通常是 `profileDescription` + `doLoadConfig`）。不要发明 `ContinueConfigProvider`。

- [ ] **Step 1: 读 LocalProfileLoader 与 ProfileLifecycleManager，记下接口方法名**

在 `WanLaiProfileLoader.ts` 文件头注释写清实现了哪个 interface、哪几个方法。

- [ ] **Step 2: 实现 loader**

`doLoadConfig` 逻辑：

- `loggedOut` / `loggingIn` / `loggedInNoEntitlement` / 无 runtime key → `{ models: [], ...continue 默认空配置所需字段 }`，从一次 `LocalProfileLoader` 空配置或 `configYamlToContinueConfig` 的最小对象抄默认值（contextProviders 等），**只覆盖 models**
- `loggedIn` → `getModels()`，map 为：

```typescript
{
  title: m.name ?? m.id,
  provider: "openai",
  model: m.id,
  apiBase: apiBaseUrl,
  apiKey: runtimeKey,
  contextLength: m.context_length ?? 8192,
  requestOptions: {
    headers: {
      "X-Wanlai-Client": clientName,
      "X-Wanlai-Client-Version": clientVersion,
      "X-Wanlai-Device-Id": deviceInfo.id,
      "X-Wanlai-Device-Name": deviceInfo.name,
      "X-Wanlai-OS": deviceInfo.os,
      "X-Wanlai-Arch": deviceInfo.arch,
    },
  },
}
```

禁止把 apiKey 写进 yaml 文件。

- [ ] **Step 3: ConfigHandler 最小改动**

```typescript
private wanLaiProfile: ProfileLifecycleManager | null = null;

registerWanLaiProfile(manager: ProfileLifecycleManager) {
  this.wanLaiProfile = manager;
}

// 在 loadProfiles() 成功得到 local profiles 之后：
if (this.wanLaiProfile) {
  return { profiles: [this.wanLaiProfile, ...profiles], errors };
}
```

在 `cascadeInit` 里若存在 wanLai profile，`selectedProfile` 优先用它（id 固定 `"wanlaiide"`）。

`profileDescription.id` 必须是 `"wanlaiide"`。

- [ ] **Step 4: Bridge**

`wanLaiConfigBridge.ts`：`attach({ configHandler, authService, runtimeClient, deviceInfo, oauthConfig })`：

- `registerWanLaiProfile`
- `authService.onStatusChange.subscribe(() => { void configHandler.reloadConfig("WanLai auth status changed"); })`
- 立刻 `reloadConfig("WanLai profile registered")`

在 `VsCodeExtension` 里 `this.core` 赋值之后调用 `attach`。

- [ ] **Step 5: 手动验证**

登录成功后打开 continue 模型下拉，应出现 `/v1/models` 返回的模型。检查 `~/.continue/config.yaml` **没有** `sk-` 运行 key。

未登录时 models 为空。

- [ ] **Step 6: Commit**

```powershell
git add core/config extensions/vscode/src/auth extensions/vscode/src/extension
git commit -m "feat: inject WanLai models into Continue config from auth session"
```

---

### Task 10: GUI 登录态与消息协议

**Files:**

- Create: `gui/src/components/AuthStatusBadge.tsx`
- Modify: continue GUI 顶栏/侧边栏布局文件（fork 后定位实际 header 组件，例如 `gui/src/components/mainInput` 旁或 `gui/src/pages` 的 chat 页顶部）
- Modify: `extensions/vscode` 的 webview protocol 发送侧（`ContinueGUIWebviewViewProvider` 或 `VsCodeMessenger`）

**Interfaces:**

- Consumes: `auth:status` / `auth:login` / `auth:logout` / `auth:get_status`
- Produces: 脱敏邮箱、开通套餐按钮、不传 uuid/token

- [ ] **Step 1: 定位 GUI 与 webview 消息总线**

搜索 `webview.postMessage`、`FromWebviewProtocol`、`ToWebviewProtocol`。把万来消息加到现有 protocol 类型联合中，不要另起 window 通道。

消息形状严格按 spec 8.1 / 8.2。

- [ ] **Step 2: 实现 AuthStatusBadge**

- `loggedOut`：按钮「登录万来账号」→ post `auth:login`
- `loggingIn`：文案「正在登录…」
- `loggedIn`：`emailMasked` + 「退出」
- `loggedInNoEntitlement`：邮箱 + 「未开通套餐」+ 按钮打开 `https://wanlai.ai/purchase`（通过 extension 命令 `vscode.env.openExternal`，GUI 发 `auth:open_purchase` 或复用已有 openUrl 消息）。不要在 Webview 里硬编码 token。
- 聊天框不禁用；models 为空时 continue 原错误之外，extension 在发送失败时把柔和文案推进聊天：「当前账号未开通推理套餐，点击开通后即可使用万来 AI 编程助手」

Webview 打开时发 `auth:get_status`。extension 在 `onStatusChange` 时推 `auth:status`。

- [ ] **Step 3: 确认 GUI 不写 localStorage 认证字段**

搜 `localStorage.setItem` 新增代码，禁止存 token。

- [ ] **Step 4: Launch extension 验证 UI 状态机**

登录、退出、关侧边栏再开、无套餐按钮跳转。

- [ ] **Step 5: Commit**

```powershell
git add gui/src extensions/vscode/src
git commit -m "feat: show WanLai auth status in the chat sidebar"
```

---

### Task 11: 用 continue Chat 做真实对话验证 + 安全检查

**Files:**

- Modify: 仅当 continue 发模型请求未带上 `requestOptions.headers` 时，修 `core/llm` 对应 fetch 包装（先证实，再改；不要预先 fork provider）
- Create: `docs/superpowers/specs/2026-08-14-auth-manual-qa.md`（把 spec 12.3 清单抄过去并勾选说明）

- [ ] **Step 1: 登录有套餐账号，在 Chat 发「回复 ping」**

Expected: 有模型回复。允许流式（continue 默认）。OutputChannel 无 access_token / `sk-` 明文。

- [ ] **Step 2: 断网后 Reload Window**

Expected: 仍显示已登录，不误登出。

- [ ] **Step 3: 执行 Sign Out，确认 blob 删除**

在 Extension Development Host 的开发者工具无法直接看 SecretStorage；用再 Sign In 前的状态为未登录、重启仍未登录来确认。

- [ ] **Step 4: 检查磁盘**

工作区 `.vscode/settings.json`、`~/.continue/config.yaml` 无 runtime key。

- [ ] **Step 5: 跑全部新增 vitest**

```powershell
Set-Location core
npx vitest run auth
```

Expected: 全部 PASS。

- [ ] **Step 6: Commit 测试/文档修订（若有）**

```powershell
git add docs/superpowers core/auth
git commit -m "test: verify WanLai auth session, chat path, and secret hygiene"
```

若本步无文件变更可跳过 commit。

---

## Self-review

**Spec coverage:**

| spec 要求                            | 任务     |
| ------------------------------------ | -------- |
| 导入 continue + LICENSE              | Task 1   |
| 不改目录 / npm                       | Task 1–2 |
| 换皮                                 | Task 2   |
| PKCE、ports                          | Task 3   |
| 错误分流、脱敏                       | Task 4   |
| 单 blob 凭据                         | Task 5   |
| client_id 统一、models client        | Task 6   |
| restore/validate/二次登录            | Task 7   |
| 回调 server、激活不阻塞、onDidChange | Task 8   |
| ConfigHandler 注入、headers          | Task 9   |
| Webview 协议与无套餐 UX              | Task 10  |
| Chat 真通、断网不清登录              | Task 11  |
| 自写 SSE / 重命名 packages           | 明确不做 |

**Placeholder scan:** Task 2 图标若无法转 PNG 允许暂缓，不影响鉴权。Task 9 必须先读 LocalProfileLoader 再写，接口名以 fork 代码为准。

**Type consistency:** `CREDENTIALS_STORAGE_KEY`、`DEFAULT_CLIENT_ID`、`AuthStatus`、`LoginDeps`、`CallbackServerPort` 从 Task 3 起名字固定。`getErrorAction` 的 `recreate_runtime_key_and_retry` / `refresh_oauth_and_retry` 与 spec v1.1 一致。
