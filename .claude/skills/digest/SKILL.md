---
name: digest
description: |
  对话消化整理 — 将当前对话中的实战经验提取为 wiki 文档存入知识库。
  在问题解决后对当前对话进行"消化"，提取关键知识点（踩过的坑、尝试过的方案、关键发现），
  整理成规范文档。触发词："digest"、"消化"、"记录下来"、"把刚才的过程记下来"、
  "沉淀一下"、"总结一下存到知识库"。
  与 add-wiki 的区别：add-wiki 从主题出发主动调研，digest 从已有对话提取，无需额外调研。
---

# /digest — 对话消化整理

将当前对话中的实战经验（排障、探索、架构调研等）提取为 wiki 文档，存入 MiniAgent 知识库。

## 工作流程

### 1. 分析对话上下文

回顾当前对话的完整过程，提取以下要素：

- **问题描述**：最初要解决什么问题
- **探索过程**：尝试了哪些方案、走了哪些弯路
- **关键发现**：过程中发现的重要信息
- **最终方案**：问题是如何解决的
- **经验教训**：下次遇到类似问题应该怎么做
- **相关代码路径**：涉及的文件、函数、配置（精确到 `file:line`）

如果对话内容不足以提取有价值的知识，告知用户并建议继续解决问题后再 digest。

如果 issue.md 中已有相关记录，读取并整合到 digest 中（避免重复，补充细节）。

### 2. 确定标题和分类

根据对话内容自动匹配 category：

| 对话类型 | 推荐 Category | 示例 |
|---------|--------------|------|
| Bug 修复、排障过程 | `development` | "WeChat 消息收发排障" |
| 架构发现、设计理解 | `architecture` | "EventStore 写入与投影流程" |
| 通道集成问题 | `channels` | "Feishu card 投递重试机制" |
| 运行时行为分析 | `runtime` | "Supervisor 进程崩溃恢复" |
| 存储层调研 | `stores` | "Outbox 幂等投递设计" |
| 开发环境/流程 | `development` | "macOS launchd 服务配置" |

**自动生成**：
- **标题**：简洁描述核心主题，不超过 20 个字
- **slug**：英文小写，单词用 `-` 连接

无法判断 category 时，用 AskUserQuestion 确认。

### 2.5 保存对话原始提取

将对话中的关键信息保存到 `raw/other/YYYY-MM-DD_<slug>-conversation.md`。

frontmatter：

```yaml
---
source_type: "conversation-extract"
captured_date: "YYYY-MM-DD"
feeds_wiki: ["wiki/<category>/<slug>.md"]
---
```

同时在 `raw/_manifest.md` 追加一行映射记录。

### 3. 生成文档预览

生成完整文档内容，展示给用户确认后再写入。文档必须包含 `digest` tag。

#### 文档结构

**frontmatter**（必填）：

```yaml
---
title: "文档标题"
category: "<category>"
tags: ["digest", "其他相关标签"]
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
---
```

**排障/探索类文档结构**：

```markdown
一句话摘要（将被索引引用）

## 概述

2-3 句话说明背景和结论。

## 问题描述

- 现象：观察到什么
- 影响范围：哪些功能/环境受影响
- 触发条件：何时/如何触发

## 排查过程

按时间线记录关键排查步骤（省略无价值的尝试，保留有启发性的弯路）：

1. **初步判断**：...
2. **尝试方案 A**：...（结果：失败，原因：...）
3. **关键发现**：...
4. **定位根因**：...

## 解决方案

具体的修复步骤或配置变更，附代码片段和路径。

## 经验教训

- 下次遇到类似问题的快速排查路径
- 容易踩的坑和规避方法

---

## 资源导航

| 类型 | 链接/路径 | 说明 |
|------|----------|------|
| 代码路径 | `file:line` | ... |
| 相关 Wiki | | |
```

**非排障类文档**：按对应 category 的标准模板结构输出（参考 `.claude/skills/add-wiki/templates/wiki-template.md`），但始终包含 `digest` tag 和资源导航表。

### 4. 用户确认

使用 AskUserQuestion 让用户确认或调整。

用户确认后执行写入。如果用户要求修改，调整后再次预览确认。

### 4.5 交叉引用检查

在写入前，搜索现有 wiki 页面中与本次 digest 内容相关的文档：

1. 搜索关键实体（组件名、函数名、模块名）
2. 在新文档的「资源导航」表中添加相关 wiki 链接
3. 在相关的已有页面中添加反向链接（最多 3 个页面）

### 5. 写入与索引更新

#### 写入文档

- 路径：`wiki/<category>/<slug>.md`
- 查重：写入前检查是否已存在同 slug 文件
  - **已存在** → 读取现有文档，合并更新（保留原有内容，增量添加新知识）
  - **不存在** → 创建新文件

#### 更新分类索引 `wiki/<category>/_index.md`

在 `<!-- 由 /add_wiki 自动维护 -->` 注释下方添加/更新条目：

```markdown
- [文档标题](slug.md) — 一句话摘要
```

如果存在 `_暂无文档` 占位文本，替换掉。

#### 更新全局索引 `wiki/_index.md`

在对应分类的 `<!-- 文档列表（由 /add_wiki 自动维护） -->` 注释下方添加/更新条目，格式同上。

### 5.5 追加操作日志

在 `wiki/log.md` 的 `<!-- LOG_START -->` 下方插入一行：

```
| YYYY-MM-DD | CREATE/UPDATE | <category>/<slug>.md | digest | <一句话说明> |
```

### 6. 输出摘要

完成后告知用户：

- 文档路径（可点击）
- 一句话摘要
- 更新了哪些索引文件
- 级联更新了哪些交叉引用
- 如果是更新模式，说明变更内容

## 规范复用

本技能复用 add-wiki 的以下规范（不调用 add-wiki 技能本身）：

- **文件命名**：slug 小写连字符，`wiki/<category>/<slug>.md`
- **frontmatter**：title, category, tags, created, updated
- **索引格式**：`- [标题](slug.md) — 摘要`
- **模板参考**：`.claude/skills/add-wiki/templates/wiki-template.md`

## 示例

```
用户：（经过多轮排查 WeChat channel 消息收发问题后）
用户：/digest

→ 分析对话：排查了 WeChat 消息收发、DB CHECK 约束、QR 码等多个问题
→ category = channels
→ slug = wechat-channel-troubleshooting
→ 生成排障文档预览，展示给用户确认
→ 写入 wiki/channels/wechat-channel-troubleshooting.md
→ 更新 wiki/channels/_index.md 和 wiki/_index.md

用户：把刚才梳理的 Session 状态机记下来

→ 分析对话：梳理了 Session/Run/Task 状态转换逻辑
→ category = runtime
→ slug = session-state-machine
→ 生成文档预览
→ 写入 wiki/runtime/session-state-machine.md
```
