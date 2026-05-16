export type ChannelMessage = {
  messageId: string;
  chatId: string;
  userId: string;
  text: string;
  chatType: "private" | "group";
  isMentioned?: boolean; // true if bot was @mentioned in group chat
};

export type SendResult = {
  providerMessageId?: string;
};

export type TestResult = { ok: boolean; message: string };

export interface ChannelAdapter {
  readonly channelType: string;
  start(onMessage: (msg: ChannelMessage) => void): Promise<void>;
  stop(): void;
  send(targetRef: string, content: string): Promise<SendResult>;
  test?(): Promise<TestResult>;
}
