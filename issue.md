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

---

# ISSUE-002: 页面刷新后看不到历史 web 消息

**Status:** Fixed
**Date:** 2026-05-16
**Component:** `src/client/App.tsx` — workspace polling

## Symptom

打开 `http://localhost:7272/`（新浏览器、无痕模式、或 localStorage 被清空后），页面显示空白，看不到任何历史对话。只有重新发消息后才能看到当前 session 的内容。

## Root Cause

```tsx
// BUG
const { data: snapshot } = useQuery({
  queryKey: ["workspace", sessionId],
  queryFn: async () => {
    const res = await fetch(`/api/workspace?sessionId=${sessionId}`);
    // ...
  },
  enabled: !!sessionId,   // ← sessionId 为 null 时完全不发请求
  refetchInterval: 3_000,
});
```

sessionId 仅通过 `localStorage.getItem("sessionId")` 持久化。当 localStorage 为空时，`sessionId` 为 `null`，`enabled: !!sessionId` 为 `false`，workspace query 永远不会执行。

服务端 `WorkspaceService.getSnapshot()` 已有 fallback 逻辑：当不传 sessionId 时自动选择最近更新的 session。但前端从未发出请求，所以这个 fallback 永远不会被触发。

## Fix

1. 移除 `enabled: !!sessionId`，始终发起请求
2. sessionId 为 null 时不传 query parameter，让服务端 fallback 到最近 session
3. 新增 `useEffect` 从响应的 `selectedSessionId` 同步回前端状态和 localStorage

```tsx
// FIXED
const { data: snapshot } = useQuery({
  queryKey: ["workspace", sessionId],
  queryFn: async () => {
    const qs = sessionId ? `?sessionId=${sessionId}` : "";
    const res = await fetch(`/api/workspace${qs}`);
    // ...
  },
  refetchInterval: 3_000,  // removed: enabled: !!sessionId
});

useEffect(() => {
  if (!sessionId && snapshot?.selectedSessionId) {
    setSessionId(snapshot.selectedSessionId);
    localStorage.setItem("sessionId", snapshot.selectedSessionId);
  }
}, [snapshot?.selectedSessionId, sessionId]);
```

## Lesson

调试时在 curl 层面验证了 API 和代理都正常，但问题其实在浏览器端——前端代码用 `enabled` guard 完全跳过了请求。应该先看浏览器 Network 面板确认请求是否发出，而不是只在服务端排查。

另外，前端 snapshot 类型只声明了 `{ messages, runStats }`，忽略了服务端返回的 `selectedSessionId` 和 `sessions` 列表。类型定义不完整导致 fallback 机制无法被前端利用。
