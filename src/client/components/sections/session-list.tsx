import { Check, Loader2, Pencil, Plus, Search, X } from "lucide-react";
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
        <Button variant="ghost" size="xs" title="新建对话" onClick={handleNewSession} disabled={isCreatingSession}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="side-search">
        <Search className="h-4 w-4 side-search-icon" />
        <Input
          ref={sessionsSearchRef}
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
                      onKeyDown={(event) => {
                        if (event.key === "Escape") cancelSessionRename();
                      }}
                      aria-label="会话名称"
                      aria-invalid={renameSessionError ? "true" : "false"}
                      aria-describedby={renameSessionError ? `session-rename-error-${session.id}` : undefined}
                      autoFocus
                    />
                    <button className="session-edit-btn" type="submit" title="保存" aria-label="保存会话名称" disabled={renameSessionPending}>
                      <Check className="h-4 w-4" />
                    </button>
                    <button className="session-edit-btn" type="button" title="取消" aria-label="取消重命名" onClick={cancelSessionRename}>
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {renameSessionError && (
                    <div id={`session-rename-error-${session.id}`} className="session-edit-error" role="alert">
                      {renameSessionError}
                    </div>
                  )}
                </form>
              ) : (
                <>
                  <button className="session-select" onClick={() => selectSession(session.id)}>
                    <span className="session-title" title={sessionName}>{renderHighlightedSessionName(sessionName, sessionsQuery)}</span>
                    <span className="session-meta">
                      <span>{formatSessionChannel(session.channelType)}</span>
                      <span>{formatSessionUpdatedAt(session.updatedAt)}</span>
                    </span>
                  </button>
                  <button className="session-action" title="重命名" aria-label={`重命名 ${sessionName}`} onClick={() => startSessionRename(session.id, sessionName)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
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
    </>
  );
}
