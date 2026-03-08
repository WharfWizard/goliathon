import { useState, useRef } from "react";

const GOLD = "#c8a96e";
const DARK = "#0f0f0f";
const PANEL = "#161410";
const BORDER = "#2a2218";

const SYSTEM = `You are the Goliathon AI — created by Steve Conley, Founder of Get SAFE (Support After Financial Exploitation) and the Academy of Life Planning. Goliathon is a "battle mech for justice": an AI-powered system that turns survivors of financial exploitation into strategic citizen investigators.

Your methodology: Recognition → Organisation → Action
- Every output must be calm, professional, precise, and empowering
- Never give legal, financial, or mental-health advice — always recommend qualified professionals
- Write in plain English; avoid jargon
- Always write from the survivor's perspective with dignity and strategic clarity
- File notes format: Date / Event / Issue / Evidence / Impact / Next Action
- Letters: formal, evidence-based, measured tone
- Witness statements: first person, chronological, factual
- Notion outputs: structured markdown with headers, tables, bullet points ready for Notion import

This programme is educational and peer-support oriented only.`;

function downloadMd(filename, content) {
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function Card({ children, style = {} }) {
  return <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 24, ...style }}>{children}</div>;
}

function Btn({ children, onClick, disabled, variant = "primary", small = false }) {
  const styles = {
    primary: { background: `linear-gradient(135deg, ${GOLD}, #8a6a30)`, color: "#0f0f0f", border: "none" },
    ghost: { background: "transparent", color: GOLD, border: `1px solid ${GOLD}50` },
    subtle: { background: "#1e1a14", color: "#8a7a60", border: `1px solid ${BORDER}` },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...styles[variant], borderRadius: 8,
      padding: small ? "7px 14px" : "12px 24px",
      fontSize: small ? 11 : 13, letterSpacing: 1,
      textTransform: "uppercase", fontWeight: 700,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.4 : 1, fontFamily: "Georgia, serif",
      transition: "opacity 0.2s",
    }}>{children}</button>
  );
}

function Spinner() {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "14px 0" }}>
      {[0,1,2].map(i => <div key={i} style={{ width: 8, height: 8, background: GOLD, borderRadius: "50%", animation: `pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
      <span style={{ color: "#6a5c48", fontSize: 13, marginLeft: 8, fontStyle: "italic" }}>Goliathon is working…</span>
    </div>
  );
}

function Label({ children, color = GOLD }) {
  return <div style={{ fontSize: 10, letterSpacing: 3, color, textTransform: "uppercase", marginBottom: 10 }}>{children}</div>;
}

function DownloadRow({ label, filename, content }) {
  if (!content) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${BORDER}` }}>
      <span style={{ fontSize: 13, color: "#c8b898" }}>{label}</span>
      <Btn small variant="ghost" onClick={() => downloadMd(filename, content)}>↓ Download .md</Btn>
    </div>
  );
}

async function callClaude(messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system: SYSTEM, messages }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

// ── STEP INDICATOR ──────────────────────────────────────────────────────────

