import { useState } from "react";
import type { WorkflowRun, WorkflowRunStatus } from "../../api/workflows.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";

const SAMPLE = `{
  "name": "demo",
  "nodes": [
    { "id": "a", "type": "echo", "message": "hello" },
    { "id": "g", "type": "human_gate", "prompt": "approve?", "dependsOn": ["a"] },
    { "id": "b", "type": "echo", "message": "done", "dependsOn": ["g"] }
  ]
}`;

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
  onCreateWorkflow: (definition: unknown) => void;
  creating: boolean;
}

export function WorkflowList({ runs, selectedRun, setSelectedRunId, onCreateWorkflow, creating }: WorkflowListProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleCreate = () => {
    setError(null);
    try {
      const def = JSON.parse(draft);
      onCreateWorkflow(def);
      setDraft("");
    } catch {
      setError("JSON 解析失败，请检查格式");
    }
  };

  return (
    <>
      <div className="side-header">
        <span className="side-eyebrow">工作流</span>
        <h2>Workflow 列表</h2>
      </div>
      <div className="context-list">
        <div className="schedule-item schedule-item--create" style={{ flexDirection: "column", alignItems: "stretch", gap: "0.4rem", cursor: "default" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>新建 workflow</strong>
            <Button variant="ghost" size="xs" onClick={() => setDraft(SAMPLE)}>填示例</Button>
          </div>
          <textarea
            style={{ width: "100%", minHeight: "5rem", fontFamily: "monospace", fontSize: "0.72rem", padding: "0.4rem", borderRadius: "0.375rem", border: "1px solid var(--border, #ddd)", resize: "vertical" }}
            placeholder='粘贴 workflow 定义 JSON'
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
          />
          {error && <span style={{ color: "var(--error, #ef4444)", fontSize: "0.72rem" }}>{error}</span>}
          <Button variant="primary" size="sm" disabled={creating || !draft.trim()} onClick={handleCreate}>
            {creating ? "创建中..." : "创建并运行"}
          </Button>
        </div>
        {runs.length === 0 && <div className="side-empty">暂无 workflow</div>}
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
