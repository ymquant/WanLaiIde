# Git 分支与提交规范

仓库约定。AI **只建议、不执行** git 写操作（见 `.cursor/rules/git-operations.mdc`）。维护者按本文件亲自检查并提交。

## 分支

格式：`<type>/<description>`

- `type` 与 Commit Message 的 type 一致
- `description` 使用 **snake_case**
- 禁止中文、空格、特殊符号（含连字符 `-`）

| Type | 用途 | 示例 |
|------|------|------|
| feat | 新功能 | `feat/login_api`、`feat/oauth_login` |
| fix | Bug 修复 | `fix/completion_crash` |
| refactor | 重构 | `refactor/overlay_layout` |
| chore | 构建/工具/依赖 | `chore/ci_setup` |
| docs | 文档 | `docs/install_guide` |

保护分支：

- `main`：所有 PR 合入目标，不在上面直接开发
- `archive/*`：归档，只读，不可直接修改

当前登录鉴权工作分支：**`feat/oauth_login`**（已锁定，AI 不得改名）

## Commit Message

格式：

```text
<type>(<scope>): <subject>
```

- `type` 必填，同上表
- `scope` 小写英文，表示受影响模块
- `subject` **中文**，简明扼要

示例：

```text
feat(continue): 集成万来登录 API
fix(roocode): 修复 Agent 模式终端输出丢失
chore(ci): 适配万来仓库的 GitHub Actions
docs(guide): 新增安装指南
refactor(overlay): 重构 Creator Mode 布局逻辑
chore(continue): 导入 continue v2.0.0-vscode 作为基线
```

| Scope | 含义 |
|-------|------|
| continue | wanlai-continue 插件（本仓库 VS Code 扩展与 core/gui） |
| roocode | wanlai-roocode 插件 |
| brand | 品牌替换 |
| i18n | 汉化 |
| ci | CI/CD |
| build | 构建打包 |
| overlay | 主仓库 overlay/UI |

## AI 建议提交时的固定格式

完成一组文件改动后，只输出建议，不跑 `git add` / `git commit`：

1. 做了什么
2. 建议检查（`git status`、关键 diff、敏感路径：`node_modules`、`.env`、密钥、`.superpowers/sdd`）
3. 建议暂存路径（列出具体文件/目录，禁止建议 `git add -A`）
4. 建议分支名（若尚未符合规范）
5. 建议 message 一行：`<type>(<scope>): <中文 subject>`

维护者按仓库规范可改写后再提交。
