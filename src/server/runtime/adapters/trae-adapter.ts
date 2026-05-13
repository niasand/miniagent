import type { CommandRunner } from "../command-runner.js";
import { BaseCliRuntimeAdapter } from "./base-cli-adapter.js";

export class TraeRuntimeAdapter extends BaseCliRuntimeAdapter {
  constructor(options: { commandRunner?: CommandRunner; command?: string } = {}) {
    super({
      agentType: "trae",
      displayName: "Trae CLI",
      command: options.command ?? "trae",
      commandRunner: options.commandRunner,
    });
  }
}
