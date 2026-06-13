import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createChatScrollController } from "../lib/chat-scroll.js";
import type { AppSection } from "./use-navigation.js";

interface UseChatScrollOptions {
  activeSection: AppSection;
  sessionId: string | null;
  selectedSessionId: string | null;
  messages: { id: string; role: string }[];
  hasWorkspaceSnapshot: boolean;
  streamingText: string;
}

export function useChatScroll({
  activeSection,
  sessionId,
  selectedSessionId,
  messages,
  hasWorkspaceSnapshot,
  streamingText,
}: UseChatScrollOptions) {
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Scroll controller is owned here — it needs the container ref
  const scrollControllerRef = useRef<ReturnType<typeof createChatScrollController> | null>(null);
  scrollControllerRef.current ??= createChatScrollController({
    getContainer: () => messagesContainerRef.current,
  });
  const scrollController = scrollControllerRef.current;

  const prevMsgCountRef = useRef(0);
  const lastAutoScrollSessionRef = useRef<string | null>(null);
  const lastActiveSectionRef = useRef<AppSection>(activeSection);
  const [settledMessagesSessionKey, setSettledMessagesSessionKey] = useState<string | null>(null);
  const [focusedScheduleTarget, setFocusedScheduleTarget] = useState<{ sessionId: string; runId: string } | null>(null);

  const messagesSessionKey = sessionId ?? selectedSessionId ?? "";
  const lastMessageId = messages[messages.length - 1]?.id ?? "";

  const scrollMessagesToBottom = (behavior: ScrollBehavior) => {
    scrollController.scrollToBottom(behavior);
  };

  const scrollMessagesToTop = () => {
    scrollController.scrollToTop("smooth");
  };

  // Initial-load scroll: snap to bottom when session changes or messages first load
  useLayoutEffect(() => {
    if (!messagesSessionKey) {
      prevMsgCountRef.current = 0;
      lastAutoScrollSessionRef.current = messagesSessionKey;
      if (settledMessagesSessionKey !== messagesSessionKey) {
        setSettledMessagesSessionKey(messagesSessionKey);
      }
      return;
    }

    if (messages.length === 0) {
      prevMsgCountRef.current = 0;
      lastAutoScrollSessionRef.current = messagesSessionKey;
      if (hasWorkspaceSnapshot && settledMessagesSessionKey !== messagesSessionKey) {
        setSettledMessagesSessionKey(messagesSessionKey);
      }
      return;
    }

    const isInitialLoad = prevMsgCountRef.current === 0;
    const isNewSession = lastAutoScrollSessionRef.current !== messagesSessionKey;
    const returnedToWorkspace = lastActiveSectionRef.current !== "workspace" && activeSection === "workspace";
    const shouldSnapToBottom = activeSection === "workspace" && (isInitialLoad || isNewSession || returnedToWorkspace || settledMessagesSessionKey !== messagesSessionKey);

    if (shouldSnapToBottom) {
      const cleanup = scrollController.scheduleInitialLoad({
        markSettled: () => setSettledMessagesSessionKey(messagesSessionKey),
        requestFrame: (callback) => window.requestAnimationFrame(callback),
        cancelFrame: (id) => window.cancelAnimationFrame(id),
        setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimer: (id) => window.clearTimeout(id),
      });
      prevMsgCountRef.current = messages.length;
      lastAutoScrollSessionRef.current = messagesSessionKey;
      lastActiveSectionRef.current = activeSection;
      return cleanup;
    }

    prevMsgCountRef.current = messages.length;
    lastAutoScrollSessionRef.current = messagesSessionKey;
    lastActiveSectionRef.current = activeSection;
  }, [activeSection, hasWorkspaceSnapshot, lastMessageId, messages.length, messagesSessionKey, scrollController, settledMessagesSessionKey]);

  // Scroll/touch event listeners for user scroll intent tracking
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const onScroll = () => scrollController.updatePosition();
    const onUserScrollIntent = () => scrollController.markUserScrollIntent();
    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("wheel", onUserScrollIntent, { passive: true });
    container.addEventListener("touchstart", onUserScrollIntent, { passive: true });
    container.addEventListener("pointerdown", onUserScrollIntent);
    return () => {
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("wheel", onUserScrollIntent);
      container.removeEventListener("touchstart", onUserScrollIntent);
      container.removeEventListener("pointerdown", onUserScrollIntent);
    };
  }, [scrollController]);

  // Auto-scroll during streaming
  useEffect(() => {
    if (streamingText) {
      scrollController.scrollToBottomIfPinned("smooth");
    }
  }, [scrollController, streamingText]);

  // Scroll to focused schedule target run
  useEffect(() => {
    const runId = focusedScheduleTarget?.runId;
    if (!runId || focusedScheduleTarget.sessionId !== messagesSessionKey) return;

    const container = messagesContainerRef.current;
    if (!container) return;

    const target = Array.from(container.querySelectorAll<HTMLElement>("[data-run-id]"))
      .find((element) => element.dataset.runId === runId);
    if (!target) return;

    const frameId = window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const timerId = window.setTimeout(() => {
      setFocusedScheduleTarget((current) => current?.runId === runId ? null : current);
    }, 2_400);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timerId);
    };
  }, [focusedScheduleTarget, lastMessageId, messages.length, messagesSessionKey]);

  const messagesSettling = messages.length > 0 && settledMessagesSessionKey !== messagesSessionKey;

  return {
    messagesContainerRef,
    scrollMessagesToTop,
    scrollMessagesToBottom,
    focusedScheduleTarget,
    setFocusedScheduleTarget,
    messagesSessionKey,
    messagesSettling,
  } as const;
}
