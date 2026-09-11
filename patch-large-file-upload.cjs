// Patch: wires up the Supabase Storage large-file upload path for PDFs.
//
// Architecture: instead of embedding a large PDF into the request body sent
// to a Vercel function (capped at 4.5MB, hence the 2.5MB guard added
// earlier today), the browser uploads the raw file directly to Supabase
// Storage, then calls /api/process-large-file with only the file's storage
// path — a tiny string. That endpoint fetches the file server-side (no
// size restriction there) and sends it to Anthropic directly, so the large
// payload never crosses back into a browser-to-Vercel request at any point.
//
// To avoid duplicating the large prompt-construction and dossier-merge
// logic that already lives inline inside processEvidence, this patch
// extracts both into shared top-level helper functions (buildEvidencePrompt,
// mergeParsedIntoDossier) used by BOTH the existing small-file path and the
// new large-file path — so a future prompt change only needs to happen in
// one place, and both paths are guaranteed to produce identical analysis.
//
// Run from the project root:
//   node patch-large-file-upload.cjs

const fs = require('fs');
const path = require('path');

const filePath = path.join('src', 'App.jsx');

if (!fs.existsSync(filePath)) {
  console.error(`Could not find ${filePath}. Run this from the project root.`);
  process.exit(1);
}

const raw = fs.readFileSync(filePath, 'utf8');
const usesCRLF = raw.includes('\r\n');
const content0 = raw.replace(/\r\n/g, '\n'); // normalize to LF for matching

if (content0.includes('function buildEvidencePrompt(')) {
  console.log('Already patched. No changes made.');
  process.exit(0);
}

const steps = [];

// Step 1: add the Supabase browser client import, right after the existing
// two import lines (React + CaseChat, confirmed present from today's chat
// feature patch).
steps.push({
  label: 'Supabase browser import',
  old: `import { useState, useRef, useCallback, useEffect } from "react";
import CaseChat from "./components/CaseChat";`,
  new: `import { useState, useRef, useCallback, useEffect } from "react";
import CaseChat from "./components/CaseChat";
import { createClient } from "@supabase/supabase-js";`,
});

