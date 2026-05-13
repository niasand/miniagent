# MiniAgent PRD

## 1. 产品定位

MiniAgent 是一个多 Agent 桥接与会话管理工具。它不重新实现 Agent 能力，而是复用 Codex CLI、Claude Code、Trae CLI 等原生 Agent，通过统一的控制面把它们连接到 Web UI 和聊天渠道。

核心价值：

- 让多个 Agent 实例可以并行运行、独立会话、独立工作目录。
- 把 Agent 的输出、思考过程、工具调用和任务状态流式转发到用户常用 channel。
- 持久化会话、日志和记忆，方便回溯、归档和继续工作。

## 2. 目标

- 支持在本地启动和管理多个 Agent 会话。
- 支持方便接入多种 CLI Agent，MVP 必须同时跑通 Codex CLI、Claude Code、Trae CLI。
- 支持用户从 Web UI 或聊天 channel 与指定 Agent 对话。
- 支持 Agent 输出流式展示，包括 Markdown、工具调用、hook 状态和错误。
- 支持会话持久化、工作目录配置、关键日志记录和每日摘要归档。
- 支持定时任务，允许在指定时间或 cron 表达式下触发 Agent 工作。

## 3. 非目标

第一版不做以下内容：

- 不自己实现大模型推理或 Agent 决策能力。
- 不做云端多租户、团队权限、计费系统。
- 不同时支持所有 channel；MVP 只实现飞书。
- 不支持任意未知 Agent 的零配置接入；新 Agent 需要实现明确的 runtime adapter。
- 不实现复杂工作流编排平台。
- 不依赖真实聊天平台凭证运行核心测试。

## 4. MVP 范围

MVP 目标是跑通一条端到端主链路：

`飞书消息 / Web 输入 -> MiniAgent -> Agent Runtime Adapter -> 流式事件 -> 飞书卡片 / Web UI -> SQLite 持久化`

MVP 包含：

- Agent：MVP 同时支持 Codex CLI、Claude Code、Trae CLI，并允许同一种 Agent 多实例运行。
- Channel：先支持飞书；QQ、Telegram、微信后续通过同一 adapter 接入。
- UI：精致的 React 控制台应用，包含会话列表、会话详情、实时输出、任务状态和清晰的空状态/错误状态。
- Persistence：使用 better-sqlite3 保存 sessions、messages、agent_runs、events、tasks。
- Context：监控每个会话的上下文预算，自动生成 checkpoint summary，并在上下文接近上限时压缩或重启续跑。
- Scheduler：支持创建、暂停、取消一次性任务和 cron 任务。
- Rendering：飞书卡片先支持流式 Markdown 和基础状态更新。

## 5. 核心概念

- `AgentRuntime`：封装 CLI Agent 的启动、输入、输出、退出状态和错误。
- `AgentRuntimeAdapter`：每种 Agent 的适配器，负责命令探测、进程启动、输入写入、输出解析、停止和健康检查。
- `Session`：一次独立对话，绑定 Agent 类型、工作目录、channel、状态和历史消息。
- `AgentProfile`：描述可用 Agent 类型、显示名、命令、能力声明、默认参数和健康状态。
- `ContextBudget`：记录会话上下文状态、估算 token、阈值和最近压缩时间。
- `Checkpoint`：一次可恢复的结构化上下文摘要，链接原始消息、事件、关键文件和未完成任务。
- `ChannelAdapter`：统一聊天渠道接口，负责接收用户消息和发送渲染结果。
- `EventStream`：统一事件流，事件类型包括 `text_delta`、`tool_call`、`hook_status`、`error`、`done`。
- `Renderer`：把事件流转换为 Web UI 消息或飞书卡片。
- `Scheduler`：管理定时任务，并把触发结果路由到指定 session。

## 6. 系统架构

后端使用 Node.js + TypeScript + Hono + better-sqlite3。前端使用 Vite + React + TypeScript + Tailwind CSS 4 + shadcn/ui + TanStack Query。默认端口为 `7272`。

建议目录：

