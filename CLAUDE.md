@ARCHITECTURE.md

## 启动方式

两个进程：API（端口 7273）+ 前端 dev server（端口 7272）。**禁止使用 `vite preview`（4173）**。

```bash
# 首次或 schema 变更后先执行
npm run db:migrate

# 启动 API
nohup npx tsx src/server/http/server.ts > /tmp/miniagent-api.log 2>&1 &

# 启动前端
nohup npx vite --host 127.0.0.1 > /tmp/miniagent-web.log 2>&1 &
```

- 前端访问：http://127.0.0.1:7272
- API 端口可通过 `MINIAGENT_API_PORT` 环境变量覆盖

### 重启

```bash
kill $(lsof -ti :7273) 2>/dev/null
kill $(lsof -ti :7272) 2>/dev/null

# 重新启动（同上）
nohup npx tsx src/server/http/server.ts > /tmp/miniagent-api.log 2>&1 &
nohup npx vite --host 127.0.0.1 > /tmp/miniagent-web.log 2>&1 &
```

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
