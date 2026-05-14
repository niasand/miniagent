import { describe, expect, it } from "vitest";
import { ClaudeRuntimeAdapter } from "../../src/server/runtime/adapters/claude-adapter.js";
import { CodexRuntimeAdapter } from "../../src/server/runtime/adapters/codex-adapter.js";
import { TraeRuntimeAdapter } from "../../src/server/runtime/adapters/trae-adapter.js";

const runRealCliSmoke = process.env.MINIAGENT_REAL_CLI_SMOKE === "1";
const describeRealCli = runRealCliSmoke ? describe : describe.skip;

describeRealCli("real CLI adapter smoke", () => {
  it("probes Codex CLI, Claude Code, and Trae CLI on this machine", async () => {
    const adapters = [new CodexRuntimeAdapter(), new ClaudeRuntimeAdapter(), new TraeRuntimeAdapter()];
    const probes = await Promise.all(adapters.map((adapter) => adapter.probe()));

    expect(probes.map((probe) => probe.agentType)).toEqual(["codex", "claude", "trae"]);
    for (const probe of probes) {
      expect(["healthy", "missing", "auth_required", "failed"]).toContain(probe.status);
      expect(probe.command).toBeTruthy();
      expect(probe.checkedAt).toBeTruthy();
    }
  });
});
