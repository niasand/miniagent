import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

export type WorkspacePolicyDecision =
  | {
      allowed: true;
      normalizedPath: string;
    }
  | {
      allowed: false;
      normalizedPath: string;
      reason: string;
      allowlist: string[];
    };

export class WorkspacePolicyError extends Error {
  constructor(
    readonly workspacePath: string,
    readonly normalizedPath: string,
    readonly allowlist: string[],
    readonly reason: string,
  ) {
    super(`Workspace denied: ${reason}`);
  }
}

export class WorkspacePolicy {
  readonly allowlist: string[];

  constructor(allowlist: string[]) {
    this.allowlist = normalizeAllowlist(allowlist);
  }

  static fromEnvironment(fallbackAllowlist: string[]): WorkspacePolicy {
    const envAllowlist = process.env.WORKSPACE_ALLOWLIST;
    return new WorkspacePolicy(envAllowlist ? splitAllowlist(envAllowlist) : fallbackAllowlist);
  }

  assertAllowed(workspacePath: string): string {
    const decision = this.evaluate(workspacePath);
    if (decision.allowed) {
      return decision.normalizedPath;
    }
    throw new WorkspacePolicyError(workspacePath, decision.normalizedPath, decision.allowlist, decision.reason);
  }

  evaluate(workspacePath: string): WorkspacePolicyDecision {
    const normalizedPath = normalizeWorkspacePath(workspacePath);
    if (this.allowlist.length === 0) {
      return {
        allowed: false,
        normalizedPath,
        reason: "WORKSPACE_ALLOWLIST is empty",
        allowlist: [],
      };
    }
    if (this.allowlist.some((root) => containsPath(root, normalizedPath))) {
      return { allowed: true, normalizedPath };
    }
    return {
      allowed: false,
      normalizedPath,
      reason: `${normalizedPath} is outside WORKSPACE_ALLOWLIST`,
      allowlist: this.allowlist,
    };
  }
}

export function normalizeWorkspacePath(workspacePath: string): string {
  const trimmed = workspacePath.trim();
  if (!trimmed) {
    throw new WorkspacePolicyError(workspacePath, "", [], "workspace path is required");
  }

  return resolve(expandHome(trimmed));
}

export function splitAllowlist(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeAllowlist(allowlist: string[]): string[] {
  const normalized = allowlist.map((entry) => normalizeWorkspacePath(entry));
  return [...new Set(normalized)];
}

function expandHome(value: string): string {
  if (value === "~") {
    return homedir();
  }
  if (value.startsWith("~/")) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

function containsPath(root: string, child: string): boolean {
  const distance = relative(root, child);
  return distance === "" || (!distance.startsWith("..") && !isAbsolute(distance));
}
