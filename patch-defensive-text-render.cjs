// Patch: fixes the root cause of Heather's crash (React error #31 —
// "Objects are not valid as a React child") and closes off the whole class
// of bug, not just her one case.
//
// Root cause: parsed.decision_summary_update (and potentially
// overview_update / institution_response) can come back from Claude as a
// JSON object instead of the plain text string the app expects. It was
// being stored and rendered with no type check, so React crashes the whole
// page the instant it tries to display it — on every browser, every time,
// since the bad data is now persisted in the case itself.
//
// Fix, two layers:
//   1. SAVE-TIME: a new toDisplayText() helper coerces any object into
//      readable text (turning field names into headers) before it's ever
//      stored, so this can't happen again on new evidence uploads.
//   2. RENDER-TIME: the same helper wraps every display of these fields,
//      so EXISTING corrupted data (like Heather's) renders safely instead
//      of crashing — this half should unblock her the moment it deploys,
//      with no database edit required.
//
// Run from the project root:
//   node patch-defensive-text-render.cjs

const fs = require('fs');
const path = require('path');

const filePath = path.join('src', 'App.jsx');

if (!fs.existsSync(filePath)) {
  console.error(`Could not find ${filePath}. Run this from the project root.`);
  process.exit(1);
}

let content = fs.readFileSync(filePath, 'utf8');

if (content.includes('function toDisplayText(')) {
  console.log('Already patched. No changes made.');
  process.exit(0);
}

// Collect every replacement first, validating each has exactly one match,
// before writing anything — if any step fails, nothing is touched.
const steps = [];

// Step 0: insert the helper function after the existing downloadText
// function (a short, unique, single-line anchor we've confirmed verbatim).
steps.push({
  label: 'toDisplayText helper insertion',
  old: 'function downloadText(filename,content){const blob=new Blob([content],{type:"text/plain"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);}',
  new: `function downloadText(filename,content){const blob=new Blob([content],{type:"text/plain"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);}

// Safely coerces any value into displayable text. AI responses for these
// narrative fields are supposed to be plain strings, but can occasionally
// come back as structured JSON objects instead — this prevents that from
// ever crashing the render (React cannot render a raw object as a child).
// Object keys are turned into readable headers rather than being discarded.
function toDisplayText(value){
  if(value==null)return "";
  if(typeof value==="string")return value;
  if(Array.isArray(value)){
    return value.map((v,i)=>typeof v==="string"?\`\${i+1}. \${v}\`:toDisplayText(v)).join("\\n");
  }
  if(typeof value==="object"){
    return Object.entries(value).map(([k,v])=>{
      const label=k.replace(/_/g," ").replace(/\\b\\w/g,c=>c.toUpperCase());
      const body=typeof v==="string"?v:Array.isArray(v)?v.map(x=>typeof x==="string"?x:toDisplayText(x)).join("; "):toDisplayText(v);
      return \`\${label}:\\n\${body}\`;
    }).join("\\n\\n");
  }
  return String(value);
}`,
});

// Steps 1-6: render-side — wrap each of the six narrative fields at every
// point they're displayed. Confirmed via findstr on 8 Aug 2026: there are
// TWO render locations for most fields — a read-only shared-link view
// (~line 708) and the main editing view (~line 1296) — so both must be
// fixed, since anyone Heather shared a case link with (e.g. her costs
// lawyer) would hit the read-only view and see the same crash.
// institution_response only appears once (the read-only view doesn't show
// that section).
steps.push({ label: 'Case Overview render', old: '{dossier.overview}', new: '{toDisplayText(dossier.overview)}', expectedCount: 2 });
steps.push({ label: 'Witness Statement render', old: '{dossier.witness_statement}', new: '{toDisplayText(dossier.witness_statement)}', expectedCount: 3 });
steps.push({ label: 'Next Steps render', old: '{dossier.next_steps}', new: '{toDisplayText(dossier.next_steps)}', expectedCount: 2 });
steps.push({ label: 'Key Questions render', old: '{cleanNumbering(dossier.key_questions)}', new: '{cleanNumbering(toDisplayText(dossier.key_questions))}', expectedCount: 2 });
steps.push({ label: 'Decision-Maker Summary render', old: '{dossier.decision_summary}', new: '{toDisplayText(dossier.decision_summary)}', expectedCount: 2 });
steps.push({ label: 'Institution Response render', old: '{dossier.institution_response}', new: '{toDisplayText(dossier.institution_response)}', expectedCount: 1 });

// Step 7: save-time — the main processEvidence path. Wraps the three
// previously-ungated fields (overview, decision_summary,
// institution_response) so new uploads can never save a bad object again.
// witness_statement/next_steps/key_questions already had partial type
// guards in this line (newWitness/newNextSteps/newKeyQuestions are
// pre-computed strings) so are left as-is here.
steps.push({
  label: 'processEvidence save-time guard',
  old: 'const newDossier={...current,case_title:parsed.case_title||current.case_title,overview:parsed.overview_update||current.overview,timeline:newTimeline,witness_statement:newWitness,next_steps:newNextSteps,key_questions:newKeyQuestions,evidence:newEvidence,decision_summary:parsed.decision_summary_update||current.decision_summary,institution_response:parsed.institution_response||current.institution_response||""};',
  new: 'const newDossier={...current,case_title:parsed.case_title||current.case_title,overview:toDisplayText(parsed.overview_update)||current.overview,timeline:newTimeline,witness_statement:newWitness,next_steps:newNextSteps,key_questions:newKeyQuestions,evidence:newEvidence,decision_summary:toDisplayText(parsed.decision_summary_update)||current.decision_summary,institution_response:toDisplayText(parsed.institution_response)||current.institution_response||""};',
});

// Validate every step first — abort with nothing written if any fails.
for (const step of steps) {
  const expected = step.expectedCount ?? 1;
  const count = content.split(step.old).length - 1;
  if (count !== expected) {
    console.error(`Expected ${expected} match(es) for "${step.label}", found ${count}. Aborting — no changes made.`);
    console.error('If this keeps happening, the file may have changed since this patch was written — send the current file back for a fresh patch.');
    process.exit(1);
  }
}

// All validated — now apply them.
for (const step of steps) {
  content = content.split(step.old).join(step.new);
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Patched src/App.jsx successfully — all 8 steps applied:');
console.log('  1. Added toDisplayText() helper');
console.log('  2-7. Wrapped all 6 narrative fields at their render point (fixes ALREADY-corrupted');
console.log('       data like Heather\'s — should unblock her immediately on deploy, no DB edit needed)');
console.log('  8. Guarded overview/decision_summary/institution_response at save-time (prevents recurrence)');