// Step 2: add the two shared helper functions plus the browser Storage
// client, right after CURRENT_VERSION (a short, stable, single-line anchor
// confirmed present all day).
steps.push({
  label: 'Shared helpers + Storage client',
  old: `const CURRENT_VERSION="3";`,
  new: `const CURRENT_VERSION="3";

// Browser-side Supabase client, used only for uploading large files
// directly to Storage (bypassing the request-body size limit on Vercel
// functions). Uses the VITE_-prefixed env vars, which Vite exposes to the
// browser bundle at build time — this is the same anon key already used
// server-side, just made available client-side for this one purpose.
const supabaseBrowser=createClient(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_ANON_KEY);

// Builds the evidence-analysis prompt, including existing-case context.
// Shared between processEvidence (small/direct files) and processLargeFile
// (large PDFs routed through Storage) so both paths produce identical
// analysis — a future prompt change only needs to happen here.
function buildEvidencePrompt(dossier){
  const nextStepsText=typeof dossier?.next_steps==="string"?dossier.next_steps:Array.isArray(dossier?.next_steps)?dossier.next_steps.join("\\n"):"";
  const existing=dossier?\`\\n\\nExisting case:\\nTitle: \${dossier.case_title||"Unknown"}\\nOverview: \${(dossier.overview||"").substring(0,600)}\\nTimeline: \${(dossier.timeline||[]).map(t=>\`[\${t.date}] \${t.event}\`).join("; ").substring(0,400)}\\nStatement: \${(dossier.witness_statement||"").substring(0,400)}\\nEvidence filed (\${(dossier.evidence||[]).length}): \${(dossier.evidence||[]).map(e=>e.title).join(", ")}\\nNext steps: \${nextStepsText.substring(0,200)}\`:"\\n\\nThis is the FIRST piece of evidence — establish the case title, parties, and initial overview.";
  return \`\${existing}\\n\\nAnalyse this evidence and return ONLY valid JSON with no preamble or markdown:\\n{"case_title":"short case title","evidence_item":{"title":"descriptive title","date":"DD Mon YYYY or null","type":"Letter/Email/Statement/Report/Photo/Web Page/Other","summary":"2-3 sentence factual summary of what this document shows","facts_observed":"one sentence listing only what is directly stated or shown in the document — no interpretation","significance":"one sentence explaining why this matters to the case — clearly interpretive"},"timeline_entry":{"date":"DD Mon YYYY or null","event":"one sentence","evidence":"reference to this document"},"overview_update":"updated 3-4 sentence case overview","witness_update":"one or two new sentences in first person only","next_steps_update":"updated numbered list of 3-5 priority actions. Where a step involves escalation, explain the financial and procedural risk specific to that route. Distinguish between: (a) internal complaints and FOS referrals — free for consumers, no adverse costs exposure; (b) FCA or regulatory reporting — does not adjudicate individual complaints or obtain individual redress; (c) civil litigation — court fees, professional fees and an adverse costs order may arise depending on track and claim type. Do not imply adverse-costs exposure where it does not ordinarily arise.","key_questions_update":"updated list of 3-5 plain-language questions this case still needs to answer, from the survivor's point of view","institution_response":"the strongest reasonable answer to this case, based strictly on the current evidence. Apply four disciplines: (1) Identify the strongest argument the institution could make that is supported by the current evidence — do not invent motives, facts or defences. (2) Where the evidence contradicts that argument, say so precisely. (3) Where the evidence leaves the argument open, say so. (4) Where the evidence does not yet allow any prediction, state that plainly. Write 2-4 sentences maximum. Do not speculate beyond what the evidence supports.","decision_summary_update":"updated one-page decision-maker summary with: (1) What this case is about — 2 sentences; (2) The core dispute — bullet list of 3-5 unanswered questions the institution cannot yet answer; (3) Strongest evidence — the 2-3 most significant items filed so far; (4) What the institution will likely argue — one sentence on their probable counter-position based only on the evidence; (5) Resource asymmetry — identify any material asymmetry in financial resources, information, legal representation or capacity to sustain the dispute. Explain its practical effect without treating inequality as evidence of misconduct. Where the evidence shows costs threats or procedural demands were actually used, describe them precisely. Distinguish between unequal capacity and demonstrated exploitation of it — power imbalance is context, abuse of power requires evidence; (6) What happens next — the single most important action. Written in plain English for a judge, ombudsman, or regulator reading this for the first time."}\`;
}

// Merges a parsed AI response into the current dossier. Shared between
// processEvidence and processLargeFile for the same reason as above.
function mergeParsedIntoDossier(current,parsed){
  const newEvidence=[...(current.evidence||[]),parsed.evidence_item];
  const newTimeline=[...(current.timeline||[])];
  if(parsed.timeline_entry?.event){newTimeline.push(parsed.timeline_entry);newTimeline.sort((a,b)=>{if(!a.date)return 1;if(!b.date)return-1;return new Date(a.date)-new Date(b.date);});}
  const newWitness=current.witness_statement?current.witness_statement+"\\n\\n"+(parsed.witness_update||""):parsed.witness_update||"";
  const rawNextSteps=typeof parsed.next_steps_update==="string"?parsed.next_steps_update:Array.isArray(parsed.next_steps_update)?parsed.next_steps_update.map((s,i)=>\`\${i+1}. \${s}\`).join("\\n"):(typeof current.next_steps==="string"?current.next_steps:"");
  const newNextSteps=cleanNumbering(rawNextSteps);
  const rawKeyQ=typeof parsed.key_questions_update==="string"?parsed.key_questions_update:Array.isArray(parsed.key_questions_update)?parsed.key_questions_update.map((s,i)=>\`\${i+1}. \${s}\`).join("\\n"):(typeof current.key_questions==="string"?current.key_questions:"");
  const newKeyQuestions=cleanNumbering(rawKeyQ);
  return {...current,case_title:parsed.case_title||current.case_title,overview:toDisplayText(parsed.overview_update)||current.overview,timeline:newTimeline,witness_statement:newWitness,next_steps:newNextSteps,key_questions:newKeyQuestions,evidence:newEvidence,decision_summary:toDisplayText(parsed.decision_summary_update)||current.decision_summary,institution_response:toDisplayText(parsed.institution_response)||current.institution_response||""};
}`,
});

