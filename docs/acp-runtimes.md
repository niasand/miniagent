# ACP Runtime Setup

MiniAgent treats ACP as the primary runtime path for real agent sessions. The legacy CLI adapters remain as a fallback, but `runtimeKind: "acp"` should be used for new sessions when the local machine has the required agent installed and authenticated.

## Default Commands

| Agent | Default command | Notes |
| --- | --- | --- |
| Codex | `node_modules/@zed-industries/codex-acp-*/bin/codex-acp` | MiniAgent resolves the platform native binary first to avoid the npm shim leaving orphan processes. |
| Claude | `node_modules/.bin/claude-agent-acp` | Uses `@agentclientprotocol/claude-agent-acp@0.33.1`. |
| Trae | `traecli acp serve` | Requires a working Trae CLI model/auth configuration before `session/new`. |

Override commands and arguments with:

```bash
MINIAGENT_CODEX_ACP_COMMAND=/path/to/codex-acp
MINIAGENT_CODEX_ACP_ARGS="--flag value"

MINIAGENT_CLAUDE_ACP_COMMAND=/path/to/claude-agent-acp
MINIAGENT_CLAUDE_ACP_ARGS="--flag value"

MINIAGENT_TRAE_ACP_COMMAND=traecli
MINIAGENT_TRAE_ACP_BASE_ARGS="acp serve"
MINIAGENT_TRAE_ACP_ARGS="--yolo --query-timeout 5m"
```

## Trae Configuration

Trae CLI `0.120.27` exits during ACP `session/new` when no model configuration is available. Configure Trae before using it through MiniAgent. Current Trae builds use the user config path `~/.trae/trae_cli.yaml`; project config behavior can vary by Trae release, so verify with `traecli config edit`.

Example model config with environment placeholders:

```yaml
model:
  name: claude-sonnet
models:
  - name: claude-sonnet
    description: Claude Sonnet
    context_window: 200000
    claude:
      model: claude-sonnet-4-20250514
      api_key: ${ANTHROPIC_API_KEY}
      max_tokens: 8192
```

Do not commit real API keys. Prefer environment variables or the provider-specific auth flow.

## Verification

Run local contract tests:

```bash
npm run typecheck
npx vitest run tests/runtime/acp-runtime-driver.test.ts tests/runtime/real-acp-smoke.test.ts
```

Run real agent smoke tests only on a machine with all three agents configured:

```bash
MINIAGENT_REAL_ACP_SMOKE=1 npm exec vitest run tests/runtime/real-acp-smoke.test.ts
```

If a real ACP process crashes, MiniAgent stores recent stderr in the run `stopReason` and also appends `runtime_stderr` events for diagnosis.
