import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DefaultAgentService } from "../../src/server/agents/default-agent-service.js";
import { createTestDatabase, type TestDatabase } from "../support/db.js";

describe("DefaultAgentService", () => {
  let testDb: TestDatabase;
  let service: DefaultAgentService;

  beforeEach(() => {
    testDb = createTestDatabase();
    service = new DefaultAgentService(testDb.db);
  });

  afterEach(() => {
    testDb.close();
  });

  it("resolves defaults by user, channel, workspace, then system", () => {
    service.setDefault({ scopeType: "workspace", scopeRef: "/tmp/project", agentType: "claude" });
    service.setDefault({ scopeType: "channel", scopeRef: "chat-1", agentType: "trae" });
    service.setDefault({ scopeType: "user", scopeRef: "user-1", agentType: "codex" });

    expect(
      service.resolve({
        userRef: "user-1",
        channelRef: "chat-1",
        workspacePath: "/tmp/project",
      }),
    ).toMatchObject({ scopeType: "user", scopeRef: "user-1", agentType: "codex" });
    expect(
      service.resolve({
        channelRef: "chat-1",
        workspacePath: "/tmp/project",
      }),
    ).toMatchObject({ scopeType: "channel", scopeRef: "chat-1", agentType: "trae" });
    expect(service.resolve({ workspacePath: "/tmp/project" })).toMatchObject({
      scopeType: "workspace",
      scopeRef: "/tmp/project",
      agentType: "claude",
    });
    expect(service.resolve()).toMatchObject({
      scopeType: "system",
      scopeRef: "global",
      agentType: "codex",
    });
  });

  it("updates an existing default without creating a duplicate scope", () => {
    service.setDefault({ scopeType: "channel", scopeRef: "chat-1", agentType: "claude" });
    const updated = service.setDefault({ scopeType: "channel", scopeRef: "chat-1", agentType: "trae" });

    expect(updated).toMatchObject({
      scopeType: "channel",
      scopeRef: "chat-1",
      agentType: "trae",
    });
    expect(countDefaults("channel", "chat-1")).toBe(1);
  });

  function countDefaults(scopeType: string, scopeRef: string): number {
    return (
      testDb.db
        .prepare("SELECT COUNT(*) AS count FROM agent_defaults WHERE scope_type = ? AND scope_ref = ?")
        .get(scopeType, scopeRef) as { count: number }
    ).count;
  }
});
