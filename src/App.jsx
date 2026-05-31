import { useState, useRef, useCallback, useEffect } from "react";

// ── FONTS ────────────────────────────────────────────────────────────────────
if (!document.getElementById("goliathon-fonts")) {
  const link = document.createElement("link");
  link.id = "goliathon-fonts";
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&family=Open+Sans:wght@400;500;600&display=swap";
  document.head.appendChild(link);
}

// ── CONSTANTS ────────────────────────────────────────────────────────────────
const NAVY = "#00274d";
const YELLOW = "#ffc72c";
const WHITE = "#ffffff";
const GREY = "#555555";
const PANEL = "#002a57";
const BORDER = "#003a6e";
const LIGHT = "#e8eef4";

const SYSTEM = `You are the Goliathon AI — created by Steve Conley, Founder of Get SAFE (Support After Financial Exploitation) and the Academy of Life Planning.

Goliathon automatically builds a professional evidence dossier for survivors of financial exploitation. Your role is to analyse every piece of evidence uploaded and extract structured information to build the dossier.

Core values: dignity, precision, clarity, empowerment. Never give legal, financial, or mental-health advice. Always recommend qualified professionals where appropriate. Write in plain English. Be warm, calm, and strategic.

When analysing evidence, always extract:
- What type of document this is
- Key facts, dates, names, and amounts
- What it proves or suggests
- Any red flags (evasion, contradictions, omissions)
- Regulatory implications
- How it updates the overall case narrative`;

// ── HELPERS ──────────────────────────────────────────────────────────────────
function generateShareId() {
  return Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

async function callClaude(messages, systemOverride) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      system: systemOverride || SYSTEM,
      messages,
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function saveDossier(dossier, isUpdate) {
  // Always try PUT first if we think it's saved, fall back to POST
  if (isUpdate) {
    const res = await fetch("/api/dossier", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dossier),
    });
    const data = await res.json();
    if (!data.error) return data;
  }
  // POST to create new record
  const res = await fetch("/api/dossier", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dossier),
  });
  return res.json();
}

async function loadDossier(shareId) {
  const res = await fetch(`/api/dossier?share_id=${shareId}`);
  if (!res.ok) return null;
  return res.json();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── IMAGE COMPRESSION ────────────────────────────────────────────────────────
function compressImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxSize = 1600;
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width > height) { height = (height / width) * maxSize; width = maxSize; }
          else { width = (width / height) * maxSize; height = maxSize; }
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL("image/jpeg", 0.75).split(",")[1];
        resolve(compressed);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── DOWNLOAD HELPERS ─────────────────────────────────────────────────────────
function downloadText(filename, content) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function buildFullDossierText(dossier) {
  const lines = [
    `GOLIATHON EVIDENCE DOSSIER`,
    `Get SAFE (Support After Financial Exploitation)`,
    `Generated: ${formatDate(new Date().toISOString())}`,
    ``,
    `═══════════════════════════════════════════`,
    `CASE OVERVIEW`,
    `═══════════════════════════════════════════`,
    dossier.overview || "",
    ``,
    `═══════════════════════════════════════════`,
    `CHRONOLOGICAL TIMELINE`,
    `═══════════════════════════════════════════`,
    ...(dossier.timeline || []).map((t, i) => `${i + 1}. [${t.date || "Date unknown"}] ${t.event}\n   Evidence: ${t.evidence || "See library"}`),
    ``,
    `═══════════════════════════════════════════`,
    `WITNESS STATEMENT`,
    `═══════════════════════════════════════════`,
    dossier.witness_statement || "",
    ``,
    `═══════════════════════════════════════════`,
    `EVIDENCE LIBRARY (${(dossier.evidence || []).length} items)`,
    `═══════════════════════════════════════════`,
    ...(dossier.evidence || []).map((e, i) => [
      ``,
      `[${String(i + 1).padStart(3, "0")}] ${e.title}`,
      `Date: ${e.date || "Unknown"} | Type: ${e.type || "Document"}`,
      `Summary: ${e.summary}`,
      e.red_flags ? `Red Flags: ${e.red_flags}` : "",
    ].filter(Boolean).join("\n")),
    ``,
    `═══════════════════════════════════════════`,
    `NEXT STEPS`,
    `═══════════════════════════════════════════`,
    dossier.next_steps || "",
    ``,
    `─────────────────────────────────────────`,
    `Goliathon · Get SAFE · www.get-safe.org.uk`,
    `Educational use only. Not legal advice.`,
  ];
  return lines.join("\n");
}

// ── UI COMPONENTS ─────────────────────────────────────────────────────────────

function Spinner({ small = false }) {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{ width: small ? 5 : 7, height: small ? 5 : 7, background: YELLOW, borderRadius: "50%", display: "inline-block", animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
      ))}
    </span>
  );
}

