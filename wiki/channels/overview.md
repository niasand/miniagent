---
title: "消息通道系统概览"
category: "channels"
tags: ["channels", "registry", "adapter", "feishu", "wechat", "telegram", "discord", "qq", "dingtalk", "wecom"]
created: "2026-05-18"
updated: "2026-05-18"
sources: ["src/server/channels/"]
coverage: "high"
status: "active"
---

MiniAgent 通过 ChannelAdapter 接口统一 7 个消息平台，ChannelRegistry 管理生命周期和消息去重，所有消息通过 `onMessage` 回调注入业务层。

## 核心接口

`ChannelAdapter` 是所有通道必须实现的契约：

| 方法 | 签名 | 说明 |
|------|------|------|
| `channelType` | `readonly string` | 通道标识符 |
| `start` | `(onMessage: (msg: ChannelMessage) => void) => Promise<void>` | 启动通道，注入消息回调 |
| `stop` | `() => void` | 停止通道 |
| `send` | `(targetRef: string, content: string) => Promise<SendResult>` | 发送消息 |
| `test?` | `() => Promise<TestResult>` | 可选：连接性检查 |

`ChannelMessage` 结构：

| 字段 | 类型 | 说明 |
|------|------|------|
| `messageId` | `string` | 通道侧消息 ID |
| `chatId` | `string` | 编码了路由信息的不透明引用（如 `"wechat:userId"`、`"p2p:chatId"`） |
| `userId` | `string` | 发送者 ID |
| `text` | `string` | 消息文本 |
| `chatType` | `"private" \| "group"` | 会话类型 |
| `isMentioned?` | `boolean` | 是否被 @ |

## ChannelRegistry

管理所有通道实例的生命周期。源文件：`src/server/channels/registry.ts`

| 方法 | 功能 |
|------|------|
| `constructor(db, onMessage)` | 接收 SQLite db + 业务层消息处理器 |
| `startAll()` | 从 ChannelConfigStore 加载配置，启动所有已配置通道（跳过 "web"） |
| `startChannel(id, config)` | 创建适配器 → 可选 test → start。失败时停止并回滚 |
| `stopAll()` | 停止所有适配器，清空 Map |
| `get(channelType)` | 返回活跃适配器 |
| `testChannel(id)` | 创建临时适配器测试连接，不启动 |

**消息去重**（注册表级别，所有通道共享）：
- Key: `"${channelType}:${messageId}"`
- TTL: 30 分钟，最大 1000 条
- 逐出策略：先清过期；仍满则清最旧一半

**适配器工厂**：

| channelId | 类 |
|-----------|-----|
| `feishu` | `FeishuChannel` |
| `telegram` | `TelegramChannel` |
| `discord` | `DiscordChannel` |
| `qq` | `QQChannel` |
| `wechat` | `WeChatChannel` |
| `wecom` | `WeComChannel` |
| `dingtalk` | `DingTalkChannel` |

## 通道实现

### Feishu（WebSocket）

- **协议**：Lark SDK `WSClient`（实时）+ REST `Client`（发送/回填）
- **接收**：WebSocket 推送 `im.message.receive_v1` 事件
- **chatId 编码**：`"p2p:${chatId}"` 或 `"group:${chatId}"`
- **回填**：每 5 分钟检查，空闲超 5 分钟则拉取已知聊天的历史消息
- **发送**：`larkClient.im.v1.message.create()`，text 格式

### Telegram（长轮询）

- **协议**：Bot API HTTP 长轮询
- **接收**：`GET /getUpdates?offset=X&timeout=30`（30s 轮询，可 Abort）
- **chatId 编码**：`"${chat.type}:${chat.id}"`
- **发送**：Markdown → Telegram HTML 转换，HTML 解析失败则 fallback 纯文本（3 次重试）
- **限流**：处理 429 + `retry_after`

### WeChat iLink（长轮询）

- **协议**：iLink Bot API HTTP 长轮询
- **接收**：`POST /ilink/bot/getupdates`（40s 超时），支持文本和语音转文字
- **chatId 编码**：`"wechat:${userId}"`（仅 1:1 私聊）
- **发送**：需要 `context_token`（每个用户，从入站消息缓存），超过 2000 字符自动分片
- **关键细节**：`get_qrcode_status` 必须带 `iLink-App-ClientVersion: 1` header
- **错误**：`errcode === -14` 表示会话过期，永久停止轮询

## 通用模式

**所有通道共享**：
- 构造函数接收 `Record<string, string>` 配置（从 SQLite 加载）
- `start()` 接收 `onMessage` 回调，不直接耦合业务逻辑
- `chatId` 是不透明字符串，`send()` 内部解码

**轮询通道**（WeChat、Telegram、QQ）：
- `while (!stopped)` 循环 + 指数退避（最大 30s）
- 长轮询超时 30-40s
- `stop()` 设置 flag + AbortController

**WebSocket 通道**（Feishu、Discord）：
- SDK 管理连接和重连
- 额外的回填/补偿机制

---

## 资源导航

| 类型 | 链接/路径 | 说明 |
|------|----------|------|
| 代码 | `src/server/channels/types.ts` | ChannelAdapter 接口定义 |
| 代码 | `src/server/channels/registry.ts` | 通道注册表 |
| 代码 | `src/server/channels/feishu.ts` | Feishu 通道 |
| 代码 | `src/server/channels/wechat.ts` | WeChat 通道 |
| 代码 | `src/server/channels/telegram.ts` | Telegram 通道 |
| 代码 | `src/server/stores/channel-config-store.ts` | 通道配置存储 |
| 相关 Wiki | [known-issues](../development/known-issues.md) | WeChat 踩坑记录 |
