import { useState, useRef } from "react";

// Inject Google Fonts at runtime
if (!document.getElementById("goliathon-fonts")) {
  const link = document.createElement("link");
  link.id = "goliathon-fonts";
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&family=Open+Sans:wght@400;500;600&display=swap";
  document.head.appendChild(link);
}

const GOLD = "#ffc72c";
const DARK = "#00274d";
const PANEL = "#002a57";
const BORDER = "#003a6e";

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
  return <div style={{ background: "#002a57", border: "1px solid #003a6e", borderRadius: 12, padding: 24, ...style }}>{children}</div>;
}

function Btn({ children, onClick, disabled, variant = "primary", small = false }) {
  const styles = {
    primary: { background: `linear-gradient(135deg, ${GOLD}, #e6a800)`, color: "#00274d", border: "none" },
    ghost: { background: "transparent", color: GOLD, border: `1px solid ${GOLD}50` },
    subtle: { background: "#001e3d", color: "#a0b4c8", border: `1px solid ${BORDER}` },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...styles[variant], borderRadius: 8,
      padding: small ? "7px 14px" : "12px 24px",
      fontSize: small ? 11 : 13, letterSpacing: 1,
      textTransform: "uppercase", fontWeight: 700,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.4 : 1, fontFamily: "Poppins, sans-serif",
      transition: "opacity 0.2s",
    }}>{children}</button>
  );
}

function Spinner() {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "14px 0" }}>
      {[0,1,2].map(i => <div key={i} style={{ width: 8, height: 8, background: GOLD, borderRadius: "50%", animation: `pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
      <span style={{ color: "#7a96b0", fontSize: 13, marginLeft: 8, fontStyle: "italic" }}>Goliathon is working…</span>
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
      <span style={{ fontSize: 13, color: "#e8eef4" }}>{label}</span>
      <Btn small variant="ghost" onClick={() => downloadMd(filename, content)}>↓ Download .md</Btn>
    </div>
  );
}

async function callClaude(messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { 
  "Content-Type": "application/json",
  "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
},
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
                background: done ? GOLD : active ? GOLD : "#003a6e",
                border: done || active ? "none" : `1px solid ${BORDER}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 700, color: done || active ? "#00274d" : "#5a7a96",
              }}>{done ? "✓" : n}</div>
              <span style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: active ? GOLD : done ? "#a0b4c8" : "#004080", whiteSpace: "nowrap" }}>{s}</span>
            </div>
            {i < steps.length - 1 && <div style={{ flex: 1, height: 1, background: done ? GOLD : "#003a6e", margin: "0 8px", marginBottom: 22 }} />}
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
      <h2 style={{ margin: "0 0 8px", fontSize: 26, color: "#ffffff", fontFamily: "'Poppins', sans-serif", fontWeight: 700 }}>Tell me what happened.</h2>
      <p style={{ color: "#a0b4c8", fontSize: 15, marginBottom: 28, lineHeight: 1.7 }}>Write in your own words — as much or as little as you feel ready to share. There is no wrong way to begin. Goliathon will help you turn this into structured, strategic power.</p>
      <Card style={{ marginBottom: 20 }}>
        <textarea value={story} onChange={e => setStory(e.target.value)}
          placeholder="Start with what happened, when it started, who was involved, and how it has affected you. You can always add more detail later as you upload evidence…"
          style={{ width: "100%", minHeight: 280, background: "transparent", border: "none", color: "#ffffff", fontSize: 15, lineHeight: 1.9, resize: "vertical", outline: "none", fontFamily: "Poppins, sans-serif", boxSizing: "border-box" }} />
      </Card>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <Btn onClick={handleSubmit} disabled={story.trim().length < 50 || loading}>{loading ? "Analysing…" : "Begin My Case →"}</Btn>
        <span style={{ fontSize: 12, color: "#5a7a96" }}>Min. 50 characters · {story.length} typed</span>
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

