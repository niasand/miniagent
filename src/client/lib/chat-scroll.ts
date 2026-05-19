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

  const updatePosition = () => {
    const container = getContainer();
    if (!container) return;
    nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < bottomThreshold;
  };

  const scrollToBottom = (behavior: ScrollBehavior) => {
    const container = getContainer();
    if (!container) return;
    nearBottom = true;
    if (behavior === "auto") {
      container.scrollTop = container.scrollHeight;
      return;
    }
    container.scrollTo({ top: container.scrollHeight, behavior });
  };

  const scrollToBottomIfPinned = (behavior: ScrollBehavior) => {
    if (nearBottom) {
      scrollToBottom(behavior);
    }
  };

  const scrollToTop = (behavior: ScrollBehavior) => {
    const container = getContainer();
    if (!container) return;
    nearBottom = false;
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
    scrollToBottom("auto");

    const settle = () => {
      scrollToBottomIfPinned("auto");
      markSettled();
    };

    const frame = requestFrame(settle);
    const timer = setTimer(settle, settleDelayMs);

    return () => {
      cancelFrame(frame);
      clearTimer(timer);
    };
  };

  return {
    isNearBottom: () => nearBottom,
    updatePosition,
    scrollToBottom,
    scrollToBottomIfPinned,
    scrollToTop,
    scheduleInitialLoad,
  };
}
