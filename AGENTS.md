# Repository Guidelines

## Project Structure & Module Organization

This repository is in the planning stage. `prd.md` describes MiniAgent: a multi-agent bridge for Codex, Claude Code, and chat channels such as Lark, QQ, Telegram, and WeChat.

Expected implementation layout:

- `src/`: application source code.
- `src/server/`: Hono API, agent orchestration, channel adapters, cron tasks, and persistence logic.
- `src/client/`: React UI, Tailwind CSS 4 styles, Markdown/card rendering, and tabbed conversation views.
- `src/shared/`: shared TypeScript types, constants, and validation schemas.
- `tests/`: unit and integration tests mirroring `src/`.
- `docs/`: architecture notes, setup guides, and protocol decisions.

## Build, Test, and Development Commands

No package manifest or build tooling exists yet. When the Node/TypeScript project is scaffolded, document exact commands here. Recommended defaults:

- `npm install`: install dependencies.
- `npm run dev`: run the local server, expected default port `7272`.
- `npm test`: run the test suite.
- `npm run lint`: run TypeScript, ESLint, and formatting checks.
- `npm run build`: create a production build.

Keep commands reproducible; document any global tool requirement.

## Coding Style & Naming Conventions

Use TypeScript for backend and frontend code. Prefer small modules with explicit exports. Use `camelCase` for variables/functions, `PascalCase` for React components/classes, and `UPPER_SNAKE_CASE` for environment constants.

Keep channel integrations behind adapter interfaces so Lark, Telegram, QQ, and WeChat behavior can evolve independently. Avoid abstractions until two implementations need them.

## Testing Guidelines

Add tests with each behavior change. Prefer fast unit tests for adapters, schedulers, persistence, and routing. Add integration tests for agent lifecycle, channel delivery, and SQLite persistence.

Name tests after behavior, for example `agent-session.test.ts` or `lark-card-renderer.test.ts`. Tests should not require real credentials; mock external chat APIs and agent processes by default.

## Commit & Pull Request Guidelines

There is no established commit history yet. Use short, imperative English commit messages such as `Add agent session persistence` or `Document channel adapter contract`.

Pull requests should include a clear summary, verification steps, linked issues or docs, and screenshots or screen recordings for UI/card rendering changes. Call out schema changes, environment variables, migrations, and any compatibility impact on persisted sessions.

## Security & Configuration Tips

Do not commit `.env` files, API tokens, chat platform secrets, local databases, caches, or archived conversation logs. Document required variables in an example file. The PRD references `AGENT_NAMW` and `TZ`; confirm spelling before implementing environment handling.
