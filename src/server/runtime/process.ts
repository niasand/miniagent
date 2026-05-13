import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { RuntimeLaunchSpec, RuntimeOutputChunk } from "./types.js";
import { nowIso } from "../../shared/time.js";

export type RuntimeProcessExit = {
  exitCode: number | null;
  signal: string | null;
  message: string | null;
  exitedAt: string;
};

export interface RuntimeProcess {
  readonly pid: number | null;
  write(input: string): void;
  stop(signal?: string): void;
  onOutput(handler: (chunk: RuntimeOutputChunk) => void): void;
  onExit(handler: (exit: RuntimeProcessExit) => void): void;
}

export interface RuntimeProcessFactory {
  spawn(spec: RuntimeLaunchSpec): RuntimeProcess;
}

export class ChildProcessFactory implements RuntimeProcessFactory {
  spawn(spec: RuntimeLaunchSpec): RuntimeProcess {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      stdio: "pipe",
    });

    return new ChildRuntimeProcess(child);
  }
}

class ChildRuntimeProcess implements RuntimeProcess {
  private readonly outputHandlers = new Set<(chunk: RuntimeOutputChunk) => void>();
  private readonly exitHandlers = new Set<(exit: RuntimeProcessExit) => void>();
  private readonly pendingOutputs: RuntimeOutputChunk[] = [];
  private pendingExit: RuntimeProcessExit | null = null;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.child.stdout.on("data", (data: Buffer) => {
      this.emitOutput({ stream: "stdout", text: data.toString("utf8"), receivedAt: nowIso() });
    });
    this.child.stderr.on("data", (data: Buffer) => {
      this.emitOutput({ stream: "stderr", text: data.toString("utf8"), receivedAt: nowIso() });
    });
    this.child.on("exit", (exitCode, signal) => {
      this.emitExit({ exitCode, signal, message: null, exitedAt: nowIso() });
    });
    this.child.on("error", (error) => {
      this.emitExit({ exitCode: null, signal: null, message: error.message, exitedAt: nowIso() });
    });
  }

  get pid(): number | null {
    return this.child.pid ?? null;
  }

  write(input: string): void {
    this.child.stdin.write(input);
  }

  stop(signal = "SIGTERM"): void {
    this.child.kill(signal as NodeJS.Signals);
  }

  onOutput(handler: (chunk: RuntimeOutputChunk) => void): void {
    this.outputHandlers.add(handler);
    while (this.pendingOutputs.length > 0) {
      handler(this.pendingOutputs.shift() as RuntimeOutputChunk);
    }
  }

  onExit(handler: (exit: RuntimeProcessExit) => void): void {
    this.exitHandlers.add(handler);
    if (this.pendingExit) {
      handler(this.pendingExit);
    }
  }

  private emitOutput(chunk: RuntimeOutputChunk): void {
    if (this.outputHandlers.size === 0) {
      this.pendingOutputs.push(chunk);
      return;
    }

    for (const handler of this.outputHandlers) {
      handler(chunk);
    }
  }

  private emitExit(exit: RuntimeProcessExit): void {
    this.pendingExit = exit;
    if (this.exitHandlers.size === 0) {
      return;
    }

    for (const handler of this.exitHandlers) {
      handler(exit);
    }
  }
}
