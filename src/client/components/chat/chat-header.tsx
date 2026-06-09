import { CopyButton } from "../ui/copy-button.js";
import type { WorkspaceSnapshot } from "../../../shared/workspace.js";

export function ChatHeader({
  sessionId,
  sessions,
}: {
  sessionId: string;
  sessions: WorkspaceSnapshot["sessions"];
}) {
  const session = sessions.find((s) => s.id === sessionId);
  const sessionName = session?.name ?? "未命名会话";

  return (
    <div className="chat-header">
      <div className="chat-header-item">
        <span className="chat-header-name" title={sessionName}>
          {sessionName}
        </span>
        <CopyButton text={sessionName} label="会话名称" className="chat-header-copy" />
      </div>
      <div className="chat-header-item">
        <code className="chat-header-id" title={sessionId}>
          {sessionId.length > 8 ? `...${sessionId.slice(-8)}` : sessionId}
        </code>
        <CopyButton text={sessionId} label="会话ID" className="chat-header-copy" />
      </div>
    </div>
  );
}
