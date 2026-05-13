import type { RuntimeEventDraft } from "./types.js";

export class TextDeltaBatcher {
  private text = "";
  private firstReceivedAt: string | null = null;
  private lastReceivedAt: string | null = null;

  constructor(private readonly maxBytes: number) {
    if (maxBytes <= 0) {
      throw new Error("maxBytes must be positive");
    }
  }

  push(event: RuntimeEventDraft): RuntimeEventDraft[] {
    if (event.type !== "text_delta") {
      return [event];
    }

    const text = typeof event.payload.text === "string" ? event.payload.text : "";
    if (!text) {
      return [];
    }

    this.text += text;
    const receivedAt = typeof event.payload.receivedAt === "string" ? event.payload.receivedAt : null;
    this.firstReceivedAt ??= receivedAt;
    this.lastReceivedAt = receivedAt;

    if (Buffer.byteLength(this.text, "utf8") >= this.maxBytes) {
      return this.flush();
    }

    return [];
  }

  flush(): RuntimeEventDraft[] {
    if (!this.text) {
      return [];
    }

    const event: RuntimeEventDraft = {
      type: "text_delta",
      payload: {
        text: this.text,
        firstReceivedAt: this.firstReceivedAt,
        lastReceivedAt: this.lastReceivedAt,
      },
    };

    this.text = "";
    this.firstReceivedAt = null;
    this.lastReceivedAt = null;

    return [event];
  }
}
