import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Command } from "cmdk";
import {
  Bot,
  Boxes,
  ChevronRight,
  CircleDot,
  GitBranch,
  History,
  Maximize2,
  MessageSquareText,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Square,
  Waypoints,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import remarkGfm from "remark-gfm";
import { createHandoff } from "./api/handoff.js";
import { sendSessionMessage } from "./api/messages.js";
import { fetchWorkspace } from "./api/workspace.js";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.js";
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

export default function App() {
  const selectedSessionId = useWorkspaceStore((state) => state.selectedSessionId);
  const commandOpen = useWorkspaceStore((state) => state.commandOpen);
  const setCommandOpen = useWorkspaceStore((state) => state.setCommandOpen);
  const setSelectedSessionId = useWorkspaceStore((state) => state.setSelectedSessionId);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("Ask Codex to turn the data model into migrations...");

  const workspace = useQuery({
    queryKey: ["workspace"],
    queryFn: fetchWorkspace,
    initialData: fallbackWorkspace,
    retry: 1,
  });
  const snapshot = workspace.data.sessions.length > 0 ? workspace.data : fallbackWorkspace;
  const selected = snapshot.sessions.find((session) => session.id === selectedSessionId) ?? snapshot.sessions[0];
  const handoff = useMutation({
    mutationFn: (input: { sessionId: string; targetAgentType: WorkspaceAgentType }) =>
      createHandoff(input.sessionId, {
        targetAgentType: input.targetAgentType,
        actorType: "web_user",
      }),
    onSuccess: (response) => {
      queryClient.setQueryData(["workspace"], response.workspace);
      setSelectedSessionId(response.targetSessionId);
    },
  });
  const sendMessage = useMutation({
    mutationFn: (input: { sessionId: string; text: string }) =>
      sendSessionMessage(input.sessionId, {
        text: input.text,
      }),
    onSuccess: (response) => {
      queryClient.setQueryData(["workspace"], response.workspace);
      setDraft("");
    },
  });

  return (
    <main className="min-h-screen bg-app text-foreground">
      <div className="flex min-h-screen flex-col p-4 md:p-[18px]">
        <Topbar onOpenCommand={() => setCommandOpen(true)} />
        <PanelGroup orientation="horizontal" className="command-deck-panels min-h-[720px] flex-1 gap-3 overflow-hidden">
          <Panel defaultSize={21} minSize={18} maxSize={28} className="min-w-[244px]">
            <Sidebar sessions={snapshot.sessions} selected={selected} />
          </Panel>
          <ResizeGrip />
          <Panel defaultSize={52} minSize={38} className="min-w-[420px]">
            <Conversation
              selected={selected}
              messages={snapshot.messages}
              keyEvents={snapshot.keyEvents}
              draft={draft}
              sendError={sendMessage.error?.message}
              sending={sendMessage.isPending}
              onDraftChange={setDraft}
              onSend={() => {
                const text = draft.trim();
                if (text) {
                  sendMessage.mutate({ sessionId: selected.id, text });
                }
              }}
            />
          </Panel>
          <ResizeGrip />
          <Panel defaultSize={27} minSize={22} maxSize={34} className="min-w-[320px]">
            <RightRail
              selected={selected}
              outboxRows={snapshot.outboxRows}
              keyEvents={snapshot.keyEvents}
              handoffError={handoff.error?.message}
              handoffPendingTarget={handoff.isPending ? handoff.variables?.targetAgentType ?? null : null}
              onHandoff={(targetAgentType) => handoff.mutate({ sessionId: selected.id, targetAgentType })}
            />
          </Panel>
        </PanelGroup>
      </div>
      {commandOpen ? <CommandPalette onClose={() => setCommandOpen(false)} /> : null}
    </main>
  );
}

function Topbar({ onOpenCommand }: { onOpenCommand: () => void }) {
  return (
    <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-[8px] bg-ink text-white shadow-elevated">
          <Boxes className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight">MiniAgent</h1>
          <p className="truncate text-xs text-muted-foreground">Local multi-agent control plane</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button size="sm">
          <Bot className="h-4 w-4" />
          Codex CLI
        </Button>
        <Button size="sm">
          <Sparkles className="h-4 w-4" />
          Claude Code
        </Button>
        <Button size="sm">
          <Waypoints className="h-4 w-4" />
          Trae CLI
        </Button>
        <Button size="icon" aria-label="Open command palette" onClick={onOpenCommand}>
          <Search className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="primary">
          <Plus className="h-4 w-4" />
          New Session
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
    <aside className="panel-solid flex h-full min-h-0 flex-col overflow-hidden">
      <SectionHeader title="Sessions">
        <Badge tone="green">
          <CircleDot className="h-3 w-3 fill-current" />
          3 active
        </Badge>
      </SectionHeader>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {sessions.map((session) => (
          <button
            key={session.id}
            className={cn(
              "mb-2 grid w-full grid-cols-[34px_1fr_auto] items-center gap-3 rounded-[8px] border p-2.5 text-left transition-colors",
              selected.id === session.id
                ? "border-primary/25 bg-primary/10"
                : "border-transparent bg-transparent hover:border-border hover:bg-muted/70",
            )}
            onClick={() => setSelectedSessionId(session.id)}
          >
            <span className="grid h-8 w-8 place-items-center rounded-[7px] bg-ink text-xs font-semibold text-white">
              {session.initials}
            </span>
            <span className="min-w-0">
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
  messages,
  keyEvents,
  draft,
  sendError,
  sending,
  onDraftChange,
  onSend,
}: {
  selected: WorkspaceSessionSummary;
  messages: typeof fallbackWorkspace.messages;
  keyEvents: typeof fallbackWorkspace.keyEvents;
  draft: string;
  sendError?: string;
  sending: boolean;
  onDraftChange: (value: string) => void;
  onSend: () => void;
}) {
  return (
    <section className="panel-solid grid h-full min-h-0 grid-rows-[auto_1fr_auto] overflow-hidden">
      <SectionHeader
        title={selected.title}
        subtitle="session_01J - run_08Q - global_seq 18,442"
        icon={<MessageSquareText className="h-4 w-4" />}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Badge tone="green">EventStore synced</Badge>
          <Badge tone="amber">Context 72%</Badge>
        </div>
      </SectionHeader>
      <Tabs defaultValue="stream" className="grid min-h-0 grid-rows-[auto_1fr]">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <TabsList>
            <TabsTrigger value="stream">Stream</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
          </TabsList>
          <Button size="sm">
            <Maximize2 className="h-4 w-4" />
            Focus
          </Button>
        </div>
        <TabsContent value="stream" className="min-h-0 overflow-auto p-4">
          {messages.map((message, index) => (
            <motion.article
              key={message.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: index * 0.04 }}
              className={cn(
                "mb-3 max-w-[760px] rounded-[8px] border bg-surface/80 p-3 shadow-sm",
                message.role === "user" ? "ml-auto border-l-[3px] border-l-blue-600" : "border-l-[3px] border-l-primary",
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <strong className="text-sm">{message.author}</strong>
                {message.badge ? <Badge tone={message.badge === "success" ? "green" : "blue"}>{message.badge}</Badge> : null}
                {message.time ? <span className="text-xs text-muted-foreground">{message.time}</span> : null}
              </div>
              <div className="prose-mini">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.markdown}</ReactMarkdown>
              </div>
            </motion.article>
          ))}
        </TabsContent>
        <TabsContent value="events" className="min-h-0 overflow-auto p-4">
          <EventTable rows={keyEvents} />
        </TabsContent>
      </Tabs>
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
          <Send className="h-4 w-4" />
          {sending ? "Sending..." : "Send"}
        </Button>
      </div>
    </section>
  );
}

function RightRail({
  selected,
  outboxRows,
  keyEvents,
  handoffError,
  handoffPendingTarget,
  onHandoff,
}: {
  selected: WorkspaceSessionSummary;
  outboxRows: typeof fallbackWorkspace.outboxRows;
  keyEvents: typeof fallbackWorkspace.keyEvents;
  handoffError?: string;
  handoffPendingTarget: WorkspaceAgentType | null;
  onHandoff: (targetAgentType: WorkspaceAgentType) => void;
}) {
  const allHandoffTargets: Array<{ agentType: WorkspaceAgentType; label: string }> = [
    { agentType: "codex", label: "Codex" },
    { agentType: "claude", label: "Claude" },
    { agentType: "trae", label: "Trae" },
  ];
  const handoffTargets = allHandoffTargets.filter((target) => target.agentType !== selected.agentType);

  return (
    <aside className="panel-solid h-full min-h-0 overflow-auto">
      <RightSection title="RuntimeSupervisor" badge={<Badge tone="green">healthy</Badge>}>
        <Metric label="stdout batch window" value="126ms" progress={56} />
      </RightSection>
      <RightSection title="ContextPack" badge={<Badge tone="amber">warning</Badge>}>
        <Progress tone="amber" value={72} />
        <p className="text-xs text-muted-foreground">Next compact at 85% - last pack 14 minutes ago</p>
        <Button size="sm">
          <RotateCcw className="h-4 w-4" />
          Compact now
        </Button>
      </RightSection>
      <RightSection title="Outbox" badge={<Badge tone="blue">8 pending</Badge>}>
        <div className="space-y-2">
          {outboxRows.map(([seq, target, status]) => (
            <div key={seq} className="grid grid-cols-[58px_56px_1fr] gap-2 rounded-[7px] bg-muted px-2 py-2 text-xs">
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
            <GitBranch className="h-4 w-4" />
            {handoffPendingTarget === target.agentType ? "Creating..." : `Handoff to ${target.label}`}
          </Button>
        ))}
        {handoffError ? <p className="text-xs text-red-600">{handoffError}</p> : null}
      </RightSection>
      <RightSection title="Key Events" badge={<Badge>live</Badge>}>
        <EventTable rows={keyEvents} compact />
      </RightSection>
    </aside>
  );
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
    <section className="grid gap-3 border-b border-border p-3 last:border-b-0">
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

function EventTable({ rows, compact = false }: { rows: typeof fallbackWorkspace.keyEvents; compact?: boolean }) {
  return (
    <div className="overflow-hidden rounded-[8px] border border-border">
      <table className="w-full border-collapse text-left text-xs">
        <tbody>
          {rows.map(([seq, type, detail]) => (
            <tr key={`${seq}-${type}`} className="border-b border-border last:border-b-0">
              <td className="w-16 px-2 py-2 font-mono text-muted-foreground">{seq}</td>
              <td className="px-2 py-2 font-medium">{type}</td>
              {!compact ? <td className="px-2 py-2 text-muted-foreground">{detail}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResizeGrip() {
  return (
    <PanelResizeHandle className="hidden w-1 rounded-full bg-transparent transition-colors hover:bg-primary/30 data-[separator-active]:bg-primary/40 lg:block" />
  );
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-start justify-center bg-black/30 px-4 pt-[12vh]" onClick={onClose}>
      <Command
        className="w-full max-w-xl overflow-hidden rounded-[8px] border border-border bg-surface shadow-elevated"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Command.Input
            className="h-11 flex-1 bg-transparent text-sm outline-none"
            placeholder="Search sessions, commands, handoff targets..."
          />
        </div>
        <Command.List className="max-h-[320px] overflow-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">No results</Command.Empty>
          <Command.Group heading="Actions" className="command-group">
            <Command.Item className="command-item">
              <Play className="h-4 w-4" />
              Start selected session
              <ChevronRight className="ml-auto h-4 w-4" />
            </Command.Item>
            <Command.Item className="command-item">
              <Square className="h-4 w-4" />
              Stop active run
              <ChevronRight className="ml-auto h-4 w-4" />
            </Command.Item>
            <Command.Item className="command-item">
              <History className="h-4 w-4" />
              Open raw event history
              <ChevronRight className="ml-auto h-4 w-4" />
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
