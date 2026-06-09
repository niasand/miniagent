# Goal: MiniAgent Design System — 统一组件库抽象与迁移

## Status: active
## Created: 2026-06-09 10:00
## Updated: 2026-06-09 10:00

## Objective
将当前项目中分散的 UI 组件、样式规范和交互模式抽象为统一的 Design System，沉淀为可复用、可维护的组件库。所有业务页面优先使用组件库提供的标准组件，消除重复实现、视觉不一致和交互错误。

## Verification
- 所有现有 ui/ 组件被实际使用（Button、Badge、Tabs 不再 unused）
- styles.css 减少 ≥40%（从 ~1950 行降至 <1200 行），重复 button/badge/input 样式移除
- app-shell.tsx 拆分后单文件 <300 行，子组件独立文件
- 视觉回归：核心页面（chat、channel、schedule、session）无功能异常
- 新增 review skill 可用于后续检查

## Constraints
- 不改变现有功能行为和交互逻辑
- 保持中文 UI 文本不变
- 保持 SSE 流式、无限滚动等核心交互正常
- 不引入新的 npm 依赖（使用已有的 Radix、CVA、Tailwind）
- 保持 light/dark 双主题支持

## Boundaries
- src/client/components/ — 组件拆分和新建
- src/client/styles.css — 样式精简和 token 整理
- src/client/lib/ — 共享工具和 hooks
- src/client/App.tsx — 状态和逻辑可能需要微调
- 不涉及 src/server/ 和 src/client/api/

## Iteration Policy
按依赖顺序执行：先补齐基础组件 → 再迁移业务组件 → 最后精简 CSS。每步验证视觉无异常。

## Blocked Stop Condition
report blocker + attempted paths + next input needed

---

## Current State — Inventory

### 技术栈
- React 19.2 + TypeScript + Vite 8
- Tailwind CSS v4 (@theme 指令)
- Radix UI (Tabs, Slot) + CVA + clsx + tailwind-merge
- lucide-react 图标

### 已有但 UNUSED 的 ui/ 组件
- Button (3 variants × 3 sizes, CVA) — 完全未使用
- Badge (5 tones) — 完全未使用
- Tabs (Radix wrapper) — 完全未使用

### God-components
- App.tsx: 913 行, 40+ useState, 15+ useQuery
- app-shell.tsx: 727 行, 含 MessageBubble/CopyButton/ChatHeader 内联

### 重复模式（6 类）
1. Copy 按钮: 3 处独立实现
2. Button 样式: 8 种 CSS class，未用 Button 组件
3. Status Badge: 3 套不同实现，未用 Badge 组件
4. Active/Selected 高亮: 8 处，参数略不同
5. Schedule 表单: 创建/编辑近乎重复
6. Input focus ring: 6 处重复

### styles.css: 1949 行，需精简

---

## Evidence Ledger

| # | Claim | Evidence | Status |
|---|-------|----------|--------|
| 1 | ui/ 组件全部 unused | Explore agent survey: Button/Badge/Tabs 无 import 引用 | confirmed |
| 2 | 8 种独立 button CSS class | styles.css: .primary-action, .secondary-action, .channel-config-btn, .channel-test-btn, .channel-form-cancel, .channel-form-save, .schedule-create-btn, .schedule-secondary-btn, .send-btn, .session-new-btn, .chat-scroll-btn | confirmed |
| 3 | Copy 按钮重复 3 处 | app-shell.tsx MessageBubble + CopyButton, channel-card.tsx | confirmed |
| 4 | Status badge 3 套 | .channel-status, .schedule-status pills, .provider-status-badge | confirmed |

## Iteration Log

| # | Time | Action | Result | Next |
|---|------|--------|--------|------|
| 1 | 10:00 | 全面 UI 层调研 | 完成 25 文件清单 + 6 类重复模式识别 | Plan 设计系统架构 |
