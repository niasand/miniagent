import { readFileSync, statSync } from "node:fs";
import type { JsonObject, JsonValue } from "../../../shared/json.js";
import { redactString } from "../../security/redaction.js";
import { WorkspacePolicy } from "../../security/workspace-policy.js";

export type AcpClientFileSystemOptions = {
  workspacePath: string;
  maxBytes?: number;
};

export class AcpClientFileSystem {
  private readonly policy: WorkspacePolicy;
  private readonly maxBytes: number;

  constructor(options: AcpClientFileSystemOptions) {
    this.policy = new WorkspacePolicy([options.workspacePath]);
    this.maxBytes = options.maxBytes ?? 256 * 1024;
  }

  readTextFile(params: JsonValue): JsonObject {
    const object = asObject(params);
    const path = readString(object, "path");
    if (!path) {
      throw new Error("path is required");
    }

    const normalizedPath = this.policy.assertAllowed(path);
    const line = readPositiveInteger(object, "line");
    const limit = readPositiveInteger(object, "limit");
    const stat = statSync(normalizedPath);
    if (!stat.isFile()) {
      throw new Error(`Not a file: ${normalizedPath}`);
    }
    if (stat.size > this.maxBytes && limit === null) {
      throw new Error(`File is too large; retry with line and limit: ${normalizedPath}`);
    }

    const raw = readFileSync(normalizedPath, "utf8");
    const content = sliceLines(raw, line, limit);
    return {
      content: redactString(content),
    };
  }
}

function sliceLines(content: string, line: number | null, limit: number | null): string {
  if (line === null && limit === null) {
    return content;
  }

  const lines = content.split(/\r?\n/);
  const start = Math.max((line ?? 1) - 1, 0);
  const end = limit === null ? lines.length : start + limit;
  return lines.slice(start, end).join("\n");
}

function asObject(value: JsonValue): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readString(value: JsonObject, key: string): string | null {
  return typeof value[key] === "string" ? value[key] : null;
}

function readPositiveInteger(value: JsonObject, key: string): number | null {
  const candidate = value[key];
  return typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0 ? candidate : null;
}
