import { ArrowDown, ArrowUp, SendHorizontal, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { WorkspaceSnapshot } from "../../../shared/workspace.js";
import { ChatHeader, isMessageDisplayable, MessageBubble } from "../chat/index.js";
import { Button } from "../ui/button.js";

interface ChatViewProps {
  sessionId: string | null;
  sessions: WorkspaceSnapshot["sessions"];
  messages: WorkspaceSnapshot["messages"];
  messagesSettling: boolean;
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  runStats: { durationSeconds: number | null; tokensUsed: number | null; tokensTotal: number | null };
  focusedRunId: string | null;
  sendMessagePending: boolean;
  isStreaming: boolean;
  streamingText: string;
  scrollMessagesToTop: () => void;
  scrollMessagesToBottom: (behavior: ScrollBehavior) => void;
  draftInputRef: React.RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (value: string) => void;
  handleKeyDown: (event: React.KeyboardEvent) => void;
  handleSend: () => void;
}

export function ChatView({
  sessionId,
  sessions,
  messages,
  messagesSettling,
  messagesContainerRef,
  runStats,
  focusedRunId,
  sendMessagePending,
  isStreaming,
  streamingText,
  scrollMessagesToTop,
  scrollMessagesToBottom,
  draftInputRef,
  draft,
  setDraft,
  handleKeyDown,
  handleSend,
}: ChatViewProps) {
  return (
    <div className="chat-main">
      {sessionId && messages.length > 0 && (
        <ChatHeader sessionId={sessionId} sessions={sessions} />
      )}
      <div className={`chat-messages ${messagesSettling ? "chat-messages--settling" : ""}`} ref={messagesContainerRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <Sparkles className="chat-empty-icon" />
            <p>发送消息开始对话</p>
          </div>
        )}
        {messages.map((message) => {
          if (!isMessageDisplayable(message)) return null;
          if (message.role === "system" && message.markdown.startsWith("Run succeeded")) {
            return (
              <div key={message.id} className="chat-stat">
                {runStats.durationSeconds !== null && <span>{runStats.durationSeconds}s</span>}
                {runStats.tokensUsed !== null && <span>{runStats.tokensUsed.toLocaleString()} tokens</span>}
                <span>完成</span>
              </div>
            );
          }
          const isFocusedRun = Boolean(focusedRunId && message.runId === focusedRunId);
          return (
            <MessageBubble key={message.id} message={message} isFocusedRun={isFocusedRun} />
          );
        })}
        {(sendMessagePending || isStreaming || streamingText) && messages[messages.length - 1]?.role !== "agent" && (
          <div className="chat-bubble agent">
            <div className="chat-bubble-header"><strong>Agent</strong></div>
            {streamingText ? (
              <div className="prose-mini">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{streamingText}</ReactMarkdown>
              </div>
            ) : (
              <div className="chat-typing">
                <span className="typing-dots"><span /><span /><span /></span>
              </div>
            )}
          </div>
        )}
      </div>

      {messages.length > 0 && (
        <div className="chat-scroll-controls">
          <Button variant="outline" size="xs" className="chat-scroll-btn" onClick={scrollMessagesToTop} title="回到顶部" aria-label="回到顶部">
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="xs" className="chat-scroll-btn" onClick={() => scrollMessagesToBottom("smooth")} title="回到底部" aria-label="回到底部">
            <ArrowDown className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div className="chat-bar">
        <textarea
          ref={draftInputRef}
          className="chat-input"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          rows={1}
        />
        <Button variant="primary" size="lg" onClick={handleSend} disabled={sendMessagePending || !draft.trim()}>
          <SendHorizontal className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