function Btn({ children, onClick, disabled, variant = "primary", small = false, fullWidth = false }) {
  const base = { borderRadius: 8, fontFamily: "'Poppins', sans-serif", fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1, transition: "all 0.2s", border: "none", letterSpacing: 0.5, display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" };
  const variants = {
    primary: { background: YELLOW, color: NAVY, padding: small ? "7px 16px" : "11px 24px", fontSize: small ? 12 : 13 },
    ghost: { background: "transparent", color: YELLOW, border: `1px solid ${YELLOW}50`, padding: small ? "6px 14px" : "10px 22px", fontSize: small ? 11 : 13 },
    subtle: { background: PANEL, color: LIGHT, border: `1px solid ${BORDER}`, padding: small ? "6px 14px" : "10px 22px", fontSize: small ? 11 : 13 },
    danger: { background: "#c0392b20", color: "#e57373", border: "1px solid #e5737340", padding: small ? "6px 14px" : "10px 22px", fontSize: small ? 11 : 13 },
  };
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant], width: fullWidth ? "100%" : "auto" }}>{children}</button>;
}

function Panel({ title, icon, children, action }) {
  return (
    <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: `1px solid ${BORDER}`, background: "#001e3d" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>{icon}</span>
          <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 14, color: WHITE }}>{title}</span>
        </div>
        {action}
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </div>
  );
}

function EmptyState({ text }) {
  return <p style={{ color: "#5a7a96", fontSize: 13, fontStyle: "italic", margin: 0 }}>{text}</p>;
}

function Tag({ children, color = YELLOW }) {
  return <span style={{ background: color + "20", color, border: `1px solid ${color}40`, borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 600, fontFamily: "'Poppins', sans-serif" }}>{children}</span>;
}

// ── SHARE MODAL ───────────────────────────────────────────────────────────────

function ShareModal({ shareId, onClose }) {
  const url = `${window.location.origin}/dossier/${shareId}`;
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000cc", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 36, maxWidth: 480, width: "90%", boxShadow: "0 24px 80px #00000080" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔗</div>
          <h3 style={{ margin: 0, fontFamily: "'Poppins', sans-serif", color: WHITE, fontSize: 20, fontWeight: 700 }}>Share Your Dossier</h3>
          <p style={{ color: "#7a96b0", fontSize: 13, margin: "8px 0 0", lineHeight: 1.6 }}>Anyone with this link can view your dossier in read-only mode. Only share with people you trust.</p>
        </div>
        <div style={{ background: "#001e3d", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "12px 16px", marginBottom: 16, wordBreak: "break-all", fontSize: 13, color: YELLOW, fontFamily: "monospace" }}>{url}</div>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn onClick={copy} fullWidth>{copied ? "✓ Copied!" : "Copy Link"}</Btn>
          <Btn variant="subtle" onClick={onClose}>Close</Btn>
        </div>
        <p style={{ margin: "16px 0 0", fontSize: 11, color: "#5a7a96", textAlign: "center" }}>This link always shows the latest version of your dossier.</p>
      </div>
    </div>
  );
}

// ── DOWNLOAD MODAL ────────────────────────────────────────────────────────────

