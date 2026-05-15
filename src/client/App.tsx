import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Archive,
  ArrowRightLeft,
  Bot,
  Boxes,
  CircleDot,
  Folder,
  History,
  RefreshCw,
  SendHorizontal,
  ShieldCheck,
  ShieldX,
  Plus,
  Square,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { setAgentDefault } from "./api/agents.js";
import { compactSessionContext, restartSessionContext } from "./api/context.js";
import { fetchEvents } from "./api/events.js";
import { createHandoff } from "./api/handoff.js";
import { sendSessionMessage } from "./api/messages.js";
import { fetchRunPermissions, respondRunPermission, stopRun } from "./api/runtime.js";
import { createSession } from "./api/sessions.js";
import { fetchWorkspace } from "./api/workspace.js";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { fallbackWorkspace } from "./data/mock-workspace.js";
import { cn } from "./lib/utils.js";
import { useWorkspaceStore } from "./state/workspace-store.js";
import type {
  CreateSessionRequest,
  RuntimePermissionRequest,
  WorkspaceAgentType,
  WorkspaceEvent,
  WorkspaceRuntimeKind,
  WorkspaceSessionSummary,
} from "../shared/workspace.js";

const statusTone = {
  running: "green",
  compact: "amber",
  queued: "blue",
  idle: "default",
  archived: "default",
  failed: "red",
} as const;

const contextTone = {
  healthy: "green",
  warning: "amber",
  critical: "red",
  overflow: "red",
} as const;

const eventStreamTypes = [
  "task_created",
  "run_started",
  "text_delta",
  "runtime_stderr",
  "runtime_event",
  "tool_call",
  "tool_call_update",
  "acp_session_started",
  "acp_cancel_requested",
  "permission_prompt",
  "context_budget_changed",
  "context_pack_created",
  "memory_archive_created",
  "handoff_requested",
  "handoff_created",
  "delivery_succeeded",
  "delivery_failed",
  "run_finished",
  "run_failed",
];

