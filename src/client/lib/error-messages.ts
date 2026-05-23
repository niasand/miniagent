function matchStatusCode(message: string, prefix: string): RegExpMatchArray | null {
  return message.match(new RegExp(`^${prefix}: (\\d+)$`));
}

function translatePathMissing(message: string): string | null {
  const match = message.match(/^(.+) was not found on PATH$/);
  return match ? `${match[1]} 未在 PATH 中找到` : null;
}

function translateSendFailed(message: string): string | null {
  const sendFailed = message.match(/^(.+?) send failed: (\d+)$/i);
  if (sendFailed) return `${sendFailed[1]} 发送失败：${sendFailed[2]}`;

  const sendError = message.match(/^(.+?) send error: (.+)$/i);
  if (sendError) return `${sendError[1]} 发送异常：${translateBusinessCode(sendError[2]) ?? sendError[2]}`;

  const sendRetried = message.match(/^(.+?) send failed after retries$/i);
  if (sendRetried) return `${sendRetried[1]} 发送失败，已达到重试上限`;

  return null;
}

function translateTokenFetchFailed(message: string): string | null {
  const tokenFetchFailed = message.match(/^(.+?) token fetch failed: (\d+)$/i);
  return tokenFetchFailed ? `${tokenFetchFailed[1]} 令牌获取失败：${tokenFetchFailed[2]}` : null;
}

function translateGatewayFetchFailed(message: string): string | null {
  const gatewayFetchFailed = message.match(/^Gateway fetch failed: (\d+)$/i);
  return gatewayFetchFailed ? `网关获取失败：${gatewayFetchFailed[1]}` : null;
}

function translateHttpError(message: string): string | null {
  const httpError = message.match(/^HTTP (\d+)$/);
  return httpError ? `HTTP 错误：${httpError[1]}` : null;
}

function translateBusinessCode(message: string): string | null {
  const wechatStatus = message.match(/^ret=(-?\d+)\s+errcode=(-?\d+)(?:\s+(.+))?$/);
  if (wechatStatus) {
    return `业务码异常：ret=${wechatStatus[1]} errcode=${wechatStatus[2]}${wechatStatus[3] ? ` ${wechatStatus[3]}` : ""}`;
  }

  const simpleRet = message.match(/^ret=(-?\d+)(?:\s+(.+))?$/);
  if (simpleRet) {
    return `业务码异常：ret=${simpleRet[1]}${simpleRet[2] ? ` ${simpleRet[2]}` : ""}`;
  }

  return null;
}

function translateApiFailure(message: string, prefix: string, label: string): string | null {
  const matched = matchStatusCode(message, prefix);
  return matched ? `${label}：${matched[1]}` : null;
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
  if (message === "Connected") return "已连接";
  if (message === "Connection failed") return "连接失败";
  if (message === "QR request failed") return "二维码请求失败";
  if (message === "Save config failed") return "保存通道配置失败";
  if (message === "bot_token is empty") return "bot_token 不能为空";
  if (message === "Invalid WeChat response") return "微信返回数据无效";

  const pathMissing = translatePathMissing(message);
  if (pathMissing) return pathMissing;

  const sendFailed = translateSendFailed(message);
  if (sendFailed) return sendFailed;

  const tokenFetchFailed = translateTokenFetchFailed(message);
  if (tokenFetchFailed) return tokenFetchFailed;

  const gatewayFetchFailed = translateGatewayFetchFailed(message);
  if (gatewayFetchFailed) return gatewayFetchFailed;

  const httpError = translateHttpError(message);
  if (httpError) return httpError;

  const businessCode = translateBusinessCode(message);
  if (businessCode) return businessCode;

  if (/connection failed/i.test(message)) return "连接失败";
  if (/authentication failed/i.test(message)) return "认证失败";

  return message;
}

export function localizeAppErrorMessage(message: string | null | undefined): string | null {
  if (!message) return null;

  const provider = localizeProviderErrorMessage(message);
  if (provider !== message) return provider;

  const channel = localizeChannelErrorMessage(message);
  if (channel !== message) return channel;

  const directApiTranslations: Array<[string, string]> = [
    ["Workspace API failed", "工作区加载失败"],
    ["Skills API failed", "技能列表加载失败"],
    ["Events API failed", "事件加载失败"],
    ["Message API failed", "发送消息失败"],
    ["Handoff API failed", "创建交接失败"],
    ["Create session API failed", "创建会话失败"],
    ["Update session API failed", "更新会话失败"],
    ["List schedules API failed", "任务列表加载失败"],
    ["Create schedule API failed", "创建任务失败"],
    ["Preview schedule API failed", "任务预览失败"],
    ["List schedule runs API failed", "任务运行记录加载失败"],
    ["Update schedule API failed", "更新任务失败"],
    ["Runtime start API failed", "启动运行失败"],
    ["Runtime stop API failed", "停止运行失败"],
    ["Runtime permissions API failed", "加载运行权限失败"],
    ["Runtime permission response API failed", "提交权限响应失败"],
    ["Compact failed", "压缩上下文失败"],
    ["Restart from ContextPack failed", "从 ContextPack 重启失败"],
  ];

  for (const [prefix, label] of directApiTranslations) {
    const translated = translateApiFailure(message, prefix, label);
    if (translated) return translated;
  }

  if (message === "Save provider failed") return "保存提供方失败";
  if (message === "Rename failed") return "重命名失败";
  if (message === "Create schedule failed") return "创建任务失败";
  if (message === "Update schedule failed") return "更新任务失败";
  if (message === "Message send failed") return "消息发送失败";
  if (message === "Runtime start failed") return "启动运行失败";
  if (message === "Runtime stop failed") return "停止运行失败";
  if (message === "Context compact failed") return "压缩上下文失败";
  if (message === "No session selected") return "未选择会话";
  if (message === "No schedule selected") return "未选择任务";
  if (message === "Message is required") return "请输入消息内容";
  if (message === "Run time is required") return "请选择执行时间";
  if (message === "Name is required") return "名称不能为空";
  if (message === "No default agent found") return "未找到默认提供方";
  if (message === "Failed") return "请求失败";

  return message;
}