function DownloadModal({ dossier, onClose }) {
  const slug = (dossier.case_title || "dossier").replace(/[^a-z0-9]/gi, "_");

  const options = [
    { label: "Complete Dossier", desc: "All sections — overview, timeline, statement, evidence, next steps", icon: "📁", action: () => downloadText(`${slug}_Complete_Dossier.txt`, buildFullDossierText(dossier)) },
    { label: "Case Overview", desc: "The case summary and context", icon: "📋", action: () => downloadText(`${slug}_Overview.txt`, dossier.overview || "") },
    { label: "Timeline", desc: "Chronological sequence of all events", icon: "📅", action: () => downloadText(`${slug}_Timeline.txt`, (dossier.timeline || []).map((t, i) => `${i + 1}. [${t.date || "Unknown"}] ${t.event}`).join("\n")) },
    { label: "Witness Statement", desc: "First-person account", icon: "📝", action: () => downloadText(`${slug}_Witness_Statement.txt`, dossier.witness_statement || "") },
    { label: "Evidence Library", desc: "All evidence items with cover notes", icon: "🗂️", action: () => downloadText(`${slug}_Evidence_Library.txt`, (dossier.evidence || []).map((e, i) => `[${String(i + 1).padStart(3, "0")}] ${e.title}\n${e.summary}\n`).join("\n")) },
    { label: "Next Steps", desc: "Priority actions and recommendations", icon: "📌", action: () => downloadText(`${slug}_Next_Steps.txt`, dossier.next_steps || "") },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000cc", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 36, maxWidth: 520, width: "90%", boxShadow: "0 24px 80px #00000080", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <h3 style={{ margin: 0, fontFamily: "'Poppins', sans-serif", color: WHITE, fontSize: 20, fontWeight: 700 }}>Download Dossier</h3>
          <Btn variant="subtle" small onClick={onClose}>✕</Btn>
        </div>
        {options.map((o, i) => (
          <div key={i} onClick={o.action} style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 16px", background: "#001e3d", border: `1px solid ${BORDER}`, borderRadius: 10, marginBottom: 10, cursor: "pointer", transition: "all 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = YELLOW + "60"}
            onMouseLeave={e => e.currentTarget.style.borderColor = BORDER}>
            <span style={{ fontSize: 24, flexShrink: 0 }}>{o.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, color: WHITE, fontSize: 14, marginBottom: 2 }}>{o.label}</div>
              <div style={{ fontSize: 12, color: "#7a96b0" }}>{o.desc}</div>
            </div>
            <span style={{ color: YELLOW, fontSize: 18 }}>↓</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── READ-ONLY DOSSIER VIEW ────────────────────────────────────────────────────

function ReadOnlyDossier({ dossier }) {
  const [showDownload, setShowDownload] = useState(false);

  return (
    <div style={{ fontFamily: "'Open Sans', sans-serif", background: NAVY, minHeight: "100vh", color: LIGHT }}>
      <div style={{ background: NAVY, borderBottom: `3px solid ${YELLOW}`, padding: "20px 32px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", alignItems: "center", gap: 16 }}>
          <img src="/getsafe-logo.png" alt="Get SAFE" style={{ width: 52, height: 52, objectFit: "contain" }} />
          <div>
            <div style={{ fontSize: 10, letterSpacing: 3, color: YELLOW, textTransform: "uppercase", fontFamily: "'Poppins', sans-serif" }}>Get SAFE · Goliathon Evidence Dossier</div>
            <h1 style={{ margin: 0, fontFamily: "'Poppins', sans-serif", fontSize: 22, fontWeight: 800, color: WHITE }}>{dossier.case_title || "Evidence Dossier"}</h1>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            <Tag>Read Only</Tag>
            <Btn small onClick={() => setShowDownload(true)}>↓ Download</Btn>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px" }}>
        <Panel title="Case Overview" icon="📋">
          {dossier.overview ? <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8, color: LIGHT }}>{dossier.overview}</p> : <EmptyState text="No overview yet." />}
        </Panel>

        <Panel title="Timeline" icon="📅">
          {(dossier.timeline || []).length === 0 ? <EmptyState text="No timeline entries yet." /> :
            (dossier.timeline || []).map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 16, marginBottom: 16, paddingBottom: 16, borderBottom: i < dossier.timeline.length - 1 ? `1px solid ${BORDER}` : "none" }}>
                <div style={{ width: 36, height: 36, background: YELLOW, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 12, color: NAVY, flexShrink: 0 }}>{i + 1}</div>
                <div>
                  <div style={{ fontSize: 11, color: YELLOW, fontWeight: 600, marginBottom: 3 }}>{t.date || "Date unknown"}</div>
                  <div style={{ fontSize: 14, color: LIGHT, lineHeight: 1.6 }}>{t.event}</div>
                  {t.evidence && <div style={{ fontSize: 12, color: "#7a96b0", marginTop: 4 }}>Evidence: {t.evidence}</div>}
                </div>
              </div>
            ))}
        </Panel>

        <Panel title="Witness Statement" icon="📝">
          {dossier.witness_statement ? <p style={{ margin: 0, fontSize: 14, lineHeight: 1.9, color: LIGHT, whiteSpace: "pre-wrap" }}>{dossier.witness_statement}</p> : <EmptyState text="No witness statement yet." />}
        </Panel>

        <Panel title={`Evidence Library — ${(dossier.evidence || []).length} items`} icon="🗂️">
          {(dossier.evidence || []).length === 0 ? <EmptyState text="No evidence uploaded yet." /> :
            (dossier.evidence || []).map((e, i) => (
              <div key={i} style={{ background: "#001e3d", border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16, marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 11, color: YELLOW }}>#{String(i + 1).padStart(3, "0")}</span>
                    <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 14, color: WHITE }}>{e.title}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    {e.date && <Tag>{e.date}</Tag>}
                    {e.type && <Tag color="#7a96b0">{e.type}</Tag>}
                  </div>
                </div>
                <p style={{ margin: "0 0 8px", fontSize: 13, color: LIGHT, lineHeight: 1.7 }}>{e.summary}</p>
                {e.red_flags && <p style={{ margin: 0, fontSize: 12, color: "#e57373", lineHeight: 1.6 }}>⚠ {e.red_flags}</p>}
              </div>
            ))}
        </Panel>

        <Panel title="Next Steps" icon="📌">
          {dossier.next_steps ? <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8, color: LIGHT, whiteSpace: "pre-wrap" }}>{dossier.next_steps}</p> : <EmptyState text="No next steps yet." />}
        </Panel>
      </div>

      {showDownload && <DownloadModal dossier={dossier} onClose={() => setShowDownload(false)} />}
      <style>{`@keyframes pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────

export default function GoliathonApp() {
  const [dossier, setDossier] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [processingMsg, setProcessingMsg] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [showUrl, setShowUrl] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showDownload, setShowDownload] = useState(false);
  const [shareId] = useState(() => generateShareId());
  const [saved, setSaved] = useState(false);
  const isSavedRef = useRef(false);
  const [readOnly, setReadOnly] = useState(false);
  const [readOnlyDossier, setReadOnlyDossier] = useState(null);
  const fileRef = useRef(null);
  const restoreRef = useRef(null);
  const cameraRef = useRef(null);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraPages, setCameraPages] = useState([]);
  const [cameraProcessing, setCameraProcessing] = useState(false);

  const handleSaveLocal = useCallback(() => {
    if (!dossier) return;
    const session = { version: 2, savedAt: new Date().toISOString(), shareId, dossier };
    const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const slug = (dossier.case_title || "session").replace(/[^a-z0-9]/gi, "_");
    a.href = url;
    a.download = `Goliathon_${slug}_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [dossier, shareId]);

  const handleRestoreLocal = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const session = JSON.parse(ev.target.result);
        if (session.dossier) {
          setDossier(session.dossier);
          setSaved(true);
        }
      } catch {
        alert("Could not restore session. Please check the file is a valid Goliathon save.");
      }
    };
    reader.readAsText(file);
  }, []);

  const handleReset = useCallback(() => {
    if (window.confirm("Are you sure you want to reset? This will clear your current dossier. Make sure you have saved first.")) {
      setDossier(null);
      setSaved(false);
      isSavedRef.current = false;
    }
  }, []);

  // Check if this is a shared dossier link
  useEffect(() => {
    const path = window.location.pathname;
    const match = path.match(/\/dossier\/([a-z0-9]+)/i);
    if (match) {
      setReadOnly(true);
      loadDossier(match[1]).then(data => {
        if (data) setReadOnlyDossier(data);
      });
    }
  }, []);

  const updateDossier = useCallback(async (newDossier) => {
    setDossier(newDossier);
    setSaved(false);
    try {
      const payload = { ...newDossier, share_id: shareId };
      await saveDossier(payload, isSavedRef.current);
      isSavedRef.current = true;
      setSaved(true);
    } catch (e) {
      console.error("Save error:", e);
    }
  }, [shareId]);

  const processEvidence = useCallback(async (content, filename, mediaType, isUrl = false) => {
    setProcessing(true);
    setProcessingMsg(`Reading ${filename}…`);

    try {
      const isImage = mediaType && mediaType.startsWith("image/");
      const isPdf = mediaType === "application/pdf";

      // Build message for Claude
      let userMessage;
      if (isImage) {
        userMessage = {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: content } },
            { type: "text", text: `Analyse this uploaded image as evidence. Filename: ${filename}` },
          ],
        };
      } else if (isPdf) {
        userMessage = {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: content } },
            { type: "text", text: `Analyse this uploaded document as evidence. Filename: ${filename}` },
          ],
        };
      } else {
        userMessage = {
          role: "user",
          content: `Analyse this evidence. ${isUrl ? "Source URL: " + filename : "Filename: " + filename}\n\nContent:\n${content}`,
        };
      }

      const existing = dossier 
        ? `\n\nExisting case context:\nTitle: ${dossier.case_title || "Unknown"}\nOverview: ${(dossier.overview || "").substring(0, 600)}\nTimeline so far: ${(dossier.timeline || []).map(t => `[${t.date}] ${t.event}`).join("; ").substring(0, 400)}\nWitness statement so far: ${(dossier.witness_statement || "").substring(0, 400)}\nEvidence already filed (${(dossier.evidence || []).length} items): ${(dossier.evidence || []).map(e => e.title).join(", ")}\nNext steps so far: ${(typeof dossier.next_steps === 'string' ? dossier.next_steps : Array.isArray(dossier.next_steps) ? dossier.next_steps.join('\\n') : '').substring(0, 200)}`
        : "\n\nThis is the FIRST piece of evidence — use it to establish the case title, parties, and initial overview.";

      setProcessingMsg("Analysing evidence…");

      const prompt = `${existing}

Analyse this evidence and return ONLY valid JSON with no preamble or markdown:
{
  "case_title": "short case title e.g. 'Smith v Lloyds Bank — Pension Mis-selling' (derive from evidence if first upload, or keep existing)",
  "evidence_item": {
    "title": "descriptive title for this document",
    "date": "date of document in DD Mon YYYY format or null",
    "type": "Letter / Email / Statement / Report / Photo / Web Page / Other",
    "summary": "2-3 sentence summary of what this document contains and its significance",
    "red_flags": "any concerning phrases, omissions, or evasions — or null if none"
  },
  "timeline_entry": {
    "date": "date this event occurred in DD Mon YYYY format or null",
    "event": "one sentence describing what happened",
    "evidence": "reference to this document"
  },
  "overview_update": "updated 3-4 sentence case overview incorporating this new evidence (rewrite the whole overview)",
  "witness_update": "add one or two sentences to the witness statement in first person reflecting this evidence (write only the new sentences to add, not the full statement)",
  "next_steps_update": "updated numbered list of 3-5 priority next steps given all evidence so far"
}`;

      const response = await callClaude([{ ...userMessage, content: typeof userMessage.content === "string" ? userMessage.content + prompt : [...(Array.isArray(userMessage.content) ? userMessage.content : [userMessage.content]), { type: "text", text: prompt }] }]);

      let parsed;
      try {
        const clean = response.replace(/```json|```/g, "").trim();
        parsed = JSON.parse(clean);
      } catch {
        throw new Error("Could not parse AI response");
      }

      setProcessingMsg("Updating dossier…");

      const current = dossier || { evidence: [], timeline: [], witness_statement: "", overview: "", next_steps: "" };
      const newEvidence = [...(current.evidence || []), parsed.evidence_item];
      const newTimeline = [...(current.timeline || [])];

      if (parsed.timeline_entry && parsed.timeline_entry.event) {
        newTimeline.push(parsed.timeline_entry);
        // Sort by date
        newTimeline.sort((a, b) => {
          if (!a.date) return 1;
          if (!b.date) return -1;
          return new Date(a.date) - new Date(b.date);
        });
      }

      const newWitness = current.witness_statement
        ? current.witness_statement + "\n\n" + (parsed.witness_update || "")
        : parsed.witness_update || "";

      const newDossier = {
        ...current,
        case_title: parsed.case_title || current.case_title,
        overview: parsed.overview_update || current.overview,
        timeline: newTimeline,
        witness_statement: newWitness,
        next_steps: typeof parsed.next_steps_update === 'string' ? parsed.next_steps_update : Array.isArray(parsed.next_steps_update) ? parsed.next_steps_update.map((s,i) => `${i+1}. ${s}`).join('\n') : (typeof current.next_steps === 'string' ? current.next_steps : ''),
        evidence: newEvidence,
        _saved: !!current._saved,
      };

      await updateDossier(newDossier);

    } catch (e) {
      alert("Something went wrong processing this file. Please try again.\n\n" + e.message);
    }

    setProcessing(false);
    setProcessingMsg("");
  }, [dossier, updateDossier]);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf", "text/plain"];
    if (!allowed.includes(file.type)) {
      alert("Please upload an image (JPG/PNG), PDF, or TXT file.");
      return;
    }
    const base64 = await fileToBase64(file);
    await processEvidence(base64, file.name, file.type);
  }, [processEvidence]);

  const handleUrl = useCallback(async () => {
    if (!urlInput.trim()) return;
    setShowUrl(false);
    setProcessing(true);
    setProcessingMsg("Fetching URL…");
    try {
      const res = await fetch("/api/fetch-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput.trim() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await processEvidence(data.text, urlInput.trim(), "text/plain", true);
    } catch (e) {
      alert("Could not fetch URL: " + e.message);
      setProcessing(false);
      setProcessingMsg("");
    }
    setUrlInput("");
  }, [urlInput, processEvidence]);

  // Camera scan handlers
  const handleCameraCapture = useCallback(async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const newPages = [];
    for (const file of files) {
      const compressed = await compressImage(file);
      newPages.push({ data: compressed, name: file.name, preview: URL.createObjectURL(file) });
    }
    setCameraPages(prev => [...prev, ...newPages]);
  }, []);

  const handleCameraSubmit = useCallback(async () => {
    if (!cameraPages.length) return;
    setCameraProcessing(true);
    setShowCamera(false);
    setProcessing(true);
    setProcessingMsg(`Processing ${cameraPages.length} page${cameraPages.length > 1 ? "s" : ""}…`);

    try {
      // Build multi-image message for Claude
      const imageContent = cameraPages.map(page => ({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: page.data }
      }));
      imageContent.push({ type: "text", text: "These are photographed pages of a physical document being added as evidence. Please analyse all pages together as a single document." });

      const existing = dossier 
        ? `

Existing case context:
Title: ${dossier.case_title || "Unknown"}
Overview: ${(dossier.overview || "").substring(0, 600)}
Evidence already filed (${(dossier.evidence || []).length} items): ${(dossier.evidence || []).map(e => e.title).join(", ")}`
        : `

This is the FIRST piece of evidence — use it to establish the case title, parties, and initial overview.`;

      const prompt = `${existing}

Analyse this photographed document (${cameraPages.length} page${cameraPages.length > 1 ? "s" : ""}) and return ONLY valid JSON with no preamble or markdown:
{
  "case_title": "short case title",
  "evidence_item": {
    "title": "descriptive title for this document",
    "date": "date of document in DD Mon YYYY format or null",
    "type": "Letter / Court Document / Medical / Financial / Other",
    "summary": "2-3 sentence summary of what this document contains and its significance",
    "red_flags": "any concerning phrases, omissions, or evasions — or null if none"
  },
  "timeline_entry": {
    "date": "date this event occurred in DD Mon YYYY format or null",
    "event": "one sentence describing what happened",
    "evidence": "reference to this document"
  },
  "overview_update": "updated 3-4 sentence case overview incorporating this new evidence",
  "witness_update": "add one or two sentences to the witness statement in first person reflecting this evidence",
  "next_steps_update": "updated numbered list of 3-5 priority next steps given all evidence so far"
}`;

      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          system: SYSTEM,
          messages: [{ role: "user", content: [...imageContent, { type: "text", text: prompt }] }],
        }),
      });
      const data = await res.json();
      const response = data.content?.[0]?.text || "";

      let parsed;
      try { parsed = JSON.parse(response.replace(/```json|```/g, "").trim()); }
      catch { throw new Error("Could not parse AI response"); }

      setProcessingMsg("Updating dossier…");
      const current = dossier || { evidence: [], timeline: [], witness_statement: "", overview: "", next_steps: "" };
      const newEvidence = [...(current.evidence || []), parsed.evidence_item];
      const newTimeline = [...(current.timeline || [])];
      if (parsed.timeline_entry?.event) {
        newTimeline.push(parsed.timeline_entry);
        newTimeline.sort((a, b) => { if (!a.date) return 1; if (!b.date) return -1; return new Date(a.date) - new Date(b.date); });
      }
      const newWitness = current.witness_statement ? current.witness_statement + "

