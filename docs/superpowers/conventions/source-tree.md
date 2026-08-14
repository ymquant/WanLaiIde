# Continue 源码树：首期保留与可裁剪

本仓库基于 continue `v2.0.0-vscode` 做 VS Code AI Agent 插件。**删除任何上游目录或文件前必须先询问维护者**（见 `.cursor/rules/no-delete-without-asking.mdc`）。下文是建议，不是已执行的删除。

VS Code 插件运行时：扩展宿主进程内加载 `core`，Webview 加载 `gui`。不经过 `binary/`。

## 建议保留（第一期插件必需）

| 路径 | 作用 |
|------|------|
| `extensions/vscode/` | VS Code 扩展入口、命令、Webview 宿主 |
| `gui/` | Agent / Chat / Cmd+K 界面 |
| `core/` | 会话、模型、工具、配置（与编辑器解耦） |
| `packages/config-yaml`、`config-types`、`openai-adapters`、`fetch`、`llm-info`、`terminal-security` | core 的 `file:` 依赖 |
| `assets/brand/` | 万来品牌源文件 |
| `docs/superpowers/` | 万来设计、计划、本规范 |
| `LICENSE` | Apache 2.0，fork 必须保留 |
| 根 `package.json`、`package-lock.json`、`.nvmrc`、`.vscode/` | 安装与 Launch extension |

## 建议不纳入产品、可考虑日后删除（须确认）

| 路径 | 是什么 | 为何可裁 | 注意 |
|------|--------|----------|------|
| `docs-site/` | Continue 官方文档站（Next.js，约等于 docs.continue.dev） | 插件运行、打包都不引用 | 与 `docs/` 里的 MDX 是两套；删站点不等于删 `docs/` |
| `docs/` 下 Continue 的 MDX 文档 | 上游产品文档 | 不做 Continue 文档站则不需要 `docs` 的 `npm install` | **`docs/superpowers/` 在同一棵 `docs/` 下，禁止整目录删除 `docs/`** |
| `extensions/intellij/` | JetBrains 插件 | 首期只做 VS Code | 删除后需改安装/CI 里对 intellij 的引用 |
| `extensions/cli/` | Continue CLI（`cn`） | 不是 VS Code 扩展 | 与 vscode 构建独立 |
| `binary/` | 独立 Node 进程，通过 IPC/TCP 跑 `Core`，供 JetBrains 等连接 | VS Code 在扩展进程内 `new Core(...)`，不启动该进程 | `scripts/install-dependencies.ps1` 会 `cd binary && npm install && npm run build`；若保留脚本则暂留目录，或先改脚本再删 |
| `eval/` | 模型/检索评测 | 不做评测流水线则不需要 | |
| `manual-testing-sandbox/` | 上游手工测试样例工程 | 不参与构建 | |
| `sync/` | Rust Merkle 代码索引库 | VS Code 索引主要在 `core/` TypeScript；安装脚本里 cargo 已注释 | 与 JetBrains/binary 关系更近，首期可不编译 |
| `.github/workflows/` 上游工作流 | Continue 自己的 CI/发版 | 会指向 Continue 的 marketplace/文档站 | 替换为万来 CI 前不要当自己的流水线用 |
| `docs-search-dark-mode-fix.png`、`.claude/`、`skills/` | 上游杂项/技能包 | 与 VS Code 扩展运行无关 | 逐项确认 |

## `binary/` 补充说明

`binary/src/index.ts` 把 `IS_BINARY=true`，创建 `IpcMessenger` 或开发用 `TcpMessenger`，再 `new Core(messenger, ide)`。IntelliJ 的 “Start Core Dev Server” 工作目录就是 `binary/`。

这不是「编译出来的 exe 资源目录」，而是 **给非 VS Code 宿主用的 Core 守护进程**。只做 VS Code 插件时，运行时不需要它。

## 建议的裁剪顺序（仍须确认后再动）

1. 安装时跳过 `docs`、`docs-site`、`binary` 的 npm（改脚本也要先问）。
2. 确认后从版本库移除：`docs-site/`、`extensions/intellij/`、`extensions/cli/`、`eval/`、`manual-testing-sandbox/`。
3. `binary/` 与安装脚本一起改，避免半删导致 `install-dependencies.ps1` 失败。
4. Continue 的 `docs/*.mdx` 若删除，必须保住 `docs/superpowers/`。
