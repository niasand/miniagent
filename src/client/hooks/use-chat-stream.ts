import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

/**
 * SSE streaming hook — HIGHEST RISK, do not refactor the dual ref/state pattern.
 *
 * Why refs + state: refs give synchronous access inside EventSource callbacks
 * (which fire outside React render cycle), while state triggers re-renders for UI.
 * Both must stay in sync.
 */
export function useChatStream(sessionId: string | null) {
  const queryClient = useQueryClient();

  // Dual ref/state pattern — CRITICAL: both must be updated together
  const streamingTextRef = useRef("");
  const isStreamingRef = useRef(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");

  const activeRunIdRef = useRef<string | null>(null);
  const lastGlobalSeqRef = useRef(0);
  const streamStartCountRef = useRef(0);

  /** Clear streaming state and mark start. Called before sending a message. */
  const startStreaming = (currentMessageCount: number) => {
    streamingTextRef.current = "";
    setStreamingText("");
    isStreamingRef.current = true;
    setIsStreaming(true);
    activeRunIdRef.current = null;
    streamStartCountRef.current = currentMessageCount;
  };

  // SSE EventSource connection
  // Why: connects to server-sent events for real-time run output streaming
  useEffect(() => {
    if (!sessionId) return;
    let stopped = false;
    let source: EventSource | null = null;

    const connect = (afterSeq: number) => {
      if (stopped) return;
      source = new EventSource(
        `/api/events/stream?sessionId=${encodeURIComponent(sessionId)}&afterGlobalSeq=${afterSeq}&limit=100`,
      );
      const refresh = () => queryClient.invalidateQueries({ queryKey: ["workspace", sessionId] });
      for (const type of ["message_created", "run_started", "run_completed", "run_output_appended"]) {
        source.addEventListener(type, refresh);
      }
      source.addEventListener("run_started", (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.runId) activeRunIdRef.current = payload.runId;
        } catch {}
      });
      source.addEventListener("run_completed", (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.runId && payload.runId === activeRunIdRef.current) {
            activeRunIdRef.current = null;
          }
        } catch {}
      });
      source.addEventListener("text_delta", (event: MessageEvent) => {
        if (activeRunIdRef.current) {
          try {
            const payload = JSON.parse(event.data);
            if (payload.payload?.text) {
              streamingTextRef.current += payload.payload.text;
              setStreamingText(streamingTextRef.current);
            }
          } catch {}
        }
        refresh();
      });
      source.addEventListener("message_created", (event: MessageEvent) => {
        try {
          lastGlobalSeqRef.current = JSON.parse(event.data).globalSeq ?? lastGlobalSeqRef.current;
        } catch {}
      });
      source.addEventListener("text_delta", (event: MessageEvent) => {
        try {
          lastGlobalSeqRef.current = JSON.parse(event.data).globalSeq ?? lastGlobalSeqRef.current;
        } catch {}
      });
      source.onerror = () => {
        source?.close();
        if (!stopped) setTimeout(() => connect(lastGlobalSeqRef.current), 3_000);
      };
    };

    connect(lastGlobalSeqRef.current);
    return () => {
      stopped = true;
      source?.close();
    };
  }, [queryClient, sessionId]);

  return {
    isStreaming,
    setIsStreaming,
    isStreamingRef,
    streamingText,
    setStreamingText,
    streamingTextRef,
    streamStartCountRef,
    activeRunIdRef,
    startStreaming,
  } as const;
}
