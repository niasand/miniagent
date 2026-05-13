# MiniAgent PRD

## 1. 产品定位

MiniAgent 是一个多 Agent 桥接与会话管理工具。它不重新实现 Agent 能力，而是复用 Codex CLI、Claude Code、Trae CLI 等原生 Agent，通过统一控制面把它们连接到 Web UI 和聊天渠道。

核心价值：

- 让多个 Agent 实例可以并行运行、独立会话、独立工作目录。
- 把 Agent 的输出、思考过程、工具调用和任务状态流式转发到用户常用 channel。
- 持久化会话、事件、日志、ContextPack 和记忆，方便回溯、归档、恢复和交接。

## 2. 目标

- 支持在本地启动和管理多个 Agent 会话。
- 支持方便接入多种 CLI Agent，MVP 必须同时跑通 Codex CLI、Claude Code、Trae CLI。
- 支持用户从 Web UI 或聊天 channel 与指定 Agent 对话。
- 支持 Agent 输出流式展示，包括 Markdown、工具调用、hook 状态和错误。
- 支持会话持久化、工作目录配置、关键日志记录和每日摘要归档。
- 支持上下文预算监控、自动压缩、ContextPack 恢复和 Agent handoff。
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

MVP 目标是跑通一条可恢复、可追溯的端到端主链路：

`飞书消息 / Web 输入 -> Command Router -> Session/Run State Machine -> RuntimeSupervisor -> AgentRuntimeAdapter -> EventStore -> Projector/Outbox -> Web UI / 飞书卡片`

MVP 包含：

- Agent：MVP 同时支持 Codex CLI、Claude Code、Trae CLI，并允许同一种 Agent 多实例运行。
- Channel：先支持飞书；QQ、Telegram、微信后续通过同一 adapter 接入。
- UI：精致的 React 控制台应用，包含会话列表、会话详情、实时输出、上下文状态、任务状态和清晰的空状态/错误状态。
- Runtime：统一 RuntimeSupervisor 管理进程生命周期，AgentRuntimeAdapter 只处理 CLI 差异。
- Event：所有 Agent 输出先写入 append-only EventStore，再由 Web、飞书、日志、ContextPack 等投影消费。
- Delivery：使用 Outbox 管理飞书卡片更新、Web 推送、重试、幂等和限流。
- Replay：`events.global_seq` 是 Projector、Web 重连、恢复扫描的唯一游标。
- Batching：RuntimeSupervisor 必须合并 stdout/stderr 小块，避免 SQLite 写入风暴和飞书 Outbox 风暴。
- Persistence：使用 better-sqlite3 保存 sessions、agent_runs、messages、events、tasks、outbox、context_packs、audit_logs。
- Context：监控每个会话的上下文预算，自动生成 ContextPack，并在上下文接近上限时压缩或重启续跑。
- Scheduler：支持创建、暂停、取消一次性任务和 cron 任务。
- Security：限制 workspace、审计远程命令、保护密钥和本地归档数据。

## 5. 核心概念

- `AgentRuntimeAdapter`：每种 CLI Agent 的适配器，负责命令探测、启动参数、输入编码、输出解析、错误分类和能力声明。
- `RuntimeSupervisor`：统一管理 Agent 进程生命周期，包括启动、输入、取消、超时、心跳、退出码、重启、stdout/stderr 解码和资源清理。
- `AgentProfile`：描述可用 Agent 类型、显示名、命令、能力声明、默认参数和健康状态。
- `Session`：长期会话容器，绑定 Agent 类型、工作目录、channel、默认参数、上下文状态和历史。
- `AgentRun`：一次具体 Agent 进程运行，归属一个 session，保存启动配置、状态、退出原因和事件范围。
- `Task`：一次触发来源，可以来自用户消息、Web 操作、cron、handoff 或 MCP 调用；Task 可以创建 AgentRun。
- `EventStore`：append-only 事件日志，是 UI、飞书、日志、ContextPack 和恢复的事实来源。
- `Outbox`：待投递消息队列，负责 Web 推送、飞书卡片更新、重试、幂等和失败记录。
- `Projector`：从 EventStore 消费事件，生成会话视图、飞书卡片 view model、日志索引或 ContextPack。
- `ChannelAdapter`：统一聊天渠道接口，负责接收用户消息和发送投递结果。
- `Renderer`：把事件或聚合状态转换为 channel-neutral view model，不直接调用外部平台。
- `Delivery`：把 view model 投递到 WebSocket、SSE、飞书卡片等目标，并处理平台限制。
- `ContextBudget`：记录会话上下文状态、估算 token、阈值、最近压缩时间和当前 ContextPack。
- `ContextPack`：可恢复的结构化上下文包，包含 summary、最近原文、关键文件、源事件范围和 schema_version。
- `Scheduler`：管理定时任务，并把触发结果路由到指定 session。
- `WorkspacePolicy`：限制 Agent 可访问或可启动的工作目录。
- `AuditLog`：记录远程命令、敏感操作、handoff、compact、进程启停和安全拒绝。