export default function App() {
  const selectedSessionId = useWorkspaceStore((state) => state.selectedSessionId);
  const defaultAgentType = useWorkspaceStore((state) => state.defaultAgentType);
  const setSelectedSessionId = useWorkspaceStore((state) => state.setSelectedSessionId);
  const setDefaultAgentType = useWorkspaceStore((state) => state.setDefaultAgentType);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("Ask Codex to turn the data model into migrations...");
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const workspace = useQuery({
    queryKey: ["workspace", selectedSessionId],
    queryFn: () => fetchWorkspace(selectedSessionId),
    initialData: fallbackWorkspace,
    refetchInterval: 5_000,
    retry: 1,
  });
  const snapshot = workspace.data.sessions.length > 0 ? workspace.data : fallbackWorkspace;
  const selected =
    snapshot.sessions.find((session) => session.id === selectedSessionId) ??
    snapshot.sessions.find((session) => session.id === snapshot.selectedSessionId) ??
    snapshot.sessions[0];
  const hasRealSelectedSession = workspace.data.sessions.some((session) => session.id === selected.id);
  const eventHistory = useQuery({
    queryKey: ["events", selected.id],
    queryFn: () => fetchEvents(selected.id, 100),
    enabled: historyOpen && hasRealSelectedSession,
    retry: 1,
  });
  const permissions = useQuery({
    queryKey: ["permissions", snapshot.runtime.activeRunId],
    queryFn: () => fetchRunPermissions(snapshot.runtime.activeRunId as string),
    enabled: Boolean(snapshot.runtime.activeRunId),
    refetchInterval: snapshot.runtime.status === "waiting_permission" ? 1_000 : 5_000,
    retry: 1,
  });
  useWorkspaceEventStream(selected.id, hasRealSelectedSession);
  const respondPermission = useMutation({
    mutationFn: (input: { runId: string; requestId: string; outcome: "selected" | "cancelled"; optionId?: string }) =>
      respondRunPermission(input.runId, input.requestId, {
        outcome: input.outcome,
        optionId: input.optionId,
      }),
    onSuccess: (_response, variables) => {
      queryClient.invalidateQueries({ queryKey: ["permissions", variables.runId] });
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });
  const handoff = useMutation({
    mutationFn: (input: { sessionId: string; targetAgentType: WorkspaceAgentType }) =>
      createHandoff(input.sessionId, {
        targetAgentType: input.targetAgentType,
        actorType: "web_user",
    }),
    onSuccess: (response) => {
      queryClient.setQueryData(["workspace", response.workspace.selectedSessionId], response.workspace);
      setSelectedSessionId(response.targetSessionId);
    },
  });
  const compactContext = useMutation({
    mutationFn: (sessionId: string) => compactSessionContext(sessionId, { actorType: "web_user" }),
    onSuccess: (response) => {
      queryClient.setQueryData(["workspace", response.workspace.selectedSessionId], response.workspace);
    },
  });
  const defaultAgent = useMutation({
    mutationFn: (agentType: WorkspaceAgentType) =>
      setAgentDefault({
        scopeType: "system",
        scopeRef: "global",
        agentType,
      }),
    onMutate: (agentType) => {
      setDefaultAgentType(agentType);
    },
    onSuccess: (response) => {
      setDefaultAgentType(response.default.agentType);
    },
  });
  const restartContext = useMutation({
    mutationFn: (sessionId: string) => restartSessionContext(sessionId, { actorType: "web_user" }),
    onSuccess: (response) => {
      queryClient.setQueryData(["workspace", response.workspace.selectedSessionId], response.workspace);
    },
  });
  const stopRuntime = useMutation({
    mutationFn: (runId: string) => stopRun(runId),
    onSuccess: (response) => {
      queryClient.setQueryData(["workspace", response.workspace.selectedSessionId], response.workspace);
    },
  });
  const sendMessage = useMutation({
    mutationFn: async (input: {
      sessionId: string;
      text: string;
      hasRealSession: boolean;
      agentType: WorkspaceAgentType;
      title: string;
    }) => {
      const sessionId = input.hasRealSession
        ? input.sessionId
        : (
            await createSession({
              agentType: input.agentType,
              title: input.title,
            })
          ).sessionId;

      return sendSessionMessage(sessionId, {
        text: input.text,
      });
    },
    onSuccess: (response) => {
      queryClient.setQueryData(["workspace", response.workspace.selectedSessionId], response.workspace);
      if (response.workspace.selectedSessionId) {
        setSelectedSessionId(response.workspace.selectedSessionId);
      }
      setDraft("");
    },
  });
  const newSession = useMutation({
    mutationFn: (request: CreateSessionRequest) => createSession(request),
    onSuccess: (response) => {
      queryClient.setQueryData(["workspace", response.workspace.selectedSessionId], response.workspace);
      setSelectedSessionId(response.sessionId);
      setNewSessionOpen(false);
    },
  });

  return (
    <main className="min-h-screen bg-app text-foreground">
      <div className="app-shell">
        <Topbar
          creatingSession={newSession.isPending}
          defaultAgentType={defaultAgentType}
          defaultAgentError={defaultAgent.error?.message}
          onSelectDefaultAgent={(agentType) => defaultAgent.mutate(agentType)}
          onNewSession={() => setNewSessionOpen(true)}
        />
        <NewSessionDialog
          open={newSessionOpen}
          creating={newSession.isPending}
          defaultAgentType={defaultAgentType}
          error={newSession.error?.message}
          onClose={() => setNewSessionOpen(false)}
          onCreate={(request) => newSession.mutate(request)}
        />
        <RawHistoryDialog
          open={historyOpen}
          events={eventHistory.data?.events ?? []}
          error={eventHistory.error?.message}
          loading={eventHistory.isFetching}
          onClose={() => setHistoryOpen(false)}
        />
        <div className="deck">
          <Sidebar sessions={snapshot.sessions} selected={selected} />
          <Conversation
            selected={selected}
            contextBudget={snapshot.contextBudget}
            messages={snapshot.messages}
            draft={draft}
            sendError={sendMessage.error?.message}
            sending={sendMessage.isPending}
            onDraftChange={setDraft}
            onSend={() => {
              const text = draft.trim();
              if (text) {
                sendMessage.mutate({
                  sessionId: selected.id,
                  text,
                  hasRealSession: hasRealSelectedSession,
                  agentType: selected.agentType,
                  title: selected.title,
                });
              }
            }}
          />
          <RightRail
            selected={selected}
            runtime={snapshot.runtime}
            contextBudget={snapshot.contextBudget}
            outboxRows={snapshot.outboxRows}
            keyEvents={snapshot.keyEvents}
            permissions={permissions.data?.permissions ?? []}
            permissionsError={permissions.error?.message ?? respondPermission.error?.message}
            respondingPermissionId={
              respondPermission.isPending ? `${respondPermission.variables.runId}:${respondPermission.variables.requestId}` : null
            }
            compactError={compactContext.error?.message}
            compacting={compactContext.isPending}
            restartError={restartContext.error?.message}
            restarting={restartContext.isPending}
            stopError={stopRuntime.error?.message}
            stopping={stopRuntime.isPending}
            handoffError={handoff.error?.message}
            handoffPendingTarget={handoff.isPending ? handoff.variables?.targetAgentType ?? null : null}
            onCompact={() => {
              if (hasRealSelectedSession) {
                compactContext.mutate(selected.id);
              }
            }}
            onRestart={() => {
              if (hasRealSelectedSession) {
                restartContext.mutate(selected.id);
              }
            }}
            onViewHistory={() => setHistoryOpen(true)}
            onStopRun={(runId) => stopRuntime.mutate(runId)}
            onRespondPermission={(input) => respondPermission.mutate(input)}
            onHandoff={(targetAgentType) => handoff.mutate({ sessionId: selected.id, targetAgentType })}
          />
        </div>
      </div>
    </main>
  );
}

function useWorkspaceEventStream(sessionId: string, enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !sessionId || typeof EventSource === "undefined") {
      return;
    }

    let stopped = false;
    let cursor = 0;
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;

    const refreshWorkspace = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { globalSeq?: number };
        if (typeof payload.globalSeq === "number") {
          cursor = Math.max(cursor, payload.globalSeq);
        }
      } catch {
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
    };

    const connect = () => {
      source = new EventSource(
        `/api/events/stream?sessionId=${encodeURIComponent(sessionId)}&afterGlobalSeq=${cursor}&limit=100`,
      );
      for (const type of eventStreamTypes) {
        source.addEventListener(type, refreshWorkspace as EventListener);
      }
      source.onerror = () => {
        source?.close();
        if (!stopped) {
          reconnectTimer = window.setTimeout(connect, 1_500);
        }
      };
    };

    connect();

    return () => {
      stopped = true;
      source?.close();
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
    };
  }, [enabled, queryClient, sessionId]);
}

