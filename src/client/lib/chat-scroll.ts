type ScheduledFrame = (callback: FrameRequestCallback) => number;
type ScheduledTimeout = (callback: () => void, delayMs: number) => number;

export type ChatScrollControllerOptions = {
  getContainer: () => HTMLElement | null;
  bottomThreshold?: number;
};

export type InitialScrollScheduleOptions = {
  markSettled: () => void;
  requestFrame: ScheduledFrame;
  cancelFrame: (id: number) => void;
  setTimer: ScheduledTimeout;
  clearTimer: (id: number) => void;
  settleDelayMs?: number;
};

export type ChatScrollController = {
  isNearBottom: () => boolean;
  markUserScrollIntent: () => void;
  updatePosition: () => void;
  scrollToBottom: (behavior: ScrollBehavior) => void;
  scrollToBottomIfPinned: (behavior: ScrollBehavior) => void;
  scrollToTop: (behavior: ScrollBehavior) => void;
  scheduleInitialLoad: (options: InitialScrollScheduleOptions) => () => void;
};

export function createChatScrollController({
  getContainer,
  bottomThreshold = 80,
}: ChatScrollControllerOptions): ChatScrollController {
  let nearBottom = true;
  let userDetached = false;
  let initialSettling = false;

  const updatePosition = () => {
    const container = getContainer();
    if (!container) return;
    nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < bottomThreshold;
    if (nearBottom && !initialSettling) {
      userDetached = false;
    } else if (!initialSettling) {
      userDetached = true;
    }
  };

  const markUserScrollIntent = () => {
    userDetached = true;
  };

  const scrollToBottom = (behavior: ScrollBehavior) => {
    const container = getContainer();
    if (!container) return;
    nearBottom = true;
    userDetached = false;
    if (behavior === "auto") {
      container.scrollTop = container.scrollHeight;
      return;
    }
    container.scrollTo({ top: container.scrollHeight, behavior });
  };

  const scrollToBottomIfPinned = (behavior: ScrollBehavior) => {
    if (!userDetached && nearBottom) {
      scrollToBottom(behavior);
    }
  };

  const scrollToTop = (behavior: ScrollBehavior) => {
    const container = getContainer();
    if (!container) return;
    nearBottom = false;
    userDetached = true;
    container.scrollTo({ top: 0, behavior });
  };

  const scheduleInitialLoad = ({
    markSettled,
    requestFrame,
    cancelFrame,
    setTimer,
    clearTimer,
    settleDelayMs = 80,
  }: InitialScrollScheduleOptions) => {
    initialSettling = true;
    userDetached = false;
    scrollToBottom("auto");

    let settled = false;
    const settle = () => {
      if (!userDetached) {
        scrollToBottom("auto");
      }
      if (!settled) {
        settled = true;
        markSettled();
      }
    };

    const frame = requestFrame(settle);
    const timers = [
      setTimer(settle, settleDelayMs),
      setTimer(settle, 180),
      setTimer(() => {
        settle();
        initialSettling = false;
      }, 360),
    ];

    return () => {
      cancelFrame(frame);
      for (const timer of timers) clearTimer(timer);
      initialSettling = false;
    };
  };

  return {
    isNearBottom: () => nearBottom,
    markUserScrollIntent,
    updatePosition,
    scrollToBottom,
    scrollToBottomIfPinned,
    scrollToTop,
    scheduleInitialLoad,
  };
}