## 6. 系统架构

后端使用 Node.js + TypeScript + Hono + better-sqlite3。前端使用 Vite + React + TypeScript + Tailwind CSS 4 + shadcn/ui + TanStack Query。默认端口为 `7272`。

建议目录：

- `src/server/runtime/`：RuntimeSupervisor、进程状态机、stdout/stderr 解码、取消和重启策略。
- `src/server/runtime/adapters/`：`codex`、`claude`、`trae` 三个 MVP runtime adapter。
- `src/server/sessions/`：Session、AgentRun、Task 状态机和路由。
- `src/server/events/`：EventStore、Outbox、Projector 和事件查询。
- `src/server/channels/`：飞书、Telegram、QQ、微信 adapter。
- `src/server/delivery/`：Web 推送、飞书卡片投递、幂等、重试和限流。
- `src/server/context/`：上下文预算、ContextPack、压缩和恢复逻辑。
- `src/server/scheduler/`：cron 和一次性任务。
- `src/server/security/`：WorkspacePolicy、密钥加载、审计日志和危险操作确认。
- `src/server/renderers/`：Web 与飞书卡片 view model 渲染。
- `src/client/`：React UI、页面、组件、hooks 和前端状态。
- `src/shared/`：共享类型、事件协议、状态枚举和配置 schema。

## 7. 事件日志与 Outbox

EventStore 是运行期主干。任何 Agent 输出、状态变化、工具调用、错误、handoff、compact、delivery 结果都必须先写入 EventStore，再由 Projector 和 Delivery 消费。

事件基本字段：

- `global_seq`：全局递增 replay cursor，用于 Projector、Web 重连和恢复。
- `id`：全局唯一事件 ID。
- `session_id`：所属 Session。
- `run_id`：所属 AgentRun；非运行事件可为空。
- `task_id`：触发来源；系统事件可为空。
- `type`：如 `run_started`、`text_delta`、`tool_call`、`permission_prompt`、`context_pack_created`、`delivery_failed`、`run_finished`。
- `run_seq`：同一 run 内单调递增序号。
- `payload`：结构化 JSON。
- `created_at`：写入时间。

Replay 规则：

- Projector offset 只基于 `global_seq` 推进。
- Web UI 重连时传入最后看到的 `global_seq`，服务端按 session 拉取缺失事件。
- RuntimeSupervisor 只追加 EventStore，不直接生成消息投影或 Outbox 投递任务。
- Projector 异步消费 EventStore，生成 messages、ContextPack 输入和 Outbox 记录。

Outbox 规则：

- 所有飞书卡片更新、Web 推送和未来 channel 投递都通过 Outbox。
- 每条 outbox 记录必须有 `idempotency_key`，避免重启后重复投递。
- 状态包括 `pending`、`sending`、`sent`、`failed`、`dead`。
- worker 必须通过条件更新和 lease 抢占任务，禁止先查后改。
- 投递失败按指数退避重试；超过阈值进入 `dead`，但原始 Event 不丢。
- Web UI 重连时从 EventStore 按 `global_seq` 拉取缺失事件，而不是依赖内存流。

## 8. RuntimeSupervisor 与 Agent Adapter

AgentRuntimeAdapter 不直接拥有复杂生命周期。它只描述某个 CLI Agent 如何被启动和解析；RuntimeSupervisor 负责所有通用进程管理。

Adapter 接口职责：

