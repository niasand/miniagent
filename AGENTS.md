# Repository Guidelines

## Project Structure & Module Organization

This repository is in the planning stage. `prd.md` describes MiniAgent: a multi-agent bridge for Codex CLI, Claude Code, Trae CLI, and chat channels such as Lark, QQ, Telegram, and WeChat.

Expected implementation layout:

- `src/`: application source code.
- `src/server/`: Hono API, agent runtime adapters, channel adapters, cron tasks, and persistence logic.
- `src/client/`: React UI, Tailwind CSS 4 styles, Markdown/card rendering, and tabbed conversation views.
- `src/shared/`: shared TypeScript types, constants, and validation schemas.
- `tests/`: unit and integration tests mirroring `src/`.
- `docs/`: architecture notes, setup guides, and protocol decisions.

## Build, Test, and Development Commands

- `npm install`: install dependencies.
- `npm test`: run the Vitest suite.
- `npm run typecheck`: run TypeScript without emitting files.
- `npm run db:migrate`: apply SQLite migrations to `MINIAGENT_DB_PATH`, or `data/miniagent.sqlite` by default.

No production server or frontend build exists yet. Add exact commands here when those modules land.

## Coding Style & Naming Conventions

Use TypeScript for backend and frontend code. Prefer small modules with explicit exports. Use `camelCase` for variables/functions, `PascalCase` for React components/classes, and `UPPER_SNAKE_CASE` for environment constants.

Keep channel integrations behind adapter interfaces so Lark, Telegram, QQ, and WeChat behavior can evolve independently. Avoid abstractions until two implementations need them.

## Testing Guidelines

Add tests with each behavior change. New or changed code should include corresponding unit, integration, or regression coverage before the task is considered complete. Prefer fast unit tests for adapters, schedulers, persistence, and routing. Add integration tests for agent lifecycle, channel delivery, and SQLite persistence.

Name tests after behavior, for example `agent-session.test.ts` or `lark-card-renderer.test.ts`. Tests should not require real credentials; mock external chat APIs and agent processes by default.

Run the relevant focused test first, then run the full available test suite before finishing code changes. If any test fails, fix the issue and repeat the same checks until they pass.

## Commit & Pull Request Guidelines

There is no established commit history yet. Use short, imperative English commit messages such as `Add agent session persistence` or `Document channel adapter contract`.

Pull requests should include a clear summary, verification steps, linked issues or docs, and screenshots or screen recordings for UI/card rendering changes. Call out schema changes, environment variables, migrations, and any compatibility impact on persisted sessions.

## Security & Configuration Tips

Do not commit `.env` files, API tokens, chat platform secrets, local databases, caches, or archived conversation logs. Document required variables in an example file. The PRD references `AGENT_NAMW` and `TZ`; confirm spelling before implementing environment handling.
