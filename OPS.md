# MiniAgent 运维手册

## 服务管理（launchd）

```bash
# 启动服务
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.miniagent.api.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.miniagent.web.plist

# 停止服务
launchctl bootout gui/$(id -u)/com.miniagent.api
launchctl bootout gui/$(id -u)/com.miniagent.web

# 重启服务
launchctl kickstart -k gui/$(id -u)/com.miniagent.api
launchctl kickstart -k gui/$(id -u)/com.miniagent.web

# 查看状态（exit code 非 78 且无 penalty box = 正常）
launchctl list | grep miniagent
launchctl print gui/$(id -u)/com.miniagent.api
launchctl print gui/$(id -u)/com.miniagent.web

# 开机自启（plist 已配置 RunAtLoad + KeepAlive，登录自动启动）
```

## 端口

| 服务 | 端口 | 地址 |
|------|------|------|
| API | 7273 | http://127.0.0.1:7273 |
| Web | 4173 | http://127.0.0.1:4173 |

## 日志

```bash
tail -f ~/Documents/MiniAgent/logs/api-out.log
tail -f ~/Documents/MiniAgent/logs/api-error.log
tail -f ~/Documents/MiniAgent/logs/web-out.log
tail -f ~/Documents/MiniAgent/logs/web-error.log
```

## 文件清单

| 文件 | 用途 |
|------|------|
| `scripts/start-api.sh` | API 启动脚本 |
| `scripts/start-web.sh` | 前端启动脚本 |
| `~/Library/LaunchAgents/com.miniagent.api.plist` | API launchd 配置 |
| `~/Library/LaunchAgents/com.miniagent.web.plist` | Web launchd 配置 |

## 前端更新流程

```bash
cd ~/Documents/MiniAgent
npm run build
launchctl kickstart -k gui/$(id -u)/com.miniagent.web
```

## 健康检查

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:7273/api/workspace
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4173/
```

## 故障排查

### launchd penalty box

如果 `launchctl print` 显示 `penalty box`，说明服务反复崩溃被 macOS 限制了：
1. 检查脚本能否手动运行：`/bin/bash ~/Documents/MiniAgent/scripts/start-api.sh`
2. 检查日志文件权限和磁盘空间
3. 注销重新登录清除 penalty box 状态

### 端口被占用

```bash
lsof -i :7273 -i :4173
kill <PID>
launchctl kickstart -k gui/$(id -u)/com.miniagent.api
```