- `probe()`：检查本机是否安装、版本是否可用、认证状态是否满足运行要求。
- `capabilities()`：声明结构化事件、原生 compact、resume、session export、权限提示、图片输入等能力。
- `createLaunchSpec(session, run)`：生成命令、参数、环境变量和工作目录。
- `encodeInput(input)`：把用户消息或任务指令转换为 CLI 输入。
- `decodeOutput(chunk)`：把 stdout/stderr 解析为统一 RuntimeEvent。
- `classifyError(error)`：把 CLI 错误归类为认证失败、权限等待、上下文溢出、进程崩溃、用户取消等。

RuntimeSupervisor 职责：

- 保证同一 Session 在 MVP 中最多一个 active AgentRun。
- 管理进程状态、心跳、超时、取消、退出码和资源清理。
- 处理 stdout/stderr 背压，避免大输出阻塞进程。
- 将 stdout/stderr 小块合并为语义明确的 RuntimeEvent，再写入 EventStore。
- 不在 RuntimeSupervisor 热路径中渲染 UI、生成 messages 或 enqueue Outbox。
- 在 overflow、crash 或 compact 后按策略重启或标记失败。

Batching 规则：

- `text_delta` 默认按 50-200ms 或固定字节上限合并，先到先写。
- 原始 chunk 级 stdout/stderr 默认不入库，只在 debug 模式保存。
- 飞书卡片更新由 Delivery 再做二次节流，不反向影响 EventStore 写入。

MVP 适配器：

- `CodexRuntimeAdapter`：接入 Codex CLI。
- `ClaudeRuntimeAdapter`：接入 Claude Code。
- `TraeRuntimeAdapter`：接入 Trae CLI。

验收重点是“三个都能成功接入”，不是三个 Agent 的能力完全一致。上层 UI、channel、scheduler 只能依赖统一事件协议和能力声明。

## 9. Session / Run / Task 状态机

Session 是长期容器，AgentRun 是一次进程运行，Task 是一次触发来源。三者必须分开，避免后期 cron、handoff、重启和并发运行互相污染。

Session 状态：

- `idle`：无 active run，可接收新输入。
- `running`：存在 active AgentRun。
- `compacting`：正在生成 ContextPack 或重启续跑。
- `failed`：最后一次 run 失败，需要用户处理或自动重试。
- `archived`：只读历史，不再接收新输入。

AgentRun 状态：

- `queued`、`starting`、`running`、`waiting_permission`、`compacting`、`stopping`、`succeeded`、`failed`、`cancelled`、`overflowed`。

Task 状态：

- `scheduled`、`queued`、`running`、`succeeded`、`failed`、`cancelled`、`paused`。

状态规则：

- MVP 中同一 Session 最多一个 active AgentRun。
- 一个 Task 可以创建一个 AgentRun；重试时创建新的 AgentRun，不覆盖旧 run。
- cron Task 默认复用指定 Session；如果 Session 正在运行，则按策略排队或拒绝。
- handoff 必须创建新的目标 Session，并保存 `source_session_id`、`source_context_pack_id` 和触发事件。
- 所有状态变更都写入 EventStore 和 AuditLog。

## 10. Agent 切换与交接

MiniAgent 支持在使用时方便切换 Agent，但切换应以会话为边界。MVP 不做同一个运行中进程的热切换，因为 Codex CLI、Claude Code、Trae CLI 的上下文、权限提示和历史格式不同。

三种模式：

- 新建会话选择 Agent：用户在 Web UI 新建会话时选择 `Codex CLI`、`Claude Code` 或 `Trae CLI`，并指定工作目录。该会话的 `agentType` 创建后固定。
- 默认 Agent：允许为用户、channel 或工作目录设置默认 Agent。飞书消息未指定 Agent 时，按 `user -> channel -> workspace -> system` 的优先级选择默认值。
- Handoff 交接：用户可以把当前会话交接给另一个 Agent。系统使用最新 ContextPack，带上最近消息、工作目录、当前任务状态和关键文件提示，然后创建一个新的目标 Agent 会话。原会话保留为只读历史或继续独立运行。

Web UI 入口：

- 新建会话弹窗提供 Agent selector、工作目录选择和默认参数。
- 会话详情页提供 `Handoff to Codex`、`Handoff to Claude`、`Handoff to Trae` 操作。
- 会话列表显示 Agent 图标、运行状态、工作目录和是否由 handoff 创建。

飞书命令：

