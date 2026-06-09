import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
import { createSession } from "../api/sessions.js";
import { sendSessionMessage } from "../api/messages.js";
import type { AgentType, SkillMeta } from "../api/types.js";

const SESSION_STORAGE_KEY = "sessionId";

interface UseChatInputOptions {
  sessionId: string | null;
  setSessionId: (id: string | null) => void;
  agentType: AgentType;
  messages: { id: string }[];
  isStreamingRef: React.MutableRefObject<boolean>;
  setIsStreaming: (v: boolean) => void;
  streamingTextRef: React.MutableRefObject<string>;
  setStreamingText: (v: string) => void;
  streamStartCountRef: React.MutableRefObject<number>;
  scrollMessagesToBottom: (behavior: ScrollBehavior) => void;
  onSendSuccess?: (sessionId: string) => void;
}

export function useChatInput({
  sessionId,
  setSessionId,
  agentType,
  messages,
  isStreamingRef,
  setIsStreaming,
  streamingTextRef,
  setStreamingText,
  streamStartCountRef,
  onSendSuccess,
}: UseChatInputOptions) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const draftInputRef = useRef<HTMLTextAreaElement>(null);

  const resizeDraftInput = () => {
    const el = draftInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  // Auto-resize textarea when draft changes
  useLayoutEffect(() => {
    resizeDraftInput();
  }, [draft]);

  const sendMessage = useMutation({
    mutationFn: async (text: string) => {
      streamingTextRef.current = "";
      setStreamingText("");
      isStreamingRef.current = true;
      setIsStreaming(true);
      streamStartCountRef.current = messages.length;
      let nextSessionId = sessionId;
      if (!nextSessionId) {
        const res = await createSession({ agentType });
        nextSessionId = res.sessionId;
        setSessionId(nextSessionId);
      }
      const result = await sendSessionMessage(nextSessionId, { text });
      return { ...result, sessionId: nextSessionId };
    },
    onSuccess: (data) => {
      setDraft("");
      setSessionId(data.sessionId);
      localStorage.setItem(SESSION_STORAGE_KEY, data.sessionId);
      queryClient.invalidateQueries({ queryKey: ["workspace", data.sessionId] });
      onSendSuccess?.(data.sessionId);
    },
  });

  const handleSend = () => {
    const text = draft.trim();
    if (!text || sendMessage.isPending) return;
    sendMessage.mutate(text);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && event.shiftKey) {
      requestAnimationFrame(resizeDraftInput);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const useSkillInWorkspace = (skill: SkillMeta) => {
    setDraft(`/${skill.name} `);
    requestAnimationFrame(() => draftInputRef.current?.focus());
  };

  return {
    draft,
    setDraft,
    draftInputRef,
    handleKeyDown,
    handleSend,
    sendMessagePending: sendMessage.isPending,
    useSkillInWorkspace,
  } as const;
}
