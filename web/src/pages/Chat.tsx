import { useState, useRef, useEffect, useCallback } from "react";
import { type ChatMessage, sendMessage } from "../api";

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionId] = useState(() => crypto.randomUUID());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setSending(true);

    try {
      const res = await sendMessage(sessionId, text);
      setMessages((prev) => [...prev, { role: "agent", content: res.content }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "agent", content: "Sorry, something went wrong. Please try again." },
      ]);
    } finally {
      setSending(false);
    }
  }, [input, sending, sessionId]);

  return (
    <div className="page">
      <h2>Chat with Platform Engineer</h2>

      <div className="chat-container">
        <div className="chat-messages" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="empty">
              <div className="empty-icon">💬</div>
              <p>Start a conversation with the Platform Engineer Agent.</p>
              <p style={{ fontSize: 13, marginTop: 8, color: "var(--text-muted)" }}>
                Try: "Analyze https://github.com/owner/repo and recommend a platform"
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`chat-message ${m.role}`}>
              {m.content}
            </div>
          ))}
          {sending && (
            <div className="chat-message agent" style={{ opacity: 0.6 }}>
              Thinking...
            </div>
          )}
        </div>

        <div className="chat-input-row">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Ask the platform engineer..."
            disabled={sending}
          />
          <button onClick={send} disabled={sending || !input.trim()}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
