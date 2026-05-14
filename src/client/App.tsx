import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  CircleDot,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { compactSessionContext } from "./api/context.js";
import { createHandoff } from "./api/handoff.js";
import { sendSessionMessage } from "./api/messages.js";
import { createSession } from "./api/sessions.js";
import { fetchWorkspace } from "./api/workspace.js";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { fallbackWorkspace } from "./data/mock-workspace.js";
import { cn } from "./lib/utils.js";
import { useWorkspaceStore } from "./state/workspace-store.js";
import type { WorkspaceAgentType, WorkspaceSessionSummary } from "../shared/workspace.js";

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
  useWorkspaceEventStream(selected.id, hasRealSelectedSession);
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
    mutationFn: () =>
      createSession({
        agentType: defaultAgentType,
      }),
    onSuccess: (response) => {
      queryClient.setQueryData(["workspace", response.workspace.selectedSessionId], response.workspace);
      setSelectedSessionId(response.sessionId);
    },
  });

  return (
    <main className="min-h-screen bg-app text-foreground">
      <div className="app-shell">
        <Topbar
          creatingSession={newSession.isPending}
          onSelectDefaultAgent={setDefaultAgentType}
          onNewSession={() => newSession.mutate()}
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
            contextBudget={snapshot.contextBudget}
            outboxRows={snapshot.outboxRows}
            compactError={compactContext.error?.message}
            compacting={compactContext.isPending}
            handoffError={handoff.error?.message}
            handoffPendingTarget={handoff.isPending ? handoff.variables?.targetAgentType ?? null : null}
            onCompact={() => {
              if (hasRealSelectedSession) {
                compactContext.mutate(selected.id);
              }
            }}
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
  onSelectDefaultAgent,
  onNewSession,
}: {
  creatingSession: boolean;
  onSelectDefaultAgent: (agentType: WorkspaceAgentType) => void;
  onNewSession: () => void;
}) {
  const agentButtons: Array<{ agentType: WorkspaceAgentType; label: string }> = [
    { agentType: "codex", label: "Codex CLI" },
    { agentType: "claude", label: "Claude Code" },
    { agentType: "trae", label: "Trae CLI" },
  ];

  return (
    <header className="mb-[14px] flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-[11px]">
        <div className="grid h-[34px] w-[34px] place-items-center rounded-[8px] bg-ink text-white shadow-elevated">
          <Boxes className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight">MiniAgent</h1>
          <p className="truncate text-xs text-muted-foreground">Local multi-agent control plane</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {agentButtons.map((agent) => (
          <Button
            key={agent.agentType}
            size="sm"
            onClick={() => onSelectDefaultAgent(agent.agentType)}
          >
            {agent.label}
          </Button>
        ))}
        <Button size="sm" variant="primary" disabled={creatingSession} onClick={onNewSession}>
          {creatingSession ? "Creating..." : "New Session"}
        </Button>
      </div>
    </header>
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
      <div className="grid grid-cols-[1fr_auto] gap-3 border-t border-border bg-surface/95 p-3">
        <div className="grid gap-1">
          <textarea
            className="h-14 resize-none rounded-[8px] border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            value={draft}
            onChange={(event) => onDraftChange(event.currentTarget.value)}
          />
          {sendError ? <p className="text-xs text-red-600">{sendError}</p> : null}
        </div>
        <Button variant="primary" className="h-14" disabled={sending || draft.trim().length === 0} onClick={onSend}>
          {sending ? "Sending..." : "Send"}
        </Button>
      </div>
    </section>
  );
}

function RightRail({
  selected,
  contextBudget,
  outboxRows,
  compactError,
  compacting,
  handoffError,
  handoffPendingTarget,
  onCompact,
  onHandoff,
}: {
  selected: WorkspaceSessionSummary;
  contextBudget: typeof fallbackWorkspace.contextBudget;
  outboxRows: typeof fallbackWorkspace.outboxRows;
  compactError?: string;
  compacting: boolean;
  handoffError?: string;
  handoffPendingTarget: WorkspaceAgentType | null;
  onCompact: () => void;
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
        <Metric label="stdout batch window" value="126ms" progress={56} />
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
          {compacting ? "Compacting..." : "Compact now"}
        </Button>
        {compactError ? <p className="text-xs text-red-600">{compactError}</p> : null}
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
      <RightSection title="Handoff" badge={<Badge>available</Badge>}>
        {handoffTargets.map((target) => (
          <Button
            key={target.agentType}
            size="sm"
            disabled={handoffPendingTarget !== null}
            onClick={() => onHandoff(target.agentType)}
          >
            {handoffPendingTarget === target.agentType ? "Creating..." : `Handoff to ${target.label}`}
          </Button>
        ))}
        {handoffError ? <p className="text-xs text-red-600">{handoffError}</p> : null}
      </RightSection>
    </aside>
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
    <div className="flex min-h-[54px] items-center justify-between gap-3 border-b border-border px-4 py-3">
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
    <div className="grid gap-2 rounded-[8px] border border-border bg-muted/70 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
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
