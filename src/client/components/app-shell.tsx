import { ArrowDown, ArrowUp, CalendarClock, Check, CheckCircle2, ClipboardCopy, Clock, ExternalLink, Loader2, Pause, Pencil, Play, Search, SendHorizontal, Settings, Sparkles, Target, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { AgentType, SkillMeta } from "../api/types.js";
import type { ChannelInfo } from "../api/channels.js";
import type { WorkspaceAgentRuntime, WorkspaceSchedule, WorkspaceScheduleKind, WorkspaceScheduleRun, WorkspaceSnapshot } from "../../shared/workspace.js";
import { ChannelCard } from "./channel-card.js";
import { ProviderSelect, TimezoneSelect } from "./controls.js";
import { localizeProviderErrorMessage } from "../lib/error-messages.js";
import { formatCapabilityAvailability, formatCapabilityName, formatProviderStatus, formatScheduleKind, formatScheduleRunStatus, formatScheduleStatus } from "../lib/status-labels.js";

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
  const filteredSessions = props.sessionsQuery.trim()
    ? props.sessions.filter((session) => session.name.toLowerCase().includes(props.sessionsQuery.trim().toLowerCase()))
    : props.sessions;

  return (
    <main className="app-root">
      <nav className="app-nav" aria-label="Primary">
        <div className="app-brand">MiniAgent</div>
        <button className={`nav-item ${props.activeSection === "workspace" ? "active" : ""}`} onClick={() => props.setActiveSection("workspace")}>
          <Clock className="h-4 w-4" />
          <span>工作台</span>
        </button>
        <button className={`nav-item ${props.activeSection === "skills" ? "active" : ""}`} onClick={() => props.setActiveSection("skills")}>
          <Sparkles className="h-4 w-4" />
          <span>技能</span>
        </button>
        <button className={`nav-item ${props.activeSection === "tasks" ? "active" : ""}`} onClick={() => props.setActiveSection("tasks")}>
          <CalendarClock className="h-4 w-4" />
          <span>任务</span>
        </button>
        <button className={`nav-item ${props.activeSection === "settings" ? "active" : ""}`} onClick={() => props.setActiveSection("settings")}>
          <Settings className="h-4 w-4" />
          <span>设置</span>
        </button>
      </nav>

      <aside className="side-pane">
        {props.activeSection === "workspace" && (
          <>
            <div className="side-header">
              <span className="side-eyebrow">工作台</span>
              <h2>会话列表</h2>
            </div>
            <div className="side-search">
              <Search className="h-4 w-4 side-search-icon" />
              <input
                ref={props.sessionsSearchRef}
                className="side-search-input"
                value={props.sessionsQuery}
                onChange={(event) => props.setSessionsQuery(event.currentTarget.value)}
                placeholder="搜索会话..."
              />
            </div>
            <div className="context-list">
              {props.sessions.length === 0 && <div className="side-empty">暂无会话</div>}
              {props.sessions.length > 0 && filteredSessions.length === 0 && <div className="side-empty">没有匹配的会话</div>}
              {filteredSessions.map((session) => {
                const sessionName = session.name || session.title || "未命名会话";
                const isEditing = props.editingSessionId === session.id;
                return (
                  <div key={session.id} className={`session-item ${session.id === props.sessionId ? "session-item--active" : ""}`}>
                    {isEditing ? (
                      <form className="session-edit" onSubmit={(event) => { event.preventDefault(); props.submitSessionRename(session.id); }}>
                        <div className="session-edit-row">
                          <input
                            className="session-name-input"
                            value={props.editingSessionName}
                            onChange={(event) => props.setEditingSessionName(event.currentTarget.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") props.cancelSessionRename();
                            }}
                            aria-label="会话名称"
                            aria-invalid={props.renameSessionError ? "true" : "false"}
                            aria-describedby={props.renameSessionError ? `session-rename-error-${session.id}` : undefined}
                            autoFocus
                          />
                          <button className="session-edit-btn" type="submit" title="保存" aria-label="保存会话名称" disabled={props.renameSessionPending}>
                            <Check className="h-4 w-4" />
                          </button>
                          <button className="session-edit-btn" type="button" title="取消" aria-label="取消重命名" onClick={props.cancelSessionRename}>
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        {props.renameSessionError && (
                          <div id={`session-rename-error-${session.id}`} className="session-edit-error" role="alert">
                            {props.renameSessionError}
                          </div>
                        )}
                      </form>
                    ) : (
                      <>
                        <button className="session-select" onClick={() => props.selectSession(session.id)}>
                          <span className="session-title" title={sessionName}>{props.renderHighlightedSessionName(sessionName, props.sessionsQuery)}</span>
                          <span className="session-meta">
                            <span>{props.formatSessionChannel(session.channelType)}</span>
                            <span>{props.formatSessionUpdatedAt(session.updatedAt)}</span>
                          </span>
                        </button>
                        <button className="session-action" title="重命名" aria-label={`重命名 ${sessionName}`} onClick={() => props.startSessionRename(session.id, sessionName)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <span className={`session-status session-status--${session.status}`}>
                          <span className="session-dot" />
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
              {props.sessionsHasMore && (
                <div ref={props.sessionsSentinelRef} className="session-sentinel">
                  {props.sessionsLoadingMore && <Loader2 className="h-4 w-4 session-sentinel-spinner" />}
                </div>
              )}
            </div>
          </>
        )}

        {props.activeSection === "skills" && (
          <>
            <div className="side-header">
              <span className="side-eyebrow">技能</span>
              <h2>技能列表</h2>
            </div>
            <div className="side-search">
              <Search className="h-4 w-4 side-search-icon" />
              <input
                ref={props.skillsSearchRef}
                className="side-search-input"
                value={props.skillsQuery}
                onChange={(event) => props.setSkillsQuery(event.currentTarget.value)}
                placeholder="搜索技能..."
              />
            </div>
            <div className="context-list">
              {props.filteredSkills.length === 0 && <div className="side-empty">没有匹配的技能</div>}
              {props.filteredSkills.map((skill) => (
                <button
                  key={skill.name}
                  className={`context-item ${props.selectedSkill?.name === skill.name ? "context-item--active" : ""}`}
                  onClick={() => props.handleSkillSelect(skill)}
                >
                  <strong>{skill.name}</strong>
                  {skill.description && <span>{skill.description}</span>}
                </button>
              ))}
            </div>
          </>
        )}

        {props.activeSection === "tasks" && (
          <>
            <div className="side-header">
              <span className="side-eyebrow">任务</span>
              <h2>定时任务列表</h2>
            </div>
            <div className="context-list">
              <button className={`context-item context-item--create ${!props.selectedSchedule ? "context-item--active" : ""}`} onClick={props.startNewSchedule}>
                <strong>新建任务</strong>
                <span title={props.selectedSessionName}>{props.selectedSessionName}</span>
              </button>
              {props.schedules.length === 0 && <div className="side-empty">暂无任务</div>}
              {props.schedules.map((schedule) => (
                <button
                  key={schedule.id}
                  className={`schedule-item schedule-item--button ${props.selectedSchedule?.id === schedule.id ? "schedule-item--active" : ""}`}
                  onClick={() => {
                    props.setSelectedScheduleId(schedule.id);
                    props.setEditingScheduleId(null);
                  }}
                >
                  <span className="schedule-item-title">
                    <span className={`schedule-status schedule-status--${schedule.status}`}>{formatScheduleStatus(schedule.status)}</span>
                    <span>{schedule.kind === "once" ? formatScheduleKind(schedule.kind) : schedule.cronExpr}</span>
                  </span>
                  <span className="schedule-item-meta">
                    <span>{schedule.nextRunAt ? `下次执行 ${props.formatZonedTime(schedule.nextRunAt, schedule.timezone)}` : "暂无下次执行"}</span>
                    <span>{schedule.timezone}</span>
                  </span>
                  {schedule.payloadSummary && <span className="schedule-item-summary" title={schedule.payloadText ?? schedule.payloadSummary}>{schedule.payloadSummary}</span>}
                </button>
              ))}
            </div>
          </>
        )}

        {props.activeSection === "settings" && (
          <>
            <div className="side-header">
              <span className="side-eyebrow">设置</span>
              <h2>设置项</h2>
            </div>
            <div className="context-list">
              <button className={`context-item ${props.settingsSection === "channels" ? "context-item--active" : ""}`} onClick={() => props.setSettingsSection("channels")}>
                <strong>消息通道</strong>
                <span>Feishu, QQ, Telegram, WeChat</span>
              </button>
              <button className={`context-item ${props.settingsSection === "provider" ? "context-item--active" : ""}`} onClick={() => props.setSettingsSection("provider")}>
                <strong>提供方</strong>
                <span>默认 {props.agentType}</span>
              </button>
            </div>
          </>
        )}
      </aside>

      <section className={`detail-pane detail-pane--${props.activeSection}`}>
        {props.activeSection === "workspace" && (
          <div className="chat-main">
            {props.sessionId && props.messages.length > 0 && (
              <ChatHeader sessionId={props.sessionId} sessions={props.sessions} />
            )}
            <div className={`chat-messages ${props.messagesSettling ? "chat-messages--settling" : ""}`} ref={props.messagesContainerRef}>
              {props.messages.length === 0 && (
                <div className="chat-empty">
                  <Sparkles className="chat-empty-icon" />
                  <p>发送消息开始对话</p>
                </div>
              )}
              {props.messages.map((message) => {
                if (!isMessageDisplayable(message)) return null;
                if (message.role === "system" && message.markdown.startsWith("Run succeeded")) {
                  return (
                    <div key={message.id} className="chat-stat">
                      {props.runStats.durationSeconds !== null && <span>{props.runStats.durationSeconds}s</span>}
                      {props.runStats.tokensUsed !== null && <span>{props.runStats.tokensUsed.toLocaleString()} tokens</span>}
                      <span>完成</span>
                    </div>
                  );
                }
                const isFocusedRun = Boolean(props.focusedRunId && message.runId === props.focusedRunId);
                return (
                  <div key={message.id} className={`chat-bubble ${message.role} ${isFocusedRun ? "chat-bubble--focused-run" : ""}`} data-run-id={message.runId ?? undefined}>
                    <div className="chat-bubble-header">
                      <strong>{message.author}</strong>
                      {message.time && <span className="chat-time" title={message.createdAt ?? message.time}>{formatMessageTime(message.createdAt ?? message.time)}</span>}
                    </div>
                    <div className="prose-mini">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{message.markdown}</ReactMarkdown>
                    </div>
                  </div>
                );
              })}
              {(props.sendMessagePending || props.isStreaming || props.streamingText) && props.messages[props.messages.length - 1]?.role !== "agent" && (
                <div className="chat-bubble agent">
                  <div className="chat-bubble-header"><strong>Agent</strong></div>
                  {props.streamingText ? (
                    <div className="prose-mini">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{props.streamingText}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="chat-typing">
                      <span className="typing-dots"><span /><span /><span /></span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {props.messages.length > 0 && (
              <div className="chat-scroll-controls">
                <button className="chat-scroll-btn" onClick={props.scrollMessagesToTop} title="回到顶部" aria-label="回到顶部">
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button className="chat-scroll-btn" onClick={() => props.scrollMessagesToBottom("smooth")} title="回到底部" aria-label="回到底部">
                  <ArrowDown className="h-4 w-4" />
                </button>
              </div>
            )}

            <div className="chat-bar">
              <textarea
                ref={props.draftInputRef}
                className="chat-input"
                value={props.draft}
                onChange={(event) => props.setDraft(event.currentTarget.value)}
                onKeyDown={props.handleKeyDown}
                placeholder="输入消息..."
                rows={1}
              />
              <button className="send-btn" onClick={props.handleSend} disabled={props.sendMessagePending || !props.draft.trim()}>
                <SendHorizontal className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {props.activeSection === "skills" && (
          <div className="detail-scroll">
            {props.selectedSkill ? (
              <>
                <div className="detail-header">
                  <div>
                    <span className="side-eyebrow">技能详情</span>
                    <h1>{props.selectedSkill.name}</h1>
                  </div>
                  <button className="primary-action" onClick={() => props.useSkillInWorkspace(props.selectedSkill!)}>
                    <Sparkles className="h-4 w-4" />
                    使用技能
                  </button>
                </div>
                <div className="detail-section">
                  <h2>说明</h2>
                  <p>{props.selectedSkill.description || "暂无说明。"}</p>
                </div>
                <div className="detail-section">
                  <h2>调用方式</h2>
                  <code className="inline-code">/{props.selectedSkill.name}</code>
                </div>
                <div className="detail-section">
                  <h2>路径</h2>
                  <div className="skill-path-row">
                    <code className="inline-code skill-path-code">{props.selectedSkill.path}</code>
                    <button
                      className="copy-path-btn"
                      title="复制路径"
                      onClick={() => { navigator.clipboard.writeText(props.selectedSkill!.path); }}
                    >
                      <ClipboardCopy className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="detail-empty">尚未选择技能</div>
            )}
          </div>
        )}

        {props.activeSection === "tasks" && (
          <div className="detail-scroll">
            {!props.selectedSchedule ? (
              <>
                <div className="detail-header">
                  <div>
                    <span className="side-eyebrow">定时任务详情</span>
                    <h1>新建任务</h1>
                  </div>
                </div>
                <div className="schedule-form schedule-form--detail">
                  <div className="segmented-control" role="group" aria-label="任务类型">
                    <button className={`segmented-btn ${props.scheduleKind === "once" ? "active" : ""}`} onClick={() => props.setScheduleKind("once")}>单次</button>
                    <button className={`segmented-btn ${props.scheduleKind === "cron" ? "active" : ""}`} onClick={() => props.setScheduleKind("cron")}>周期</button>
                  </div>
                  {props.scheduleKind === "once"
                    ? <input className="schedule-input" type="datetime-local" value={props.scheduleRunAt} onChange={(event) => props.setScheduleRunAt(event.currentTarget.value)} aria-label="执行时间" />
                    : <input className="schedule-input" value={props.scheduleCronExpr} onChange={(event) => props.setScheduleCronExpr(event.currentTarget.value)} placeholder="0 9 * * 1-5" aria-label="Cron 表达式" />}
                  <TimezoneSelect value={props.scheduleTimezone} onChange={props.setScheduleTimezone} label="时区" />
                  {props.scheduleKind === "cron" && (
                    <div className={`schedule-preview ${props.schedulePreviewError instanceof Error ? "schedule-preview--error" : ""}`}>
                      {props.schedulePreviewError instanceof Error
                        ? props.schedulePreviewError.message
                        : props.schedulePreview
                          ? `下次执行 ${props.formatZonedTime(props.schedulePreview.nextRunAt, props.scheduleTimezone)}`
                          : "正在计算下次执行时间..."}
                    </div>
                  )}
                  <textarea className="schedule-textarea" value={props.scheduleText} onChange={(event) => props.setScheduleText(event.currentTarget.value)} placeholder="输入要发送的消息..." rows={4} />
                  {props.scheduleError && <div className="schedule-error" role="alert">{props.scheduleError}</div>}
                  <button className="schedule-create-btn" onClick={props.handleCreateSchedule} disabled={!props.selectedSessionId || props.createSchedulePending}>
                    <CalendarClock className="h-4 w-4" />
                    创建
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="detail-header">
                  <div>
                    <span className="side-eyebrow">定时任务详情</span>
                    <h1>{props.selectedSchedule.kind === "once" ? "单次任务" : props.selectedSchedule.cronExpr}</h1>
                  </div>
                  <div className="detail-actions">
                    {props.selectedSchedule.status !== "cancelled" && (
                      <button className="secondary-action" onClick={() => props.startScheduleEdit(props.selectedSchedule!)}>
                        <Pencil className="h-4 w-4" />
                        编辑
                      </button>
                    )}
                    {props.selectedSchedule.status === "active"
                      ? (
                        <button className="secondary-action" onClick={() => props.updateSchedule({ id: props.selectedSchedule!.id, action: "pause" })}>
                          <Pause className="h-4 w-4" />
                          暂停
                        </button>
                        )
                      : props.selectedSchedule.status === "paused"
                        ? (
                          <button className="secondary-action" onClick={() => props.updateSchedule({ id: props.selectedSchedule!.id, action: "resume" })}>
                            <Play className="h-4 w-4" />
                            恢复
                          </button>
                          )
                        : null}
                    {props.selectedSchedule.status !== "cancelled" && (
                      <button className="secondary-action secondary-action--danger" onClick={() => props.updateSchedule({ id: props.selectedSchedule!.id, action: "cancel" })}>
                        <Trash2 className="h-4 w-4" />
                        取消
                      </button>
                    )}
                  </div>
                </div>
                <div className="detail-section detail-grid">
                  <div><span>状态</span><strong>{formatScheduleStatus(props.selectedSchedule.status)}</strong></div>
                  <div><span>时区</span><strong>{props.selectedSchedule.timezone}</strong></div>
                  <div><span>下次执行</span><strong>{props.selectedSchedule.nextRunAt ? props.formatZonedTime(props.selectedSchedule.nextRunAt, props.selectedSchedule.timezone) : "暂无下次执行"}</strong></div>
                  <div><span>会话</span><strong>{props.selectedSessionName}</strong></div>
                </div>
                {props.selectedSchedule.payloadSummary && (
                  <div className="detail-section">
                    <h2>消息内容</h2>
                    <p>{props.selectedSchedule.payloadText ?? props.selectedSchedule.payloadSummary}</p>
                  </div>
                )}
                {props.editingScheduleId === props.selectedSchedule.id && (
                  <div className="detail-section">
                    <h2>编辑任务</h2>
                    <div className="schedule-edit-form schedule-edit-form--detail">
                      <div className="segmented-control" role="group" aria-label="编辑任务类型">
                        <button className={`segmented-btn ${props.editScheduleKind === "once" ? "active" : ""}`} onClick={() => props.setEditScheduleKind("once")}>单次</button>
                        <button className={`segmented-btn ${props.editScheduleKind === "cron" ? "active" : ""}`} onClick={() => props.setEditScheduleKind("cron")}>周期</button>
                      </div>
                      {props.editScheduleKind === "once"
                        ? <input className="schedule-input" type="datetime-local" value={props.editScheduleRunAt} onChange={(event) => props.setEditScheduleRunAt(event.currentTarget.value)} aria-label="编辑执行时间" />
                        : <input className="schedule-input" value={props.editScheduleCronExpr} onChange={(event) => props.setEditScheduleCronExpr(event.currentTarget.value)} aria-label="编辑 Cron 表达式" />}
                      <TimezoneSelect value={props.editScheduleTimezone} onChange={props.setEditScheduleTimezone} label="编辑时区" />
                      {props.editScheduleKind === "cron" && (
                        <div className={`schedule-preview ${props.editSchedulePreviewError instanceof Error ? "schedule-preview--error" : ""}`}>
                          {props.editSchedulePreviewError instanceof Error
                            ? props.editSchedulePreviewError.message
                            : props.editSchedulePreview
                              ? `下次执行 ${props.formatZonedTime(props.editSchedulePreview.nextRunAt, props.editScheduleTimezone)}`
                              : "正在计算下次执行时间..."}
                        </div>
                      )}
                      <textarea className="schedule-textarea" value={props.editScheduleText} onChange={(event) => props.setEditScheduleText(event.currentTarget.value)} aria-label="编辑消息" rows={4} />
                      {props.editScheduleError && <div className="schedule-error" role="alert">{props.editScheduleError}</div>}
                      <div className="schedule-edit-actions">
                        <button className="schedule-secondary-btn" onClick={() => props.setEditingScheduleId(null)}>取消</button>
                        <button className="schedule-create-btn" onClick={props.submitScheduleEdit} disabled={props.editSchedulePending}>
                          <Check className="h-4 w-4" />
                          保存
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                <div className="detail-section">
                  <h2>运行记录</h2>
                  <div className="schedule-run-list schedule-run-list--detail">
                    {props.scheduleRuns.length === 0 && <div className="schedule-run-empty">暂无执行记录</div>}
                    {props.scheduleRuns.map((run) => (
                      <div key={run.id} className="schedule-run-item">
                        <div className="schedule-run-main">
                          <span className={`schedule-status schedule-status--${run.status}`}>{formatScheduleRunStatus(run.status)}</span>
                          <span>{props.formatZonedTime(run.scheduledFor ?? run.createdAt, props.selectedSchedule!.timezone)}</span>
                          {run.payloadSummary && <span title={run.payloadSummary}>{run.payloadSummary}</span>}
                          {run.taskId && <span title={run.taskId}>{run.taskId}</span>}
                          {run.error && <span title={run.error}>{run.error}</span>}
                        </div>
                        <div className="schedule-run-actions">
                          <button className="schedule-run-action" title="打开会话" aria-label={`打开会话 ${run.taskId ?? run.id}`} onClick={() => props.openScheduleRun(run, false)}>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </button>
                          <button
                            className="schedule-run-action"
                            title={run.runId ? "打开任务输出" : "任务输出暂不可用"}
                            aria-label={run.runId ? `打开任务输出 ${run.taskId ?? run.id}` : `任务输出暂不可用 ${run.taskId ?? run.id}`}
                            disabled={!run.runId}
                            onClick={() => props.openScheduleRun(run, true)}
                          >
                            <Target className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {props.activeSection === "settings" && (
          <div className="detail-scroll">
            <div className="detail-header">
              <div>
                <span className="side-eyebrow">设置</span>
                <h1>{props.settingsSection === "channels" ? "消息通道详情" : "提供方详情"}</h1>
              </div>
            </div>
            {props.settingsSection === "channels" ? (
              <div className="settings-channel-grid">
                {props.channels.length === 0 && <div className="detail-empty">暂无可用通道</div>}
                {props.channels.map((channel) => (
                  <ChannelCard key={channel.id} channel={channel} onSaved={props.onChannelsSaved} />
                ))}
              </div>
            ) : (
              <div className="detail-section">
                <h2>默认提供方</h2>
                <ProviderSelect
                  value={props.agentType}
                  onChange={props.setAgentType}
                  agents={props.providerRuntimes}
                  saving={props.providerSavePending}
                />
                {props.providerError && <p className="provider-error" role="alert">{props.providerError}</p>}
              </div>
            )}
            {props.settingsSection === "provider" && (
              <div className="detail-section">
                <h2>提供方能力</h2>
                <div className="provider-capability-grid">
                  {props.providerRuntimes.map((runtime) => (
                    <div key={runtime.agentType} className={`provider-capability-card ${runtime.agentType === props.agentType ? "provider-capability-card--active" : ""}`}>
                      <div className="provider-capability-header">
                        <div>
                          <strong>{runtime.label}</strong>
                          <p>{runtime.command}</p>
                        </div>
                        <span className={`provider-status-badge provider-status-badge--${runtime.status}`}>{formatProviderStatus(runtime.status)}</span>
                      </div>
                      {runtime.message && <p className="provider-capability-message">{localizeProviderErrorMessage(runtime.message)}</p>}
                      <div className="provider-capability-list">
                        {Object.entries(runtime.capabilities).map(([name, enabled]) => (
                          <span key={name} className={`provider-capability-pill ${enabled ? "provider-capability-pill--enabled" : "provider-capability-pill--disabled"}`}>
                            {formatCapabilityName(name)}：{formatCapabilityAvailability(enabled)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
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

function isMessageDisplayable(message: { role: string; markdown: string }): boolean {
  if (message.role === "user") return true;
  if (message.role === "system" && message.markdown.startsWith("Run succeeded")) return true;
  if (message.role === "system") return false;
  if (message.role === "agent" || message.role === "assistant") {
    const content = message.markdown.trim();
    if (!content) return false;
    if (/^<thinking>[\s\S]*<\/thinking>$/.test(content)) return false;
  }
  return true;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);
  return (
    <button className="chat-header-copy" title={`复制${label}`} onClick={handleCopy}>
      {copied ? <CheckCircle2 className="h-3.5 w-3.5 chat-header-copied" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
    </button>
  );
}

function ChatHeader({ sessionId, sessions }: { sessionId: string; sessions: WorkspaceSnapshot["sessions"] }) {
  const session = sessions.find((s) => s.id === sessionId);
  const sessionName = session?.name ?? "未命名会话";
  return (
    <div className="chat-header">
      <div className="chat-header-item">
        <span className="chat-header-name" title={sessionName}>{sessionName}</span>
        <CopyButton text={sessionName} label="会话名称" />
      </div>
      <div className="chat-header-item">
        <code className="chat-header-id" title={sessionId}>{sessionId.length > 16 ? `${sessionId.slice(0, 8)}...${sessionId.slice(-4)}` : sessionId}</code>
        <CopyButton text={sessionId} label="会话ID" />
      </div>
    </div>
  );
}
