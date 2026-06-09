import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { fetchChannels } from "./api/channels.js";
import { AppShell } from "./components/app-shell.js";
import { formatSessionChannel, formatSessionUpdatedAt, formatZonedTime, renderHighlightedSessionName } from "./lib/formatters.js";
import type { WorkspaceScheduleRun } from "../shared/workspace.js";
import { useNavigation } from "./hooks/use-navigation.js";
import { useProvider } from "./hooks/use-provider.js";
import { useSkills } from "./hooks/use-skills.js";
import { useSessions } from "./hooks/use-sessions.js";
import { useSchedules } from "./hooks/use-schedules.js";
import { useChatStream } from "./hooks/use-chat-stream.js";
import { useChatScroll } from "./hooks/use-chat-scroll.js";
import { useChatInput } from "./hooks/use-chat-input.js";

export default function App() {
  const queryClient = useQueryClient();

  // Hook 1: Navigation (hash sync)
  const { activeSection, setActiveSection, settingsSection, setSettingsSection } = useNavigation();

  // Hook 2: Provider (agent type + runtimes)
  const { agentType, setAgentType, providerRuntimes, providerSavePending, providerError } = useProvider();

  // Hook 3: Skills (search, filter, select)
  const { skillsQuery, setSkillsQuery, skillsSearchRef, filteredSkills, selectedSkill, handleSkillSelect } = useSkills(activeSection);

  // Hook 4: Sessions (list, select, rename, infinite scroll)
  const {
    sessionId, setSessionId, orderedSessions, sessionsQuery, setSessionsQuery,
    sessionsSearchRef, sessionsHasMore, sessionsLoadingMore, sessionsSentinelRef,
    handleNewSession: rawHandleNewSession,
    resetInfiniteScroll,
    editingSessionId, editingSessionName, setEditingSessionName,
    renameSessionError, renameSessionPending, startSessionRename, submitSessionRename, cancelSessionRename,
    selectSession, selectedSessionId, selectedSessionName, snapshot,
  } = useSessions({
    activeSection,
    agentType,
    onNewSession: () => {
      setDraft("");
      setActiveSection("workspace");
    },
  });

  // Hook 5: Schedules (CRUD, preview, runs)
  const schedules = useSchedules({ selectedSessionId, activeSection });

  // Channels query (stays at App level — only used by SettingsDetail)
  const { data: channelsData } = useQuery({
    queryKey: ["channels"],
    queryFn: fetchChannels,
  });
  const channels = channelsData?.channels ?? [];

  // Derived from workspace snapshot
  const messages = snapshot?.messages ?? [];
  const hasWorkspaceSnapshot = snapshot !== undefined;
  const runStats = snapshot?.runStats ?? { durationSeconds: null, tokensUsed: null, tokensTotal: null };

  // Hook 6: Chat stream (SSE — highest risk)
  const {
    isStreaming, setIsStreaming, isStreamingRef,
    streamingText, setStreamingText, streamingTextRef,
    streamStartCountRef,
  } = useChatStream(sessionId);

  // Stream completion: when agent message appears, stop streaming
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

  // Hook 7: Chat scroll (auto-scroll, user intent, focus target)
  const {
    messagesContainerRef, scrollMessagesToTop, scrollMessagesToBottom,
    focusedScheduleTarget, setFocusedScheduleTarget, messagesSessionKey, messagesSettling,
  } = useChatScroll({
    sessionId,
    selectedSessionId,
    messages,
    hasWorkspaceSnapshot,
    streamingText,
  });

  // Hook 8: Chat input (draft, send, keydown, skill-in-workspace)
  const { draft, setDraft, draftInputRef, handleKeyDown, handleSend, sendMessagePending, useSkillInWorkspace } = useChatInput({
    sessionId,
    setSessionId,
    agentType,
    messages,
    isStreamingRef,
    setIsStreaming,
    streamingTextRef,
    setStreamingText,
    streamStartCountRef,
    scrollMessagesToBottom,
    onSendSuccess: () => {
      resetInfiniteScroll();
    },
  });

  // Compose handleNewSession to also clear draft + switch section
  const handleNewSession = rawHandleNewSession;

  // Schedule run click: navigate to session + optionally scroll to run
  const openScheduleRun = (run: WorkspaceScheduleRun, focusOutput: boolean) => {
    setSessionId(run.sessionId);
    localStorage.setItem("sessionId", run.sessionId);
    setActiveSection("workspace");
    setFocusedScheduleTarget(focusOutput && run.runId ? { sessionId: run.sessionId, runId: run.runId } : null);
    queryClient.invalidateQueries({ queryKey: ["workspace", run.sessionId] });
  };

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
      sessionsHasMore={sessionsHasMore}
      sessionsLoadingMore={sessionsLoadingMore}
      sessionsSentinelRef={sessionsSentinelRef}
      handleNewSession={handleNewSession}
      editingSessionId={editingSessionId}
      editingSessionName={editingSessionName}
      setEditingSessionName={setEditingSessionName}
      renameSessionError={renameSessionError}
      renameSessionPending={renameSessionPending}
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
      schedules={schedules.schedules}
      selectedSchedule={schedules.selectedSchedule}
      setSelectedScheduleId={schedules.setSelectedScheduleId}
      setEditingScheduleId={schedules.setEditingScheduleId}
      startNewSchedule={schedules.startNewSchedule}
      scheduleKind={schedules.scheduleKind}
      setScheduleKind={schedules.setScheduleKind}
      scheduleRunAt={schedules.scheduleRunAt}
      setScheduleRunAt={schedules.setScheduleRunAt}
      scheduleCronExpr={schedules.scheduleCronExpr}
      setScheduleCronExpr={schedules.setScheduleCronExpr}
      scheduleTimezone={schedules.scheduleTimezone}
      setScheduleTimezone={schedules.setScheduleTimezone}
      schedulePreview={schedules.schedulePreview}
      schedulePreviewError={schedules.schedulePreviewError}
      scheduleText={schedules.scheduleText}
      setScheduleText={schedules.setScheduleText}
      scheduleError={schedules.scheduleError}
      createSchedulePending={schedules.createSchedulePending}
      selectedSessionId={selectedSessionId}
      handleCreateSchedule={schedules.handleCreateSchedule}
      editingScheduleId={schedules.editingScheduleId}
      editScheduleKind={schedules.editScheduleKind}
      setEditScheduleKind={schedules.setEditScheduleKind}
      editScheduleRunAt={schedules.editScheduleRunAt}
      setEditScheduleRunAt={schedules.setEditScheduleRunAt}
      editScheduleCronExpr={schedules.editScheduleCronExpr}
      setEditScheduleCronExpr={schedules.setEditScheduleCronExpr}
      editScheduleTimezone={schedules.editScheduleTimezone}
      setEditScheduleTimezone={schedules.setEditScheduleTimezone}
      editSchedulePreview={schedules.editSchedulePreview}
      editSchedulePreviewError={schedules.editSchedulePreviewError}
      editScheduleText={schedules.editScheduleText}
      setEditScheduleText={schedules.setEditScheduleText}
      editScheduleError={schedules.editScheduleError}
      editSchedulePending={schedules.editSchedulePending}
      submitScheduleEdit={schedules.submitScheduleEdit}
      startScheduleEdit={schedules.startScheduleEdit}
      scheduleRuns={schedules.scheduleRuns}
      updateSchedule={schedules.updateSchedule}
      openScheduleRun={openScheduleRun}
      formatZonedTime={formatZonedTime}
      channels={channels}
      onChannelsSaved={() => queryClient.invalidateQueries({ queryKey: ["channels"] })}
      agentType={agentType}
      setAgentType={setAgentType}
      providerRuntimes={providerRuntimes}
      providerSavePending={providerSavePending}
      providerError={providerError}
      messages={messages}
      messagesSettling={messagesSettling}
      messagesContainerRef={messagesContainerRef}
      runStats={runStats}
      focusedRunId={focusedScheduleTarget?.runId ?? null}
      sendMessagePending={sendMessagePending}
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
