# WanLai 鉴权手动 QA（Extension Development Host）

清单来自 `2026-08-13-core-auth-design.md` §12.3。在 `feat/oauth_login` 上 **Launch extension** 后逐项勾选。

## 准备

1. 关闭旧的 Extension Development Host（见下文「如何关闭」），再重新 Launch，确保加载最新 esbuild / gui。
2. 命令面板可搜到 `wanlaiide.auth.login` / `wanlaiide.auth.logout`；Chat 侧栏有「登录万来账号」。
3. OutputChannel 选 **WanLai**（勿在日志里出现 access_token / `sk-` / refresh_token）。

## 清单

- [x] 系统浏览器 OAuth 登录成功，IDE 显示已登录（脱敏邮箱）
- [x] 退出后显示未登录
- [ ] 重启 / Reload Window 后登录态恢复
- [ ] 断网启动：仍显示已登录，不误登出
- [ ] 过期 access token → 自动 refresh 或提示重登
- [ ] 无效 refresh token → 提示重新登录并回到未登录
- [ ] `/api/oauth/profile` 成功（OutputChannel 有 status/reason，无明文 token）
- [ ] `/v1/models` 成功并出现在 continue 模型列表
- [x] continue Chat 发出一条真实对话（允许流式）
- [ ] 取消进行中的登录/请求后无后续 `saveLogin`
- [ ] 未登录 / 退出后：对话历史仍在；发送按钮禁用；回车提示原因
- [ ] 无套餐：开通按钮跳转 `https://wanlai.ai/purchase` + 柔和提示
- [ ] 登录中关 Webview → 再打开状态正确
- [ ] 多窗口：A 登录/登出，B 聚焦后同步
- [ ] OutputChannel 无明文 token
- [ ] 工作区与 `.vscode/settings` 无凭据
- [ ] Webview `localStorage` / `sessionStorage` 无凭据
- [ ] `~/.continue/config.yaml` 无 runtime apiKey
- [ ] 断网 / 5xx 不导致 extension host 崩溃

## 自动化已覆盖（无需在 Host 重测）

在 `core/` 下：

```powershell
npx vitest run auth config/profile/WanLaiProfileLoader.vitest.ts
```

当前预期：相关用例全部 PASS（PKCE、errorMapper、sanitizedLogger、CredentialStore、API clients、AuthService、oauthServer、ProfileLoader）。

## 如何关闭 Extension Development Host

- 关闭弹出的 **Extension Development Host** 窗口；或
- 回到开发仓库窗口，调试工具栏点 **Stop**（或 `Shift+F5`）结束调试会话。

改完代码后需再次 Launch，才会加载新的扩展产物。
