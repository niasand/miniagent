import type { CommandRunner } from "../command-runner.js";
import { BaseCliRuntimeAdapter } from "./base-cli-adapter.js";

export class CodexRuntimeAdapter extends BaseCliRuntimeAdapter {
  constructor(options: { commandRunner?: CommandRunner; command?: string } = {}) {
    super({
      agentType: "codex",
      displayName: "Codex CLI",
      command: options.command ?? "codex",
      commandRunner: options.commandRunner,
      capabilities: {
        permissionPrompt: true,
      },
    });
  }
}
