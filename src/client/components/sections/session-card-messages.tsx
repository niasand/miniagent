import { useEffect, useRef, useState } from "react";
import { useSessionMessages } from "../../hooks/use-session-messages.js";
import { isMessageDisplayable } from "../chat/is-message-displayable.js";
import { MessageBubble } from "../chat/message-bubble.js";

/**
 * Read-only message list for one session card. Fetches lazily: the card stays
 * a cheap placeholder until an IntersectionObserver reports it on-screen, so a
 * long session list does not fire N requests up front.
 */
export function SessionCardMessages({ sessionId, limit }: { sessionId: string; limit: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  const { data, isLoading, isError } = useSessionMessages(visible ? sessionId : null, { limit });

  if (!visible) {
    return <div ref={ref} className="session-card-placeholder">滚动到此处加载消息…</div>;
  }
  if (isLoading) {
    return <div className="session-card-placeholder">加载中…</div>;
  }
  if (isError) {
    return <div className="session-card-error">消息加载失败</div>;
  }
  const messages = (data ?? []).filter(isMessageDisplayable);
  if (messages.length === 0) {
    return <div className="session-card-empty">暂无消息</div>;
  }
  return (
    <>
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} isFocusedRun={false} />
      ))}
    </>
  );
}
