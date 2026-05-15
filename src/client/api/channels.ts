export type ChannelInfo = {
  id: string;
  label: string;
  status: "connected" | "available" | "disconnected";
  description: string;
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
