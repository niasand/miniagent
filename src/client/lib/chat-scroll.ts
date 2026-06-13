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
    settleDelayMs = 900,
  }: InitialScrollScheduleOptions) => {
    initialSettling = true;
    userDetached = false;
    scrollToBottom("auto");
    let active = true;
    let frame: number | null = null;

    const correctPosition = () => {
      if (!userDetached) {
        scrollToBottom("auto");
      }
    };

    const correctUntilSettled = () => {
      if (!active) return;
      correctPosition();
      frame = requestFrame(correctUntilSettled);
    };

    const finishSettling = () => {
      if (!active) return;
      correctPosition();
      active = false;
      if (frame !== null) {
        cancelFrame(frame);
        frame = null;
      }
      initialSettling = false;
      markSettled();
    };

    frame = requestFrame(correctUntilSettled);
    const timers = [
      setTimer(correctPosition, 80),
      setTimer(correctPosition, 180),
      setTimer(correctPosition, 360),
      setTimer(correctPosition, 640),
      setTimer(finishSettling, settleDelayMs),
    ];

    return () => {
      active = false;
      if (frame !== null) cancelFrame(frame);
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