function Topbar({
  creatingSession,
  defaultAgentType,
  defaultAgentError,
  onSelectDefaultAgent,
  onNewSession,
}: {
  creatingSession: boolean;
  defaultAgentType: WorkspaceAgentType;
  defaultAgentError?: string;
  onSelectDefaultAgent: (agentType: WorkspaceAgentType) => void;
  onNewSession: () => void;
}) {
  const agentButtons: Array<{ agentType: WorkspaceAgentType; label: string }> = [
    { agentType: "codex", label: "Codex CLI" },
    { agentType: "claude", label: "Claude Code" },
    { agentType: "trae", label: "Trae CLI" },
  ];

  return (
    <header className="topbar">
      <div className="flex min-w-0 items-center gap-[11px]">
        <div className="brand-mark">
          <Boxes className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="text-lg font-semibold leading-tight">MiniAgent</h1>
            <Badge tone="blue">ACP default</Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">Local multi-agent control plane</p>
        </div>
      </div>
      <div className="grid justify-items-end gap-2">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {agentButtons.map((agent) => (
            <Button
              key={agent.agentType}
              size="sm"
              variant={defaultAgentType === agent.agentType ? "primary" : "default"}
              onClick={() => onSelectDefaultAgent(agent.agentType)}
            >
              <Bot className="h-4 w-4" />
              {agent.label}
            </Button>
          ))}
          <Button size="sm" variant="primary" disabled={creatingSession} onClick={onNewSession}>
            <Plus className="h-4 w-4" />
            {creatingSession ? "Creating..." : "New Session"}
          </Button>
        </div>
        {defaultAgentError ? <p className="text-xs text-red-600">{defaultAgentError}</p> : null}
      </div>
    </header>
  );
}

