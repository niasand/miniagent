---
name: ingest
description: |
  从原始资料（外部文档、代码分析、网页 URL）编译知识到多个 wiki 页面。
  与 add_wiki 的区别：add_wiki 围绕一个主题创建/更新单个页面，ingest 从一个资料源级联更新多个相关页面。
  触发词："ingest"、"编译"、"导入资料"、"从这个文档更新知识库"、"/ingest"。
  适用于：用户获得一个内容丰富的资料源（ARCHITECTURE.md、外部文档、代码分析结果），
  希望一次性将其中的知识分发到知识库的多个相关页面中。
---

# /ingest — 原始资料编译

从一个原始资料源，级联更新知识库中的多个 wiki 页面。

## 与其他技能的关系

| 技能 | 输入 | 输出 | 场景 |
|------|------|------|------|
| `/add_wiki` | 一个主题 | 单个 wiki 页面 | 主动围绕主题创建文档 |
| `/digest` | 当前对话 | 单个 wiki 页面 | 实战经验沉淀 |
| `/ingest` | 一个原始资料 | **多个** wiki 页面 | 从丰富资料编译知识 |

## 工作流程

### 1. 获取原始资料

根据用户提供的输入类型，选择对应的获取方式：

| 输入类型 | 获取方式 | 保存到 |
|---------|---------|--------|
| 项目文件路径 | Read + codegraph 分析 | `raw/code-analysis/` |
| 网页 URL | WebFetch / webReader | `raw/other/` |
| 用户粘贴的文本 | 直接使用 | `raw/other/` |

### 2. 保存到 raw/

将获取的原始内容保存为不可变文件：

- **路径**：`raw/<type>/YYYY-MM-DD_<slug>.md`
- **Frontmatter**：

```yaml
---
source_type: "code-analysis | other"
source_url: "原始 URL（如有）"
captured_date: "YYYY-MM-DD"
feeds_wiki: []  # 将在 Step 5 后回填
---
```

同时在 `raw/_manifest.md` 追加一行。

### 3. 分析与用户讨论

阅读完整原始资料后，向用户呈现 2-3 个核心要点：

```markdown
## 资料摘要

**来源**：<source title>
**核心要点**：
1. ...
2. ...
3. ...

需要重点关注哪些方面？或者直接继续编译？
```

等待用户确认或指定重点方向。

### 4. 分析影响范围

从原始资料中提取关键实体：

- 涉及的 **通道**（映射到 `channels/`）
- 涉及的 **运行时组件**（映射到 `runtime/`）
- 涉及的 **服务模块**（映射到 `services/`）
- 涉及的 **存储层**（映射到 `stores/`）
- 涉及的 **架构设计**（映射到 `architecture/`）
- 涉及的 **开发流程**（映射到 `development/`）

搜索现有 wiki 页面，确定三类操作：

```
Grep: 在 wiki/ 中搜索提取到的关键实体
Read: wiki/_index.md 对照索引
```

- **UPDATE**：已存在的 wiki 页面，需要补充/修正内容
- **CREATE**：主题未覆盖，需要新建 wiki 页面
- **CROSS-REF**：已存在但未与新内容互链的页面

### 5. 编译计划预览

展示给用户确认：

```markdown
## Ingest 编译计划

**来源**：<source-title>

### UPDATE（N 页）
- `wiki/channels/wechat.md` — 补充 token 刷新机制
- `wiki/runtime/supervisor-lifecycle.md` — 更新崩溃恢复流程

### CREATE（N 页）
- `wiki/stores/event-store.md` — EventStore 设计文档
- `wiki/architecture/command-router.md` — Command Router 设计

### CROSS-REF（N 页）
- `wiki/channels/registry.md` — 添加新的相关链接

**预计影响**：共 X 个文件

确认执行？[Y/n]
```

用户可以：
- 确认全部执行
- 删减不需要的操作
- 要求添加遗漏的页面

### 6. 执行编译

根据确认的计划执行操作。使用 Subagents 并行处理提升效率：

#### UPDATE 操作
1. 读取现有 wiki 页面
2. 读取 raw source 中的相关内容
3. 增量合并：保留原有内容，补充新信息
4. 更新 frontmatter 的 `updated` 日期和 `sources` 字段

#### CREATE 操作
1. 从 raw source 提取相关内容
2. 按 wiki 模板（`.claude/skills/add-wiki/templates/wiki-template.md`）生成文档
3. 填充 frontmatter（包括 `sources` 指向 raw 文件）
4. 添加资源导航表

#### CROSS-REF 操作
1. 在目标页面的资源导航表中添加新的相关链接
2. 在新建/更新的页面中也添加反向链接

### 7. 更新索引和日志

所有操作完成后：

1. **分类索引**：更新所有受影响的 `wiki/<category>/_index.md`
2. **全局索引**：更新 `wiki/_index.md`
3. **操作日志**：在 `wiki/log.md` 追加 INGEST 行：

```
| YYYY-MM-DD | INGEST | <created/updated 文件列表> | ingest | 来源：<source-title>，CREATE N + UPDATE N + XREF N |
```

4. **Raw manifest**：更新 `raw/_manifest.md` 中该来源的 `feeds_wiki` 列表
5. **Raw 文件**：回填 raw 文件 frontmatter 中的 `feeds_wiki` 字段

### 8. 输出摘要

```markdown
## Ingest 完成

**来源**：<source-title> → `raw/<type>/YYYY-MM-DD_<slug>.md`

**变更**：
- CREATE: N 个新页面
  - `wiki/xxx/yyy.md` — 一句话摘要
- UPDATE: N 个页面更新
  - `wiki/xxx/zzz.md` — 更新内容说明
- CROSS-REF: N 个页面添加交叉引用

**日志**：已记录到 `wiki/log.md`
```

## 特殊场景处理

### 大型资料源

当原始资料超过 5000 字时：
- Step 3 中提供更详细的分层摘要
- Step 5 中将计划分批展示（每批不超过 5 个页面操作）
- 执行时也分批处理，每批完成后报告进度

### 发现矛盾

当新资料与现有 wiki 内容矛盾时：
- 在编译计划中明确标注矛盾点
- 不自动覆盖，让用户决定以哪个为准

### 资料源已被 ingest 过

检查 `raw/_manifest.md`，如果同一 URL 已被 ingest：
- 提醒用户该来源已有记录
- 询问是否为增量更新（只处理新增/变化的内容）

## 示例

```
用户：/ingest ARCHITECTURE.md
→ 读取项目 ARCHITECTURE.md
→ 保存到 raw/code-analysis/2026-05-18_architecture.md
→ 分析涉及 runtime + stores + channels + services
→ 编译计划：CREATE 4 页 + UPDATE 0 页 + CROSS-REF 0 页
→ 用户确认
→ 并行执行编译
→ 更新索引和日志

用户：/ingest https://example.com/claude-code-docs
→ 用 WebFetch 获取文档
→ 保存到 raw/other/2026-05-18_claude-code-docs.md
→ 编译计划：CREATE runtime/claude-adapter.md
→ 执行编译
```
