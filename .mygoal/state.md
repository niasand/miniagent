# Goal: 消息通道回复附带使用统计（新格式）

## Status: completed
## Created: 2026-05-26 15:00
## Updated: 2026-05-26 15:10

## Objective
MiniAgent 消息通道回复用户消息后，自动附带使用统计信息，格式为：
`⏱ 154.0s · in 51,798 / out 3,022 · $0.6577`

## Verification
- ✅ supervisor.ts 格式化输出符合新格式
- ✅ Cost 基于 token × agent 定价计算
- ✅ 全部 149 测试通过

## Constraints
- 不影响现有消息投递功能 ✅
- 兼容无 token 数据的场景（降级显示）✅
- Cost 计算使用合理默认定价，可扩展 ✅

## Boundaries
- src/server/runtime/supervisor.ts
- src/shared/pricing.ts（新增）

## Iteration Policy
follow evidence trail

## Blocked Stop Condition
report blocker + attempted paths + next input needed

---

## Evidence Ledger

| # | Claim | Evidence | Status |
|---|-------|----------|--------|
| 1 | 格式从 emoji 改为纯文本 | supervisor.ts:356-367 | confirmed |
| 2 | cost 按 agent 定价计算 | pricing.ts + supervisor.ts:364 | confirmed |
| 3 | 全量测试通过 | vitest: PASS (149) FAIL (0) | confirmed |

## Iteration Log

| # | Time | Action | Result | Next |
|---|------|--------|--------|------|
| 1 | 15:00 | 新增 pricing.ts | Claude $3/$15, Codex $2/$8, Trae free | - |
| 2 | 15:05 | 修改 supervisor.ts 格式化逻辑 | 格式匹配目标 | - |
| 3 | 15:08 | 运行全量测试 | 149 pass, 0 fail | complete |
