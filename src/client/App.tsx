import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchChannels } from "./api/channels.js";
import { fetchDefaultNotificationPreference } from "./api/notification-preferences.js";
import { AppShell } from "./components/app-shell.js";
import { formatSessionChannel, formatSessionUpdatedAt, formatZonedTime, renderHighlightedSessionName } from "./lib/formatters.js";
import type { WorkspaceScheduleRun } from "../shared/workspace.js";
import { useNavigation } from "./hooks/use-navigation.js";
import { useProvider } from "./hooks/use-provider.js";
import { useSkills } from "./hooks/use-skills.js";
import { useSessions } from "./hooks/use-sessions.js";
import { useSchedules } from "./hooks/use-schedules.js";
import { useWorkflows } from "./hooks/use-workflows.js";

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
    isCreatingSession,
    selectionMode, setSelectionMode, selectedIds, toggleSelected, exitSelectionMode, deleteSelected, deleting,
    deleteOne: deleteOneSession,
    editingSessionId, editingSessionName, setEditingSessionName,
    renameSessionError, renameSessionPending, startSessionRename, submitSessionRename, cancelSessionRename,
    selectSession, selectedSessionId, selectedSessionName,
  } = useSessions({
    activeSection,
    agentType,
    onNewSession: () => {
      setActiveSection("workspace");
    },
  });

  // Hook 5: Schedules (CRUD, preview, runs)
  const schedules = useSchedules({ selectedSessionId, activeSection });
  const workflows = useWorkflows(activeSection);

  // Channels query (stays at App level — only used by SettingsDetail)
  const { data: channelsData } = useQuery({
    queryKey: ["channels"],
    queryFn: fetchChannels,
  });
  const channels = channelsData?.channels ?? [];

  const { data: notificationPreferenceData, isFetching: notificationPreferenceLoading } = useQuery({
    queryKey: ["notification-preferences", "default"],
    queryFn: fetchDefaultNotificationPreference,
  });

  // Compose handleNewSession: the raw hook already switches to workspace.
  const handleNewSession = rawHandleNewSession;

  // Schedule run click: navigate to the session's card. Scrolling + flash is
  // handled by the AppShell effect that watches selectedSessionId.
  const openScheduleRun = (run: WorkspaceScheduleRun, _focusOutput: boolean) => {
    setSessionId(run.sessionId);
    localStorage.setItem("sessionId", run.sessionId);
    setActiveSection("workspace");
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
      isCreatingSession={isCreatingSession}
      selectionMode={selectionMode}
      setSelectionMode={setSelectionMode}
      selectedIds={selectedIds}
      toggleSelected={toggleSelected}
      exitSelectionMode={exitSelectionMode}
      deleteSelected={deleteSelected}
      deleting={deleting}
      deleteOneSession={deleteOneSession}
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
      notificationPreference={notificationPreferenceData?.preference ?? null}
      latestPrivateNotificationTargets={notificationPreferenceData?.latestPrivateTargets ?? []}
      notificationPreferenceLoading={notificationPreferenceLoading}
      agentType={agentType}
      setAgentType={setAgentType}
      providerRuntimes={providerRuntimes}
      providerSavePending={providerSavePending}
      providerError={providerError}
      workflowRuns={workflows.runs}
      selectedWorkflowRun={workflows.selectedRun}
      setWorkflowRunId={workflows.setSelectedRunId}
      resolveWorkflowGate={workflows.resolveGate}
      workflowResolving={workflows.resolving}
      onCreateWorkflow={workflows.createRun}
      workflowCreating={workflows.creating}
      workflowSelectionMode={workflows.selectionMode}
      setWorkflowSelectionMode={workflows.setSelectionMode}
      workflowSelectedIds={workflows.selectedIds}
      toggleWorkflowSelected={workflows.toggleSelected}
      exitWorkflowSelectionMode={workflows.exitSelectionMode}
      deleteWorkflowSelected={workflows.deleteSelected}
      workflowDeleting={workflows.deleting}
      workflowSelectAll={workflows.selectAll}
      workflowDeleteOne={workflows.deleteOne}
    />
  );
}
