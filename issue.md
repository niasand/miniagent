[AI-REVIEW] Large commit detected: 540 lines added. Consider reviewing for AI Psychosis.
[AI-REVIEW] Large commit detected: 542 lines added. Consider reviewing for AI Psychosis.
[AI-REVIEW] Large commit detected: 346 lines added. Consider reviewing for AI Psychosis.
[AI-REVIEW] Large commit detected: 333 lines added. Consider reviewing for AI Psychosis.
[AI-REVIEW] Large commit detected: 305 lines added. Consider reviewing for AI Psychosis.
[AI-REVIEW] Large commit detected: 275 lines added. Consider reviewing for AI Psychosis.
[AI-REVIEW] Large commit detected: 201 lines added. Consider reviewing for AI Psychosis.
[AI-REVIEW] Large commit detected: 203 lines added. Consider reviewing for AI Psychosis.
[AI-REVIEW] Large commit detected: 226 lines added. Consider reviewing for AI Psychosis.
[AI-REVIEW] Large commit detected: 949 lines added. Consider reviewing for AI Psychosis.
[AI-REVIEW] Large commit detected: 951 lines added. Consider reviewing for AI Psychosis.
[AI-REVIEW] Large commit detected: 934 lines added. Consider reviewing for AI Psychosis.
[AI-REVIEW] Large commit detected: 311 lines added. Consider reviewing for AI Psychosis.
[AI-REVIEW] Large commit detected: 311 lines added. Consider reviewing for AI Psychosis.
[AI-REVIEW] Large commit detected: 369 lines added. Consider reviewing for AI Psychosis.

## [2026-09-16] node_modules 原生依赖平台不匹配导致服务无法启动

**现象**：pm2 启动 miniagent-api 时 `npm run db:migrate` 报 esbuild "installed for another platform"；修完 esbuild 后 better-sqlite3 dlopen 报 `incompatible architecture (have 'x86_64', need 'arm64')`；API 起来后 miniagent-web 又报 `Cannot find module '@rolldown/binding-darwin-universal'`。

**根因**：node_modules 是在 Rosetta/x64 环境下安装的，所有原生二进制（esbuild、better-sqlite3、@rolldown binding）都是 x86_64 版本，而本机是 Apple Silicon (arm64)。且 `@rolldown/binding-darwin-x64` 属于平台 optionalDependencies，`npm rebuild` 不会补装缺失的其他平台包。

**修复方案**：
1. `npm rebuild esbuild better-sqlite3` 修复这两个可 rebuild 的原生模块
2. `npm install` 让 npm 按当前平台 (darwin-arm64) 补齐 optional 依赖（移除 x64 binding、装上 arm64 binding）
3. `pm2 restart miniagent-web`

**涉及文件**：`package-lock.json`（+1 行，arm64 optional dep 记录）

**验证证据**：`pm2 list` 显示 miniagent-api (pid 58323) / miniagent-web (pid 60614) 均 online；`curl http://127.0.0.1:7273/api/workspace` → 200；`curl http://127.0.0.1:4173/` → 200。

**教训**：跨架构迁移（Rosetta → 原生 arm64）后服务起不来，先怀疑 node_modules 原生二进制平台不匹配，用 `node -e "console.log(process.arch)"` + `ls node_modules/@rolldown/` 之类的命令核对。`npm rebuild` 只修当前包，不补 optional 平台包；补 optional 平台包必须跑 `npm install`。最干净的做法是删掉 node_modules 和 package-lock 里的错误平台记录后重装。
