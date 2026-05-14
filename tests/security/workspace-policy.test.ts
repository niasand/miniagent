import { describe, expect, it } from "vitest";
import { WorkspacePolicy, splitAllowlist } from "../../src/server/security/workspace-policy.js";

describe("WorkspacePolicy", () => {
  it("allows descendants of configured roots", () => {
    const policy = new WorkspacePolicy(["/tmp/miniagent"]);

    expect(policy.evaluate("/tmp/miniagent/project")).toMatchObject({
      allowed: true,
      normalizedPath: "/tmp/miniagent/project",
    });
  });

  it("rejects sibling paths with the same prefix", () => {
    const policy = new WorkspacePolicy(["/tmp/miniagent"]);

    expect(policy.evaluate("/tmp/miniagent-other")).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("outside WORKSPACE_ALLOWLIST"),
    });
    expect(() => policy.assertAllowed("/tmp/miniagent-other")).toThrow("Workspace denied");
  });

  it("splits environment allowlists without empty entries", () => {
    expect(splitAllowlist(" ~/Documents, /tmp/miniagent, ")).toEqual(["~/Documents", "/tmp/miniagent"]);
  });
});
