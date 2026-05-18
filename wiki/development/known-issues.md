---
title: "已知问题与踩坑记录"
category: "development"
tags: ["development", "bugs", "react", "wechat", "launchd", "troubleshooting"]
created: "2026-05-18"
updated: "2026-05-18"
sources: ["issue.md"]
coverage: "high"
status: "active"
---

MiniAgent 开发过程中遇到的典型问题、根因和经验教训。来源于 issue.md 的历史记录。

## React 相关

### SyntheticEvent 闭包导致粘贴崩溃

**现象**：Settings 页面粘贴内容后白屏。

**根因**：`setForm(updater)` 的 updater 通过闭包捕获了 React SyntheticEvent，但 React 18 automatic batching 延迟执行 updater，此时 `e.currentTarget` 已被 nullify。

**修复**：在 updater 外部提取值：
```tsx
const value = e.currentTarget.value;
setForm((prev) => ({ ...prev, [f.key]: value }));
```

**教训**：错误信息 `Cannot read properties of null (reading 'value')` 已经指明了问题。正确做法是 grep `.value` 找所有可疑访问点，而不是凭直觉猜方向。

### 前端不发请求看不到历史消息

**现象**：刷新后页面空白。

**根因**：`enabled: !!sessionId` guard 在 localStorage 为空时完全不发请求，但服务端已有 fallback（不传 sessionId 时自动选择最近 session）。

**修复**：移除 `enabled` guard，新增 useEffect 从响应同步 `selectedSessionId`。

**教训**：先看浏览器 Network 面板确认请求是否发出，而不是只在服务端排查。

### 类型定义不完整导致功能丢失

**现象**：无法浏览历史 session。

**根因**：服务端返回了 `sessions` 数组和 `selectedSessionId`，但前端类型声明只包含 `messages` 和 `runStats`，忽略了其他字段。

**教训**：前端 snapshot 类型应完整匹配服务端返回结构，不要内联声明。

## 通道集成

### WeChat 消息收发不工作（三层问题叠加）

**现象**：微信扫码登录成功，但发消息无回复，DB 报 CHECK 约束失败。

**根因**：
1. DB migration 漏了 tasks 表的 source_type 约束
2. 保存 token 后 channel 不自动启动
3. QR status 请求缺 header + 超时
4. QR 码 URL 是 HTML 页面，不是图片

**修复**：
1. 新增 migration 扩展 source_type
2. ChannelRegistry 新增 `startChannel()` 方法
3. 后端加 `iLink-App-ClientVersion: 1` header + 35s timeout
4. 前端用 qrcode 库生成二维码

**教训**：微信 iLink Bot API 关键细节：
- `get_qrcode_status` 必须带 `iLink-App-ClientVersion: 1`
- `getupdates` 是 35s 长轮询，必须设超时
- `qrcode_img_content` 返回的是内嵌页面 URL，不是图片
- 扫码保存 token 后需主动触发 channel adapter 启动

## 运维部署

### macOS launchd 无法启动服务

**现象**：exit code 78 (EX_CONFIG)，手动运行正常。

**根因**：macOS TCC 保护阻止 launchd 访问 `~/Documents` 目录。

**修复**：项目从 `~/Documents/MiniAgent` 移至 `~/Projects/MiniAgent`。

**教训**：macOS 对 Documents/Downloads/Desktop 有额外 TCC 保护。launchd 作为系统服务受此限制。项目放 `~/Projects` 或其他非保护目录。排查 launchd 问题时用 `launchctl print gui/$(id -u)/<label>` 查详细状态。

---

## 资源导航

| 类型 | 链接/路径 | 说明 |
|------|----------|------|
| Issue 记录 | `issue.md` | 完整 bug 历史和细节 |
| 代码 | `src/client/App.tsx` | 前端 React 组件 |
| 代码 | `src/server/channels/wechat.ts` | WeChat channel |
| 相关 Wiki | [channels/wechat](../channels/wechat.md) | WeChat 集成详解 |