- `/agent list`：查看可用 Agent、版本、健康状态。
- `/agent use codex|claude|trae`：设置当前用户或当前会话的默认 Agent。
- `/agent new codex|claude|trae [cwd]`：创建新会话。
- `/agent handoff codex|claude|trae`：把当前会话交接给目标 Agent。

## 11. 上下文预算与自动压缩

MiniAgent 必须把上下文管理作为核心能力。Agent CLI 的上下文窗口只视为当前运行窗口，不能作为唯一记忆源。所有原始消息、事件、工具调用、运行日志和 ContextPack 都必须持久化到 SQLite。

上下文状态：

- `healthy`：上下文预算充足，正常追加最近消息和必要历史。
- `warning`：接近上限，UI 和飞书提示，但不中断运行。
- `critical`：达到压缩阈值，自动生成 ContextPack。
- `overflow`：Agent 报错或无法继续写入上下文，停止当前进程并从 ContextPack 重启。

推荐阈值：

- 70%：进入 `warning`。
- 85%：后台生成新的 ContextPack。
- 95%：停止注入完整历史，只注入 ContextPack + 最近 N 条消息。

ContextPack 必须是结构化内容，至少包含：

- `schema_version`：ContextPack 结构版本。
- `source_event_range`：摘要覆盖的事件范围。
- `Goal`：当前任务目标。
- `Decisions`：已确认决策。
- `Constraints`：用户要求、技术约束、安全要求。
- `Current State`：当前进度和运行状态。
- `Open Tasks`：未完成事项。
- `Key Files / Artifacts`：关键文件、命令、日志和产物。
- `Recent Messages`：最近几轮原文或摘要。

执行策略：

- 如果 Agent adapter 声明支持原生 compact 或 resume，优先调用原生能力。
- 如果不支持原生 compact，由 MiniAgent 生成 ContextPack，并用新进程继续。
- Handoff 到另一个 Agent 时，传递最新 ContextPack、最近消息、工作目录、关键文件和未完成任务，不传全部原始历史。
- 原始历史永不删除；压缩只影响运行时注入给 Agent 的上下文。

用户入口：

- Web UI 显示上下文状态、估算 token、最近 ContextPack 时间，并提供 `Compact now`、`Restart from ContextPack`、`View raw history`。
- 飞书提示上下文接近上限、压缩成功或压缩失败，并允许 `/context compact` 和 `/context status`。

## 12. Rendering 与 Delivery

Renderer 和 Delivery 必须分开。Renderer 只生成 channel-neutral view model；Delivery 负责把 view model 投递到具体平台。

Renderer 职责：

- 聚合 EventStore 中的 text delta、工具调用、错误、状态和 ContextPack 信息。
- 生成 Web 会话视图、飞书卡片 view model、日志摘要 view model。
- 不直接调用飞书、WebSocket 或其他外部接口。

Delivery 职责：

- 从 Outbox 读取待投递记录。
- 对飞书卡片更新做节流、分片、幂等和重试。
- 对 Web UI 使用 SSE 或 WebSocket 推送；断线后允许按 `global_seq` 补拉。
- 记录每次投递结果到 EventStore 和 AuditLog。

Projector 与 Outbox 解耦规则：

- RuntimeSupervisor 只 append EventStore。
- Projector 按 `global_seq` 异步消费事件，生成会话视图、messages、ContextPack 输入和 Outbox 记录。
- Projector 推进 offset、写 projection、写 Outbox 必须在同一个短事务内完成。
- Delivery 只消费 Outbox，不读取 RuntimeSupervisor 内存状态。

## 13. SQLite 写入、Lease 与 Batching

MVP 使用 `better-sqlite3` 时必须显式配置写入策略。

启动 PRAGMA：

- `PRAGMA journal_mode=WAL`
- `PRAGMA foreign_keys=ON`
- `PRAGMA busy_timeout=5000`
- `PRAGMA synchronous=NORMAL`

写入策略：

- RuntimeSupervisor 热路径只做短事务：追加事件、更新 run/session 状态。
- Projector 异步生成 projection 和 Outbox，避免阻塞 Agent 输出。
- Outbox/Scheduler 使用 lease 字段和条件更新抢占工作，避免重复处理。
- 禁止在数据库事务里执行网络请求、飞书 API 调用或 Agent 进程 I/O。
- 如果多 Agent 并行导致写锁等待，优先引入单 writer queue，再考虑迁移数据库。

