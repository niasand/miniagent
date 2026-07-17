import { describe, it, expect } from "vitest";
import { buildResumeCommand } from "../src/client/lib/session-resume.js";

describe("buildResumeCommand", () => {
  it("builds the resume command for a claude session with workspace + external id", () => {
    const result = buildResumeCommand({ agentType: "claude", externalSessionId: "abc-123", workspace: "/proj/app" });
    expect(result).toEqual({
      command: `cd /proj/app && claude resume abc-123`,
      enabled: true,
      disabledReason: null,
    });
  });

  it("disables when agentType is not claude", () => {
    const result = buildResumeCommand({ agentType: "codex", externalSessionId: "abc", workspace: "/p" });
    expect(result.enabled).toBe(false);
    expect(result.command).toBe("");
    expect(result.disabledReason).toBe("非 Claude 会话");
  });

  it("disables when externalSessionId is missing", () => {
    const result = buildResumeCommand({ agentType: "claude", externalSessionId: null, workspace: "/p" });
    expect(result.enabled).toBe(false);
    expect(result.disabledReason).toBe("无 Claude session id");
  });

  it("disables when workspace is missing", () => {
    const result = buildResumeCommand({ agentType: "claude", externalSessionId: "abc", workspace: "" });
    expect(result.enabled).toBe(false);
    expect(result.disabledReason).toBe("无工作目录");
  });

  it("checks agentType before externalSessionId (order matters)", () => {
    const result = buildResumeCommand({ agentType: "codex", externalSessionId: null, workspace: "" });
    expect(result.disabledReason).toBe("非 Claude 会话");
  });
});
