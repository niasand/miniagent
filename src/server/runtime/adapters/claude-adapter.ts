import type { CommandRunner } from "../command-runner.js";
import { BaseCliRuntimeAdapter } from "./base-cli-adapter.js";

export class ClaudeRuntimeAdapter extends BaseCliRuntimeAdapter {
  constructor(options: { commandRunner?: CommandRunner; command?: string } = {}) {
    super({
      agentType: "claude",
      displayName: "Claude Code",
      command: options.command ?? "claude",
      commandRunner: options.commandRunner,
      capabilities: {
        nativeCompact: true,
        permissionPrompt: true,
      },
    });
  }
}
