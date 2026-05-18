@ARCHITECTURE.md

## 项目规则

### Issue 追踪

- **Bug 记录位置**：`wiki/qa/issue.md`（不是根目录的 issue.md）
- 修复 bug 后，自动在 `wiki/qa/issue.md` 追加 ISSUE 记录
- 格式：`# ISSUE-NNN: 简短标题`，含 Status、Date、Component、Symptom、Root Cause、Fix、Lesson
- 编号递增：读取当前最大 ISSUE 编号，下一个 +1
- 根目录不再维护 `issue.md`，所有问题记录统一到 wiki

### 知识库

- 项目知识库在 `wiki/` 目录，使用 7 个分类：architecture / channels / runtime / services / stores / development / qa
- 知识库操作使用 skills：`/add_wiki`、`/digest`、`/ingest`、`/query`、`/lint`
