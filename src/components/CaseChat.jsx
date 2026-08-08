import { useState, useRef } from "react";

const NAVY = "#00274d", YELLOW = "#ffc72c", WHITE = "#ffffff", PANEL = "#002a57", BORDER = "#003a6e", LIGHT = "#e8eef4";

// Chat-with-case panel. Renders inline within the dossier view (as a Panel
// child) once a case has been saved. Streams responses from /api/case-chat.
export default function CaseChat({ caseId }) {
  const [messages, setMessages] = useState([]); // { role, content }
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef(null);

  async function sendMessage() {
    const text = input.trim();
    if (!text || isStreaming) return;

    setError("");
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
    setIsStreaming(true);

    try {
      const response = await fetch("/api/case-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, message: text }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Chat request failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              setError(parsed.error);
              continue;
            }
            if (parsed.text) {
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                next[next.length - 1] = { ...last, content: last.content + parsed.text };
                return next;
              });
            }
          } catch {
            // ignore malformed SSE chunk
          }
        }
      }
    } catch (e) {
      setError("Something went wrong sending that message. Please try again.");
    } finally {
      setIsStreaming(false);
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: 420 }}>
      <div style={{ flex: 1, overflowY: "auto", marginBottom: 10, paddingRight: 2 }}>
        {messages.length === 0 && (
          <p style={{ margin: 0, fontSize: 12, color: "#7a96b0", lineHeight: 1.7 }}>
            Ask a question about this case, request a draft email, or explore a what-if. Answers are based on the evidence already filed in this case.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              maxWidth: "85%",
              marginLeft: m.role === "user" ? "auto" : 0,
              marginBottom: 8,
              background: m.role === "user" ? YELLOW : "#001e3d",
              color: m.role === "user" ? NAVY : LIGHT,
              border: m.role === "user" ? "none" : `1px solid ${BORDER}`,
              borderRadius: 10,
              padding: "8px 11px",
              fontSize: 13,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
            }}
          >
            {m.content || (isStreaming && i === messages.length - 1 ? "…" : "")}
          </div>
        ))}
        {error && (
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "#e57373" }}>{error}</p>
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about this case…"
          disabled={isStreaming}
          rows={1}
          style={{
            flex: 1,
            resize: "none",
            background: "#001e3d",
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            padding: "8px 10px",
            color: LIGHT,
            fontSize: 13,
            outline: "none",
            fontFamily: "'Open Sans', sans-serif",
          }}
        />
        <button
          onClick={sendMessage}
          disabled={isStreaming || !input.trim()}
          style={{
            background: YELLOW,
            color: NAVY,
            border: "none",
            borderRadius: 8,
            fontFamily: "'Poppins', sans-serif",
            fontWeight: 700,
            fontSize: 12,
            padding: "8px 16px",
            cursor: isStreaming || !input.trim() ? "not-allowed" : "pointer",
            opacity: isStreaming || !input.trim() ? 0.4 : 1,
            whiteSpace: "nowrap",
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
