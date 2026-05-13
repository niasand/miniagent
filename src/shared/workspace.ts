export type WorkspaceAgentLabel = "Codex" | "Claude" | "Trae";

export type WorkspaceSessionStatus = "running" | "compact" | "queued" | "idle" | "archived" | "failed";

export type WorkspaceSessionSummary = {
  id: string;
  title: string;
  agent: WorkspaceAgentLabel;
  initials: string;
  workspace: string;
  status: WorkspaceSessionStatus;
  handoff?: string;
};

export type WorkspaceMessage = {
  id: string;
  role: "user" | "agent" | "tool" | "system";
  author: string;
  time?: string;
  badge?: string;
  markdown: string;
};

export type WorkspaceSnapshot = {
  sessions: WorkspaceSessionSummary[];
  messages: WorkspaceMessage[];
  outboxRows: Array<[string, string, string]>;
  keyEvents: Array<[string, string, string]>;
};