function NewSessionDialog({
  open,
  creating,
  defaultAgentType,
  error,
  onClose,
  onCreate,
}: {
  open: boolean;
  creating: boolean;
  defaultAgentType: WorkspaceAgentType;
  error?: string;
  onClose: () => void;
  onCreate: (request: CreateSessionRequest) => void;
}) {
  const [agentType, setAgentType] = useState<WorkspaceAgentType>(defaultAgentType);
  const [runtimeKind, setRuntimeKind] = useState<WorkspaceRuntimeKind>("acp");
  const [title, setTitle] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");

  useEffect(() => {
    if (open) {
      setAgentType(defaultAgentType);
      setRuntimeKind("acp");
      setTitle("");
      setWorkspacePath("");
    }
  }, [defaultAgentType, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="modal-panel"
        aria-label="New session"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onCreate({
            agentType,
            runtimeKind,
            title: title.trim() || undefined,
            workspacePath: workspacePath.trim() || undefined,
          });
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">New Session</h2>
            <p className="mt-1 text-xs text-muted-foreground">Choose the runtime and workspace before launch.</p>
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={onClose} aria-label="Close new session dialog">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid gap-3">
          <label className="field">
            <span>Agent</span>
            <div className="segmented" role="group" aria-label="Agent type">
              {(["codex", "claude", "trae"] as WorkspaceAgentType[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={cn("segmented-item", agentType === value && "active")}
                  onClick={() => setAgentType(value)}
                >
                  {value === "codex" ? "Codex CLI" : value === "claude" ? "Claude Code" : "Trae CLI"}
                </button>
              ))}
            </div>
          </label>

          <label className="field">
            <span>Runtime</span>
            <div className="segmented" role="group" aria-label="Runtime kind">
              {(["cli", "acp"] as WorkspaceRuntimeKind[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={cn("segmented-item", runtimeKind === value && "active")}
                  onClick={() => setRuntimeKind(value)}
                >
                  {value === "cli" ? "CLI" : "ACP"}
                </button>
              ))}
            </div>
          </label>

          <label className="field">
            <span>Title</span>
            <input
              value={title}
              placeholder="Optional session title"
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
          </label>

          <label className="field">
            <span>Workspace</span>
            <div className="field-with-icon">
              <Folder className="h-4 w-4 text-muted-foreground" />
              <input
                value={workspacePath}
                placeholder="Defaults to the MiniAgent working directory"
                onChange={(event) => setWorkspacePath(event.currentTarget.value)}
              />
            </div>
          </label>
        </div>

        {error ? <p className="text-xs text-red-600">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={creating}>
            {creating ? "Creating..." : "Create"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Sidebar({
  sessions,
  selected,
}: {
  sessions: WorkspaceSessionSummary[];
  selected: WorkspaceSessionSummary;
}) {
  const setSelectedSessionId = useWorkspaceStore((state) => state.setSelectedSessionId);

  return (
    <aside className="panel-solid sidebar flex h-full min-h-0 flex-col overflow-hidden">
      <SectionHeader title="Sessions">
        <Badge tone="green">
          <CircleDot className="h-3 w-3 fill-current" />
          3 active
        </Badge>
      </SectionHeader>
      <div className="session-list">
        {sessions.map((session) => (
          <button
            key={session.id}
            className={cn("agent-row w-full border-0 bg-transparent text-left", selected.id === session.id && "active")}
            onClick={() => setSelectedSessionId(session.id)}
          >
            <span className="avatar">{session.initials}</span>
            <span className="tight min-w-0">
              <strong className="block truncate text-sm">{session.title}</strong>
              <span className="block truncate text-xs text-muted-foreground">
                {session.agent} - {session.workspace}
              </span>
            </span>
            <Badge tone={statusTone[session.status]}>{session.status}</Badge>
          </button>
        ))}
      </div>
    </aside>
  );
}

function Conversation({
  selected,
  contextBudget,
  messages,
  draft,
  sendError,
  sending,
  onDraftChange,
  onSend,
}: {
  selected: WorkspaceSessionSummary;
  contextBudget: typeof fallbackWorkspace.contextBudget;
  messages: typeof fallbackWorkspace.messages;
  draft: string;
  sendError?: string;
  sending: boolean;
  onDraftChange: (value: string) => void;
  onSend: () => void;
}) {
  return (
    <section className="panel-solid main conversation grid h-full min-h-0 grid-rows-[auto_1fr_auto] overflow-hidden">
      <SectionHeader
        title={selected.title}
        subtitle="session_01J - run_08Q - global_seq 18,442"
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Badge tone="green">EventStore synced</Badge>
          <Badge tone={contextTone[contextBudget.status]}>Context {contextBudget.usagePercent}%</Badge>
        </div>
      </SectionHeader>
      <div className="messages">
        {messages.map((message, index) => (
          <motion.article
            key={message.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, delay: index * 0.04 }}
            className={cn("message", message.role === "user" ? "user" : "agent")}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <strong>{message.author}</strong>
              {message.badge ? <Badge tone={message.badge === "success" ? "green" : "blue"}>{message.badge}</Badge> : null}
              {message.time ? <span className="text-xs text-muted-foreground">{message.time}</span> : null}
            </div>
            <div className="prose-mini">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.markdown}</ReactMarkdown>
            </div>
          </motion.article>
        ))}
      </div>
      <div className="composer">
        <div className="grid gap-1">
          <textarea
            className="composer-input"
            value={draft}
            onChange={(event) => onDraftChange(event.currentTarget.value)}
          />
          {sendError ? <p className="text-xs text-red-600">{sendError}</p> : null}
        </div>
        <Button variant="primary" className="h-14" disabled={sending || draft.trim().length === 0} onClick={onSend}>
          <SendHorizontal className="h-4 w-4" />
          {sending ? "Sending..." : "Send"}
        </Button>
      </div>
    </section>
  );
}

function RightRail({
  selected,
  runtime,
  contextBudget,
  outboxRows,
  keyEvents,
  permissions,
  permissionsError,
  respondingPermissionId,
  compactError,
  compacting,
  restartError,
  restarting,
  stopError,
  stopping,
  handoffError,
  handoffPendingTarget,
  onCompact,
  onRestart,
  onViewHistory,
  onStopRun,
  onRespondPermission,
  onHandoff,
}: {
  selected: WorkspaceSessionSummary;
  runtime: typeof fallbackWorkspace.runtime;
  contextBudget: typeof fallbackWorkspace.contextBudget;
  outboxRows: typeof fallbackWorkspace.outboxRows;
  keyEvents: typeof fallbackWorkspace.keyEvents;
  permissions: RuntimePermissionRequest[];
  permissionsError?: string;
  respondingPermissionId: string | null;
  compactError?: string;
  compacting: boolean;
  restartError?: string;
  restarting: boolean;
  stopError?: string;
  stopping: boolean;
  handoffError?: string;
  handoffPendingTarget: WorkspaceAgentType | null;
  onCompact: () => void;
  onRestart: () => void;
  onViewHistory: () => void;
  onStopRun: (runId: string) => void;
  onRespondPermission: (input: { runId: string; requestId: string; outcome: "selected" | "cancelled"; optionId?: string }) => void;
  onHandoff: (targetAgentType: WorkspaceAgentType) => void;
}) {
  const allHandoffTargets: Array<{ agentType: WorkspaceAgentType; label: string }> = [
    { agentType: "codex", label: "Codex" },
    { agentType: "claude", label: "Claude" },
    { agentType: "trae", label: "Trae" },
  ];
  const handoffTargets = allHandoffTargets.filter((target) => target.agentType !== selected.agentType);

  return (
    <aside className="panel-solid rightbar h-full min-h-0 overflow-auto">
      <RightSection title="RuntimeSupervisor" badge={<Badge tone="green">healthy</Badge>}>
        <Metric label="latest run" value={runtime.status} progress={runtime.activeRunId ? 72 : 0} />
        <Metric label="protocol" value={runtime.runtimeKind ?? "idle"} progress={runtime.runtimeKind === "acp" ? 100 : 40} />
        {runtime.activeRunId ? (
          <Button size="sm" disabled={stopping} onClick={() => onStopRun(runtime.activeRunId as string)}>
            <Square className="h-4 w-4" />
            {stopping ? "Stopping..." : "Stop run"}
          </Button>
        ) : null}
        {stopError ? <p className="text-xs text-red-600">{stopError}</p> : null}
      </RightSection>
      <RightSection
        title="Permissions"
        badge={<Badge tone={pendingPermissions(permissions).length > 0 ? "amber" : "green"}>{pendingPermissions(permissions).length}</Badge>}
      >
        {pendingPermissions(permissions).length === 0 ? (
          <p className="text-xs text-muted-foreground">No pending runtime approvals.</p>
        ) : (
          <div className="grid gap-2">
            {pendingPermissions(permissions).map((permission) => {
              const requestId = permission.requestId ?? permission.id;
              const optionId = firstPermissionOptionId(permission.options) ?? "allow";
              const pendingKey = `${permission.runId}:${requestId}`;
              return (
                <div key={permission.id} className="grid gap-2 rounded-[8px] border border-border bg-muted/70 p-3">
                  <p className="text-xs text-muted-foreground">{permission.protocol.toUpperCase()} approval</p>
                  <p className="text-sm">{permission.prompt}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      disabled={respondingPermissionId === pendingKey}
                      onClick={() =>
                        onRespondPermission({
                          runId: permission.runId,
                          requestId,
                          outcome: "selected",
                          optionId,
                        })
                      }
                    >
                      <ShieldCheck className="h-4 w-4" />
                      Allow
                    </Button>
                    <Button
                      size="sm"
                      disabled={respondingPermissionId === pendingKey}
                      onClick={() =>
                        onRespondPermission({
                          runId: permission.runId,
                          requestId,
                          outcome: "cancelled",
                        })
                      }
                    >
                      <ShieldX className="h-4 w-4" />
                      Deny
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {permissionsError ? <p className="text-xs text-red-600">{permissionsError}</p> : null}
      </RightSection>
      <RightSection title="ContextPack" badge={<Badge tone={contextTone[contextBudget.status]}>{contextBudget.status}</Badge>}>
        <Progress
          tone={contextBudget.status === "healthy" ? "default" : contextBudget.status === "warning" ? "amber" : "red"}
          value={Math.min(contextBudget.usagePercent, 100)}
        />
        <p className="text-xs text-muted-foreground">
          {contextBudget.tokenEstimate.toLocaleString("en-US")} / {contextBudget.budgetTokens.toLocaleString("en-US")} tokens
          - compact at {contextBudget.criticalPercent}% - {formatLastPack(contextBudget.lastCompactedAt)}
        </p>
        <Button size="sm" disabled={compacting} onClick={onCompact}>
          <Archive className="h-4 w-4" />
          {compacting ? "Compacting..." : "Compact now"}
        </Button>
        <Button size="sm" disabled={restarting} onClick={onRestart}>
          <RefreshCw className="h-4 w-4" />
          {restarting ? "Queueing..." : "Restart from ContextPack"}
        </Button>
        <Button size="sm" onClick={onViewHistory}>
          <History className="h-4 w-4" />
          View raw history
        </Button>
        {compactError ? <p className="text-xs text-red-600">{compactError}</p> : null}
        {restartError ? <p className="text-xs text-red-600">{restartError}</p> : null}
      </RightSection>
      <RightSection title="Outbox" badge={<Badge tone="blue">8 pending</Badge>}>
        <div className="space-y-2">
          {outboxRows.map(([seq, target, status]) => (
            <div key={seq} className="log-line">
              <span className="font-mono text-muted-foreground">{seq}</span>
              <span>{target}</span>
              <span className="truncate text-muted-foreground">{status}</span>
            </div>
          ))}
        </div>
      </RightSection>
      <RightSection title="Key Events" badge={<Badge>replay</Badge>}>
        <div className="space-y-2">
          {keyEvents.map(([seq, type, detail]) => (
            <div key={`${seq}-${type}`} className="log-line">
              <span className="font-mono text-muted-foreground">{seq}</span>
              <span>{type}</span>
              <span className="truncate text-muted-foreground">{detail}</span>
            </div>
          ))}
        </div>
      </RightSection>
      <RightSection title="Handoff" badge={<Badge>available</Badge>}>
        {handoffTargets.map((target) => (
          <Button
            key={target.agentType}
            size="sm"
            disabled={handoffPendingTarget !== null}
            onClick={() => onHandoff(target.agentType)}
          >
            <ArrowRightLeft className="h-4 w-4" />
            {handoffPendingTarget === target.agentType ? "Creating..." : `Handoff to ${target.label}`}
          </Button>
        ))}
        {handoffError ? <p className="text-xs text-red-600">{handoffError}</p> : null}
      </RightSection>
    </aside>
  );
}

function RawHistoryDialog({
  open,
  events,
  error,
  loading,
  onClose,
}: {
  open: boolean;
  events: WorkspaceEvent[];
  error?: string;
  loading: boolean;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-panel history-panel" aria-label="Raw event history" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">Raw History</h2>
            <p className="mt-1 text-xs text-muted-foreground">Recent EventStore records ordered by global_seq.</p>
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={onClose} aria-label="Close raw history">
            <X className="h-4 w-4" />
          </Button>
        </div>
        {loading ? <p className="text-sm text-muted-foreground">Loading events...</p> : null}
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        <div className="history-list">
          {events.map((event) => (
            <article key={event.id} className="history-row">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs text-muted-foreground">#{event.globalSeq}</span>
                <Badge>{event.type}</Badge>
              </div>
              <pre>{JSON.stringify(event.payload, null, 2)}</pre>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function formatLastPack(value: string | null): string {
  if (!value) {
    return "no pack yet";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "last pack recorded";
  }

  return `last pack ${date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })}`;
}

function pendingPermissions(permissions: RuntimePermissionRequest[]): RuntimePermissionRequest[] {
  return permissions.filter((permission) => permission.status === "pending");
}

function firstPermissionOptionId(options: unknown): string | null {
  if (!Array.isArray(options)) {
    return null;
  }
  const first = options.find((option) => option && typeof option === "object" && "id" in option) as
    | { id?: unknown }
    | undefined;
  return typeof first?.id === "string" ? first.id : null;
}

function SectionHeader({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="section-header">
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <div className="min-w-0">
          <h2 className="truncate text-xs font-bold uppercase tracking-normal text-foreground/80">{title}</h2>
          {subtitle ? <p className="truncate font-mono text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </div>
  );
}

function RightSection({
  title,
  badge,
  children,
}: {
  title: string;
  badge: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="right-section grid gap-3 border-b border-border p-3 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <strong className="text-sm">{title}</strong>
        {badge}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value, progress }: { label: string; value: string; progress: number }) {
  return (
    <div className="metric-card">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Activity className="h-3.5 w-3.5" />
          {label}
        </span>
        <strong className="text-2xl leading-none">{value}</strong>
      </div>
      <Progress value={progress} />
    </div>
  );
}

function Progress({ value, tone = "default" }: { value: number; tone?: "default" | "amber" | "red" }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-border">
      <span
        className={cn(
          "block h-full rounded-full",
          tone === "amber" ? "bg-amber-600" : tone === "red" ? "bg-red-600" : "bg-primary",
        )}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}
