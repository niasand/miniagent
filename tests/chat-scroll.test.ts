import { describe, expect, it } from "vitest";
import { createChatScrollController } from "../src/client/lib/chat-scroll.js";

describe("createChatScrollController", () => {
  it("does not run deferred initial scrolls after the user moves away from the bottom", () => {
    const { container, calls } = createScrollContainer();
    const controller = createChatScrollController({ getContainer: () => container });
    const frameCallbacks: FrameRequestCallback[] = [];
    const timerCallbacks: Array<() => void> = [];

    controller.scheduleInitialLoad({
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

    controller.scrollToTop("smooth");
    frameCallbacks[0]?.(0);
    timerCallbacks[0]?.();

    expect(calls).toEqual(["bottom:auto", "top:smooth", "settle"]);
  });

  it("keeps deferred initial scrolls while the user remains pinned to the bottom", () => {
    const { container, calls } = createScrollContainer();
    const controller = createChatScrollController({ getContainer: () => container });
    const frameCallbacks: FrameRequestCallback[] = [];
    const timerCallbacks: Array<() => void> = [];

    controller.scheduleInitialLoad({
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

    expect(calls).toEqual(["bottom:auto", "bottom:auto", "settle", "bottom:auto"]);
  });

  it("corrects non-user scroll restoration while initial load is settling", () => {
    const { container, calls } = createScrollContainer();
    const controller = createChatScrollController({ getContainer: () => container });
    const timerCallbacks: Array<() => void> = [];

    controller.scheduleInitialLoad({
      markSettled: () => calls.push("settle"),
      requestFrame: () => 1,
      cancelFrame: () => {},
      setTimer: (callback) => {
        timerCallbacks.push(callback);
        return timerCallbacks.length;
      },
      clearTimer: () => {},
    });

    container.scrollTop = 0;
    controller.updatePosition();
    timerCallbacks[1]?.();

    expect(calls).toEqual(["bottom:auto", "top:auto", "bottom:auto", "settle"]);
  });

  it("uses the same pinned-bottom rule for streaming updates", () => {
    const { container, calls } = createScrollContainer();
    const controller = createChatScrollController({ getContainer: () => container });

    controller.scrollToBottomIfPinned("smooth");
    controller.scrollToTop("smooth");
    controller.scrollToBottomIfPinned("smooth");

    expect(calls).toEqual(["bottom:smooth", "top:smooth"]);
  });
});

function createScrollContainer() {
  const calls: string[] = [];
  let scrollTop = 0;
  const container = {
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(value: number) {
      scrollTop = value;
      calls.push(value === 0 ? "top:auto" : "bottom:auto");
    },
    scrollHeight: 1_000,
    clientHeight: 300,
    scrollTo(options: ScrollToOptions) {
      const top = typeof options.top === "number" ? options.top : this.scrollTop;
      scrollTop = top;
      calls.push(top === 0 ? `top:${options.behavior}` : `bottom:${options.behavior}`);
    },
  } as HTMLElement;

  return { container, calls };
}
