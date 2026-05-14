import { afterEach, describe, expect, it } from "vitest";
import { EventStore } from "../../src/server/events/event-store.js";
import { AcpRuntimeDriver } from "../../src/server/runtime/drivers/acp-runtime-driver.js";
import { PermissionRequestStore } from "../../src/server/runtime/permission-request-store.js";
import { RuntimeAdapterRegistry } from "../../src/server/runtime/registry.js";
import { RuntimeSupervisor } from "../../src/server/runtime/runtime-supervisor.js";
import type { AgentType } from "../../src/server/runtime/types.js";
import { SessionStore, type AgentRunRecord } from "../../src/server/sessions/session-store.js";
import { createTestDatabase, type TestDatabase } from "../support/db.js";

const runRealAcpSmoke = process.env.MINIAGENT_REAL_ACP_SMOKE === "1";
const describeRealAcp = runRealAcpSmoke ? describe : describe.skip;

describeRealAcp("real ACP runtime smoke", () => {
  let testDb: TestDatabase | null = null;

  afterEach(() => {
    testDb?.close();
    testDb = null;
  });

  it("starts Codex, Claude, and Trae through ACP", async () => {
    testDb = createTestDatabase();
    const eventStore = new EventStore(testDb.db);
    const sessionStore = new SessionStore(testDb.db, eventStore);
    const supervisor = new RuntimeSupervisor({
      adapterRegistry: new RuntimeAdapterRegistry([
        makeDriver("codex", "Codex ACP", process.env.MINIAGENT_CODEX_ACP_COMMAND ?? "codex", "MINIAGENT_CODEX_ACP_ARGS"),
        makeDriver(
          "claude",
          "Claude ACP",
          process.env.MINIAGENT_CLAUDE_ACP_COMMAND ?? "claude",
          "MINIAGENT_CLAUDE_ACP_ARGS",
        ),
        makeDriver("trae", "Trae ACP", process.env.MINIAGENT_TRAE_ACP_COMMAND ?? "trae", "MINIAGENT_TRAE_ACP_ARGS"),
      ]),
      eventStore,
      permissionRequestStore: new PermissionRequestStore(testDb.db),
      sessionStore,
      maxTextDeltaBytes: 10_000,
      cancelKillTimeoutMs: 1_000,
    });

    for (const agentType of ["codex", "claude", "trae"] as AgentType[]) {
      const sessionId = `session-${agentType}`;
      const taskId = `task-${agentType}`;
      sessionStore.createSession({
        id: sessionId,
        title: `${agentType} ACP smoke`,
        agentType,
        workspacePath: "/tmp",
        defaultParams: { runtimeKind: "acp" },
      });
      sessionStore.createTask({
        id: taskId,
        sessionId,
        sourceType: "system",
        type: "message",
        input: { text: "Reply with the word pong." },
      });

      const started = supervisor.startTask({ sessionId, taskId });
      supervisor.sendInput(started.run.id, { taskType: "message", input: { text: "Reply with the word pong." } });
      const run = await waitForTerminalRun(sessionStore, supervisor, started.run.id);

      expect(run.status).toBe("succeeded");
      expect(run.runtimeKind).toBe("acp");
      expect(run.externalSessionId).toBeTruthy();
    }
  }, 60_000);
});

function makeDriver(agentType: AgentType, displayName: string, command: string, argsEnvName: string): AcpRuntimeDriver {
  return new AcpRuntimeDriver({
    agentType,
    displayName,
    command,
    defaultArgs: readEnvArgs(argsEnvName),
    requestTimeoutMs: 5_000,
  });
}

async function waitForTerminalRun(
  sessionStore: SessionStore,
  supervisor: RuntimeSupervisor,
  runId: string,
): Promise<AgentRunRecord> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    const run = sessionStore.getRun(runId);
    if (run && ["succeeded", "failed", "cancelled", "overflowed"].includes(run.status)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  try {
    supervisor.stop(runId);
  } catch {
    // The run may already have exited between polling attempts.
  }
  throw new Error(`Timed out waiting for ACP smoke run: ${runId}`);
}

function readEnvArgs(name: string): string[] {
  const value = process.env[name];
  return value ? value.split(" ").map((item) => item.trim()).filter(Boolean) : [];
}
