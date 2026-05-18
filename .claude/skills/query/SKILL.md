---
name: query
description: |
  从 MiniAgent 知识库查询问题答案。先扫描索引快速定位，再深入相关文档和代码库调研，最后输出结论和信息来源。
  当用户想了解 MiniAgent 的架构、通道、运行时、存储、服务、开发流程时使用。
  触发词："查一下"、"知识库里有没有"、"这个模块是做什么的"、"帮我找找"、"/query"。
  也适用于用户提出任何关于 MiniAgent 的技术问题——即使没提到"知识库"，只要问题涉及项目的技术细节，都应该先查知识库。
---

# /query — 知识库查询

从 MiniAgent 知识库中查询问题答案，结合导航线索深入调研，输出结论并附信息来源。

## 查询流程

### 1. 分析问题

从用户问题中提取：

- **关键词**：用于搜索的核心术语
- **意图**：用户想知道什么（架构？接口？流程？数据模型？）
- **范围**：涉及哪些模块/组件

### 2. 三层搜索

按顺序执行，逐层细化：

#### 第一层：全局索引扫描

读取 `wiki/_index.md`，浏览所有分类和文档列表，快速定位可能相关的文档。

#### 第二层：关键词搜索

用 Grep 在 `wiki/` 目录中搜索关键词，找到所有提及相关内容的文档。

```
Grep: pattern=<关键词>, path=wiki/, output_mode=files_with_matches
```

#### 第三层：候选文档深读

读取搜索命中的文档，提取与问题直接相关的信息：

- YAML frontmatter 中的 tags
- 一句话摘要
- 正文中的具体内容
- 资源导航表中的路径和链接

### 3. 深入调研

根据文档中的导航线索，进一步获取详细信息。使用 Subagents 并行调研：

#### 代码库调研

如果文档指向代码路径（`src/server/...`），用 Explore agent 或 codegraph 分析相关代码：

- 接口定义和实现
- 数据结构和类型
- 调用链和依赖关系

#### ARCHITECTURE.md 参考

如果问题涉及系统级设计，读取 `ARCHITECTURE.md` 获取架构上下文。

#### issue.md 参考

如果问题涉及已知 bug 或排障，读取 `issue.md` 查看历史经验。

#### 知识库直接内容

如果 wiki 文档本身就包含答案（直接记录的隐性知识），直接引用。

### 4. 输出结论

结构化输出：

```
## 回答

[直接回答用户问题]

## 信息来源

**覆盖度**：🟢 High（5+ 来源命中） / 🟡 Medium（2-4 来源） / 🔴 Low（0-1 来源）

- wiki 文档：[文档路径和相关段落]
- 代码：[file:line 精确定位]
- ARCHITECTURE.md：[相关章节]
- issue.md：[相关记录]
- raw 来源：[路径]（如果存在）

## 知识库补充建议（可选）

如果调研过程中发现知识库缺少相关信息，建议用户用 /add_wiki 补充：
- "建议添加：xxx 的 wiki 文档（当前知识库未覆盖）"
```

### 5. Query 回填判断

完成回答后，评估是否值得将本次查询结果沉淀为新 wiki 页面。

**回填条件**（满足任意 2 条即建议回填）：
- 回答涉及跨 3+ 文档的信息聚合
- 回答包含从代码库现场调研的新信息（非已有 wiki 内容）
- 该主题被查询过 2+ 次（可通过 `wiki/log.md` 检查同关键词的历史 QUERY 记录）
- 回答超过 500 字且结构清晰

**回填方式**：不自动创建页面，在输出结论末尾追加建议：

```
> 本次查询聚合了多个来源的信息，建议执行 `/add_wiki <suggested-title>` 将结果固化为 wiki 页面。
```

### 6. 追加查询日志

在 `wiki/log.md` 的 `<!-- LOG_START -->` 下方插入一行：

```
| YYYY-MM-DD | QUERY | <匹配到的页面列表> | query | <查询关键词> |
```

## 搜索策略

### 关键词映射

用户的提问方式和知识库的组织方式可能不完全匹配，需要做关键词扩展：

| 用户可能说 | 也搜索 |
|-----------|--------|
| "微信" | wechat, WeChat, channel, 通道 |
| "飞书" | feishu, lark, card, 卡片 |
| "消息" | message, inbound, event, outbox |
| "进程" | process, supervisor, run, agent |
| "状态" | session, state machine, status |
| "数据库" | SQLite, store, migration, schema |
| "部署" | launchd, plist, service, start |
| "前端" | client, App.tsx, React, UI |

### 找不到结果时

如果三层搜索都没有找到相关内容：

1. 尝试用同义词/英文重新搜索
2. 在代码库中直接搜索（用 codegraph 或 Grep）
3. 读取 ARCHITECTURE.md 和 issue.md 寻找线索
4. 坦诚告知用户知识库中暂无此信息
5. 建议使用 `/add_wiki` 补充

## 示例

```
用户：/query 消息从微信到 Agent 的完整数据流是怎样的？
→ 搜索 wiki/ 中的 wechat、消息、inbound
→ 找到 wiki/channels/wechat.md 和 wiki/services/inbound.md（如果存在）
→ 深入代码库分析 channels/wechat.ts + services/inbound.ts
→ 输出数据流说明 + 来源

用户：/query Supervisor 如何处理 Agent 崩溃？
→ 搜索 supervisor、crash、runtime
→ 读取 wiki/runtime/supervisor-lifecycle.md（如果存在）
→ 分析 src/server/runtime/supervisor.ts
→ 输出崩溃恢复流程

用户：Session 状态有哪些？
→ 识别为 MiniAgent 技术问题，自动查知识库
→ 搜索 session、state、status
→ 输出状态枚举和转换说明
```
