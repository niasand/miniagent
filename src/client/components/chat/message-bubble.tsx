import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { WorkspaceSnapshot } from "../../../shared/workspace.js";
import { CopyButton } from "../ui/copy-button.js";
import { cn } from "../../lib/utils.js";
import { formatMessageTime } from "./format-message-time.js";

type MessageBubbleProps = {
  message: WorkspaceSnapshot["messages"][number];
  isFocusedRun: boolean;
};

function MessageBubbleImpl({ message, isFocusedRun }: MessageBubbleProps) {
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

/**
 * Memoized with a custom comparator: re-renders only when the message content
 * (id + markdown + author + time) or isFocusedRun actually changes. The 5s
 * poll in useSessionMessages returns fresh array references even when content
 * is identical; without this comparator every bubble (each running ReactMarkdown
 * + syntax highlighting) would re-render on every poll.
 */
export const MessageBubble = memo(MessageBubbleImpl, (a, b) =>
  a.isFocusedRun === b.isFocusedRun &&
  a.message.id === b.message.id &&
  a.message.markdown === b.message.markdown &&
  a.message.author === b.message.author &&
  a.message.time === b.message.time,
);
