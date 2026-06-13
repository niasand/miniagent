import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { WorkspaceSnapshot } from "../../../shared/workspace.js";
import { CopyButton } from "../ui/copy-button.js";
import { cn } from "../../lib/utils.js";
import { formatMessageTime } from "./format-message-time.js";

export function MessageBubble({
  message,
  isFocusedRun,
}: {
  message: WorkspaceSnapshot["messages"][number];
  isFocusedRun: boolean;
}) {
  return (
    <div
      className={cn(
        "chat-bubble",
        message.role,
        isFocusedRun && "chat-bubble--focused-run",
      )}
      data-run-id={message.runId ?? undefined}
    >
      <div className="chat-bubble-header">
        <strong>{message.author}</strong>
        {message.time && (
          <span className="chat-time" title={message.createdAt ?? message.time}>
            {formatMessageTime(message.createdAt ?? message.time)}
          </span>
        )}
        <CopyButton text={message.markdown} label="消息" className="chat-bubble-copy" />
      </div>
      <div className="prose-mini">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {message.markdown}
        </ReactMarkdown>
      </div>
    </div>
  );
}
