# 万来 IDE 认证与鉴权设计文档

> 版本：v1.1
> 日期：2026-08-14
> 作用：定义万来 IDE VS Code 插件的 OAuth 登录、凭据管理、统一 API Client、错误处理、安全边界及与 continue 架构的集成方式，覆盖模块设计、接口规范、核心流程、测试方案和本地验证步骤，作为开发实施的完整依据。

### 变更记录

| 版本 | 日期       | 变更                                                                                                                                                                                                                                                                                                |
| ---- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1.0 | 2026-08-13 | 初稿                                                                                                                                                                                                                                                                                                |
| v1.1 | 2026-08-14 | 统一 `client_id`；凭据改为单 blob 原子写入；启动恢复不得因网络失败清登录；运行 Key 与 OAuth 的 401 分流；保持 continue 目录与 npm；用 ConfigHandler 内存 profile 注入模型，不另建聊天 HTTP 栈；补齐 ports / 取消注册中心；多窗口改用 `SecretStorage.onDidChange`；PKCE 下沉到 core；保留 Apache 2.0 |

---

## 目录

1. [目标与范围](#1-目标与范围)
2. [已确认决策汇总](#2-已确认决策汇总)
3. [万来服务对接规范](#3-万来服务对接规范)
4. [整体架构](#4-整体架构)
5. [激活流程](#5-激活流程)
6. [模块详细设计](#6-模块详细设计)
7. [与 continue 的集成方式](#7-与-continue-的集成方式)
8. [Webview 消息协议](#8-webview-消息协议)
9. [核心流程](#9-核心流程)
10. [特殊场景处理](#10-特殊场景处理)
11. [安全边界落地检查](#11-安全边界落地检查)
12. [测试方案](#12-测试方案)
13. [开发文档清单](#13-开发文档清单)
14. [开发配置参考值](#14-开发配置参考值)
15. [第一阶段交付边界](#15-第一阶段交付边界)
16. [待确认事项](#16-待确认事项)

---

## 1. 目标与范围

### 1.1 本阶段目标

- 以 `continuedev/continue` 的 `v2.0.0-vscode` 为起点导入代码，保留 Apache 2.0 许可证与版权声明
- 轻量换皮（扩展标识、显示名、图标），**不改 continue 目录布局**
- 实现 OAuth 2.0 Authorization Code + PKCE 登录（系统浏览器，不在 IDE 内收集密码）
- 三类凭据安全存储（OAuth Access Token / Refresh Token / Runtime API Key），单 blob 原子写入
- 统一 API Client（自动注入认证、超时、主动取消、结构化错误）
- 重启 VS Code 后登录状态正确恢复；网络失败不得误清登录
- 无效或过期 Token 能正确提示重新登录
- 跑通至少一个真实受保护 API（`/api/oauth/profile`）
- 登录后把运行 API Key 与模型列表注入 continue 配置，用 continue 现有 Chat UI 完成一次真实对话
- 日志自动脱敏，不记录 Token、密码或完整敏感响应
- Webview、日志和工作区文件中均不存在认证凭据
- 相关自动化测试通过
- 在真实 VS Code Extension Development Host 中完成验证

### 1.2 本阶段暂且不做

- 自写 SSE 解析器或平行的聊天 HTTP 客户端（continue 的 OpenAI 兼容层已支持流式；本阶段复用它）
- 把 `extensions/vscode`、`core/`、`gui/` 重命名为 bootstrap 中的 `packages/extension|core|ui`（构建稳定后再做）
- 切换 pnpm（continue 2.0.0 使用 npm + `package-lock.json`）
- Agent 工具调用的深度适配（复用 continue 现有实现，本阶段只确保认证链路不阻塞）
- Cmd+K 差异预览的深度适配（同上）
- 多环境切换
- 高级用户自定义模型（config-yaml 保留但禁用编辑入口）
- VS Code fork 适配
- 扩展内充值/购买套餐（先跳转外部页面）
- 账号密码登录方式（仅了解，本阶段不用）

---

## 2. 已确认决策汇总

| 决策项             | 结论                                                                                        | 说明                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 基础代码           | 导入 continue `v2.0.0-vscode`                                                               | 标签是 VS Code 扩展 2.0.0 稳定版；第一阶段需 Agent + Cmd+K                                   |
| 许可证             | 保留 continue 的 Apache 2.0                                                                 | 衍生代码必须保留 `LICENSE` 与版权声明；bootstrap「暂不添加许可证」不覆盖 fork 文件           |
| 目录布局           | 第一期保持 continue 原布局                                                                  | `extensions/vscode`、`core/`、`gui/`、`packages/*`；不对齐 bootstrap 的 `packages/extension` |
| 裁剪范围           | 可删除 `extensions/intellij`；autocomplete/Hub 保留但不启用；config-yaml 保留但禁用编辑入口 | 第一期不重排 monorepo                                                                        |
| 认证方式           | OAuth 2.0 Authorization Code + PKCE，系统浏览器登录                                         | 不在 WebView 收集密码                                                                        |
| OAuth 回调         | 本地 HTTP Server（127.0.0.1 随机端口）                                                      | 不需要后端改 redirect_uri                                                                    |
| HTTP 客户端        | 原生 `fetch` + `AbortController`                                                            | continue 要求 Node `>=20.20.1`                                                               |
| 凭据存储           | `vscode.SecretStorage` **单个 JSON blob**                                                   | 一次 `store` 原子替换整组凭据，避免四 key 写到一半                                           |
| 模型注入           | 内存 Profile / ConfigHandler overlay                                                        | continue 2.0 **没有** `ContinueConfigProvider` 接口；不写 `config.yaml` 中的 apiKey          |
| 对话路径           | 复用 continue LLM（OpenAI 兼容 provider）                                                   | 用 `apiKey` + `requestOptions.headers` 注入；不另建 `chatCompletion` 产品路径                |
| 品牌地址           | API_BASE = `https://api.wanlai.ai/v1`，SITE_BASE = `https://wanlai.ai`                      | 万来品牌                                                                                     |
| 客户端标识         | 授权、换票、刷新全部使用 `client_id=wanlaicode-cli`                                         | 参考值，后续替换；禁止混用 `wanlai-ide`                                                      |
| 登录超时           | 15 分钟                                                                                     | 对接文档建议上限                                                                             |
| 邮箱展示           | 脱敏展示，格式 `u***@example.com`                                                           | 保留首字符和域名                                                                             |
| 无套餐处理         | 聊天入口不禁用，显示「开通套餐」按钮；发消息返回柔和提示                                    | 开通按钮跳转 `https://wanlai.ai/purchase`                                                    |
| 登录中关闭 Webview | 登录状态全局化，与 Webview 生命周期解耦；后台完成 + 系统通知                                | AuthService 是 extension host 单例                                                           |
| 多窗口同步         | SecretStorage 为唯一真相源 + `onDidChange` + 窗口聚焦兜底                                   | VS Code 的 `SecretStorage.onDidChange` 会跨窗口触发                                          |
| 设备 ID            | `SHA256("wanlaiide:" + vscode.env.machineId)` → base64url → 取前 32 字符                    | 不使用硬件序列号原文                                                                         |
| 包管理             | npm（与 continue 2.0.0 一致）                                                               | 第一期不切 pnpm                                                                              |
| 测试               | vitest（core 单元测试）+ `@vscode/test-electron`（extension 集成测试）                      | continue core 已有 vitest/jest；新增 auth 测试用 vitest                                      |

---

## 3. 万来服务对接规范

以下内容从万来 IDE 登录鉴权对接文档（核对日期 2026-08-13）摘录，作为开发依据。

### 3.1 三类凭据（不能混用）

| 凭据             | 来源                                   | 用途                                                  | 不应用于                                                    |
| ---------------- | -------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| 用户 JWT         | `/api/v1/auth/login`                   | 用户中心 REST API                                     | 模型网关、软件 OAuth Profile                                |
| 软件 OAuth Token | `/v1/oauth/token`                      | Profile、刷新 Token、创建运行 Key                     | 直接作为普通模型 API Key；不能拿去调 `/v1/chat/completions` |
| 运行 API Key     | `/api/oauth/wanlaicode/create_api_key` | `/v1/models`、`/v1/responses`、`/v1/chat/completions` | 用户中心 REST API、OAuth Profile                            |

运行 API 的 401 与 OAuth 的 401 必须分流处理，见 3.14 与 9.4。

### 3.2 服务地址（Wanlai 品牌）

- `API_BASE` = `https://api.wanlai.ai/v1`
- `API_ORIGIN` = `https://api.wanlai.ai`
- `SITE_BASE` = `https://wanlai.ai`
- 关系：`API_BASE = API_ORIGIN + /v1`
- 模型列表 = `API_BASE + /models`
- Responses = `API_BASE + /responses`
- Chat = `API_BASE + /chat/completions`
- OAuth Token = `API_ORIGIN + /v1/oauth/token`

### 3.3 OAuth 客户端身份（参考值，先用这个开发）

- `client_id` = `wanlaicode-cli`（授权页、换票、刷新 **必须同一值**）
- `product_code` = `wanlaicode`（请求头/开通校验用此值；profile 响应里的 `entitlement.product_code` 以服务端为准，客户端按 `entitlement.status` 判断，不硬编码匹配字符串）
- `scope` = `user:profile user:inference`
- `client_app` / `X-Wanlai-Client` = `wanlaicodex`
- 回调策略 = `http://127.0.0.1:{port}/callback`

### 3.4 推荐登录时序：OAuth Authorization Code + PKCE

1. IDE 生成 state 和 PKCE（code_verifier, code_challenge）
2. IDE 启动仅监听 127.0.0.1 的临时回调服务（随机端口）
3. IDE 使用系统浏览器打开万来授权页（不在 WebView 收集密码）
4. 用户在网页完成登录和授权，浏览器回跳本机回调地址
5. IDE 常量时间校验 state，使用授权码换取软件 OAuth Token
6. IDE 获取账号资料，并用软件 OAuth Access Token 创建模型运行 API Key
7. IDE 使用运行 API Key 调用模型列表；聊天走 continue 的 OpenAI 兼容 provider
8. 软件 OAuth Access Token 过期时，用 Refresh Token 轮换（保留仍有效的运行 Key）；运行 API Key 无效时再重新创建

### 3.5 PKCE 生成要求

- `code_verifier`：密码学安全随机数，长度至少 43 字符
- `code_challenge = BASE64URL(SHA256(code_verifier))`，去掉 `=` padding
- `code_challenge_method = S256`
- `state`：独立的密码学安全随机数，不能复用 code_verifier
- `code_verifier` 和 `state` 只保存在本次登录的临时内存中
- 实现放在 `core/auth/pkce.ts`（纯 `node:crypto`，不依赖 VS Code）

```typescript
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

function base64url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function createOAuthAttempt() {
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(
    createHash("sha256").update(codeVerifier).digest(),
  );
  const state = base64url(randomBytes(32));
  return { codeVerifier, codeChallenge, state };
}

export function statesEqual(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}
```

### 3.6 打开授权页

- GET `{SITE_BASE}/software/oauth/authorize?client_id=wanlaicode-cli&redirect_uri=http%3A%2F%2F127.0.0.1%3A{PORT}%2Fcallback&response_type=code&state=...&code_challenge=...&code_challenge_method=S256&scope=user%3Aprofile%20user%3Ainference&prompt=login`
- 使用系统默认浏览器，不在 IDE WebView 中收集用户密码
- 回调服务只绑定 127.0.0.1，不绑定 0.0.0.0
- 使用操作系统分配的随机空闲端口
- 只在收到一次**有效**回调（带 `code` 或 `error` 的 `/callback`）后停止监听；忽略 `/favicon.ico` 等无关请求
- 必须先校验 state，再读取和兑换 code
- 新的登录尝试必须取消上一次：关闭旧 callback server，丢弃旧 PKCE
- 登录超时 15 分钟
- 授权会话服务端有效期 15 分钟，授权码有效期 5 分钟，授权码成功兑换后即失效

### 3.7 兑换授权码

- POST `{API_ORIGIN}/v1/oauth/token`
- Content-Type: `application/json`
- Body（`client_id` 必须与授权页相同）：

```json
{
  "grant_type": "authorization_code",
  "client_id": "wanlaicode-cli",
  "code": "...",
  "redirect_uri": "http://127.0.0.1:49152/callback",
  "code_verifier": "..."
}
```

- 公开端点，不携带用户 JWT 或运行 API Key
- `redirect_uri` 必须与授权请求里的值逐字节相同
- 成功响应为 OAuth 裸 JSON（不带 `{code,message,data}` envelope）：

```json
{
  "access_token": "eyJ...",
  "refresh_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "user:profile user:inference",
  "account": { "uuid": "...", "email_address": "user@example.com" },
  "organization": { "uuid": "..." }
}
```

### 3.8 获取用户资料和套餐状态

- GET `{API_ORIGIN}/api/oauth/profile`
- Authorization: `Bearer {SOFTWARE_OAUTH_ACCESS_TOKEN}`
- 成功响应裸 JSON：

```json
{
  "account": {
    "uuid": "...",
    "email_address": "...",
    "display_name": "...",
    "created_at": "...",
    "has_claude_max": false,
    "has_claude_pro": false,
    "has_api_access": true
  },
  "organization": {
    "uuid": "...",
    "organization_type": "individual",
    "rate_limit_tier": "default",
    "has_extra_usage_enabled": false,
    "billing_type": "software",
    "subscription_created_at": "..."
  },
  "entitlement": {
    "product_code": "wanlaicode",
    "status": "active"
  }
}
```

- `entitlement` 可能为空：登录仍然成功，但客户端必须禁止模型运行并展示购买/开通入口；不要把「无套餐」误判为「登录失败」
- 有套餐的判定：`entitlement != null && entitlement.status === "active"`。不要用 `product_code` 字符串硬匹配

### 3.9 创建运行 API Key

- POST `{API_ORIGIN}/api/oauth/wanlaicode/create_api_key`
- Authorization: `Bearer {SOFTWARE_OAUTH_ACCESS_TOKEN}`
- 成功响应：`{"raw_key": "sk-..."}`
- 该接口要求有效软件套餐
- `raw_key` 是模型运行凭据，必须按敏感信息存储

### 3.10 刷新软件 OAuth Token

- POST `{API_ORIGIN}/v1/oauth/token`
- Body：

```json
{
  "grant_type": "refresh_token",
  "client_id": "wanlaicode-cli",
  "refresh_token": "...",
  "scope": "user:profile user:inference"
}
```

- 服务端可能轮换 refresh_token。成功后必须 **一次写入** SecretStorage blob，替换 `accessToken + refreshToken + expiresAt`；**默认保留**现有 `runtimeApiKey`（OAuth 轮换不等于运行 Key 失效）
- 同一时刻只允许一个刷新任务（single-flight）
- 刷新完成写入前检查内存凭据代次，旧刷新不得覆盖用户刚完成的新登录/登出
- 收到明确的 `SOFTWARE_OAUTH_REFRESH_TOKEN_INVALID` 后清除登录态并要求重新登录
- 网络错误或 5xx 可以指数退避重试；4xx 不自动循环重试
- 运行 API Key 缺失、或运行接口返回「Key 无效/撤销」时，在 OAuth Token 仍有效的前提下重新调用创建运行 Key 接口

### 3.11 模型列表

- GET `{API_BASE}/models`
- Authorization: `Bearer {RUNTIME_API_KEY}`
- Headers: `X-Wanlai-Client`, `X-Wanlai-Client-Version`, `X-Wanlai-Device-Id`, `X-Wanlai-Device-Name`, `X-Wanlai-OS`, `X-Wanlai-Arch`
- `/v1/models` 允许匿名访问，但 IDE 应携带运行 API Key 以获取账号/套餐/Key 实际可用的模型与倍率
- 不要在客户端硬编码完整模型白名单

### 3.12 聊天接口

- 产品路径：continue 的 OpenAI 兼容 provider 调用 `POST {API_BASE}/chat/completions`（continue 默认 `stream: true`，由其现有 SSE 解析处理）
- 本阶段 **不** 再实现一套 `RuntimeApiClient.chatCompletion`
- `RuntimeApiClient` 本阶段只负责 `GET /models`，供配置注入使用
- 所有模型请求携带：`Authorization`, `Content-Type`, `Accept`, `X-Wanlai-*` headers（通过 continue 的 `requestOptions.headers` 注入）
- Header 值必须去掉控制字符并限制长度
- 设备 ID 应稳定但不可逆：对 `vscode.env.machineId` 加产品命名空间后做 SHA-256
- 可选冒烟命令（非产品路径）：`wanlaiide.auth.smokeChat`，用 `stream: false` 打一次 `/v1/chat/completions`，仅用于开发验证网关

### 3.13 三种错误结构（机读分支必须匹配 reason，不要匹配中文 message）

1. **业务 REST API**：`{"code":401,"message":"...","reason":"TOKEN_EXPIRED"}` → 机读字段：顶层 `reason`
2. **Software OAuth 裸错误**：`{"error":"...","reason":"SOFTWARE_OAUTH_REFRESH_TOKEN_INVALID","message":"..."}` → 机读字段：顶层 `reason`
3. **Responses 网关错误**：`{"error":{"type":"...","code":"...","sub_code":"SOFTWARE_PRODUCT_NOT_ENTITLED","message":"..."}}` → 机读字段：`error.sub_code`
4. **Chat Completions**：机读字段：`error.code`

### 3.14 关键错误处理表

按 **调用所用的凭据类型** 解释 401，不能一律刷新 OAuth。

| Reason/状态                                                                                   | 发生在                         | 客户端动作                                                                   |
| --------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| `TOKEN_EXPIRED`、OAuth Access Token 临近过期                                                  | OAuth / Profile                | 刷新 OAuth Token 后重试一次                                                  |
| `SOFTWARE_OAUTH_ACCESS_TOKEN_INVALID`                                                         | OAuth / Profile                | 尝试 Refresh Token；失败则重新登录                                           |
| `SOFTWARE_OAUTH_REFRESH_TOKEN_INVALID`                                                        | OAuth 刷新                     | 清除登录态并重新登录                                                         |
| 运行 Key 无效 / 撤销（401 且 reason 指向 api key，或 Chat `error.code` 表示 invalid api key） | `/v1/models`、chat/completions | **不刷新 OAuth**；若 OAuth 仍有效则重建运行 Key 后重试一次；否则提示重新登录 |
| `SOFTWARE_PRODUCT_NOT_ENTITLED`                                                               | 任意                           | 保留登录态，禁止推理，展示开通套餐入口                                       |
| `SOFTWARE_OAUTH_NO_USABLE_GROUP`                                                              | 任意                           | 保留登录态，提示套餐暂不可用                                                 |
| `SOFTWARE_TOKEN_LIMIT_5H_EXCEEDED`                                                            | 模型                           | 展示 5 小时额度用尽                                                          |
| `SOFTWARE_TOKEN_LIMIT_7D_EXCEEDED`                                                            | 模型                           | 展示 7 天额度用尽                                                            |
| `SOFTWARE_TOKEN_LIMIT_30D_EXCEEDED`                                                           | 模型                           | 展示 30 天额度用尽                                                           |
| `SOFTWARE_TOKEN_LIMIT_TOTAL_EXCEEDED`                                                         | 模型                           | 展示试用总额度用尽/升级入口                                                  |
| `SOFTWARE_TOKEN_LIMIT_DEEPSEEK_DAILY_EXCEEDED`                                                | 模型                           | 展示 DeepSeek 当日额度用尽                                                   |
| HTTP 429                                                                                      | 任意                           | 按服务端语义展示额度或限速；仅限速类做退避重试                               |
| HTTP 500/502/503                                                                              | 任意                           | 有上限的指数退避；**不得** clear 登录态                                      |
| 网络错误（断网、DNS、超时）                                                                   | 任意                           | 保留登录态与用户输入；提示稍后重试                                           |
| continue 流式 `response.failed`                                                               | 模型流                         | 结束当前流并展示流内错误（由 continue 处理）                                 |

### 3.15 重试、超时和退出登录建议值

| 操作                | 超时                   | 重试                                        |
| ------------------- | ---------------------- | ------------------------------------------- |
| OAuth 浏览器登录    | 15 分钟                | 用户主动重新发起                            |
| OAuth Token/Profile | 15 秒                  | 网络/5xx 最多 2 次，指数退避                |
| 模型列表            | 15 秒                  | 网络/5xx 最多 2 次                          |
| 建立聊天流          | 60 秒首包超时          | 交给 continue；未收到任何响应体时可有限重试 |
| 流已开始            | 由用户取消或服务端结束 | 不自动重放                                  |

退出登录时：

1. 通过 `RequestCanceller` 取消正在进行的刷新、profile、models 请求（continue 侧的模型流走其现有 abort）
2. 增加本地凭据代次，使旧异步任务无法回写
3. 删除 SecretStorage 中的凭据 blob
4. 清除内存中的用户资料、模型缓存和套餐状态
5. OAuth 方式没有服务端 logout 接口（只有账号密码兼容方式才有 `/api/v1/auth/logout`）

### 3.16 账号密码登录兼容方案（本阶段不用，仅了解）

- POST `{API_ORIGIN}/api/v1/auth/login`，body: `{email, password, turnstile_token}`
- 受 Turnstile/人机验证和限流保护
- 可能需要 2FA（`requires_2fa` + `temp_token` → `/api/v1/auth/login/2fa`）
- 用户 JWT 刷新接口为 POST `/api/v1/auth/refresh`，与软件 OAuth `/v1/oauth/token` 是两套不同流程，不得混用

---

## 4. 整体架构

### 4.1 目录布局（第一期保持 continue 原结构）

导入 `v2.0.0-vscode` 后在现有树上新增文件，不搬迁 `core/`、`gui/`、`extensions/vscode`。

```
wanlaiide/
├─ LICENSE                          # 必须保留 continue Apache 2.0
├─ package-lock.json                # 保持 npm，不切 pnpm
├─ assets/brand/
│  └─ wanlaiide.svg
├─ extensions/vscode/               # continue 原扩展（不重命名）
│  └─ src/
│     ├─ auth/                      # 新增：VS Code 侧适配
│     │  ├─ oauthServer.ts          # 127.0.0.1 回调服务，实现 CallbackServerPort
│     │  ├─ secretStorageAdapter.ts
│     │  ├─ httpClientAdapter.ts
│     │  ├─ requestCancellerAdapter.ts
│     │  ├─ deviceInfo.ts
│     │  ├─ wanLaiConfigBridge.ts   # 把 AuthService 接到 ConfigHandler
│     │  └─ index.ts
│     ├─ activation/activate.ts     # 修改：先装 AuthModule
│     └─ extension/VsCodeExtension.ts
├─ core/                            # continue 原 core（不重命名、无 src/ 前缀）
│  ├─ auth/                         # 新增
│  │  ├─ types.ts
│  │  ├─ pkce.ts                    # 纯 crypto，放 core
│  │  ├─ credentialStore.ts
│  │  ├─ authService.ts
│  │  ├─ oauthApiClient.ts
│  │  ├─ runtimeApiClient.ts        # 本阶段仅 getModels
│  │  ├─ errorMapper.ts
│  │  ├─ sanitizedLogger.ts
│  │  ├─ eventEmitter.ts            # 不使用 vscode.Event
│  │  └─ requestCanceller.ts        # 接口；实现可在 core 用 AbortController 集合
│  └─ ports/
│     ├─ secretStoragePort.ts
│     ├─ httpClientPort.ts
│     ├─ loggerPort.ts
│     └─ callbackServerPort.ts
├─ gui/                             # continue 原 UI（不重命名）
│  └─ src/components/
│     └─ AuthStatusBadge.tsx        # 新增
├─ packages/                        # continue 已有 config-yaml、openai-adapters、fetch 等
└─ docs/superpowers/specs/
   └─ 2026-08-13-core-auth-design.md
```

continue 的 `core/` 根目录就是源码根（没有 `core/src/`）。新增 auth 文件与现有 `core/llm/`、`core/config/` 并列。

### 4.2 依赖方向

```
gui  ←── 消息协议 ──→  extensions/vscode  ──实现──→  core/ports
                                              ↑
                                              └── 调用 ──→  core/auth
```

- `core` 不依赖 `vscode` 模块，只依赖 `ports/` 与 Node 内置（`crypto`、`http` 仅在 extension 的 callback server 使用）
- extension 实现 ports（SecretStorage、HTTP、设备信息、打开浏览器、callback server）
- `gui` 只通过 postMessage 与 extension 通信，不接触任何凭据

### 4.3 认证模块与 continue 的集成点

认证模块作为独立层插入，尽量少改 continue 核心：

```
activateExtension()
  │
  ├─ 1. 同步初始化 AuthModule
  │     ├─ 适配器：SecretStorage / HttpClient / Logger / CallbackServer
  │     ├─ CredentialStore + OAuthApiClient + RuntimeApiClient + AuthService
  │     └─ restore() 从 blob 恢复内存状态（不等网络）
  │
  ├─ 2. 按 continue 原流程创建 VsCodeExtension / Core
  │
  ├─ 3. WanLaiConfigBridge 接到 core.configHandler
  │     └─ 登录后 overlay 内存模型列表（apiKey 只在内存）
  │
  ├─ 4. 注册 wanlaiide.auth.login / logout
  │
  ├─ 5. 后台 validateSession()（profile + 必要时 create_api_key）
  │
  └─ 6. 监听 onStatusChange → 刷新 ConfigHandler + 推送 Webview
```

**关键原则**：不把运行 API Key 写入 `~/.continue/config.yaml`。`config.yaml` 文件机制保留，第一阶段不暴露编辑入口。

---

## 5. 激活流程（整合 continue 初始化）

```
activateExtension(context)
  │
  ├─ 1. 读取 VS Code 配置（apiBaseUrl, siteBaseUrl）
  │
  ├─ 2. 组装认证模块（必须快，禁止在这里 await 网络）
  │     ├─ AuthService.restoreFromStorage()
  │     │     ├─ 有 blob → 内存状态先标 loggedIn 或 loggedInNoEntitlement（若本地已缓存 entitlement）
  │     │     └─ 无 blob → loggedOut
  │     └─ 启动后台 validateSession()，不阻塞后续
  │
  ├─ 3. 按 continue 原路径 new VsCodeExtension(context)
  │     └─ Core / ConfigHandler / Webview / 原有命令
  │
  ├─ 4. WanLaiConfigBridge.attach(configHandler, authService)
  │
  ├─ 5. 注册 wanlaiide.auth.login / logout
  │     监听 secrets.onDidChange 与 windowState
  │
  └─ 6. 后台 validateSession 完成后
        └─ onStatusChange → ConfigHandler 重载 → Webview auth:status
```

`restoreFromStorage` 若本地没有缓存 entitlement，有凭据时先进入 `loggedIn`（乐观），validate 后再改为 `loggedInNoEntitlement` 或保持 `loggedIn`。宁可短暂允许点击发送、再被柔和拒绝，也不要在断网时显示未登录。

---

## 6. 模块详细设计

### 6.0 Ports（`core/ports/`）

core 只依赖这些接口。extension 提供实现。

```typescript
export interface SecretStoragePort {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

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

export interface LoggerPort {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface OAuthCallbackResult {
  code: string;
  state: string;
}

export interface CallbackServerPort {
  start(
    timeoutMs: number,
  ): Promise<{ port: number; result: Promise<OAuthCallbackResult> }>;
  close(): void;
}

export interface RequestCanceller {
  track(signalOwner: AbortController): void;
  abortAll(): void;
}

export interface LoginDeps {
  openBrowser: (url: string) => Promise<void>;
  createCallbackServer: () => CallbackServerPort;
  redirectUriFactory: (port: number) => string;
}
```

`HttpClientAdapter` 用原生 `fetch` + `AbortSignal.timeout`（或手动 timer abort）。超时、HTTP 错误不抛未捕获异常到 extension host：转为 `StructuredError`。

所有认证相关 in-flight 请求在创建时 `track` 到 `RequestCanceller`；`logout()` 与新 `login()` 开始时 `abortAll()`。

core 内事件用自写 `AuthEventEmitter<T>`（`subscribe` / `fire`），**禁止** `import * as vscode`。

### 6.1 PKCE 工具（`core/auth/pkce.ts`）

职责：生成 code_verifier、code_challenge、state；常量时间校验 state。实现见 3.5。

约束：

- `codeVerifier` 和 `state` 只存本次登录的内存变量，完成或失败后丢弃
- 不落盘、不进日志、不进 SecretStorage
- `codeChallenge` 使用 S256

### 6.2 OAuth 回调服务（`extensions/vscode/src/auth/oauthServer.ts`）

实现 `CallbackServerPort`。

```typescript
export class OAuthCallbackServer implements CallbackServerPort {
  async start(
    timeoutMs = 15 * 60 * 1000,
  ): Promise<{ port: number; result: Promise<OAuthCallbackResult> }> {
    // 1. http.createServer，只 listen(0, "127.0.0.1")
    // 2. pathname === "/favicon.ico" 或非 /callback → 204/404，不关闭 server
    // 3. GET /callback?code&state → 200 简单 HTML，resolve，close
    // 4. GET /callback?error → 200 失败页 HTML，reject，close
    // 5. timeoutMs 到 → reject("登录超时")，close
  }
  close(): void {
    /* server.close()；幂等 */
  }
}
```

安全约束：

- 只绑定 `127.0.0.1`
- 端口由 OS 分配
- 成功页 HTML 无第三方脚本、无凭据、无 code
- `close()` 可重复调用

### 6.3 凭据存储（`core/auth/credentialStore.ts`）

#### 6.3.1 类型（`core/auth/types.ts`）

```typescript
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
```

#### 6.3.2 存储格式

SecretStorage **只使用一个 key**：`wanlaiide.credentials`，值为 JSON 字符串（`StoredCredentialBlob`）。

`store` / `delete` 必须整包替换。禁止拆成 `access_token`、`refresh_token`、`expires_at`、`api_key` 四个 key。

内存 `revision` 只用于本进程内防止旧异步回写，不写入 blob（跨窗口靠 blob 内容 + `onDidChange`）。

#### 6.3.3 CredentialStore 行为

```typescript
export class CredentialStore {
  private revision = 0;
  private refreshPromise: Promise<void> | null = null;
  private credentials: Credentials | null = null;

  async restore(): Promise<void> {
    // get(CREDENTIALS_STORAGE_KEY) → JSON.parse → this.credentials
    // 解析失败 → 当作无凭据，logger.warn，不抛到 activate
  }

  async getValidAccessToken(): Promise<string | null> {
    // 无凭据 → null
    // expiresAt - now > 60_000 → accessToken
    // 否则 refresh()（single-flight）
    // 刷新因 REFRESH_TOKEN_INVALID 失败 → clear()，null
    // 刷新因网络/5xx 失败 → 保留旧凭据，抛 StructuredError（调用方不得当作 loggedOut）
  }

  async getRuntimeApiKey(): Promise<string | undefined> {
    return this.credentials?.runtimeApiKey;
  }

  async saveLogin(tokens: OAuthTokens): Promise<void> {
    this.revision++;
    this.credentials = { ...tokens, runtimeApiKey: undefined };
    await this.persist();
  }

  async saveRuntimeApiKey(rawKey: string): Promise<void> {
    if (!this.credentials) return;
    this.credentials = { ...this.credentials, runtimeApiKey: rawKey };
    await this.persist();
  }

  async clear(): Promise<void> {
    this.revision++;
    this.credentials = null;
    this.refreshPromise = null;
    await this.storage.delete(CREDENTIALS_STORAGE_KEY);
  }

  async reloadFromStorage(): Promise<void> {
    // 供 onDidChange / 窗口聚焦：从 blob 覆盖内存，revision++
  }

  private async persist(): Promise<void> {
    // JSON.stringify 整包 store；一次调用
  }

  private async refresh(): Promise<void> {
    // single-flight
    // 快照 myRevision
    // oauthClient.refreshToken
    // 写入前 myRevision !== this.revision → 丢弃
    // 成功：替换 access/refresh/expiresAt，保留 runtimeApiKey，persist
    // REFRESH_TOKEN_INVALID → clear
    // 网络/5xx → 不 clear，throw
  }
}
```

`getValidAccessToken` 在网络失败时 **不得** `clear()`。只有明确的 refresh token 无效才 clear。

### 6.4 AuthService（`core/auth/authService.ts`）

```typescript
export class AuthService {
  readonly onStatusChange: AuthEventEmitter<AuthStatus>;

  async login(deps: LoginDeps): Promise<void> {
    /* 见 9.1 */
  }
  async logout(): Promise<void> {
    /* 见 9.2 */
  }
  getStatus(): AuthStatus;
  getUserProfile(): UserProfile | null;
  getPublicUserInfo(): { displayName: string; emailMasked: string } | null;
  async getRuntimeApiKey(): Promise<string | null>;

  /** 仅读存储，不访问网络。activate 里调用。 */
  async restoreFromStorage(): Promise<void>;

  /** 后台校验：refresh（如需要）+ getProfile + 必要时 create_api_key。 */
  async validateSession(): Promise<void>;
}
```

`login` 要点：

1. 若已有进行中的 login：先 `close()` 旧 callback server，丢弃旧 PKCE，`abortAll` 认证请求
2. 状态 = `loggingIn`
3. `createOAuthAttempt()`（core）
4. 启动 callback server，拼授权 URL（`client_id=wanlaicode-cli`）
5. `openBrowser`
6. 等待回调；`statesEqual`；`exchangeCode`（同一 `client_id` 与 `redirect_uri`）
7. `saveLogin` → `getProfile` → 有套餐则 `createRuntimeApiKey` + `saveRuntimeApiKey`
8. 状态 `loggedIn` 或 `loggedInNoEntitlement`
9. `finally` 丢弃 PKCE、`close` server

`restoreFromStorage`：有 blob → 根据缓存的 `entitlementStatus` 设状态；无则 `loggedOut`。不 await 网络。

`validateSession`：

- 无凭据 → 保持 `loggedOut`
- `getValidAccessToken` 因网络失败 → **保持当前状态**，记录 warn
- `getValidAccessToken` 因 refresh 无效 → `clear` + `loggedOut` + 需要时发 `login_required`
- `getProfile` 401 且 refresh 仍失败 → 同上
- `getProfile` 网络/5xx → **保持已登录**，不 clear
- profile 成功 → 更新用户信息与 entitlement，必要时创建运行 Key

### 6.5 OAuth API Client（`core/auth/oauthApiClient.ts`）

```typescript
export class OAuthApiClient {
  async exchangeCode(
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<OAuthTokens>;
  async refreshToken(refreshToken: string): Promise<OAuthTokens>;
  async getProfile(): Promise<ProfileResponse>;
  async createRuntimeApiKey(): Promise<string>;
}
```

`exchangeCode` / `refreshToken` 的 JSON body 里 `client_id` 固定为配置中的 `wanlaicode-cli`，不得写死 `wanlai-ide`。

`expiresAt = Date.now() + expires_in * 1000`。

### 6.6 Runtime API Client（`core/auth/runtimeApiClient.ts`）

本阶段只实现 `getModels()`。聊天不走本类。

```typescript
export class RuntimeApiClient {
  async getModels(): Promise<ModelInfo[]>;
  // 可选，仅冒烟命令使用：
  async smokeChatCompletion(req: ChatRequest): Promise<ChatResponse>;
}
```

`buildHeaders`：Authorization + Content-Type + Accept + `X-Wanlai-*`。值去掉 `[\x00-\x1F\x7F]`，Device-Name ≤ 64，其余 ≤ 128。

### 6.7 统一错误处理（`core/auth/errorMapper.ts`）

```typescript
type ApiSource = "rest" | "oauth" | "responses" | "chat";

export interface StructuredError {
  statusCode: number;
  reason?: string;
  message: string;
  source: ApiSource;
  credentialKind: "oauth" | "runtime" | "none";
  originalError?: unknown;
}

export type ErrorAction =
  | { type: "refresh_oauth_and_retry" }
  | { type: "recreate_runtime_key_and_retry" }
  | { type: "clear_and_relogin" }
  | { type: "keep_logged_in_no_entitlement" }
  | { type: "show_quota_exceeded"; reason: string }
  | { type: "rate_limit_backoff" }
  | { type: "retry_with_backoff" }
  | { type: "keep_status_show_error" }
  | { type: "show_to_user" };

export function parseError(
  source: ApiSource,
  status: number,
  body: unknown,
): StructuredError;
export function getErrorAction(error: StructuredError): ErrorAction;
```

`getErrorAction` 必须看 `credentialKind`：

- `credentialKind === "runtime"` 且 401 → `recreate_runtime_key_and_retry`（除非 reason 是 entitlement / quota）
- `credentialKind === "oauth"` 且 `TOKEN_EXPIRED` / `SOFTWARE_OAUTH_ACCESS_TOKEN_INVALID` → `refresh_oauth_and_retry`
- 网络错误（无 HTTP status 或 status 0）→ `keep_status_show_error`

重试：网络/5xx 最多 2 次（1s, 2s）；429 看 Retry-After；4xx 不自动重试；刷新或重建 Key 后只再打一次原请求。

### 6.8 日志脱敏（`core/auth/sanitizedLogger.ts`）

四层防护：字段名匹配 → Bearer 兜底 → JWT 兜底 → `sk-` 兜底。实现保持 v1.0 的 `SanitizedLogger`。另把 `code`、`code_verifier`、`raw_key` 列入 `SENSITIVE_KEYS`。

约束：

- 不记录完整请求/响应体，只记录 URL、statusCode、reason
- 错误堆栈打印前经过 sanitize
- OutputChannel 输出前经过 sanitize
- 禁止直接 `console.log` 认证数据

### 6.9 设备信息（`extensions/vscode/src/auth/deviceInfo.ts`）

```typescript
const PRODUCT_NAMESPACE = "wanlaiide";

export function getDeviceInfo(machineId: string): DeviceInfo {
  const id = createHash("sha256")
    .update(`${PRODUCT_NAMESPACE}:${machineId}`)
    .digest("base64url")
    .slice(0, 32);
  return {
    id,
    name: os.hostname().replace(CONTROL_CHARS, "").slice(0, 64),
    os: `${os.type()} ${os.release()}`.replace(CONTROL_CHARS, "").slice(0, 128),
    arch: os.arch(),
  };
}
```

`machineId` 来自 `vscode.env.machineId`。

### 6.10 配置注入（`extensions/vscode/package.json`）

```json
{
  "contributes": {
    "configuration": {
      "title": "WanLai IDE",
      "properties": {
        "wanlaiide.apiBaseUrl": {
          "type": "string",
          "default": "https://api.wanlai.ai/v1",
          "description": "万来服务 API 根地址",
          "scope": "machine"
        },
        "wanlaiide.siteBaseUrl": {
          "type": "string",
          "default": "https://wanlai.ai",
          "description": "万来授权站点地址（OAuth 登录页）",
          "scope": "machine"
        }
      }
    }
  }
}
```

- `scope: "machine"`，不进工作区 git
- `apiOrigin = apiBaseUrl.replace(/\/v1\/?$/, "")`
- 禁止硬编码内部地址
- 扩展 `publisher` / `name` / `displayName` 换为万来标识时，同时改图标为从 `assets/brand/wanlaiide.svg` 生成的 PNG

### 6.11 模型配置桥接（`extensions/vscode/src/auth/wanLaiConfigBridge.ts`）

continue 2.0.0 的 `ConfigHandler` **没有**可注入的 `ContinueConfigProvider`。第一期做法：

1. fork 导入后做一次 spike：读 `core/config/ConfigHandler.ts`、`ProfileLifecycleManager`、本地 yaml loader
2. 选定一种落地（优先 A）：
   - **A（优先）**：增加内存 `ProfileLoader`，作为当前 profile，`loadConfig()` 返回由 AuthService + `/v1/models` 生成的 `ContinueConfig`
   - **B**：在 `ConfigHandler.loadConfig()` 之后 overlay `models[]`（仍不把 apiKey 写盘）
3. 每个 model：
   - `provider: "openai"`
   - `apiBase: apiBaseUrl`
   - `apiKey`: 内存中的 runtime key
   - `requestOptions.headers`: `X-Wanlai-Client` 等（continue OpenAI provider 支持自定义 header）
4. 未登录 / 无套餐：`models: []`。提示文案走 Webview `auth:status`，不塞进 continue config 的无用 message 字段
5. `onStatusChange` 时调用 continue 已有的 config reload（`configHandler.reloadConfig()` 或等价 API，spike 时记下真实方法名）
6. 不写 `~/.continue/config.yaml` 的 apiKey

---

## 7. 与 continue 的集成方式

### 7.1 continue 2.0.0 要点

- 激活：`activateExtension` → `new VsCodeExtension` → `new Core(inProcessMessenger, ide)` → `this.configHandler = this.core.configHandler`
- 配置：`ConfigHandler` + profile，不是单一 ConfigProvider
- LLM：`core/llm/llms/OpenAI.ts`；`requestOptions.headers` 可用
- 聊天：`llm/streamChat`，默认流式。本阶段 **复用这条路径**
- Node `>=20.20.1`，VS Code `^1.70.0`，npm + `package-lock.json`
- 目录：`core/`、`gui/`、`extensions/vscode/`、`packages/config-yaml`、`packages/openai-adapters`、`packages/fetch`、`binary/`、`extensions/intellij`

### 7.2 模型配置桥接

见 6.11。登录成功 → reload ConfigHandler → GUI 模型列表更新。

### 7.3 对话验证

- 产品验证：用户在 continue Chat 面板发一条消息，走注入后的 OpenAI provider
- 「本阶段不做 SSE」= 不自己实现 SSE 解析，不是关掉 continue 的流式
- 可选：命令 `wanlaiide.auth.smokeChat` 用非流式打网关，便于没开侧边栏时排错

### 7.4 裁剪范围

| 模块                                           | 处理方式             | 说明                 |
| ---------------------------------------------- | -------------------- | -------------------- |
| `extensions/intellij`                          | 可删除               | 第一阶段只做 VS Code |
| `binary/`、`docs-site/`、continue 自有 `docs/` | 可暂留               | 第一期不以搬迁为任务 |
| autocomplete                                   | 保留代码，禁用功能   | 后续可能启用         |
| Hub                                            | 保留代码，禁用功能   | 后续可能启用         |
| config-yaml 编辑器                             | 保留包，禁用 UI 入口 | 不允许用户自定义模型 |
| Agent、Cmd+K                                   | 保留                 | 认证不阻塞即可       |

### 7.5 许可证与品牌

- 保留根目录 `LICENSE`（Apache 2.0）及源文件版权头
- 新增万来文件可使用项目自己的版权行，但不得删除 continue 原声明
- 图标从 `assets/brand/wanlaiide.svg` 生成，禁止截图或金色版作为源

---

## 8. Webview 消息协议

### 8.1 Extension → Webview

```typescript
type AuthStatusMessage = {
  type: "auth:status";
  status: AuthStatus;
  user?: { displayName: string; emailMasked: string };
  entitlement?: { status: string };
};

type AuthLoginFailedMessage = {
  type: "auth:login_failed";
  reason: string;
  message: string;
};

type AuthLoginRequiredMessage = {
  type: "auth:login_required";
  message: string;
};
```

不传 `uuid`、任何 token、原始邮箱。`entitlement` 只传 `status`，不传服务端内部 product 字符串（避免把参考值泄漏进 UI 逻辑）。

### 8.2 Webview → Extension

```typescript
type AuthLoginRequest = { type: "auth:login" };
type AuthLogoutRequest = { type: "auth:logout" };
type AuthGetStatusRequest = { type: "auth:get_status" };
```

### 8.3 安全约束

- Webview 消息不含 Token、密码
- Extension 推送不含 access_token、refresh_token、raw_key、uuid、原始邮箱
- Webview 的 `localStorage` / `sessionStorage` 不得存认证数据
- 消息走现有 VsCodeMessenger / webview protocol，不把 AuthService 暴露给 Webview

### 8.4 邮箱脱敏

```typescript
function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!domain) return "***";
  const maskedName = name.length > 0 ? name[0] + "***" : "***";
  return `${maskedName}@${domain}`;
}
```

---

## 9. 核心流程

### 9.1 登录流程

```
用户点击登录
  → Webview 发送 auth:login
  → 若已有 login 进行中：关闭旧 callback server，丢弃旧 PKCE
  → AuthService.login()
      → status = loggingIn
      → createOAuthAttempt()（内存）
      → OAuthCallbackServer.listen(0, 127.0.0.1)
      → SITE_BASE/software/oauth/authorize
          ?client_id=wanlaicode-cli
          &redirect_uri=http://127.0.0.1:{port}/callback
          &response_type=code&state&code_challenge
          &code_challenge_method=S256
          &scope=user:profile user:inference
          &prompt=login
      → vscode.env.openExternal(url)
      → 回调 /callback?code&state（忽略 favicon）
      → statesEqual；exchangeCode（client_id=wanlaicode-cli，同一 redirect_uri）
      → saveLogin（整包 blob，尚无 runtime key）
      → getProfile
      → 有 active entitlement → createRuntimeApiKey → 写入同一 blob
      → status = loggedIn | loggedInNoEntitlement
      → ConfigHandler reload
  → Webview auth:status
```

### 9.2 退出登录流程

```
auth:logout
  → RequestCanceller.abortAll()
  → CredentialStore.clear()（revision++，delete blob）
  → 清 profile / 模型缓存
  → status = loggedOut
  → ConfigHandler reload（空 models）
  → Webview auth:status
```

### 9.3 激活恢复流程

```
activate
  → restoreFromStorage()（同步逻辑，可 await 本地 SecretStorage，不访问网络）
      → 无 blob → loggedOut
      → 有 blob → 乐观 loggedIn / loggedInNoEntitlement
  → 继续 continue 原激活（不阻塞）
  → 后台 validateSession()
      → 需要则 refresh OAuth（网络失败：保持乐观状态）
      → getProfile
          → 成功 → 更新状态与 entitlement
          → 401 + refresh 无效 → clear + loggedOut + login_required
          → 网络/5xx → 保持乐观状态
      → 有套餐且缺 runtime key → create_api_key
      → onStatusChange → 配置与 Webview
```

### 9.4 请求中 401 处理

**OAuth 客户端（profile / create_api_key）**

```
401 → parseError(source=oauth|rest, credentialKind=oauth)
  → TOKEN_EXPIRED / ACCESS_TOKEN_INVALID → refresh OAuth → 重试 1 次
  → REFRESH_TOKEN_INVALID → clear + login_required
  → NOT_ENTITLED → loggedInNoEntitlement
```

**运行客户端（models）以及 continue LLM 回调上来的 chat 错误**

```
401 → parseError(source=chat|responses, credentialKind=runtime)
  → entitlement / quota → 对应展示，不 refresh OAuth
  → 视为运行 Key 无效 → 若 OAuth 仍有效则 recreate key → 重试 1 次
  → 仍 401 → 提示重新登录或开通套餐（按 reason）
```

禁止：运行接口 401 时直接 `refreshToken()`。

---

## 10. 特殊场景处理

### 10.1 无套餐用户体验

```
状态：loggedInNoEntitlement
  ├─ Webview 顶部：脱敏邮箱、「未开通套餐」、「开通套餐」→ https://wanlai.ai/purchase
  ├─ 模型选择器：空或「暂无可使用模型」
  ├─ 聊天输入框：可输入、可发送
  └─ 发送后：models 为空 → 柔和提示
     「当前账号未开通推理套餐，点击开通后即可使用万来 AI 编程助手」
```

不把无套餐判为登录失败；不强制禁用输入框。

### 10.2 登录中关闭 Webview

AuthService 是 extension host 单例。关闭 Webview 不影响后台 login。完成后：

- 成功：`showInformationMessage("万来账号登录成功")`
- 失败：`showErrorMessage("万来登录失败：{原因}")`

下次打开 Webview 时 `auth:get_status`。

### 10.3 多窗口登录状态同步

`vscode.SecretStorage` **有** `onDidChange`，且会通知其他窗口。本窗口写入时本窗口也可能收到，adapter 需幂等。

```
每个窗口独立 extension host
  ├─ 激活 restoreFromStorage
  ├─ context.secrets.onDidChange
  │     └─ key === wanlaiide.credentials → reloadFromStorage → validate 或只更新状态 → 推 Webview
  ├─ window.onDidChangeWindowState 聚焦时再 reload 一次（兜底）
  └─ 发 OAuth 请求前确保内存 token 未过期
```

场景：

- A 登录 → blob 写入 → B 收到 onDidChange → B 变为已登录
- A 登出 → blob 删除 → B 变为未登录
- B 请求中 A 登出 → B 得 401 → reload 发现无 blob → 登出

不使用跨窗口 postMessage，不使用文件锁。

不再依赖「60 秒 TTL 轮询」作为主机制；TTL 不是必须项。聚焦刷新保留。

### 10.4 并发登录

用户连点两次登录：第二次 `login()` 先关闭第一次的 server 并 abort 第一次的等待 Promise（reject `LoginCancelled`），第一次不得在稍后 `saveLogin`。用 revision / loginGeneration 计数。

---

## 11. 安全边界落地检查

| 安全边界                 | 落地方式                                       | 验证方法                                        |
| ------------------------ | ---------------------------------------------- | ----------------------------------------------- |
| Webview 不持有 Token     | 消息只传 status + 脱敏用户                     | 审查 postMessage + Webview storage              |
| Token 不写入普通配置     | 只存 SecretStorage 单 blob；yaml 无 apiKey     | 检查 `~/.continue/config.yaml` 与 settings.json |
| Token 不写入工作区       | configuration scope=machine                    | 检查工作区目录                                  |
| Token 不进日志           | SanitizedLogger                                | OutputChannel                                   |
| 网络错误不崩溃、不清登录 | try-catch；validateSession 区分 401 与网络错误 | 断网启动                                        |
| 取消后不处理结果         | AbortController + revision + loginGeneration   | 取消/二次登录测试                               |
| code_verifier 不落盘     | 仅内存                                         | SecretStorage 无该字段                          |
| 回调只监听本机           | `listen(port, "127.0.0.1")`                    | 外部不可达                                      |
| 设备 ID 不可逆           | SHA256(namespace + machineId)                  | 无法反推                                        |
| 凭据原子写入             | 单 key JSON blob                               | 杀进程后 blob 完整或为空                        |
| 邮箱脱敏                 | 只推 emailMasked                               | postMessage 无原文                              |
| Apache 2.0               | 保留 LICENSE                                   | 仓库根目录                                      |

---

## 12. 测试方案

### 12.1 Core 单元测试（vitest）

| 测试模块           | 用例                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pkce`             | codeVerifier 长度 ≥43；S256；verifyState 对/错；state 与 verifier 独立                                                                         |
| `credentialStore`  | 整包存取；过期触发刷新；并发 single-flight；代次丢弃旧刷新；登出后旧刷新失效；刷新成功保留 runtime key；refresh 无效才 clear；网络失败不 clear |
| `authService`      | login 编排；二次 login 取消第一次；logout；restore 不访问网络；validate 网络失败保持登录；无套餐状态；401 清登录                               |
| `oauthApiClient`   | exchange/refresh 的 body.client_id 为 `wanlaicode-cli`；getProfile Authorization；createApiKey；错误抛 StructuredError                         |
| `runtimeApiClient` | getModels 注入 X-Wanlai-\*；取消后不处理                                                                                                       |
| `errorMapper`      | 四种结构；runtime 401 → recreate key；oauth 401 → refresh；网络错误 → keep_status                                                              |
| `sanitizedLogger`  | token/Bearer/JWT/sk-/code_verifier 被替换；正常文本不受影响                                                                                    |

### 12.2 Extension 集成测试（@vscode/test-electron）

| 用例                  | 验证点                                                             |
| --------------------- | ------------------------------------------------------------------ |
| 激活恢复              | 预置 blob → 激活 → 乐观已登录（可 mock 网络）                      |
| SecretStorage 单 blob | get/set/delete                                                     |
| OAuthCallbackServer   | 随机端口；favicon 不关闭；有效回调后关闭；超时关闭；只绑 127.0.0.1 |
| 配置读取              | apiBaseUrl / siteBaseUrl 默认值                                    |
| onDidChange           | 写入 blob 后监听器触发（同窗口幂等）                               |

多窗口同步以 Extension Development Host 手动验证为主（自动化双窗口成本高）。

### 12.3 手动验证（Extension Development Host）

- [ ] 系统浏览器 OAuth 登录成功，IDE 显示已登录
- [ ] 退出后未登录
- [ ] 重启 VS Code，登录态恢复
- [ ] 断网启动：仍显示已登录，不误登出
- [ ] 过期 access token → 自动 refresh 或提示重登
- [ ] 无效 refresh token → 提示重新登录
- [ ] `/api/oauth/profile` 成功
- [ ] `/v1/models` 成功并出现在 continue 模型列表
- [ ] continue Chat 发出一条真实对话（允许 continue 默认流式）
- [ ] 取消进行中的登录/请求无后续 saveLogin
- [ ] 无套餐：开通按钮 + 柔和提示
- [ ] 登录中关 Webview → 通知 → 再打开状态正确
- [ ] 多窗口：A 登录 / 登出，B 聚焦或自动同步
- [ ] OutputChannel 无明文 token
- [ ] 工作区与 `.vscode/settings` 无凭据
- [ ] Webview storage 无凭据
- [ ] `~/.continue/config.yaml` 无 runtime apiKey
- [ ] 断网 / 5xx 不导致 extension host 崩溃

---

## 13. 开发文档清单

本阶段以本文件为唯一实施依据，不强制拆出四份平行文档。实施计划见 `docs/superpowers/plans/`。若后续需要给非开发同事看，再从本文件摘：

| 文档           | 内容                   | 位置                                                              |
| -------------- | ---------------------- | ----------------------------------------------------------------- |
| 认证与鉴权设计 | 本文档                 | `docs/superpowers/specs/2026-08-13-core-auth-design.md`           |
| 总体阶段设计   | 仓库与插件路线（只读） | `docs/superpowers/specs/2026-08-12-wanlaiide-bootstrap-design.md` |

---

## 14. 开发配置参考值（第一阶段）

| 配置项                | 值                            | 来源                                  |
| --------------------- | ----------------------------- | ------------------------------------- |
| continue 基线         | `v2.0.0-vscode`               | GitHub tag                            |
| `client_id`           | `wanlaicode-cli`              | 授权/换票/刷新同一值                  |
| `product_code`        | `wanlaicode`                  | 参考值；套餐判断看 entitlement.status |
| `scope`               | `user:profile user:inference` | 对接文档                              |
| `X-Wanlai-Client`     | `wanlaicodex`                 | 参考值                                |
| `API_BASE`            | `https://api.wanlai.ai/v1`    | 万来品牌地址                          |
| `API_ORIGIN`          | `https://api.wanlai.ai`       | API_BASE 去掉 `/v1`                   |
| `SITE_BASE`           | `https://wanlai.ai`           | 授权站点                              |
| 开通套餐              | `https://wanlai.ai/purchase`  | 已确认                                |
| SecretStorage key     | `wanlaiide.credentials`       | 单 blob                               |
| 登录超时              | 15 分钟                       | 对接文档                              |
| OAuth/Profile 超时    | 15 秒                         | 对接文档                              |
| 模型列表超时          | 15 秒                         | 对接文档                              |
| 网络/5xx 重试         | 最多 2 次，1s / 2s            | 对接文档                              |
| Access Token 过期缓冲 | 60 秒                         | 提前刷新                              |
| Node                  | `>=20.20.1`                   | continue engines                      |
| 包管理                | npm                           | continue 2.0.0                        |

---

## 15. 第一阶段交付边界

### 15.1 必须完成

- 导入 continue `v2.0.0-vscode`，保留 LICENSE，仓库可在 Extension Development Host 激活
- 轻量换皮（名称、图标），不改目录布局
- OAuth PKCE 全链路（浏览器 → 回调 → 换票 → profile → create_api_key）
- SecretStorage 单 blob + 重启恢复 + 断网不清登录
- Token 自动刷新（single-flight + 代次）；刷新保留运行 Key
- 退出登录（取消请求 + 删 blob）
- 统一 ApiClient（超时、取消、结构化错误、凭据类型分流）
- 日志脱敏
- ConfigHandler 内存注入模型 + `requestOptions.headers`
- 跑通 profile + models
- continue Chat 一次真实对话
- Webview 登录态（脱敏邮箱 + 套餐 + 开通按钮）
- 无套餐柔和提示
- 登录中关闭 Webview
- 多窗口：`onDidChange` + 聚焦兜底
- 设备信息与 X-Wanlai-\*
- `apiBaseUrl` / `siteBaseUrl`，scope=machine
- core 单元测试
- Extension Development Host 手动验证

### 15.2 暂时不做

- 自写 SSE 客户端
- 重命名为 `packages/extension|core|ui`
- 改用 pnpm
- Agent / Cmd+K 深度改造
- 多环境切换
- 用户自定义模型
- VS Code fork
- 扩展内购买
- 账号密码登录
- JetBrains（可删代码，不做适配）

---

## 16. 待确认事项

### 16.1 需 fork 代码后确认（实施第一项 spike）

1. **ConfigHandler 注入点的真实方法名**：内存 ProfileLoader 还是 loadConfig overlay。选定后把方法名补进 `wanLaiConfigBridge.ts` 注释，不再发明 `ContinueConfigProvider`。
2. **Hub / 本地 yaml 是否在未登录时抢占当前 profile**：若会，激活时强制切到万来内存 profile 或禁用 Hub 拉取。

`requestOptions.headers` 在 continue OpenAI provider 中已支持，不再作为 TBD。

### 16.2 需产品/后端配合

3. 独立 `client_id` / `product_code` / `X-Wanlai-Client` 的发放时间：先用参考值，替换时三处（授权 URL、换票、刷新）一起改。
4. `create_api_key` 对新 client 身份的支持：用参考值则当前无此问题。

### 16.3 已解决

- 开通套餐链接 → `https://wanlai.ai/purchase`
- 测试账号 → 开发时自行解决
- 换票 `client_id` 与授权页不一致 → v1.1 统一为 `wanlaicode-cli`
- SecretStorage 无变更事件 → 实际有 `onDidChange`
- 包管理 pnpm → 第一期 npm

---

> 文档结束。变更时更新版本号与变更记录。
