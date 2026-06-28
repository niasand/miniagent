import { Check, X } from "lucide-react";
import type { WorkflowRun, WorkflowRunStatus } from "../../api/workflows.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";

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

interface WorkflowDetailProps {
  run: WorkflowRun | null;
  resolveGate: (input: { runId: string; nodeId: string; decision: "approve" | "reject" }) => void;
  resolving: boolean;
}

export function WorkflowDetail({ run, resolveGate, resolving }: WorkflowDetailProps) {
  if (!run) {
    return <div className="side-empty">从左侧选择一个 workflow</div>;
  }
  const gateNode = run.currentGateNode ? run.definition.nodes.find((n) => n.id === run.currentGateNode) : null;

  return (
    <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <h2 style={{ margin: 0 }}>{run.definition.name}</h2>
        <Badge tone={statusTone(run.status)} shape="pill">{statusLabel(run.status)}</Badge>
        <span style={{ color: "var(--muted, #888)", fontSize: "0.8rem" }}>{run.id.slice(0, 16)}</span>
      </div>

      <div>
        <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem" }}>节点</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {run.definition.nodes.map((n) => {
            const isGate = run.currentGateNode === n.id;
            const isFailed = run.errorNode === n.id;
            return (
              <div key={n.id} style={{
                display: "flex", alignItems: "center", gap: "0.5rem",
                padding: "0.5rem 0.75rem", borderRadius: "0.5rem",
                background: "var(--surface-muted, #f5f5f5)",
                border: isGate ? "1px solid var(--warning, #f59e0b)" : isFailed ? "1px solid var(--error, #ef4444)" : "1px solid transparent",
              }}>
                <Badge tone={isFailed ? "error" : isGate ? "warning" : "muted"} shape="dot">{n.type}</Badge>
                <strong style={{ fontSize: "0.9rem" }}>{n.id}</strong>
                {n.prompt && <span style={{ color: "var(--muted, #888)", fontSize: "0.8rem", flex: 1 }}>{n.prompt}</span>}
                {n.message && <span style={{ color: "var(--muted, #888)", fontSize: "0.8rem", flex: 1 }}>{n.message}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {run.errorNode && (
        <div style={{ padding: "0.75rem", borderRadius: "0.5rem", background: "var(--error-bg, #fee2e2)", color: "var(--error, #ef4444)", fontSize: "0.85rem" }}>
          失败节点：{run.errorNode} — {run.errorReason ?? "unknown error"}
        </div>
      )}

      {gateNode && (
        <div style={{
          padding: "1rem", borderRadius: "0.5rem", border: "1px solid var(--warning, #f59e0b)",
          background: "var(--warning-bg, #fffbeb)", display: "flex", flexDirection: "column", gap: "0.75rem",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Badge tone="warning" shape="pill">待审批</Badge>
            <strong>{gateNode.id}</strong>
          </div>
          <p style={{ margin: 0 }}>{gateNode.prompt}</p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Button variant="primary" size="sm" disabled={resolving} onClick={() => resolveGate({ runId: run.id, nodeId: gateNode.id, decision: "approve" })}>
              <Check className="h-4 w-4" /> 通过
            </Button>
            <Button variant="outline" size="sm" disabled={resolving} onClick={() => resolveGate({ runId: run.id, nodeId: gateNode.id, decision: "reject" })}>
              <X className="h-4 w-4" /> 拒绝
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
