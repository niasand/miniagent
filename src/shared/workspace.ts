export type WorkspaceAgentType = "codex" | "claude" | "trae";
export type WorkspaceAgentLabel = "Codex" | "Claude" | "Trae";
export type WorkspaceAgentHealthStatus = "unknown" | "healthy" | "missing" | "auth_required" | "failed";
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
  contextBudget: WorkspaceContextBudget;
};

export type WorkspaceEvent = {
  globalSeq: number;
  id: string;
  sessionId: string;
  runId: string | null;
  taskId: string | null;
  runSeq: number | null;
  type: string;
  payload: unknown;
  createdAt: string;
};

export type QueryEventsResponse = {
  events: WorkspaceEvent[];
};

export type WorkspaceContextBudget = {
  status: "healthy" | "warning" | "critical" | "overflow";
  tokenEstimate: number;
  budgetTokens: number;
  usagePercent: number;
  warningPercent: number;
  criticalPercent: number;
  overflowPercent: number;
  currentContextPackId: string | null;
  lastCompactedAt: string | null;
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

export type WorkspaceAgentRuntime = {
  agentType: WorkspaceAgentType;
  label: string;
  status: WorkspaceAgentHealthStatus;
  command: string;
  version: string | null;
  message: string | null;
  checkedAt: string;
  capabilities: Record<string, boolean>;
};

export type AgentsResponse = {
  agents: WorkspaceAgentRuntime[];
};

export type AgentDefaultScopeType = "user" | "channel" | "workspace" | "system";

export type AgentDefault = {
  id: string;
  scopeType: AgentDefaultScopeType;
  scopeRef: string;
  agentType: WorkspaceAgentType;
  params: unknown;
  updatedAt: string;
};

export type SetAgentDefaultRequest = {
  scopeType: AgentDefaultScopeType;
  scopeRef: string;
  agentType: WorkspaceAgentType;
  params?: Record<string, unknown>;
};

export type SetAgentDefaultResponse = {
  default: AgentDefault;
};

export type ResolveAgentDefaultResponse = {
  default: AgentDefault;
};

export type StartRunResponse = {
  taskId: string;
  runId: string;
  status: string;
  workspace: WorkspaceSnapshot;
};

export type StopRunResponse = {
  runId: string;
  status: string;
  workspace: WorkspaceSnapshot;
};

export type CompactContextRequest = {
  actorType?: WorkspaceActorType;
  budgetTokens?: number;
};

export type CompactContextResponse = {
  contextPackId: string;
  eventId: string;
  contextBudget: WorkspaceContextBudget;
  workspace: WorkspaceSnapshot;
};

export type RestartContextRequest = {
  actorType?: WorkspaceActorType;
  actorRef?: string | null;
};

export type RestartContextResponse = {
  contextPackId: string;
  taskId: string;
  eventId: string;
  workspace: WorkspaceSnapshot;
};

export type WorkspaceScheduleKind = "once" | "cron";
export type WorkspaceScheduleStatus = "active" | "paused" | "cancelled";

export type WorkspaceSchedule = {
  id: string;
  sessionId: string;
  status: WorkspaceScheduleStatus;
  kind: WorkspaceScheduleKind;
  cronExpr: string | null;
  runAt: string | null;
  timezone: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
};

export type CreateScheduleRequest = {
  sessionId: string;
  kind: WorkspaceScheduleKind;
  cronExpr?: string | null;
  runAt?: string | null;
  timezone?: string;
  payload?: Record<string, unknown>;
  actorType?: WorkspaceActorType;
  actorRef?: string | null;
};

export type CreateScheduleResponse = {
  schedule: WorkspaceSchedule;
};

export type ListSchedulesResponse = {
  schedules: WorkspaceSchedule[];
};

export type UpdateScheduleResponse = {
  schedule: WorkspaceSchedule;
};

export type RunDueSchedulesResponse = {
  triggered: Array<{
    schedule: WorkspaceSchedule;
    taskId: string;
  }>;
  workspace: WorkspaceSnapshot;
};

export type MemoryArchive = {
  id: string;
  sessionId: string;
  archiveDate: string;
  sourceGlobalSeqStart: number;
  sourceGlobalSeqEnd: number;
  summary: unknown;
  updatedAt: string;
};

export type CreateMemoryArchiveRequest = {
  archiveDate: string;
};

export type CreateMemoryArchiveResponse = {
  archive: MemoryArchive;
  eventId: string;
};

export type ListMemoryArchivesResponse = {
  archives: MemoryArchive[];
};

export type DangerousOperationRisk = "medium" | "high" | "critical";

export type OperationConfirmation = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  riskLevel: DangerousOperationRisk;
  prompt: string;
  payload: unknown;
  status: "pending" | "confirmed" | "expired" | "consumed" | "cancelled";
  actorType: "web_user" | "feishu_user" | "system" | "agent";
  actorRef: string | null;
  requestedAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  consumedAt: string | null;
};

export type CreateOperationConfirmationResponse = {
  confirmation: OperationConfirmation;
  token: string;
};

export type ConfirmOperationResponse = {
  confirmation: OperationConfirmation;
};

export type ControlToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ListControlToolsResponse = {
  tools: ControlToolDescriptor[];
};

export type CallControlToolRequest = {
  name: string;
  args?: Record<string, unknown>;
};

export type CallControlToolResponse = {
  name: string;
  result: unknown;
};
