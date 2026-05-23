import QRCode from "qrcode";
import { useRef, useState } from "react";
import { pollWechatQRStatus, requestWechatQRCode, saveChannelConfig, testChannel, type ChannelInfo } from "../api/channels.js";
import { formatChannelStatus } from "../lib/status-labels.js";

const CHANNEL_FIELDS: Record<string, Array<{ key: string; label: string }>> = {
  feishu: [
    { key: "app_id", label: "App ID" },
    { key: "app_secret", label: "App Secret" },
  ],
  qq: [
    { key: "app_id", label: "App ID" },
    { key: "app_secret", label: "App Secret" },
  ],
  telegram: [
    { key: "bot_token", label: "Bot Token" },
  ],
  discord: [
    { key: "bot_token", label: "Bot Token" },
  ],
  wechat: [
    { key: "bot_token", label: "Bot Token" },
  ],
  wecom: [
    { key: "bot_id", label: "Bot ID" },
    { key: "secret", label: "Secret" },
  ],
  dingtalk: [
    { key: "client_id", label: "Client ID (App Key)" },
    { key: "client_secret", label: "Client Secret" },
  ],
};

export function ChannelCard({ channel, onSaved }: { channel: ChannelInfo; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<string>("");
  const [qrPolling, setQrPolling] = useState(false);
  const qrPollingRef = useRef(false);

  const configurable = channel.id in CHANNEL_FIELDS;
  const fields = CHANNEL_FIELDS[channel.id] ?? [];
  const initialConfig = channel.config ?? {};
  const [form, setForm] = useState<Record<string, string>>({});

  const startEdit = () => {
    const startValues: Record<string, string> = {};
    for (const field of fields) {
      startValues[field.key] = initialConfig[field.key] ?? "";
    }
    setForm(startValues);
    setEditing(true);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveChannelConfig(channel.id, form);
      setEditing(false);
      onSaved();
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testChannel(channel.id);
      setTestResult(result);
    } catch (currentError) {
      setTestResult({ ok: false, message: currentError instanceof Error ? currentError.message : "测试失败" });
    } finally {
      setTesting(false);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setError(null);
  };

  const handleWechatQRLogin = async () => {
    setError(null);
    setQrStatus("loading");
    setQrPolling(true);
    qrPollingRef.current = true;
    try {
      const qr = await requestWechatQRCode();
      if (qr.error) {
        setError(qr.error);
        setQrPolling(false);
        qrPollingRef.current = false;
        return;
      }
      const qrContent = qr.qrcode_img_content ?? qr.qrcode_url ?? "";
      if (!qrContent) {
        setError("未返回二维码链接");
        setQrPolling(false);
        qrPollingRef.current = false;
        return;
      }
      const dataUrl = await QRCode.toDataURL(qrContent, { width: 200, margin: 2 });
      setQrUrl(dataUrl);
      setQrStatus("waiting");
      const qrcodeKey = qr.qrcode ?? qr.token ?? "";
      if (!qrcodeKey) {
        setError("未返回二维码标识");
        setQrPolling(false);
        qrPollingRef.current = false;
        return;
      }
      const poll = async () => {
        if (!qrPollingRef.current) return;
        try {
          const status = await pollWechatQRStatus(qrcodeKey);
          if (status.error) {
            setQrStatus("error");
            setError(status.error);
            setQrPolling(false);
            qrPollingRef.current = false;
            return;
          }
          if (status.status === "confirmed" && status.bot_token) {
            setQrStatus("confirmed");
            setQrPolling(false);
            qrPollingRef.current = false;
            try {
              await saveChannelConfig("wechat", { bot_token: status.bot_token, ...(status.baseurl ? { base_url: status.baseurl } : {}) });
            } catch (saveError) {
              setQrStatus("error");
              setError(saveError instanceof Error ? saveError.message : "保存配置失败");
              return;
            }
            onSaved();
            return;
          }
          if (status.status === "expired") {
            setQrStatus("expired");
            setQrPolling(false);
            qrPollingRef.current = false;
            return;
          }
          if (status.status === "scaned") setQrStatus("scanned");
          if (qrPollingRef.current) setTimeout(poll, 2000);
        } catch {
          if (qrPollingRef.current) setTimeout(poll, 3000);
        }
      };
      setTimeout(poll, 2000);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "二维码请求失败");
      setQrPolling(false);
      qrPollingRef.current = false;
    }
  };

  return (
    <div className="channel-card">
      <div className="channel-card-header">
        <strong>{channel.label}</strong>
        <span className={`channel-status channel-status--${channel.status}`}>
          <span className="channel-dot" />
          {formatChannelStatus(channel.status)}
        </span>
      </div>
      <p className="channel-card-desc">{channel.description}</p>

      {channel.id === "wechat" && !editing && (
        <div className="channel-actions">
          <button className="channel-config-btn" onClick={handleWechatQRLogin} disabled={qrPolling}>
            {qrPolling ? "等待扫码中..." : "扫码登录"}
          </button>
          <button className="channel-test-btn" onClick={handleTest} disabled={testing}>
            {testing ? "测试中..." : "测试连接"}
          </button>
        </div>
      )}
      {channel.id === "wechat" && qrUrl && (
        <div className="wechat-qr-container">
          <img src={qrUrl} alt="WeChat QR Code" className="wechat-qr-img" />
          <p className="wechat-qr-status">
            {qrStatus === "waiting" && "请使用微信扫码..."}
            {qrStatus === "scanned" && "已扫码，请在手机上确认..."}
            {qrStatus === "confirmed" && "登录成功"}
            {qrStatus === "expired" && "二维码已过期，请重试"}
          </p>
        </div>
      )}

      {configurable && channel.id !== "wechat" && !editing && (
        <div className="channel-actions">
          <button className="channel-config-btn" onClick={startEdit}>
            配置
          </button>
          <button className="channel-test-btn" onClick={handleTest} disabled={testing}>
            {testing ? "测试中..." : "测试连接"}
          </button>
        </div>
      )}
      {testResult && (
        <p className={`channel-test-result ${testResult.ok ? "channel-test-ok" : "channel-test-fail"}`}>
          {testResult.ok ? "✓" : "✗"} {testResult.message}
        </p>
      )}

      {configurable && editing && (
        <div className="channel-form">
          {fields.map((field) => (
            <label key={field.key} className="channel-field">
              <span>{field.label}</span>
              <input
                type={field.key.includes("secret") ? "password" : "text"}
                value={form[field.key] ?? ""}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setForm((previous) => ({ ...previous, [field.key]: value }));
                }}
                placeholder={field.label}
              />
            </label>
          ))}
          {error && <p className="channel-form-error">{error}</p>}
          <div className="channel-form-actions">
            <button className="channel-form-cancel" onClick={handleCancel}>取消</button>
            <button className="channel-form-save" onClick={handleSave} disabled={saving}>
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
