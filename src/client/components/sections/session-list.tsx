import { CheckSquare, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import type { WorkspaceSnapshot } from "../../../shared/workspace.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";

/** Map session status to Badge tone */
function sessionStatusTone(status: string): "success" | "warning" | "error" | "info" | "default" {
  if (status === "idle" || status === "running") return "success";
  if (status === "compact") return "warning";
  if (status === "failed") return "error";
  if (status === "queued") return "info";
  return "default";
}

interface SessionListProps {
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
  selectionMode: boolean;
  setSelectionMode: (mode: boolean) => void;
  selectedIds: Set<string>;
  toggleSelected: (id: string) => void;
  exitSelectionMode: () => void;
  deleteSelected: () => Promise<void> | void;
  deleting: boolean;
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
}

export function SessionList({
  sessions,
  sessionId,
  sessionsQuery,
  setSessionsQuery,
  sessionsSearchRef,
  sessionsHasMore,
  sessionsLoadingMore,
  sessionsSentinelRef,
  handleNewSession,
  isCreatingSession,
  selectionMode,
  setSelectionMode,
  selectedIds,
  toggleSelected,
  exitSelectionMode,
  deleteSelected,
  deleting,
  editingSessionId,
  editingSessionName,
  setEditingSessionName,
  renameSessionError,
  renameSessionPending,
  startSessionRename,
  submitSessionRename,
  cancelSessionRename,
  selectSession,
  renderHighlightedSessionName,
  formatSessionUpdatedAt,
  formatSessionChannel,
}: SessionListProps) {
  const q = sessionsQuery.trim().toLowerCase();
  const filteredSessions = q
    ? sessions.filter((session) => session.name.toLowerCase().includes(q) || session.id.includes(q))
    : sessions;

  return (
    <>
      <div className="side-header">
        <span className="side-eyebrow">工作台</span>
        <h2>会话列表</h2>
        <Button
          variant="ghost"
          size="xs"
          title={selectionMode ? "取消选择" : "选择会话"}
          aria-label={selectionMode ? "取消选择" : "选择会话"}
          onClick={() => (selectionMode ? exitSelectionMode() : setSelectionMode(true))}
        >
          {selectionMode ? <X className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="xs" title="新建对话" aria-label="新建对话" onClick={handleNewSession} disabled={isCreatingSession || selectionMode}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="side-search">
        <Search className="h-4 w-4 side-search-icon" />
        <Input
          ref={sessionsSearchRef}
          variant="ghost"
          className="side-search-input"
          value={sessionsQuery}
          onChange={(event) => setSessionsQuery(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === "Escape") setSessionsQuery(""); }}
          placeholder="搜索会话..."
        />
      </div>
      <div className="context-list">
        {sessions.length === 0 && <div className="side-empty">暂无会话</div>}
        {sessions.length > 0 && filteredSessions.length === 0 && <div className="side-empty">没有匹配的会话</div>}
        {filteredSessions.map((session) => {
          const sessionName = session.name || session.title || "未命名会话";
          const isEditing = editingSessionId === session.id;
          return (
            <div key={session.id} className={`session-item ${session.id === sessionId ? "session-item--active" : ""}`}>
              {isEditing ? (
                <form className="session-edit" onSubmit={(event) => { event.preventDefault(); submitSessionRename(session.id); }}>
                  <div className="session-edit-row">
                    <Input
                      inputSize="sm"
                      value={editingSessionName}
                      onChange={(event) => setEditingSessionName(event.currentTarget.value)}
                      onBlur={() => submitSessionRename(session.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") cancelSessionRename();
                      }}
                      aria-label="会话名称"
                      aria-invalid={renameSessionError ? "true" : "false"}
                      aria-describedby={renameSessionError ? `session-rename-error-${session.id}` : undefined}
                      autoFocus
                    />
                  </div>
                  {renameSessionError && (
                    <div id={`session-rename-error-${session.id}`} className="session-edit-error" role="alert">
                      {renameSessionError}
                    </div>
                  )}
                </form>
              ) : (
                <>
                  {selectionMode && (
                    <input
                      type="checkbox"
                      className="session-check"
                      checked={selectedIds.has(session.id)}
                      onChange={() => toggleSelected(session.id)}
                      aria-label={`选择 ${sessionName}`}
                    />
                  )}
                  <button className="session-select" onClick={() => (selectionMode ? toggleSelected(session.id) : selectSession(session.id))}>
                    <span className="session-title" title={sessionName}>{renderHighlightedSessionName(sessionName, sessionsQuery)}</span>
                    <span className="session-meta">
                      <span>{formatSessionChannel(session.channelType)}</span>
                      <span>{formatSessionUpdatedAt(session.updatedAt)}</span>
                    </span>
                  </button>
                  {!selectionMode && (
                    <button className="session-action" title="重命名" aria-label={`重命名 ${sessionName}`} onClick={() => startSessionRename(session.id, sessionName)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <Badge shape="dot" tone={sessionStatusTone(session.status)} />
                </>
              )}
            </div>
          );
        })}
        {sessionsHasMore && (
          <div ref={sessionsSentinelRef} className="session-sentinel">
            {sessionsLoadingMore && <Loader2 className="h-4 w-4 session-sentinel-spinner" />}
          </div>
        )}
      </div>
      {selectionMode && (
        <div className="session-bulk-bar">
          <span className="session-bulk-count">已选 {selectedIds.size} 个</span>
          <Button
            variant="primary"
            size="sm"
            title="删除选中会话"
            disabled={selectedIds.size === 0 || deleting}
            onClick={() => {
              if (selectedIds.size === 0) return;
              if (window.confirm(`确认删除选中的 ${selectedIds.size} 个会话？`)) {
                void deleteSelected();
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
            {deleting ? "删除中…" : `删除选中(${selectedIds.size})`}
          </Button>
        </div>
      )}
    </>
  );
}
