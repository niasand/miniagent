import { describe, expect, it } from "vitest";
import { scheduleInitialMessageAutoScroll } from "../src/client/lib/initial-auto-scroll.js";

describe("scheduleInitialMessageAutoScroll", () => {
  it("does not run deferred scrolls after the user moves away from the bottom", () => {
    const calls: string[] = [];
    let shouldAutoScroll = true;
    const frameCallbacks: FrameRequestCallback[] = [];
    const timerCallbacks: Array<() => void> = [];

    scheduleInitialMessageAutoScroll({
      scrollToBottom: () => calls.push("scroll"),
      shouldAutoScroll: () => shouldAutoScroll,
      markSettled: () => calls.push("settle"),
      requestFrame: (callback) => {
        frameCallbacks.push(callback);
        return 1;
      },
      cancelFrame: () => {},
      setTimer: (callback) => {
        timerCallbacks.push(callback);
        return 2;
      },
      clearTimer: () => {},
    });

    shouldAutoScroll = false;
    frameCallbacks[0]?.(0);
    timerCallbacks[0]?.();

    expect(calls).toEqual(["scroll", "settle", "settle"]);
  });

  it("keeps deferred scrolls while the user remains pinned to the bottom", () => {
    const calls: string[] = [];
    const frameCallbacks: FrameRequestCallback[] = [];
    const timerCallbacks: Array<() => void> = [];

    scheduleInitialMessageAutoScroll({
      scrollToBottom: () => calls.push("scroll"),
      shouldAutoScroll: () => true,
      markSettled: () => calls.push("settle"),
      requestFrame: (callback) => {
        frameCallbacks.push(callback);
        return 1;
      },
      cancelFrame: () => {},
      setTimer: (callback) => {
        timerCallbacks.push(callback);
        return 2;
      },
      clearTimer: () => {},
    });

    frameCallbacks[0]?.(0);
    timerCallbacks[0]?.();

    expect(calls).toEqual(["scroll", "scroll", "settle", "scroll", "settle"]);
  });
});
