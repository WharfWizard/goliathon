import { useEffect, useState } from "react";
import { getOwnKey, isRemembered, setOwnKey, clearOwnKey } from "../lib/userKey";

// "Use your own Anthropic key" panel for Goliathon.
// - A small status chip (bottom-left) shows which allowance is in use and
//   opens the panel.
// - The panel also opens by itself when the server reports that the shared
//   allowance is used up, or that the member's own key has a problem.

// Adjust once real per-document costs are known from the usage logs.
const BIG_JOB_DOCS = 20;

const NAVY = "#00274d", YELLOW = "#ffc72c", WHITE = "#ffffff", PANEL = "#002a57",
      BORDER = "#003a6e", LIGHT = "#e8eef4", MUTED = "#a0b4c8", GREEN = "#4ade80", RED = "#f87171";

export default function OwnKeyPanel() {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(null);      // why the panel opened
  const [hasKey, setHasKey] = useState(!!getOwnKey());
  const [draft, setDraft] = useState("");
  const [remember, setRemember] = useState(false);
  const [status, setStatus] = useState(null);      // {ok, text}
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const onOpen = (e) => { setNotice(e.detail?.message || null); setStatus(null); setOpen(true); };
    const onChange = () => setHasKey(!!getOwnKey());
    window.addEventListener("goliathon:open-own-key", onOpen);
    window.addEventListener("goliathon:key-changed", onChange);
    return () => {
      window.removeEventListener("goliathon:open-own-key", onOpen);
      window.removeEventListener("goliathon:key-changed", onChange);
    };
  }, []);

  async function testAndSave() {
    const k = draft.trim();
    if (!k) { setStatus({ ok: false, text: "Please paste your key first." }); return; }
    setChecking(true); setStatus(null);
    try {
      const r = await fetch("/api/check-key", { method: "POST", headers: { "x-goliathon-user-key": k } });
      const d = await r.json().catch(() => ({}));
      if (d.ok) {
        setOwnKey(k, remember);
        setDraft("");
        setNotice(null);
        setStatus({ ok: true, text: "Your key works. Goliathon will now use it for AI processing in this browser." });
      } else {
        setStatus({ ok: false, text: d.error || "That key didn't work. Please check it and try again." });
      }
    } catch (_) {
      setStatus({ ok: false, text: "Couldn't check the key just now. Please try again in a moment." });
    }
    setChecking(false);
  }

  function forget() {
    clearOwnKey();
    setStatus({ ok: true, text: "Your key has been removed from this browser. Goliathon will use the shared allowance again." });
  }

  const p = { fontSize: 14, lineHeight: 1.65, color: LIGHT, margin: "0 0 12px" };
  const h = { fontFamily: "'Poppins', sans-serif", color: WHITE, fontSize: 15, fontWeight: 600, margin: "18px 0 8px" };
  const btn = { fontFamily: "'Poppins', sans-serif", fontWeight: 600, fontSize: 14, borderRadius: 8, padding: "10px 16px", cursor: "pointer", border: "none" };

  return (
    <>
      <button
        onClick={() => { setNotice(null); setStatus(null); setOpen(true); }}
        title="Choose how Goliathon's AI processing is paid for"
        style={{ position: "fixed", left: 16, bottom: 16, zIndex: 900, background: PANEL, color: LIGHT,
                 border: `1px solid ${BORDER}`, borderRadius: 999, padding: "8px 14px", fontSize: 12,
                 fontFamily: "'Poppins', sans-serif", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: hasKey ? GREEN : YELLOW }} />
        {hasKey ? "AI: your own key" : "AI: shared allowance"}
      </button>

      {open && (
        <div role="dialog" aria-modal="true" aria-labelledby="own-key-title"
             style={{ position: "fixed", inset: 0, background: "#000000cc", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}
             onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div style={{ background: NAVY, border: `1px solid ${BORDER}`, borderRadius: 14, maxWidth: 560, width: "100%",
                        maxHeight: "90vh", overflowY: "auto", padding: "22px 24px", fontFamily: "'Open Sans', sans-serif" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h2 id="own-key-title" style={{ fontFamily: "'Poppins', sans-serif", color: YELLOW, fontSize: 19, margin: 0 }}>
                Your AI allowance
              </h2>
              <button onClick={() => setOpen(false)} aria-label="Close"
                      style={{ background: "none", border: "none", color: MUTED, fontSize: 22, cursor: "pointer" }}>×</button>
            </div>

            {notice && (
              <div style={{ background: "#3a2a00", border: `1px solid ${YELLOW}60`, borderRadius: 10, padding: "10px 14px", margin: "8px 0 14px" }}>
                <p style={{ ...p, margin: 0 }}>{notice}</p>
              </div>
            )}

            <p style={p}>
              Goliathon runs on a <strong style={{ color: WHITE }}>shared monthly AI allowance</strong> that every member draws on.
              Everyday use is covered: adding documents as they arrive, and asking questions about your case.
            </p>
            <p style={p}>
              <strong style={{ color: WHITE }}>Planning a big job?</strong> If you're adding more than about {BIG_JOB_DOCS} documents at once,
              or a very long chronology, please use your own Anthropic key. It keeps the shared allowance available for
              everyone, and you only pay Anthropic for what you use. We trust you to make that call.
            </p>

            <h3 style={h}>{hasKey ? "Your key is active" : "Use your own key"}</h3>

            {hasKey ? (
              <>
                <p style={p}>
                  Goliathon is using your own Anthropic key in this browser{isRemembered() ? ", and will remember it on this device" : " until you close this tab"}.
                  Chat isn't subject to the daily shared-allowance limit while your key is active.
                </p>
                <button onClick={forget} style={{ ...btn, background: "transparent", color: LIGHT, border: `1px solid ${BORDER}` }}>
                  Forget my key
                </button>
              </>
            ) : (
              <>
                <label htmlFor="own-key-input" style={{ ...p, display: "block", marginBottom: 6 }}>Paste your Anthropic API key</label>
                <input id="own-key-input" type="password" autoComplete="off" spellCheck={false}
                       value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="sk-ant-..."
                       style={{ width: "100%", background: "#001e3d", color: WHITE, border: `1px solid ${BORDER}`, borderRadius: 8,
                                padding: "10px 12px", fontSize: 14, fontFamily: "monospace", marginBottom: 10 }} />
                <label style={{ ...p, display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  Remember on this device (leave unticked on a shared or public computer)
                </label>
                <button onClick={testAndSave} disabled={checking}
                        style={{ ...btn, background: YELLOW, color: NAVY, opacity: checking ? 0.6 : 1 }}>
                  {checking ? "Checking..." : "Check and use this key"}
                </button>
              </>
            )}

            {status && (
              <p style={{ ...p, marginTop: 12, color: status.ok ? GREEN : RED }}>{status.text}</p>
            )}

            <h3 style={h}>How your key is handled</h3>
            <p style={p}>
              Your key stays in this browser. It's sent securely to Goliathon's server with each AI request, used for that
              request only, and never stored or written to our logs. You can switch it off here at any time, and you can
              delete the key itself in your Anthropic Console whenever you like.
            </p>

            <h3 style={h}>How to get a key</h3>
            <ol style={{ ...p, paddingLeft: 20 }}>
              <li>Go to <a href="https://platform.claude.com" target="_blank" rel="noopener noreferrer" style={{ color: YELLOW }}>platform.claude.com</a> and create an account (or sign in).</li>
              <li>Add a small amount of credit in Billing. Start small, for example £10.</li>
              <li><strong style={{ color: WHITE }}>Set a monthly spend limit</strong> so you're protected from surprises.</li>
              <li>Open API keys, click Create key, and copy the key.</li>
              <li>Paste it above. When your big job is finished, you can come back and press Forget my key.</li>
            </ol>
            <p style={{ ...p, fontSize: 12, color: MUTED }}>
              Anthropic is the company that makes Claude, the AI behind Goliathon. Your Anthropic account and its charges are
              between you and Anthropic.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