// Step 3: refactor processEvidence to use the shared helpers instead of
// its previous inline duplication. Functionally identical to before.
steps.push({
  label: 'processEvidence refactor',
  old: `  const processEvidence=useCallback(async(content,filename,mediaType,isUrl=false)=>{
    setProcessing(true);setProcessingMsg(\`Reading \${filename}…\`);
    try{
      const isImage=mediaType?.startsWith("image/");const isPdf=mediaType==="application/pdf";
      let userMessage;
      if(isImage){userMessage={role:"user",content:[{type:"image",source:{type:"base64",media_type:mediaType,data:content}},{type:"text",text:\`Analyse this uploaded image as evidence. Filename: \${filename}\`}]};}
      else if(isPdf){userMessage={role:"user",content:[{type:"document",source:{type:"base64",media_type:"application/pdf",data:content}},{type:"text",text:\`Analyse this uploaded document as evidence. Filename: \${filename}\`}]};}
      else{userMessage={role:"user",content:\`Analyse this evidence. \${isUrl?"Source URL: "+filename:"Filename: "+filename}\\n\\nContent:\\n\${content}\`};}
      const nextStepsText=typeof dossier?.next_steps==="string"?dossier.next_steps:Array.isArray(dossier?.next_steps)?dossier.next_steps.join("\\n"):"";
      const existing=dossier?\`\\n\\nExisting case:\\nTitle: \${dossier.case_title||"Unknown"}\\nOverview: \${(dossier.overview||"").substring(0,600)}\\nTimeline: \${(dossier.timeline||[]).map(t=>\`[\${t.date}] \${t.event}\`).join("; ").substring(0,400)}\\nStatement: \${(dossier.witness_statement||"").substring(0,400)}\\nEvidence filed (\${(dossier.evidence||[]).length}): \${(dossier.evidence||[]).map(e=>e.title).join(", ")}\\nNext steps: \${nextStepsText.substring(0,200)}\`:"\\n\\nThis is the FIRST piece of evidence — establish the case title, parties, and initial overview.";
      setProcessingMsg("Analysing evidence…");
      const prompt=\`\${existing}\\n\\nAnalyse this evidence and return ONLY valid JSON with no preamble or markdown:\\n{"case_title":"short case title","evidence_item":{"title":"descriptive title","date":"DD Mon YYYY or null","type":"Letter/Email/Statement/Report/Photo/Web Page/Other","summary":"2-3 sentence factual summary of what this document shows","facts_observed":"one sentence listing only what is directly stated or shown in the document — no interpretation","significance":"one sentence explaining why this matters to the case — clearly interpretive"},"timeline_entry":{"date":"DD Mon YYYY or null","event":"one sentence","evidence":"reference to this document"},"overview_update":"updated 3-4 sentence case overview","witness_update":"one or two new sentences in first person only","next_steps_update":"updated numbered list of 3-5 priority actions. Where a step involves escalation, explain the financial and procedural risk specific to that route. Distinguish between: (a) internal complaints and FOS referrals — free for consumers, no adverse costs exposure; (b) FCA or regulatory reporting — does not adjudicate individual complaints or obtain individual redress; (c) civil litigation — court fees, professional fees and an adverse costs order may arise depending on track and claim type. Do not imply adverse-costs exposure where it does not ordinarily arise.","key_questions_update":"updated list of 3-5 plain-language questions this case still needs to answer, from the survivor's point of view","institution_response":"the strongest reasonable answer to this case, based strictly on the current evidence. Apply four disciplines: (1) Identify the strongest argument the institution could make that is supported by the current evidence — do not invent motives, facts or defences. (2) Where the evidence contradicts that argument, say so precisely. (3) Where the evidence leaves the argument open, say so. (4) Where the evidence does not yet allow any prediction, state that plainly. Write 2-4 sentences maximum. Do not speculate beyond what the evidence supports.","decision_summary_update":"updated one-page decision-maker summary with: (1) What this case is about — 2 sentences; (2) The core dispute — bullet list of 3-5 unanswered questions the institution cannot yet answer; (3) Strongest evidence — the 2-3 most significant items filed so far; (4) What the institution will likely argue — one sentence on their probable counter-position based only on the evidence; (5) Resource asymmetry — identify any material asymmetry in financial resources, information, legal representation or capacity to sustain the dispute. Explain its practical effect without treating inequality as evidence of misconduct. Where the evidence shows costs threats or procedural demands were actually used, describe them precisely. Distinguish between unequal capacity and demonstrated exploitation of it — power imbalance is context, abuse of power requires evidence; (6) What happens next — the single most important action. Written in plain English for a judge, ombudsman, or regulator reading this for the first time."}\`;
      const response=await callClaude([{...userMessage,content:typeof userMessage.content==="string"?userMessage.content+prompt:[...(Array.isArray(userMessage.content)?userMessage.content:[userMessage.content]),{type:"text",text:prompt}]}]);
      let parsed;try{parsed=JSON.parse(response.replace(/\`\`\`json|\`\`\`/g,"").trim());}catch{throw new Error("Could not parse AI response");}
      setProcessingMsg("Updating dossier…");
      const current=dossier||{evidence:[],timeline:[],witness_statement:"",overview:"",next_steps:""};
      const newEvidence=[...(current.evidence||[]),parsed.evidence_item];
      const newTimeline=[...(current.timeline||[])];
      if(parsed.timeline_entry?.event){newTimeline.push(parsed.timeline_entry);newTimeline.sort((a,b)=>{if(!a.date)return 1;if(!b.date)return-1;return new Date(a.date)-new Date(b.date);});}
      const newWitness=current.witness_statement?current.witness_statement+"\\n\\n"+(parsed.witness_update||""):parsed.witness_update||"";
      const rawNextSteps=typeof parsed.next_steps_update==="string"?parsed.next_steps_update:Array.isArray(parsed.next_steps_update)?parsed.next_steps_update.map((s,i)=>\`\${i+1}. \${s}\`).join("\\n"):(typeof current.next_steps==="string"?current.next_steps:"");
      const newNextSteps=cleanNumbering(rawNextSteps);
      const rawKeyQ=typeof parsed.key_questions_update==="string"?parsed.key_questions_update:Array.isArray(parsed.key_questions_update)?parsed.key_questions_update.map((s,i)=>\`\${i+1}. \${s}\`).join("\\n"):(typeof current.key_questions==="string"?current.key_questions:"");
      const newKeyQuestions=cleanNumbering(rawKeyQ);
      const newDossier={...current,case_title:parsed.case_title||current.case_title,overview:toDisplayText(parsed.overview_update)||current.overview,timeline:newTimeline,witness_statement:newWitness,next_steps:newNextSteps,key_questions:newKeyQuestions,evidence:newEvidence,decision_summary:toDisplayText(parsed.decision_summary_update)||current.decision_summary,institution_response:toDisplayText(parsed.institution_response)||current.institution_response||""};
      await updateDossier(newDossier);
    }catch(e){alert("Something went wrong processing this file. Please try again.\\n\\n"+e.message);}
    setProcessing(false);setProcessingMsg("");
  },[dossier,updateDossier]);`,
  new: `  const processEvidence=useCallback(async(content,filename,mediaType,isUrl=false)=>{
    setProcessing(true);setProcessingMsg(\`Reading \${filename}…\`);
    try{
      const isImage=mediaType?.startsWith("image/");const isPdf=mediaType==="application/pdf";
      let userMessage;
      if(isImage){userMessage={role:"user",content:[{type:"image",source:{type:"base64",media_type:mediaType,data:content}},{type:"text",text:\`Analyse this uploaded image as evidence. Filename: \${filename}\`}]};}
      else if(isPdf){userMessage={role:"user",content:[{type:"document",source:{type:"base64",media_type:"application/pdf",data:content}},{type:"text",text:\`Analyse this uploaded document as evidence. Filename: \${filename}\`}]};}
      else{userMessage={role:"user",content:\`Analyse this evidence. \${isUrl?"Source URL: "+filename:"Filename: "+filename}\\n\\nContent:\\n\${content}\`};}
      setProcessingMsg("Analysing evidence…");
      const prompt=buildEvidencePrompt(dossier);
      const response=await callClaude([{...userMessage,content:typeof userMessage.content==="string"?userMessage.content+prompt:[...(Array.isArray(userMessage.content)?userMessage.content:[userMessage.content]),{type:"text",text:prompt}]}]);
      let parsed;try{parsed=JSON.parse(response.replace(/\`\`\`json|\`\`\`/g,"").trim());}catch{throw new Error("Could not parse AI response");}
      setProcessingMsg("Updating dossier…");
      const current=dossier||{evidence:[],timeline:[],witness_statement:"",overview:"",next_steps:""};
      const newDossier=mergeParsedIntoDossier(current,parsed);
      await updateDossier(newDossier);
    }catch(e){alert("Something went wrong processing this file. Please try again.\\n\\n"+e.message);}
    setProcessing(false);setProcessingMsg("");
  },[dossier,updateDossier]);

  // Handles PDFs too large for the direct/base64 path. Uploads the raw file
  // straight to Supabase Storage, then calls the new server endpoint with
  // only the storage path (a small string) — the file itself never crosses
  // back into a browser-to-Vercel request, so this bypasses the 4.5MB body
  // cap entirely. Shares buildEvidencePrompt/mergeParsedIntoDossier with
  // processEvidence so both paths produce identical analysis.
  const processLargeFile=useCallback(async(file)=>{
    setProcessing(true);setProcessingMsg(\`Uploading \${file.name}…\`);
    try{
      const storagePath=\`\${shareId}/\${Date.now()}_\${file.name}\`;
      const {error:uploadError}=await supabaseBrowser.storage.from('evidence-uploads').upload(storagePath,file,{contentType:file.type||'application/pdf'});
      if(uploadError)throw new Error('Upload failed: '+uploadError.message);
      setProcessingMsg("Analysing evidence…");
      const promptText=\`Analyse this uploaded document as evidence. Filename: \${file.name}\`+buildEvidencePrompt(dossier);
      const res=await fetch("/api/process-large-file",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({storagePath,mediaType:'application/pdf',promptText})});
      const data=await res.json();
      if(data.error)throw new Error(data.error);
      const response=data.content?.[0]?.text||"";
      let parsed;try{parsed=JSON.parse(response.replace(/\`\`\`json|\`\`\`/g,"").trim());}catch{throw new Error("Could not parse AI response");}
      setProcessingMsg("Updating dossier…");
      const current=dossier||{evidence:[],timeline:[],witness_statement:"",overview:"",next_steps:""};
      const newDossier=mergeParsedIntoDossier(current,parsed);
      await updateDossier(newDossier);
    }catch(e){alert("Something went wrong processing this large file. Please try again.\\n\\n"+e.message);}
    setProcessing(false);setProcessingMsg("");
  },[dossier,updateDossier,shareId]);`,
});

