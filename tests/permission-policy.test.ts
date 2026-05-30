import { describe, it, expect } from "vitest";
import { resolvePermissionPolicy } from "../src/server/runtime/permission-policy.js";

describe("resolvePermissionPolicy", () => {
  it("web defaults to wait", () => {
    expect(resolvePermissionPolicy("web")).toBe("wait");
  });

  it("qq defaults to auto_approve", () => {
    expect(resolvePermissionPolicy("qq")).toBe("auto_approve");
  });

  it("telegram defaults to auto_approve", () => {
    expect(resolvePermissionPolicy("telegram")).toBe("auto_approve");
  });

  it("unknown channel defaults to auto_approve", () => {
    expect(resolvePermissionPolicy("discord")).toBe("auto_approve");
    expect(resolvePermissionPolicy("wechat")).toBe("auto_approve");
  });

  it("null channelType defaults to auto_approve", () => {
    expect(resolvePermissionPolicy(null)).toBe("auto_approve");
  });

  it("override web → auto_approve", () => {
    expect(resolvePermissionPolicy("web", { web: "auto_approve" })).toBe("auto_approve");
  });

  it("override qq → wait", () => {
    expect(resolvePermissionPolicy("qq", { qq: "wait" })).toBe("wait");
  });

  it("override only affects specified channel", () => {
    expect(resolvePermissionPolicy("qq", { telegram: "wait" })).toBe("auto_approve");
    expect(resolvePermissionPolicy("web", { telegram: "wait" })).toBe("wait");
  });
});