" + (parsed.witness_update || "") : parsed.witness_update || "";
      const newDossier = {
        ...current,
        case_title: parsed.case_title || current.case_title,
        overview: parsed.overview_update || current.overview,
        timeline: newTimeline,
        witness_statement: newWitness,
        next_steps: typeof parsed.next_steps_update === 'string' ? parsed.next_steps_update : Array.isArray(parsed.next_steps_update) ? parsed.next_steps_update.map((s,i) => `${i+1}. ${s}`).join('
') : current.next_steps,
        evidence: newEvidence,
      };
      await updateDossier(newDossier);
    } catch (e) {
      alert("Something went wrong processing the camera scan. Please try again.

" + e.message);
    }

    // Cleanup
    cameraPages.forEach(p => URL.revokeObjectURL(p.preview));
    setCameraPages([]);
    setCameraProcessing(false);
    setProcessing(false);
    setProcessingMsg("");
  }, [cameraPages, dossier, updateDossier]);

  // Read-only view
  if (readOnly) {
    if (!readOnlyDossier) return (
      <div style={{ fontFamily: "'Open Sans', sans-serif", background: NAVY, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: LIGHT }}>
        <div style={{ textAlign: "center" }}><Spinner /><p style={{ marginTop: 16, color: "#7a96b0" }}>Loading dossier…</p></div>
      </div>
    );
    return <ReadOnlyDossier dossier={readOnlyDossier} />;
  }

  const evidenceCount = dossier?.evidence?.length || 0;

  return (
    <div style={{ fontFamily: "'Open Sans', sans-serif", background: NAVY, minHeight: "100vh", width: "100%", color: LIGHT }}>

      {/* Header */}
      <div style={{ background: NAVY, borderBottom: `3px solid ${YELLOW}`, padding: "16px 32px 0" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
            <img src="/getsafe-logo.png" alt="Get SAFE" style={{ width: 56, height: 56, objectFit: "contain", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 10, letterSpacing: 4, color: YELLOW, textTransform: "uppercase", fontFamily: "'Poppins', sans-serif", marginBottom: 2 }}>Get SAFE · Academy of Life Planning</div>
              <h1 style={{ margin: 0, fontFamily: "'Poppins', sans-serif", fontSize: 28, fontWeight: 800, color: WHITE, letterSpacing: "-0.5px" }}>GOLIATHON</h1>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                {dossier && saved && <Tag color="#7e9e82">✓ Saved</Tag>}
                <Btn small variant="subtle" onClick={handleSaveLocal}>💾 Save</Btn>
                <label style={{ cursor: "pointer" }}>
                  <Btn small variant="subtle" onClick={() => restoreRef.current?.click()}>📂 Restore</Btn>
                  <input ref={restoreRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleRestoreLocal} />
                </label>
                {dossier && <Btn small variant="subtle" onClick={handleReset}>↺ Reset</Btn>}
                {dossier && <Btn small variant="ghost" onClick={() => setShowShare(true)}>🔗 Share</Btn>}
                {dossier && <Btn small onClick={() => setShowDownload(true)}>↓ Download</Btn>}
              </div>
          </div>
        </div>
      </div>

      {/* Main */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px" }}>

        {/* Upload Zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
          onClick={() => !processing && fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? YELLOW : processing ? YELLOW + "60" : BORDER}`,
            borderRadius: 16,
            padding: "40px 32px",
            textAlign: "center",
            cursor: processing ? "not-allowed" : "pointer",
            background: dragOver ? "#001e3d" : processing ? "#001830" : "transparent",
            transition: "all 0.2s",
            marginBottom: 24,
            position: "relative",
          }}
        >
          {processing ? (
            <div>
              <div style={{ marginBottom: 16 }}><Spinner /></div>
              <p style={{ margin: 0, fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 16, color: YELLOW }}>{processingMsg}</p>
              <p style={{ margin: "8px 0 0", fontSize: 13, color: "#7a96b0" }}>Goliathon is building your dossier…</p>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 48, marginBottom: 12 }}>
                {evidenceCount === 0 ? "⚖️" : "➕"}
              </div>
              <p style={{ margin: "0 0 6px", fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 18, color: WHITE }}>
                {evidenceCount === 0 ? "Upload your first piece of evidence to begin" : "Upload your next piece of evidence"}
              </p>
              <p style={{ margin: "0 0 20px", fontSize: 14, color: "#7a96b0" }}>
                {evidenceCount === 0
                  ? "Drop a photo, PDF, or document here — Goliathon will build your case automatically"
                  : `${evidenceCount} item${evidenceCount !== 1 ? "s" : ""} in your dossier — keep adding to build your case`}
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <Btn small>📎 Upload File</Btn>
                <Btn small variant="subtle" onClick={e => { e.stopPropagation(); setShowCamera(true); setCameraPages([]); }}>📷 Camera Scan</Btn>
                <Btn small variant="subtle" onClick={e => { e.stopPropagation(); setShowUrl(true); }}>🔗 Add URL</Btn>
              </div>
              <p style={{ margin: "16px 0 0", fontSize: 12, color: "#5a7a96" }}>Accepts photos (JPG/PNG), PDFs, text files, or camera scan</p>
            </div>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*,.pdf,.txt" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple style={{ display: "none" }} onChange={handleCameraCapture} />

        {/* URL Input */}
        {showUrl && (
          <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20, marginBottom: 24 }}>
            <p style={{ margin: "0 0 12px", fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 14, color: WHITE }}>Add a URL as evidence</p>
            <div style={{ display: "flex", gap: 10 }}>
              <input value={urlInput} onChange={e => setUrlInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleUrl()} placeholder="https://www.example.com/relevant-page" style={{ flex: 1, background: "#001e3d", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 16px", color: WHITE, fontSize: 14, outline: "none", fontFamily: "'Open Sans', sans-serif" }} />
              <Btn onClick={handleUrl} disabled={!urlInput.trim()}>Add</Btn>
              <Btn variant="subtle" onClick={() => setShowUrl(false)}>Cancel</Btn>
            </div>
          </div>
        )}

        {/* Dossier */}
        {!dossier && !processing && (
          <div style={{ textAlign: "center", padding: "60px 32px" }}>
            <p style={{ color: "#5a7a96", fontSize: 15, fontStyle: "italic", maxWidth: 500, margin: "0 auto", lineHeight: 1.8 }}>
              Your evidence dossier will appear here as you upload. Each document is automatically read, analysed, and filed. Your case builds itself.
            </p>
          </div>
        )}

        {dossier && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {/* Left column */}
            <div>
              {dossier.case_title && (
                <div style={{ background: `linear-gradient(135deg, ${YELLOW}20, transparent)`, border: `1px solid ${YELLOW}40`, borderRadius: 12, padding: "16px 20px", marginBottom: 16 }}>
                  <div style={{ fontSize: 10, letterSpacing: 3, color: YELLOW, textTransform: "uppercase", fontFamily: "'Poppins', sans-serif", marginBottom: 4 }}>Case</div>
                  <h2 style={{ margin: 0, fontFamily: "'Poppins', sans-serif", fontSize: 18, fontWeight: 800, color: WHITE }}>{dossier.case_title}</h2>
                  <div style={{ marginTop: 8 }}><Tag>{evidenceCount} item{evidenceCount !== 1 ? "s" : ""} filed</Tag></div>
                </div>
              )}

              <Panel title="Case Overview" icon="📋" action={<Btn small variant="ghost" onClick={() => downloadText("overview.txt", dossier.overview || "")}>↓</Btn>}>
                {dossier.overview ? <p style={{ margin: 0, fontSize: 13, lineHeight: 1.8, color: LIGHT }}>{dossier.overview}</p> : <EmptyState text="Building overview…" />}
              </Panel>

              <Panel title="Witness Statement" icon="📝" action={<Btn small variant="ghost" onClick={() => downloadText("witness_statement.txt", dossier.witness_statement || "")}>↓</Btn>}>
                {dossier.witness_statement ? <p style={{ margin: 0, fontSize: 13, lineHeight: 1.9, color: LIGHT, whiteSpace: "pre-wrap" }}>{dossier.witness_statement}</p> : <EmptyState text="Building statement…" />}
              </Panel>

              <Panel title="Next Steps" icon="📌" action={<Btn small variant="ghost" onClick={() => downloadText("next_steps.txt", dossier.next_steps || "")}>↓</Btn>}>
                {dossier.next_steps ? <p style={{ margin: 0, fontSize: 13, lineHeight: 1.8, color: LIGHT, whiteSpace: "pre-wrap" }}>{dossier.next_steps}</p> : <EmptyState text="Next steps will appear here…" />}
              </Panel>
            </div>

            {/* Right column */}
            <div>
              <Panel title="Timeline" icon="📅" action={<Btn small variant="ghost" onClick={() => downloadText("timeline.txt", (dossier.timeline || []).map((t, i) => `${i + 1}. [${t.date || "Unknown"}] ${t.event}`).join("\n"))}>↓</Btn>}>
                {(dossier.timeline || []).length === 0 ? <EmptyState text="Timeline building…" /> :
                  (dossier.timeline || []).map((t, i) => (
                    <div key={i} style={{ display: "flex", gap: 12, marginBottom: 14, paddingBottom: 14, borderBottom: i < dossier.timeline.length - 1 ? `1px solid ${BORDER}` : "none" }}>
                      <div style={{ width: 28, height: 28, background: YELLOW, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 11, color: NAVY, flexShrink: 0 }}>{i + 1}</div>
                      <div>
                        <div style={{ fontSize: 11, color: YELLOW, fontWeight: 600, marginBottom: 2 }}>{t.date || "Date unknown"}</div>
                        <div style={{ fontSize: 13, color: LIGHT, lineHeight: 1.6 }}>{t.event}</div>
                        {t.evidence && <div style={{ fontSize: 11, color: "#5a7a96", marginTop: 3 }}>{t.evidence}</div>}
                      </div>
                    </div>
                  ))}
              </Panel>

              <Panel title={`Evidence Library — ${evidenceCount} item${evidenceCount !== 1 ? "s" : ""}`} icon="🗂️" action={<Btn small variant="ghost" onClick={() => downloadText("evidence_library.txt", (dossier.evidence || []).map((e, i) => `[${String(i + 1).padStart(3, "0")}] ${e.title}\n${e.summary}`).join("\n\n"))}>↓</Btn>}>
                {(dossier.evidence || []).length === 0 ? <EmptyState text="No evidence uploaded yet." /> :
                  [...(dossier.evidence || [])].reverse().map((e, i) => {
                    const realIndex = (dossier.evidence || []).length - i;
                    return (
                      <div key={i} style={{ background: "#001e3d", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                          <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 11, color: YELLOW }}>#{String(realIndex).padStart(3, "0")}</span>
                          <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 13, color: WHITE, flex: 1 }}>{e.title}</span>
                          {e.date && <Tag>{e.date}</Tag>}
                          {e.type && <Tag color="#7a96b0">{e.type}</Tag>}
                        </div>
                        <p style={{ margin: "0 0 6px", fontSize: 12, color: LIGHT, lineHeight: 1.6 }}>{e.summary}</p>
                        {e.red_flags && <p style={{ margin: 0, fontSize: 11, color: "#e57373", lineHeight: 1.5 }}>⚠ {e.red_flags}</p>}
                      </div>
                    );
                  })}
              </Panel>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ borderTop: `1px solid ${BORDER}`, padding: "20px 32px", textAlign: "center", marginTop: 32 }}>
        <p style={{ margin: 0, fontSize: 11, color: "#5a7a96" }}>
          Goliathon · Get SAFE (Support After Financial Exploitation) · Founded by Steve Conley · Academy of Life Planning · <a href="https://www.get-safe.org.uk/" style={{ color: "#7a96b0" }}>www.get-safe.org.uk</a> · Educational use only. Not legal, financial, or mental-health advice.
        </p>
      </div>

      {/* Camera Scan Modal */}
      {showCamera && (
        <div style={{ position: "fixed", inset: 0, background: "#000000dd", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 32, maxWidth: 520, width: "90%", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontFamily: "'Poppins', sans-serif", color: WHITE, fontSize: 18, fontWeight: 700 }}>📷 Camera Scan</h3>
              <Btn small variant="subtle" onClick={() => { setShowCamera(false); setCameraPages([]); }}>✕</Btn>
            </div>
            <p style={{ color: "#7a96b0", fontSize: 13, lineHeight: 1.7, marginBottom: 20 }}>
              Photograph a physical letter, document, or correspondence. You can capture multiple pages — they will be analysed together as a single evidence item.
            </p>

            {/* Page thumbnails */}
            {cameraPages.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: YELLOW, marginBottom: 8, fontFamily: "'Poppins', sans-serif", fontWeight: 600 }}>{cameraPages.length} page{cameraPages.length > 1 ? "s" : ""} captured</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {cameraPages.map((p, i) => (
                    <div key={i} style={{ position: "relative" }}>
                      <img src={p.preview} alt={`Page ${i+1}`} style={{ width: 80, height: 100, objectFit: "cover", borderRadius: 6, border: `1px solid ${BORDER}` }} />
                      <div style={{ position: "absolute", top: 2, right: 2, background: NAVY, borderRadius: "50%", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: YELLOW, cursor: "pointer", fontWeight: 700 }}
                        onClick={() => setCameraPages(prev => prev.filter((_, j) => j !== i))}>✕</div>
                      <div style={{ fontSize: 10, color: "#7a96b0", textAlign: "center", marginTop: 2 }}>Page {i+1}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Btn variant="subtle" small onClick={() => cameraRef.current?.click()}>
                {cameraPages.length === 0 ? "📷 Open Camera" : "📷 Add Another Page"}
              </Btn>
              {cameraPages.length > 0 && (
                <Btn small onClick={handleCameraSubmit} disabled={cameraProcessing}>
                  {cameraProcessing ? "Processing…" : `Analyse ${cameraPages.length} Page${cameraPages.length > 1 ? "s" : ""} →`}
                </Btn>
              )}
            </div>
            <p style={{ margin: "14px 0 0", fontSize: 11, color: "#5a7a96" }}>Tip: Hold your phone steady and ensure good lighting. Capture one page at a time for best results.</p>
          </div>
        </div>
      )}

      {/* Modals */}
      {showShare && <ShareModal shareId={shareId} onClose={() => setShowShare(false)} />}
      {showDownload && dossier && <DownloadModal dossier={dossier} onClose={() => setShowDownload(false)} />}

      <style>{`
        @keyframes pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:6px}
        ::-webkit-scrollbar-track{background:#001e3d}
        ::-webkit-scrollbar-thumb{background:${YELLOW}40;border-radius:3px}
        input::placeholder{color:#5a7a96}
      `}</style>
    </div>
  );
}
