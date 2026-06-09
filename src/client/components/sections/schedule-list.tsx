import type { WorkspaceSchedule } from "../../../shared/workspace.js";
import { Badge } from "../ui/badge.js";
import { formatScheduleKind, formatScheduleStatus } from "../../lib/status-labels.js";

/** Map schedule/run status strings to Badge tone */
function scheduleStatusTone(status: string): "success" | "warning" | "error" | "muted" | "info" | "default" {
  if (status === "active" || status === "succeeded") return "success";
  if (status === "paused") return "warning";
  if (status === "failed") return "error";
  if (status === "cancelled") return "muted";
  if (status === "running" || status === "scheduled" || status === "queued") return "info";
  return "default";
}

interface ScheduleListProps {
  schedules: WorkspaceSchedule[];
  selectedSchedule: WorkspaceSchedule | null;
  setSelectedScheduleId: (id: string | null) => void;
  setEditingScheduleId: (id: string | null) => void;
  startNewSchedule: () => void;
  selectedSessionName: string;
  formatZonedTime: (value: string, timezone: string) => string;
}

export function ScheduleList({
  schedules,
  selectedSchedule,
  setSelectedScheduleId,
  setEditingScheduleId,
  startNewSchedule,
  selectedSessionName,
  formatZonedTime,
}: ScheduleListProps) {
  return (
    <>
      <div className="side-header">
        <span className="side-eyebrow">任务</span>
        <h2>定时任务列表</h2>
      </div>
      <div className="context-list">
        <button className={`context-item context-item--create ${!selectedSchedule ? "context-item--active" : ""}`} onClick={startNewSchedule}>
          <strong>新建任务</strong>
          <span title={selectedSessionName}>{selectedSessionName}</span>
        </button>
        {schedules.length === 0 && <div className="side-empty">暂无任务</div>}
        {schedules.map((schedule) => (
          <button
            key={schedule.id}
            className={`schedule-item schedule-item--button ${selectedSchedule?.id === schedule.id ? "schedule-item--active" : ""}`}
            onClick={() => {
              setSelectedScheduleId(schedule.id);
              setEditingScheduleId(null);
            }}
          >
            <span className="schedule-item-title">
              <Badge tone={scheduleStatusTone(schedule.status)}>{formatScheduleStatus(schedule.status)}</Badge>
              <span>{schedule.kind === "once" ? formatScheduleKind(schedule.kind) : schedule.cronExpr}</span>
            </span>
            <span className="schedule-item-meta">
              <span>{schedule.nextRunAt ? `下次执行 ${formatZonedTime(schedule.nextRunAt, schedule.timezone)}` : "暂无下次执行"}</span>
              <span>{schedule.timezone}</span>
            </span>
            {schedule.payloadSummary && <span className="schedule-item-summary" title={schedule.payloadText ?? schedule.payloadSummary}>{schedule.payloadSummary}</span>}
          </button>
        ))}
      </div>
    </>
  );
}
