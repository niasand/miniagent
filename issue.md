# ISSUE-001: Channel config input paste causes React crash

**Status:** Fixed
**Date:** 2026-05-15
**Component:** `src/client/App.tsx` — ChannelCard

## Symptom

Settings 页面点击 QQ Bot Configure 打开配置表单，按 Cmd+V 粘贴内容后页面白屏。

## Root Cause

```tsx
// BUG
onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.currentTarget.value }))}
```

`setForm(updaterFn)` 的 updater 函数不会立即执行——React 18 automatic batching 会延迟执行。updater 函数通过闭包捕获了 `e`（React SyntheticEvent），但 React 在事件处理完后会 nullify `e.currentTarget`。当 updater 真正执行时，`e.currentTarget` 已是 `null`，访问 `null.value` 抛 TypeError。

粘贴比普通按键更容易触发，因为粘贴数据量大、事件处理链更长，更容易命中延迟执行的时序窗口。

## Fix

在 updater 外部提取值，避免闭包中访问已回收的事件属性：

```tsx
// FIXED
onChange={(e) => {
  const value = e.currentTarget.value;
  setForm((prev) => ({ ...prev, [f.key]: value }));
}}
```

Commit: `Fix crash on paste in channel config — capture value before updater`

## Lesson

错误信息 `Cannot read properties of null (reading 'value')` 已经指明了问题。但调试过程中走了三次弯路：

1. **误判为 SSE 服务端崩溃** — 加了 controller.enqueue try-catch
2. **误判为 SSE 连接泄漏** — 加了 stopped flag
3. **误判为 React state 时序** — 加了 ErrorBoundary

正确做法：拿到错误信息后立刻 `grep '\.value'` 找所有可疑访问点，逐一排查哪个宿主对象可能为 null，结合 stack trace 定位。而不是凭直觉猜方向。
