import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspacePolicy, normalizeWorkspacePath } from "../src/server/security/workspace-policy.js";

describe("WorkspacePolicy", () => {
  it("allows a path inside the allowlist root", () => {
    const root = mkdtempSync(join(tmpdir(), "wf-root-"));
    const policy = new WorkspacePolicy([root]);
    expect(policy.evaluate(join(root, "sub", "dir")).allowed).toBe(true);
  });

  it("allows the allowlist root itself", () => {
    const root = mkdtempSync(join(tmpdir(), "wf-root-"));
    const policy = new WorkspacePolicy([root]);
    expect(policy.evaluate(root).allowed).toBe(true);
  });

  it("denies a path outside the allowlist", () => {
    const root = mkdtempSync(join(tmpdir(), "wf-root-"));
    const policy = new WorkspacePolicy([root]);
    expect(policy.evaluate("/definitely/outside").allowed).toBe(false);
  });

  it("denies everything when the allowlist is empty", () => {
    const policy = new WorkspacePolicy([]);
    expect(policy.evaluate("/anything").allowed).toBe(false);
  });

  it("normalizeWorkspacePath lexically resolves a path", () => {
    expect(normalizeWorkspacePath("/foo/bar")).toBe("/foo/bar");
  });

  it("matches a differently-cased path on case-insensitive FS", () => {
    // Create a dir with a known-case name; flip the case of one segment. On
    // macOS/Windows the flipped path is the same directory (same inode); on
    // case-sensitive Linux it doesn't exist, so skip rather than assert.
    const base = mkdtempSync(join(tmpdir(), "wf-"));
    const root = join(base, "MyRoot");
    mkdirSync(root);
    const flipped = join(base, "myroot");
    let sameInode = false;
    try {
      sameInode = statSync(root).ino === statSync(flipped).ino;
    } catch {
      sameInode = false;
    }
    if (sameInode) {
      const policy = new WorkspacePolicy([root]);
      expect(policy.evaluate(flipped).allowed).toBe(true);
    }
  });
});
