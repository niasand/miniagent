@ARCHITECTURE.md

## 项目规则

### Issue 追踪

- **Bug 记录位置**：全局 wiki `/Users/zhiwei/wiki_workspace/wiki/miniagent/qa/issue.md`
- 修复 bug 后，自动在全局 wiki 的 `miniagent/qa/issue.md` 追记 ISSUE 记录
- 格式：`# ISSUE-NNN: 简短标题`，含 Status、Date、Component、Symptom、Root Cause、Fix、Lesson
- 编号递增：读取当前最大 ISSUE 编号，下一个 +1

### 知识库

- 项目知识库已迁移至全局 wiki：`/Users/zhiwei/wiki_workspace/wiki/miniagent/`
- 使用 7 个分类：architecture / channels / runtime / services / stores / development / qa
- 知识库操作使用全局 skills：`/add-wiki`、`/digest`、`/ingest`、`/query`、`/lint`
- **不再使用项目级 `wiki/` 目录**，该目录已废弃