- `src/server/runtime/`：AgentRuntime 实现。
- `src/server/runtime/adapters/`：`codex`、`claude`、`trae` 三个 MVP runtime adapter。
- `src/server/channels/`：飞书、Telegram、QQ、微信 adapter。
- `src/server/sessions/`：会话路由、状态机、消息持久化。
- `src/server/context/`：上下文预算、checkpoint、压缩和恢复逻辑。
- `src/server/scheduler/`：cron 和一次性任务。
- `src/server/renderers/`：Web 与飞书卡片渲染。
- `src/client/`：React UI、页面、组件、hooks 和前端状态。
- `src/shared/`：共享类型、事件协议和配置 schema。

## 7. Agent 接入契约

MVP 的 Agent 接入必须是可扩展机制，而不是为三个 CLI 写三套业务逻辑。所有 Agent 适配器必须实现同一接口：

- `probe()`：检查本机是否安装、版本是否可用、认证状态是否满足运行要求。
- `start(session)`：按指定工作目录、环境变量和启动参数创建 Agent 进程。
- `send(input)`：向 Agent 写入用户消息或任务指令。
- `events()`：把 stdout/stderr、工具调用、状态变化和错误转换为统一 `EventStream`。
- `stop(reason)`：终止进程并记录退出原因。

MVP 适配器：

- `CodexRuntimeAdapter`：接入 Codex CLI。
- `ClaudeRuntimeAdapter`：接入 Claude Code。
- `TraeRuntimeAdapter`：接入 Trae CLI。

验收重点是“三个都能成功接入”，不是三个 Agent 的能力完全一致。适配器必须暴露能力声明，例如是否支持结构化事件、工具调用追踪、会话恢复、原生 compact、session export、权限提示和图片输入。上层 UI、channel、scheduler 只能依赖统一事件协议和能力声明。

## 8. Agent 切换与交接

MiniAgent 支持在使用时方便切换 Agent，但切换应以会话为边界。MVP 不做同一个运行中进程的热切换，因为 Codex CLI、Claude Code、Trae CLI 的上下文、权限提示和历史格式不同。

三种模式：

- 新建会话选择 Agent：用户在 Web UI 新建会话时选择 `Codex CLI`、`Claude Code` 或 `Trae CLI`，并指定工作目录。该会话的 `agentType` 创建后固定。
- 默认 Agent：允许为用户、channel 或工作目录设置默认 Agent。飞书消息未指定 Agent 时，按 `user -> channel -> workspace -> system` 的优先级选择默认值。
- Handoff 交接：用户可以把当前会话交接给另一个 Agent。系统生成上下文摘要，带上最近消息、工作目录、当前任务状态和关键文件提示，然后创建一个新的目标 Agent 会话。原会话保留为只读历史或继续独立运行。

Web UI 入口：

- 新建会话弹窗提供 Agent selector、工作目录选择和默认参数。
- 会话详情页提供 `Handoff to Codex`、`Handoff to Claude`、`Handoff to Trae` 操作。
- 会话列表显示 Agent 图标、运行状态、工作目录和是否由 handoff 创建。

飞书命令：

- `/agent list`：查看可用 Agent、版本、健康状态。
- `/agent use codex|claude|trae`：设置当前用户或当前会话的默认 Agent。
- `/agent new codex|claude|trae [cwd]`：创建新会话。
- `/agent handoff codex|claude|trae`：把当前会话交接给目标 Agent。

## 9. 上下文预算与自动压缩

MiniAgent 必须把上下文管理作为核心能力。Agent CLI 的上下文窗口只视为当前运行窗口，不能作为唯一记忆源。所有原始消息、事件、工具调用、运行日志和 checkpoint 都必须持久化到 SQLite。

上下文状态：

- `healthy`：上下文预算充足，正常追加最近消息和必要历史。
- `warning`：接近上限，UI 和飞书提示，但不中断运行。
- `critical`：达到压缩阈值，自动生成 checkpoint summary。
- `overflow`：Agent 报错或无法继续写入上下文，停止当前进程并从 checkpoint 重启。

推荐阈值：

