import { Copy } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { WorkspaceSnapshot } from "../../../shared/workspace.js";
import { cn } from "../../lib/utils.js";
import { formatMessageTime } from "./format-message-time.js";

export function MessageBubble({
  message,
  isFocusedRun,
}: {
  message: WorkspaceSnapshot["messages"][number];
  isFocusedRun: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(message.markdown).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

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
        <button
          className={cn("chat-bubble-copy", copied && "chat-bubble-copy--done")}
          title="复制"
          onClick={handleCopy}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="prose-mini">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {message.markdown}
        </ReactMarkdown>
      </div>
    </div>
  );
}
