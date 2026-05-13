export type WorkspaceAgentType = "codex" | "claude" | "trae";
export type WorkspaceAgentLabel = "Codex" | "Claude" | "Trae";
export type WorkspaceActorType = "web_user" | "feishu_user" | "system" | "agent";

export type WorkspaceSessionStatus = "running" | "compact" | "queued" | "idle" | "archived" | "failed";

export type WorkspaceSessionSummary = {
  id: string;
  title: string;
  agentType: WorkspaceAgentType;
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
  selectedSessionId: string | null;
  sessions: WorkspaceSessionSummary[];
  messages: WorkspaceMessage[];
  outboxRows: Array<[string, string, string]>;
  keyEvents: Array<[string, string, string]>;
};

export type CreateHandoffRequest = {
  targetAgentType: WorkspaceAgentType;
  actorType?: WorkspaceActorType;
  actorRef?: string | null;
  targetTitle?: string;
};

export type CreateHandoffResponse = {
  targetSessionId: string;
  targetTaskId: string;
  sourceContextPackId: string;
  requestedEventId: string;
  createdEventId: string;
  workspace: WorkspaceSnapshot;
};

export type SendMessageRequest = {
  text: string;
  actorRef?: string | null;
};

export type SendMessageResponse = {
  taskId: string;
  eventId: string;
  workspace: WorkspaceSnapshot;
};

export type CreateSessionRequest = {
  title?: string;
  agentType?: WorkspaceAgentType;
  workspacePath?: string;
};

export type CreateSessionResponse = {
  sessionId: string;
  workspace: WorkspaceSnapshot;
};
