export type WorkspaceAgentType = "codex" | "claude" | "trae";
export type WorkspaceAgentLabel = "Codex" | "Claude" | "Trae";
export type WorkspaceRuntimeKind = "cli" | "acp";
export type WorkspaceAgentHealthStatus = "unknown" | "healthy" | "missing" | "auth_required" | "failed";
export type WorkspaceActorType = "web_user" | "feishu_user" | "qq_user" | "telegram_user" | "discord_user" | "system" | "agent";
export type WorkspaceChannelType = "web" | "feishu" | "qq" | "telegram" | "discord" | "wechat" | "wecom" | "dingtalk" | null;

export type WorkspaceSessionStatus = "running" | "compact" | "queued" | "idle" | "archived" | "failed";

export type WorkspaceSessionSummary = {
  id: string;
  name: string;
  title: string;
  agentType: WorkspaceAgentType;
  agent: WorkspaceAgentLabel;
  initials: string;
  workspace: string;
  channelType: WorkspaceChannelType;
  status: WorkspaceSessionStatus;
  updatedAt: string;
  handoff?: string;
};

export type WorkspaceMessage = {
  id: string;
  runId?: string | null;
  role: "user" | "agent" | "tool" | "system";
  author: string;
  time?: string;
  createdAt?: string;
  badge?: string;
  markdown: string;
};

export type WorkspaceRunStats = {
  durationSeconds: number | null;
  tokensUsed: number | null;
  tokensTotal: number | null;
};

export type WorkspaceSnapshot = {
  selectedSessionId: string | null;
  sessions: WorkspaceSessionSummary[];
  messages: WorkspaceMessage[];
  runStats: WorkspaceRunStats;
  outboxRows: Array<[string, string, string]>;
  keyEvents: Array<[string, string, string]>;
  contextBudget: WorkspaceContextBudget;
  runtime: WorkspaceRuntimeSummary;
};

export type WorkspaceRuntimeSummary = {
  activeRunId: string | null;
  status: string;
  pid: number | null;
  agentType: WorkspaceAgentType | null;
  runtimeKind: WorkspaceRuntimeKind | null;
  startedAt: string | null;
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
  runtimeKind?: WorkspaceRuntimeKind;
  workspacePath?: string;
};

export type CreateSessionResponse = {
  sessionId: string;
  workspace: WorkspaceSnapshot;
};

export type WorkspaceAgentRuntime = {
  agentType: WorkspaceAgentType;
  runtimeKind?: WorkspaceRuntimeKind;
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

export type RuntimePermissionRequest = {
  id: string;
  sessionId: string;
  runId: string;
  taskId: string | null;
  eventId: string | null;
  requestId: string | null;
  protocol: "acp" | "legacy_cli";
  status: "pending" | "approved" | "denied" | "cancelled" | "expired";
  prompt: string;
  options: unknown;
  toolCall: unknown;
  selectedOptionId: string | null;
  expiresAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ListRuntimePermissionsResponse = {
  permissions: RuntimePermissionRequest[];
};

export type RespondRuntimePermissionRequest = {
  outcome: "selected" | "cancelled";
  optionId?: string;
};

export type RespondRuntimePermissionResponse = ListRuntimePermissionsResponse;

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
  payloadText: string | null;
  payloadSummary: string | null;
  notificationTargets: WorkspaceScheduleNotificationTarget[];
  nextRunAt: string | null;
  lastRunAt: string | null;
};

export type WorkspaceScheduleNotificationTarget = {
  channelType: "qq" | "telegram";
  targetRef: string;
};

export type NotificationPreference = {
  id: string | null;
  scopeType: "user";
  scopeRef: string;
  targets: WorkspaceScheduleNotificationTarget[];
  updatedAt: string | null;
};

export type GetDefaultNotificationPreferenceResponse = {
  preference: NotificationPreference;
  latestPrivateTargets: WorkspaceScheduleNotificationTarget[];
};

export type BindDefaultNotificationPreferenceResponse = {
  preference: NotificationPreference;
};

export type WorkspaceScheduleRun = {
  id: string;
  scheduleId: string;
  sessionId: string;
  taskId: string | null;
  runId?: string | null;
  scheduledFor: string | null;
  payloadSummary: string | null;
  status: WorkspaceScheduleRunStatus;
  deliveries: WorkspaceScheduleRunDelivery[];
  error: string | null;
  createdAt: string;
};

export type WorkspaceScheduleRunDelivery = {
  channelType: "qq" | "telegram" | "feishu" | "discord" | "wechat" | "wecom" | "dingtalk";
  targetRef: string;
  status: "pending" | "sending" | "sent" | "failed" | "dead";
  lastError: string | null;
  sentAt: string | null;
};

export type WorkspaceScheduleRunStatus =
  | "scheduled"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "paused";

export type CreateScheduleRequest = {
  sessionId: string;
  kind: WorkspaceScheduleKind;
  cronExpr?: string | null;
  runAt?: string | null;
  timezone?: string;
  payload?: Record<string, unknown> & {
    notificationTargets?: WorkspaceScheduleNotificationTarget[];
  };
  actorType?: WorkspaceActorType;
  actorRef?: string | null;
};

export type CreateScheduleResponse = {
  schedule: WorkspaceSchedule;
};

export type ListSchedulesResponse = {
  schedules: WorkspaceSchedule[];
};

export type ListScheduleRunsResponse = {
  runs: WorkspaceScheduleRun[];
};

export type UpdateScheduleResponse = {
  schedule: WorkspaceSchedule;
};

export type UpdateScheduleRequest = {
  kind: WorkspaceScheduleKind;
  cronExpr?: string | null;
  runAt?: string | null;
  timezone?: string;
  payload?: Record<string, unknown> & {
    notificationTargets?: WorkspaceScheduleNotificationTarget[];
  };
  actorType?: WorkspaceActorType;
  actorRef?: string | null;
};

export type PreviewScheduleRequest = {
  kind: WorkspaceScheduleKind;
  cronExpr?: string | null;
  runAt?: string | null;
  timezone?: string;
};

export type PreviewScheduleResponse = {
  nextRunAt: string;
  timezone: string;
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
  actorType: "web_user" | "feishu_user" | "qq_user" | "telegram_user" | "discord_user" | "system" | "agent";
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
