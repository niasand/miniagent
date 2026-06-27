---
name: design-review
description: "Review code changes against the MiniAgent Design System rules. 仅限 MiniAgent 项目（含 src/client/ + ui/ 组件体系）。触发词：design review、组件审查、design system check、design-review。"
---

# Design System Review

## 适用性守卫（最先执行）

本 skill 仅适用于 MiniAgent 项目。执行前确认当前工作目录满足以下任一，否则停止并告知用户"design-review 仅限 MiniAgent 项目，当前目录不适用"：
- cwd 路径包含 `MiniAgent`
- 存在 `src/client/ui/button.tsx`

Review code changes in `src/client/` for compliance with the MiniAgent Design System.

## Checklist

Run each check against the changed files. Report violations with file:line references.

### 1. Button Components
- **RULE**: All interactive buttons MUST use `<Button variant="...">` from `ui/button.tsx`
- **VIOLATION**: Any `<button>` element with CSS classes like `primary-action`, `secondary-action`, `schedule-create-btn`, `channel-config-btn`, `send-btn`, `session-new-btn`, etc.
- **ALLOWED**: `<button>` is OK only for: `nav-item`, `segmented-btn`, `session-action`, `session-edit-btn`, `session-select`, `context-item`, `schedule-item` (these have complex CSS states not yet migrated)

### 2. Status Badges
- **RULE**: All status indicators MUST use `<Badge tone="..." shape="...">` from `ui/badge.tsx`
- **VIOLATION**: Any `<span>` with CSS classes like `schedule-status--*`, `session-status--*`, `channel-status--*`, `provider-status-badge--*`, `channel-test-ok/fail`
- **TONE MAP**: success=green, warning=amber, error=red, info=blue, violet=purple, muted=gray

### 3. Form Inputs
- **RULE**: All form inputs/textareas SHOULD use `<Input>` / `<Textarea>` from `ui/input.tsx`
- **VIOLATION**: Raw `<input>` or `<textarea>` with hand-coded focus ring styles
- **ALLOWED**: `side-search-input` (ghost variant), `timezone-trigger` (custom select), `chat-input` (has unique resize behavior)

### 4. Copy Operations
- **RULE**: All clipboard copy operations MUST use `<CopyButton>` from `ui/copy-button.tsx` or `useCopy()` hook
- **VIOLATION**: Inline `navigator.clipboard.writeText()` + `useState(false)` + `setTimeout` pattern

### 5. Color Tokens
- **RULE**: All colors MUST use `@theme` CSS custom properties (`var(--color-*)`) or Tailwind utility classes
- **VIOLATION**: Hardcoded hex colors in inline styles or new CSS rules (except in badge/button CVA variant definitions)

### 6. Dark Mode
- **RULE**: All new UI MUST work in both light and dark mode
- **VIOLATION**: Colors that only look correct in one mode, missing `@media (prefers-color-scheme: dark)` overrides

### 7. Component Colocation
- **RULE**: New domain/section components go in `sections/`; new primitives go in `ui/`; chat-related in `chat/`
- **VIOLATION**: Defining sub-components inline in `app-shell.tsx` or `App.tsx`

### 8. File Size
- **RULE**: No single component file should exceed 300 lines. If approaching this, split into sub-components.
- **WARNING**: Files over 200 lines get a warning.

## Output Format

```
## Design System Review Results

### Pass: X/Y checks

### Violations
- [CHECK NAME]: file:line — description

### Warnings
- file:line — suggestion

### Summary
One-line verdict: PASS / PASS WITH WARNINGS / FAIL
```
