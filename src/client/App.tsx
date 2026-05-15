import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, SendHorizontal, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createSession } from "./api/sessions.js";
import { fetchSkills } from "./api/skills.js";
import { sendSessionMessage } from "./api/messages.js";
import type { AgentType, ChatMessage, SkillMeta } from "./api/types.js";

const AGENT_OPTIONS: Array<{ value: AgentType; label: string }> = [
  { value: "codex", label: "Codex" },
  { value: "claude", label: "Claude" },
  { value: "trae", label: "Trae" },
];

export default function App() {
  const queryClient = useQueryClient();
  const [agentType, setAgentType] = useState<AgentType>("codex");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);

  const { data: skillsData } = useQuery({
    queryKey: ["skills"],
    queryFn: fetchSkills,
    refetchInterval: 30_000,
  });
  const skills: SkillMeta[] = skillsData?.skills ?? [];

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
    setSkillsOpen(false);
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
          <div className="dropdown-wrapper">
            <button className="bar-btn" onClick={() => setSkillsOpen(!skillsOpen)} title="Skills">
              <Sparkles className="h-4 w-4" />
              <span className="bar-btn-label">Skills</span>
            </button>
            {skillsOpen && skills.length > 0 && (
              <div className="dropdown-menu">
                {skills.map((skill) => (
                  <button key={skill.name} className="dropdown-item" onClick={() => handleSkillSelect(skill)}>
                    <strong>{skill.name}</strong>
                    {skill.description && <span className="dropdown-desc">{skill.description}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
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

      {(agentMenuOpen || skillsOpen) && (
        <div className="dropdown-backdrop" onClick={() => { setAgentMenuOpen(false); setSkillsOpen(false); }} />
      )}
    </main>
  );
}
