import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Search, SendHorizontal, Settings, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fetchChannels, saveChannelConfig, type ChannelInfo } from "./api/channels.js";
import { createSession } from "./api/sessions.js";
import { fetchSkills } from "./api/skills.js";
import { sendSessionMessage } from "./api/messages.js";
import type { AgentType, ChatMessage, RunStats, SkillMeta } from "./api/types.js";

const AGENT_OPTIONS: Array<{ value: AgentType; label: string }> = [
  { value: "codex", label: "Codex" },
  { value: "claude", label: "Claude" },
];

type DrawerTab = "skills" | "channels";

export default function App() {
  const queryClient = useQueryClient();
  const [agentType, setAgentType] = useState<AgentType>("claude");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("skills");
  const [skillsQuery, setSkillsQuery] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const skillsSearchRef = useRef<HTMLInputElement>(null);
  const prevMsgCountRef = useRef(0);
  const streamingTextRef = useRef("");
  const isStreamingRef = useRef(false);
  const [streamingText, setStreamingText] = useState("");

  const { data: skillsData } = useQuery({
    queryKey: ["skills"],
    queryFn: fetchSkills,
    refetchInterval: 30_000,
  });
  const skills: SkillMeta[] = skillsData?.skills ?? [];

  const { data: channelsData } = useQuery({
    queryKey: ["channels"],
    queryFn: fetchChannels,
  });
  const channels: ChannelInfo[] = channelsData?.channels ?? [];

  const filteredSkills = skillsQuery
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(skillsQuery.toLowerCase()) ||
          s.description.toLowerCase().includes(skillsQuery.toLowerCase()),
      )
    : skills;

  // Single source of truth: workspace polling
  const { data: snapshot } = useQuery({
    queryKey: ["workspace", sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/workspace?sessionId=${sessionId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ messages: ChatMessage[]; runStats: RunStats }>;
    },
    enabled: !!sessionId,
    refetchInterval: 3_000,
  });

  const messages: ChatMessage[] = snapshot?.messages ?? [];
  const runStats: RunStats = snapshot?.runStats ?? { durationSeconds: null, tokensUsed: null, tokensTotal: null };

  // SSE: capture text_delta for streaming + trigger workspace refresh
  const lastGlobalSeqRef = useRef(0);
  useEffect(() => {
    if (!sessionId) return;
    let stopped = false;
    let source: EventSource | null = null;

    const connect = (afterSeq: number) => {
      if (stopped) return;
      const url = `/api/events/stream?sessionId=${encodeURIComponent(sessionId)}&afterGlobalSeq=${afterSeq}&limit=100`;
      console.log("[SSE] connecting", url);
      source = new EventSource(url);
      const refresh = () => queryClient.invalidateQueries({ queryKey: ["workspace", sessionId] });
      for (const type of ["message_created", "run_started", "run_completed", "run_output_appended"]) {
        source.addEventListener(type, refresh);
      }
      source.addEventListener("text_delta", (e: MessageEvent) => {
        console.log("[SSE] text_delta received, isStreaming:", isStreamingRef.current);
        if (isStreamingRef.current) {
          try {
            const evt = JSON.parse(e.data);
            console.log("[SSE] text_delta payload:", evt.payload?.text);
            if (evt.payload?.text) {
              streamingTextRef.current += evt.payload.text;
              setStreamingText(streamingTextRef.current);
            }
          } catch (err) { console.error("[SSE] parse error", err); }
        }
        refresh();
      });
      source.addEventListener("message_created", (e: MessageEvent) => {
        try { lastGlobalSeqRef.current = JSON.parse(e.data).globalSeq ?? lastGlobalSeqRef.current; } catch {}
      });
      source.addEventListener("text_delta", (e: MessageEvent) => {
        try { lastGlobalSeqRef.current = JSON.parse(e.data).globalSeq ?? lastGlobalSeqRef.current; } catch {}
      });
      source.onerror = (err) => {
        console.log("[SSE] error, readyState:", source?.readyState, err);
        source?.close();
        if (!stopped) setTimeout(() => connect(lastGlobalSeqRef.current), 3_000);
      };
    };
    connect(lastGlobalSeqRef.current);
    return () => {
      stopped = true;
      source?.close();
    };
  }, [sessionId, queryClient]);

  // Auto-scroll on new messages or streaming text
  useEffect(() => {
    if (messages.length > prevMsgCountRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevMsgCountRef.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    if (streamingText) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [streamingText]);

  // Clear streaming text when agent message arrives in workspace
  useEffect(() => {
    if (isStreamingRef.current && messages.some(m => m.role === "agent")) {
      streamingTextRef.current = "";
      setStreamingText("");
      isStreamingRef.current = false;
    }
  }, [messages]);

  // Focus search on drawer open + skills tab
  useEffect(() => {
    if (drawerOpen && drawerTab === "skills") {
      setSkillsQuery("");
      requestAnimationFrame(() => skillsSearchRef.current?.focus());
    }
  }, [drawerOpen, drawerTab]);

  const openDrawer = (tab: DrawerTab) => {
    if (drawerOpen && drawerTab === tab) {
      setDrawerOpen(false);
    } else {
      setDrawerTab(tab);
      setDrawerOpen(true);
    }
  };

  const sendMessage = useMutation({
    mutationFn: async (text: string) => {
      console.log("[sendMessage] start", { text, sessionId, isStreaming: isStreamingRef.current });
      streamingTextRef.current = "";
      setStreamingText("");
      isStreamingRef.current = true;
      let sid = sessionId;
      if (!sid) {
        console.log("[sendMessage] creating session...");
        const res = await createSession({ agentType });
        sid = res.sessionId;
        console.log("[sendMessage] session created", sid);
        setSessionId(sid);
      }
      console.log("[sendMessage] sending message to", sid);
      const result = await sendSessionMessage(sid, { text });
      console.log("[sendMessage] message sent", result);
      return { ...result, sessionId: sid };
    },
    onSuccess: (data) => {
      console.log("[sendMessage] onSuccess", data);
      setDraft("");
      setSessionId(data.sessionId);
      queryClient.invalidateQueries({ queryKey: ["workspace", data.sessionId] });
    },
    onError: (error) => {
      console.error("[sendMessage] onError", error);
    },
  });

  const handleSend = () => {
    const text = draft.trim();
    if (!text || sendMessage.isPending) return;
    sendMessage.mutate(text);
  };

  const handleSkillSelect = (skill: SkillMeta) => {
    setDraft(`/${skill.name} `);
    setDrawerOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const currentAgent = AGENT_OPTIONS.find((a) => a.value === agentType)!;

  return (
    <main className="app-root">
      {/* Left drawer */}
      <div className={`drawer ${drawerOpen ? "open" : ""}`}>
        {/* Tab header */}
        <div className="drawer-tabs">
          <button
            className={`drawer-tab ${drawerTab === "skills" ? "active" : ""}`}
            onClick={() => setDrawerTab("skills")}
          >
            <Sparkles className="h-3.5 w-3.5" /> Skills
          </button>
          <button
            className={`drawer-tab ${drawerTab === "channels" ? "active" : ""}`}
            onClick={() => setDrawerTab("channels")}
          >
            <Settings className="h-3.5 w-3.5" /> Channels
          </button>
          <button className="drawer-close" onClick={() => setDrawerOpen(false)}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Skills tab */}
        {drawerTab === "skills" && (
          <>
            <div className="drawer-search">
              <Search className="h-4 w-4 drawer-search-icon" />
              <input
                ref={skillsSearchRef}
                className="drawer-search-input"
                value={skillsQuery}
                onChange={(e) => setSkillsQuery(e.currentTarget.value)}
                placeholder="Search skills..."
              />
            </div>
            <div className="drawer-list">
              {filteredSkills.length === 0 && (
                <div className="drawer-empty">No matching skills</div>
              )}
              {filteredSkills.map((skill) => (
                <button key={skill.name} className="drawer-item" onClick={() => handleSkillSelect(skill)}>
                  <strong>{skill.name}</strong>
                  {skill.description && (
                    <span className="drawer-item-desc">{skill.description.slice(0, 30)}...</span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Channels tab */}
        {drawerTab === "channels" && (
          <div className="drawer-list">
            {channels.map((ch) => (
              <ChannelCard key={ch.id} channel={ch} onSaved={() => queryClient.invalidateQueries({ queryKey: ["channels"] })} />
            ))}
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="chat-main">
        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="chat-empty">
              <Sparkles className="chat-empty-icon" />
              <p>Send a message to start</p>
            </div>
          )}
          {messages.map((msg, index) => {
            // System "Run succeeded" → stat card
            if (msg.role === "system" && msg.markdown.startsWith("Run succeeded")) {
              return (
                <div key={msg.id} className="chat-stat">
                  {runStats.durationSeconds !== null && <span>{runStats.durationSeconds}s</span>}
                  {runStats.tokensUsed !== null && <span>{runStats.tokensUsed.toLocaleString()} tokens</span>}
                  <span>完成</span>
                </div>
              );
            }
            // System messages → skip others
            if (msg.role === "system") return null;
            return (
              <div key={msg.id} className={`chat-bubble ${msg.role}`}>
                <div className="chat-bubble-header">
                  <strong>{msg.author}</strong>
                  {msg.time && <span className="chat-time">{msg.time}</span>}
                </div>
                <div className="prose-mini">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.markdown}</ReactMarkdown>
                </div>
              </div>
            );
          })}
          {(sendMessage.isPending || streamingText) && !messages.some(m => m.role === "agent") && (
            <div className="chat-bubble agent">
              <div className="chat-bubble-header"><strong>Agent</strong></div>
              {streamingText ? (
                <div className="prose-mini">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingText}</ReactMarkdown>
                </div>
              ) : (
                <div className="chat-typing">
                  <span className="typing-dots"><span/><span/><span/></span>
                </div>
              )}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-bar">
          <div className="chat-bar-left">
            <button className={`bar-btn ${drawerOpen && drawerTab === "skills" ? "bar-btn--active" : ""}`} onClick={() => openDrawer("skills")} title="Skills">
              <Sparkles className="h-4 w-4" />
              <span className="bar-btn-label">Skills</span>
            </button>
            <button className={`bar-btn ${drawerOpen && drawerTab === "channels" ? "bar-btn--active" : ""}`} onClick={() => openDrawer("channels")} title="Channels">
              <Settings className="h-4 w-4" />
            </button>
            <div className="dropdown-wrapper">
              <button className="bar-btn" onClick={() => setAgentMenuOpen(!agentMenuOpen)} title="Switch agent">
                <span className="bar-btn-label">{currentAgent.label}</span>
                <ChevronDown className="h-3 w-3" />
              </button>
              {agentMenuOpen && (
                <div className="dropdown-menu">
                  {AGENT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={`dropdown-item ${agentType === opt.value ? "active" : ""}`}
                      onClick={() => { setAgentType(opt.value); setAgentMenuOpen(false); }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <textarea
            className="chat-input"
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
          />
          <button className="send-btn" onClick={handleSend} disabled={sendMessage.isPending || !draft.trim()}>
            <SendHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>

      {agentMenuOpen && (
        <div className="dropdown-backdrop" onClick={() => setAgentMenuOpen(false)} />
      )}
    </main>
  );
}

const CHANNEL_FIELDS: Record<string, Array<{ key: string; label: string }>> = {
  feishu: [
    { key: "app_id", label: "App ID" },
    { key: "app_secret", label: "App Secret" },
  ],
  qq: [
    { key: "app_id", label: "App ID" },
    { key: "app_secret", label: "App Secret" },
  ],
};

function ChannelCard({ channel, onSaved }: { channel: ChannelInfo; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configurable = channel.id === "feishu" || channel.id === "qq";
  const fields = CHANNEL_FIELDS[channel.id] ?? [];
  const initialConfig = channel.config ?? {};
  const [form, setForm] = useState<Record<string, string>>({});

  const startEdit = () => {
    const startValues: Record<string, string> = {};
    for (const f of fields) {
      startValues[f.key] = initialConfig[f.key] ?? "";
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setError(null);
  };

  return (
    <div className="channel-card">
      <div className="channel-card-header">
        <strong>{channel.label}</strong>
        <span className={`channel-status channel-status--${channel.status}`}>
          <span className="channel-dot" />
          {channel.status === "connected" ? "Connected" : channel.status === "available" ? "Available" : "Offline"}
        </span>
      </div>
      <p className="channel-card-desc">{channel.description}</p>

      {configurable && !editing && (
        <button className="channel-config-btn" onClick={startEdit}>
          Configure
        </button>
      )}

      {configurable && editing && (
        <div className="channel-form">
          {fields.map((f) => (
            <label key={f.key} className="channel-field">
              <span>{f.label}</span>
              <input
                type={f.key.includes("secret") ? "password" : "text"}
                value={form[f.key] ?? ""}
                onChange={(e) => {
	                  const value = e.currentTarget.value;
	                  setForm((prev) => ({ ...prev, [f.key]: value }));
	                }}
                placeholder={f.label}
              />
            </label>
          ))}
          {error && <p className="channel-form-error">{error}</p>}
          <div className="channel-form-actions">
            <button className="channel-form-cancel" onClick={handleCancel}>Cancel</button>
            <button className="channel-form-save" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