## 14. UI 体验与前端选型

MiniAgent 的 Web UI 应按高质量桌面控制台设计，而不是营销页。界面应克制、精致、信息密度高，适合长时间监控多个 Agent 会话。

体验要求：

- 首屏就是可操作工作台：左侧会话/任务导航，中间对话流，右侧运行状态、上下文状态、工具调用和关键事件。
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

## 15. 飞书卡片阶段

P0：

- 流式 Markdown 文本。
- Agent 运行中、完成、失败状态。
- 基础错误展示。
- 通过 Outbox 投递，支持幂等更新和失败重试。

P1：

- 工具调用追踪。
- hook 执行状态。
- 多段输出合并。
- 上下文状态和 compact 提示。

P2：

- 打字机速度控制。
- 多卡片拆分。
- 分享为图片。

## 16. MCP 与 Skills

MiniAgent 应提供控制工具，允许 Agent 或外部调用方操作会话和任务：

- 转发 Agent 消息到指定 channel。
- 创建、暂停、恢复、取消定时任务。
- 查询会话、run、task 状态和关键日志。
- 查询上下文状态、触发 compact、列出 ContextPack。
- 查询 EventStore 和 Outbox 投递状态。
- 调用 Agent 自身能力安装、卸载或列出 skills。

第一版只保留接口设计和最小可用工具，避免过早做完整插件市场。

## 17. 日志与记忆

日志分为三类：

- 事件日志：EventStore 记录每次 Agent 输出、工具调用、hook、错误和完成状态。
- 运行日志：记录进程启动、退出码、重试、channel 投递结果。
- 审计日志：记录远程命令、危险操作、handoff、compact、权限拒绝和密钥访问失败。

记忆系统：

- 每日保存原始聊天记录归档。
- 每日生成摘要，供后续会话参考。
- 保存 ContextPack，并保留它与原始消息、事件和 handoff 会话的链接。
- 支持配置全局记忆文件，并按 Agent 类型注入或软链接到工作目录。

## 18. 安全与权限边界

MVP 默认本地运行，但仍必须把安全边界做进架构。

- Workspace allowlist：Agent 只能在允许目录内启动；默认拒绝用户家目录外的未知路径。
- Secret handling：`.env`、API token、飞书 app secret、Telegram token、微信密钥不得写入日志、EventStore payload 或截图分享。
- Remote command audit：来自飞书的启动、停止、handoff、compact、cron 创建等操作必须写入 AuditLog。
- Dangerous operation confirm：删除数据、执行高风险 shell、修改全局配置等操作必须通过 Agent 或 MiniAgent 的确认流程。
- Data retention：原始历史、ContextPack 和审计日志默认本地保存；清理策略必须显式配置。
- Redaction：UI、飞书卡片和分享图片应对疑似密钥、token、cookie 做基础脱敏。

## 19. 配置

环境变量：

- `AGENT_NAME=miniagent`
- `TZ=Asia/Shanghai`
- `PORT=7272`
- `DATABASE_URL=./data/miniagent.db`
- `CONTEXT_WARNING_RATIO=0.70`
- `CONTEXT_COMPACT_RATIO=0.85`
- `CONTEXT_CRITICAL_RATIO=0.95`
- `WORKSPACE_ALLOWLIST=~/Documents,~/Projects`
- `OUTBOX_MAX_RETRIES=8`
- `SQLITE_BUSY_TIMEOUT_MS=5000`

原草稿中的 `AGENT_NAMW` 和 `Aisa/Shanghai` 应修正为以上拼写。

敏感信息如飞书 app secret、Telegram token、微信密钥只能放入本地 `.env`，不得提交到仓库。

## 20. 验收标准

MVP 完成时应满足：

