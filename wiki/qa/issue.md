---
title: "Bug 与问题追踪"
category: "qa"
tags: ["qa", "bugs", "issues", "tracking"]
created: "2026-05-18"
updated: "2026-05-18"
sources: []
coverage: "high"
status: "active"
---

MiniAgent 的 Bug 追踪记录。每次修复 bug 后自动追加到此文件。

**格式**：`# ISSUE-NNN: 简短标题`，含状态、日期、组件、现象、根因、修复方案、涉及文件、经验教训。

---

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

---

# ISSUE-003: 无法查看和切换历史 session 消息

**Status:** Fixed
**Date:** 2026-05-17
**Component:** `src/client/App.tsx` — session list UI

## Symptom

打开 MiniAgent 页面后只能看到当前 session（localStorage 记住的）的消息，无法浏览或切换到其他 session 查看历史消息。页面没有任何 session 列表入口。

## Root Cause

服务端 `/api/workspace` 已返回完整的 `sessions` 数组（29 个 session），`WorkspaceSnapshot` 类型也定义了 `sessions: WorkspaceSessionSummary[]`。但前端只使用了 `messages` 和 `runStats`，完全没有渲染 `snapshot.sessions`。

具体缺失：
1. `DrawerTab` 类型只有 `"skills" | "channels"`，无 session 相关 tab
2. 底部操作栏没有 History 入口按钮
3. 没有 session 列表组件和切换逻辑（`setSessionId` + `localStorage.setItem`）
4. workspace query 的类型声明是内联的 `{ selectedSessionId, messages, runStats }`，缺少 `sessions` 字段

## Fix

1. 在左侧 drawer 新增 "History" tab（`DrawerTab` 加 `"sessions"`）
2. 渲染 `snapshot.sessions` 列表，显示 title + status dot
3. 点击 session 项切换 `sessionId` 并刷新 workspace query
4. 底部栏加 History 按钮入口
5. workspace query 类型改用 `WorkspaceSnapshot`（从 `../shared/workspace.js` 导入），不再内联声明

涉及文件：`src/client/App.tsx`、`src/client/styles.css`

## Lesson

ISSUE-002 修复了"刷新后看不到消息"（前端不发请求），这次是同一个数据链路的下一环——数据到了前端但没渲染。两层的根因都是前端没完整利用服务端已返回的数据。下次遇到"看不到数据"的问题，应该先确认数据是否已到前端（console.log snapshot），再排查渲染层。

---

# ISSUE-004: macOS launchd 无法启动 MiniAgent 服务

**Status:** Fixed
**Date:** 2026-05-17
**Component:** `~/Library/LaunchAgents/com.miniagent.*.plist`

## Symptom

`launchctl list` 显示 `com.miniagent.api` 和 `com.miniagent.web` 持续 exit code 78 (EX_CONFIG)，服务无法启动。手动运行 `scripts/start-api.sh` 却完全正常。

## Root Cause

macOS 隐私安全策略阻止 launchd 访问 `~/Documents` 目录。手动测试确认：

```
/bin/bash: /Users/zhiwei/Documents/MiniAgent/scripts/start-api.sh: Operation not permitted
```

launchd 进程没有 Full Disk Access 权限，无法执行 Documents 下的脚本。同时 `com.miniagent.web.plist` 第 13 行有 XML 标签不匹配（`<string>` 开头 `</key>` 结尾）。

## Fix

1. 项目从 `~/Documents/MiniAgent` 移至 `~/Projects/MiniAgent`
2. 更新 4 个文件的路径：`scripts/start-api.sh`、`scripts/start-web.sh`、两个 plist
3. 修复 web plist 的 XML 标签错误

## Lesson

macOS 对 Documents/Downloads/Desktop 有额外的 TCC (Transparency, Consent, and Control) 保护。launchd 作为系统服务受此限制。项目放在 `~/Projects` 或其他非保护目录可避免。排查 launchd 问题时，`launchctl print gui/$(id -u)/<label>` 查看详细状态，`last exit code = 78: EX_CONFIG` 是线索。

---

# ISSUE-005: WeChat channel 消息收发不工作

**Status:** Fixed
**Date:** 2026-05-18
**Component:** `src/server/channels/wechat.ts`、`src/server/db/migrations/`

## Symptom

微信扫码登录成功后，WeChat channel 启动正常（`[Channel] wechat started`），但：
1. 发消息无回复
2. 收到的消息报 `CHECK constraint failed: source_type IN (...)` — DB 不包含 'wechat'
3. 即使 DB 修复后，token 保存后 channel 不自动启动

## Root Cause

三层问题叠加：