- 70%：进入 `warning`。
- 85%：后台生成新的 checkpoint summary。
- 95%：停止注入完整历史，只注入 checkpoint + 最近 N 条消息。

Checkpoint summary 必须是结构化内容，至少包含：

- `Goal`：当前任务目标。
- `Decisions`：已确认决策。
- `Constraints`：用户要求、技术约束、安全要求。
- `Current State`：当前进度和运行状态。
- `Open Tasks`：未完成事项。
- `Key Files / Artifacts`：关键文件、命令、日志和产物。
- `Recent Messages`：最近几轮对话摘要。

执行策略：

- 如果 Agent adapter 声明支持原生 compact 或 resume，优先调用原生能力。
- 如果不支持原生 compact，由 MiniAgent 生成 checkpoint summary，并用新进程继续。
- Handoff 到另一个 Agent 时，传递最新 checkpoint、最近消息、工作目录、关键文件和未完成任务，不传全部原始历史。
- 原始历史永不删除；压缩只影响运行时注入给 Agent 的上下文。

用户入口：

- Web UI 显示上下文状态、估算 token、最近 checkpoint 时间，并提供 `Compact now`、`Restart from checkpoint`、`View raw history`。
- 飞书提示上下文接近上限、压缩成功或压缩失败，并允许 `/context compact` 和 `/context status`。

## 10. UI 体验与前端选型

MiniAgent 的 Web UI 应按高质量桌面控制台设计，而不是营销页。界面应克制、精致、信息密度高，适合长时间监控多个 Agent 会话。

体验要求：

- 首屏就是可操作工作台：左侧会话/任务导航，中间对话流，右侧运行状态、工具调用和上下文信息。
- 支持浅色/深色主题，默认使用系统主题。
- 所有长文本、Markdown、工具调用和错误堆栈都必须可读、可折叠、可复制。
- 使用统一 spacing、radius、阴影、边框和状态色，避免临时手写样式。
- 动效只用于状态变化、流式输出、面板切换和反馈，不做干扰操作的装饰动画。

推荐前端库：

- `Vite`：开发服务器和构建工具。
- `React` + `TypeScript`：主 UI 框架和类型系统。
- `Tailwind CSS 4`：样式系统，优先使用 CSS 变量管理主题 token。
- `shadcn/ui`：组件基础，组件源码放入 `src/client/components/ui/` 后按项目风格定制。
- `lucide-react`：图标库。
- `TanStack Query`：管理 API 请求、缓存、刷新和错误状态。
- `Zustand`：仅用于少量客户端 UI 状态，如选中会话、面板展开、主题偏好。
- `react-markdown` + `remark-gfm`：渲染 Agent Markdown 输出。
- `motion`：用于少量高质量微动效。

第一版优先实现：`Sidebar`、`Tabs`、`Resizable Panels`、`Scroll Area`、`Tooltip`、`Command`、`Badge`、`Table`、`Dialog`、`Toast/Sonner`。不要一次性引入大型图表库，除非日志和任务指标需要。

## 11. 飞书卡片阶段

P0：

- 流式 Markdown 文本。
- Agent 运行中、完成、失败状态。
- 基础错误展示。

P1：

- 工具调用追踪。
- hook 执行状态。
- 多段输出合并。

P2：

- 打字机速度控制。
- 多卡片拆分。
- 分享为图片。

## 12. MCP 与 Skills

MiniAgent 应提供控制工具，允许 Agent 或外部调用方操作会话和任务：

- 转发 Agent 消息到指定 channel。
- 创建、暂停、恢复、取消定时任务。
- 查询会话状态和关键日志。
- 查询上下文状态、触发 compact、列出 checkpoint。
- 调用 Agent 自身能力安装、卸载或列出 skills。

第一版只保留接口设计和最小可用工具，避免过早做完整插件市场。

## 13. 日志与记忆

日志分为两类：

- 事件日志：记录每次 Agent 输出、工具调用、hook、错误和完成状态。
- 运行日志：记录进程启动、退出码、重试、channel 投递结果。

记忆系统：