- 可以在 Web UI 分别创建 Codex CLI、Claude Code、Trae CLI 会话并选择工作目录。
- 三个 Agent runtime adapter 都能通过 RuntimeSupervisor 完成 `probe -> start -> send -> stream events -> stop` 的成功路径。
- 可以设置默认 Agent，并通过 Web UI 或飞书命令 handoff 到另一个 Agent。
- 所有 Agent 输出先进入 EventStore，Web 和飞书可以在重启后从事件日志恢复展示。
- EventStore 使用 `global_seq` 支持 Projector replay 和 Web reconnect。
- 飞书卡片和 Web 推送通过 Outbox 投递，支持幂等、重试和失败可见。
- RuntimeSupervisor 写事件与 Projector/Outbox 生成解耦，流式输出有 batching 策略。
- SQLite 启用 WAL、foreign keys、busy timeout，并通过 lease 条件更新处理 Outbox/Scheduler 并发。
- 同一 Session 的 active AgentRun 并发规则明确，cron、handoff、重启不会覆盖旧 run。
- 会话上下文接近上限时可以自动生成 ContextPack，并从 ContextPack 继续运行或 handoff。
- 原始消息和事件在 compact 后仍可查询，不因压缩丢失历史。
- Web UI 达到可交付质量：布局稳定、主题一致、流式输出顺滑、错误/空状态完整。
- 可以从飞书给指定会话发消息。
- 三种 Agent 的输出都可以按统一事件协议流式显示在 Web UI 和飞书卡片中。
- 会话、消息、事件、任务、outbox、ContextPack 和 audit log 重启后仍可查询。
- 可以创建一个 cron 任务并看到执行日志。
- 核心逻辑有自动化测试，不依赖真实平台凭证。

## 21. 里程碑

1. 项目脚手架：Node/TypeScript、Hono、Vite、React、Tailwind CSS 4、shadcn/ui、SQLite、基础测试。
2. EventStore：定义 `global_seq` replay cursor、append-only 存储、事件批量写入和查询。
3. Projector + Outbox：异步消费事件，生成 projection、投递状态、幂等和重试。
4. Session/Run/Task 状态机：定义状态、并发规则、锁和状态迁移测试。
5. SQLite lease 与 batching：WAL、busy timeout、条件抢占、text_delta batching。
6. RuntimeSupervisor 契约：实现进程生命周期、stdout/stderr 解码、取消、超时、退出码和清理。
7. 三个 MVP 适配器：跑通 Codex CLI、Claude Code、Trae CLI 的成功接入路径。
8. Agent 切换与交接：支持新建会话选择 Agent、默认 Agent、handoff 新会话。
9. 上下文预算与 ContextPack：支持 token 估算、自动压缩、恢复和原始历史追溯。
10. Persistence：保存会话、run、task、事件、outbox、ContextPack、handoff 和 audit log。
11. 精致 Web UI：完成多会话工作台、流式输出、上下文状态、运行状态和基础动效。
12. 飞书 adapter：接收飞书消息并通过 Outbox 返回流式卡片。
13. Scheduler：支持一次性任务和 cron 任务。
14. 记忆归档：每日原始记录和摘要。
15. 扩展 Telegram、QQ、微信和更多 Agent runtime。

## 22. 主要风险

- EventStore 设计不稳会影响 UI、飞书、ContextPack、恢复和审计，需要优先实现并测试。
- 缺少 `global_seq` 会导致 replay、Projector offset 和 Web reconnect 变复杂。
- RuntimeSupervisor 如果直接生成 Outbox，会让 Agent 输出热路径被投递和渲染拖慢。
- 未做 batching 会导致 SQLite 写入风暴、DB 膨胀和飞书限流。
- Agent CLI 输出格式不稳定，需要用 adapter decode 层隔离变化。
- Codex CLI、Claude Code、Trae CLI 的交互模式、认证方式和输出协议不同，需要 adapter 层做能力探测和降级。
- RuntimeSupervisor 如果和 adapter 混在一起，会导致后续接入新 Agent 成本急剧升高。
- Agent handoff 的摘要可能丢失上下文，需要保存源会话链接，并允许用户打开原始历史追溯。
- 自动压缩可能遗漏关键约束，需要结构化 ContextPack、最近消息保留和手动查看原始历史兜底。
- 不同 Agent 的 token 统计能力不同，需要估算机制和 adapter 原生能力声明并存。
- 飞书卡片更新频率有限制，需要通过 Outbox 做节流、分片和失败重试。
- 多 Agent 并行运行可能带来进程泄漏，需要可靠的生命周期管理。
- 会话和归档数据可能包含敏感信息，需要默认本地存储、脱敏展示并避免误提交。
- 不同 channel 能力差异较大，adapter 接口要保持最小公共能力。
- UI 组件库如果无约束地二次封装，容易变成样式债；第一版应优先复用 shadcn/ui 原生组件。
