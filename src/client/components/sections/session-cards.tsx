import type { WorkspaceSnapshot, WorkspaceSessionSummary } from "../../../shared/workspace.js";
import { buildResumeCommand } from "../../lib/session-resume.js";
import { CopyButton } from "../ui/copy-button.js";
import { SessionCardMessages } from "./session-card-messages.js";

interface SessionCardsProps {
  sessions: WorkspaceSnapshot["sessions"];
  selectedSessionId: string | null;
  sessionsQuery: string;
  renderHighlightedSessionName: (text: string, query: string) => React.ReactNode;
  formatSessionUpdatedAt: (value?: string) => string;
  formatSessionChannel: (channelType: WorkspaceSessionSummary["channelType"]) => string;
  messageLimit?: number;
}

/**
 * Detail pane for the selected session: a single card with the resume-command
 * copy button in the head and the full conversation below. The session *list*
 * lives in the sidebar (SessionList); this pane only shows the chosen one, so
 * there is no duplicated list.
 */
export function SessionCards({
  sessions,
  selectedSessionId,
  sessionsQuery,
  renderHighlightedSessionName,
  formatSessionUpdatedAt,
  formatSessionChannel,
  messageLimit = 200,
}: SessionCardsProps) {
  const session = sessions.find((s) => s.id === selectedSessionId) ?? null;

  if (!session) {
    return <div className="session-cards session-cards--empty">从左侧选择一个会话查看详情</div>;
  }

  const name = session.name || session.title || "未命名会话";
  const resume = buildResumeCommand({
    agentType: session.agentType,
    externalSessionId: session.externalSessionId,
    workspace: session.workspace,
  });

  return (
    <div className="session-cards">
      <section
        id={`card-${session.id}`}
        className="session-card session-card--active"
        data-session-id={session.id}
      >
        <header className="session-card-head">
          <div className="session-card-title" title={name}>
            {renderHighlightedSessionName(name, sessionsQuery)}
          </div>
          <div className="session-card-meta">
            <span>{session.agent}</span>
            <span aria-hidden="true">·</span>
            <span>{formatSessionChannel(session.channelType)}</span>
            <span aria-hidden="true">·</span>
            <span>{formatSessionUpdatedAt(session.updatedAt)}</span>
          </div>
          <CopyButton
            text={resume.command}
            label="恢复命令"
            size="md"
            className="session-card-cmd"
            disabled={!resume.enabled}
            title={resume.enabled ? "复制恢复命令" : (resume.disabledReason ?? undefined)}
          />
        </header>
        <div className="session-card-messages">
          <SessionCardMessages sessionId={session.id} limit={messageLimit} />
        </div>
      </section>
    </div>
  );
}
