# Goal: 修复 MiniAgent Agent 会话记忆丢失问题

## Status: active
## Created: 2026-06-09 13:00
## Updated: 2026-06-09 13:00

## Objective
修复 MiniAgent 在各场景下 agent 对话记忆丢失/截断的问题，确保 Telegram/Feishu 用户获得完整的、连续的对话体验。

## Verification
- 每个 fix 项有具体的代码变更和测试验证
- Telegram 长回复不再被截断（outbox 内容完整）
- 连续对话能正确 resume（external_session_id 不丢失）
- context overflow 时有自动恢复机制
- 无功能回退

## Constraints
- 不改变现有 ACP 协议交互模式
- 不引入新依赖
- 保持 web/feishu/telegram 多通道兼容
- 每项修复独立可验证

## Boundaries
- src/server/runtime/acp/ — ACP 驱动和 JSON-RPC 层
- src/server/runtime/supervisor.ts — 运行时监控
- src/server/services/context.ts — 上下文管理
- src/server/stores/session-store.ts — session 持久化
- src/server/stores/context-budget-store.ts — 上下文预算

## Iteration Policy
按优先级从高到低执行，每项修复独立验证。

## Blocked Stop Condition
report blocker + attempted paths + next input needed

---

## Fix Checklist — 按优先级排序

### ✅ P0: session/prompt 超时导致回复截断
- **状态**: 已修复 (commit 6bead15)
- **根因**: `AcpJsonRpcConnection.sendRequest()` 对所有方法统一 30s 超时，`session/prompt` 需要等待整个 agent turn
- **修复**: `sendRequest` 增加可选 `timeoutMs` 参数，`sendPrompt` 使用 10 分钟超时
- **文件**: `src/server/runtime/acp/json-rpc.ts`, `src/server/runtime/acp/driver.ts`
- **验证**: 重启 API，Telegram 发长任务消息确认完整回复

### 🔲 P1: external_session_id 在 crash 前未持久化可能丢失
- **场景**: agent 进程在 `updateProtocolState` 回调之前 crash，`external_session_id` 未写入 DB，下次 run 回退到更早的 session 甚至创建新 session
- **根因**: `external_session_id` 只在 bootstrap 完成后写入（`driver.ts:299`），如果 bootstrap 中途失败则丢失
- **修复方案**: 在 `session/new` 或 `session/resume` 返回 sessionId 后**立即**同步写入 DB，不等到 `updateProtocolState` 回调
- **文件**: `src/server/runtime/acp/driver.ts` (bootstrap 方法)
- **影响**: 中 — 如果用户频繁遇到 crash，对话连续性会中断

### 🔲 P1: context overflow 无自动恢复机制
- **场景**: context token 到 95% overflow 后，后续 run 仍尝试 resume 同一个已爆的 session，反复失败
- **根因**: `classifyError` 标记为 `context_overflow` + `retryable: true`，但重试前没有触发 compact
- **修复方案**:
  1. 在 `handleExit` 中检测 `errorClass === "context_overflow"`
  2. 自动调用 `ContextService.compact()` 生成 ContextPack
  3. 将 session 状态设为 `compacting`
  4. 自动创建 resume task 带上 contextPackId
- **文件**: `src/server/runtime/supervisor.ts` (handleExit), `src/server/services/context.ts`
- **影响**: 高 — 没有 auto-compact，overflow 后需要人工干预

### 🔲 P2: context 预警（85% critical）时无自动 compact
- **场景**: context 逐步增长到 warning (70%) → critical (85%) 但没有提醒或自动处理
- **根因**: `context_budgets` 状态只记录，不触发任何动作
- **修复方案**:
  1. 在 `handleExit` 中，如果 run 成功完成，检查 context budget 状态
  2. 如果 `critical`（≥85%），自动触发 `ContextService.compact()`
  3. 通过 Outbox 通知用户 "上下文已自动压缩"
- **文件**: `src/server/runtime/supervisor.ts` (handleExit), `src/server/services/context.ts`
- **影响**: 中 — 提前 compact 可以避免 overflow，提升体验

### 🔲 P2: run crash 后 external_session_id 查询可能回退到过期 session
- **场景**: 最近 N 个 run 都 crash 了没有 external_session_id，`getLatestExternalSessionId` 回退到更早成功的 run，但那个 session 可能已被底层 agent 服务端过期
- **根因**: `getLatestExternalSessionId` 只看 `external_session_id IS NOT NULL`，不检查 session 是否仍然有效
- **修复方案**:
  1. 在 `session/resume` 返回错误时（session expired/invalid），清除该 run 的 `external_session_id`
  2. 回退到 `session/new` 创建全新 session
  3. 记录事件通知用户 "对话历史已重置"
- **文件**: `src/server/runtime/acp/driver.ts` (bootstrap), `src/server/runtime/supervisor.ts`
- **影响**: 中 — 偶发但用户体验差（resume 失败后没有 fallback）

### 🔲 P3: 没有对用户展示 context 使用状态
- **场景**: 用户不知道 context 快满了，agent 突然 overflow
- **根因**: `/context status` 命令存在但不主动推送
- **修复方案**:
  1. 在 context 达到 warning (70%) 时，在 agent 回复末尾附加 `⚠️ context: 72%` 提示
  2. 在 context 达到 critical (85%) 时，附加更强提示并建议用户发 `/compact`
  3. `formatStats` 已有 context 百分比展示，扩展到 warning 级别也显示
- **文件**: `src/server/runtime/supervisor.ts` (formatStats)
- **影响**: 低 — 改善用户体验

---

## Evidence Ledger

| # | Claim | Evidence | Status |
|---|-------|----------|--------|
| 1 | P0 已修复：session/prompt 超时改为 10min | json-rpc.ts sendRequest 增加 timeoutMs 参数；driver.ts PROMPT_TIMEOUT_MS = 600_000；tsc 类型检查通过 | confirmed |
| 2 | 根因分析：ACP request timed out: session/prompt | outbox 最近 run (run_019ea81e) status=failed, error=ACP request timed out, text_delta 只到"然后告诉" | confirmed |
| 3 | external_session_id 仅在 updateProtocolState 后持久化 | driver.ts:299 bootstrap 后回调 updateProtocolState | confirmed |
| 4 | context overflow 无自动 compact | supervisor.ts handleExit 不检查 errorClass 触发 compact | confirmed |

## Iteration Log

| # | Time | Action | Result | Next |
|---|------|--------|--------|------|
| 1 | 13:00 | P0 修复完成 | session/prompt 超时改为 10min，API 重启成功 | 验证 P0 → 继续 P1 |