Footer: "Built with Goliathon by Get SAFE · https://www.get-safe.org.uk/
 · Educational use only. Not legal advice."` }]);
    setNotionMd(md); setGenerated(true); setLoading(false);
  };

  const slug = caseData.caseTitle.replace(/[^a-z0-9]/gi, "_");

  return (
    <div>
      <h2 style={{ margin: "0 0 8px", fontSize: 26, color: "#ffffff", fontFamily: "'Poppins', sans-serif", fontWeight: 700 }}>Your Notion Workspace</h2>
      <p style={{ color: "#a0b4c8", fontSize: 15, marginBottom: 24, lineHeight: 1.7 }}>Your complete digital evidence fortress — structured for press, court, and MP readiness.</p>

      <Card style={{ marginBottom: 24, borderColor: GOLD+"30" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <Label>Case Title</Label>
            <p style={{ margin: "0 0 20px", fontSize: 16, color: "#ffffff", fontWeight: 700 }}>{caseData.caseTitle}</p>
            <Label>Date Range</Label>
            <p style={{ margin: "0 0 20px", fontSize: 14, color: "#e8eef4" }}>{caseData.dateRange}</p>
            <Label>Urgency</Label>
            <span style={{ fontSize: 12, padding: "3px 12px", borderRadius: 20, background: urgencyColor+"25", color: urgencyColor, border: `1px solid ${urgencyColor}50` }}>{caseData.urgency}</span>
          </div>
          <div>
            <Label>Core Issues Identified</Label>
            {(caseData.coreIssues||[]).map((issue, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <div style={{ width: 5, height: 5, background: GOLD, borderRadius: "50%", marginTop: 7, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: "#e8eef4", lineHeight: 1.6 }}>{issue}</span>
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
          <Card style={{ marginBottom: 16, background: "#00274d" }}>
            <pre style={{ margin: 0, fontSize: 12, color: "#7a96b0", lineHeight: 1.7, whiteSpace: "pre-wrap", maxHeight: 260, overflowY: "auto" }}>{notionMd.substring(0, 900)}…</pre>
          </Card>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Btn onClick={() => downloadMd(`${slug}_Notion_Workspace.md`, notionMd)}>↓ Download Notion Workspace</Btn>
            <Btn variant="ghost" onClick={() => onComplete({ notionMd })}>Continue → Living Documents</Btn>
          </div>
          <p style={{ fontSize: 12, color: "#5a7a96", marginTop: 12 }}>Import: Notion → New Page → Import → Markdown & CSV</p>
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
      <h2 style={{ margin: "0 0 8px", fontSize: 26, color: "#ffffff", fontFamily: "'Poppins', sans-serif", fontWeight: 700 }}>Your Living Documents</h2>
      <p style={{ color: "#a0b4c8", fontSize: 15, marginBottom: 24, lineHeight: 1.7 }}>Three core documents that grow with every piece of evidence you add. Download now, then re-download updated versions after each upload.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
        {docDefs.map(d => (
          <Card key={d.key} style={{ textAlign: "center", borderColor: generated ? GOLD+"30" : BORDER }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>{d.icon}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#ffffff", marginBottom: 8 }}>{d.label}</div>
            <div style={{ fontSize: 12, color: "#7a96b0", lineHeight: 1.6, marginBottom: 16 }}>{d.desc}</div>
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
            cursor: "pointer", fontFamily: "Poppins, sans-serif",
            color: tab === t.id ? GOLD : "#7a96b0",
            borderBottom: tab === t.id ? `2px solid ${GOLD}` : "2px solid transparent",
            marginBottom: -1,
          }}>{t.label}</button>
        ))}
      </div>
      <Card style={{ background: "#001e3d", minHeight: 260, maxHeight: 420, overflowY: "auto", marginBottom: 14 }}>
        <pre style={{ margin: 0, fontSize: 13, color: "#e8eef4", lineHeight: 1.8, whiteSpace: "pre-wrap", fontFamily: "Poppins, sans-serif" }}>{content[tab]}</pre>
      </Card>
      <Btn small variant="ghost" onClick={() => downloadMd(filenames[tab], content[tab])}>↓ Download {tabs.find(t=>t.id===tab)?.label}</Btn>
    </div>
  );
}

function Step4({ caseData, story, docs: initialDocs, savedEvidenceLog, onEvidenceUpdate }) {
  const [docs, setDocs] = useState(initialDocs);
  const [evidenceLog, setEvidenceLog] = useState(savedEvidenceLog || []);
  const [loading, setLoading] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] = useState(savedEvidenceLog?.[savedEvidenceLog.length - 1] || null);
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
      const newLog = [...evidenceLog, entry];
      setEvidenceLog(newLog);
      setDocs(newDocs);
      setCurrentAnalysis(entry);
      if (onEvidenceUpdate) onEvidenceUpdate(newLog);
    } catch { alert("Error processing file. Please try again."); }
    setLoading(false);
  };

  return (
    <div>
      <h2 style={{ margin: "0 0 8px", fontSize: 26, color: "#ffffff", fontFamily: "'Poppins', sans-serif", fontWeight: 700 }}>Add Evidence</h2>
      <p style={{ color: "#a0b4c8", fontSize: 15, marginBottom: 24, lineHeight: 1.7 }}>Upload any piece of evidence as a .TXT file — a letter, email, FOI response, complaint reply. Goliathon will analyse it and update all your living documents.</p>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 24 }}>
        {/* Left */}
        <div>
          <Card style={{ marginBottom: 16 }}>
            <div
              onDragOver={e=>{e.preventDefault();setDragOver(true);}}
              onDragLeave={()=>setDragOver(false)}
              onDrop={e=>{e.preventDefault();setDragOver(false);processFile(e.dataTransfer.files[0]);}}
              onClick={()=>!loading&&fileRef.current?.click()}
              style={{ border: `2px dashed ${dragOver?GOLD:BORDER}`, borderRadius: 10, padding: "28px 16px", textAlign: "center", cursor: loading?"not-allowed":"pointer", background: dragOver?"#001e3d":"transparent", transition: "all 0.2s" }}
            >
              <div style={{ fontSize: 34, marginBottom: 10 }}>📄</div>
              <p style={{ margin: "0 0 4px", fontSize: 14, color: "#e8eef4" }}>{loading?"Processing…":"Drop .TXT file here"}</p>
              <p style={{ margin: 0, fontSize: 11, color: "#7a96b0" }}>or click to browse</p>
            </div>
            <input ref={fileRef} type="file" accept=".txt" style={{ display: "none" }} onChange={e=>processFile(e.target.files[0])} />
            {loading && <Spinner />}
          </Card>

          {evidenceLog.length > 0 && (
            <Card style={{ marginBottom: 16 }}>
              <Label>Evidence Uploaded ({evidenceLog.length})</Label>
              {evidenceLog.map((e,i) => (
                <div key={i} onClick={()=>setCurrentAnalysis(e)} style={{ padding: "10px 0", borderBottom: `1px solid ${BORDER}`, cursor: "pointer" }}>
                  <div style={{ fontSize: 13, color: currentAnalysis?.filename===e.filename?GOLD:"#e8eef4", fontWeight: 700, marginBottom: 3 }}>{e.filename}</div>
                  <div style={{ fontSize: 11, color: "#7a96b0", lineHeight: 1.5 }}>{e.summary.substring(0,80)}…</div>
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
                <p style={{ color: "#7a96b0", fontSize: 14, lineHeight: 1.7, maxWidth: 300 }}>Upload a letter, email, FOI response, or any correspondence as a .TXT file. Goliathon will analyse it and update your living documents instantly.</p>
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

// ── SAVE / RESTORE ───────────────────────────────────────────────────────────

function SaveRestore({ step, state, onRestore }) {
  const restoreRef = useRef(null);
  const [restoreError, setRestoreError] = useState("");
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    const session = { version: 1, savedAt: new Date().toISOString(), step, state };
    const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const slug = state.caseData?.caseTitle?.replace(/[^a-z0-9]/gi, "_") || "session";
    a.href = url;
    a.download = `Goliathon_${slug}_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleRestore = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const session = JSON.parse(e.target.result);
        if (!session.version || !session.step || !session.state) throw new Error("Invalid file");
        onRestore(session.step, session.state);
        setRestoreError("");
      } catch {
        setRestoreError("This file doesn't look like a valid Goliathon session. Please try again.");
      }
    };
    reader.readAsText(file);
  };

  // Only show save if there's something worth saving
  const canSave = step > 1;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {canSave && (
        <button onClick={handleSave} style={{
          background: "none", border: `1px solid ${GOLD}40`, borderRadius: 6,
          padding: "6px 14px", fontSize: 11, letterSpacing: 1, textTransform: "uppercase",
          color: saved ? "#7e9e82" : GOLD, cursor: "pointer", fontFamily: "Poppins, sans-serif",
          transition: "all 0.2s",
        }}>
          {saved ? "✓ Session Saved" : "↓ Save Session"}
        </button>
      )}
      <button onClick={() => restoreRef.current?.click()} style={{
        background: "none", border: `1px solid ${BORDER}`, borderRadius: 6,
        padding: "6px 14px", fontSize: 11, letterSpacing: 1, textTransform: "uppercase",
        color: "#7a96b0", cursor: "pointer", fontFamily: "Poppins, sans-serif",
      }}>
        ↑ Restore Session
      </button>
      <input ref={restoreRef} type="file" accept=".json" style={{ display: "none" }} onChange={e => handleRestore(e.target.files[0])} />
      {restoreError && <span style={{ fontSize: 11, color: "#b07a7a" }}>{restoreError}</span>}
    </div>
  );
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

export default function GoliathonApp() {
  const [step, setStep] = useState(1);
  const [state, setState] = useState({});
  const merge = updates => setState(prev => ({ ...prev, ...updates }));

  const handleRestore = (restoredStep, restoredState) => {
    setState(restoredState);
    setStep(restoredStep);
  };

  return (
    <div style={{ fontFamily: "'Open Sans', sans-serif", background: "#00274d", minHeight: "100vh", width: "100%", color: "#e8eef4" }}>
      {/* Header */}
      <div style={{ background: "#00274d", borderBottom: "3px solid #ffc72c", padding: "20px 40px 0" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 20 }}>
            <img src="/getsafe-logo.png" alt="Get SAFE Logo" style={{ width: 64, height: 64, objectFit: "contain", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 10, letterSpacing: 4, color: "#ffc72c", textTransform: "uppercase", marginBottom: 2, fontFamily: "'Poppins', sans-serif" }}>Get SAFE · Academy of Life Planning</div>
              <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, color: "#ffffff", letterSpacing: "-0.5px", fontFamily: "'Poppins', sans-serif" }}>GOLIATHON</h1>
            </div>
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              <p style={{ margin: 0, fontSize: 12, color: "#a0b4c8", fontStyle: "italic", fontFamily: "'Open Sans', sans-serif" }}>Turning survivors into strategists.</p>
              <p style={{ margin: 0, fontSize: 12, color: "#7a96b0", fontStyle: "italic", fontFamily: "'Open Sans', sans-serif" }}>Evidence into action.</p>
              <div style={{ marginTop: 8 }}>
                <SaveRestore step={step} state={state} onRestore={handleRestore} />
              </div>
            </div>
          </div>
          <StepIndicator current={step} />
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "48px 40px", background: "#00274d" }}>
        {step === 1 && <Step1 onComplete={data => { merge(data); setStep(2); }} />}
        {step === 2 && <Step2 caseData={state.caseData} story={state.story} onComplete={data => { merge(data); setStep(3); }} />}
        {step === 3 && <Step3 caseData={state.caseData} story={state.story} onComplete={data => { merge(data); setStep(4); }} />}
        {step === 4 && <Step4 caseData={state.caseData} story={state.story} docs={state.docs} savedEvidenceLog={state.evidenceLog} onEvidenceUpdate={log => merge({ evidenceLog: log })} />}
      </div>

      {/* Footer */}
      <div style={{ borderTop: "1px solid #003a6e", background: "#001e3d", padding: "20px 40px", textAlign: "center" }}>
        <p style={{ margin: 0, fontSize: 11, color: "#7a96b0" }}>
          Goliathon · Get SAFE (Support After Financial Exploitation) · Founded by Steve Conley · Academy of Life Planning · <a href="https://www.get-safe.org.uk/
" style={{ color: "#a0b4c8" }}>get-safe.org.uk</a> · Educational use only. Not legal, financial, or mental-health advice.
        </p>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:0.3;transform:scale(0.8)} 50%{opacity:1;transform:scale(1)} }
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:6px}
        ::-webkit-scrollbar-track{background:#001e3d}
        ::-webkit-scrollbar-thumb{background:#ffc72c40;border-radius:3px}
        textarea::placeholder{color:#7a96b0}
      `}</style>
    </div>
  );
}
