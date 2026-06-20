@ARCHITECTURE.md

## 启动方式

API（7273）和前端（7272）由 **launchd 托管**（macOS 原生服务管理）：`RunAtLoad` 开机自启 + `KeepAlive` 崩溃自愈。

- `com.miniagent.api` → `scripts/start-api.sh`（tsx 跑源码），日志 `logs/api-out.log` / `api-error.log`
- `com.miniagent.web` → `scripts/start-web.sh`，日志 `logs/web-out.log` / `web-error.log`
- plist：`~/Library/LaunchAgents/com.miniagent.{api,web}.plist`

**禁止 `vite preview`（4173）**；前端 dev server 用 vite（7272）。启动时自动 migrate + 恢复 zombie run（`[Recovery]` 日志）。

### 管理（launchctl，gui 域）

```bash
DOMAIN=gui/$(id -u)

# 状态
launchctl print $DOMAIN/com.miniagent.api

# 重启 API —— 改 server.ts 后用这个（kill 无效：KeepAlive 会立即拉起旧进程，反而 EADDRINUSE）
launchctl kickstart -k $DOMAIN/com.miniagent.api

# 完全停用（停止 + 不再自启）
launchctl bootout $DOMAIN/com.miniagent.api

# 重新加载（改了 plist 后）
launchctl bootstrap $DOMAIN ~/Library/LaunchAgents/com.miniagent.api.plist
```

改 server.ts 后：`launchctl kickstart -k gui/$(id -u)/com.miniagent.api`（tsx 跑源码，无需 build）。API 端口改 plist 的 `MINIAGENT_API_PORT` 后 bootstrap 重载。

### 手动临时调试（须先卸载 launchd，否则抢端口 EADDRINUSE）

```bash
launchctl bootout gui/$(id -u)/com.miniagent.api
nohup npx tsx src/server/http/server.ts &   # 临时跑
# 调试完恢复托管
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.miniagent.api.plist
```

### 进程监控

`scripts/monitor-api.sh`（launchd `com.miniagent.monitor`，每 20s）探测 `/api/health`，连续 3 次失败经 lark-cli 私发告警（DOWN），恢复也通知（RECOVERED）。去抖阈值避免 launchd 重启瞬间的误报；状态文件去重避免刷屏。

```bash
# 状态
launchctl print gui/$(id -u)/com.miniagent.monitor
# 停止监控
launchctl bootout gui/$(id -u)/com.miniagent.monitor
# 重新加载（改脚本后）
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.miniagent.monitor.plist
```

告警发到 `MONITOR_OPEN_ID`（脚本内默认 open_id，可经 plist 的 env 覆盖）；探测 URL、去抖阈值均可经 env 覆盖。

## 项目规则

### 知识库（IMPORTANT）

- **全局 wiki 路径**：`/Users/zhiwei/wiki_workspace/wiki/miniagent/`
- **所有知识库操作必须走全局 wiki**，包括查询、写入、digest、lint
- 使用全局 skills：`/add-wiki`、`/digest`、`/ingest`、`/query`、`/lint`、`/refresh`
- MiniAgent 分类：architecture / channels / runtime / services / stores / development / qa
- **不再使用项目级 `wiki/` 目录**（已删除）

### Issue 追踪

- **Bug 记录位置**：`/Users/zhiwei/wiki_workspace/wiki/miniagent/qa/issue.md`
- 修复 bug 后，自动在该文件追记 ISSUE 记录
- 格式：`# ISSUE-NNN: 简短标题`，含 Status、Date、Component、Symptom、Root Cause、Fix、Lesson
- 编号递增：读取当前最大 ISSUE 编号，下一个 +1

### 知识库查询规则

- 查询 MiniAgent 相关知识时，使用 `/query` 在全局 wiki 中搜索
- 新增 MiniAgent 文档时，使用 `/add-wiki` 写入全局 wiki 的 miniagent 分类
- 对话消化使用 `/digest`，自动归档到全局 wiki