// Step 4: handleFile — route large PDFs to processLargeFile instead of
// blocking them outright. TXT and files awaiting conversion (doc/docx/msg/
// html) still use the direct path and remain size-limited for now — a
// known follow-up, not solved by this patch.
steps.push({
  label: 'handleFile large-PDF routing',
  old: `    const isImg=['jpg','jpeg','png','gif','webp'].includes(ext);
    // Images are compressed/resized below before upload, so they rarely hit
    // the size limit. Everything else (PDF, TXT, and files awaiting
    // conversion) is sent close to its raw size, so check it up front.
    const MAX_DIRECT_UPLOAD_BYTES=2.5*1024*1024;
    if(!isImg&&file.size>MAX_DIRECT_UPLOAD_BYTES){
      alert(\`This file is \${(file.size/1024/1024).toFixed(1)}MB, which is too large for Goliathon to process directly (limit: 2.5MB). Try compressing the PDF, splitting it into smaller sections, or saving it as a plain text (.txt) file if possible.\`);
      return;
    }`,
  new: `    const isImg=['jpg','jpeg','png','gif','webp'].includes(ext);
    // Images are compressed/resized below before upload, so they rarely hit
    // the size limit. PDFs above the direct-upload limit are routed through
    // Supabase Storage instead (see processLargeFile) — the file never
    // crosses back into a browser-to-Vercel request, so it bypasses the
    // 4.5MB body cap entirely. TXT and files awaiting conversion (doc/docx/
    // msg/html) still use the direct path and remain size-limited for now.
    const MAX_DIRECT_UPLOAD_BYTES=2.5*1024*1024;
    const MAX_LARGE_FILE_BYTES=20*1024*1024;
    if(!isImg&&file.size>MAX_DIRECT_UPLOAD_BYTES){
      if(ext==='pdf'){
        if(file.size>MAX_LARGE_FILE_BYTES){
          alert(\`This file is \${(file.size/1024/1024).toFixed(1)}MB, which is larger than Goliathon currently supports (limit: 20MB). Try splitting it into smaller sections.\`);
          return;
        }
        await processLargeFile(file);
        return;
      }
      alert(\`This file is \${(file.size/1024/1024).toFixed(1)}MB, which is too large for Goliathon to process directly (limit: 2.5MB). Try compressing it, splitting it into smaller sections, or saving it as a plain text (.txt) file if possible.\`);
      return;
    }`,
});

