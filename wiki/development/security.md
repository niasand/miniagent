---
title: "安全模块：密钥脱敏与工作区访问控制"
category: "development"
tags: ["security", "redaction", "workspace-policy", "access-control"]
created: "2026-05-18"
updated: "2026-05-18"
sources: ["src/server/security/"]
coverage: "high"
status: "active"
---

MiniAgent 安全层由两个模块组成：redaction.ts 在事件持久化前自动脱敏密钥，workspace-policy.ts 通过路径白名单控制 Agent 可访问的工作目录。

## 密钥脱敏

源文件：`src/server/security/redaction.ts`

两层检测策略：键名匹配 + 值内容扫描。

### 键名匹配

`SECRET_KEY_PATTERN` 匹配以下键名（不区分大小写，完全匹配）：

| 匹配的键名模式 |
|---------------|
| `api_key`, `api-key`, `apiKey` |
| `auth`, `authorization`, `bearer` |
| `client_secret`, `client-secret` |
| `cookie`, `credential`, `passwd`, `password`, `secret` |
| `access_token`, `refresh_token`, `id_token` |
| `private_key`, `api_secret` |

键命中时，整个值替换为 `[REDACTED]`（即使值是嵌套对象也不深入检查）。

### 值内容扫描

`SECRET_VALUE_PATTERNS` 扫描字符串内容中的敏感模式：

| 模式 | 脱敏结果 |
|------|---------|
| `sk-` 前缀 token（12+ 字符） | `sk-[REDACTED]` |
| `Bearer <token>`（12+ 字符） | `Bearer [REDACTED]` |
| Slack token：`xoxb-`, `xoxa-`, `xoxp-`, `xoxr-`, `xoxs-` | `[REDACTED]` |
| `api_key=...`, `password=...`, `secret=...`, `token=...` | 保留键前缀，脱敏值 |

### API

| 函数 | 签名 | 说明 |
|------|------|------|
| `redactJson` | `(value: JsonValue) => JsonValue` | 递归遍历对象/数组，键匹配时替换值 |
| `redactString` | `(value: string) => string` | 对字符串应用所有值模式 |

### 注意事项

- 键模式使用完全锚定匹配（`^...$`），`authorization_code` 不会匹配，只有 `authorization` 会
- `number / boolean / null` 类型的值直接传递（不可能包含密钥）
- EventStore 的 `append()` 在写入前调用 `redactJson()` 对 payload 脱敏
- AcpClientFileSystem 在返回文件内容前调用 `redactString()` 脱敏

## 工作区访问控制

源文件：`src/server/security/workspace-policy.ts`

通过路径白名单限制 Agent 可访问的工作目录，防止越权访问。

### 路径验证流程

```
1. 规范化：resolve(expandHome(trim(path))) → 绝对路径
2. Allowlist 也经过同样的规范化 + 去重
3. 遏制检查：relative(root, child)
   → 结果为 "" 或不以 ".." 开头 → 在白名单内
4. 空 allowlist → 拒绝所有路径
5. 空路径 → 抛出 WorkspacePolicyError
```

### API

| 导出 | 类型 | 说明 |
|------|------|------|
| `WorkspacePolicy` | 类 | 白名单管理 + 路径验证 |
| `WorkspacePolicyError` | 类 | 自定义错误，携带 `workspacePath`、`normalizedPath`、`allowlist`、`reason` |
| `normalizeWorkspacePath` | 函数 | 路径规范化（展开 `~/`、解析符号链接） |
| `splitAllowlist` | 函数 | 按逗号分割、去空格、去空 |

| WorkspacePolicy 方法 | 说明 |
|---------------------|------|
| `constructor(allowlist)` | 规范化 + 去重白名单 |
| `fromEnvironment(fallback)` | 从 `WORKSPACE_ALLOWLIST` 环境变量读取 |
| `assertAllowed(path)` | 堡垒方法：成功返回规范化路径，失败抛异常 |
| `evaluate(path)` | 无异常替代，返回判别联合 |

### 环境变量

| 变量 | 格式 | 说明 |
|------|------|------|
| `WORKSPACE_ALLOWLIST` | 逗号分隔路径 | 允许的工作区根目录。未设置时使用 fallback |

### 集成点

| 位置 | 用途 |
|------|------|
| `POST /api/sessions` | 验证新 session 的 workspace 路径 |
| `POST /api/sessions/:sessionId/runs/start` | 捕获 `WorkspacePolicyError` → 403 |
| `InboundService` | 消息处理期间验证 workspace |
| `RuntimeService` | 运行时执行期间路径验证 |
| `AcpClientFileSystem` | Agent 读取文件时沙箱检查 |
| `AuditLogStore` | workspace denied 审计记录 |

---

## 资源导航

| 类型 | 链接/路径 | 说明 |
|------|----------|------|
| 代码 | `src/server/security/redaction.ts` | 密钥脱敏 |
| 代码 | `src/server/security/workspace-policy.ts` | 工作区访问控制 |
| 相关 Wiki | [stores/overview](../stores/overview.md) | EventStore 写入时调用 redactJson |
| 相关 Wiki | [runtime/overview](../runtime/overview.md) | AcpClientFileSystem 沙箱文件读取 |
