export type ChannelMessage = {
  messageId: string;
  chatId: string;
  userId: string;
  text: string;
  chatType: "private" | "group";
};

export type SendResult = {
  providerMessageId?: string;
};

export interface ChannelAdapter {
  readonly channelType: string;
  start(onMessage: (msg: ChannelMessage) => void): Promise<void>;
  stop(): void;
  send(targetRef: string, content: string): Promise<SendResult>;
}
