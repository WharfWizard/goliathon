import { useState, useRef, useEffect } from "react";

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
// child) once a case has been saved. Streams responses from /api/case-chat,
// loads prior history on mount, and lets the user edit or delete their own
// messages (edit removes the message and its reply, then refills the input
// so it can be resent — matching how most chat tools handle "edit").
export default function CaseChat({ caseId }) {
  const [messages, setMessages] = useState([]); // { id, role, content }
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [hoveredId, setHoveredId] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Load existing history when the panel mounts (or the case changes).
  useEffect(() => {
    if (!caseId) return;
    let cancelled = false;
    setLoadingHistory(true);
    fetch(`/api/case-chat?caseId=${encodeURIComponent(caseId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data.messages)) {
          setMessages(data.messages.map((m) => ({ id: m.id, role: m.role, content: m.content })));
        }
      })
      .catch(() => {
        // Silently ignore — the chat still works for new messages even if
        // history fails to load; not worth blocking on.
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => { cancelled = true; };
  }, [caseId]);

  async function deleteMessage(id) {
    if (!id) return;
    setMessages((prev) => prev.filter((m) => m.id !== id));
    try {
      await fetch("/api/case-chat", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, messageId: id }),
      });
    } catch {
      // If the delete fails server-side, the message will simply reappear
      // next time history is reloaded — acceptable, not worth a retry loop.
    }
  }

  async function handleEdit(msg, index) {
    // Editing a user message removes it and its immediate reply (if any),
    // then refills the input so the person can adjust and resend — matching
    // the edit-and-regenerate pattern used elsewhere, and correctly pruning
    // stale context rather than leaving a stale reply behind.
    const next = messages[index + 1];
    const idsToDelete = [msg.id];
    if (next && next.role === "assistant") idsToDelete.push(next.id);

    setMessages((prev) => prev.filter((m) => !idsToDelete.includes(m.id)));
    setInput(msg.content);
    inputRef.current?.focus();

    for (const id of idsToDelete) {
      try {
        await fetch("/api/case-chat", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseId, messageId: id }),
        });
      } catch {
        // Same reasoning as deleteMessage above.
      }
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || isStreaming) return;

    setError("");
    setInput("");
    setMessages((prev) => [...prev, { id: null, role: "user", content: text }]);
    setMessages((prev) => [...prev, { id: null, role: "assistant", content: "" }]);
    setIsStreaming(true);

    try {
      const response = await fetch("/api/case-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, message: text }),
      });

      if (!response.ok) {
        // Try to read the server's actual error message (e.g. the daily
        // limit notice) before falling back to a generic one — otherwise a
        // deliberately clear, specific message from the server never
        // reaches the person, and they just see "something went wrong".
        let errMsg = "Something went wrong sending that message. Please try again.";
        try {
          const errData = await response.json();
          if (errData?.error) errMsg = errData.error;
        } catch {
          // Response wasn't JSON — keep the generic fallback.
        }
        throw new Error(errMsg);
      }

      if (!response.body) {
        throw new Error("Something went wrong sending that message. Please try again.");
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
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = {
                  ...next[next.length - 1],
                  content: `Something went wrong: ${parsed.error}`,
                };
                return next;
              });
              continue;
            }

            if (parsed.userMessageId) {
              setMessages((prev) => {
                const next = [...prev];
                // The user message is the second-to-last entry at this point.
                const idx = next.length - 2;
                if (idx >= 0) next[idx] = { ...next[idx], id: parsed.userMessageId };
                return next;
              });
              continue;
            }

            if (parsed.assistantMessageId) {
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { ...next[next.length - 1], id: parsed.assistantMessageId };
                return next;
              });
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
      // The message that opened this try block (the user's own text) has
      // already been rendered above; here we only need to replace the
      // placeholder assistant bubble with the actual error, using the
      // server's specific message when we have one.
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          ...next[next.length - 1],
          content: e.message || "Something went wrong sending that message. Please try again.",
        };
        return next;
      });
    } finally {
      setIsStreaming(false);
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: 560 }}>
      <div style={{ flex: 1, overflowY: "auto", marginBottom: 10, paddingRight: 2 }}>
        {loadingHistory && (
          <p style={{ margin: 0, fontSize: 12, color: "#7a96b0" }}>Loading previous conversation…</p>
        )}
        {!loadingHistory && messages.length === 0 && (
          <p style={{ margin: 0, fontSize: 12, color: "#7a96b0", lineHeight: 1.7 }}>
            Ask a question about this case, request a draft email, or explore a what-if. Answers are based on the evidence already filed in this case.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={m.id ?? `pending-${i}`}
            onMouseEnter={() => setHoveredId(m.id ?? `pending-${i}`)}
            onMouseLeave={() => setHoveredId(null)}
            style={{ position: "relative", maxWidth: "85%", marginLeft: m.role === "user" ? "auto" : 0, marginBottom: 8 }}
          >
            <div
              style={{
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
            {hoveredId === (m.id ?? `pending-${i}`) && m.id && !isStreaming && (
              <div style={{ display: "flex", gap: 4, justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginTop: 3 }}>
                {m.role === "user" && (
                  <button
                    onClick={() => handleEdit(m, i)}
                    title="Edit and resend"
                    style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 4, padding: "2px 6px", color: "#7a96b0", fontSize: 10, cursor: "pointer" }}
                  >
                    ✏ Edit
                  </button>
                )}
                <button
                  onClick={() => deleteMessage(m.id)}
                  title="Delete this message"
                  style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 4, padding: "2px 6px", color: "#7a96b0", fontSize: 10, cursor: "pointer" }}
                >
                  ✕ Delete
                </button>
              </div>
            )}
          </div>
        ))}
        {error && (
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "#e57373" }}>{error}</p>
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about this case… (Ctrl/Cmd+Enter to send)"
          disabled={isStreaming}
          rows={3}
          style={{
            width: "100%",
            boxSizing: "border-box",
            resize: "vertical",
            minHeight: 64,
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
            alignSelf: "flex-end",
            background: YELLOW,
            color: NAVY,
            border: "none",
            borderRadius: 8,
            fontFamily: "'Poppins', sans-serif",
            fontWeight: 700,
            fontSize: 12,
            padding: "8px 20px",
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
