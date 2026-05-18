export type ChannelInfo = {
  id: string;
  label: string;
  status: "connected" | "available" | "disconnected";
  description: string;
  config?: Record<string, string>;
};

export type ListChannelsResponse = {
  channels: ChannelInfo[];
};

export async function fetchChannels(): Promise<ListChannelsResponse> {
  const response = await fetch("/api/channels", {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Channels API failed: ${response.status}`);
  return (await response.json()) as ListChannelsResponse;
}

export async function saveChannelConfig(
  channelId: string,
  config: Record<string, string>,
): Promise<{ config: Record<string, string> }> {
  const response = await fetch(`/api/channels/${encodeURIComponent(channelId)}/config`, {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Save config failed: ${response.status}`);
  }
  return (await response.json()) as { config: Record<string, string> };
}

export async function testChannel(channelId: string): Promise<{ ok: boolean; message: string }> {
  const response = await fetch(`/api/channels/${encodeURIComponent(channelId)}/test`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  return (await response.json()) as { ok: boolean; message: string };
}

export type WeChatQRResponse = {
  qrcode?: string;
  qrcode_url?: string;
  qrcode_img_content?: string;
  token?: string;
  error?: string;
};

export type WeChatQRStatus = {
  status?: string;
  bot_token?: string;
  baseurl?: string;
  error?: string;
};

export async function requestWechatQRCode(): Promise<WeChatQRResponse> {
  const res = await fetch("/api/channels/wechat/qrcode");
  return (await res.json()) as WeChatQRResponse;
}

export async function pollWechatQRStatus(qrcode: string): Promise<WeChatQRStatus> {
  const res = await fetch(`/api/channels/wechat/qrcode-status?qrcode=${encodeURIComponent(qrcode)}`);
  return (await res.json()) as WeChatQRStatus;
}
