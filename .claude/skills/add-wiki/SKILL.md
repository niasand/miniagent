---
name: add-wiki
description: |
  创建或更新 MiniAgent 知识库的 wiki 文档。根据用户提供的主题，自动调研（代码库分析、ARCHITECTURE.md、
  CLAUDE.md、wiki/qa/issue.md），按模板生成规范文档，写入 wiki/ 目录并更新索引。
  触发词："添加 wiki"、"新增文档"、"记录到知识库"、"add wiki"、"/add_wiki"。
  也适用于"帮我记录一下 channel 的架构"、"把这个流程写到知识库里"等场景。
---

# /add_wiki — 知识库文档创建与更新

根据用户提供的主题和信息，调研后按规范创建或更新 wiki 文档。

## 工作流程

### 1. 解析输入

从用户输入中提取：

- **主题**：要创建/更新的文档主题（必需）
- **category**：目标分类（可选，未指定则自动判断）
- **素材**：用户直接提供的信息、代码路径、issue 引用等

### 2. 确定 category

根据主题自动匹配到以下 7 个分类之一：

| Category | 内容范围 | 判断线索 |
|----------|---------|---------|
| `architecture` | 系统架构、数据流、设计决策 | "架构"、"设计"、"数据流"、"拓扑" |
| `channels` | 消息通道集成 | 通道名（dingtalk, discord, feishu, qq, telegram, wechat, wecom）、"消息"、"通道"、"channel" |
| `runtime` | Agent 运行时、Supervisor、ACP | "运行时"、"supervisor"、"adapter"、"context"、"session"、"agent" |
| `services` | 业务服务层 | "inbound"、"workspace"、"delivery"、"投递"、"服务" |
| `stores` | 数据存储层 | "store"、"event"、"outbox"、"session"、"migration"、"数据库"、"SQLite" |
| `development` | 开发与运维流程 | "部署"、"测试"、"启动"、"launchd"、"排障"、"环境" |
| `qa` | Bug 追踪、问题记录 | "bug"、"issue"、"问题"、"crash"、"报错"、"修复" |

无法判断时，用 AskUserQuestion 确认。

### 3. 查重

在 `wiki/` 目录下搜索是否已存在同主题文档：

```
Grep: 在 wiki/ 中搜索主题关键词（标题、tags）
Glob: wiki/<category>/*.md
```

- **已存在** → 转为更新模式，读取现有文档，保留原有内容，增量更新
- **不存在** → 创建新文档

### 4. 调研

核心步骤。使用 Subagents 并行调研保持主上下文干净。

#### 信息来源优先级

| 场景 | 推荐方式 | 说明 |
|------|---------|------|
| 系统架构设计 | Read ARCHITECTURE.md | 架构决策的第一来源 |
| 已知问题参考 | Read issue.md | 踩坑记录 |
| 代码库分析 | Explore agent / codegraph | 分析源码结构、接口定义 |
| 查询已有知识 | `/query` | 先查知识库避免重复 |
| 网页/API 文档 | WebFetch / webReader | 外部文档 |

#### channels（消息通道）

分析 `src/server/channels/<channel>.ts`：

- 目录结构和类型定义
- 消息收发接口（send、receive、parse）
- 认证流程和 token 管理
- 错误处理和重试逻辑
- 与 registry 的集成方式

#### runtime（运行时）

分析 `src/server/runtime/` 下的文件：

- Supervisor 生命周期管理
- Adapter 接口定义和实现
- Session/Run/Task 状态机
- ContextPack 生成和使用

#### stores（存储层）

分析 `src/server/stores/` 下的文件：

- 数据模型和 schema
- 关键查询方法
- Migration 历史（`src/server/db/migrate.ts`）

#### 用户提供链接或信息

整理归纳用户提供的文本，补充缺失的上下文。

### 4.5 保存原始素材

将调研过程中的外部内容（非用户口述）保存到 `raw/` 目录：

- 代码分析结果 → `raw/code-analysis/YYYY-MM-DD_<slug>.md`
- 网页/API 响应 → `raw/other/YYYY-MM-DD_<slug>.md`

每个 raw 文件的 frontmatter：

```yaml
---
source_type: "code-analysis | other"
captured_date: "YYYY-MM-DD"
feeds_wiki: ["wiki/<category>/<slug>.md"]
---
```

同时在 `raw/_manifest.md` 追加一行映射记录。

> **跳过条件**：如果所有素材都来自用户直接提供的文本，跳过此步。

### 5. 生成文档

读取模板文件 `.claude/skills/add-wiki/templates/wiki-template.md`，根据 category 选择对应的文档结构。

**文件命名规则**：
- slug：英文小写，单词用 `-` 连接
- 路径：`wiki/<category>/<slug>.md`
- 示例：`wiki/channels/wechat.md`、`wiki/runtime/supervisor-lifecycle.md`

**必须包含**：
- YAML frontmatter：title, category, tags, created, updated
- 紧跟 frontmatter 的一句话摘要（将被索引引用）
- 资源导航表（代码路径、相关 wiki）

**风格要求**：
- 代码路径用反引号标注，精确到文件或目录
- 表格优于长段落
- 架构图用 Mermaid

### 6. 更新索引

创建或更新文档后，必须同步更新两个索引文件：

#### 分类索引 `wiki/<category>/_index.md`

在 `<!-- 由 /add_wiki 自动维护 -->` 注释下方添加/更新条目：

```markdown
- [文档标题](slug.md) — 一句话摘要
```

如果存在 `_暂无文档` 占位文本，替换掉。

#### 全局索引 `wiki/_index.md`

在对应分类的 `<!-- 文档列表（由 /add_wiki 自动维护） -->` 注释下方添加/更新条目，格式同上。

### 6.5 级联交叉引用

创建或更新文档后，检查是否需要更新相关文档的交叉引用：

1. **正向引用**：新文档的「资源导航」表中引用的其他 wiki 页面
2. **反向引用**：用 Grep 搜索所有现有 wiki 页面，找到与新文档主题相关（共享模块名、组件名、关键实体）但未互链的页面

对于每个应该添加反向引用的页面：
- 在其「资源导航」表中添加指向新文档的链接
- 更新其 frontmatter 的 `updated` 日期

**范围限制**：最多更新 5 个相关页面，避免过度扩散。

### 6.8 追加操作日志

在 `wiki/log.md` 的 `<!-- LOG_START -->` 下方插入一行：

```
| YYYY-MM-DD | CREATE/UPDATE | <category>/<slug>.md | add-wiki | <一句话说明> |
```

### 7. 输出摘要

完成后告知用户：

- 文档路径（可点击）
- 一句话摘要
- 更新了哪些索引文件
- 级联更新了哪些页面的交叉引用
- 如果是更新模式，说明变更内容

## 示例

```
用户：/add_wiki WeChat channel 集成
→ 分析 src/server/channels/wechat.ts
→ 生成 wiki/channels/wechat.md
→ 更新 wiki/channels/_index.md 和 wiki/_index.md

用户：/add_wiki EventStore 设计
→ category = stores
→ 调研 src/server/stores/event-store.ts + ARCHITECTURE.md
→ 生成 wiki/stores/event-store.md

用户：/add_wiki Session 状态机
→ category = runtime
→ 生成 wiki/runtime/session-state-machine.md
```
