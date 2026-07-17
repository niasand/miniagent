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
 * Read-only vertical card stream: one card per session. Each card head shows
 * the name + meta + a copy button for the terminal resume command; the body
 * shows that session's full conversation (lazy-loaded by SessionCardMessages).
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
  if (sessions.length === 0) {
    return <div className="session-cards session-cards--empty">暂无会话</div>;
  }

  return (
    <div className="session-cards">
      {sessions.map((session) => {
        const name = session.name || session.title || "未命名会话";
        const resume = buildResumeCommand({
          agentType: session.agentType,
          externalSessionId: session.externalSessionId,
          workspace: session.workspace,
        });
        const isActive = session.id === selectedSessionId;
        return (
          <section
            key={session.id}
            id={`card-${session.id}`}
            className={`session-card${isActive ? " session-card--active" : ""}`}
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
        );
      })}
    </div>
  );
}
