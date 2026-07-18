import { useEffect, useState } from "react";
import { CheckSquare, Trash2, X } from "lucide-react";
import { generateWorkflowDefinition } from "../../api/workflows.js";
import type { WorkflowRun, WorkflowRunStatus } from "../../api/workflows.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { ConfirmDialog } from "../ui/confirm-dialog.js";

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
  selectionMode: boolean;
  setSelectionMode: (mode: boolean) => void;
  selectedIds: Set<string>;
  toggleSelected: (id: string) => void;
  exitSelectionMode: () => void;
  deleteSelected: () => void;
  deleting: boolean;
  selectAll: () => void;
  deleteOne: (id: string) => void;
}

export function WorkflowList({
  runs,
  selectedRun,
  setSelectedRunId,
  onCreateWorkflow,
  creating,
  selectionMode,
  setSelectionMode,
  selectedIds,
  toggleSelected,
  exitSelectionMode,
  deleteSelected,
  deleting,
  selectAll,
  deleteOne,
}: WorkflowListProps) {
  const [draft, setDraft] = useState(SAMPLE);
  const [error, setError] = useState<string | null>(null);
  const [nlPrompt, setNlPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [singleDeleteId, setSingleDeleteId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; id: string } | null>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener("click", close);
    return () => {
      document.removeEventListener("click", close);
    };
  }, [ctxMenu]);

  const handleGenerate = async () => {
    if (!nlPrompt.trim() || generating) return;
    setGenerating(true);
    setGenError(null);
    try {
      const { definition } = await generateWorkflowDefinition(nlPrompt);
      setDraft(JSON.stringify(definition, null, 2));
      setNlPrompt("");
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setGenerating(false);
    }
  };

  const handleCreate = () => {
    setError(null);
    try {
      const def = JSON.parse(draft);
      onCreateWorkflow(def);
    } catch {
      setError("JSON 解析失败，请检查格式");
    }
  };

  return (
    <>
      <div className="side-header">
        <h2>Workflow 列表</h2>
        <Button
          variant="ghost"
          size="xs"
          title={selectionMode ? "取消选择" : "选择 workflow"}
          aria-label={selectionMode ? "取消选择" : "选择 workflow"}
          onClick={() => (selectionMode ? exitSelectionMode() : setSelectionMode(true))}
        >
          {selectionMode ? <X className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />}
        </Button>
      </div>
      <div className="context-list">
        <div className="schedule-item schedule-item--create" style={{ flexDirection: "column", alignItems: "stretch", gap: "0.4rem", cursor: "default" }}>
          <strong>新建 workflow</strong>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <input
              style={{ flex: 1, minWidth: 0, height: "1.8rem", fontSize: "0.75rem", padding: "0 0.5rem", borderRadius: "0.375rem", border: "1px solid var(--color-border)", background: "var(--color-background)", color: "var(--color-foreground)" }}
              placeholder="或自然语言描述，让 AI 生成（如：总结昨日 git 提交，审批后发飞书）"
              value={nlPrompt}
              onChange={(e) => setNlPrompt(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleGenerate(); } }}
              disabled={generating}
            />
            <Button variant="outline" size="sm" disabled={generating || !nlPrompt.trim()} onClick={() => void handleGenerate()}>
              {generating ? "生成中…" : "✨ 生成"}
            </Button>
          </div>
          {genError && <span style={{ color: "#ef4444", fontSize: "0.72rem" }}>{genError}</span>}
          <textarea
            style={{ width: "100%", minHeight: "5rem", fontFamily: "monospace", fontSize: "0.72rem", padding: "0.4rem", borderRadius: "0.375rem", border: "1px solid var(--color-border)", background: "var(--color-background)", color: "var(--color-foreground)", resize: "vertical" }}
            placeholder="粘贴 workflow 定义 JSON"
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
          />
          {error && <span style={{ color: "#ef4444", fontSize: "0.72rem" }}>{error}</span>}
          <Button variant="primary" size="sm" disabled={creating || !draft.trim()} onClick={handleCreate}>
            {creating ? "创建中..." : "创建并运行"}
          </Button>
        </div>
        {runs.length === 0 && <div className="side-empty">暂无 workflow</div>}
        {runs.map((run) => (
          <div
            key={run.id}
            className={`schedule-item ${selectedRun?.id === run.id ? "schedule-item--active" : ""}`}
            style={selectionMode ? { cursor: "default" } : undefined}
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, id: run.id }); }}
          >
            {selectionMode && (
              <input
                type="checkbox"
                className="session-check"
                checked={selectedIds.has(run.id)}
                onChange={() => toggleSelected(run.id)}
                aria-label={`选择 ${run.definition.name}`}
              />
            )}
            <button
              type="button"
              style={{ border: 0, background: "transparent", textAlign: "left", cursor: "pointer", padding: 0, flex: 1, minWidth: 0, font: "inherit", color: "inherit" }}
              onClick={() => (selectionMode ? toggleSelected(run.id) : setSelectedRunId(run.id))}
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
          </div>
        ))}
      </div>
      {selectionMode && (
        <div className="session-bulk-bar">
          <span className="session-bulk-count">已选 {selectedIds.size} 个</span>
          <Button
            variant="outline"
            size="sm"
            disabled={runs.length === 0}
            onClick={() => (selectedIds.size === runs.length && runs.length > 0 ? exitSelectionMode() : selectAll())}
          >
            {selectedIds.size === runs.length && runs.length > 0 ? "取消全选" : "全选"}
          </Button>
          <Button
            variant="primary"
            size="sm"
            title="删除选中 workflow"
            disabled={selectedIds.size === 0 || deleting}
            onClick={() => { if (selectedIds.size > 0) setConfirmOpen(true); }}
          >
            <Trash2 className="h-4 w-4" />
            {deleting ? "删除中…" : `删除选中(${selectedIds.size})`}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title={`确认删除选中的 ${selectedIds.size} 个 workflow？`}
        description="workflow 运行记录将从列表移除。"
        confirmLabel="删除"
        variant="danger"
        onConfirm={() => { setConfirmOpen(false); deleteSelected(); }}
        onCancel={() => setConfirmOpen(false)}
      />
      {ctxMenu && (
        <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          <button
            className="ctx-menu-item"
            onClick={() => { const id = ctxMenu.id; setCtxMenu(null); setSingleDeleteId(id); }}
          >
            删除
          </button>
        </div>
      )}
      <ConfirmDialog
        open={singleDeleteId !== null}
        title="确认删除该 workflow？"
        description="workflow 运行记录将从列表移除。"
        confirmLabel="删除"
        variant="danger"
        onConfirm={() => { const id = singleDeleteId; setSingleDeleteId(null); if (id) deleteOne(id); }}
        onCancel={() => setSingleDeleteId(null)}
      />
    </>
  );
}
