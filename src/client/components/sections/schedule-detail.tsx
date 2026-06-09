import { CalendarClock, Check, ExternalLink, Pencil, Pause, Play, Target, Trash2 } from "lucide-react";
import type { WorkspaceSchedule, WorkspaceScheduleKind, WorkspaceScheduleRun } from "../../../shared/workspace.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Input, Textarea } from "../ui/input.js";
import { TimezoneSelect } from "../controls.js";
import { formatScheduleRunStatus, formatScheduleStatus } from "../../lib/status-labels.js";

/** Map schedule/run status strings to Badge tone */
function scheduleStatusTone(status: string): "success" | "warning" | "error" | "muted" | "info" | "default" {
  if (status === "active" || status === "succeeded") return "success";
  if (status === "paused") return "warning";
  if (status === "failed") return "error";
  if (status === "cancelled") return "muted";
  if (status === "running" || status === "scheduled" || status === "queued") return "info";
  return "default";
}

interface ScheduleDetailProps {
  selectedSchedule: WorkspaceSchedule | null;
  selectedSessionName: string;
  startScheduleEdit: (schedule: WorkspaceSchedule) => void;
  updateSchedule: (input: { id: string; action: "pause" | "resume" | "cancel" }) => void;
  openScheduleRun: (run: WorkspaceScheduleRun, focusOutput: boolean) => void;
  formatZonedTime: (value: string, timezone: string) => string;
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
  setEditingScheduleId: (id: string | null) => void;
  scheduleRuns: WorkspaceScheduleRun[];
  selectedSessionId: string | null;
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
  handleCreateSchedule: () => void;
}