function StepIndicator({ current }) {
  const steps = ["Your Story", "Notion Setup", "Living Documents", "Add Evidence"];
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 40 }}>
      {steps.map((s, i) => {
        const n = i + 1; const done = n < current; const active = n === current;
        return (
          <div key={n} style={{ display: "flex", alignItems: "center", flex: i < steps.length - 1 ? 1 : "none" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div style={{
                width: 36, height: 36, borderRadius: "50%",
                background: done ? GOLD : active ? `linear-gradient(135deg, ${GOLD}, #8a6a30)` : "#1e1a14",
                border: done || active ? "none" : `1px solid ${BORDER}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 700, color: done || active ? "#0f0f0f" : "#4a3c2a",
              }}>{done ? "✓" : n}</div>
              <span style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: active ? GOLD : done ? "#8a7a60" : "#3a2e1a", whiteSpace: "nowrap" }}>{s}</span>
            </div>
            {i < steps.length - 1 && <div style={{ flex: 1, height: 1, background: done ? GOLD+"60" : BORDER, margin: "0 8px", marginBottom: 22 }} />}
          </div>
        );
      })}
    </div>
  );
}

// ── STEP 1: STORY ────────────────────────────────────────────────────────────

function Step1({ onComplete }) {
  const [story, setStory] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!story.trim() || loading) return;
    setLoading(true);
    try {
      const raw = await callClaude([{ role: "user", content: `Extract case data from this survivor's account. Return ONLY valid JSON with no preamble or markdown fences:
{"caseTitle":"short title e.g. 'Smith v Lloyds – Pension Mis-selling'","parties":{"claimant":"name or Not specified","respondents":["list"]},"dateRange":"earliest–latest or Unknown","coreIssues":["3-6 key issues"],"harmSuffered":["financial/emotional/professional harms"],"regulatoryBodies":["FCA/FOS/ICO etc if mentioned"],"urgency":"High or Medium or Low","recommendedSessions":["relevant session names"]}

Story: ${story}` }]);
      let caseData;
      try { caseData = JSON.parse(raw); }
      catch { caseData = { caseTitle: "My Case", parties: { claimant: "Not specified", respondents: [] }, dateRange: "Unknown", coreIssues: ["See narrative"], harmSuffered: [], regulatoryBodies: [], urgency: "Medium", recommendedSessions: ["Session 1"] }; }
      onComplete({ story, caseData });
    } catch { alert("Something went wrong. Please try again."); }
    setLoading(false);
  };

  return (
    <div>
      <h2 style={{ margin: "0 0 8px", fontSize: 26, color: "#f5ead8" }}>Tell me what happened.</h2>
      <p style={{ color: "#8a7a60", fontSize: 15, marginBottom: 28, lineHeight: 1.7 }}>Write in your own words — as much or as little as you feel ready to share. There is no wrong way to begin. Goliathon will help you turn this into structured, strategic power.</p>
      <Card style={{ marginBottom: 20 }}>
        <textarea value={story} onChange={e => setStory(e.target.value)}
          placeholder="Start with what happened, when it started, who was involved, and how it has affected you. You can always add more detail later as you upload evidence…"
          style={{ width: "100%", minHeight: 280, background: "transparent", border: "none", color: "#c8b898", fontSize: 15, lineHeight: 1.9, resize: "vertical", outline: "none", fontFamily: "Georgia, serif", boxSizing: "border-box" }} />
      </Card>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <Btn onClick={handleSubmit} disabled={story.trim().length < 50 || loading}>{loading ? "Analysing…" : "Begin My Case →"}</Btn>
        <span style={{ fontSize: 12, color: "#4a3c2a" }}>Min. 50 characters · {story.length} typed</span>
      </div>
      {loading && <Spinner />}
    </div>
  );
}

// ── STEP 2: NOTION ───────────────────────────────────────────────────────────

function Step2({ caseData, story, onComplete }) {
  const [notionMd, setNotionMd] = useState("");
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const urgencyColor = { High: "#b07a7a", Medium: GOLD, Low: "#7e9e82" }[caseData.urgency] || GOLD;

  const generate = async () => {
    setLoading(true);
    const md = await callClaude([{ role: "user", content: `Generate a complete Notion workspace in clean Markdown importable to Notion.

Case: ${JSON.stringify(caseData)}
Story: ${story.substring(0, 500)}

Include these sections:
# Case Dashboard — title, status, urgency, parties table, key contacts
# Case Summary — narrative overview
# Timeline / Chronology — table: Date | Event | Evidence | Impact
# Evidence Library — table: Ref | Document | Date | Type | Tags | Filed
# Correspondence Tracker — table: Date | From | To | Summary | Action | Status
# File Notes — template: Date / Event / Issue / Evidence / Impact / Next Action
# Legal Basis Tracker — table: Regulation | Duty | Alleged Breach | Evidence | Status
# Next Steps — prioritised action list

Footer: "Built with Goliathon by Get SAFE · aolp.info/projects · Educational use only. Not legal advice."` }]);
    setNotionMd(md); setGenerated(true); setLoading(false);
  };

  const slug = caseData.caseTitle.replace(/[^a-z0-9]/gi, "_");

  return (
    <div>
      <h2 style={{ margin: "0 0 8px", fontSize: 26, color: "#f5ead8" }}>Your Notion Workspace</h2>
      <p style={{ color: "#8a7a60", fontSize: 15, marginBottom: 24, lineHeight: 1.7 }}>Your complete digital evidence fortress — structured for press, court, and MP readiness.</p>

      <Card style={{ marginBottom: 24, borderColor: GOLD+"30" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <Label>Case Title</Label>
            <p style={{ margin: "0 0 20px", fontSize: 16, color: "#f5ead8", fontWeight: 700 }}>{caseData.caseTitle}</p>
            <Label>Date Range</Label>
            <p style={{ margin: "0 0 20px", fontSize: 14, color: "#c8b898" }}>{caseData.dateRange}</p>
            <Label>Urgency</Label>
            <span style={{ fontSize: 12, padding: "3px 12px", borderRadius: 20, background: urgencyColor+"25", color: urgencyColor, border: `1px solid ${urgencyColor}50` }}>{caseData.urgency}</span>
          </div>
          <div>
            <Label>Core Issues Identified</Label>
            {(caseData.coreIssues||[]).map((issue, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <div style={{ width: 5, height: 5, background: GOLD, borderRadius: "50%", marginTop: 7, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: "#c8b898", lineHeight: 1.6 }}>{issue}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {!generated ? (
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <Btn onClick={generate} disabled={loading}>{loading ? "Building workspace…" : "Generate Notion Workspace →"}</Btn>
          {loading && <Spinner />}
        </div>
      ) : (
        <div>
          <Card style={{ marginBottom: 16, background: "#0f0f0f" }}>
            <pre style={{ margin: 0, fontSize: 12, color: "#6a5c48", lineHeight: 1.7, whiteSpace: "pre-wrap", maxHeight: 260, overflowY: "auto" }}>{notionMd.substring(0, 900)}…</pre>
          </Card>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Btn onClick={() => downloadMd(`${slug}_Notion_Workspace.md`, notionMd)}>↓ Download Notion Workspace</Btn>
            <Btn variant="ghost" onClick={() => onComplete({ notionMd })}>Continue → Living Documents</Btn>
          </div>
          <p style={{ fontSize: 12, color: "#4a3c2a", marginTop: 12 }}>Import: Notion → New Page → Import → Markdown & CSV</p>
        </div>
      )}
    </div>
  );
}

// ── STEP 3: LIVING DOCS ──────────────────────────────────────────────────────

function Step3({ caseData, story, onComplete }) {
  const [docs, setDocs] = useState({ summary: "", timeline: "", witness: "" });
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const slug = caseData.caseTitle.replace(/[^a-z0-9]/gi, "_");

  const generate = async () => {
    setLoading(true);
    try {
      const raw = await callClaude([{ role: "user", content: `Generate three documents separated by "---SPLIT---" only (no other separators).

Case: ${JSON.stringify(caseData)}
Story: ${story.substring(0, 800)}

Doc 1 — CASE FILE SUMMARY (markdown):
# Case File Summary
Professional third-person overview. Include: parties, period, core issues, harm, regulatory context, current status, priority actions. Header: "Prepared using Goliathon · Get SAFE · ${new Date().toLocaleDateString("en-GB")}"

---SPLIT---

Doc 2 — CHRONOLOGICAL TIMELINE (markdown):
# Case Timeline
Table with columns: Date | Event | Evidence Available | Significance
Extract every date and event. Add "Evidence pending" rows where gaps exist.

---SPLIT---

Doc 3 — WITNESS STATEMENT (markdown):
# Witness Statement
First-person, formal, factual, dignified. Begin: "I, [name], make this statement in relation to..."
Cover: what happened, when, who was involved, actions taken, how it affected me.
End with declaration of truth.` }]);

      const parts = raw.split("---SPLIT---");
      const newDocs = { summary: parts[0]?.trim()||"", timeline: parts[1]?.trim()||"", witness: parts[2]?.trim()||"" };
      setDocs(newDocs); setGenerated(true);
    } catch { alert("Error generating documents. Please try again."); }
    setLoading(false);
  };

  const docDefs = [
    { key: "summary", icon: "📋", label: "Case File Summary", desc: "Professional overview for regulators, MPs, or press." },
    { key: "timeline", icon: "📅", label: "Chronological Timeline", desc: "Every event in sequence, ready for a legal bundle." },
    { key: "witness", icon: "📝", label: "Witness Statement", desc: "Your account in your own voice, written with legal clarity." },
  ];

  return (
    <div>
      <h2 style={{ margin: "0 0 8px", fontSize: 26, color: "#f5ead8" }}>Your Living Documents</h2>
      <p style={{ color: "#8a7a60", fontSize: 15, marginBottom: 24, lineHeight: 1.7 }}>Three core documents that grow with every piece of evidence you add. Download now, then re-download updated versions after each upload.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
        {docDefs.map(d => (
          <Card key={d.key} style={{ textAlign: "center", borderColor: generated ? GOLD+"30" : BORDER }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>{d.icon}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#f5ead8", marginBottom: 8 }}>{d.label}</div>
            <div style={{ fontSize: 12, color: "#6a5c48", lineHeight: 1.6, marginBottom: 16 }}>{d.desc}</div>
            {generated && docs[d.key] && (
              <Btn small variant="ghost" onClick={() => downloadMd(`${slug}_${d.label.replace(/ /g,"_")}.md`, docs[d.key])}>↓ Download</Btn>
            )}
          </Card>
        ))}
      </div>

      {!generated ? (
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <Btn onClick={generate} disabled={loading}>{loading ? "Generating…" : "Generate All Three Documents →"}</Btn>
          {loading && <Spinner />}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Btn onClick={() => onComplete({ docs })}>Continue: Add Evidence →</Btn>
          <Btn variant="subtle" onClick={generate}>↺ Regenerate</Btn>
        </div>
      )}
    </div>
  );
}

// ── STEP 4: EVIDENCE ─────────────────────────────────────────────────────────

function AnalysisTabs({ entry, slug }) {
  const [tab, setTab] = useState("analysis");
  const tabs = [
    { id: "analysis", label: "Evidence Analysis" },
    { id: "coverNote", label: "Notion Cover Note" },
    { id: "nextSteps", label: "Next Steps" },
  ];
  const content = { analysis: entry.analysis, coverNote: entry.coverNote, nextSteps: entry.nextSteps };
  const filenames = {
    analysis: `${slug}_Analysis_${entry.filename.replace(".txt","")}.md`,
    coverNote: `${slug}_CoverNote_${entry.filename.replace(".txt","")}.md`,
    nextSteps: `${slug}_NextSteps_${entry.filename.replace(".txt","")}.md`,
  };
  return (
    <div>
      <div style={{ fontSize: 13, color: GOLD, marginBottom: 12, fontWeight: 700 }}>{entry.filename}</div>
      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${BORDER}`, marginBottom: 16 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: "none", border: "none", padding: "9px 16px",
            fontSize: 11, letterSpacing: 1, textTransform: "uppercase",
            cursor: "pointer", fontFamily: "Georgia, serif",
            color: tab === t.id ? GOLD : "#6a5c48",
            borderBottom: tab === t.id ? `2px solid ${GOLD}` : "2px solid transparent",
            marginBottom: -1,
          }}>{t.label}</button>
        ))}
      </div>
      <Card style={{ background: "#0f0f0f", minHeight: 260, maxHeight: 420, overflowY: "auto", marginBottom: 14 }}>
        <pre style={{ margin: 0, fontSize: 13, color: "#c8b898", lineHeight: 1.8, whiteSpace: "pre-wrap", fontFamily: "Georgia, serif" }}>{content[tab]}</pre>
      </Card>
      <Btn small variant="ghost" onClick={() => downloadMd(filenames[tab], content[tab])}>↓ Download {tabs.find(t=>t.id===tab)?.label}</Btn>
    </div>
  );
}

function Step4({ caseData, story, docs: initialDocs }) {
  const [docs, setDocs] = useState(initialDocs);
  const [evidenceLog, setEvidenceLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);
  const slug = caseData.caseTitle.replace(/[^a-z0-9]/gi, "_");

  const processFile = async (file) => {
    if (!file?.name.endsWith(".txt")) { alert("Please upload a .txt file."); return; }
    setLoading(true); setCurrentAnalysis(null);
    const content = await file.text();
    const prevEvidence = evidenceLog.map(e => `- ${e.filename}: ${e.summary}`).join("\n");

    try {
      const raw = await callClaude([{ role: "user", content: `Analyse this evidence file and produce four outputs separated ONLY by "---SPLIT---".

Case: ${JSON.stringify(caseData)}
Original story: ${story.substring(0,300)}
Previously uploaded evidence:\n${prevEvidence||"None — this is the first document."}

File: "${file.name}"
Content:\n${content.substring(0,3000)}${content.length>3000?"\n[...truncated]":""}

Output 1 — EVIDENCE ANALYSIS (markdown):
# Evidence Analysis: ${file.name}
Cover: document type, date, author/sender, key facts, what it proves or fails to prove, red flags (deflection, contradictions, omissions), regulatory implications, evidence strength (Strong/Moderate/Weak), time-bar concerns.

---SPLIT---

Output 2 — NOTION COVER NOTE (markdown):
# Notion Cover Note — ${file.name}
Table: Filed Date | Document Ref | Type | Doc Date | Key Facts | Tags | Linked Issues | Next Action
Then one paragraph: significance to the case and recommended filing location in Notion.

---SPLIT---

Output 3 — NEXT STEPS (markdown):
# Recommended Next Steps
Numbered priority action list based on what this evidence reveals. Include: letters to send, bodies to contact, further evidence to seek, Goliathon session tools to deploy.

---SPLIT---

Output 4 — UPDATED LIVING DOCUMENTS:
Three updated documents separated ONLY by "===DOC===":
[Updated Case File Summary incorporating this evidence]===DOC===[Updated Timeline with new rows added]===DOC===[Updated Witness Statement with new paragraph added]` }]);

      const parts = raw.split("---SPLIT---");
      const analysis = parts[0]?.trim()||"";
      const coverNote = parts[1]?.trim()||"";
      const nextSteps = parts[2]?.trim()||"";
      const updatedRaw = parts[3]?.trim()||"";
      const updatedParts = updatedRaw.split("===DOC===");

      const newDocs = {
        summary: updatedParts[0]?.trim()||docs.summary,
        timeline: updatedParts[1]?.trim()||docs.timeline,
        witness: updatedParts[2]?.trim()||docs.witness,
      };

      const summaryLine = analysis.split("\n").find(l=>l.length>30&&!l.startsWith("#"))||"Evidence processed.";
      const entry = { filename: file.name, analysis, coverNote, nextSteps, summary: summaryLine.substring(0,100) };
      setEvidenceLog(prev=>[...prev, entry]);
      setDocs(newDocs);
      setCurrentAnalysis(entry);
    } catch { alert("Error processing file. Please try again."); }
    setLoading(false);
  };

  return (
    <div>
      <h2 style={{ margin: "0 0 8px", fontSize: 26, color: "#f5ead8" }}>Add Evidence</h2>
      <p style={{ color: "#8a7a60", fontSize: 15, marginBottom: 24, lineHeight: 1.7 }}>Upload any piece of evidence as a .TXT file — a letter, email, FOI response, complaint reply. Goliathon will analyse it and update all your living documents.</p>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 24 }}>
        {/* Left */}
        <div>
          <Card style={{ marginBottom: 16 }}>
            <div
              onDragOver={e=>{e.preventDefault();setDragOver(true);}}
              onDragLeave={()=>setDragOver(false)}
              onDrop={e=>{e.preventDefault();setDragOver(false);processFile(e.dataTransfer.files[0]);}}
              onClick={()=>!loading&&fileRef.current?.click()}
              style={{ border: `2px dashed ${dragOver?GOLD:BORDER}`, borderRadius: 10, padding: "28px 16px", textAlign: "center", cursor: loading?"not-allowed":"pointer", background: dragOver?"#1a1208":"transparent", transition: "all 0.2s" }}
            >
              <div style={{ fontSize: 34, marginBottom: 10 }}>📄</div>
              <p style={{ margin: "0 0 4px", fontSize: 14, color: "#c8b898" }}>{loading?"Processing…":"Drop .TXT file here"}</p>
              <p style={{ margin: 0, fontSize: 11, color: "#6a5c48" }}>or click to browse</p>
            </div>
            <input ref={fileRef} type="file" accept=".txt" style={{ display: "none" }} onChange={e=>processFile(e.target.files[0])} />
            {loading && <Spinner />}
          </Card>

          {evidenceLog.length > 0 && (
            <Card style={{ marginBottom: 16 }}>
              <Label>Evidence Uploaded ({evidenceLog.length})</Label>
              {evidenceLog.map((e,i) => (
                <div key={i} onClick={()=>setCurrentAnalysis(e)} style={{ padding: "10px 0", borderBottom: `1px solid ${BORDER}`, cursor: "pointer" }}>
                  <div style={{ fontSize: 13, color: currentAnalysis?.filename===e.filename?GOLD:"#c8b898", fontWeight: 700, marginBottom: 3 }}>{e.filename}</div>
                  <div style={{ fontSize: 11, color: "#6a5c48", lineHeight: 1.5 }}>{e.summary.substring(0,80)}…</div>
                </div>
              ))}
            </Card>
          )}

          <Card>
            <Label>Living Documents</Label>
            <DownloadRow label="Case File Summary" filename={`${slug}_Case_Summary.md`} content={docs.summary} />
            <DownloadRow label="Timeline" filename={`${slug}_Timeline.md`} content={docs.timeline} />
            <DownloadRow label="Witness Statement" filename={`${slug}_Witness_Statement.md`} content={docs.witness} />
          </Card>
        </div>

        {/* Right */}
        <div>
          {!currentAnalysis && !loading ? (
            <Card style={{ height: "100%", minHeight: 400, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
              <div>
                <div style={{ fontSize: 48, marginBottom: 16 }}>⚖️</div>
                <h3 style={{ margin: "0 0 12px", color: GOLD, fontSize: 18 }}>Ready for your first document</h3>
                <p style={{ color: "#6a5c48", fontSize: 14, lineHeight: 1.7, maxWidth: 300 }}>Upload a letter, email, FOI response, or any correspondence as a .TXT file. Goliathon will analyse it and update your living documents instantly.</p>
              </div>
            </Card>
          ) : currentAnalysis ? (
            <AnalysisTabs entry={currentAnalysis} slug={slug} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

export default function GoliathonApp() {
  const [step, setStep] = useState(1);
  const [state, setState] = useState({});
  const merge = updates => setState(prev => ({ ...prev, ...updates }));

  return (
    <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", background: DARK, minHeight: "100vh", color: "#e8e0d0" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #1a1208, #0f0f0f)", borderBottom: `1px solid ${BORDER}`, padding: "24px 40px 0" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 28 }}>
            <div style={{ width: 50, height: 50, background: `linear-gradient(135deg, ${GOLD}, #8a6a30)`, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 24px ${GOLD}30`, flexShrink: 0 }}>
              <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                <path d="M13 2L3 7v8c0 6 4 11 10 12 6-1 10-6 10-12V7L13 2z" fill="none" stroke="#fff" strokeWidth="1.5"/>
                <path d="M9 12l3 3 6-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 10, letterSpacing: 4, color: GOLD, textTransform: "uppercase", marginBottom: 2 }}>Get SAFE · Academy of Life Planning</div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#f5ead8", letterSpacing: "-0.5px" }}>GOLIATHON</h1>
            </div>
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              <p style={{ margin: 0, fontSize: 12, color: "#6a5c48", fontStyle: "italic" }}>Turning survivors into strategists.</p>
              <p style={{ margin: 0, fontSize: 12, color: "#4a3c2a", fontStyle: "italic" }}>Evidence into action.</p>
            </div>
          </div>
          <StepIndicator current={step} />
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "48px 40px" }}>
        {step === 1 && <Step1 onComplete={data => { merge(data); setStep(2); }} />}
        {step === 2 && <Step2 caseData={state.caseData} story={state.story} onComplete={data => { merge(data); setStep(3); }} />}
        {step === 3 && <Step3 caseData={state.caseData} story={state.story} onComplete={data => { merge(data); setStep(4); }} />}
        {step === 4 && <Step4 caseData={state.caseData} story={state.story} docs={state.docs} />}
      </div>

      {/* Footer */}
      <div style={{ borderTop: "1px solid #1a1610", padding: "20px 40px", textAlign: "center" }}>
        <p style={{ margin: 0, fontSize: 11, color: "#3a2e1a" }}>
          Goliathon · Get SAFE (Support After Financial Exploitation) · Founded by Steve Conley · Academy of Life Planning · <a href="https://www.aolp.info/projects" style={{ color: "#4a3c2a" }}>aolp.info/projects</a> · Educational use only. Not legal, financial, or mental-health advice.
        </p>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:0.3;transform:scale(0.8)} 50%{opacity:1;transform:scale(1)} }
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:6px}
        ::-webkit-scrollbar-track{background:#0f0f0f}
        ::-webkit-scrollbar-thumb{background:#2a2218;border-radius:3px}
        textarea::placeholder{color:#4a3c2a}
      `}</style>
    </div>
  );
}
