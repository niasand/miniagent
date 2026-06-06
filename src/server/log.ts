import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Redirect console.log / console.error to append to log files.
 * Call once at startup, before any other imports that produce output.
 *
 * Logs land in <projectRoot>/logs/api-out.log and api-error.log.
 * Also echoes to the original stdout/stderr so nohup / pmctl still work.
 */
export function initFileLogging(projectRoot: string): void {
  const logDir = join(resolve(projectRoot), "logs");
  mkdirSync(logDir, { recursive: true });

  const outPath = join(logDir, "api-out.log");
  const errPath = join(logDir, "api-error.log");

  const originalLog = console.log.bind(console);
  const originalError = console.error.bind(console);

  console.log = (...args: unknown[]) => {
    const line = formatLine(args);
    try { appendFileSync(outPath, line + "\n"); } catch { /* ignore */ }
    originalLog(...args);
  };

  console.error = (...args: unknown[]) => {
    const line = formatLine(args);
    try { appendFileSync(errPath, line + "\n"); } catch { /* ignore */ }
    originalError(...args);
  };
}

function formatLine(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return a.stack ?? a.message;
      return JSON.stringify(a);
    })
    .join(" ");
}