export function ScheduleDetail({
  selectedSchedule,
  selectedSessionName,
  startScheduleEdit,
  updateSchedule,
  openScheduleRun,
  formatZonedTime,
  editingScheduleId,
  editScheduleKind,
  setEditScheduleKind,
  editScheduleRunAt,
  setEditScheduleRunAt,
  editScheduleCronExpr,
  setEditScheduleCronExpr,
  editScheduleTimezone,
  setEditScheduleTimezone,
  editSchedulePreview,
  editSchedulePreviewError,
  editScheduleText,
  setEditScheduleText,
  editScheduleError,
  editSchedulePending,
  submitScheduleEdit,
  setEditingScheduleId,
  scheduleRuns,
  selectedSessionId,
  scheduleKind,
  setScheduleKind,
  scheduleRunAt,
  setScheduleRunAt,
  scheduleCronExpr,
  setScheduleCronExpr,
  scheduleTimezone,
  setScheduleTimezone,
  schedulePreview,
  schedulePreviewError,
  scheduleText,
  setScheduleText,
  scheduleError,
  createSchedulePending,
  handleCreateSchedule,
}: ScheduleDetailProps) {
  return (
    <div className="detail-scroll">
      {!selectedSchedule ? (
        <>
          <div className="detail-header">
            <div>
              <span className="side-eyebrow">定时任务详情</span>
              <h1>新建任务</h1>
            </div>
          </div>
          <div className="schedule-form schedule-form--detail">
            <div className="segmented-control" role="group" aria-label="任务类型">
              <button className={`segmented-btn ${scheduleKind === "once" ? "active" : ""}`} onClick={() => setScheduleKind("once")}>单次</button>
              <button className={`segmented-btn ${scheduleKind === "cron" ? "active" : ""}`} onClick={() => setScheduleKind("cron")}>周期</button>
            </div>
            {scheduleKind === "once"
              ? <Input inputSize="md" type="datetime-local" value={scheduleRunAt} onChange={(event) => setScheduleRunAt(event.currentTarget.value)} aria-label="执行时间" />
              : <Input inputSize="md" value={scheduleCronExpr} onChange={(event) => setScheduleCronExpr(event.currentTarget.value)} placeholder="0 9 * * 1-5" aria-label="Cron 表达式" />}
            <TimezoneSelect value={scheduleTimezone} onChange={setScheduleTimezone} label="时区" />
            {scheduleKind === "cron" && (
              <div className={`schedule-preview ${schedulePreviewError instanceof Error ? "schedule-preview--error" : ""}`}>
                {schedulePreviewError instanceof Error
                  ? schedulePreviewError.message
                  : schedulePreview
                    ? `下次执行 ${formatZonedTime(schedulePreview.nextRunAt, scheduleTimezone)}`
                    : "正在计算下次执行时间..."}
              </div>
            )}
            <Textarea inputSize="lg" value={scheduleText} onChange={(event) => setScheduleText(event.currentTarget.value)} placeholder="输入要发送的消息..." rows={4} />
            {scheduleError && <div className="schedule-error" role="alert">{scheduleError}</div>}
            <Button variant="primary" onClick={handleCreateSchedule} disabled={!selectedSessionId || createSchedulePending}>
              <CalendarClock className="h-4 w-4" />
              创建
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="detail-header">
            <div>
              <span className="side-eyebrow">定时任务详情</span>
              <h1>{selectedSchedule.kind === "once" ? "单次任务" : selectedSchedule.cronExpr}</h1>
            </div>
            <div className="detail-actions">
              {selectedSchedule.status !== "cancelled" && (
                <Button variant="default" onClick={() => startScheduleEdit(selectedSchedule!)}>
                  <Pencil className="h-4 w-4" />
                  编辑
                </Button>
              )}
              {selectedSchedule.status === "active"
                ? (
                  <Button variant="default" onClick={() => updateSchedule({ id: selectedSchedule!.id, action: "pause" })}>
                    <Pause className="h-4 w-4" />
                    暂停
                  </Button>
                  )
                : selectedSchedule.status === "paused"
                  ? (
                    <Button variant="default" onClick={() => updateSchedule({ id: selectedSchedule!.id, action: "resume" })}>
                      <Play className="h-4 w-4" />
                      恢复
                    </Button>
                    )
                  : null}
              {selectedSchedule.status !== "cancelled" && (
                <Button variant="destructive" onClick={() => updateSchedule({ id: selectedSchedule!.id, action: "cancel" })}>
                  <Trash2 className="h-4 w-4" />
                  取消
                </Button>
              )}
            </div>
          </div>
          <div className="detail-section detail-grid">
            <div><span>状态</span><strong>{formatScheduleStatus(selectedSchedule.status)}</strong></div>
            <div><span>时区</span><strong>{selectedSchedule.timezone}</strong></div>
            <div><span>下次执行</span><strong>{selectedSchedule.nextRunAt ? formatZonedTime(selectedSchedule.nextRunAt, selectedSchedule.timezone) : "暂无下次执行"}</strong></div>
            <div><span>会话</span><strong>{selectedSessionName}</strong></div>
          </div>
          {selectedSchedule.payloadSummary && (
            <div className="detail-section">
              <h2>消息内容</h2>
              <p>{selectedSchedule.payloadText ?? selectedSchedule.payloadSummary}</p>
            </div>
          )}
          {editingScheduleId === selectedSchedule.id && (
            <div className="detail-section">
              <h2>编辑任务</h2>
              <div className="schedule-edit-form schedule-edit-form--detail">
                <div className="segmented-control" role="group" aria-label="编辑任务类型">
                  <button className={`segmented-btn ${editScheduleKind === "once" ? "active" : ""}`} onClick={() => setEditScheduleKind("once")}>单次</button>
                  <button className={`segmented-btn ${editScheduleKind === "cron" ? "active" : ""}`} onClick={() => setEditScheduleKind("cron")}>周期</button>
                </div>
                {editScheduleKind === "once"
                  ? <Input inputSize="md" type="datetime-local" value={editScheduleRunAt} onChange={(event) => setEditScheduleRunAt(event.currentTarget.value)} aria-label="编辑执行时间" />
                  : <Input inputSize="md" value={editScheduleCronExpr} onChange={(event) => setEditScheduleCronExpr(event.currentTarget.value)} aria-label="编辑 Cron 表达式" />}
                <TimezoneSelect value={editScheduleTimezone} onChange={setEditScheduleTimezone} label="编辑时区" />
                {editScheduleKind === "cron" && (
                  <div className={`schedule-preview ${editSchedulePreviewError instanceof Error ? "schedule-preview--error" : ""}`}>
                    {editSchedulePreviewError instanceof Error
                      ? editSchedulePreviewError.message
                      : editSchedulePreview
                        ? `下次执行 ${formatZonedTime(editSchedulePreview.nextRunAt, editScheduleTimezone)}`
                        : "正在计算下次执行时间..."}
                  </div>
                )}
                <Textarea inputSize="lg" value={editScheduleText} onChange={(event) => setEditScheduleText(event.currentTarget.value)} aria-label="编辑消息" rows={4} />
                {editScheduleError && <div className="schedule-error" role="alert">{editScheduleError}</div>}
                <div className="schedule-edit-actions">
                  <Button variant="default" onClick={() => setEditingScheduleId(null)}>取消</Button>
                  <Button variant="primary" onClick={submitScheduleEdit} disabled={editSchedulePending}>
                    <Check className="h-4 w-4" />
                    保存
                  </Button>
                </div>
              </div>
            </div>
          )}
          <div className="detail-section">
            <h2>运行记录</h2>
            <div className="schedule-run-list schedule-run-list--detail">
              {scheduleRuns.length === 0 && <div className="schedule-run-empty">暂无执行记录</div>}
              {scheduleRuns.map((run) => (
                <div key={run.id} className="schedule-run-item">
                  <div className="schedule-run-main">
                    <Badge tone={scheduleStatusTone(run.status)}>{formatScheduleRunStatus(run.status)}</Badge>
                    <span>{formatZonedTime(run.scheduledFor ?? run.createdAt, selectedSchedule!.timezone)}</span>
                    {run.payloadSummary && <span title={run.payloadSummary}>{run.payloadSummary}</span>}
                    {run.taskId && <span title={run.taskId}>{run.taskId}</span>}
                    {run.error && <span title={run.error}>{run.error}</span>}
                  </div>
                  <div className="schedule-run-actions">
                    <Button variant="ghost" size="xs" title="打开会话" aria-label={`打开会话 ${run.taskId ?? run.id}`} onClick={() => openScheduleRun(run, false)}>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="xs"
                      title={run.runId ? "打开任务输出" : "任务输出暂不可用"}
                      aria-label={run.runId ? `打开任务输出 ${run.taskId ?? run.id}` : `任务输出暂不可用 ${run.taskId ?? run.id}`}
                      disabled={!run.runId}
                      onClick={() => openScheduleRun(run, true)}
                    >
                      <Target className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
