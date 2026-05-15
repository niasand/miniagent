import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Search, SendHorizontal, Settings, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fetchChannels, saveChannelConfig, type ChannelInfo } from "./api/channels.js";
import { createSession } from "./api/sessions.js";
import { fetchSkills } from "./api/skills.js";
import { sendSessionMessage } from "./api/messages.js";
import type { AgentType, ChatMessage, SkillMeta } from "./api/types.js";

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
      return res.json() as Promise<{ messages: ChatMessage[] }>;
    },
    enabled: !!sessionId,
    refetchInterval: 3_000,
  });

  const messages: ChatMessage[] = snapshot?.messages ?? [];

  // SSE as refetch trigger only
  useEffect(() => {
    if (!sessionId) return;
    let stopped = false;
    let source: EventSource | null = null;
    const connect = () => {
      source = new EventSource(
        `/api/events/stream?sessionId=${encodeURIComponent(sessionId)}&afterGlobalSeq=0&limit=100`,
      );
      const refresh = () => queryClient.invalidateQueries({ queryKey: ["workspace", sessionId] });
      for (const type of ["message_created", "text_delta", "run_started", "run_completed", "run_output_appended"]) {
        source.addEventListener(type, refresh);
      }
      source.onerror = () => {
        source?.close();
        if (!stopped) setTimeout(connect, 2_000);
      };
    };
    connect();
    return () => {
      stopped = true;
      source?.close();
    };
  }, [sessionId, queryClient]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length > prevMsgCountRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevMsgCountRef.current = messages.length;
  }, [messages.length]);

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
      let sid = sessionId;
      if (!sid) {
        const res = await createSession({ agentType });
        sid = res.sessionId;
        setSessionId(sid);
      }
      return sendSessionMessage(sid, { text });
    },
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["workspace", sessionId] });
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
          {messages.map((msg) => (
            <div key={msg.id} className={`chat-bubble ${msg.role}`}>
              <div className="chat-bubble-header">
                <strong>{msg.author}</strong>
                {msg.time && <span className="chat-time">{msg.time}</span>}
              </div>
              <div className="prose-mini">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.markdown}</ReactMarkdown>
              </div>
            </div>
          ))}
          {sendMessage.isPending && (
            <div className="chat-bubble agent">
              <div className="chat-bubble-header"><strong>Agent</strong></div>
              <div className="chat-typing">Thinking...</div>
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
                onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.currentTarget.value }))}
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
