import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { ArrowDown, ArrowUp, CalendarClock, Check, ChevronDown, Clock, Pause, Pencil, Play, Search, SendHorizontal, Settings, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import "highlight.js/styles/atom-one-dark.css";
import { fetchChannels, saveChannelConfig, testChannel, requestWechatQRCode, pollWechatQRStatus, type ChannelInfo } from "./api/channels.js";
import { createSchedule, fetchScheduleRuns, fetchSchedules, previewSchedule, updateScheduleStatus } from "./api/schedules.js";
import { createSession, updateSessionName } from "./api/sessions.js";
import { fetchSkills } from "./api/skills.js";
import { sendSessionMessage } from "./api/messages.js";
import { createChatScrollController, type ChatScrollController } from "./lib/chat-scroll.js";
import type { AgentType, ChatMessage, RunStats, SkillMeta } from "./api/types.js";
import type { WorkspaceScheduleKind, WorkspaceSnapshot } from "../shared/workspace.js";

const AGENT_OPTIONS: Array<{ value: AgentType; label: string }> = [
  { value: "codex", label: "Codex" },
  { value: "claude", label: "Claude" },
];

const SCHEDULE_TIMEZONES = [
  "Asia/Shanghai",
  "UTC",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
];

type DrawerTab = "skills" | "channels" | "sessions" | "schedules";

export default function App() {
  const queryClient = useQueryClient();
  const [agentType, setAgentType] = useState<AgentType>("claude");
  const [sessionId, setSessionId] = useState<string | null>(() => localStorage.getItem("sessionId"));
  const [draft, setDraft] = useState("");
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("skills");
  const [skillsQuery, setSkillsQuery] = useState("");
  const [sessionsQuery, setSessionsQuery] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionName, setEditingSessionName] = useState("");
  const [renameSessionError, setRenameSessionError] = useState<string | null>(null);
  const [scheduleKind, setScheduleKind] = useState<WorkspaceScheduleKind>("once");
  const [scheduleRunAt, setScheduleRunAt] = useState(() => defaultRunAtInput());
  const [scheduleCronExpr, setScheduleCronExpr] = useState("0 9 * * 1-5");
  const [scheduleTimezone, setScheduleTimezone] = useState("Asia/Shanghai");
  const [scheduleText, setScheduleText] = useState("");
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [expandedScheduleId, setExpandedScheduleId] = useState<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const draftInputRef = useRef<HTMLTextAreaElement>(null);
  const scrollControllerRef = useRef<ChatScrollController | null>(null);
  scrollControllerRef.current ??= createChatScrollController({
    getContainer: () => messagesContainerRef.current,
  });
  const scrollController = scrollControllerRef.current;
  const skillsSearchRef = useRef<HTMLInputElement>(null);
  const sessionsSearchRef = useRef<HTMLInputElement>(null);
  const prevMsgCountRef = useRef(0);
  const lastAutoScrollSessionRef = useRef<string | null>(null);
  const [settledMessagesSessionKey, setSettledMessagesSessionKey] = useState<string | null>(null);
  const streamingTextRef = useRef("");
  const isStreamingRef = useRef(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const activeRunIdRef = useRef<string | null>(null);
  const [streamingText, setStreamingText] = useState("");

  const { data: skillsData } = useQuery({
    queryKey: ["skills"],
    queryFn: fetchSkills,
    refetchInterval: 30_000,
  });
  const skills: SkillMeta[] = skillsData?.skills ?? [];

  const { data: channelsData } = useQuery({
    queryKey: ["channels"],
    queryFn: fetchChannels,
  });
  const channels: ChannelInfo[] = channelsData?.channels ?? [];

  const filteredSkills = skillsQuery
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(skillsQuery.toLowerCase()) ||
          s.description.toLowerCase().includes(skillsQuery.toLowerCase()),
      )
    : skills;

  // Single source of truth: workspace polling (always fetch — server falls back to most recent session)
  const { data: snapshot } = useQuery({
    queryKey: ["workspace", sessionId],
    queryFn: async () => {
      const qs = sessionId ? `?sessionId=${sessionId}` : "";
      const res = await fetch(`/api/workspace${qs}`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<WorkspaceSnapshot>;
    },
    refetchInterval: 3_000,
  });
  const sessions = snapshot?.sessions ?? [];
  const selectedSessionId = sessionId ?? snapshot?.selectedSessionId ?? null;
  const selectedSessionName = sessions.find((s) => s.id === selectedSessionId)?.name ?? "Current session";
  const filteredSessions = sessionsQuery.trim()
    ? sessions.filter((s) => s.name.toLowerCase().includes(sessionsQuery.trim().toLowerCase()))
    : sessions;

  const { data: schedulesData } = useQuery({
    queryKey: ["schedules", selectedSessionId],
    queryFn: () => selectedSessionId ? fetchSchedules(selectedSessionId) : Promise.resolve({ schedules: [] }),
    enabled: drawerTab === "schedules",
    refetchInterval: drawerOpen && drawerTab === "schedules" ? 10_000 : false,
  });
  const schedules = schedulesData?.schedules ?? [];
  const { data: schedulePreview, error: schedulePreviewError } = useQuery({
    queryKey: ["schedule-preview", scheduleKind, scheduleCronExpr, scheduleRunAt, scheduleTimezone],
    queryFn: () => previewSchedule({
      kind: scheduleKind,
      cronExpr: scheduleKind === "cron" ? scheduleCronExpr.trim() : null,
      runAt: scheduleKind === "once" ? new Date(scheduleRunAt).toISOString() : null,
      timezone: scheduleTimezone,
    }),
    enabled: drawerOpen && drawerTab === "schedules" && scheduleKind === "cron" && scheduleCronExpr.trim().length > 0,
    retry: false,
    staleTime: 5_000,
  });
  const { data: scheduleRunsData } = useQuery({
    queryKey: ["schedule-runs", expandedScheduleId],
    queryFn: () => expandedScheduleId ? fetchScheduleRuns(expandedScheduleId) : Promise.resolve({ runs: [] }),
    enabled: drawerOpen && drawerTab === "schedules" && Boolean(expandedScheduleId),
    refetchInterval: drawerOpen && drawerTab === "schedules" && expandedScheduleId ? 10_000 : false,
  });

  // Sync sessionId from server when we had none (server picks most recent session)
  useEffect(() => {
    if (!sessionId && snapshot?.selectedSessionId) {
      setSessionId(snapshot.selectedSessionId);
      localStorage.setItem("sessionId", snapshot.selectedSessionId);
    }
  }, [snapshot?.selectedSessionId, sessionId]);

  const messages = snapshot?.messages ?? [];
  const hasWorkspaceSnapshot = snapshot !== undefined;
  const lastMessageId = messages[messages.length - 1]?.id ?? "";
  const messagesSessionKey = sessionId ?? snapshot?.selectedSessionId ?? "";
  const messagesSettling = messages.length > 0 && settledMessagesSessionKey !== messagesSessionKey;
  const runStats = snapshot?.runStats ?? { durationSeconds: null, tokensUsed: null, tokensTotal: null };

  const scrollMessagesToBottom = (behavior: ScrollBehavior) => {
    scrollController.scrollToBottom(behavior);
  };

  const scrollMessagesToTop = () => {
    scrollController.scrollToTop("smooth");
  };

  const resizeDraftInput = () => {
    const el = draftInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  // SSE: capture text_delta for streaming + trigger workspace refresh
  const lastGlobalSeqRef = useRef(0);
  useEffect(() => {
    if (!sessionId) return;
    let stopped = false;
    let source: EventSource | null = null;

    const connect = (afterSeq: number) => {
      if (stopped) return;
      source = new EventSource(
        `/api/events/stream?sessionId=${encodeURIComponent(sessionId)}&afterGlobalSeq=${afterSeq}&limit=100`,
      );
      const refresh = () => queryClient.invalidateQueries({ queryKey: ["workspace", sessionId] });
      for (const type of ["message_created", "run_started", "run_completed", "run_output_appended"]) {
        source.addEventListener(type, refresh);
      }
      source.addEventListener("run_started", (e: MessageEvent) => {
        try {
          const evt = JSON.parse(e.data);
          if (evt.runId) activeRunIdRef.current = evt.runId;
        } catch {}
      });
      source.addEventListener("run_completed", (e: MessageEvent) => {
        try {
          const evt = JSON.parse(e.data);
          if (evt.runId && evt.runId === activeRunIdRef.current) {
            activeRunIdRef.current = null;
            // Keep isStreamingRef true — the messages effect will clear it
            // once the persisted agent message appears in the workspace
          }
        } catch {}
      });
      source.addEventListener("text_delta", (e: MessageEvent) => {
        if (activeRunIdRef.current) {
          try {
            const evt = JSON.parse(e.data);
            if (evt.payload?.text) {
              streamingTextRef.current += evt.payload.text;
              setStreamingText(streamingTextRef.current);
            }
          } catch { /* ignore parse errors */ }
        }
        refresh();
      });
      source.addEventListener("message_created", (e: MessageEvent) => {
        try { lastGlobalSeqRef.current = JSON.parse(e.data).globalSeq ?? lastGlobalSeqRef.current; } catch {}
      });
      source.addEventListener("text_delta", (e: MessageEvent) => {
        try { lastGlobalSeqRef.current = JSON.parse(e.data).globalSeq ?? lastGlobalSeqRef.current; } catch {}
      });
      source.onerror = () => {
        source?.close();
        if (!stopped) setTimeout(() => connect(lastGlobalSeqRef.current), 3_000);
      };
    };
    connect(lastGlobalSeqRef.current);
    return () => {
      stopped = true;
      source?.close();
    };
  }, [sessionId, queryClient]);

  // Auto-scroll on initial load, session switches, and new messages.
  useLayoutEffect(() => {
    if (!messagesSessionKey) {
      prevMsgCountRef.current = 0;
      lastAutoScrollSessionRef.current = messagesSessionKey;
      if (settledMessagesSessionKey !== messagesSessionKey) {
        setSettledMessagesSessionKey(messagesSessionKey);
      }
      return;
    }

    if (messages.length === 0) {
      prevMsgCountRef.current = 0;
      lastAutoScrollSessionRef.current = messagesSessionKey;
      if (hasWorkspaceSnapshot && settledMessagesSessionKey !== messagesSessionKey) {
        setSettledMessagesSessionKey(messagesSessionKey);
      }
      return;
    }

    const isInitialLoad = prevMsgCountRef.current === 0;
    const isNewSession = lastAutoScrollSessionRef.current !== messagesSessionKey;
    const shouldSnapToBottom = isInitialLoad || isNewSession || settledMessagesSessionKey !== messagesSessionKey;

    if (shouldSnapToBottom) {
      const cleanup = scrollController.scheduleInitialLoad({
        markSettled: () => setSettledMessagesSessionKey(messagesSessionKey),
        requestFrame: (callback) => window.requestAnimationFrame(callback),
        cancelFrame: (id) => window.cancelAnimationFrame(id),
        setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimer: (id) => window.clearTimeout(id),
      });
      prevMsgCountRef.current = messages.length;
      lastAutoScrollSessionRef.current = messagesSessionKey;
      return cleanup;
    }

    prevMsgCountRef.current = messages.length;
    lastAutoScrollSessionRef.current = messagesSessionKey;
  }, [hasWorkspaceSnapshot, messages.length, lastMessageId, messagesSessionKey, settledMessagesSessionKey]);

  // Track user scroll position to avoid overriding manual scroll.
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const onScroll = () => scrollController.updatePosition();
    const onUserScrollIntent = () => scrollController.markUserScrollIntent();
    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("wheel", onUserScrollIntent, { passive: true });
    container.addEventListener("touchstart", onUserScrollIntent, { passive: true });
    container.addEventListener("pointerdown", onUserScrollIntent);
    return () => {
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("wheel", onUserScrollIntent);
      container.removeEventListener("touchstart", onUserScrollIntent);
      container.removeEventListener("pointerdown", onUserScrollIntent);
    };
  }, [scrollController]);

  useEffect(() => {
    if (streamingText) {
      scrollController.scrollToBottomIfPinned("smooth");
    }
  }, [streamingText, scrollController]);

  // Clear streaming text when a NEW agent message appears (count increased since streaming started)
  const streamStartCountRef = useRef(0);
  useEffect(() => {
    if (isStreamingRef.current && messages.length > streamStartCountRef.current) {
      const last = messages[messages.length - 1];
      if (last?.role === "agent") {
        streamingTextRef.current = "";
        setStreamingText("");
        isStreamingRef.current = false;
        setIsStreaming(false);
      }
    }
  }, [messages]);

  // Focus search on drawer open + search-backed tabs
  useEffect(() => {
    if (drawerOpen && drawerTab === "skills") {
      setSkillsQuery("");
      requestAnimationFrame(() => skillsSearchRef.current?.focus());
    }
    if (drawerOpen && drawerTab === "sessions") {
      requestAnimationFrame(() => sessionsSearchRef.current?.focus());
    }
  }, [drawerOpen, drawerTab]);

  useLayoutEffect(() => {
    resizeDraftInput();
  }, [draft]);

  const openDrawer = (tab: DrawerTab) => {
    if (drawerOpen && drawerTab === tab) {
      setDrawerOpen(false);
    } else {
      setDrawerTab(tab);
      setDrawerOpen(true);
    }
  };

  const sendMessage = useMutation({
    mutationFn: async (text: string) => {
      streamingTextRef.current = "";
      setStreamingText("");
      isStreamingRef.current = true;
      setIsStreaming(true);
      activeRunIdRef.current = null;
      streamStartCountRef.current = messages.length;
      let sid = sessionId;
      if (!sid) {
        const res = await createSession({ agentType });
        sid = res.sessionId;
        setSessionId(sid);
      }
      const result = await sendSessionMessage(sid, { text });
      return { ...result, sessionId: sid };
    },
    onSuccess: (data) => {
      setDraft("");
      setSessionId(data.sessionId);
      localStorage.setItem("sessionId", data.sessionId);
      queryClient.invalidateQueries({ queryKey: ["workspace", data.sessionId] });
    },
  });

  const renameSession = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateSessionName(id, name),
    onMutate: () => {
      setRenameSessionError(null);
    },
    onSuccess: () => {
      setEditingSessionId(null);
      setEditingSessionName("");
      setRenameSessionError(null);
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
    onError: (error) => {
      setRenameSessionError(error instanceof Error ? error.message : "Rename failed");
    },
  });

  const createScheduleMutation = useMutation({
    mutationFn: () => {
      if (!selectedSessionId) throw new Error("No session selected");
      const text = scheduleText.trim();
      if (!text) throw new Error("Message is required");
      if (scheduleKind === "once" && !scheduleRunAt) throw new Error("Run time is required");
      if (scheduleKind === "cron" && !scheduleCronExpr.trim()) throw new Error("Cron expression is required");
      return createSchedule({
        sessionId: selectedSessionId,
        kind: scheduleKind,
        runAt: scheduleKind === "once" ? new Date(scheduleRunAt).toISOString() : null,
        cronExpr: scheduleKind === "cron" ? scheduleCronExpr.trim() : null,
        timezone: scheduleTimezone,
        payload: { text },
        actorType: "web_user",
      });
    },
    onMutate: () => {
      setScheduleError(null);
    },
    onSuccess: () => {
      setScheduleText("");
      setScheduleRunAt(defaultRunAtInput());
      queryClient.invalidateQueries({ queryKey: ["schedules", selectedSessionId] });
    },
    onError: (error) => {
      setScheduleError(error instanceof Error ? error.message : "Create schedule failed");
    },
  });

  const updateScheduleMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "pause" | "resume" | "cancel" }) =>
      updateScheduleStatus(id, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedules", selectedSessionId] });
      queryClient.invalidateQueries({ queryKey: ["schedule-runs", expandedScheduleId] });
    },
  });

  const handleSend = () => {
    const text = draft.trim();
    if (!text || sendMessage.isPending) return;
    sendMessage.mutate(text);
  };

  const handleSkillSelect = (skill: SkillMeta) => {
    setDraft(`/${skill.name} `);
    setDrawerOpen(false);
  };

  const handleCreateSchedule = () => {
    if (createScheduleMutation.isPending) return;
    createScheduleMutation.mutate();
  };

  const startSessionRename = (id: string, name: string) => {
    setEditingSessionId(id);
    setEditingSessionName(name);
    setRenameSessionError(null);
  };

  const submitSessionRename = (id: string) => {
    const nextName = editingSessionName.trim();
    if (renameSession.isPending) return;
    if (!nextName) {
      setRenameSessionError("Name is required");
      return;
    }
    renameSession.mutate({ id, name: nextName });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.shiftKey) {
      requestAnimationFrame(resizeDraftInput);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const currentAgent = AGENT_OPTIONS.find((a) => a.value === agentType)!;

  return (
    <main className="app-root">
      {/* Left drawer */}
      <div className={`drawer ${drawerOpen ? "open" : ""}`}>
        {/* Tab header */}
        <div className="drawer-tabs">
          <button
            className={`drawer-tab ${drawerTab === "skills" ? "active" : ""}`}
            onClick={() => setDrawerTab("skills")}
          >
            <Sparkles className="h-3.5 w-3.5" /> Skills
          </button>
          <button
            className={`drawer-tab ${drawerTab === "channels" ? "active" : ""}`}
            onClick={() => setDrawerTab("channels")}
          >
            <Settings className="h-3.5 w-3.5" /> Channels
          </button>
          <button
            className={`drawer-tab ${drawerTab === "sessions" ? "active" : ""}`}
            onClick={() => setDrawerTab("sessions")}
          >
            <Clock className="h-3.5 w-3.5" /> History
          </button>
          <button
            className={`drawer-tab ${drawerTab === "schedules" ? "active" : ""}`}
            onClick={() => setDrawerTab("schedules")}
          >
            <CalendarClock className="h-3.5 w-3.5" /> Schedules
          </button>
          <button className="drawer-close" onClick={() => setDrawerOpen(false)}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Skills tab */}
        {drawerTab === "skills" && (
          <>
            <div className="drawer-search">
              <Search className="h-4 w-4 drawer-search-icon" />
              <input
                ref={skillsSearchRef}
                className="drawer-search-input"
                value={skillsQuery}
                onChange={(e) => setSkillsQuery(e.currentTarget.value)}
                placeholder="Search skills..."
              />
            </div>
            <div className="drawer-list">
              {filteredSkills.length === 0 && (
                <div className="drawer-empty">No matching skills</div>
              )}
              {filteredSkills.map((skill) => (
                <button key={skill.name} className="drawer-item" onClick={() => handleSkillSelect(skill)}>
                  <strong>{skill.name}</strong>
                  {skill.description && (
                    <span className="drawer-item-desc">{skill.description.slice(0, 30)}...</span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Channels tab */}
        {drawerTab === "channels" && (
          <div className="drawer-list">
            {channels.map((ch) => (
              <ChannelCard key={ch.id} channel={ch} onSaved={() => queryClient.invalidateQueries({ queryKey: ["channels"] })} />
            ))}
          </div>
        )}

        {/* Sessions tab */}
        {drawerTab === "sessions" && (
          <>
            <div className="drawer-search">
              <Search className="h-4 w-4 drawer-search-icon" />
              <input
                ref={sessionsSearchRef}
                className="drawer-search-input"
                value={sessionsQuery}
                onChange={(e) => setSessionsQuery(e.currentTarget.value)}
                placeholder="Search history..."
              />
            </div>
            <div className="drawer-list">
              {sessions.length === 0 && (
                <div className="drawer-empty">No sessions yet</div>
              )}
              {sessions.length > 0 && filteredSessions.length === 0 && (
                <div className="drawer-empty">No matching sessions</div>
              )}
              {filteredSessions.map((s) => {
                const sessionName = s.name || s.title || "Untitled";
                const isEditing = editingSessionId === s.id;
                return (
                  <div
                    key={s.id}
                    className={`session-item ${s.id === sessionId ? "session-item--active" : ""}`}
                  >
                    {isEditing ? (
                      <form
                        className="session-edit"
                        onSubmit={(e) => {
                          e.preventDefault();
                          submitSessionRename(s.id);
                        }}
                      >
                        <div className="session-edit-row">
                          <input
                            className="session-name-input"
                            value={editingSessionName}
                            onChange={(e) => {
                              setEditingSessionName(e.currentTarget.value);
                              setRenameSessionError(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                setEditingSessionId(null);
                                setEditingSessionName("");
                                setRenameSessionError(null);
                              }
                            }}
                            aria-label="Session name"
                            aria-invalid={renameSessionError ? "true" : "false"}
                            aria-describedby={renameSessionError ? `session-rename-error-${s.id}` : undefined}
                            autoFocus
                          />
                          <button className="session-edit-btn" type="submit" title="Save" aria-label="Save session name" disabled={renameSession.isPending}>
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            className="session-edit-btn"
                            type="button"
                            title="Cancel"
                            aria-label="Cancel rename"
                            onClick={() => {
                              setEditingSessionId(null);
                              setEditingSessionName("");
                              setRenameSessionError(null);
                            }}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        {renameSessionError && (
                          <div id={`session-rename-error-${s.id}`} className="session-edit-error" role="alert">
                            {renameSessionError}
                          </div>
                        )}
                      </form>
                    ) : (
                      <>
                        <button
                          className="session-select"
                          onClick={() => {
                            setSessionId(s.id);
                            localStorage.setItem("sessionId", s.id);
                            queryClient.invalidateQueries({ queryKey: ["workspace", s.id] });
                          }}
                        >
                          <span className="session-title" title={sessionName}>{renderHighlightedSessionName(sessionName, sessionsQuery)}</span>
                          <span className="session-meta">
                            <span>{formatSessionChannel(s.channelType)}</span>
                            <span>{formatSessionUpdatedAt(s.updatedAt)}</span>
                          </span>
                        </button>
                        <button
                          className="session-action"
                          title="Rename"
                          aria-label={`Rename ${sessionName}`}
                          onClick={() => startSessionRename(s.id, sessionName)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <span className={`session-status session-status--${s.status}`}>
                          <span className="session-dot" />
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {drawerTab === "schedules" && (
          <div className="schedule-panel">
            <div className="schedule-session" title={selectedSessionName}>{selectedSessionName}</div>
            <div className="schedule-form">
              <div className="segmented-control" role="group" aria-label="Schedule kind">
                <button
                  className={`segmented-btn ${scheduleKind === "once" ? "active" : ""}`}
                  onClick={() => setScheduleKind("once")}
                >
                  Once
                </button>
                <button
                  className={`segmented-btn ${scheduleKind === "cron" ? "active" : ""}`}
                  onClick={() => setScheduleKind("cron")}
                >
                  Cron
                </button>
              </div>
              {scheduleKind === "once" ? (
                <input
                  className="schedule-input"
                  type="datetime-local"
                  value={scheduleRunAt}
                  onChange={(e) => setScheduleRunAt(e.currentTarget.value)}
                  aria-label="Run at"
                />
              ) : (
                <input
                  className="schedule-input"
                  value={scheduleCronExpr}
                  onChange={(e) => setScheduleCronExpr(e.currentTarget.value)}
                  placeholder="0 9 * * 1-5"
                  aria-label="Cron expression"
                />
              )}
              <select
                className="schedule-input"
                value={scheduleTimezone}
                onChange={(e) => setScheduleTimezone(e.currentTarget.value)}
                aria-label="Timezone"
              >
                {SCHEDULE_TIMEZONES.map((timezone) => (
                  <option key={timezone} value={timezone}>{timezone}</option>
                ))}
              </select>
              {scheduleKind === "cron" && (
                <div className={`schedule-preview ${schedulePreviewError ? "schedule-preview--error" : ""}`}>
                  {schedulePreviewError instanceof Error
                    ? schedulePreviewError.message
                    : schedulePreview
                      ? `Next ${formatZonedTime(schedulePreview.nextRunAt, scheduleTimezone)}`
                      : "Checking next run..."}
                </div>
              )}
              <textarea
                className="schedule-textarea"
                value={scheduleText}
                onChange={(e) => {
                  setScheduleText(e.currentTarget.value);
                  setScheduleError(null);
                }}
                placeholder="Message to send..."
                rows={3}
              />
              {scheduleError && <div className="schedule-error" role="alert">{scheduleError}</div>}
              <button className="schedule-create-btn" onClick={handleCreateSchedule} disabled={!selectedSessionId || createScheduleMutation.isPending}>
                <CalendarClock className="h-4 w-4" />
                Create
              </button>
            </div>
            <div className="drawer-list schedule-list">
              {schedules.length === 0 && <div className="drawer-empty">No schedules yet</div>}
              {schedules.map((schedule) => (
                <div key={schedule.id} className="schedule-item">
                  <div className="schedule-item-row">
                    <div className="schedule-item-main">
                      <div className="schedule-item-title">
                        <span className={`schedule-status schedule-status--${schedule.status}`}>{schedule.status}</span>
                        <span>{schedule.kind === "once" ? "Once" : schedule.cronExpr}</span>
                      </div>
                      <div className="schedule-item-meta">
                        <span>{schedule.nextRunAt ? `Next ${formatZonedTime(schedule.nextRunAt, schedule.timezone)}` : "No next run"}</span>
                        <span>{schedule.timezone}</span>
                        {schedule.lastRunAt && <span>Last {formatZonedTime(schedule.lastRunAt, schedule.timezone)}</span>}
                      </div>
                    </div>
                    <div className="schedule-actions">
                      <button
                        className="session-action"
                        title="Run history"
                        aria-label="Run history"
                        onClick={() => setExpandedScheduleId((current) => current === schedule.id ? null : schedule.id)}
                      >
                        <Clock className="h-3.5 w-3.5" />
                      </button>
                      {schedule.status === "active" ? (
                        <button className="session-action" title="Pause" aria-label="Pause schedule" onClick={() => updateScheduleMutation.mutate({ id: schedule.id, action: "pause" })}>
                          <Pause className="h-3.5 w-3.5" />
                        </button>
                      ) : schedule.status === "paused" ? (
                        <button className="session-action" title="Resume" aria-label="Resume schedule" onClick={() => updateScheduleMutation.mutate({ id: schedule.id, action: "resume" })}>
                          <Play className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      {schedule.status !== "cancelled" && (
                        <button className="session-action" title="Cancel" aria-label="Cancel schedule" onClick={() => updateScheduleMutation.mutate({ id: schedule.id, action: "cancel" })}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {expandedScheduleId === schedule.id && (
                    <div className="schedule-run-list">
                      {(scheduleRunsData?.runs ?? []).length === 0 && <div className="schedule-run-empty">No runs yet</div>}
                      {(scheduleRunsData?.runs ?? []).map((run) => (
                        <div key={run.id} className="schedule-run-item">
                          <span className={`schedule-status schedule-status--${run.status}`}>{run.status}</span>
                          <span>{formatZonedTime(run.scheduledFor ?? run.createdAt, schedule.timezone)}</span>
                          {run.taskId && <span>{run.taskId}</span>}
                          {run.error && <span title={run.error}>{run.error}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}

      {/* Main content */}
      <div className="chat-main">
        <div className={`chat-messages ${messagesSettling ? "chat-messages--settling" : ""}`} ref={messagesContainerRef}>
          {messages.length === 0 && (
            <div className="chat-empty">
              <Sparkles className="chat-empty-icon" />
              <p>Send a message to start</p>
            </div>
          )}
          {messages.map((msg) => {
            // System "Run succeeded" → stat card
            if (msg.role === "system" && msg.markdown.startsWith("Run succeeded")) {
              return (
                <div key={msg.id} className="chat-stat">
                  {runStats.durationSeconds !== null && <span>{runStats.durationSeconds}s</span>}
                  {runStats.tokensUsed !== null && <span>{runStats.tokensUsed.toLocaleString()} tokens</span>}
                  <span>完成</span>
                </div>
              );
            }
            // System messages → skip others
            if (msg.role === "system") return null;
            return (
              <div key={msg.id} className={`chat-bubble ${msg.role}`}>
                <div className="chat-bubble-header">
                  <strong>{msg.author}</strong>
                  {msg.time && (
                    <span className="chat-time" title={msg.createdAt ?? msg.time}>
                      {formatMessageTime(msg.createdAt ?? msg.time)}
                    </span>
                  )}
                </div>
                <div className="prose-mini">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{msg.markdown}</ReactMarkdown>
                </div>
              </div>
            );
          })}
          {(sendMessage.isPending || isStreaming || streamingText) && messages[messages.length - 1]?.role !== "agent" && (
            <div className="chat-bubble agent">
              <div className="chat-bubble-header"><strong>Agent</strong></div>
              {streamingText ? (
                <div className="prose-mini">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{streamingText}</ReactMarkdown>
                </div>
              ) : (
                <div className="chat-typing">
                  <span className="typing-dots"><span/><span/><span/></span>
                </div>
              )}
            </div>
          )}
        </div>

        {messages.length > 0 && (
          <div className="chat-scroll-controls">
            <button className="chat-scroll-btn" onClick={scrollMessagesToTop} title="Back to top" aria-label="Back to top">
              <ArrowUp className="h-4 w-4" />
            </button>
            <button className="chat-scroll-btn" onClick={() => scrollMessagesToBottom("smooth")} title="Back to bottom" aria-label="Back to bottom">
              <ArrowDown className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="chat-bar">
          <div className="chat-bar-left">
            <button className={`bar-btn ${drawerOpen && drawerTab === "channels" ? "bar-btn--active" : ""}`} onClick={() => openDrawer("channels")} title="Channels">
              <Settings className="h-4 w-4" />
            </button>
            <button className={`bar-btn ${drawerOpen && drawerTab === "skills" ? "bar-btn--active" : ""}`} onClick={() => openDrawer("skills")} title="Skills">
              <Sparkles className="h-4 w-4" />
              <span className="bar-btn-label">Skills</span>
            </button>
            <button className={`bar-btn ${drawerOpen && drawerTab === "sessions" ? "bar-btn--active" : ""}`} onClick={() => openDrawer("sessions")} title="History">
              <Clock className="h-4 w-4" />
              <span className="bar-btn-label">History</span>
            </button>
            <button className={`bar-btn ${drawerOpen && drawerTab === "schedules" ? "bar-btn--active" : ""}`} onClick={() => openDrawer("schedules")} title="Schedules">
              <CalendarClock className="h-4 w-4" />
              <span className="bar-btn-label">Schedules</span>
            </button>
            <div className="dropdown-wrapper">
              <button className="bar-btn" onClick={() => setAgentMenuOpen(!agentMenuOpen)} title="Switch agent">
                <span className="bar-btn-label">{currentAgent.label}</span>
                <ChevronDown className="h-3 w-3" />
              </button>
              {agentMenuOpen && (
                <div className="dropdown-menu">
                  {AGENT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={`dropdown-item ${agentType === opt.value ? "active" : ""}`}
                      onClick={() => { setAgentType(opt.value); setAgentMenuOpen(false); }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <textarea
            ref={draftInputRef}
            className="chat-input"
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
          />
          <button className="send-btn" onClick={handleSend} disabled={sendMessage.isPending || !draft.trim()}>
            <SendHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>

      {agentMenuOpen && (
        <div className="dropdown-backdrop" onClick={() => setAgentMenuOpen(false)} />
      )}
    </main>
  );
}

function formatMessageTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const sameDay = date.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(undefined, {
    month: sameDay ? undefined : "short",
    day: sameDay ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatZonedTime(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(date);
}

function formatSessionUpdatedAt(value?: string): string {
  return formatMessageTime(value);
}

function formatSessionChannel(channelType: WorkspaceSnapshot["sessions"][number]["channelType"]): string {
  if (channelType === "feishu") return "Feishu";
  if (channelType === "qq") return "QQ";
  if (channelType === "telegram") return "Telegram";
  if (channelType === "discord") return "Discord";
  if (channelType === "wechat") return "WeChat";
  if (channelType === "wecom") return "WeCom";
  if (channelType === "dingtalk") return "DingTalk";
  if (channelType === "web") return "Web";
  return "Local";
}

function defaultRunAtInput(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function renderHighlightedSessionName(text: string, query: string) {
  const needle = query.trim();
  if (!needle) return text;

  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const parts = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(lowerNeedle);

  while (matchIndex !== -1) {
    if (matchIndex > cursor) parts.push(text.slice(cursor, matchIndex));
    const end = matchIndex + needle.length;
    parts.push(
      <mark key={`${matchIndex}-${end}`} className="session-highlight">
        {text.slice(matchIndex, end)}
      </mark>,
    );
    cursor = end;
    matchIndex = lowerText.indexOf(lowerNeedle, cursor);
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.length > 0 ? parts : text;
}

const CHANNEL_FIELDS: Record<string, Array<{ key: string; label: string }>> = {
  feishu: [
    { key: "app_id", label: "App ID" },
    { key: "app_secret", label: "App Secret" },
  ],
  qq: [
    { key: "app_id", label: "App ID" },
    { key: "app_secret", label: "App Secret" },
  ],
  telegram: [
    { key: "bot_token", label: "Bot Token" },
  ],
  discord: [
    { key: "bot_token", label: "Bot Token" },
  ],
  wechat: [
    { key: "bot_token", label: "Bot Token" },
  ],
  wecom: [
    { key: "bot_id", label: "Bot ID" },
    { key: "secret", label: "Secret" },
  ],
  dingtalk: [
    { key: "client_id", label: "Client ID (App Key)" },
    { key: "client_secret", label: "Client Secret" },
  ],
};

function ChannelCard({ channel, onSaved }: { channel: ChannelInfo; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<string>("");
  const [qrPolling, setQrPolling] = useState(false);
  const qrPollingRef = useRef(false);

  const configurable = channel.id in CHANNEL_FIELDS;
  const fields = CHANNEL_FIELDS[channel.id] ?? [];
  const initialConfig = channel.config ?? {};
  const [form, setForm] = useState<Record<string, string>>({});

  const startEdit = () => {
    const startValues: Record<string, string> = {};
    for (const f of fields) {
      startValues[f.key] = initialConfig[f.key] ?? "";
    }
    setForm(startValues);
    setEditing(true);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveChannelConfig(channel.id, form);
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testChannel(channel.id);
      setTestResult(result);
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setError(null);
  };

  const handleWechatQRLogin = async () => {
    setError(null);
    setQrStatus("loading");
    setQrPolling(true);
    qrPollingRef.current = true;
    try {
      const qr = await requestWechatQRCode();
      if (qr.error) { setError(qr.error); setQrPolling(false); qrPollingRef.current = false; return; }
      const qrContent = qr.qrcode_img_content ?? qr.qrcode_url ?? "";
      if (!qrContent) { setError("No QR code URL returned"); setQrPolling(false); qrPollingRef.current = false; return; }
      const dataUrl = await QRCode.toDataURL(qrContent, { width: 200, margin: 2 });
      setQrUrl(dataUrl);
      setQrStatus("waiting");
      const qrcodeKey = qr.qrcode ?? qr.token ?? "";
      if (!qrcodeKey) { setError("No qrcode key returned"); setQrPolling(false); qrPollingRef.current = false; return; }
      // Poll until confirmed/expired
      const poll = async () => {
        if (!qrPollingRef.current) return;
        try {
          const s = await pollWechatQRStatus(qrcodeKey);
          if (s.error) { setQrStatus("error"); setError(s.error); setQrPolling(false); qrPollingRef.current = false; return; }
          if (s.status === "confirmed" && s.bot_token) {
            setQrStatus("confirmed");
            setQrPolling(false);
            qrPollingRef.current = false;
            try {
              await saveChannelConfig("wechat", { bot_token: s.bot_token, ...(s.baseurl ? { base_url: s.baseurl } : {}) });
            } catch (e) {
              setQrStatus("error");
              setError(e instanceof Error ? e.message : "Save config failed");
              return;
            }
            onSaved();
            return;
          }
          if (s.status === "expired") { setQrStatus("expired"); setQrPolling(false); qrPollingRef.current = false; return; }
          if (s.status === "scaned") setQrStatus("scanned");
          if (qrPollingRef.current) setTimeout(poll, 2000);
        } catch { if (qrPollingRef.current) setTimeout(poll, 3000); }
      };
      setTimeout(poll, 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "QR request failed");
      setQrPolling(false);
      qrPollingRef.current = false;
    }
  };

  return (
    <div className="channel-card">
      <div className="channel-card-header">
        <strong>{channel.label}</strong>
        <span className={`channel-status channel-status--${channel.status}`}>
          <span className="channel-dot" />
          {channel.status === "connected" ? "Connected" : channel.status === "available" ? "Available" : "Offline"}
        </span>
      </div>
      <p className="channel-card-desc">{channel.description}</p>

      {/* WeChat QR Login */}
      {channel.id === "wechat" && !editing && (
        <div className="channel-actions">
          <button className="channel-config-btn" onClick={handleWechatQRLogin} disabled={qrPolling}>
            {qrPolling ? "Waiting..." : "Scan QR Login"}
          </button>
          <button className="channel-test-btn" onClick={handleTest} disabled={testing}>
            {testing ? "Testing..." : "Test Connection"}
          </button>
        </div>
      )}
      {channel.id === "wechat" && qrUrl && (
        <div className="wechat-qr-container">
          <img src={qrUrl} alt="WeChat QR Code" className="wechat-qr-img" />
          <p className="wechat-qr-status">
            {qrStatus === "waiting" && "Scan with WeChat..."}
            {qrStatus === "scanned" && "Scanned! Confirm on phone..."}
            {qrStatus === "confirmed" && "Login successful!"}
            {qrStatus === "expired" && "QR expired. Try again."}
          </p>
        </div>
      )}

      {configurable && channel.id !== "wechat" && !editing && (
        <div className="channel-actions">
          <button className="channel-config-btn" onClick={startEdit}>
            Configure
          </button>
          <button className="channel-test-btn" onClick={handleTest} disabled={testing}>
            {testing ? "Testing..." : "Test Connection"}
          </button>
        </div>
      )}
      {testResult && (
        <p className={`channel-test-result ${testResult.ok ? "channel-test-ok" : "channel-test-fail"}`}>
          {testResult.ok ? "✓" : "✗"} {testResult.message}
        </p>
      )}

      {configurable && editing && (
        <div className="channel-form">
          {fields.map((f) => (
            <label key={f.key} className="channel-field">
              <span>{f.label}</span>
              <input
                type={f.key.includes("secret") ? "password" : "text"}
                value={form[f.key] ?? ""}
                onChange={(e) => {
	                  const value = e.currentTarget.value;
	                  setForm((prev) => ({ ...prev, [f.key]: value }));
	                }}
                placeholder={f.label}
              />
            </label>
          ))}
          {error && <p className="channel-form-error">{error}</p>}
          <div className="channel-form-actions">
            <button className="channel-form-cancel" onClick={handleCancel}>Cancel</button>
            <button className="channel-form-save" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
