type ScheduledFrame = (callback: FrameRequestCallback) => number;
type ScheduledTimeout = (callback: () => void, delayMs: number) => number;

export type InitialMessageAutoScrollOptions = {
  scrollToBottom: () => void;
  shouldAutoScroll: () => boolean;
  markSettled: () => void;
  requestFrame: ScheduledFrame;
  cancelFrame: (id: number) => void;
  setTimer: ScheduledTimeout;
  clearTimer: (id: number) => void;
  settleDelayMs?: number;
};

export function scheduleInitialMessageAutoScroll({
  scrollToBottom,
  shouldAutoScroll,
  markSettled,
  requestFrame,
  cancelFrame,
  setTimer,
  clearTimer,
  settleDelayMs = 80,
}: InitialMessageAutoScrollOptions): () => void {
  scrollToBottom();

  const settle = () => {
    if (shouldAutoScroll()) {
      scrollToBottom();
    }
    markSettled();
  };

  const frame = requestFrame(settle);
  const timer = setTimer(settle, settleDelayMs);

  return () => {
    cancelFrame(frame);
    clearTimer(timer);
  };
}
