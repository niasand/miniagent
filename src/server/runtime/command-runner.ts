import { spawnSync } from "node:child_process";

export type CommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  errorCode?: string;
  errorMessage?: string;
};

export interface CommandRunner {
  run(command: string, args: string[], options?: { cwd?: string; timeoutMs?: number }): CommandResult;
}

export class DefaultCommandRunner implements CommandRunner {
  run(command: string, args: string[], options: { cwd?: string; timeoutMs?: number } = {}): CommandResult {
    const result = spawnSync(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      timeout: options.timeoutMs ?? 2_000,
    });

    return {
      exitCode: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      errorCode: result.error ? readErrorCode(result.error) : undefined,
      errorMessage: result.error?.message,
    };
  }
}

function readErrorCode(error: Error): string | undefined {
  return "code" in error && typeof error.code === "string" ? error.code : undefined;
}
