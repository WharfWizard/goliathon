import { useState, useRef } from "react";

const NAVY = "#00274d", YELLOW = "#ffc72c", WHITE = "#ffffff", PANEL = "#002a57", BORDER = "#003a6e", LIGHT = "#e8eef4";

// Lightweight markdown renderer for chat replies — handles headers, bold,
// and bullet lists, which is what Claude's responses typically use. Not a
// full markdown parser; the rest of the app has none, so this stays minimal
// rather than pulling in a new dependency for one component.
function renderInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part
    )
  );
}

function MarkdownText({ text, color }) {
  const lines = text.split("\n");
  const blocks = [];
  let listBuffer = [];

  function flushList(key) {
    if (listBuffer.length) {
      blocks.push(
        <ul key={`ul-${key}`} style={{ margin: "4px 0 8px", paddingLeft: 18 }}>
          {listBuffer.map((item, i) => (
            <li key={i} style={{ marginBottom: 3 }}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      listBuffer = [];
    }
  }

  lines.forEach((line, i) => {
    const heading = line.match(/^(#{1,3})\s+(.*)/);
    const bullet = line.match(/^[-*]\s+(.*)/);

    if (heading) {
      flushList(i);
      const size = heading[1].length === 1 ? 15 : heading[1].length === 2 ? 14 : 13;
      blocks.push(
        <div key={i} style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: size, color: YELLOW, margin: "10px 0 4px" }}>
          {renderInline(heading[2])}
        </div>
      );
    } else if (bullet) {
      listBuffer.push(bullet[1]);
    } else if (line.trim() === "---") {
      flushList(i);
      blocks.push(<div key={i} style={{ borderTop: `1px solid ${BORDER}`, margin: "8px 0" }} />);
    } else if (line.trim() === "") {
      flushList(i);
    } else {
      flushList(i);
      blocks.push(<p key={i} style={{ margin: "0 0 6px" }}>{renderInline(line)}</p>);
    }
  });
  flushList("end");

  return <div style={{ color, fontSize: 13, lineHeight: 1.6 }}>{blocks}</div>;
}

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
              whiteSpace: m.role === "user" ? "pre-wrap" : "normal",
            }}
          >
            {m.role === "assistant" && m.content ? (
              <MarkdownText text={m.content} color={LIGHT} />
            ) : (
              m.content || (isStreaming && i === messages.length - 1 ? "…" : "")
            )}
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
