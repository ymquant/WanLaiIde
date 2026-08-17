# Continue 源码树：保留与裁剪原则

本仓库基于 continue `v2.0.0-vscode`。**删除前必须询问维护者**（见 `.cursor/rules/no-delete-without-asking.mdc`）。

## 原则（已确认）

1. **不要**因为「第一期用不到」就删。
2. 打包、构建、流水线、测试、评测、CLI、JetBrains、索引等，**只要将来可能用到就保留**。
3. 只删除对万来 **现在和将来都不可能有用**（或会把流程指到 Continue 官方、造成误导）的内容。
4. 删掉后若要从上游再取回，成本高——存疑则留。

VS Code 运行时：扩展宿主加载 `core`，Webview 加载 `gui`。不经过 `binary/`（`binary/` 给 JetBrains 等用，仍保留）。

## 必须保留

| 路径                                                                                                 | 作用                      |
| ---------------------------------------------------------------------------------------------------- | ------------------------- |
| `extensions/vscode/`、`gui/`、`core/`                                                                | VS Code 插件主路径        |
| `packages/*`（含 config-yaml、openai-adapters、fetch、llm-info、terminal-security、continue-sdk 等） | 依赖与可复用包            |
| `assets/brand/`、`docs/superpowers/`                                                                 | 万来品牌与设计/规范       |
| `LICENSE`                                                                                            | Apache 2.0，fork 必须保留 |
| 根 `package.json`、`package-lock.json`、`.nvmrc`、`.vscode/`、`scripts/`                             | 安装、调试、构建          |
| `BUILD_DEPENDENCIES.md`、`TESTING.md`                                                                | 构建与测试说明            |

## 暂留（第一期可能不用，将来可能用）

| 路径                                                                  | 为何留                                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `extensions/intellij/`、`binary/`                                     | 将来做 JetBrains / 独立 Core 进程                                                          |
| `extensions/cli/`                                                     | 将来做 CLI                                                                                 |
| `sync/`                                                               | 代码索引（Rust），评测/增强可能用到                                                        |
| `manual-testing-sandbox/`                                             | 手工测 Agent / Edit / Next Edit 的样例工程                                                 |
| `eval/`                                                               | 评测脚手架（即使目前几乎为空）                                                             |
| `skills/`、`actions/`、`.claude/`                                     | Agent skill、PR review Action、文档风格 skill，流水线/协作可参考                           |
| `.github/workflows/*`（除已删的 CLA/docs-pages）、`.github/actions/*` | VSIX 构建、E2E、发版、依赖图等流水线模板；多数带 `continuedev/continue` 门禁，启用前需改编 |
| `.continue/`、`worktree-config.yaml`                                  | 仓库内开发辅助、worktree 拷贝配置                                                          |
| `.idea/`                                                              | JetBrains 运行配置参考                                                                     |

## 已删除（对万来不可能有用 / 会误导）

| 路径                                                       | 原因                                               |
| ---------------------------------------------------------- | -------------------------------------------------- |
| Continue Mintlify `docs/` 内容（已清，仅留 `superpowers`） | 官方文档站与演示图，插件与自有文档不依赖           |
| `docs-search-dark-mode-form.png`                           | 同上                                               |
| `CLA.md`、`.github/workflows/cla.yaml`                     | 向 **Continue Dev, Inc.** 授权的 CLA，万来不会沿用 |
| `.github/CODEOWNERS`                                       | 指向 `@continuedev/...`，在本仓库只会误派审查      |
| `.github/ISSUE_TEMPLATE/config.yml`                        | 联系链接指向 continuedev Discussions               |
| `.github/workflows/docs-gh-pages.yml`                      | 部署已移除的 Continue 文档站                       |

## 仍保留、但基线后建议改写（不删）

- 根 `README.md`：Continue 营销文案，可改成万来说明
- 多数 `.github/workflows`：保留作 CI 模板，去掉 `if: github.repository == 'continuedev/continue'` 并改密钥/发版目标后再启用
- `SECURITY.md` / `CODE_OF_CONDUCT.md`：可改成万来联系方式与社区规范

## 安装脚本注意

`scripts/install-dependencies.ps1` 仍可能 `cd docs` / `cd binary` 装依赖。`docs` 文档站已去掉后，**docs 安装段应跳过或删除**（改脚本前先问维护者）。`binary` 建议保留安装，除非明确放弃 JetBrains。
