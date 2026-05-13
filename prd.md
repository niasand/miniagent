# MiniAgent PRD

## 1. 产品定位

MiniAgent 是一个多 Agent 桥接与会话管理工具。它不重新实现 Agent 能力，而是复用 Codex、Claude Code 等原生 Agent，通过统一的控制面把它们连接到 Web UI 和聊天渠道。

核心价值：

- 让多个 Agent 实例可以并行运行、独立会话、独立工作目录。
- 把 Agent 的输出、思考过程、工具调用和任务状态流式转发到用户常用 channel。
- 持久化会话、日志和记忆，方便回溯、归档和继续工作。

## 2. 目标

- 支持在本地启动和管理多个 Agent 会话。
- 支持用户从 Web UI 或聊天 channel 与指定 Agent 对话。
- 支持 Agent 输出流式展示，包括 Markdown、工具调用、hook 状态和错误。
- 支持会话持久化、工作目录配置、关键日志记录和每日摘要归档。
- 支持定时任务，允许在指定时间或 cron 表达式下触发 Agent 工作。

## 3. 非目标

第一版不做以下内容：

- 不自己实现大模型推理或 Agent 决策能力。
- 不做云端多租户、团队权限、计费系统。
- 不同时支持所有 channel；MVP 只实现飞书。
- 不实现复杂工作流编排平台。
- 不依赖真实聊天平台凭证运行核心测试。

## 4. MVP 范围

MVP 目标是跑通一条端到端主链路：

`飞书消息 / Web 输入 -> MiniAgent -> Codex Runtime -> 流式事件 -> 飞书卡片 / Web UI -> SQLite 持久化`

MVP 包含：

- Agent：先支持 Codex，多实例运行；Claude Code 作为下一阶段扩展。
- Channel：先支持飞书；QQ、Telegram、微信后续通过同一 adapter 接入。
- UI：React 单页应用，包含会话列表、会话详情、实时输出和任务状态。
- Persistence：使用 better-sqlite3 保存 sessions、messages、agent_runs、events、tasks。
- Scheduler：支持创建、暂停、取消一次性任务和 cron 任务。
- Rendering：飞书卡片先支持流式 Markdown 和基础状态更新。

## 5. 核心概念

- `AgentRuntime`：封装 Codex / Claude Code 的启动、输入、输出、退出状态和错误。
- `Session`：一次独立对话，绑定 Agent 类型、工作目录、channel、状态和历史消息。
- `ChannelAdapter`：统一聊天渠道接口，负责接收用户消息和发送渲染结果。
- `EventStream`：统一事件流，事件类型包括 `text_delta`、`tool_call`、`hook_status`、`error`、`done`。
- `Renderer`：把事件流转换为 Web UI 消息或飞书卡片。
- `Scheduler`：管理定时任务，并把触发结果路由到指定 session。

## 6. 系统架构

后端使用 Node.js + TypeScript + Hono + better-sqlite3。前端使用 React + Tailwind CSS 4 + react-markdown。默认端口为 `7272`。

建议目录：

- `src/server/runtime/`：AgentRuntime 实现。
- `src/server/channels/`：飞书、Telegram、QQ、微信 adapter。
- `src/server/sessions/`：会话路由、状态机、消息持久化。
- `src/server/scheduler/`：cron 和一次性任务。
- `src/server/renderers/`：Web 与飞书卡片渲染。
- `src/client/`：React UI。
- `src/shared/`：共享类型、事件协议和配置 schema。

## 7. 飞书卡片阶段

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

## 8. MCP 与 Skills

MiniAgent 应提供控制工具，允许 Agent 或外部调用方操作会话和任务：

- 转发 Agent 消息到指定 channel。
- 创建、暂停、恢复、取消定时任务。
- 查询会话状态和关键日志。
- 调用 Agent 自身能力安装、卸载或列出 skills。

第一版只保留接口设计和最小可用工具，避免过早做完整插件市场。

## 9. 日志与记忆

日志分为两类：

- 事件日志：记录每次 Agent 输出、工具调用、hook、错误和完成状态。
- 运行日志：记录进程启动、退出码、重试、channel 投递结果。

记忆系统：

- 每日保存原始聊天记录归档。
- 每日生成摘要，供后续会话参考。
- 支持配置全局记忆文件，并按 Agent 类型注入或软链接到工作目录。

## 10. 配置

环境变量：

- `AGENT_NAME=miniagent`
- `TZ=Asia/Shanghai`
- `PORT=7272`
- `DATABASE_URL=./data/miniagent.db`

原草稿中的 `AGENT_NAMW` 和 `Aisa/Shanghai` 应修正为以上拼写。

敏感信息如飞书 app secret、Telegram token、微信密钥只能放入本地 `.env`，不得提交到仓库。

## 11. 验收标准

MVP 完成时应满足：

- 可以在 Web UI 创建 Codex 会话并选择工作目录。
- 可以从飞书给指定会话发消息。
- Codex 输出可以流式显示在 Web UI 和飞书卡片中。
- 会话、消息、事件和任务重启后仍可查询。
- 可以创建一个 cron 任务并看到执行日志。
- 核心逻辑有自动化测试，不依赖真实平台凭证。

## 12. 里程碑

1. 项目脚手架：Node/TypeScript、Hono、React、SQLite、基础测试。
2. Session + AgentRuntime：跑通 Web 输入到 Codex 输出。
3. Persistence：保存会话、消息、事件和运行记录。
4. 飞书 adapter：接收飞书消息并返回流式卡片。
5. Scheduler：支持一次性任务和 cron 任务。
6. 记忆归档：每日原始记录和摘要。
7. 扩展 Claude Code、Telegram、QQ、微信。

## 13. 主要风险

- Agent CLI 输出格式不稳定，需要用事件解析层隔离变化。
- 飞书卡片更新频率有限制，需要做节流和分片。
- 多 Agent 并行运行可能带来进程泄漏，需要可靠的生命周期管理。
- 会话和归档数据可能包含敏感信息，需要默认本地存储并避免误提交。
- 不同 channel 能力差异较大，adapter 接口要保持最小公共能力。
