import type { AgentType, SkillMeta } from "../api/types.js";
import type { ChannelInfo } from "../api/channels.js";
import type { NotificationPreference, WorkspaceAgentRuntime, WorkspaceSchedule, WorkspaceScheduleKind, WorkspaceScheduleNotificationTarget, WorkspaceScheduleRun, WorkspaceSnapshot } from "../../shared/workspace.js";
import { NavBar } from "./nav-bar.js";
import { ChatView, ScheduleDetail, ScheduleList, SessionList, SettingsDetail, SettingsList, SkillDetail, SkillList } from "./sections/index.js";

type AppSection = "workspace" | "skills" | "tasks" | "settings";
type SettingsSection = "channels" | "provider";

export function AppShell(props: {
  activeSection: AppSection;
  setActiveSection: (section: AppSection) => void;
  settingsSection: SettingsSection;
  setSettingsSection: (section: SettingsSection) => void;
  sessions: WorkspaceSnapshot["sessions"];
  sessionId: string | null;
  sessionsQuery: string;
  setSessionsQuery: (value: string) => void;
  sessionsSearchRef: React.RefObject<HTMLInputElement | null>;
  sessionsHasMore: boolean;
  sessionsLoadingMore: boolean;
  sessionsSentinelRef: React.RefObject<HTMLDivElement | null>;
  handleNewSession: () => void;
  isCreatingSession: boolean;
  editingSessionId: string | null;
  editingSessionName: string;
  setEditingSessionName: (value: string) => void;
  renameSessionError: string | null;
  renameSessionPending: boolean;
  startSessionRename: (id: string, name: string) => void;
  submitSessionRename: (id: string) => void;
  cancelSessionRename: () => void;
  selectSession: (id: string) => void;
  renderHighlightedSessionName: (text: string, query: string) => React.ReactNode;
  formatSessionUpdatedAt: (value?: string) => string;
  formatSessionChannel: (channelType: WorkspaceSnapshot["sessions"][number]["channelType"]) => string;
  skillsQuery: string;
  setSkillsQuery: (value: string) => void;
  skillsSearchRef: React.RefObject<HTMLInputElement | null>;
  filteredSkills: SkillMeta[];
  selectedSkill: SkillMeta | null;
  handleSkillSelect: (skill: SkillMeta) => void;
  useSkillInWorkspace: (skill: SkillMeta) => void;
  selectedSessionName: string;
  schedules: WorkspaceSchedule[];
  selectedSchedule: WorkspaceSchedule | null;
  setSelectedScheduleId: (id: string | null) => void;
  setEditingScheduleId: (id: string | null) => void;
  startNewSchedule: () => void;
  scheduleKind: WorkspaceScheduleKind;
  setScheduleKind: (kind: WorkspaceScheduleKind) => void;
  scheduleRunAt: string;
  setScheduleRunAt: (value: string) => void;
  scheduleCronExpr: string;
  setScheduleCronExpr: (value: string) => void;
  scheduleTimezone: string;
  setScheduleTimezone: (value: string) => void;
  schedulePreview: { nextRunAt: string } | undefined;
  schedulePreviewError: unknown;
  scheduleText: string;
  setScheduleText: (value: string) => void;
  scheduleError: string | null;
  createSchedulePending: boolean;
  selectedSessionId: string | null;
  handleCreateSchedule: () => void;
  editingScheduleId: string | null;
  editScheduleKind: WorkspaceScheduleKind;
  setEditScheduleKind: (kind: WorkspaceScheduleKind) => void;
  editScheduleRunAt: string;
  setEditScheduleRunAt: (value: string) => void;
  editScheduleCronExpr: string;
  setEditScheduleCronExpr: (value: string) => void;
  editScheduleTimezone: string;
  setEditScheduleTimezone: (value: string) => void;
  editSchedulePreview: { nextRunAt: string } | undefined;
  editSchedulePreviewError: unknown;
  editScheduleText: string;
  setEditScheduleText: (value: string) => void;
  editScheduleError: string | null;
  editSchedulePending: boolean;
  submitScheduleEdit: () => void;
  startScheduleEdit: (schedule: WorkspaceSchedule) => void;
  scheduleRuns: WorkspaceScheduleRun[];
  updateSchedule: (input: { id: string; action: "pause" | "resume" | "cancel" }) => void;
  openScheduleRun: (run: WorkspaceScheduleRun, focusOutput: boolean) => void;
  formatZonedTime: (value: string, timezone: string) => string;
  channels: ChannelInfo[];
  onChannelsSaved: () => void;
  notificationPreference: NotificationPreference | null;
  latestPrivateNotificationTargets: WorkspaceScheduleNotificationTarget[];
  notificationPreferenceLoading: boolean;
  agentType: AgentType;
  setAgentType: (value: AgentType) => void;
  providerRuntimes: WorkspaceAgentRuntime[];
  providerSavePending: boolean;
  providerError: string | null;
  messages: WorkspaceSnapshot["messages"];
  messagesSettling: boolean;
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  runStats: { durationSeconds: number | null; tokensUsed: number | null; tokensTotal: number | null };
  focusedRunId: string | null;
  sendMessagePending: boolean;
  isStreaming: boolean;
  streamingText: string;
  scrollMessagesToTop: () => void;
  scrollMessagesToBottom: (behavior: ScrollBehavior) => void;
  draftInputRef: React.RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (value: string) => void;
  handleKeyDown: (event: React.KeyboardEvent) => void;
  handleSend: () => void;
}) {
  return (
    <main className="app-root">
      <NavBar activeSection={props.activeSection} setActiveSection={props.setActiveSection} />

      <aside className="side-pane">
        {props.activeSection === "workspace" && (
          <SessionList
            sessions={props.sessions}
            sessionId={props.sessionId}
            sessionsQuery={props.sessionsQuery}
            setSessionsQuery={props.setSessionsQuery}
            sessionsSearchRef={props.sessionsSearchRef}
            sessionsHasMore={props.sessionsHasMore}
            sessionsLoadingMore={props.sessionsLoadingMore}
            sessionsSentinelRef={props.sessionsSentinelRef}
            handleNewSession={props.handleNewSession}
            isCreatingSession={props.isCreatingSession}
            editingSessionId={props.editingSessionId}
            editingSessionName={props.editingSessionName}
            setEditingSessionName={props.setEditingSessionName}
            renameSessionError={props.renameSessionError}
            renameSessionPending={props.renameSessionPending}
            startSessionRename={props.startSessionRename}
            submitSessionRename={props.submitSessionRename}
            cancelSessionRename={props.cancelSessionRename}
            selectSession={props.selectSession}
            renderHighlightedSessionName={props.renderHighlightedSessionName}
            formatSessionUpdatedAt={props.formatSessionUpdatedAt}
            formatSessionChannel={props.formatSessionChannel}
          />
        )}
        {props.activeSection === "skills" && (
          <SkillList
            skillsQuery={props.skillsQuery}
            setSkillsQuery={props.setSkillsQuery}
            skillsSearchRef={props.skillsSearchRef}
            filteredSkills={props.filteredSkills}
            selectedSkill={props.selectedSkill}
            handleSkillSelect={props.handleSkillSelect}
          />
        )}
        {props.activeSection === "tasks" && (
          <ScheduleList
            schedules={props.schedules}
            selectedSchedule={props.selectedSchedule}
            setSelectedScheduleId={props.setSelectedScheduleId}
            setEditingScheduleId={props.setEditingScheduleId}
            startNewSchedule={props.startNewSchedule}
            selectedSessionName={props.selectedSessionName}
            formatZonedTime={props.formatZonedTime}
          />
        )}
        {props.activeSection === "settings" && (
          <SettingsList
            settingsSection={props.settingsSection}
            setSettingsSection={props.setSettingsSection}
            agentType={props.agentType}
          />
        )}
      </aside>

      <section className={`detail-pane detail-pane--${props.activeSection}`}>
        {props.activeSection === "workspace" && (
          <ChatView
            sessionId={props.sessionId}
            sessions={props.sessions}
            messages={props.messages}
            messagesSettling={props.messagesSettling}
            messagesContainerRef={props.messagesContainerRef}
            runStats={props.runStats}
            focusedRunId={props.focusedRunId}
            sendMessagePending={props.sendMessagePending}
            isStreaming={props.isStreaming}
            streamingText={props.streamingText}
            scrollMessagesToTop={props.scrollMessagesToTop}
            scrollMessagesToBottom={props.scrollMessagesToBottom}
            draftInputRef={props.draftInputRef}
            draft={props.draft}
            setDraft={props.setDraft}
            handleKeyDown={props.handleKeyDown}
            handleSend={props.handleSend}
          />
        )}
        {props.activeSection === "skills" && (
          <SkillDetail
            selectedSkill={props.selectedSkill}
            useSkillInWorkspace={props.useSkillInWorkspace}
          />
        )}
        {props.activeSection === "tasks" && (
          <ScheduleDetail
            selectedSchedule={props.selectedSchedule}
            selectedSessionName={props.selectedSessionName}
            startScheduleEdit={props.startScheduleEdit}
            updateSchedule={props.updateSchedule}
            openScheduleRun={props.openScheduleRun}
            formatZonedTime={props.formatZonedTime}
            editingScheduleId={props.editingScheduleId}
            editScheduleKind={props.editScheduleKind}
            setEditScheduleKind={props.setEditScheduleKind}
            editScheduleRunAt={props.editScheduleRunAt}
            setEditScheduleRunAt={props.setEditScheduleRunAt}
            editScheduleCronExpr={props.editScheduleCronExpr}
            setEditScheduleCronExpr={props.setEditScheduleCronExpr}
            editScheduleTimezone={props.editScheduleTimezone}
            setEditScheduleTimezone={props.setEditScheduleTimezone}
            editSchedulePreview={props.editSchedulePreview}
            editSchedulePreviewError={props.editSchedulePreviewError}
            editScheduleText={props.editScheduleText}
            setEditScheduleText={props.setEditScheduleText}
            editScheduleError={props.editScheduleError}
            editSchedulePending={props.editSchedulePending}
            submitScheduleEdit={props.submitScheduleEdit}
            setEditingScheduleId={props.setEditingScheduleId}
            scheduleRuns={props.scheduleRuns}
            selectedSessionId={props.selectedSessionId}
            scheduleKind={props.scheduleKind}
            setScheduleKind={props.setScheduleKind}
            scheduleRunAt={props.scheduleRunAt}
            setScheduleRunAt={props.setScheduleRunAt}
            scheduleCronExpr={props.scheduleCronExpr}
            setScheduleCronExpr={props.setScheduleCronExpr}
            scheduleTimezone={props.scheduleTimezone}
            setScheduleTimezone={props.setScheduleTimezone}
            schedulePreview={props.schedulePreview}
            schedulePreviewError={props.schedulePreviewError}
            scheduleText={props.scheduleText}
            setScheduleText={props.setScheduleText}
            scheduleError={props.scheduleError}
            createSchedulePending={props.createSchedulePending}
            handleCreateSchedule={props.handleCreateSchedule}
          />
        )}
        {props.activeSection === "settings" && (
          <SettingsDetail
            settingsSection={props.settingsSection}
            channels={props.channels}
            onChannelsSaved={props.onChannelsSaved}
            notificationPreference={props.notificationPreference}
            latestPrivateNotificationTargets={props.latestPrivateNotificationTargets}
            notificationPreferenceLoading={props.notificationPreferenceLoading}
            agentType={props.agentType}
            setAgentType={props.setAgentType}
            providerRuntimes={props.providerRuntimes}
            providerSavePending={props.providerSavePending}
            providerError={props.providerError}
          />
        )}
      </section>
    </main>
  );
}