1. **DB CHECK 约束缺 wechat** — migration 0002 改了 sessions/outbox/audit_logs 的 channel_type 约束，但漏了 tasks 表的 source_type 约束
2. **保存配置后不启动 channel** — `ChannelRegistry.startAll()` 只在服务启动时执行，扫码保存 token 后 channel adapter 不会自动加载
3. **get_qrcode_status 缺少 header** — 需要带 `iLink-App-ClientVersion: 1` 和 35s 超时
4. **QR 码 URL 不是图片** — 微信返回的 `qrcode_img_content` 是 HTML 页面链接（`liteapp.weixin.qq.com`），需要用 qrcode 库在前端生成二维码

## Fix

1. 新增 migration `0003_extend_source_type.sql`，tasks 表 source_type 加 wechat/wecom/dingtalk
2. `ChannelRegistry` 新增 `startChannel()` 方法，`PUT /api/channels/:channelId/config` 保存后自动启动
3. 后端 QR status 代理加 `iLink-App-ClientVersion: 1` header + 35s timeout
4. 前端用 `qrcode` npm 包把 URL 编码为二维码图片
5. `SourceType` 类型扩展加上 wechat/wecom/dingtalk
6. wechat.ts 加 `AbortSignal.timeout(40s)` 防止长轮询永远挂起

涉及文件：`src/server/channels/registry.ts`、`src/server/channels/wechat.ts`、`src/server/http/app.ts`、`src/server/stores/session-store.ts`、`src/client/App.tsx`、`src/client/api/channels.ts`、`src/client/styles.css`

## Lesson

微信 iLink Bot API 的关键细节：
- `get_qrcode_status` 必须带 `iLink-App-ClientVersion: 1` header
- `getupdates` 是 35 秒长轮询，必须设超时（否则 Node.js fetch 永远挂起）
- `qrcode_img_content` 返回的是微信内嵌页面 URL，不是图片，需要前端自行生成 QR 码
- 多个消费者用空 `get_updates_buf` 调 getupdates 会互相竞争游标
- 扫码保存 token 后需要主动触发 channel adapter 启动，不能依赖服务重启

---

# ISSUE-006: 刷新后点击 scroll-to-top 会自动弹回底部

**Status:** Fixed
**Date:** 2026-05-18
**Component:** `src/client/App.tsx` — chat scroll auto-scroll logic

## Symptom

页面刷新后，点击向上箭头（scroll-to-top）按钮，页面先滚动到最顶部，然后立刻又自动滑回最底部。

## Root Cause

`useLayoutEffect` 的 auto-scroll 逻辑中，`requestAnimationFrame` 无条件执行 `scrollMessagesToBottom`：

```tsx
// BUG: 无论 shouldSnapToBottom 是否为 true，RAF 都会滚动到底部
const frame = requestAnimationFrame(() => {
  scrollMessagesToBottom(shouldSnapToBottom ? "auto" : "smooth");
  if (shouldSnapToBottom) setSettledMessagesSessionKey(messagesSessionKey);
});
```

刷新后的时序：
1. 首次 effect 触发：`shouldSnapToBottom = true`（初始加载），滚动到底部，`setState` 触发重渲染
2. 二次 effect 触发：`shouldSnapToBottom = false`（已 settled），但 RAF 仍执行 `scrollMessagesToBottom("smooth")`
3. 用户点击 scroll-to-top，滚动到顶部
4. 若此时 messages 批次加载导致 `messages.length` 变化，effect 再次触发，RAF 再次将页面弹回底部

另外 `streamingText` 的 effect 也无条件滚动到底部，会在用户向上浏览历史消息时被强制拉回。

## Fix

1. **RAF 只在 `shouldSnapToBottom` 时执行**：将 RAF 和 setTimeout 移入 `if (shouldSnapToBottom)` 块内，不再对已 settled 的 session 做额外滚动
2. **新增 `isNearBottomRef`**：追踪用户是否在底部附近（80px 阈值）
3. **scroll 事件监听**：通过 passive scroll listener 实时更新 `isNearBottomRef`
4. **`scrollMessagesToTop` 标记离开底部**：手动滚动到顶部时设 `isNearBottomRef = false`
5. **`streamingText` 效果加守卫**：只在 `isNearBottomRef.current === true` 时自动滚动

涉及文件：`src/client/App.tsx`

## Lesson

React 的 `useLayoutEffect` 中使用 `requestAnimationFrame` 做异步操作时，cleanup 函数可能无法及时取消已排队的回调。正确做法是让异步操作本身带条件守卫，而不是依赖 cleanup 取消。另外，任何"自动滚动到底部"的逻辑都必须检查用户是否主动离开了底部，否则会与手动滚动操作冲突。
