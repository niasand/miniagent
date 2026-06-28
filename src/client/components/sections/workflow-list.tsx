import type { WorkflowRun, WorkflowRunStatus } from "../../api/workflows.js";
import { Badge } from "../ui/badge.js";

function statusTone(status: WorkflowRunStatus): "success" | "warning" | "error" | "info" | "muted" {
  if (status === "succeeded") return "success";
  if (status === "waiting_gate") return "warning";
  if (status === "failed") return "error";
  if (status === "running") return "info";
  return "muted";
}

function statusLabel(status: WorkflowRunStatus): string {
  switch (status) {
    case "running": return "运行中";
    case "waiting_gate": return "待审批";
    case "succeeded": return "成功";
    case "failed": return "失败";
    case "cancelled": return "取消";
  }
}

interface WorkflowListProps {
  runs: WorkflowRun[];
  selectedRun: WorkflowRun | null;
  setSelectedRunId: (id: string | null) => void;
}

export function WorkflowList({ runs, selectedRun, setSelectedRunId }: WorkflowListProps) {
  return (
    <>
      <div className="side-header">
        <span className="side-eyebrow">工作流</span>
        <h2>Workflow 列表</h2>
      </div>
      <div className="context-list">
        {runs.length === 0 && <div className="side-empty">暂无 workflow（通过 API 创建）</div>}
        {runs.map((run) => (
          <button
            key={run.id}
            className={`schedule-item schedule-item--button ${selectedRun?.id === run.id ? "schedule-item--active" : ""}`}
            onClick={() => setSelectedRunId(run.id)}
          >
            <span className="schedule-item-title">
              <Badge tone={statusTone(run.status)}>{statusLabel(run.status)}</Badge>
              <span>{run.definition.name}</span>
            </span>
            <span className="schedule-item-meta">
              <span>{run.id.slice(0, 12)}</span>
              <span>{run.currentGateNode ? `gate: ${run.currentGateNode}` : new Date(run.startedAt).toLocaleTimeString()}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
