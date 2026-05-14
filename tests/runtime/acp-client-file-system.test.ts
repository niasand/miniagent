import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AcpClientFileSystem } from "../../src/server/runtime/acp/client-file-system.js";

describe("AcpClientFileSystem", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads selected lines inside the workspace and redacts secrets", () => {
    const workspace = createTempWorkspace();
    const filePath = join(workspace, "app.env");
    writeFileSync(filePath, "first\napi_key=secret-value\nthird", "utf8");

    const fs = new AcpClientFileSystem({ workspacePath: workspace });

    expect(fs.readTextFile({ sessionId: "acp-session", path: filePath, line: 2, limit: 1 })).toEqual({
      content: "api_key=[REDACTED]",
    });
  });

  it("rejects file reads outside the workspace", () => {
    const workspace = createTempWorkspace();
    const outside = createTempWorkspace();
    const outsideFile = join(outside, "secret.txt");
    writeFileSync(outsideFile, "secret", "utf8");

    const fs = new AcpClientFileSystem({ workspacePath: workspace });

    expect(() => fs.readTextFile({ sessionId: "acp-session", path: outsideFile })).toThrow("Workspace denied");
  });

  function createTempWorkspace(): string {
    const dir = mkdtempSync(join(tmpdir(), "miniagent-acp-fs-"));
    tempDirs.push(dir);
    return dir;
  }
});
