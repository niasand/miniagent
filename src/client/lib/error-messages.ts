function matchStatusCode(message: string, prefix: string): RegExpMatchArray | null {
  return message.match(new RegExp(`^${prefix}: (\\d+)$`));
}

function translatePathMissing(message: string): string | null {
  const match = message.match(/^(.+) was not found on PATH$/);
  return match ? `${match[1]} 未在 PATH 中找到` : null;
}

export function localizeProviderErrorMessage(message: string | null | undefined): string | null {
  if (!message) return null;

  const agentsApi = matchStatusCode(message, "Agents API failed");
  if (agentsApi) return `提供方列表加载失败：${agentsApi[1]}`;

  const saveDefaultApi = matchStatusCode(message, "Agent default API failed");
  if (saveDefaultApi) return `保存默认提供方失败：${saveDefaultApi[1]}`;

  const resolveDefaultApi = matchStatusCode(message, "Resolve agent default API failed");
  if (resolveDefaultApi) return `默认提供方加载失败：${resolveDefaultApi[1]}`;

  if (message === "Provider probe is unavailable") return "提供方探测结果不可用";
  if (message === "Probe failed") return "提供方探测失败";
  if (message === "Save provider failed") return "保存提供方失败";

  const pathMissing = translatePathMissing(message);
  if (pathMissing) return pathMissing;

  const missing = message.match(/^(.+) is not installed on this machine$/);
  if (missing) return `${missing[1]} 未安装在当前机器上`;

  const authRequired = message.match(/^(.+) requires authentication$/);
  if (authRequired) return `${authRequired[1]} 需要先完成认证`;

  const unavailable = message.match(/^(.+) is not available right now$/);
  if (unavailable) return `${unavailable[1]} 当前暂不可用`;

  const cannotSelect = message.match(/^(.+) cannot be selected right now$/);
  if (cannotSelect) return `${cannotSelect[1]} 当前无法选择`;

  return message;
}

export function localizeChannelErrorMessage(message: string | null | undefined): string | null {
  if (!message) return null;

  const channelsApi = matchStatusCode(message, "Channels API failed");
  if (channelsApi) return `通道列表加载失败：${channelsApi[1]}`;

  const saveConfigApi = matchStatusCode(message, "Save config failed");
  if (saveConfigApi) return `保存通道配置失败：${saveConfigApi[1]}`;

  if (message === "Save failed") return "保存失败";
  if (message === "Test failed") return "测试失败";
  if (message === "Connection ok") return "连接正常";
  if (message === "Connection failed") return "连接失败";
  if (message === "QR request failed") return "二维码请求失败";
  if (message === "Save config failed") return "保存通道配置失败";

  const pathMissing = translatePathMissing(message);
  if (pathMissing) return pathMissing;

  if (/token fetch failed/i.test(message)) return "令牌获取失败";
  if (/gateway fetch failed/i.test(message)) return "网关获取失败";
  if (/connection failed/i.test(message)) return "连接失败";
  if (/authentication failed/i.test(message)) return "认证失败";

  return message;
}