// Step 5: add processLargeFile to handleFile's dependency array.
steps.push({
  label: 'handleFile deps array',
  old: `  },[processEvidence]);

  const handleUrl=useCallback(async()=>{`,
  new: `  },[processEvidence,processLargeFile]);

  const handleUrl=useCallback(async()=>{`,
});

// Validate every step first — abort with nothing written if any fails.
let content = content0;
for (const step of steps) {
  const count = content.split(step.old).length - 1;
  if (count !== 1) {
    console.error(`Expected exactly 1 match for "${step.label}", found ${count}. Aborting — no changes made.`);
    console.error('If this keeps happening, the file may have changed since this patch was written — send the current file back for a fresh patch.');
    process.exit(1);
  }
}

// All validated — apply.
for (const step of steps) {
  content = content.split(step.old).join(step.new);
}

if (usesCRLF) content = content.replace(/\n/g, '\r\n');

fs.writeFileSync(filePath, content, 'utf8');
console.log(`Patched src/App.jsx (line endings: ${usesCRLF ? 'CRLF' : 'LF'}) — all 5 steps applied:`);
console.log('  1. Added Supabase browser client import');
console.log('  2. Added buildEvidencePrompt/mergeParsedIntoDossier helpers + supabaseBrowser client');
console.log('  3. Refactored processEvidence to use the shared helpers; added processLargeFile');
console.log('  4. handleFile now routes large PDFs (up to 20MB) through Storage instead of blocking them');
console.log('  5. Updated handleFile dependency array');