- 每日保存原始聊天记录归档。
- 每日生成摘要，供后续会话参考。
- 保存 checkpoint summary，并保留它与原始消息、事件和 handoff 会话的链接。
- 支持配置全局记忆文件，并按 Agent 类型注入或软链接到工作目录。

## 14. 配置

环境变量：

- `AGENT_NAME=miniagent`
- `TZ=Asia/Shanghai`
- `PORT=7272`
- `DATABASE_URL=./data/miniagent.db`
- `CONTEXT_WARNING_RATIO=0.70`
- `CONTEXT_COMPACT_RATIO=0.85`
- `CONTEXT_CRITICAL_RATIO=0.95`

原草稿中的 `AGENT_NAMW` 和 `Aisa/Shanghai` 应修正为以上拼写。

敏感信息如飞书 app secret、Telegram token、微信密钥只能放入本地 `.env`，不得提交到仓库。

## 15. 验收标准

MVP 完成时应满足：

- 可以在 Web UI 分别创建 Codex CLI、Claude Code、Trae CLI 会话并选择工作目录。
- 三个 Agent runtime adapter 都能完成 `probe -> start -> send -> stream events -> stop` 的成功路径。
- 可以设置默认 Agent，并通过 Web UI 或飞书命令 handoff 到另一个 Agent。
- 会话上下文接近上限时可以自动生成 checkpoint，并从 checkpoint 继续运行或 handoff。
- 原始消息和事件在 compact 后仍可查询，不因压缩丢失历史。
- Web UI 达到可交付质量：布局稳定、主题一致、流式输出顺滑、错误/空状态完整。
- 可以从飞书给指定会话发消息。
- 三种 Agent 的输出都可以按统一事件协议流式显示在 Web UI 和飞书卡片中。
- 会话、消息、事件和任务重启后仍可查询。
- 可以创建一个 cron 任务并看到执行日志。
- 核心逻辑有自动化测试，不依赖真实平台凭证。

## 16. 里程碑

1. 项目脚手架：Node/TypeScript、Hono、Vite、React、Tailwind CSS 4、shadcn/ui、SQLite、基础测试。
2. AgentRuntime 契约：定义 adapter 接口、统一事件协议和能力声明。
3. 三个 MVP 适配器：跑通 Codex CLI、Claude Code、Trae CLI 的成功接入路径。
4. Session + Runtime Router：在 Web 中选择 Agent 类型并路由到对应 adapter。
5. Agent 切换与交接：支持新建会话选择 Agent、默认 Agent、handoff 新会话。
6. 上下文预算与 checkpoint：支持 token 估算、自动压缩、恢复和原始历史追溯。
7. Persistence：保存会话、消息、事件、运行记录、checkpoint 和 handoff 关系。
8. 精致 Web UI：完成多会话工作台、流式输出、上下文状态、运行状态和基础动效。
9. 飞书 adapter：接收飞书消息并返回流式卡片。
10. Scheduler：支持一次性任务和 cron 任务。
11. 记忆归档：每日原始记录和摘要。
12. 扩展 Telegram、QQ、微信和更多 Agent runtime。

## 17. 主要风险

- Agent CLI 输出格式不稳定，需要用事件解析层隔离变化。
- Codex CLI、Claude Code、Trae CLI 的交互模式、认证方式和输出协议不同，需要 adapter 层做能力探测和降级。
- Agent handoff 的摘要可能丢失上下文，需要保存源会话链接，并允许用户打开原始历史追溯。
- 自动压缩可能遗漏关键约束，需要结构化摘要、最近消息保留和手动查看原始历史兜底。
- 不同 Agent 的 token 统计能力不同，需要估算机制和 adapter 原生能力声明并存。
- 飞书卡片更新频率有限制，需要做节流和分片。
- 多 Agent 并行运行可能带来进程泄漏，需要可靠的生命周期管理。
- 会话和归档数据可能包含敏感信息，需要默认本地存储并避免误提交。
- 不同 channel 能力差异较大，adapter 接口要保持最小公共能力。
- UI 组件库如果无约束地二次封装，容易变成样式债；第一版应优先复用 shadcn/ui 原生组件。
