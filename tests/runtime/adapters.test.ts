import { describe, expect, it } from "vitest";
import type { CommandResult, CommandRunner } from "../../src/server/runtime/command-runner.js";
import { ClaudeRuntimeAdapter } from "../../src/server/runtime/adapters/claude-adapter.js";
import { CodexRuntimeAdapter } from "../../src/server/runtime/adapters/codex-adapter.js";
import { TraeRuntimeAdapter } from "../../src/server/runtime/adapters/trae-adapter.js";
import { RuntimeAdapterRegistry } from "../../src/server/runtime/registry.js";

describe("runtime adapters", () => {
  it("registers Codex, Claude, and Trae adapters", () => {
    const registry = new RuntimeAdapterRegistry([
      new CodexRuntimeAdapter({ commandRunner: healthyRunner("codex 1.0.0") }),
      new ClaudeRuntimeAdapter({ commandRunner: healthyRunner("claude 2.0.0") }),
      new TraeRuntimeAdapter({ commandRunner: healthyRunner("trae 3.0.0") }),
    ]);

    expect(registry.list().map((adapter) => adapter.agentType)).toEqual(["codex", "claude", "trae"]);
    expect(registry.get("codex").displayName).toBe("Codex CLI");
    expect(registry.get("claude").capabilities()).toMatchObject({ nativeCompact: true });
  });

  it("probes command health without requiring real CLIs in tests", async () => {
    const healthy = new CodexRuntimeAdapter({ commandRunner: healthyRunner("codex 1.0.0") });
    const missing = new CodexRuntimeAdapter({ commandRunner: missingRunner() });
    const authRequired = new ClaudeRuntimeAdapter({ commandRunner: failedRunner("authentication required") });

    await expect(healthy.probe()).resolves.toMatchObject({
      agentType: "codex",
      status: "healthy",
      version: "codex 1.0.0",
    });
    await expect(missing.probe()).resolves.toMatchObject({
      status: "missing",
      message: "codex was not found on PATH",
    });
    await expect(authRequired.probe()).resolves.toMatchObject({
      agentType: "claude",
      status: "auth_required",
    });
  });

  it("creates launch specs from session context without persisting secret env values", () => {
    const adapter = new CodexRuntimeAdapter({ commandRunner: healthyRunner("codex 1.0.0") });

    const spec = adapter.createLaunchSpec({
      session: {
        id: "session-1",
        agentType: "codex",
        workspacePath: "/tmp/miniagent-test",
        defaultParams: { args: ["--json"] },
      },
      task: { id: "task-1", type: "message", input: { text: "hello" } },
      run: { id: "run-1" },
    });

    expect(spec).toEqual({
      agentType: "codex",
      command: "codex",
      args: ["--json"],
      cwd: "/tmp/miniagent-test",
      env: {},
      envSummary: {},
    });
  });

  it("encodes input and decodes stdout/stderr into runtime event drafts", () => {
    const adapter = new TraeRuntimeAdapter({ commandRunner: healthyRunner("trae 3.0.0") });

    expect(adapter.encodeInput({ taskType: "message", input: { text: "hello" } })).toBe("hello\n");
    expect(
      adapter.decodeOutput({
        stream: "stdout",
        text: "streamed text",
        receivedAt: "2026-05-13T00:00:00.000Z",
      }),
    ).toEqual([
      {
        type: "text_delta",
        payload: { text: "streamed text", receivedAt: "2026-05-13T00:00:00.000Z" },
      },
    ]);
    expect(
      adapter.decodeOutput({
        stream: "stderr",
        text: "warning",
        receivedAt: "2026-05-13T00:00:01.000Z",
      }),
    ).toEqual([
      {
        type: "runtime_stderr",
        payload: { text: "warning", receivedAt: "2026-05-13T00:00:01.000Z" },
      },
    ]);
  });

  it("classifies common runtime failures", () => {
    const adapter = new CodexRuntimeAdapter({ commandRunner: healthyRunner("codex 1.0.0") });

    expect(adapter.classifyError(new Error("context length limit exceeded"))).toMatchObject({
      class: "context_overflow",
      retryable: true,
    });
    expect(adapter.classifyError(new Error("login required"))).toMatchObject({
      class: "authentication_failed",
      retryable: false,
    });
    expect(adapter.classifyError(new Error("process exited with SIGTERM"))).toMatchObject({
      class: "user_cancelled",
      retryable: false,
    });
  });
});

function healthyRunner(stdout: string): CommandRunner {
  return runner({ exitCode: 0, stdout, stderr: "" });
}

function missingRunner(): CommandRunner {
  return runner({ exitCode: null, stdout: "", stderr: "", errorCode: "ENOENT", errorMessage: "not found" });
}

function failedRunner(stderr: string): CommandRunner {
  return runner({ exitCode: 1, stdout: "", stderr });
}

function runner(result: CommandResult): CommandRunner {
  return {
    run: () => result,
  };
}
