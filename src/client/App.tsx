import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fetchAgents, resolveAgentDefault, setAgentDefault } from "./api/agents.js";
import { fetchChannels } from "./api/channels.js";
import { sendSessionMessage } from "./api/messages.js";
import { createSchedule, fetchScheduleRuns, fetchSchedules, previewSchedule, updateSchedule, updateScheduleStatus } from "./api/schedules.js";
import { createSession, updateSessionName } from "./api/sessions.js";
import { fetchSkills } from "./api/skills.js";
import type { AgentType, SkillMeta } from "./api/types.js";
import { AppShell } from "./components/app-shell.js";
import { createChatScrollController, type ChatScrollController } from "./lib/chat-scroll.js";
import { localizeAppErrorMessage, localizeProviderErrorMessage } from "./lib/error-messages.js";
import type { WorkspaceSchedule, WorkspaceScheduleKind, WorkspaceScheduleRun, WorkspaceSnapshot } from "../shared/workspace.js";

type AppSection = "workspace" | "skills" | "tasks" | "settings";
type SettingsSection = "channels" | "provider";

const SESSION_STORAGE_KEY = "sessionId";
const DEFAULT_AGENT_TYPE: AgentType = "claude";

export default function App() {
  const queryClient = useQueryClient();
  const [agentType, setAgentTypeState] = useState<AgentType>(DEFAULT_AGENT_TYPE);
  const [sessionId, setSessionId] = useState<string | null>(() => readStoredSessionId());
  const [draft, setDraft] = useState("");
  const [activeSection, setActiveSection] = useState<AppSection>(() => getNavigationStateFromHash().activeSection);
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(() => getNavigationStateFromHash().settingsSection);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
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
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [editScheduleKind, setEditScheduleKind] = useState<WorkspaceScheduleKind>("once");
  const [editScheduleRunAt, setEditScheduleRunAt] = useState("");
  const [editScheduleCronExpr, setEditScheduleCronExpr] = useState("");
  const [editScheduleTimezone, setEditScheduleTimezone] = useState("Asia/Shanghai");
  const [editScheduleText, setEditScheduleText] = useState("");
  const [editScheduleError, setEditScheduleError] = useState<string | null>(null);
  const [focusedScheduleTarget, setFocusedScheduleTarget] = useState<{ sessionId: string; runId: string } | null>(null);
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
  const lastGlobalSeqRef = useRef(0);
  const [providerError, setProviderError] = useState<string | null>(null);
  const stableSessionOrderRef = useRef<string[]>([]);

  const { data: providerRuntimesData, error: providerRuntimesError } = useQuery({
    queryKey: ["agents"],
    queryFn: fetchAgents,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const providerRuntimes = providerRuntimesData?.agents ?? [];

  const { data: providerDefaultData, error: providerDefaultError } = useQuery({
    queryKey: ["agent-defaults", "resolve"],
    queryFn: resolveAgentDefault,
    staleTime: 30_000,
  });

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
  const channels = channelsData?.channels ?? [];

  const filteredSkills = skillsQuery
    ? skills.filter(
        (skill) =>
          skill.name.toLowerCase().includes(skillsQuery.toLowerCase()) ||
          skill.description.toLowerCase().includes(skillsQuery.toLowerCase()),
      )
    : skills;

  const { data: snapshot } = useQuery({
    queryKey: ["workspace", sessionId],
    queryFn: async () => {
      const qs = sessionId ? `?sessionId=${sessionId}` : "";
      const res = await fetch(`/api/workspace${qs}`);
      if (!res.ok) throw new Error("加载失败");
      return res.json() as Promise<WorkspaceSnapshot>;
    },
    refetchInterval: 3_000,
    placeholderData: (previous) => previous,
  });

  const sessions = snapshot?.sessions ?? [];
  const orderedSessions = useMemo(() => {
    const nextIds = sessions.map((session) => session.id);
    const existing = stableSessionOrderRef.current.filter((id) => nextIds.includes(id));
    const unseen = nextIds.filter((id) => !existing.includes(id));
    const nextOrder = [...existing, ...unseen];
    stableSessionOrderRef.current = nextOrder;
    return nextOrder
      .map((id) => sessions.find((session) => session.id === id) ?? null)
      .filter((session): session is NonNullable<typeof session> => session !== null);
  }, [sessions]);
  const selectedSessionId = sessionId ?? snapshot?.selectedSessionId ?? null;
  const selectedSessionName = orderedSessions.find((session) => session.id === selectedSessionId)?.name ?? "当前会话";

  const { data: schedulesData } = useQuery({
    queryKey: ["schedules", selectedSessionId],
    queryFn: () => selectedSessionId ? fetchSchedules(selectedSessionId) : Promise.resolve({ schedules: [] }),
    enabled: activeSection === "tasks",
    refetchInterval: activeSection === "tasks" ? 10_000 : false,
  });
  const schedules = schedulesData?.schedules ?? [];
  const selectedSchedule = selectedScheduleId ? schedules.find((schedule) => schedule.id === selectedScheduleId) ?? null : null;
  const selectedSkill = selectedSkillName
    ? skills.find((skill) => skill.name === selectedSkillName) ?? filteredSkills[0] ?? skills[0] ?? null
    : filteredSkills[0] ?? skills[0] ?? null;
  const { data: schedulePreview, error: schedulePreviewError } = useQuery({
    queryKey: ["schedule-preview", scheduleKind, scheduleCronExpr, scheduleRunAt, scheduleTimezone],
    queryFn: () => previewSchedule({
      kind: scheduleKind,
      cronExpr: scheduleKind === "cron" ? scheduleCronExpr.trim() : null,
      runAt: scheduleKind === "once" ? new Date(scheduleRunAt).toISOString() : null,
      timezone: scheduleTimezone,
    }),
    enabled: activeSection === "tasks" && !selectedSchedule && scheduleKind === "cron" && scheduleCronExpr.trim().length > 0,
    retry: false,
    staleTime: 5_000,
  });
  const { data: editSchedulePreview, error: editSchedulePreviewError } = useQuery({
    queryKey: ["schedule-edit-preview", editingScheduleId, editScheduleKind, editScheduleCronExpr, editScheduleTimezone],
    queryFn: () => previewSchedule({
      kind: editScheduleKind,
      cronExpr: editScheduleKind === "cron" ? editScheduleCronExpr.trim() : null,
      runAt: editScheduleKind === "once" ? new Date(editScheduleRunAt).toISOString() : null,
      timezone: editScheduleTimezone,
    }),
    enabled: activeSection === "tasks" && Boolean(editingScheduleId) && editScheduleKind === "cron" && editScheduleCronExpr.trim().length > 0,
    retry: false,
    staleTime: 5_000,
  });
  const { data: scheduleRunsData } = useQuery({
    queryKey: ["schedule-runs", selectedScheduleId],
    queryFn: () => selectedScheduleId ? fetchScheduleRuns(selectedScheduleId) : Promise.resolve({ runs: [] }),
    enabled: activeSection === "tasks" && Boolean(selectedScheduleId),
    refetchInterval: activeSection === "tasks" && selectedScheduleId ? 10_000 : false,
  });
  const scheduleRuns = scheduleRunsData?.runs ?? [];

  useEffect(() => {
    if (!sessionId && snapshot?.selectedSessionId) {
      setSessionId(snapshot.selectedSessionId);
      localStorage.setItem(SESSION_STORAGE_KEY, snapshot.selectedSessionId);
    }
  }, [snapshot?.selectedSessionId, sessionId]);

  useEffect(() => {
    if (providerDefaultData?.default.agentType && isAgentType(providerDefaultData.default.agentType)) {
      setAgentTypeState(providerDefaultData.default.agentType);
      return;
    }
    const firstHealthyRuntime = providerRuntimes.find((runtime) => runtime.status === "healthy");
    if (!firstHealthyRuntime) return;
    setAgentTypeState((current) => {
      const currentRuntime = providerRuntimes.find((runtime) => runtime.agentType === current);
      return currentRuntime?.status === "healthy" ? current : firstHealthyRuntime.agentType;
    });
  }, [providerDefaultData, providerRuntimes]);

  useEffect(() => {
    const nextHash = buildNavigationHash(activeSection, settingsSection);
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
    }
  }, [activeSection, settingsSection]);

  useEffect(() => {
    const syncFromHash = () => {
      const nextState = getNavigationStateFromHash();
      setActiveSection(nextState.activeSection);
      setSettingsSection(nextState.settingsSection);
    };

    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

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
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

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
      source.addEventListener("run_started", (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.runId) activeRunIdRef.current = payload.runId;
        } catch {}
      });
      source.addEventListener("run_completed", (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.runId && payload.runId === activeRunIdRef.current) {
            activeRunIdRef.current = null;
          }
        } catch {}
      });
      source.addEventListener("text_delta", (event: MessageEvent) => {
        if (activeRunIdRef.current) {
          try {
            const payload = JSON.parse(event.data);
            if (payload.payload?.text) {
              streamingTextRef.current += payload.payload.text;
              setStreamingText(streamingTextRef.current);
            }
          } catch {}
        }
        refresh();
      });
      source.addEventListener("message_created", (event: MessageEvent) => {
        try {
          lastGlobalSeqRef.current = JSON.parse(event.data).globalSeq ?? lastGlobalSeqRef.current;
        } catch {}
      });
      source.addEventListener("text_delta", (event: MessageEvent) => {
        try {
          lastGlobalSeqRef.current = JSON.parse(event.data).globalSeq ?? lastGlobalSeqRef.current;
        } catch {}
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
  }, [queryClient, sessionId]);

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
  }, [hasWorkspaceSnapshot, lastMessageId, messages.length, messagesSessionKey, scrollController, settledMessagesSessionKey]);

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
  }, [scrollController, streamingText]);

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

  useEffect(() => {
    if (activeSection === "skills") {
      requestAnimationFrame(() => skillsSearchRef.current?.focus());
    }
    if (activeSection === "workspace") {
      requestAnimationFrame(() => sessionsSearchRef.current?.focus());
    }
  }, [activeSection]);

  useLayoutEffect(() => {
    resizeDraftInput();
  }, [draft]);

  useEffect(() => {
    const runId = focusedScheduleTarget?.runId;
    if (!runId || focusedScheduleTarget.sessionId !== messagesSessionKey) return;

    const container = messagesContainerRef.current;
    if (!container) return;

    const target = Array.from(container.querySelectorAll<HTMLElement>("[data-run-id]"))
      .find((element) => element.dataset.runId === runId);
    if (!target) return;

    const frameId = window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const timerId = window.setTimeout(() => {
      setFocusedScheduleTarget((current) => current?.runId === runId ? null : current);
    }, 2_400);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timerId);
    };
  }, [focusedScheduleTarget, lastMessageId, messages.length, messagesSessionKey]);

  const sendMessage = useMutation({
    mutationFn: async (text: string) => {
      streamingTextRef.current = "";
      setStreamingText("");
      isStreamingRef.current = true;
      setIsStreaming(true);
      activeRunIdRef.current = null;
      streamStartCountRef.current = messages.length;
      let nextSessionId = sessionId;
      if (!nextSessionId) {
        const res = await createSession({ agentType });
        nextSessionId = res.sessionId;
        setSessionId(nextSessionId);
      }
      const result = await sendSessionMessage(nextSessionId, { text });
      return { ...result, sessionId: nextSessionId };
    },
    onSuccess: (data) => {
      setDraft("");
      setSessionId(data.sessionId);
      localStorage.setItem(SESSION_STORAGE_KEY, data.sessionId);
      queryClient.invalidateQueries({ queryKey: ["workspace", data.sessionId] });
    },
  });

  const saveAgentDefaultMutation = useMutation({
    mutationFn: async (nextAgentType: AgentType) => {
      return setAgentDefault({
        scopeType: "system",
        scopeRef: "default",
        agentType: nextAgentType,
      });
    },
    onMutate: (nextAgentType) => {
      setProviderError(null);
      const previousAgentType = agentType;
      setAgentTypeState(nextAgentType);
      return { previousAgentType };
    },
    onSuccess: (data) => {
      setAgentTypeState(data.default.agentType);
      queryClient.invalidateQueries({ queryKey: ["agent-defaults", "resolve"] });
    },
    onError: (error, _nextAgentType, context) => {
      if (context?.previousAgentType) {
        setAgentTypeState(context.previousAgentType);
      }
      setProviderError(localizeProviderErrorMessage(error instanceof Error ? error.message : "Save provider failed"));
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
      setRenameSessionError(localizeAppErrorMessage(error instanceof Error ? error.message : "Rename failed"));
    },
  });

  const createScheduleMutation = useMutation({
    mutationFn: () => {
      if (!selectedSessionId) throw new Error("未选择会话");
      const text = scheduleText.trim();
      if (!text) throw new Error("请输入消息内容");
      if (scheduleKind === "once" && !scheduleRunAt) throw new Error("请选择执行时间");
      if (scheduleKind === "cron" && !scheduleCronExpr.trim()) throw new Error("请输入 Cron 表达式");
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
    onSuccess: (data) => {
      setScheduleText("");
      setScheduleRunAt(defaultRunAtInput());
      setSelectedScheduleId(data.schedule.id);
      queryClient.invalidateQueries({ queryKey: ["schedules", selectedSessionId] });
    },
    onError: (error) => {
      setScheduleError(localizeAppErrorMessage(error instanceof Error ? error.message : "Create schedule failed"));
    },
  });

  const updateScheduleMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "pause" | "resume" | "cancel" }) =>
      updateScheduleStatus(id, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedules", selectedSessionId] });
      queryClient.invalidateQueries({ queryKey: ["schedule-runs", selectedScheduleId] });
    },
  });

  const editScheduleMutation = useMutation({
    mutationFn: () => {
      if (!editingScheduleId) throw new Error("未选择任务");
      const text = editScheduleText.trim();
      if (!text) throw new Error("请输入消息内容");
      if (editScheduleKind === "once" && !editScheduleRunAt) throw new Error("请选择执行时间");
      if (editScheduleKind === "cron" && !editScheduleCronExpr.trim()) throw new Error("请输入 Cron 表达式");
      return updateSchedule(editingScheduleId, {
        kind: editScheduleKind,
        runAt: editScheduleKind === "once" ? new Date(editScheduleRunAt).toISOString() : null,
        cronExpr: editScheduleKind === "cron" ? editScheduleCronExpr.trim() : null,
        timezone: editScheduleTimezone,
        payload: { text },
        actorType: "web_user",
      });
    },
    onMutate: () => {
      setEditScheduleError(null);
    },
    onSuccess: () => {
      setEditingScheduleId(null);
      setEditScheduleError(null);
      queryClient.invalidateQueries({ queryKey: ["schedules", selectedSessionId] });
      queryClient.invalidateQueries({ queryKey: ["schedule-runs", selectedScheduleId] });
    },
    onError: (error) => {
      setEditScheduleError(localizeAppErrorMessage(error instanceof Error ? error.message : "Update schedule failed"));
    },
  });

  const handleSend = () => {
    const text = draft.trim();
    if (!text || sendMessage.isPending) return;
    sendMessage.mutate(text);
  };

  const handleSkillSelect = (skill: SkillMeta) => {
    setSelectedSkillName(skill.name);
  };

  const useSkillInWorkspace = (skill: SkillMeta) => {
    setDraft(`/${skill.name} `);
    setActiveSection("workspace");
    requestAnimationFrame(() => draftInputRef.current?.focus());
  };

  const handleCreateSchedule = () => {
    if (createScheduleMutation.isPending) return;
    createScheduleMutation.mutate();
  };

  const startNewSchedule = () => {
    setSelectedScheduleId(null);
    setEditingScheduleId(null);
    setScheduleError(null);
  };

  const startScheduleEdit = (schedule: WorkspaceSchedule) => {
    setSelectedScheduleId(schedule.id);
    setEditingScheduleId(schedule.id);
    setEditScheduleKind(schedule.kind);
    setEditScheduleRunAt(toDateTimeInput(schedule.runAt ?? schedule.nextRunAt ?? undefined));
    setEditScheduleCronExpr(schedule.cronExpr ?? "");
    setEditScheduleTimezone(schedule.timezone);
    setEditScheduleText(schedule.payloadText ?? "");
    setEditScheduleError(null);
  };

  const submitScheduleEdit = () => {
    if (editScheduleMutation.isPending) return;
    editScheduleMutation.mutate();
  };

  const openScheduleRun = (run: WorkspaceScheduleRun, focusOutput: boolean) => {
    setSessionId(run.sessionId);
    localStorage.setItem(SESSION_STORAGE_KEY, run.sessionId);
    setActiveSection("workspace");
    setFocusedScheduleTarget(focusOutput && run.runId ? { sessionId: run.sessionId, runId: run.runId } : null);
    queryClient.invalidateQueries({ queryKey: ["workspace", run.sessionId] });
  };

  const selectSession = (id: string) => {
    setSessionId(id);
    localStorage.setItem(SESSION_STORAGE_KEY, id);
    setFocusedScheduleTarget(null);
    queryClient.invalidateQueries({ queryKey: ["workspace", id] });
  };

  const startSessionRename = (id: string, name: string) => {
    setEditingSessionId(id);
    setEditingSessionName(name);
    setRenameSessionError(null);
  };

  const cancelSessionRename = () => {
    setEditingSessionId(null);
    setEditingSessionName("");
    setRenameSessionError(null);
  };

  const submitSessionRename = (id: string) => {
    const nextName = editingSessionName.trim();
    if (renameSession.isPending) return;
    if (!nextName) {
      setRenameSessionError("名称不能为空");
      return;
    }
    renameSession.mutate({ id, name: nextName });
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && event.shiftKey) {
      requestAnimationFrame(resizeDraftInput);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const setAgentType = (nextAgentType: AgentType) => {
    if (nextAgentType === agentType || saveAgentDefaultMutation.isPending) return;
    saveAgentDefaultMutation.mutate(nextAgentType);
  };

  const effectiveProviderError = providerError
    ?? (providerRuntimesError instanceof Error ? localizeProviderErrorMessage(providerRuntimesError.message) : null)
    ?? (providerDefaultError instanceof Error ? localizeProviderErrorMessage(providerDefaultError.message) : null);

  return (
    <AppShell
      activeSection={activeSection}
      setActiveSection={setActiveSection}
      settingsSection={settingsSection}
      setSettingsSection={setSettingsSection}
      sessions={orderedSessions}
      sessionId={sessionId}
      sessionsQuery={sessionsQuery}
      setSessionsQuery={setSessionsQuery}
      sessionsSearchRef={sessionsSearchRef}
      editingSessionId={editingSessionId}
      editingSessionName={editingSessionName}
      setEditingSessionName={setEditingSessionName}
      renameSessionError={renameSessionError}
      renameSessionPending={renameSession.isPending}
      startSessionRename={startSessionRename}
      submitSessionRename={submitSessionRename}
      cancelSessionRename={cancelSessionRename}
      selectSession={selectSession}
      renderHighlightedSessionName={renderHighlightedSessionName}
      formatSessionUpdatedAt={formatSessionUpdatedAt}
      formatSessionChannel={formatSessionChannel}
      skillsQuery={skillsQuery}
      setSkillsQuery={setSkillsQuery}
      skillsSearchRef={skillsSearchRef}
      filteredSkills={filteredSkills}
      selectedSkill={selectedSkill}
      handleSkillSelect={handleSkillSelect}
      useSkillInWorkspace={useSkillInWorkspace}
      selectedSessionName={selectedSessionName}
      schedules={schedules}
      selectedSchedule={selectedSchedule}
      setSelectedScheduleId={setSelectedScheduleId}
      setEditingScheduleId={setEditingScheduleId}
      startNewSchedule={startNewSchedule}
      scheduleKind={scheduleKind}
      setScheduleKind={setScheduleKind}
      scheduleRunAt={scheduleRunAt}
      setScheduleRunAt={setScheduleRunAt}
      scheduleCronExpr={scheduleCronExpr}
      setScheduleCronExpr={setScheduleCronExpr}
      scheduleTimezone={scheduleTimezone}
      setScheduleTimezone={setScheduleTimezone}
      schedulePreview={schedulePreview}
      schedulePreviewError={schedulePreviewError}
      scheduleText={scheduleText}
      setScheduleText={setScheduleText}
      scheduleError={scheduleError}
      createSchedulePending={createScheduleMutation.isPending}
      selectedSessionId={selectedSessionId}
      handleCreateSchedule={handleCreateSchedule}
      editingScheduleId={editingScheduleId}
      editScheduleKind={editScheduleKind}
      setEditScheduleKind={setEditScheduleKind}
      editScheduleRunAt={editScheduleRunAt}
      setEditScheduleRunAt={setEditScheduleRunAt}
      editScheduleCronExpr={editScheduleCronExpr}
      setEditScheduleCronExpr={setEditScheduleCronExpr}
      editScheduleTimezone={editScheduleTimezone}
      setEditScheduleTimezone={setEditScheduleTimezone}
      editSchedulePreview={editSchedulePreview}
      editSchedulePreviewError={editSchedulePreviewError}
      editScheduleText={editScheduleText}
      setEditScheduleText={setEditScheduleText}
      editScheduleError={editScheduleError}
      editSchedulePending={editScheduleMutation.isPending}
      submitScheduleEdit={submitScheduleEdit}
      startScheduleEdit={startScheduleEdit}
      scheduleRuns={scheduleRuns}
      updateSchedule={(input) => updateScheduleMutation.mutate(input)}
      openScheduleRun={openScheduleRun}
      formatZonedTime={formatZonedTime}
      channels={channels}
      onChannelsSaved={() => queryClient.invalidateQueries({ queryKey: ["channels"] })}
      agentType={agentType}
      setAgentType={setAgentType}
      providerRuntimes={providerRuntimes}
      providerSavePending={saveAgentDefaultMutation.isPending}
      providerError={effectiveProviderError}
      messages={messages}
      messagesSettling={messagesSettling}
      messagesContainerRef={messagesContainerRef}
      runStats={runStats}
      focusedRunId={focusedScheduleTarget?.runId ?? null}
      sendMessagePending={sendMessage.isPending}
      isStreaming={isStreaming}
      streamingText={streamingText}
      scrollMessagesToTop={scrollMessagesToTop}
      scrollMessagesToBottom={scrollMessagesToBottom}
      draftInputRef={draftInputRef}
      draft={draft}
      setDraft={setDraft}
      handleKeyDown={handleKeyDown}
      handleSend={handleSend}
    />
  );
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
  if (channelType === "web") return "网页";
  return "本地";
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

function defaultRunAtInput(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  return toDateTimeInput(date);
}

function toDateTimeInput(value?: string | Date): string {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return defaultRunAtInput();
  const pad = (input: number) => String(input).padStart(2, "0");
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

function readStoredSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SESSION_STORAGE_KEY);
}

function isAgentType(value: string | null): value is AgentType {
  return value === "codex" || value === "claude" || value === "trae";
}

function getNavigationStateFromHash(): { activeSection: AppSection; settingsSection: SettingsSection } {
  if (typeof window === "undefined") {
    return { activeSection: "workspace", settingsSection: "channels" };
  }

  const rawHash = window.location.hash.replace(/^#/, "");
  if (rawHash === "skills") return { activeSection: "skills", settingsSection: "channels" };
  if (rawHash === "tasks") return { activeSection: "tasks", settingsSection: "channels" };
  if (rawHash.startsWith("settings")) {
    const detail = rawHash.split("/")[1];
    return {
      activeSection: "settings",
      settingsSection: detail === "provider" ? "provider" : "channels",
    };
  }
  return { activeSection: "workspace", settingsSection: "channels" };
}

function buildNavigationHash(activeSection: AppSection, settingsSection: SettingsSection): string {
  if (activeSection === "settings") return `#settings/${settingsSection}`;
  return `#${activeSection}`;
}
