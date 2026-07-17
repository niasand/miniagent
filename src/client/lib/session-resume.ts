/**
 * Build the terminal resume command shown on a session card's copy button.
 * Pure function — no React — so it is trivially unit-testable.
 *
 * The command resumes the Claude Code CLI session that backs this MiniAgent
 * session: `cd "<workspace>" && claude resume <externalSessionId>`.
 */
export type ResumeCommandResult = {
  /** Empty string when disabled. */
  command: string;
  enabled: boolean;
  disabledReason: string | null;
};

export function buildResumeCommand(input: {
  agentType: string;
  externalSessionId: string | null;
  workspace: string;
}): ResumeCommandResult {
  // Order matters: the most fundamental blocker wins the tooltip.
  if (input.agentType !== "claude") {
    return { command: "", enabled: false, disabledReason: "非 Claude 会话" };
  }
  if (!input.externalSessionId) {
    return { command: "", enabled: false, disabledReason: "无 Claude session id" };
  }
  if (!input.workspace) {
    return { command: "", enabled: false, disabledReason: "无工作目录" };
  }
  return {
    command: `cd ${input.workspace} && claude resume ${input.externalSessionId}`,
    enabled: true,
    disabledReason: null,
  };
}
