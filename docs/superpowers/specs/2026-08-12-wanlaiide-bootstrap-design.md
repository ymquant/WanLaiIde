# WanLai IDE 仓库与插件阶段设计

## 目标

创建公开仓库 `ymquant/wanlaiide`，由 `wanlaiide` 团队维护。产品先以 VS Code 插件验证 AI 编程体验，稳定后再同步维护插件与 VS Code fork，最终演进为完整 WanLai IDE。

## 仓库设置

- 仓库名称：`wanlaiide`
- 可见性：公开
- 默认分支：`main`
- 团队：`wanlaiide`
- 许可证：暂不添加
- 简介：`AI-native coding tool, starting as a VS Code extension and evolving into WanLai IDE.`

公开仓库中不得提交密钥、内部服务地址或仅限内部使用的配置。

## 品牌资产

品牌源文件为 `assets/brand/wanlaiide.svg`，来源是 `ymquant/wanlaicode-old` 的 `resources/server/icons/wanlaicode.svg`。该文件采用黑色圆角背景与灰色渐变图形：

- 背景：`#1E1E1E`
- 渐变起点：`#FFFFFF`
- 渐变中点：`#E9ECEF`
- 渐变终点：`#A9B0B8`
- 画布：1024 × 1024

SVG 是唯一品牌源文件。后续 VS Code Marketplace、README、macOS、Windows 和 Linux 图标均从该文件生成，禁止以截图或金色版本作为源文件。

## 产品路线

### 第一阶段：VS Code 插件

首个可用版本只包含两条核心链路：

1. Agent：在侧边栏中接收任务、读取工作区上下文、调用工具并展示执行过程。
2. Cmd+K：对当前选区或光标附近代码提出修改要求，预览差异后接受或拒绝。

Tab 补全、完整 IDE fork、账户计费和插件市场不属于第一阶段。

### 第二阶段：插件与 VS Code fork 并行

插件稳定后，从同一份扩展代码构建 Marketplace 插件与 fork 内置插件。公共能力继续依赖 VS Code 公共 API；仅 fork 可用的增强能力必须运行时探测并提供降级路径。

### 第三阶段：完整 WanLai IDE

当 fork 版本具备独立发行、升级与稳定性能力后，产品重心转向 VS Code fork 和内置插件。是否停止独立插件维护由届时的用户与发行数据决定，不预先添加兼容层。

## 架构边界

仓库采用轻量 monorepo，首期规划以下边界：

- `packages/extension`：VS Code 激活、命令、编辑器交互、Webview 宿主与配置入口。
- `packages/core`：与编辑器无关的会话、消息、Agent 协议和模型调用接口。
- `packages/ui`：Agent 面板与 Cmd+K 交互界面，不直接访问 Node.js 或 VS Code API。
- `assets/brand`：品牌源文件与可重复生成的派生资源。
- `docs`：设计、实施计划与公开开发文档。

扩展层通过明确接口调用 core；UI 通过类型化消息协议与扩展宿主通信。不得把 VS Code 对象传入 core，也不得让 Webview 直接持有密钥。

## 数据流

Agent 请求从 Webview 进入扩展宿主，扩展宿主收集经用户授权的工作区上下文并交给 core。core 产出流式事件，由扩展宿主转发给 UI；任何文件写入都由扩展宿主通过 VS Code WorkspaceEdit 执行。

Cmd+K 请求包含选区、文件语言、相邻上下文和用户指令。core 返回结构化编辑结果，扩展层转换为可预览差异；只有用户接受后才写入工作区。

## 错误与安全

- 模型、网络和工具错误必须转为可展示的结构化错误，不能导致扩展宿主崩溃。
- 默认不执行未确认的高风险命令，不读取工作区外文件。
- 日志不得包含 API Key、完整提示词中的敏感内容或未脱敏文件内容。
- 取消操作必须终止流式请求和后续工具调用。
- 首期不添加旧接口兼容层。

## 测试与验收

- core 使用单元测试覆盖会话状态、取消、错误转换与编辑结果解析。
- extension 使用 VS Code 集成测试覆盖激活、命令注册、选区读取和 WorkspaceEdit。
- UI 使用组件测试覆盖流式展示、错误状态与接受/拒绝差异。
- 端到端验收必须在真实 VS Code Extension Development Host 中完成 Agent 与 Cmd+K 两条链路。
- 所有派生图标必须由品牌 SVG 生成并进行尺寸与透明度检查。

## 首期成功标准

用户可以在真实项目中打开 Agent 面板并完成一次可取消的问答；可以选择代码、触发 Cmd+K、查看差异并明确接受或拒绝。插件在未使用任何 fork 私有 API 的情况下完成上述流程。
