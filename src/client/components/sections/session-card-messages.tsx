import { useMemo } from "react";
import { useSessionMessages } from "../../hooks/use-session-messages.js";
import { isMessageDisplayable } from "../chat/is-message-displayable.js";
import { MessageBubble } from "../chat/message-bubble.js";

/**
 * Read-only message list for the selected session's detail card. Rendered only
 * for the one open session, so it is always in the viewport — no need for the
 * IntersectionObserver gate the old card-stream used. Polled every 5s by
 * useSessionMessages; MessageBubble is memoized so unchanged messages skip
 * re-render (no re-running ReactMarkdown/syntax highlight each poll).
 */
export function SessionCardMessages({ sessionId, limit }: { sessionId: string; limit: number }) {
  const { data, isLoading, isError } = useSessionMessages(sessionId, { limit });
  const messages = useMemo(() => (data ?? []).filter(isMessageDisplayable), [data]);

  if (isLoading) return <div className="session-card-placeholder">加载中…</div>;
  if (isError) return <div className="session-card-error">消息加载失败</div>;
  if (messages.length === 0) return <div className="session-card-empty">暂无消息</div>;
  return (
    <>
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} isFocusedRun={false} />
      ))}
    </>
  );
}
