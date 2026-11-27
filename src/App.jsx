import { useState, useRef, useCallback, useEffect } from "react";
import CaseChat from "./components/CaseChat";
import OwnKeyPanel from "./components/OwnKeyPanel";
import FormattedText,{InlineText} from "./components/FormattedText";
import { aiHeaders, notifyAiError } from "./lib/userKey";
import { createClient } from "@supabase/supabase-js";

if (!document.getElementById("goliathon-fonts")) {
  const link = document.createElement("link");
  link.id = "goliathon-fonts"; link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&family=Open+Sans:wght@400;500;600&display=swap";
  document.head.appendChild(link);
}

const NAVY="#00274d",YELLOW="#ffc72c",WHITE="#ffffff",GREY="#555555",PANEL="#002a57",BORDER="#003a6e",LIGHT="#e8eef4";
const SYSTEM=`You are the Goliathon AI created by Steve Conley, Founder of Get SAFE (Support After Financial Exploitation) and the Academy of Life Planning. Goliathon builds a professional evidence dossier for anyone in a dispute with an institution. Core values: dignity, precision, clarity, empowerment. Never give legal, financial, or mental-health advice. Write in plain English. Be warm, calm, and strategic. Never use markdown formatting (no asterisks, hashes, tables or horizontal rules) in any field: text is shown as written. For lists, use simple numbered lines (1. 2. 3.). Never present an allegation of criminal conduct (fraud, corruption, conspiracy, collusion, cover-up) as established fact, and never state that anyone committed a crime: describe what the evidence shows and what remains to be explained.`;

// Supabase
async function saveDossierToDb(payload,isUpdate){
  if(isUpdate){const r=await fetch("/api/dossier",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const d=await r.json();if(!d.error)return d;}
  const r=await fetch("/api/dossier",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});return r.json();
}
async function loadDossierFromDb(id){const r=await fetch(`/api/dossier?share_id=${id}`);if(!r.ok)return null;return r.json();}
async function deleteDossierFromDb(id){const r=await fetch("/api/dossier",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({share_id:id})});return r.ok;}

// LocalStorage
const LS_CASES="goliathon_cases_v3",LS_ACTIVE="goliathon_active_v3",LS_WELCOMED="goliathon_welcomed";
const LS_VERSION="goliathon_version";
const CURRENT_VERSION="3";

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
// Builds the "existing case" context sent with each new document, so the AI sees
// the WHOLE case and not just the opening few hundred characters of it.
function buildExistingCaseContext(dossier){
  if(!dossier)return"\n\nThis is the FIRST piece of evidence — establish the case title and parties.";
  const txt=v=>typeof v==="string"?v:Array.isArray(v)?v.join("\n"):(typeof toDisplayText==="function"?toDisplayText(v):"");
  const cut=(v,n)=>{const s=txt(v);return s.length>n?s.substring(0,n)+" [...]":s;};
  const tl=sortTimeline(dossier.timeline||[]);
  const ev=dossier.evidence||[];
  // Shorten each entry as the timeline grows, so every entry still fits.
  const perEntry=Math.max(60,Math.min(220,Math.floor(15500/Math.max(1,tl.length))-20));
  const tlText=tl.map(t=>"["+(t.date||"undated")+"] "+cut(t.event,perEntry)).join("\n");
  const evText=ev.map((e,i)=>"#"+String(i+1).padStart(3,"0")+" "+(e.title||"Untitled")+" ("+(e.date||"undated")+")"+((e.attachments||[]).length?" with "+e.attachments.length+" attachment"+(e.attachments.length!==1?"s":""):"")).join("\n");
  return "\n\nExisting case:\nTitle: "+(dossier.case_title||"Unknown")+
    "\nOverview: "+cut(dossier.overview,2500)+
    "\nTimeline ("+tl.length+" entries, all shown):\n"+cut(tlText,16000)+
    "\nWitness statement so far: "+cut(dossier.witness_statement,4000)+
    "\nEvidence filed ("+ev.length+"):\n"+cut(evText,8000)+
    "\nNext steps so far: "+cut(dossier.next_steps,3000)+
    "\nKey questions so far: "+cut(dossier.key_questions,2000)+
    "\nDecision-maker summary so far: "+cut(dossier.decision_summary,3000)+
    "\nInstitution response so far: "+cut(dossier.institution_response,1000)+
    "\n\nCONSISTENCY RULES: (1) The new document takes priority over earlier summaries where they conflict, but do not silently overwrite. If dates, parties, amounts or events differ between documents, say so plainly in this evidence item's summary and name both versions. (2) Never restate an earlier summary as fact if a document contradicts it. (3) If this document appears to duplicate one already filed (same sender, date and subject), begin the summary with 'Possible duplicate of #NNN.' using that item's number. (4) Do not carry forward wording from earlier summaries that overstates what a document shows. LENGTH LIMITS (the reply must be complete valid JSON, so keep every field within these limits): witness_update at most 80 words; next_steps_update at most 5 items of at most 90 words each; key_questions_update at most 5 questions of at most 50 words each; institution_response at most 150 words; decision_summary_update at most 500 words; evidence_item summary at most 120 words, facts_observed at most 250 words, significance at most 45 words. Reply with the JSON object only, with no text before or after it.";
}

function buildEvidencePrompt(dossier){
  const nextStepsText=typeof dossier?.next_steps==="string"?dossier.next_steps:Array.isArray(dossier?.next_steps)?dossier.next_steps.join("\n"):"";
  const existing=buildExistingCaseContext(dossier);
  return `${existing}\n\nAnalyse this evidence and return ONLY valid JSON with no preamble or markdown:\n{"case_title":"short case title","evidence_item":{"title":"descriptive title","date":"DD Mon YYYY or null","type":"Letter/Email/Statement/Report/Photo/Web Page/Other","summary":"2-3 sentence factual summary of what this document shows","facts_observed":"one sentence listing only what is directly stated or shown in the document — no interpretation","significance":"one or two short sentences, no more than 45 words in total, interpretation only, saying why this matters to the case. Use cautious wording such as appears to indicate, is relevant to, or would show if accurate. Never use the words establishes, proves, confirms, demonstrates conclusively, beyond doubt or beyond dispute, and never state a legal conclusion or a finding about who is at fault. Where the document is an account written by one party, for example an email, letter or statement from an individual or organisation, say so and treat its contents as that party reporting events and not as established fact. Do not repeat the facts already given in facts_observed — clearly interpretive"},"timeline_entry":{"date":"DD Mon YYYY or null","event":"one sentence","evidence":"reference to this document"},"witness_update":"one or two new sentences in first person, stating only what this document shows the person themselves said, did, received or experienced. Do not add events, motives, feelings or conclusions the document does not state, and do not use relative times such as today or this morning: use the date from the document. Where the person only knows something from this document, say so, for example According to the letter dated 12 May 2024, I was told that. If the document says nothing about the person's own experience, return an empty string","next_steps_update":"updated numbered list of 3-5 priority actions. Where a step involves escalation, explain the financial and procedural risk specific to that route. Distinguish between: (a) internal complaints and FOS referrals — free for consumers, no adverse costs exposure; (b) FCA or regulatory reporting — does not adjudicate individual complaints or obtain individual redress; (c) civil litigation — court fees, professional fees and an adverse costs order may arise depending on track and claim type. Do not imply adverse-costs exposure where it does not ordinarily arise.","key_questions_update":"updated list of 3-5 plain-language questions this case still needs to answer, from the survivor's point of view","institution_response":"the strongest reasonable answer to this case, based strictly on the current evidence. Apply four disciplines: (1) Identify the strongest argument the institution could make that is supported by the current evidence — do not invent motives, facts or defences. (2) Where the evidence contradicts that argument, say so precisely. (3) Where the evidence leaves the argument open, say so. (4) Where the evidence does not yet allow any prediction, state that plainly. Write 2-4 sentences maximum. Do not speculate beyond what the evidence supports.","decision_summary_update":"updated one-page decision-maker summary of the WHOLE case as it now stands (drawing on all evidence filed, not mainly this document) with: (1) What this case is about — 2 sentences; (2) The core dispute — bullet list of 3-5 unanswered questions the institution cannot yet answer; (3) Strongest evidence — the 2-3 most significant items filed so far; (4) What the institution will likely argue — one sentence on their probable counter-position based only on the evidence; (5) Resource asymmetry — identify any material asymmetry in financial resources, information, legal representation or capacity to sustain the dispute. Explain its practical effect without treating inequality as evidence of misconduct. Where the evidence shows costs threats or procedural demands were actually used, describe them precisely. Distinguish between unequal capacity and demonstrated exploitation of it — power imbalance is context, abuse of power requires evidence; (6) What happens next — the single most important action. Written in plain English for a judge, ombudsman, or regulator reading this for the first time."}`;
}

// Writes the case overview from the WHOLE timeline, as its own short call,
// so the newest document can't dominate it. Uses one line per timeline
// entry, oldest first: roughly 1-2p per update on a large case.
async function generateWholeCaseOverview(d){
  const tl=sortTimeline((d&&d.timeline)||[]);
  if(!tl.length)return"";
  const per=Math.max(80,Math.min(260,Math.floor(24000/tl.length)-20));
  const lines=tl.map((t,i)=>(i+1)+". ["+(t.date||"undated")+"] "+String(t.event||"").slice(0,per)).join("\n");
  const prompt=`Below is the complete timeline of a case, oldest first (${tl.length} entries).

Case title: ${d.case_title||"Unknown"}

TIMELINE:
${lines}

Write the case overview for someone reading this case for the first time. 4-5 sentences, at most 170 words, covering the WHOLE case in this order: (1) who the person is and who the dispute is with; (2) how it began, using the earliest entries; (3) the main developments in between; (4) where it stands now, including any upcoming date. Give the early history as much weight as recent events, and do not centre the overview on the latest entry or any single document. Where something is one party's account, say so. No legal conclusions or findings of fault. Plain English.

Always reply with ONLY valid JSON, no preamble, explanation or markdown:
{"overview":"the overview"}`;
  const parsed=extractJson(await callClaude([{role:"user",content:prompt}]));
  return toDisplayText(parsed.overview)||"";
}
// Adds the whole-case overview to a dossier; keeps the old one if this fails.
async function withWholeCaseOverview(d){
  try{const ov=await generateWholeCaseOverview(d);return ov?{...d,overview:ov}:d;}
  catch(e){console.warn("Overview refresh failed:",e.message);return d;}
}

// Merges a parsed AI response into the current dossier. Shared between
// processEvidence and processLargeFile for the same reason as above.
function mergeParsedIntoDossier(current,parsed){
  const newEvidence=[...(current.evidence||[]),parsed.evidence_item];
  const newTimeline=[...(current.timeline||[])];
  if(parsed.timeline_entry?.event){newTimeline.push(parsed.timeline_entry);}
  const sortedTimeline=sortTimeline(newTimeline);
  const witnessUpdateText=(typeof parsed.witness_update==="string"?parsed.witness_update:"").trim();
  const newWitness=insertWitnessParagraph(current.witness_statement||"",witnessUpdateText,parsed.timeline_entry?.date||parsed.evidence_item?.date);
  const rawNextSteps=typeof parsed.next_steps_update==="string"?parsed.next_steps_update:Array.isArray(parsed.next_steps_update)?parsed.next_steps_update.map((s,i)=>`${i+1}. ${s}`).join("\n"):(typeof current.next_steps==="string"?current.next_steps:"");
  const newNextSteps=cleanNumbering(rawNextSteps);
  const rawKeyQ=typeof parsed.key_questions_update==="string"?parsed.key_questions_update:Array.isArray(parsed.key_questions_update)?parsed.key_questions_update.map((s,i)=>`${i+1}. ${s}`).join("\n"):(typeof current.key_questions==="string"?current.key_questions:"");
  const newKeyQuestions=cleanNumbering(rawKeyQ);
  return {...current,case_title:parsed.case_title||current.case_title,overview:toDisplayText(parsed.overview_update)||current.overview,timeline:sortedTimeline,witness_statement:newWitness,next_steps:newNextSteps,key_questions:newKeyQuestions,evidence:newEvidence,decision_summary:toDisplayText(parsed.decision_summary_update)||current.decision_summary,institution_response:toDisplayText(parsed.institution_response)||current.institution_response||""};
}

// Clear any stale data from previous versions
(function(){
  try{
    const stored=localStorage.getItem(LS_VERSION);
    if(stored!==CURRENT_VERSION){
      // Clear old keys from previous versions
      ["goliathon_cases","goliathon_active","goliathon_cases_v2","goliathon_active_v2"].forEach(k=>{
        try{localStorage.removeItem(k);}catch{}
      });
      localStorage.setItem(LS_VERSION,CURRENT_VERSION);
    }
  }catch{}
})();

function loadCases(){try{const d=JSON.parse(localStorage.getItem(LS_CASES)||"[]");return Array.isArray(d)?d:[];}catch{return[];}}
function saveCases(c){try{localStorage.setItem(LS_CASES,JSON.stringify(c));}catch{}}
function getActiveId(){try{return localStorage.getItem(LS_ACTIVE)||null;}catch{return null;}}
function hasBeenWelcomed(){try{return!!localStorage.getItem(LS_WELCOMED);}catch{return false;}}
function markWelcomed(){try{localStorage.setItem(LS_WELCOMED,"1");}catch{}}

// Utils
function genId(){return Math.random().toString(36).substring(2,10)+Math.random().toString(36).substring(2,10);}
// ---- Dates, ordering and AI-reply helpers (added 29 Oct 2026) ----
// Reads a date out of free text: "25 Nov 2025", "25th November 2025",
// "November 25, 2025", "Nov 2025", "2025-11-25", "25/11/2025" (UK order),
// or a range such as "4 Oct 2019 - 10 Nov 2020" (uses the first date).
// Returns a number for sorting, or null when no date can be found.
const MONTH_RE="(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const MONTH_IDX={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
function monthIndex(m){return MONTH_IDX[String(m).toLowerCase().slice(0,3)];}
function parseDateLoose(input,opts){
  if(!input||typeof input!=="string")return null;
  const allowYearOnly=!(opts&&opts.yearOnly===false);
  const s=input.replace(/(\d)(st|nd|rd|th)\b/gi,"$1");
  let m=s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if(m)return Date.UTC(+m[1],+m[2]-1,+m[3]);
  m=s.match(new RegExp("\\b(\\d{1,2})\\s+"+MONTH_RE+"\\.?,?\\s+(\\d{4})\\b","i"));
  if(m)return Date.UTC(+m[3],monthIndex(m[2]),+m[1]);
  m=s.match(new RegExp("\\b"+MONTH_RE+"\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b","i"));
  if(m)return Date.UTC(+m[3],monthIndex(m[1]),+m[2]);
  m=s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if(m)return Date.UTC(+m[3],+m[2]-1,+m[1]);
  m=s.match(new RegExp("\\b"+MONTH_RE+"\\.?,?\\s+(\\d{4})\\b","i"));
  if(m)return Date.UTC(+m[2],monthIndex(m[1]),1);
  if(allowYearOnly){m=s.match(/\b(19\d{2}|20\d{2})\b/);if(m)return Date.UTC(+m[1],0,1);}
  return null;
}
// Timeline in date order; entries without a readable date go last.
// Entries with the same date keep their existing order.
function sortTimeline(tl){
  if(!Array.isArray(tl))return tl;
  return tl.map((t,i)=>({t,i,d:parseDateLoose(t&&t.date)}))
    .sort((a,b)=>{if(a.d===null&&b.d===null)return a.i-b.i;if(a.d===null)return 1;if(b.d===null)return-1;return a.d-b.d||a.i-b.i;})
    .map(x=>x.t);
}
function timelineIsSorted(tl){if(!Array.isArray(tl))return true;const s=sortTimeline(tl);return s.every((t,i)=>t===tl[i]);}

// Pulls the JSON object out of an AI reply, even if the reply has words or
// code fences around it. Throws a plain-English error if there is none.
function extractJson(text){
  const t=String(text||"").replace(/```json|```/g,"").trim();
  try{return JSON.parse(t);}catch(_){}
  const a=t.indexOf("{"),b=t.lastIndexOf("}");
  if(a!==-1&&b>a){try{return JSON.parse(t.slice(a,b+1));}catch(_){}}
  const err=new Error("Goliathon couldn't turn the AI's reply into an update"+(t?" (it replied: “"+t.slice(0,140)+(t.length>140?"…":"")+"”)":""));
  err.aiReply=t;throw err;
}

// Witness statement paragraphs, each dated by the first full date near its start.
function splitParagraphs(text){return String(text||"").split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);}
function paragraphDate(p){return parseDateLoose(String(p).slice(0,220),{yearOnly:false});}
// Places a new paragraph in date order instead of always at the end.
function insertWitnessParagraph(statement,para,fallbackDate){
  const add=String(para||"").trim();const cur=String(statement||"");
  if(!add)return cur;if(!cur.trim())return add;if(cur.includes(add))return cur;
  const own=paragraphDate(add);
  const d=own!==null?own:parseDateLoose(fallbackDate||"",{yearOnly:false});
  const paras=splitParagraphs(cur);
  if(d!==null){const at=paras.findIndex(p=>{const pd=paragraphDate(p);return pd!==null&&pd>d;});if(at!==-1){paras.splice(at,0,add);return paras.join("\n\n");}}
  paras.push(add);return paras.join("\n\n");
}
// Re-orders a whole statement by date. A paragraph with no date stays
// attached to the dated paragraph before it; any opening undated text stays first.
function sortWitnessByDate(text){
  const groups=[];
  splitParagraphs(text).forEach(p=>{const d=paragraphDate(p);if(d!==null||!groups.length)groups.push({d,paras:[p]});else groups[groups.length-1].paras.push(p);});
  const head=groups.length&&groups[0].d===null?[groups.shift()]:[];
  const sorted=groups.map((g,i)=>({...g,i})).sort((a,b)=>a.d-b.d||a.i-b.i);
  return [...head,...sorted].flatMap(g=>g.paras).join("\n\n");
}
function formatDate(iso){if(!iso)return"";try{return new Date(iso).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});}catch{return iso;}}
async function callClaude(messages){
  const r=await fetch("/api/claude",{method:"POST",headers:aiHeaders({"Content-Type":"application/json"}),body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:8000,system:SYSTEM,messages})});
  const d=await r.json();
  if(d.error||d.type==='error'){notifyAiError(d);throw new Error(d.error||d.error_message||'API error');}
  return d.content?.[0]?.text||"";
}
function fileToBase64(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(file);});}
function compressImage(file){
  return new Promise((resolve)=>{
    const reader=new FileReader();
    reader.onload=(e)=>{
      const img=new Image();
      img.onload=()=>{
        const canvas=document.createElement("canvas");
        const maxSize=1600;let{width,height}=img;
        if(width>maxSize||height>maxSize){if(width>height){height=(height/width)*maxSize;width=maxSize;}else{width=(width/height)*maxSize;height=maxSize;}}
        canvas.width=width;canvas.height=height;
        canvas.getContext("2d").drawImage(img,0,0,width,height);
        resolve(canvas.toDataURL("image/jpeg",0.75).split(",")[1]);
      };img.src=e.target.result;
    };reader.readAsDataURL(file);
  });
}
// ── EVIDENCE BUNDLES ─────────────────────────────────────────────────────────
// An email or letter and its attachments are filed as ONE evidence item with
// ONE timeline entry (attachments shown as #045a, #045b…). Two stages:
//   1. each attachment is read on its own short call (no case context), which
//      keeps every request under Vercel's 4.5MB body limit;
//   2. one analysis reads the covering message with those attachment
//      summaries, using the normal evidence prompt.
// Cost is about the same as filing them separately: each document is still
// sent to the AI once, but the case context is sent once instead of N times.
const BUNDLE_IMAGE_EXTS=["jpg","jpeg","png","gif","webp"];
const BUNDLE_TEXT_EXTS=["html","htm","doc","docx","msg"];
const BUNDLE_ACCEPT="image/*,.pdf,.txt,.html,.htm,.doc,.docx,.msg";
const BUNDLE_LETTERS="abcdefghijklmnopqrstuvwxyz";
function attachmentLabel(itemNumber,k){return "#"+String(itemNumber).padStart(3,"0")+(BUNDLE_LETTERS[k]||("-"+(k+1)));}
function extOf(name){const n=String(name||"");return n.includes(".")?n.split(".").pop().toLowerCase():"";}
function base64ToFile(b64,name){
  const bin=atob(b64);const bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  const ext=extOf(name);
  const mime=ext==="pdf"?"application/pdf":BUNDLE_IMAGE_EXTS.includes(ext)?"image/"+(ext==="jpg"?"jpeg":ext):ext==="txt"?"text/plain":"application/octet-stream";
  return new File([bytes],name,{type:mime});
}
const ATTACHMENT_PROMPT=`This file is an attachment to a message that is being filed as evidence in a case. Read it and return ONLY valid JSON, with no text before or after it:
{"title":"short descriptive title, naming the sender and document type where shown","date":"DD Mon YYYY or null","type":"Letter/Email/Statement/Report/Photo/Form/Invoice/Other","summary":"2-3 factual sentences, at most 80 words, saying what this attachment is and what it says","facts_observed":"only what is directly stated or shown, at most 150 words: names, dates, amounts and reference numbers exactly as written. No interpretation."}`;

// Reads one attachment. A FILE problem (unsupported, too large, can't be
// converted or uploaded) comes back marked not_read, so the rest of the
// bundle is still filed. An AI problem (refused, out of allowance, busy)
// is thrown, so the whole bundle stops at once with a clear message
// instead of quietly marking every attachment "not read".
async function describeAttachment(file,shareId){
  const name=file.name||"attachment",ext=extOf(name),MB=1024*1024;
  const notRead=reason=>({filename:name,title:name,summary:"Not read: "+reason,not_read:true});
  const ai=async fn=>{try{return await fn();}catch(e){e.aiError=true;throw e;}};
  try{
    let content;
    if(BUNDLE_IMAGE_EXTS.includes(ext)){
      const data=await compressImage(file);
      content=[{type:"image",source:{type:"base64",media_type:"image/jpeg",data}},{type:"text",text:`Attachment filename: ${name}\n\n${ATTACHMENT_PROMPT}`}];
    }else if(ext==="pdf"){
      if(file.size>20*MB)return notRead("larger than 20MB. Please upload it separately in smaller parts.");
      if(file.size>2.5*MB){
        const storagePath=`${shareId}/${Date.now()}_${name}`;
        const {error:uploadError}=await supabaseBrowser.storage.from('evidence-uploads').upload(storagePath,file,{contentType:'application/pdf'});
        if(uploadError)throw new Error('Upload failed: '+uploadError.message);
        return finishAttachment(name,await ai(async()=>{
          const res=await fetch("/api/process-large-file",{method:"POST",headers:aiHeaders({"Content-Type":"application/json"}),body:JSON.stringify({storagePath,mediaType:'application/pdf',promptText:`Attachment filename: ${name}\n\n${ATTACHMENT_PROMPT}`})});
          const data=await res.json();
          if(data.error){notifyAiError(data);throw new Error(data.error);}
          return data.content?.[0]?.text||"";
        }));
      }
      content=[{type:"document",source:{type:"base64",media_type:"application/pdf",data:await fileToBase64(file)}},{type:"text",text:`Attachment filename: ${name}\n\n${ATTACHMENT_PROMPT}`}];
    }else if(ext==="txt"){
      content=`Attachment filename: ${name}\n\nContent:\n${(await file.text()).slice(0,60000)}\n\n${ATTACHMENT_PROMPT}`;
    }else if(BUNDLE_TEXT_EXTS.includes(ext)){
      if(file.size>2.5*MB)return notRead("larger than 2.5MB. Please upload it separately.");
      const res=await fetch("/api/convert",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:name,mediaType:file.type,data:await fileToBase64(file)})});
      const data=await res.json();
      if(data.error)throw new Error(data.error);
      content=`Attachment filename: ${name}\n\nContent:\n${String(data.text||"").slice(0,60000)}\n\n${ATTACHMENT_PROMPT}`;
    }else{
      return notRead("this file type is not supported.");
    }
    return finishAttachment(name,await ai(()=>callClaude([{role:"user",content}])));
  }catch(e){if(e.aiError)throw e;return notRead(e.message||"something went wrong.");}
}
function finishAttachment(name,responseText){
  const p=extractJson(responseText)||{};
  const date=p.date&&String(p.date).toLowerCase()!=="null"?String(p.date):null;
  return {filename:name,title:toDisplayText(p.title)||name,date,type:toDisplayText(p.type),summary:toDisplayText(p.summary),facts_observed:toDisplayText(p.facts_observed)};
}
// The text the main analysis reads in place of the attachments themselves.
function bundleMessageText({text,title,date,attachments}){
  const list=attachments.map((a,k)=>`[${BUNDLE_LETTERS[k]||k+1}] ${a.filename}${a.not_read?"":` — ${a.title} (${a.date||"undated"}${a.type?", "+a.type:""})`}\nSummary: ${a.summary||""}${a.facts_observed?`\nWhat it shows: ${a.facts_observed}`:""}`).join("\n\n");
  return `Analyse this evidence. It is ONE item: a message with ${attachments.length} attachment${attachments.length!==1?"s":""}, filed together.
Title given: ${title||"not given"}
Date given: ${date||"not given"}

MESSAGE TEXT:
${String(text||"").trim()||"(No covering text was provided.)"}

ATTACHMENTS (each was read separately; summaries below):
${list}

BUNDLE RULES: The evidence_item describes the message and its attachments together, and its title names the message (for example "Email from the Board with 3 attachments"). Give ONE timeline_entry, for the message; mention an attachment in it only if the attachment is the substance of the event. Where an attachment was not read, do not guess its contents.`;
}

function downloadText(filename,content){const blob=new Blob([content],{type:"text/plain"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);}

// Safely coerces any value into displayable text. AI responses for these
// narrative fields are supposed to be plain strings, but can occasionally
// come back as structured JSON objects instead — this prevents that from
// ever crashing the render (React cannot render a raw object as a child).
// Object keys are turned into readable headers rather than being discarded.
function toDisplayText(value){
  if(value==null)return "";
  if(typeof value==="string")return value;
  if(Array.isArray(value)){
    return value.map((v,i)=>typeof v==="string"?`${i+1}. ${v}`:toDisplayText(v)).join("\n");
  }
  if(typeof value==="object"){
    return Object.entries(value).map(([k,v])=>{
      const label=k.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());
      const body=typeof v==="string"?v:Array.isArray(v)?v.map(x=>typeof x==="string"?x:toDisplayText(x)).join("; "):toDisplayText(v);
      return `${label}:\n${body}`;
    }).join("\n\n");
  }
  return String(value);
}

// ── PDF GENERATION ────────────────────────────────────────────────────────────
async function loadLogoBase64(){
  return new Promise((resolve)=>{
    const img=new Image();
    img.crossOrigin="anonymous";
    img.onload=()=>{
      const canvas=document.createElement("canvas");
      canvas.width=img.width;canvas.height=img.height;
      canvas.getContext("2d").drawImage(img,0,0);
      resolve(canvas.toDataURL("image/png").split(",")[1]);
    };
    img.onerror=()=>resolve(null);
    img.src="/getsafe-logo.png";
  });
}

function createPdfDoc(){
  // jsPDF loaded via CDN in index.html — access via window
  const {jsPDF}=window.jspdf;
  return new jsPDF({orientation:"portrait",unit:"mm",format:"a4"});
}

function pdfAddHeader(doc,logoB64,caseTitle,sectionTitle){
  const W=210,margin=18;
  // Navy header bar
  doc.setFillColor(0,39,77);
  doc.rect(0,0,W,28,"F");
  // Yellow rule
  doc.setFillColor(255,199,44);
  doc.rect(0,28,W,1.5,"F");
  // Logo
  if(logoB64){try{doc.addImage("data:image/png;base64,"+logoB64,"PNG",margin,4,16,16);}catch{}}
  // Title text
  doc.setTextColor(255,199,44);
  doc.setFontSize(7);
  doc.setFont("helvetica","bold");
  doc.text("GET SAFE · ACADEMY OF LIFE PLANNING",margin+20,10);
  doc.setTextColor(255,255,255);
  doc.setFontSize(14);
  doc.text("GOLIATHON",margin+20,18);
  // Section title right-aligned
  doc.setTextColor(160,180,200);
  doc.setFontSize(8);
  doc.setFont("helvetica","normal");
  doc.text(sectionTitle,W-margin,18,{align:"right"});
  // Case title below rule
  if(caseTitle){
    doc.setTextColor(255,255,255);
    doc.setFontSize(9);
    doc.setFont("helvetica","bold");
    {let cf=9;while(cf>7&&doc.getTextWidth(caseTitle)>W-2*margin){cf-=0.5;doc.setFontSize(cf);}let ct=caseTitle;if(doc.getTextWidth(ct)>W-2*margin){while(ct.length>4&&doc.getTextWidth(ct+"...")>W-2*margin){ct=ct.slice(0,-1);}ct=ct.trimEnd()+"...";}doc.text(ct,margin,33);}
  }
  return caseTitle?38:33;
}

function pdfAddFooter(doc,pageNum,totalPages){
  const W=210,margin=18,y=290;
  doc.setDrawColor(0,58,110);
  doc.line(margin,y-3,W-margin,y-3);
  doc.setTextColor(90,122,150);
  doc.setFontSize(7);
  doc.setFont("helvetica","normal");
  doc.text("Goliathon · Get SAFE (Support After Financial Exploitation) · Educational use only. Not legal, financial, or mental-health advice.",margin,y+1);
  doc.text(`Page ${pageNum} of ${totalPages}`,W-margin,y+1,{align:"right"});
}

function pdfWrappedText(doc,text,x,y,maxWidth,fontSize,bold=false,color=[30,50,80]){
  doc.setFontSize(fontSize);
  doc.setFont("helvetica",bold?"bold":"normal");
  doc.setTextColor(...color);
  const lines=doc.splitTextToSize(text||"",maxWidth);
  const lineHeight=fontSize*0.45;
  return{lines,height:lines.length*lineHeight,lineHeight};
}


function clean(str){
  if(!str)return '';
  return str
    .replace(/^&\s*/,'')           // strip leading & (with or without space)
    .replace(/\s&\s*$/,'')          // strip only a dangling & at the very end; real ampersands inside text are kept
    .replace(/;\s*'[^']*$/,'')     // strip trailing incomplete quoted token e.g. ; 'court repossess
    .replace(/;\s*"[^"]*$/,'')     // same for double quotes
    .trim()
    .replace(/;\s*$/,'');          // strip trailing semicolon left behind
}

async function hashFile(content){
  const msgUint8=new TextEncoder().encode(typeof content==='string'?content:content.toString());
  const hashBuffer=await crypto.subtle.digest('SHA-256',msgUint8);
  return Array.from(new Uint8Array(hashBuffer)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function cleanNumbering(text){
  if(!text)return '';
  // Insert newline before numbered items if missing
  let t=text.replace(/([.!?;:)])\s+(\d{1,2}\. )(?=[A-Z(])/g,'$1\n$2');// only after sentence punctuation, and only 1-2 digit numbers, so years like 2026. are never split
  // Strip "1. 1." duplicate numbering
  t=t.replace(/^(\d+)\.\s+\1\.\s+/gm,'$1. ');
  t=t.replace(/^(\d+)\.\s+(\d+)\.\s+(?=\D)/gm,(m,a,b)=>a===b?a+'. ':m);
  return t;
}

function pdfSection(doc,title,y,margin,contentWidth){
  // Section header with yellow left border
  doc.setFillColor(255,199,44);
  doc.rect(margin,y,2,6,"F");
  doc.setFillColor(0,42,87);
  doc.rect(margin+2,y,contentWidth-2,6,"F");
  doc.setTextColor(255,255,255);
  doc.setFontSize(9);
  doc.setFont("helvetica","bold");
  doc.text(title,margin+6,y+4.2);
  return y+8;
}

function checkNewPage(doc,y,needed,logoB64,caseTitle,sectionTitle,pageNums){
  if(y+needed>280){
    /* footers are drawn once the PDF is complete, when the real page total is known */
    doc.addPage();
    pageNums.current++;
    const newY=pdfAddHeader(doc,logoB64,caseTitle,sectionTitle);
    return newY+4;
  }
  return y;
}

// PDF: lists a bundle's attachments under the item's "What this shows".
function withAttachmentNotes(e,itemNumber){
  const att=e.attachments||[];
  if(!att.length)return e.facts_observed;
  const lines=att.map((a,k)=>`${attachmentLabel(itemNumber,k)} ${a.title||a.filename}${a.date?" ("+a.date+")":""}: ${a.summary||""}`);
  return [e.facts_observed,`Attachments (${att.length}): `+lines.join(" ")].filter(Boolean).join(" ");
}
async function downloadPdf(sectionKey,dossier){
  if(!window.jspdf){alert("PDF library not loaded yet. Please wait a moment and try again.");return;}
  const logoB64=await loadLogoBase64();
  const doc=createPdfDoc();
  const margin=18,W=210,contentWidth=W-margin*2;
  const pageNums={current:1};
  const dateStr=new Date().toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"});
  const caseTitle=dossier.case_title||"Evidence Dossier";

  const sections={
    overview:{title:"Case Overview",data:()=>[{type:"body",text:dossier.overview||"No overview available."}]},
    timeline:{title:"Chronological Timeline",data:()=>sortTimeline(dossier.timeline||[]).map((t,i)=>({type:"timeline",num:i+1,date:t.date||"Date unknown",event:t.event,evidence:t.evidence}))},
    statement:{title:"Witness Statement",data:()=>[{type:"body",text:dossier.witness_statement||"No statement available."}]},
    evidence:{title:`Evidence Library — ${(dossier.evidence||[]).length} ${(dossier.evidence||[]).length===1?"Item":"Items"}`,data:()=>(dossier.evidence||[]).map((e,i)=>({type:"evidence",num:i+1,title:e.title,date:e.date,docType:e.type,summary:e.summary,factsObserved:withAttachmentNotes(e,i+1),significance:e.significance,redFlags:e.red_flags}))},
    nextsteps:{title:"Next Steps",data:()=>[{type:"body",text:dossier.next_steps||"No next steps available."}]},
    institutionresponse:{title:"The Strongest Answer to Your Case",data:()=>[{type:"body",text:(dossier.institution_response?"Based strictly on the evidence filed so far:\n\n"+dossier.institution_response:"Not yet generated.")+"\n\n"+AI_DISCLAIMER_PDF_TEXT}]},
    keyquestions:{title:"Key Questions in This Case",data:()=>[{type:"body",text:(dossier.key_questions||"No key questions identified yet.")+"\n\n"+AI_DISCLAIMER_PDF_TEXT}]},
    decisionsummary:{title:"Decision-Maker Summary",data:()=>[{type:"body",text:(dossier.decision_summary||"Decision-Maker Summary not yet generated.")+"\n\n"+AI_DISCLAIMER_PDF_TEXT}]},
    complete:{title:"Complete Evidence Dossier",data:()=>{
      const items=[];
      items.push({type:"sectionHeader",title:"Case Overview"});
      items.push({type:"body",text:dossier.overview||""});
      items.push({type:"sectionHeader",title:"Chronological Timeline"});
      sortTimeline(dossier.timeline||[]).forEach((t,i)=>items.push({type:"timeline",num:i+1,date:t.date||"Date unknown",event:t.event,evidence:t.evidence}));
      items.push({type:"sectionHeader",title:"Witness Statement"});
      items.push({type:"body",text:dossier.witness_statement?"DRAFT - generated by Goliathon from your documents, not a statement you have made. Check that every sentence is accurate, and put it in your own words, before using it anywhere.\n\n"+dossier.witness_statement:""});
      items.push({type:"sectionHeader",title:`Evidence Library — ${(dossier.evidence||[]).length} ${(dossier.evidence||[]).length===1?"Item":"Items"}`});
      (dossier.evidence||[]).forEach((e,i)=>items.push({type:"evidence",num:i+1,title:e.title,date:e.date,docType:e.type,summary:e.summary,factsObserved:withAttachmentNotes(e,i+1),significance:e.significance,redFlags:e.red_flags}));
      items.push({type:"sectionHeader",title:"Next Steps"});
      items.push({type:"body",text:dossier.next_steps||""});
      if(dossier.decision_summary){items.push({type:"sectionHeader",title:"Decision-Maker Summary"});items.push({type:"body",text:dossier.decision_summary+"\n\n"+AI_DISCLAIMER_PDF_TEXT});}if(dossier.institution_response){items.push({type:"sectionHeader",title:"The Strongest Answer to Your Case"});items.push({type:"body",text:"Based strictly on the evidence filed so far:\n\n"+dossier.institution_response+"\n\n"+AI_DISCLAIMER_PDF_TEXT});}
      if(dossier.key_questions){items.push({type:"sectionHeader",title:"Key Questions in This Case"});items.push({type:"body",text:dossier.key_questions+"\n\n"+AI_DISCLAIMER_PDF_TEXT});}
      return items;
    }},
  };

  const sec=sections[sectionKey];
  let y=pdfAddHeader(doc,logoB64,caseTitle,sec.title);
  y+=4;

  // Generated date
  doc.setTextColor(100,130,160);
  doc.setFontSize(7.5);
  doc.setFont("helvetica","normal");
  doc.text(`Generated: ${dateStr}`,margin,y);
  y+=6;

  if(sectionKey!=="complete"){
    y=pdfSection(doc,sec.title,y,margin,contentWidth);
    y+=2;
  }

  const items=sec.data();

  for(const item of items){
    if(item.type==="sectionHeader"){
      {const nextItem=items[items.indexOf(item)+1];const lead=nextItem&&nextItem.type==="evidence"?(()=>{const wl=(t,w,fs)=>t?Math.ceil(clean(t).length/Math.floor(w/(fs*0.23)))+1:0;const tl=wl("#"+String(nextItem.num).padStart(3,"0")+"  "+(nextItem.title||""),contentWidth-10,9);const sl=wl(nextItem.summary,contentWidth-18,8.5);const fl=wl(nextItem.factsObserved,contentWidth-18,7.5);const gl=wl(nextItem.significance,contentWidth-18,7.5);return 16+6+tl*5+3+7+sl*5+(fl?4.5+fl*4.5+2:0)+(gl?4.5+gl*4.5+2:0)+5+4;})():nextItem&&nextItem.type==="timeline"?40:30;y=checkNewPage(doc,y,lead,logoB64,caseTitle,sec.title,pageNums);}
      y+=4;
      y=pdfSection(doc,item.title,y,margin,contentWidth);
      y+=4;
      continue;
    }

    if(item.type==="body"){const bodyText=cleanNumbering(item.text||'');
      const {lines,lineHeight}=pdfWrappedText(doc,bodyText,margin,y,contentWidth,9,false,[30,50,80]);
      for(const line of lines){
        y=checkNewPage(doc,y,lineHeight*1.5,logoB64,caseTitle,sec.title,pageNums);
        doc.setFontSize(9);doc.setFont("helvetica","normal");doc.setTextColor(30,50,80);
        doc.text(line,margin,y);
        y+=lineHeight*1.4;
      }
      y+=4;
      continue;
    }

    if(item.type==="timeline"){
      // Estimate height needed
      doc.setFontSize(8.5);doc.setFont("helvetica","normal");const eventLines=doc.splitTextToSize(item.event||"",contentWidth-22);
      const neededH=6+eventLines.length*4.5+(item.evidence?(doc.setFontSize(7),Math.max(1,doc.splitTextToSize(item.evidence,contentWidth-22).length)*3.5+0.5):0)+4;
      y=checkNewPage(doc,y,neededH,logoB64,caseTitle,sec.title,pageNums);
      // Number circle
      doc.setFillColor(255,199,44);
      doc.circle(margin+4,y+3,3.5,"F");
      doc.setTextColor(0,39,77);doc.setFontSize(7);doc.setFont("helvetica","bold");
      doc.text(String(item.num),margin+4,y+3.7,{align:"center"});
      // Date
      doc.setTextColor(255,199,44);doc.setFontSize(8);doc.setFont("helvetica","bold");
      doc.text(item.date,margin+10,y+2.5);
      // Event
      doc.setTextColor(30,50,80);doc.setFontSize(8.5);doc.setFont("helvetica","normal");
      let ey=y+6.5;
      for(const line of eventLines){doc.text(line,margin+10,ey);ey+=4.2;}
      // Evidence ref
      if(item.evidence){
        doc.setTextColor(90,122,150);doc.setFontSize(7);
        for(const rl of doc.splitTextToSize(item.evidence,contentWidth-22)){doc.text(rl,margin+10,ey);ey+=3.5;}
      }
      // Connector line
      if(item.num<(dossier.timeline||[]).length){
        doc.setDrawColor(0,58,110);doc.setLineWidth(0.3);
        doc.line(margin+4,y+7,margin+4,ey+1);
      }
      y=ey+3;
      continue;
    }

    if(item.type==="evidence"){
      // ── Manual word-wrap helper — does NOT rely on jsPDF font metrics ──────
      // Wraps text by character-count estimate: ~0.45mm per char at fontSize pt
      function wrapText(text,maxW,fontSize){
        if(!text)return[];
        const charsPerLine=Math.floor(maxW/(fontSize*0.23));
        const words=text.split(' ');
        const lines=[];
        let cur='';
        for(const w of words){
          if(!cur){cur=w;continue;}
          if((cur+' '+w).length<=charsPerLine){cur+=' '+w;}
          else{lines.push(cur);cur=w;}
        }
        if(cur)lines.push(cur);
        return lines.length?lines:[''];
      }
      const TOP_PAD=6, BOT_PAD=5;
      const titleLines=wrapText(`#${String(item.num).padStart(3,"0")}  ${item.title||""}`,contentWidth-10,9);
      const summaryLines=wrapText(clean(item.summary),contentWidth-18,8.5);
      const factsLines=item.factsObserved?wrapText(clean(item.factsObserved),contentWidth-18,7.5):[];
      const sigLines=item.significance?wrapText(clean(item.significance),contentWidth-18,7.5):[];
      // ── Simulate total height ─────────────────────────────────────────────
      let simCy=TOP_PAD;
      simCy+=titleLines.length*5+3;
      if(item.date||item.docType)simCy+=7;
      simCy+=summaryLines.length*5;
      if(factsLines.length)simCy+=4.5+factsLines.length*4.5+2;
      if(sigLines.length)simCy+=4.5+sigLines.length*4.5+2;
      simCy+=BOT_PAD;
      const boxH=simCy;
      // ── Page break check ──────────────────────────────────────────────────
      y=checkNewPage(doc,y,boxH+4,logoB64,caseTitle,sec.title,pageNums);
      // ── Draw card ─────────────────────────────────────────────────────────
      doc.setFillColor(0,30,61);
      doc.roundedRect(margin,y,contentWidth,boxH,2,2,"F");
      doc.setFillColor(255,199,44);
      doc.rect(margin,y,2,boxH,"F");
      // ── Render ────────────────────────────────────────────────────────────
      let cy=y+TOP_PAD;
      doc.setTextColor(255,255,255);doc.setFontSize(9);doc.setFont("helvetica","bold");
      for(const line of titleLines){doc.text(line,margin+6,cy);cy+=5;}
      cy+=3;
      if(item.date||item.docType){
        if(item.date){
          doc.setFillColor(255,199,44,0.2);doc.setDrawColor(255,199,44);doc.setLineWidth(0.3);
          const tw=doc.getTextWidth(item.date)+4;
          doc.roundedRect(margin+6,cy-2.5,tw,5,1,1,"S");
          doc.setTextColor(255,199,44);doc.setFontSize(7);doc.setFont("helvetica","bold");
          doc.text(item.date,margin+8,cy+1.2);
          const nextX=margin+6+tw+3;
          if(item.docType){
            const tw2=doc.getTextWidth(item.docType)+4;
            doc.setDrawColor(122,150,176);
            doc.roundedRect(nextX,cy-2.5,tw2,5,1,1,"S");
            doc.setTextColor(122,150,176);
            doc.text(item.docType,nextX+2,cy+1.2);
          }
        } else if(item.docType){
          const tw2=doc.getTextWidth(item.docType)+4;
          doc.setDrawColor(122,150,176);doc.setLineWidth(0.3);
          doc.roundedRect(margin+6,cy-2.5,tw2,5,1,1,"S");
          doc.setTextColor(122,150,176);doc.setFontSize(7);doc.setFont("helvetica","bold");
          doc.text(item.docType,margin+8,cy+1.2);
        }
        cy+=7;
      }
      doc.setTextColor(200,218,230);doc.setFontSize(8.5);doc.setFont("helvetica","normal");
      for(const line of summaryLines){doc.text(line,margin+6,cy);cy+=5;}
      if(factsLines.length){
        cy+=2;
        doc.setTextColor(122,150,176);doc.setFontSize(7.5);doc.setFont("helvetica","bold");
        doc.text("WHAT THIS SHOWS:",margin+6,cy);cy+=4.5;
        doc.setFont("helvetica","normal");
        for(const line of factsLines){doc.text(line,margin+6,cy);cy+=4.5;}
      }
      if(sigLines.length){
        cy+=2;
        doc.setTextColor(255,199,44);doc.setFontSize(7.5);doc.setFont("helvetica","bold");
        doc.text("WHY IT MATTERS:",margin+6,cy);cy+=4.5;
        doc.setFont("helvetica","normal");
        for(const line of sigLines){doc.text(line,margin+6,cy);cy+=4.5;}
      }
      y+=boxH+4;
      continue;
    }
  }

  // Fix total pages in footers — render footer on last page
  const totalPages=doc.internal.getNumberOfPages();for(let p=1;p<=totalPages;p++){doc.setPage(p);pdfAddFooter(doc,p,totalPages);}

  const filename=`${caseTitle.replace(/[^a-z0-9]/gi,"_")}_${sectionKey}.pdf`;
  doc.save(filename);
}
function buildFullDossierText(d){return["GOLIATHON EVIDENCE DOSSIER","Get SAFE (Support After Financial Exploitation)",`Generated: ${formatDate(new Date().toISOString())}`,"","═══════════════════════════════","CASE OVERVIEW","═══════════════════════════════",d.overview||"","","═══════════════════════════════","CHRONOLOGICAL TIMELINE","═══════════════════════════════",...sortTimeline(d.timeline||[]).map((t,i)=>`${i+1}. [${t.date||"Date unknown"}] ${t.event}`),"","═══════════════════════════════","WITNESS STATEMENT","═══════════════════════════════",d.witness_statement||"","","═══════════════════════════════",`EVIDENCE LIBRARY (${(d.evidence||[]).length} items)`,"═══════════════════════════════",...(d.evidence||[]).map((e,i)=>`[${String(i+1).padStart(3,"0")}] ${e.title}\n${e.summary}`),"","═══════════════════════════════","NEXT STEPS","═══════════════════════════════",d.next_steps||"","─────────────────────────────","Goliathon · Get SAFE · academyoflifeplanning.com/individuals/get-safe","Educational use only. Not legal advice."].join("\n");}
function caseStrength(d){if(!d)return 0;let s=0;s+=Math.min((d.evidence||[]).length*10,40);s+=Math.min((d.timeline||[]).length*5,20);s+=(d.witness_statement||"").length>200?15:(d.witness_statement||"").length>50?8:0;s+=(d.next_steps||"").length>100?10:0;s+=(d.overview||"").length>100?15:0;return Math.min(s,100);}

// UI
function Spinner({small=false}){return(<span style={{display:"inline-flex",gap:4,alignItems:"center"}}>{[0,1,2].map(i=><span key={i} style={{width:small?5:7,height:small?5:7,background:YELLOW,borderRadius:"50%",display:"inline-block",animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite`}}/>)}</span>);}
function Btn({children,onClick,disabled,variant="primary",small=false,fullWidth=false,danger=false}){
  const base={borderRadius:8,fontFamily:"'Poppins', sans-serif",fontWeight:700,cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.4:1,transition:"all 0.2s",border:"none",letterSpacing:0.5,display:"inline-flex",alignItems:"center",gap:6,whiteSpace:"nowrap"};
  const v=danger?{background:"#c0392b20",color:"#e57373",border:"1px solid #e5737340",padding:small?"6px 14px":"10px 22px",fontSize:small?11:13}:
    variant==="primary"?{background:YELLOW,color:NAVY,padding:small?"7px 16px":"11px 24px",fontSize:small?12:13}:
    variant==="ghost"?{background:"transparent",color:YELLOW,border:`1px solid ${YELLOW}50`,padding:small?"6px 14px":"10px 22px",fontSize:small?11:13}:
    {background:PANEL,color:LIGHT,border:`1px solid ${BORDER}`,padding:small?"6px 14px":"10px 22px",fontSize:small?11:13};
  return <button onClick={onClick} disabled={disabled} style={{...base,...v,width:fullWidth?"100%":"auto"}}>{children}</button>;
}
function Panel({title,icon,children,action}){return(<div style={{background:PANEL,border:`1px solid ${BORDER}`,borderRadius:12,overflow:"hidden",marginBottom:16}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 20px",borderBottom:`1px solid ${BORDER}`,background:"#001e3d"}}><div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:18}}>{icon}</span><span style={{fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:14,color:WHITE}}>{title}</span></div>{action}</div><div style={{padding:20}}>{children}</div></div>);}
const AI_DISCLAIMER_PDF_TEXT="This is Goliathon's interpretation, not a legal or factual finding. Check it against your evidence and correct anything that is wrong before relying on it.";
function AIDisclaimer({compact}){return(<p style={{margin:compact?"6px 0 0":"10px 0 0",fontSize:compact?10:11,color:"#5a7a96",lineHeight:1.5,fontStyle:"italic"}}>⚠ This is Goliathon's interpretation, not a legal or factual finding. Check it against your evidence — if anything is wrong, correct it before relying on it.</p>);}
function Tag({children,color=YELLOW}){return<span style={{background:color+"20",color,border:`1px solid ${color}40`,borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600,fontFamily:"'Poppins', sans-serif"}}>{children}</span>;}
function EmptyState({text}){return<p style={{color:"#5a7a96",fontSize:13,fontStyle:"italic",margin:0}}>{text}</p>;}

function StrengthMeter({dossier}){
  const score=caseStrength(dossier);
  const label=score<20?"Just started":score<40?"Building":score<60?"Developing":score<80?"Strong":"Comprehensive";
  const color=score<40?"#e57373":score<70?YELLOW:"#7e9e82";
  return(<div style={{background:PANEL,border:`1px solid ${BORDER}`,borderRadius:10,padding:"12px 16px",marginBottom:16}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}><span style={{fontSize:12,color:"#a0b4c8",fontFamily:"'Poppins', sans-serif",fontWeight:600}}>Case Strength</span><span style={{fontSize:12,color,fontFamily:"'Poppins', sans-serif",fontWeight:700}}>{label} · {score}%</span></div><div style={{height:6,background:"#001e3d",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${score}%`,background:color,borderRadius:3,transition:"width 0.6s ease"}}/></div></div>);
}

function AboutSections(){
  const h={fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:15,color:YELLOW,margin:"0 0 8px"};
  const p={fontSize:13,color:LIGHT,lineHeight:1.8,margin:"0 0 10px"};
  const link={color:YELLOW};
  const block={marginBottom:26};
  const list={fontSize:13,color:LIGHT,lineHeight:1.8,margin:"0 0 10px",paddingLeft:18};
  return(<div style={{textAlign:"left",marginTop:40,borderTop:"1px solid "+BORDER,paddingTop:30}}>
    <div style={block}>
      <h3 style={h}>About Get SAFE</h3>
      <p style={p}>Get SAFE (Support After Financial Exploitation) is the Academy of Life Planning's free public-interest programme for people affected by financial exploitation and institutional harm. It offers free AI-supported tools, structured training and practical methods to help you understand what has happened, organise your information and decide what to do next.</p>
      <p style={p}>We do not take over your case. We help you become more capable of managing it.</p>
      <p style={p}><a href="https://www.academyoflifeplanning.com/individuals/get-safe" target="_blank" rel="noopener noreferrer" style={link}>Learn more about Get SAFE</a></p>
    </div>
    <div style={block}>
      <h3 style={h}>About Goliathon</h3>
      <p style={p}>Goliathon is Get SAFE's evidence tool. You add your documents, and it reads them, builds a timeline, a case summary and key questions, and lets you ask questions about your own evidence. It keeps what your documents show separate from what it thinks they may mean, and everything it writes is an interpretation for you to check, not a legal or factual finding.</p>
      <p style={p}>Goliathon is educational and builds your capability. It does not give legal, financial or mental-health advice, and it is not case representation.</p>
    </div>
    <div style={block}>
      <h3 style={h}>Who pays for Goliathon</h3>
      <p style={p}>Goliathon is free to use. The Academy of Life Planning Ltd pays for maintaining the app and for the AI processing behind it, which Anthropic (the company that makes Claude) charges us for. Every document Goliathon reads and every question you ask uses some of that. To keep it sustainable for everyone, each case has a daily limit on chat messages.</p>
    </div>
    <div style={block}>
      <h3 style={h}>Your privacy</h3>
      <ul style={list}>
        <li>No account is needed. We do not use tracking cookies or advertising, and we do not sell data.</li>
        <li>Your dossier is saved under a random ID that is not linked to your identity. Your evidence and chat messages are sent to Claude (Anthropic) to produce the analysis.</li>
        <li>You can ask us to delete your dossier at any time.</li>
      </ul>
      <p style={p}><a href="/privacy" target="_blank" rel="noopener noreferrer" style={link}>Read the full privacy notice</a></p>
    </div>
    <div style={block}>
      <h3 style={h}>Support Get SAFE</h3>
      <p style={p}>You never need to contribute to use Goliathon. If it has helped you, or you would like to help keep it available to others, you can make a voluntary contribution towards the running costs. It is a payment to the Academy of Life Planning Ltd, of which Get SAFE is a trading style. It is not a charitable donation, and nothing is provided in return.</p>
      <p style={{margin:"0 0 10px"}}><a href="https://buy.stripe.com/dRm28r0MU6k77bb1vleIw01" target="_blank" rel="noopener noreferrer" style={{display:"inline-block",background:YELLOW,color:NAVY,borderRadius:8,fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:12,padding:"9px 18px",textDecoration:"none",letterSpacing:0.5}}>Support Get SAFE</a></p>
    </div>
    <p style={{fontSize:12,color:"#7a96b0",lineHeight:1.7,margin:0}}>Questions? Email <a href="mailto:steve@academyoflifeplanning.com" style={link}>steve@academyoflifeplanning.com</a></p>
  </div>);
}

function WelcomeScreen({onStart,onClose}){
  return(<div style={{fontFamily:"'Open Sans', sans-serif",background:NAVY,minHeight:"100vh",width:"100%",display:"flex",flexDirection:"column"}}>
    <div style={{background:NAVY,borderBottom:`3px solid ${YELLOW}`,padding:"16px 24px"}}><div style={{maxWidth:700,margin:"0 auto",display:"flex",alignItems:"center",gap:14}}><img src="/getsafe-logo.png" alt="Get SAFE" style={{width:44,height:44,objectFit:"contain"}}/><div><div style={{fontSize:9,letterSpacing:3,color:YELLOW,textTransform:"uppercase",fontFamily:"'Poppins', sans-serif"}}>Get SAFE · Academy of Life Planning</div><h1 style={{margin:0,fontFamily:"'Poppins', sans-serif",fontSize:24,fontWeight:800,color:WHITE}}>GOLIATHON</h1></div></div></div>
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:"40px 24px"}}>
      <div style={{maxWidth:600,width:"100%"}}>
        <div style={{textAlign:"center",marginBottom:36}}><div style={{fontSize:56,marginBottom:14}}>⚖️</div><h2 style={{fontFamily:"'Poppins', sans-serif",fontSize:26,fontWeight:800,color:WHITE,margin:"0 0 10px"}}>Turning survivors into strategists.</h2><p style={{fontSize:15,color:"#a0b4c8",lineHeight:1.8,margin:0}}>Evidence into action.</p></div>
        <div style={{background:PANEL,border:`1px solid ${BORDER}`,borderRadius:16,padding:28,marginBottom:20}}>
          <p style={{fontSize:14,color:LIGHT,lineHeight:1.8,margin:"0 0 20px"}}>Goliathon is a free AI-powered tool that builds a professional evidence dossier for anyone in a dispute with an institution — a bank, insurer, care home, claims company, or any organisation that has caused harm.</p>
          <div style={{display:"grid",gap:12}}>
            {[["📎","Upload any evidence","Letters, emails, PDFs, photos, Word docs, Outlook messages — Goliathon reads them all."],["⚡","Your dossier builds itself","Every upload is analysed, filed, and woven into your case automatically."],["🔗","Share with one link","Send a solicitor, MP, or journalist one secure URL to your complete dossier."],["📁","Manage multiple cases","Build separate dossiers for every dispute — all in one place."]].map(([icon,title,desc])=>(
              <div key={title} style={{display:"flex",gap:14,alignItems:"flex-start"}}><div style={{width:34,height:34,background:YELLOW+"20",border:`1px solid ${YELLOW}40`,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{icon}</div><div><div style={{fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:13,color:WHITE,marginBottom:2}}>{title}</div><div style={{fontSize:12,color:"#7a96b0",lineHeight:1.6}}>{desc}</div></div></div>
            ))}
          </div>
        </div>
        <div style={{textAlign:"center"}}>
          <Btn onClick={onStart} fullWidth>Start Building My Case →</Btn>
          {onClose&&<button onClick={onClose} style={{marginTop:12,background:"none",border:"none",color:"#7a96b0",fontSize:12,cursor:"pointer",fontFamily:"'Open Sans', sans-serif"}}>← Back to my dossier</button>}
          <p style={{margin:"12px 0 0",fontSize:11,color:"#5a7a96"}}>Free · No account required · Educational use only · Not legal advice</p><AboutSections/>
        </div>
      </div>
    </div>
  </div>);
}

function CaseSwitcher({cases,activeId,onSwitch,onNew,onDelete,onClearAll}){
  const [open,setOpen]=useState(false);
  const active=cases.find(c=>c.id===activeId);
  return(<div style={{position:"relative"}}>
    <button onClick={()=>setOpen(o=>!o)} style={{background:PANEL,border:`1px solid ${BORDER}`,borderRadius:8,padding:"6px 12px",color:LIGHT,fontSize:12,cursor:"pointer",fontFamily:"'Poppins', sans-serif",display:"flex",alignItems:"center",gap:8,maxWidth:180}}>
      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{active?.title||"My Case"}</span><span style={{color:YELLOW,fontSize:10}}>▼</span>
    </button>
    {open&&(<div style={{position:"absolute",top:"100%",left:0,marginTop:4,background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:10,padding:8,minWidth:220,zIndex:200,boxShadow:"0 8px 32px #00000080"}}>
      {cases.map(c=>(<div key={c.id} style={{display:"flex",alignItems:"center",gap:6,padding:"7px 10px",borderRadius:6,background:c.id===activeId?YELLOW+"20":"transparent",marginBottom:2}}>
        <button onClick={()=>{onSwitch(c.id);setOpen(false);}} style={{flex:1,background:"none",border:"none",color:c.id===activeId?YELLOW:LIGHT,fontSize:13,cursor:"pointer",textAlign:"left",fontFamily:"'Open Sans', sans-serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.title||"Untitled Case"}</button>
        {cases.length>1&&<button onClick={()=>{onDelete(c.id);setOpen(false);}} style={{background:"none",border:"none",color:"#e57373",fontSize:13,cursor:"pointer",padding:"0 4px",flexShrink:0}} title="Delete">✕</button>}
      </div>))}
      <div style={{borderTop:`1px solid ${BORDER}`,marginTop:8,paddingTop:8,display:"flex",gap:6}}>
        <button onClick={()=>{onNew();setOpen(false);}} style={{flex:1,background:YELLOW+"20",border:`1px solid ${YELLOW}40`,borderRadius:6,padding:"8px 10px",color:YELLOW,fontSize:12,cursor:"pointer",fontFamily:"'Poppins', sans-serif",fontWeight:700}}>+ New Case</button>
        <button onClick={()=>{if(window.confirm("Clear all case history and start fresh?"))onClearAll();setOpen(false);}} style={{background:"#c0392b20",border:"1px solid #e5737340",borderRadius:6,padding:"8px 10px",color:"#e57373",fontSize:11,cursor:"pointer",fontFamily:"'Poppins', sans-serif",fontWeight:700}}>Clear All</button>
      </div>
    </div>)}
  </div>);
}

function EditEvidenceModal({item,index,onSave,onDelete,onClose}){
  const [title,setTitle]=useState(item.title||"");
  const [date,setDate]=useState(item.date||"");
  const [type,setType]=useState(item.type||"");
  const [summary,setSummary]=useState(item.summary||"");
  const [factsObserved,setFactsObserved]=useState(item.facts_observed||"");
  const [significance,setSignificance]=useState(item.significance||"");
  const [showCorrection,setShowCorrection]=useState(false);
  const [correctionText,setCorrectionText]=useState("");
  const [correcting,setCorrecting]=useState(false);
  const [correctionError,setCorrectionError]=useState("");
  const field=(val,set,label)=>(<div style={{marginBottom:12}}><label style={{fontSize:11,color:"#a0b4c8",letterSpacing:1,textTransform:"uppercase",fontFamily:"'Poppins', sans-serif",display:"block",marginBottom:3}}>{label}</label>{label==="Summary"?<textarea value={val} onChange={e=>set(e.target.value)} rows={3} style={{width:"100%",background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:6,padding:"7px 10px",color:LIGHT,fontSize:13,outline:"none",fontFamily:"'Open Sans', sans-serif",resize:"vertical",boxSizing:"border-box"}}/>:<input value={val} onChange={e=>set(e.target.value)} style={{width:"100%",background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:6,padding:"7px 10px",color:LIGHT,fontSize:13,outline:"none",fontFamily:"'Open Sans', sans-serif",boxSizing:"border-box"}}/>}</div>);

  async function handleRequestCorrection(){
    if(!correctionText.trim())return;
    setCorrecting(true);setCorrectionError("");
    try{
      const prompt=`An evidence item in a case dossier has an inaccurate or wrong analysis. Correct it.

Current title: ${title}
Current summary: ${summary}
Current "what this shows" (facts): ${factsObserved}
Current "why it matters" (interpretation): ${significance}

The person reviewing this says the above is wrong. Their correction:
"${correctionText}"

Re-analyse this evidence item using the person's correction as the accurate position. Discard any part of the previous analysis that conflicts with the correction. Separate facts from interpretation strictly: "facts_observed" must contain ONLY what is now known to be factually/legally correct, with no speculation. "significance" must contain interpretation only, clearly flagged as such, and must not restate something as fact if it is actually contested or uncertain.

Return ONLY valid JSON, no preamble or markdown:
{"summary":"2-3 sentence corrected summary","facts_observed":"one sentence, corrected facts only — no interpretation","significance":"one sentence, corrected interpretation only — clearly distinguishable from fact"}`;
      const text=await callClaude([{role:"user",content:prompt}]);
      const parsed=extractJson(text);
      if(parsed.summary)setSummary(parsed.summary);
      if(parsed.facts_observed)setFactsObserved(parsed.facts_observed);
      if(parsed.significance)setSignificance(parsed.significance);
      setShowCorrection(false);setCorrectionText("");
    }catch(e){setCorrectionError("Could not re-analyse: "+(e.message||"unknown error")+". You can still edit the fields above directly.");}
    setCorrecting(false);
  }

  return(<div style={{position:"fixed",inset:0,background:"#000000cc",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div style={{background:PANEL,border:`1px solid ${BORDER}`,borderRadius:16,padding:26,maxWidth:480,width:"90%",maxHeight:"90vh",overflowY:"auto"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}><h3 style={{margin:0,fontFamily:"'Poppins', sans-serif",color:WHITE,fontSize:16,fontWeight:700}}>Edit Evidence #{String(index+1).padStart(3,"0")}</h3><Btn small variant="subtle" onClick={onClose}>✕</Btn></div>

      {!showCorrection&&<div style={{background:"#ffc72c14",border:"1px solid #ffc72c40",borderRadius:8,padding:"10px 12px",marginBottom:16}}>
        <p style={{margin:"0 0 8px",fontSize:12,color:"#c8dae6",lineHeight:1.6}}>Is the analysis below wrong? You can edit the fields directly, or tell Goliathon what's incorrect and have it redo the analysis.</p>
        <Btn small variant="subtle" onClick={()=>setShowCorrection(true)}>⟲ This is wrong — re-analyse with correction</Btn>
      </div>}

      {showCorrection&&<div style={{background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:8,padding:"12px 14px",marginBottom:16}}>
        <label style={{fontSize:11,color:"#a0b4c8",letterSpacing:1,textTransform:"uppercase",fontFamily:"'Poppins', sans-serif",display:"block",marginBottom:6}}>What's wrong, and what's the correct position?</label>
        <textarea value={correctionText} onChange={e=>setCorrectionText(e.target.value)} rows={4} placeholder='e.g. "Please do not assume X. The correct position is Y. The supporting evidence is document Z, page A."' style={{width:"100%",background:"#0a1929",border:`1px solid ${BORDER}`,borderRadius:6,padding:"8px 10px",color:LIGHT,fontSize:13,outline:"none",fontFamily:"'Open Sans', sans-serif",resize:"vertical",boxSizing:"border-box",marginBottom:10}}/>
        {correctionError&&<p style={{margin:"0 0 10px",fontSize:12,color:"#e57373"}}>{correctionError}</p>}
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <Btn small variant="subtle" onClick={()=>{setShowCorrection(false);setCorrectionText("");setCorrectionError("");}} disabled={correcting}>Cancel</Btn>
          <Btn small onClick={handleRequestCorrection} disabled={correcting||!correctionText.trim()}>{correcting?"Re-analysing…":"Re-analyse"}</Btn>
        </div>
      </div>}

      {field(title,setTitle,"Title")}{field(date,setDate,"Date")}{field(type,setType,"Type")}{field(summary,setSummary,"Summary")}{field(factsObserved,setFactsObserved,"What This Shows")}{field(significance,setSignificance,"Why It Matters")}
      <AIDisclaimer/>
      <div style={{display:"flex",gap:8,justifyContent:"space-between",marginTop:16}}>
        <Btn danger small onClick={()=>{if(window.confirm("Remove this item?"))onDelete(index);}}>🗑 Remove</Btn>
        <div style={{display:"flex",gap:8}}><Btn variant="subtle" small onClick={onClose}>Cancel</Btn><Btn small onClick={()=>onSave(index,{title,date,type,summary,facts_observed:factsObserved,significance})}>Save</Btn></div>
      </div>
    </div>
  </div>);
}

function EditWitnessModal({text,onSave,onClose}){
  const [value,setValue]=useState(text||"");
  const [showCorrection,setShowCorrection]=useState(false);
  const [correctionText,setCorrectionText]=useState("");
  const [correcting,setCorrecting]=useState(false);
  const [correctionError,setCorrectionError]=useState("");
  const [notice,setNotice]=useState("");

  async function handleRequestCorrection(){
    if(!correctionText.trim())return;
    setCorrecting(true);setCorrectionError("");
    try{
      // Only the paragraphs the correction affects are rewritten, so a long
      // statement is never retyped in full (and never cut short).
      const paras=splitParagraphs(value);
      const numbered=paras.map((p,i)=>"["+(i+1)+"] "+p).join("\n\n");
      const prompt=`A witness statement in a case dossier contains an inaccuracy. The statement is below, split into numbered paragraphs.

${numbered}

The person says part of this is wrong. Their correction:
"${correctionText}"

Identify only the paragraphs this correction affects and rewrite just those, applying the correction. Keep every other paragraph exactly as it is. Keep first person and plain English. Do not add events, motives or conclusions the correction does not give.

Always reply with ONLY valid JSON, no preamble, explanation or markdown:
{"edits":[{"paragraph":paragraph number,"revised":"the corrected paragraph, or an empty string to remove it"}]}
If no paragraph needs to change, reply {"edits":[]}.`;
      const responseText=await callClaude([{role:"user",content:prompt}]);
      const parsed=extractJson(responseText);
      const edits=Array.isArray(parsed.edits)?parsed.edits:[];
      const next=[...paras];let changed=0;
      edits.forEach(e=>{const i=Number(e&&e.paragraph)-1;if(i>=0&&i<next.length&&typeof e.revised==="string"){next[i]=e.revised.trim();changed++;}});
      if(!changed){setCorrectionError("Goliathon couldn't find a paragraph this correction applies to. You can edit the text directly below.");setCorrecting(false);return;}
      setValue(next.filter(Boolean).join("\n\n"));
      setNotice(changed+" paragraph"+(changed>1?"s":"")+" updated. Check the changes, then press Save (or Cancel to discard).");
      setShowCorrection(false);setCorrectionText("");
    }catch(e){setCorrectionError("Could not re-analyse: "+(e.message||"unknown error")+". You can still edit the text above directly.");}
    setCorrecting(false);
  }

  return(<div style={{position:"fixed",inset:0,background:"#000000cc",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div style={{background:PANEL,border:`1px solid ${BORDER}`,borderRadius:16,padding:26,maxWidth:520,width:"90%",maxHeight:"90vh",overflowY:"auto"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}><h3 style={{margin:0,fontFamily:"'Poppins', sans-serif",color:WHITE,fontSize:16,fontWeight:700}}>Edit Witness Statement</h3><Btn small variant="subtle" onClick={onClose}>✕</Btn></div>

      {!showCorrection&&<div style={{background:"#ffc72c14",border:"1px solid #ffc72c40",borderRadius:8,padding:"10px 12px",marginBottom:16}}>
        <p style={{margin:"0 0 8px",fontSize:12,color:"#c8dae6",lineHeight:1.6}}>Something inaccurate here? You can edit the text directly below, or tell Goliathon what's wrong and have it rewrite the statement.</p>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <Btn small variant="subtle" onClick={()=>setShowCorrection(true)}>⟲ This is wrong — re-analyse with correction</Btn>
          <Btn small variant="subtle" onClick={()=>{const sorted=sortWitnessByDate(value);if(sorted===value.trim()||sorted===value){setNotice("The paragraphs are already in date order.");}else{setValue(sorted);setNotice("Paragraphs put in date order. Check it reads well, then press Save (or Cancel to discard).");}}}>⇅ Put paragraphs in date order</Btn>
        </div>
      </div>}
      {notice&&<p style={{margin:"0 0 12px",fontSize:12,color:"#4ade80",lineHeight:1.5}}>{notice}</p>}

      {showCorrection&&<div style={{background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:8,padding:"12px 14px",marginBottom:16}}>
        <label style={{fontSize:11,color:"#a0b4c8",letterSpacing:1,textTransform:"uppercase",fontFamily:"'Poppins', sans-serif",display:"block",marginBottom:6}}>What's wrong, and what's the correct position?</label>
        <textarea value={correctionText} onChange={e=>setCorrectionText(e.target.value)} rows={4} placeholder='e.g. "The description of the insurance policy is wrong. The correct position is..."' style={{width:"100%",background:"#0a1929",border:`1px solid ${BORDER}`,borderRadius:6,padding:"8px 10px",color:LIGHT,fontSize:13,outline:"none",fontFamily:"'Open Sans', sans-serif",resize:"vertical",boxSizing:"border-box",marginBottom:10}}/>
        {correctionError&&<p style={{margin:"0 0 10px",fontSize:12,color:"#e57373"}}>{correctionError}</p>}
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <Btn small variant="subtle" onClick={()=>{setShowCorrection(false);setCorrectionText("");setCorrectionError("");}} disabled={correcting}>Cancel</Btn>
          <Btn small onClick={handleRequestCorrection} disabled={correcting||!correctionText.trim()}>{correcting?"Re-analysing…":"Re-analyse"}</Btn>
        </div>
      </div>}

      <label style={{fontSize:11,color:"#a0b4c8",letterSpacing:1,textTransform:"uppercase",fontFamily:"'Poppins', sans-serif",display:"block",marginBottom:3}}>Witness Statement</label>
      <textarea value={value} onChange={e=>setValue(e.target.value)} rows={10} style={{width:"100%",background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:6,padding:"9px 11px",color:LIGHT,fontSize:13,outline:"none",fontFamily:"'Open Sans', sans-serif",resize:"vertical",boxSizing:"border-box",lineHeight:1.6}}/>
      <AIDisclaimer/>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:16}}>
        <Btn variant="subtle" small onClick={onClose}>Cancel</Btn><Btn small onClick={()=>onSave(value)}>Save</Btn>
      </div>
    </div>
  </div>);
}

function EditTimelineModal({item,index,onSave,onDelete,onClose}){
  const [date,setDate]=useState(item.date||"");
  const [event,setEvent]=useState(item.event||"");
  const [evidenceRef,setEvidenceRef]=useState(item.evidence||"");
  const [showCorrection,setShowCorrection]=useState(false);
  const [correctionText,setCorrectionText]=useState("");
  const [correcting,setCorrecting]=useState(false);
  const [correctionError,setCorrectionError]=useState("");
  const field=(val,set,label,rows)=>(<div style={{marginBottom:12}}><label style={{fontSize:11,color:"#a0b4c8",letterSpacing:1,textTransform:"uppercase",fontFamily:"'Poppins', sans-serif",display:"block",marginBottom:3}}>{label}</label>{rows?<textarea value={val} onChange={e=>set(e.target.value)} rows={rows} style={{width:"100%",background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:6,padding:"7px 10px",color:LIGHT,fontSize:13,outline:"none",fontFamily:"'Open Sans', sans-serif",resize:"vertical",boxSizing:"border-box"}}/>:<input value={val} onChange={e=>set(e.target.value)} style={{width:"100%",background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:6,padding:"7px 10px",color:LIGHT,fontSize:13,outline:"none",fontFamily:"'Open Sans', sans-serif",boxSizing:"border-box"}}/>}</div>);

  async function handleRequestCorrection(){
    if(!correctionText.trim())return;
    setCorrecting(true);setCorrectionError("");
    try{
      const prompt=`A timeline entry in a case dossier is inaccurate. Correct it.

Current date: ${date}
Current event description: ${event}

The person says this is wrong. Their correction:
"${correctionText}"

Rewrite the timeline entry applying this correction. Goliathon orders the timeline by date automatically, so if the correction is only about where the entry sits, keep the date (or use the date the correction gives) and keep the event as it is. If you cannot apply the correction, return the current date and event unchanged.

Always reply with ONLY valid JSON, no preamble, explanation or markdown:
{"date":"corrected date as DD Mon YYYY","event":"corrected one-sentence event description"}`;
      const responseText=await callClaude([{role:"user",content:prompt}]);
      const parsed=extractJson(responseText);
      if(parsed.date)setDate(parsed.date);
      if(parsed.event)setEvent(parsed.event);
      setShowCorrection(false);setCorrectionText("");
    }catch(e){setCorrectionError((e.message||"Could not re-analyse")+". You can still edit the fields below directly. To move an entry, change its date and press Save.");}
    setCorrecting(false);
  }

  return(<div style={{position:"fixed",inset:0,background:"#000000cc",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div style={{background:PANEL,border:`1px solid ${BORDER}`,borderRadius:16,padding:26,maxWidth:480,width:"90%",maxHeight:"90vh",overflowY:"auto"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}><h3 style={{margin:0,fontFamily:"'Poppins', sans-serif",color:WHITE,fontSize:16,fontWeight:700}}>Edit Timeline Entry #{String(index+1).padStart(3,"0")}</h3><Btn small variant="subtle" onClick={onClose}>✕</Btn></div>

      {!showCorrection&&<div style={{background:"#ffc72c14",border:"1px solid #ffc72c40",borderRadius:8,padding:"10px 12px",marginBottom:16}}>
        <p style={{margin:"0 0 8px",fontSize:12,color:"#c8dae6",lineHeight:1.6}}>Is this entry wrong? You can edit the fields directly, or tell Goliathon what's incorrect and have it redo it.</p>
        <Btn small variant="subtle" onClick={()=>setShowCorrection(true)}>⟲ This is wrong — re-analyse with correction</Btn>
      </div>}

      {showCorrection&&<div style={{background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:8,padding:"12px 14px",marginBottom:16}}>
        <label style={{fontSize:11,color:"#a0b4c8",letterSpacing:1,textTransform:"uppercase",fontFamily:"'Poppins', sans-serif",display:"block",marginBottom:6}}>What's wrong, and what's the correct position?</label>
        <textarea value={correctionText} onChange={e=>setCorrectionText(e.target.value)} rows={4} placeholder='e.g. "This case law reference does not apply. The correct position is..."' style={{width:"100%",background:"#0a1929",border:`1px solid ${BORDER}`,borderRadius:6,padding:"8px 10px",color:LIGHT,fontSize:13,outline:"none",fontFamily:"'Open Sans', sans-serif",resize:"vertical",boxSizing:"border-box",marginBottom:10}}/>
        {correctionError&&<p style={{margin:"0 0 10px",fontSize:12,color:"#e57373"}}>{correctionError}</p>}
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <Btn small variant="subtle" onClick={()=>{setShowCorrection(false);setCorrectionText("");setCorrectionError("");}} disabled={correcting}>Cancel</Btn>
          <Btn small onClick={handleRequestCorrection} disabled={correcting||!correctionText.trim()}>{correcting?"Re-analysing…":"Re-analyse"}</Btn>
        </div>
      </div>}

      {field(date,setDate,"Date")}
      <p style={{margin:"-6px 0 12px",fontSize:11,color:parseDateLoose(date)===null&&date.trim()?"#e57373":"#7a96b0",lineHeight:1.5}}>{parseDateLoose(date)===null&&date.trim()?"Goliathon can't read this date, so the entry will sit at the end of the timeline. Try a format like 25 Nov 2025.":"The timeline is kept in date order automatically. To move this entry, change its date and press Save."}</p>
      {field(event,setEvent,"Event",3)}{field(evidenceRef,setEvidenceRef,"Evidence Reference")}
      <AIDisclaimer/>
      <div style={{display:"flex",gap:8,justifyContent:"space-between",marginTop:16}}>
        <Btn danger small onClick={()=>{if(window.confirm("Remove this timeline entry?"))onDelete(index);}}>🗑 Remove</Btn>
        <div style={{display:"flex",gap:8}}><Btn variant="subtle" small onClick={onClose}>Cancel</Btn><Btn small onClick={()=>onSave(index,{date,event,evidence:evidenceRef})}>Save</Btn></div>
      </div>
    </div>
  </div>);
}

function ShareModal({shareId,onClose}){
  const url=`${window.location.origin}/dossier/${shareId}`;
  const [copied,setCopied]=useState(false);
  const copy=()=>{navigator.clipboard.writeText(url);setCopied(true);setTimeout(()=>setCopied(false),2000);};
  return(<div style={{position:"fixed",inset:0,background:"#000000cc",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div style={{background:PANEL,border:`1px solid ${BORDER}`,borderRadius:16,padding:32,maxWidth:460,width:"90%"}}>
      <div style={{textAlign:"center",marginBottom:20}}><div style={{fontSize:36,marginBottom:10}}>🔗</div><h3 style={{margin:0,fontFamily:"'Poppins', sans-serif",color:WHITE,fontSize:19,fontWeight:700}}>Share Your Dossier</h3><p style={{color:"#7a96b0",fontSize:13,margin:"8px 0 0",lineHeight:1.6}}>Anyone with this link can view your dossier in read-only mode. Only share with people you trust.</p></div>
      <div style={{background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:8,padding:"10px 14px",marginBottom:14,wordBreak:"break-all",fontSize:13,color:YELLOW,fontFamily:"monospace"}}>{url}</div>
      <div style={{display:"flex",gap:8}}><Btn onClick={copy} fullWidth>{copied?"✓ Copied!":"Copy Link"}</Btn><Btn variant="subtle" onClick={onClose}>Close</Btn></div>
      <p style={{margin:"14px 0 0",fontSize:11,color:"#5a7a96",textAlign:"center"}}>This link always shows the latest version of your dossier.</p>
    </div>
  </div>);
}

function DownloadModal({dossier,onClose}){
  const opts=[
    {label:"Complete Dossier",desc:"All sections — full branded PDF",icon:"📁",action:()=>downloadPdf("complete",dossier)},
    {label:"Decision-Maker Summary",desc:"One page for judge or ombudsman",icon:"⚖️",action:()=>downloadPdf("decisionsummary",dossier)},
      {label:"Case Overview",desc:"Summary and context",icon:"📋",action:()=>downloadPdf("overview",dossier)},
    {label:"Timeline",desc:"Chronological events",icon:"📅",action:()=>downloadPdf("timeline",dossier)},
    {label:"Witness Statement",desc:"First-person account",icon:"📝",action:()=>downloadPdf("statement",dossier)},
    {label:"Evidence Library",desc:"All items with cover notes",icon:"🗂️",action:()=>downloadPdf("evidence",dossier)},
    {label:"Next Steps",desc:"Priority actions",icon:"📌",action:()=>downloadPdf("nextsteps",dossier)},
    {label:"Key Questions",desc:"What this case still needs to answer",icon:"❓",action:()=>downloadPdf("keyquestions",dossier)},
    {label:"The Strongest Answer to Your Case",desc:"Evidence-based counter-position",icon:"⚔️",action:()=>downloadPdf("institutionresponse",dossier)},
  ];
  return(<div style={{position:"fixed",inset:0,background:"#000000cc",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div style={{background:PANEL,border:`1px solid ${BORDER}`,borderRadius:16,padding:24,maxWidth:460,width:"90%",maxHeight:"90vh",overflowY:"auto"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}><h3 style={{margin:0,fontFamily:"'Poppins', sans-serif",color:WHITE,fontSize:17,fontWeight:700}}>Download Dossier</h3><Btn variant="subtle" small onClick={onClose}>✕</Btn></div>
      {opts.map((o,i)=>(<div key={i} onClick={o.action} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 12px",background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:10,marginBottom:7,cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.borderColor=YELLOW+"60"} onMouseLeave={e=>e.currentTarget.style.borderColor=BORDER}><span style={{fontSize:20,flexShrink:0}}>{o.icon}</span><div style={{flex:1}}><div style={{fontFamily:"'Poppins', sans-serif",fontWeight:700,color:WHITE,fontSize:13,marginBottom:1}}>{o.label}</div><div style={{fontSize:11,color:"#7a96b0"}}>{o.desc}</div></div><span style={{color:YELLOW,fontSize:15}}>↓</span></div>))}
    </div>
  </div>);
}

// ── CASE VIEW ─────────────────────────────────────────────────────────────────
// One layout for every case, small or very large (tested with 130+ items):
//   1. "Case at a glance": status, top next steps and key questions, overview.
//   2. A sticky tab bar, so only one long section is on screen at a time.
//   3. Timeline grouped by year, evidence as compact searchable rows.
// Used by both the main page and the read-only shared view (readOnly).

// Splits a numbered or bulleted block into separate items.
function toItems(value){
  const text=cleanNumbering(toDisplayText(value));
  const items=[];
  text.split("\n").forEach(raw=>{
    const line=raw.trim();
    if(!line)return;
    const m=line.match(/^(?:\d{1,2}[.)]|[-*•])\s+(.*)$/);
    if(m)items.push(m[1]);
    else if(items.length)items[items.length-1]+=" "+line;
    else items.push(line);
  });
  return items;
}
function yearOf(date){const m=String(date||"").match(/\b(1[89]\d{2}|20\d{2})\b/);return m?m[1]:"Undated";}
const smallInput={background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:8,padding:"7px 10px",color:WHITE,fontSize:13,outline:"none",fontFamily:"'Open Sans', sans-serif",boxSizing:"border-box"};
const linkBtn={background:"none",border:"none",color:YELLOW,fontSize:12,fontWeight:600,cursor:"pointer",padding:0,fontFamily:"'Poppins', sans-serif"};
const tinyBtn={background:"none",border:`1px solid ${BORDER}`,borderRadius:4,padding:"2px 7px",color:YELLOW,fontSize:10,cursor:"pointer",flexShrink:0};

function GlanceList({title,items,emptyText,onSeeAll}){
  return(<div style={{background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:10,padding:"12px 14px"}}>
    <div style={{fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:12,color:YELLOW,letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>{title}</div>
    {!items.length?<EmptyState text={emptyText}/>:<>
      {items.slice(0,3).map((it,i)=>(<div key={i} style={{display:"flex",gap:8,marginBottom:6,fontSize:13,lineHeight:1.6,color:LIGHT}}><span style={{color:YELLOW,fontWeight:700,minWidth:16}}>{i+1}.</span><span style={{flex:1}}><InlineText text={it}/></span></div>))}
      {items.length>3&&<button onClick={onSeeAll} style={linkBtn}>See all {items.length} →</button>}
    </>}
  </div>);
}

function CaseAtAGlance({dossier,onSeeAll,onOpenAllegations,onRefreshOverview,refreshingOverview}){
  const tl=dossier.timeline||[],ev=dossier.evidence||[];
  const dated=sortTimeline(tl).filter(t=>parseDateLoose(t&&t.date)!=null);
  const range=dated.length?`${dated[0].date} – ${dated[dated.length-1].date}`:null;
  const status=[`${ev.length} document${ev.length!==1?"s":""}`,`${tl.length} timeline event${tl.length!==1?"s":""}`,range,dossier.updated_at?`updated ${formatDate(dossier.updated_at)}`:null].filter(Boolean);
  return(<Panel title="Case at a glance" icon="🧭">
    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>{status.map((s,i)=><Tag key={i} color={i===0?YELLOW:"#7a96b0"}>{s}</Tag>)}</div>
    {dossier.allegations?.items?.length>0&&<div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:14,fontSize:12,color:LIGHT}}>
      <span style={{fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:12,color:YELLOW,letterSpacing:1,textTransform:"uppercase"}}>Central allegations</span>
      {[1,2,3].map(n=>{const c=dossier.allegations.items.filter(a=>Number(a.level)===n).length;return c?<LevelBadge key={n} level={n} prefix={`${c} × `}/>:null;})}
      {onOpenAllegations&&<button onClick={onOpenAllegations} style={linkBtn}>Open →</button>}
    </div>}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))",gap:12,marginBottom:14}}>
      <GlanceList title="Next steps" items={toItems(dossier.next_steps)} emptyText="Next steps will appear as you add evidence." onSeeAll={onSeeAll}/>
      <GlanceList title="Key questions" items={toItems(dossier.key_questions)} emptyText="Key questions will appear as you add evidence." onSeeAll={onSeeAll}/>
    </div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:6}}>
      <span style={{fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:12,color:YELLOW,letterSpacing:1,textTransform:"uppercase"}}>Overview</span>
      <div style={{display:"flex",gap:6}}>
        {onRefreshOverview&&<Btn small variant="ghost" disabled={refreshingOverview||!tl.length} onClick={onRefreshOverview}>{refreshingOverview?"Refreshing…":"⟳ Refresh"}</Btn>}
        <Btn small variant="ghost" onClick={()=>downloadPdf("overview",dossier)}>↓</Btn>
      </div>
    </div>
    {dossier.overview?<FormattedText text={toDisplayText(dossier.overview)} color={LIGHT} lineHeight={1.8}/>:<EmptyState text="Building overview…"/>}
  </Panel>);
}

function CaseTabs({tabs,active,onChange}){
  return(<div style={{position:"sticky",top:0,zIndex:20,background:NAVY,padding:"8px 0",marginBottom:12,borderBottom:`1px solid ${BORDER}`}}>
    <div role="tablist" style={{display:"flex",gap:6,overflowX:"auto"}}>
      {tabs.map(t=>{const on=t.id===active;return(
        <button key={t.id} role="tab" aria-selected={on} onClick={()=>onChange(t.id)} style={{flexShrink:0,background:on?YELLOW:PANEL,color:on?NAVY:LIGHT,border:`1px solid ${on?YELLOW:BORDER}`,borderRadius:20,padding:"7px 14px",fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>
          {t.label}{t.count!=null&&<span style={{marginLeft:6,opacity:0.7,fontWeight:600}}>{t.count}</span>}
        </button>);})}
    </div>
  </div>);
}

function TimelineView({dossier,onEdit}){
  const timeline=dossier.timeline||[];
  const [q,setQ]=useState("");
  const [openYears,setOpenYears]=useState(null); // null = default: latest year open
  const [shown,setShown]=useState({});
  const sorted=sortTimeline(timeline);
  const pos=new Map(sorted.map((t,i)=>[t,i+1]));
  const needle=q.trim().toLowerCase();
  const visible=needle?sorted.filter(t=>`${t.date||""} ${t.event||""} ${t.evidence||""}`.toLowerCase().includes(needle)):sorted;
  const groups=[];visible.forEach(t=>{const y=yearOf(t.date);let g=groups.find(x=>x.year===y);if(!g){g={year:y,items:[]};groups.push(g);}g.items.push(t);});
  // Newest year first (events inside a year stay in date order); undated last.
  groups.sort((a,b)=>a.year==="Undated"?1:b.year==="Undated"?-1:b.year.localeCompare(a.year));
  const datedYears=groups.filter(g=>g.year!=="Undated");
  const defaultOpen=new Set(datedYears.length?[datedYears[0].year]:groups.map(g=>g.year));
  const isOpen=y=>needle?true:(openYears||defaultOpen).has(y);
  const toggle=y=>{const s=new Set(openYears||defaultOpen);s.has(y)?s.delete(y):s.add(y);setOpenYears(s);};
  return(<Panel title={`Timeline — ${timeline.length} event${timeline.length!==1?"s":""}`} icon="📅" action={<Btn small variant="ghost" onClick={()=>downloadPdf("timeline",dossier)}>↓</Btn>}>
    {!timeline.length?<EmptyState text="Timeline building…"/>:<>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:12}}>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search the timeline…" aria-label="Search the timeline" style={{...smallInput,flex:1,minWidth:180}}/>
        {!needle&&<><button style={linkBtn} onClick={()=>setOpenYears(new Set(groups.map(g=>g.year)))}>Open all</button><button style={linkBtn} onClick={()=>setOpenYears(new Set())}>Close all</button></>}
      </div>
      {needle&&<p style={{margin:"0 0 10px",fontSize:12,color:"#7a96b0"}}>{visible.length} of {timeline.length} events match.</p>}
      {groups.map(g=>{const open=isOpen(g.year);const limit=shown[g.year]||25;return(<div key={g.year} style={{marginBottom:8}}>
        <button onClick={()=>!needle&&toggle(g.year)} aria-expanded={open} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:8,padding:"8px 12px",color:WHITE,cursor:needle?"default":"pointer",fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:13}}>
          <span>{g.year} <span style={{color:"#7a96b0",fontWeight:600,fontSize:12}}>· {g.items.length} event{g.items.length!==1?"s":""}</span></span><span style={{color:YELLOW}}>{open?"▾":"▸"}</span>
        </button>
        {open&&<div style={{padding:"10px 4px 0"}}>
          {g.items.slice(0,limit).map(t=>{const raw=timeline.indexOf(t);return(<div key={raw} style={{display:"flex",gap:10,marginBottom:10,paddingBottom:10,borderBottom:`1px solid ${BORDER}`}}>
            <div style={{minWidth:26,height:22,background:YELLOW,borderRadius:11,padding:"0 6px",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:10,color:NAVY,flexShrink:0,boxSizing:"border-box"}}>{pos.get(t)}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8}}><div style={{fontSize:11,color:YELLOW,fontWeight:600,marginBottom:2}}>{t.date||"Date unknown"}</div>{onEdit&&<button onClick={()=>onEdit(raw)} aria-label="Edit timeline entry" style={tinyBtn}>✏</button>}</div>
              <div style={{fontSize:13,color:LIGHT,lineHeight:1.6}}><InlineText text={t.event||""}/></div>
            </div>
          </div>);})}
          {g.items.length>limit&&<button style={linkBtn} onClick={()=>setShown({...shown,[g.year]:limit+25})}>Show {Math.min(25,g.items.length-limit)} more of {g.items.length-limit} →</button>}
        </div>}
      </div>);})}
    </>}
  </Panel>);
}

function EvidenceView({dossier,onEdit,onMove}){
  const evidence=dossier.evidence||[];
  const [q,setQ]=useState("");
  const [type,setType]=useState("all");
  const [sort,setSort]=useState("newest");
  const [openIdx,setOpenIdx]=useState(null);
  const [limit,setLimit]=useState(30);
  const types=[...new Set(evidence.map(e=>e.type).filter(Boolean))].sort();
  const needle=q.trim().toLowerCase();
  let rows=evidence.map((e,ri)=>({e,ri}));
  if(type!=="all")rows=rows.filter(r=>r.e.type===type);
  if(needle)rows=rows.filter(r=>`${r.e.title||""} ${r.e.summary||""} ${r.e.facts_observed||""} ${r.e.significance||""} ${r.e.date||""} ${(r.e.attachments||[]).map(a=>`${a.filename} ${a.title||""} ${a.summary||""} ${a.facts_observed||""}`).join(" ")}`.toLowerCase().includes(needle));
  if(sort==="newest")rows=rows.slice().reverse();
  if(sort==="date"){const d=r=>parseDateLoose(r.e.date);rows=rows.slice().sort((a,b)=>{const x=d(a),y=d(b);if(x==null&&y==null)return a.ri-b.ri;if(x==null)return 1;if(y==null)return-1;return x-y||a.ri-b.ri;});}
  const canMove=onMove&&sort!=="date"&&!needle&&type==="all";
  return(<Panel title={`Evidence Library — ${evidence.length} item${evidence.length!==1?"s":""}`} icon="🗂️" action={<Btn small variant="ghost" onClick={()=>downloadPdf("evidence",dossier)}>↓</Btn>}>
    {!evidence.length?<EmptyState text="No evidence uploaded yet."/>:<>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
        <input value={q} onChange={e=>{setQ(e.target.value);setLimit(30);}} placeholder="Search evidence…" aria-label="Search evidence" style={{...smallInput,flex:1,minWidth:180}}/>
        {types.length>1&&<select value={type} onChange={e=>{setType(e.target.value);setLimit(30);}} aria-label="Filter by type" style={smallInput}><option value="all">All types</option>{types.map(t=><option key={t} value={t}>{t}</option>)}</select>}
        <select value={sort} onChange={e=>setSort(e.target.value)} aria-label="Sort evidence" style={smallInput}><option value="newest">Newest added first</option><option value="oldest">Oldest added first</option><option value="date">By document date</option></select>
      </div>
      {(needle||type!=="all")&&<p style={{margin:"0 0 10px",fontSize:12,color:"#7a96b0"}}>{rows.length} of {evidence.length} items match.</p>}
      {rows.slice(0,limit).map(({e,ri})=>{const open=openIdx===ri;return(<div key={ri} style={{background:"#001e3d",border:`1px solid ${open?YELLOW+"60":BORDER}`,borderRadius:8,marginBottom:6}}>
        <button onClick={()=>setOpenIdx(open?null:ri)} aria-expanded={open} style={{width:"100%",display:"flex",alignItems:"center",gap:8,background:"none",border:"none",padding:"9px 12px",cursor:"pointer",textAlign:"left",color:WHITE}}>
          <span style={{fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:11,color:YELLOW,flexShrink:0}}>#{String(ri+1).padStart(3,"0")}</span>
          <span style={{flex:1,minWidth:0,fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:open?"normal":"nowrap"}}>{e.title||"Untitled"}</span>
          {(e.attachments||[]).length>0&&<span title={`${e.attachments.length} attachment${e.attachments.length!==1?"s":""}`} style={{fontSize:11,color:"#a0b4c8",flexShrink:0}}>📎 {e.attachments.length}</span>}
          {e.date&&<span style={{fontSize:11,color:"#a0b4c8",flexShrink:0}}>{e.date}</span>}
          <span style={{color:YELLOW,flexShrink:0}}>{open?"▾":"▸"}</span>
        </button>
        {open&&<div style={{padding:"0 12px 12px"}}>
          {e.type&&<div style={{marginBottom:6}}><Tag color="#7a96b0">{e.type}</Tag></div>}
          {e.summary&&<p style={{margin:"0 0 6px",fontSize:12,color:LIGHT,lineHeight:1.6}}><InlineText text={e.summary}/></p>}
          {e.facts_observed&&<p style={{margin:"0 0 4px",fontSize:11,color:"#a0b4c8",lineHeight:1.6}}><span style={{fontWeight:600,textTransform:"uppercase",fontSize:10,letterSpacing:"0.05em"}}>What this shows: </span><InlineText text={e.facts_observed}/></p>}
          {e.significance&&<><p style={{margin:0,fontSize:11,color:YELLOW,lineHeight:1.6}}><span style={{fontWeight:600,textTransform:"uppercase",fontSize:10,letterSpacing:"0.05em"}}>Why it matters: </span><InlineText text={e.significance}/></p><AIDisclaimer compact/></>}
          {(e.attachments||[]).length>0&&<div style={{marginTop:10,borderTop:`1px solid ${BORDER}`,paddingTop:8}}>
            <div style={{fontSize:10,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",color:"#a0b4c8",marginBottom:6}}>Attachments ({e.attachments.length})</div>
            {e.attachments.map((a,k)=>(<div key={k} style={{marginBottom:8,paddingLeft:10,borderLeft:`2px solid ${a.not_read?"#e5737360":YELLOW+"60"}`}}>
              <div style={{fontSize:12,color:WHITE,fontWeight:600}}><span style={{color:YELLOW,marginRight:6}}>{attachmentLabel(ri+1,k)}</span>{a.title||a.filename}{a.date&&<span style={{color:"#a0b4c8",fontWeight:400}}> · {a.date}</span>}</div>
              {a.title&&a.title!==a.filename&&<div style={{fontSize:10,color:"#7a96b0"}}>{a.filename}</div>}
              {a.summary&&<div style={{fontSize:11,color:a.not_read?"#e57373":LIGHT,lineHeight:1.6,marginTop:2}}><InlineText text={a.summary}/></div>}
              {a.facts_observed&&<div style={{fontSize:11,color:"#a0b4c8",lineHeight:1.6,marginTop:2}}><span style={{fontWeight:600,textTransform:"uppercase",fontSize:10,letterSpacing:"0.05em"}}>What this shows: </span><InlineText text={a.facts_observed}/></div>}
            </div>))}
          </div>}
          {(onEdit||canMove)&&<div style={{display:"flex",gap:6,marginTop:10}}>
            {onEdit&&<button onClick={()=>onEdit(ri)} style={tinyBtn}>✏ Edit</button>}
            {canMove&&<><button onClick={()=>onMove(ri,-1)} disabled={ri===0} style={{...tinyBtn,opacity:ri===0?0.3:1}}>↑ Move earlier</button><button onClick={()=>onMove(ri,1)} disabled={ri===evidence.length-1} style={{...tinyBtn,opacity:ri===evidence.length-1?0.3:1}}>↓ Move later</button></>}
          </div>}
        </div>}
      </div>);})}
      {rows.length>limit&&<button style={linkBtn} onClick={()=>setLimit(limit+30)}>Show {Math.min(30,rows.length-limit)} more of {rows.length-limit} →</button>}
    </>}
  </Panel>);
}

function StatementView({dossier,onEdit}){
  const [full,setFull]=useState(false);
  const text=toDisplayText(dossier.witness_statement);
  const paras=splitParagraphs(text);
  const long=paras.length>3;
  return(<Panel title="Witness Statement" icon="📝" action={<div style={{display:"flex",gap:6}}>{onEdit&&<Btn small variant="ghost" onClick={onEdit}>✏</Btn>}<Btn small variant="ghost" onClick={()=>downloadPdf("statement",dossier)}>↓</Btn></div>}>
    {!text?<EmptyState text="Building statement…"/>:<>
      {long&&<p style={{margin:"0 0 10px",fontSize:12,color:"#7a96b0"}}>{paras.length} paragraphs, in date order.</p>}
      <p style={{margin:0,fontSize:13,lineHeight:1.9,color:LIGHT,whiteSpace:"pre-wrap"}}>{(long&&!full?paras.slice(0,2):paras).join("\n\n")}</p>
      {long&&<button style={{...linkBtn,marginTop:10}} onClick={()=>setFull(!full)}>{full?"Show less ↑":`Read the full statement (${paras.length-2} more paragraphs) →`}</button>}
    </>}
  </Panel>);
}

function TextPanel({title,icon,text,download,disclaimer,intro,emptyText,cleanNums}){
  return(<Panel title={title} icon={icon} action={download?<Btn small variant="ghost" onClick={download}>↓</Btn>:null}>
    {intro}
    {text?<><FormattedText text={cleanNums?cleanNumbering(toDisplayText(text)):toDisplayText(text)} color={LIGHT} lineHeight={1.8}/>{disclaimer&&<AIDisclaimer/>}</>:<EmptyState text={emptyText}/>}
  </Panel>);
}

// ── ALLEGATION LADDER, CHECK MY LETTER, ONE-PAGE BRIEF ───────────────────────
// Three levels, each needing more evidence than the last:
//   1 Unfair or damaging treatment  — the person's experience and judgement
//   2 Procedural irregularity        — a rule or duty applied and was not followed
//   3 Criminal conduct               — explicit, precise evidence of a dishonest act and intent
// Before level 2 or 3, check there WAS a duty. Goliathon never decides that
// a crime happened: it shows what the evidence filed so far supports, and
// how to ask the right body to explain or investigate.
const LADDER=[
  {level:1,name:"Unfair or damaging treatment",needs:"Your own account of what happened and how it affected you. This is largely a matter of judgement, so it needs the least evidence.",color:"#7a96b0"},
  {level:2,name:"Procedural irregularity",needs:"The specific rule, duty or procedure that applied, where it comes from, and a record showing it was not followed.",color:YELLOW},
  {level:3,name:"Criminal conduct",needs:"Explicit, precise evidence of a dishonest act and intent by an identified person, such as fraud or corruption. Raise it with the police or prosecutor as a suspicion, not as a finding in a letter.",color:"#e57373"},
];
const LADDER_RULES=`THE ALLEGATION LADDER (apply it strictly):
Level 1, unfair or damaging treatment: the person's experience that they were treated unfairly. Needs their account and context.
Level 2, procedural irregularity: a decision or process did not follow a rule, duty or procedure that applied. Needs (a) the specific rule or duty and its source and (b) a record showing it was not followed.
Level 3, criminal conduct (fraud, corruption, collusion, conspiracy, perverting the course of justice): needs explicit, precise evidence of a dishonest act and intent by an identified person.
DUTY CHECK: before level 2 or 3, ask whether the person or body actually had a duty to act. If no duty can be identified from the evidence, the point is level 1.
Evidence of something unexplained is not evidence of a crime, and evidence of an error is not evidence of dishonesty. Never state that anyone committed a crime; a level 3 point is a suspicion to report to the police or a prosecutor.`;
function levelInfo(n){return LADDER.find(l=>l.level===Number(n))||LADDER[0];}
function LevelBadge({level,prefix}){const l=levelInfo(level);return <span style={{background:l.color+"20",color:l.color,border:`1px solid ${l.color}60`,borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700,fontFamily:"'Poppins', sans-serif",whiteSpace:"nowrap"}}>{prefix||""}Level {l.level} · {l.name}</span>;}

function LadderKey(){
  return(<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))",gap:8,marginBottom:14}}>
    {LADDER.map(l=>(<div key={l.level} style={{background:"#001e3d",border:`1px solid ${BORDER}`,borderTop:`3px solid ${l.color}`,borderRadius:8,padding:"10px 12px"}}>
      <div style={{fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:12,color:l.color,marginBottom:4}}>Level {l.level} · {l.name}</div>
      <div style={{fontSize:12,color:LIGHT,lineHeight:1.6}}>{l.needs}</div>
    </div>))}
  </div>);
}

async function generateAllegations(dossier){
  const prompt=`${buildExistingCaseContext(dossier)}

${LADDER_RULES}

Identify the 3 to 5 CENTRAL allegations in this case: the points the person most needs answered or put right. For each, judge the HIGHEST level the evidence filed so far actually supports, not the level the person may believe. Where the person's own documents frame a point at a higher level than the evidence supports, record that in level_claimed. Be respectful: the point is to show what each allegation needs, not to dismiss it.

Return ONLY valid JSON, with no text before or after it:
{"allegations":[{"allegation":"one plain sentence, written as an allegation and not as a fact","against":"the person or body it concerns","level":1,"level_claimed":1,"duty":"the specific rule, duty or procedure relied on and its source, or Not yet identified","evidence":["#012","#045"],"evidence_summary":"at most 50 words: what the cited items show","missing":"at most 50 words: what would be needed to support this at its level, or to raise it a level","suggested_wording":"one or two sentences of evidence-led wording for a letter: describe the evidence, name the discrepancy, ask the right body to explain or investigate"}],"note":"one sentence on the overall picture"}`;
  const parsed=extractJson(await callClaude([{role:"user",content:prompt}]));
  if(!parsed||!Array.isArray(parsed.allegations))throw new Error("The analysis came back incomplete. Please try again.");
  return {items:parsed.allegations.slice(0,5).map(a=>({...a,level:Math.min(3,Math.max(1,Number(a.level)||1)),level_claimed:a.level_claimed?Math.min(3,Math.max(1,Number(a.level_claimed)||1)):null})),note:toDisplayText(parsed.note),generated_at:new Date().toISOString(),evidence_count:(dossier.evidence||[]).length};
}

function AllegationsView({dossier,readOnly,onSave}){
  const [busy,setBusy]=useState(false);
  const al=dossier.allegations;
  const stale=al&&al.evidence_count!==(dossier.evidence||[]).length;
  const run=async()=>{setBusy(true);try{onSave(await generateAllegations(dossier));}catch(e){alert("Couldn't draft the allegations just now. Please try again.\n\n"+e.message);}setBusy(false);};
  return(<Panel title="Central Allegations" icon="🪜" action={!readOnly&&<Btn small variant="ghost" disabled={busy||!(dossier.evidence||[]).length} onClick={run}>{busy?"Working…":al?"⟳ Redo":"Draft them"}</Btn>}>
    <p style={{margin:"0 0 12px",fontSize:13,color:LIGHT,lineHeight:1.7}}>Every allegation sits on a ladder. The higher the level, the more precise the evidence must be. <strong>Don't send the verdict. Send the evidence.</strong></p>
    <LadderKey/>
    <p style={{margin:"0 0 14px",fontSize:12,color:"#a0b4c8",lineHeight:1.6}}>Before claiming level 2 or 3, check there was a <strong>duty</strong>: a rule that required them to act. If none can be found, the point stays at level 1, and it may still matter a great deal.</p>
    {!al?<EmptyState text={readOnly?"No allegations drafted yet.":busy?"Reading the whole case…":"Goliathon can draft the central allegations in this case and show what each one needs. You stay the author: check, correct and reword them."}/>:<>
      {stale&&!readOnly&&<p style={{margin:"0 0 10px",fontSize:12,color:YELLOW}}>Evidence has been added since these were drafted. Press Redo to update them.</p>}
      {al.note&&<p style={{margin:"0 0 12px",fontSize:13,color:LIGHT,lineHeight:1.7,fontStyle:"italic"}}>{al.note}</p>}
      {(al.items||[]).map((a,i)=>(<div key={i} style={{background:"#001e3d",border:`1px solid ${BORDER}`,borderLeft:`4px solid ${levelInfo(a.level).color}`,borderRadius:8,padding:"12px 14px",marginBottom:10}}>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
          <LevelBadge level={a.level} prefix="Supported: "/>
          {a.level_claimed&&a.level_claimed>a.level&&<LevelBadge level={a.level_claimed} prefix="Framed as: "/>}
        </div>
        <div style={{fontSize:14,fontWeight:600,color:WHITE,lineHeight:1.6,marginBottom:4}}><InlineText text={toDisplayText(a.allegation)}/></div>
        {a.against&&<div style={{fontSize:12,color:"#a0b4c8",marginBottom:8}}>Concerns: {toDisplayText(a.against)}</div>}
        {[["Duty or rule relied on",a.duty],["Evidence",[(a.evidence||[]).join(", "),toDisplayText(a.evidence_summary)].filter(Boolean).join(": ")],["What's missing",a.missing],["Evidence-led wording",a.suggested_wording]].filter(([,v])=>v).map(([k,v])=>(<p key={k} style={{margin:"0 0 6px",fontSize:12,color:k==="Evidence-led wording"?YELLOW:LIGHT,lineHeight:1.6}}><span style={{fontWeight:600,textTransform:"uppercase",fontSize:10,letterSpacing:"0.05em",color:"#a0b4c8"}}>{k}: </span><InlineText text={toDisplayText(v)}/></p>))}
      </div>))}
      <AIDisclaimer/>
      <p style={{margin:"6px 0 0",fontSize:11,color:"#5a7a96"}}>Drafted {formatDate(al.generated_at)} from {al.evidence_count} items. Saved in this browser with the case.</p>
    </>}
  </Panel>);
}

function CopyBtn({text,label="Copy"}){
  const [done,setDone]=useState(false);
  return <Btn small variant="ghost" onClick={async()=>{try{await navigator.clipboard.writeText(text);setDone(true);setTimeout(()=>setDone(false),1500);}catch{alert("Couldn't copy. Please select the text and copy it instead.");}}}>{done?"✓ Copied":label}</Btn>;
}
const fieldLabel={display:"block",fontSize:11,color:"#7a96b0",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"};
const areaStyle={...smallInput,width:"100%",lineHeight:1.7,resize:"vertical",fontFamily:"inherit",marginBottom:10};

function LetterCheck({dossier}){
  const [draft,setDraft]=useState("");
  const [subject,setSubject]=useState("");
  const [recipients,setRecipients]=useState("");
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState(null);
  const run=async()=>{
    setBusy(true);setResult(null);
    const prompt=`${buildExistingCaseContext(dossier)}

${LADDER_RULES}

The person has drafted the letter below and wants it checked before sending. Check it against the evidence in this case and the ladder. Your job is to help it get a precise answer: keep the person's voice, objections and requests; do not soften a genuine point into nothing, do not concede anything, and do not add facts that are not in the letter or the evidence. A suspicion of crime can stay, worded as a concern for the right body to investigate, not as a finding.

GOOD PRACTICE: one institution, one issue and one clear request per letter; a subject line that names the issue, not an accusation; every person copied in has a reason to be; calm, precise wording; evidence described first, then the discrepancy, then the question or action requested.

SUBJECT: ${subject||"(none given)"}
RECIPIENTS AND COPIES: ${recipients||"(none given)"}
DRAFT LETTER:
${draft}

Return ONLY valid JSON, with no text before or after it:
{"summary":"two sentences: the letter's main strength, then its main risk","request":"the specific answer or action the letter asks for, or null if none is clear","checks":[{"check":"One institution, one issue","ok":true,"note":"one short sentence"},{"check":"A clear request","ok":true,"note":""},{"check":"Subject names the issue, not an accusation","ok":true,"note":""},{"check":"Everyone copied in has a reason","ok":true,"note":""},{"check":"Allegations match the evidence","ok":true,"note":""},{"check":"Calm, precise wording","ok":true,"note":""}],"flags":[{"quote":"the exact sentence from the draft","issue":"Allegation stated as fact / Goes beyond the evidence / No duty identified / Unclear request / Emotive or absolute wording","level_claimed":3,"level_supported":2,"why":"one sentence","rewrite":"evidence-led replacement sentence"}],"subject_suggestion":"a subject line naming the issue","rewrite":"the full revised letter in plain text, same voice and sign-off"}
At most 10 flags, most important first.`;
    try{const p=extractJson(await callClaude([{role:"user",content:prompt}]));if(!p||!p.rewrite)throw new Error("The check came back incomplete. Please try again.");setResult(p);}
    catch(e){alert("Couldn't check the letter just now. Please try again.\n\n"+e.message);}
    setBusy(false);
  };
  return(<Panel title="Check my letter" icon="🔎">
    <p style={{margin:"0 0 12px",fontSize:12,color:"#a0b4c8",lineHeight:1.6}}>Paste a letter or email before you send it. Goliathon checks each point against your evidence and the allegation ladder, and suggests evidence-led wording. Nothing here is saved or sent anywhere except to the AI for this check.</p>
    <label style={fieldLabel}>Subject line</label>
    <input value={subject} onChange={e=>setSubject(e.target.value)} placeholder="e.g. Request for the court record of the June 2024 order" style={{...smallInput,width:"100%",marginBottom:10}}/>
    <label style={fieldLabel}>To and copied in (optional)</label>
    <input value={recipients} onChange={e=>setRecipients(e.target.value)} placeholder="e.g. To: the Board. Cc: my MP" style={{...smallInput,width:"100%",marginBottom:10}}/>
    <label style={fieldLabel}>Your draft</label>
    <textarea value={draft} onChange={e=>setDraft(e.target.value)} rows={10} placeholder="Paste your letter or email here…" aria-label="Your draft letter" style={areaStyle}/>
    <div style={{display:"flex",justifyContent:"flex-end",marginBottom:result?14:0}}><Btn small onClick={run} disabled={busy||draft.trim().length<40}>{busy?"Checking…":"Check my letter"}</Btn></div>
    {result&&<div>
      <div style={{background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:8,padding:"12px 14px",marginBottom:12}}>
        <p style={{margin:"0 0 8px",fontSize:13,color:LIGHT,lineHeight:1.7}}>{toDisplayText(result.summary)}</p>
        <p style={{margin:0,fontSize:12,color:result.request?YELLOW:"#e57373"}}><strong>What it asks for: </strong>{result.request?toDisplayText(result.request):"No clear request yet. Say exactly what answer or action you want."}</p>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(240px, 1fr))",gap:6,marginBottom:12}}>
        {(result.checks||[]).map((c,i)=>(<div key={i} style={{display:"flex",gap:8,fontSize:12,lineHeight:1.5,color:LIGHT,background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:8,padding:"8px 10px"}}><span style={{color:c.ok?"#7e9e82":"#e57373",fontWeight:700}}>{c.ok?"✓":"!"}</span><span><strong>{c.check}</strong>{c.note?<span style={{color:"#a0b4c8"}}> · {c.note}</span>:null}</span></div>))}
      </div>
      {(result.flags||[]).length>0&&<>
        <div style={{fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:12,color:YELLOW,letterSpacing:1,textTransform:"uppercase",margin:"4px 0 8px"}}>Sentences to look at ({result.flags.length})</div>
        {result.flags.map((f,i)=>(<div key={i} style={{background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:8,padding:"10px 12px",marginBottom:8}}>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:6}}><Tag color="#e57373">{toDisplayText(f.issue)}</Tag>{f.level_claimed&&f.level_supported&&Number(f.level_claimed)>Number(f.level_supported)&&<Tag color="#a0b4c8">Claims level {f.level_claimed} · evidence supports level {f.level_supported}</Tag>}</div>
          <p style={{margin:"0 0 4px",fontSize:12,color:"#a0b4c8",lineHeight:1.6,textDecoration:"line-through",textDecorationColor:"#e5737380"}}>{toDisplayText(f.quote)}</p>
          <p style={{margin:"0 0 4px",fontSize:12,color:YELLOW,lineHeight:1.6}}>→ {toDisplayText(f.rewrite)}</p>
          {f.why&&<p style={{margin:0,fontSize:11,color:"#7a96b0",lineHeight:1.5}}>{toDisplayText(f.why)}</p>}
        </div>))}
      </>}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,margin:"12px 0 6px"}}>
        <span style={{fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:12,color:YELLOW,letterSpacing:1,textTransform:"uppercase"}}>Suggested version</span>
        <CopyBtn text={(result.subject_suggestion?"Subject: "+toDisplayText(result.subject_suggestion)+"\n\n":"")+toDisplayText(result.rewrite)}/>
      </div>
      {result.subject_suggestion&&<p style={{margin:"0 0 6px",fontSize:12,color:LIGHT}}><strong>Subject: </strong>{toDisplayText(result.subject_suggestion)}</p>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(280px, 1fr))",gap:10}}>
        <div><div style={fieldLabel}>Your draft</div><p style={{margin:0,fontSize:12,color:"#a0b4c8",lineHeight:1.7,whiteSpace:"pre-wrap",background:"#001830",padding:12,borderRadius:8,border:"1px solid #1e3a5f"}}>{draft}</p></div>
        <div><div style={fieldLabel}>Suggested</div><p style={{margin:0,fontSize:12,color:LIGHT,lineHeight:1.7,whiteSpace:"pre-wrap",background:"#001830",padding:12,borderRadius:8,border:`1px solid ${YELLOW}40`}}>{toDisplayText(result.rewrite)}</p></div>
      </div>
      <AIDisclaimer/>
    </div>}
  </Panel>);
}

const BRIEF_AUDIENCES=[
  {id:"journalist",label:"A journalist",hint:"Lead with the central allegation and the evidence for it. Journalists need the specific allegation and its proof up front."},
  {id:"mp",label:"An MP or councillor",hint:"Lead with what you want them to do. Keep to the issue that is theirs to act on."},
  {id:"regulator",label:"A regulator or ombudsman",hint:"Lead with the decision or conduct complained about and the rule it breached."},
  {id:"solicitor",label:"A solicitor or adviser",hint:"Lead with the decision you need help with, the key dates and any deadlines."},
];
function BriefBuilder({dossier}){
  const [aud,setAud]=useState("journalist");
  const [ask,setAsk]=useState("");
  const [busy,setBusy]=useState(false);
  const [brief,setBrief]=useState("");
  const a=BRIEF_AUDIENCES.find(x=>x.id===aud);
  const run=async()=>{
    setBusy(true);setBrief("");
    const al=dossier.allegations?.items?.length?"\nCentral allegations already drafted:\n"+dossier.allegations.items.map((x,i)=>`${i+1}. [Level ${x.level}] ${toDisplayText(x.allegation)} Evidence: ${(x.evidence||[]).join(", ")}`).join("\n"):"";
    const prompt=`${buildExistingCaseContext(dossier)}${al}

${LADDER_RULES}

Write a one-page brief, in the first person, for ${a.label.toLowerCase()}. It is a DRAFT for the person to rewrite in their own words, so keep it plain and short: at most 350 words. ${a.hint}
What the person wants from this reader: ${ask||"(not stated: end by asking whether they can help, and with what)"}

Structure, using these plain headings on their own lines: WHAT I AM ASKING; WHAT HAPPENED (at most 5 sentences); MY CENTRAL POINTS (at most 3, each with its level on the ladder and the evidence item numbers that support it); WHAT I CAN SEND YOU. State every point at the level the evidence supports. Never say anyone committed a crime; where there is a suspicion, say it is a concern you have asked, or will ask, the right body to investigate. No markdown symbols.

Return ONLY valid JSON, with no text before or after it: {"brief":"the brief as plain text"}`;
    try{const p=extractJson(await callClaude([{role:"user",content:prompt}]));if(!p||!p.brief)throw new Error("The brief came back empty. Please try again.");setBrief(toDisplayText(p.brief));}
    catch(e){alert("Couldn't write the brief just now. Please try again.\n\n"+e.message);}
    setBusy(false);
  };
  return(<Panel title="One-page brief" icon="📄">
    <p style={{margin:"0 0 12px",fontSize:12,color:"#a0b4c8",lineHeight:1.6}}>Busy professionals rarely read long AI summaries. This drafts one short page that leads with your request and your strongest evidence. Rewrite it in your own words before sending, and offer the full dossier only if they ask.</p>
    <label style={fieldLabel}>Who is it for?</label>
    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>{BRIEF_AUDIENCES.map(x=><button key={x.id} onClick={()=>setAud(x.id)} aria-pressed={aud===x.id} style={{background:aud===x.id?YELLOW:PANEL,color:aud===x.id?NAVY:LIGHT,border:`1px solid ${aud===x.id?YELLOW:BORDER}`,borderRadius:20,padding:"6px 12px",fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:12,cursor:"pointer"}}>{x.label}</button>)}</div>
    <label style={fieldLabel}>What do you want them to do?</label>
    <input value={ask} onChange={e=>setAsk(e.target.value)} placeholder="e.g. Ask the court to produce the June 2024 order" style={{...smallInput,width:"100%",marginBottom:10}}/>
    <div style={{display:"flex",justifyContent:"flex-end",marginBottom:brief?12:0}}><Btn small onClick={run} disabled={busy||!(dossier.evidence||[]).length}>{busy?"Writing…":"Draft the brief"}</Btn></div>
    {brief&&<>
      <div style={{display:"flex",justifyContent:"flex-end",gap:6,marginBottom:6}}><CopyBtn text={brief}/><Btn small variant="ghost" onClick={()=>downloadText("Goliathon_brief.txt",brief)}>↓</Btn></div>
      <div style={{background:"#001830",padding:14,borderRadius:8,border:"1px solid #1e3a5f"}}><FormattedText text={brief} color={LIGHT} lineHeight={1.8}/></div>
      <AIDisclaimer/>
    </>}
  </Panel>);
}

function CaseView({dossier,readOnly,chat,onRefreshOverview,refreshingOverview,onEditWitness,onEditTimeline,onEditEvidence,onMoveEvidence,onSaveAllegations}){
  const [tab,setTab]=useState("summary");
  const tabsRef=useRef(null);
  const go=id=>{setTab(id);setTimeout(()=>tabsRef.current?.scrollIntoView({behavior:"smooth",block:"start"}),0);};
  const tabs=[
    {id:"summary",label:"Summary"},
    (!readOnly||dossier.allegations)?{id:"allegations",label:"Allegations",count:dossier.allegations?.items?.length}:null,
    {id:"timeline",label:"Timeline",count:(dossier.timeline||[]).length},
    {id:"evidence",label:"Evidence",count:(dossier.evidence||[]).length},
    {id:"statement",label:"Statement"},
    (!readOnly||dossier.burden_of_proof_letter)?{id:"letters",label:"Letters"}:null,
    chat?{id:"chat",label:"Chat"}:null,
  ].filter(Boolean);
  const active=tabs.some(t=>t.id===tab)?tab:"summary";
  return(<div>
    <CaseAtAGlance dossier={dossier} onSeeAll={()=>go("summary")} onOpenAllegations={()=>go("allegations")} onRefreshOverview={readOnly?null:onRefreshOverview} refreshingOverview={refreshingOverview}/>
    <div ref={tabsRef} style={{scrollMarginTop:0}}/>
    <CaseTabs tabs={tabs} active={active} onChange={go}/>
    {active==="summary"&&<>
      <TextPanel title="Next Steps" icon="📌" text={dossier.next_steps} cleanNums download={()=>downloadPdf("nextsteps",dossier)} emptyText="Next steps will appear here…"/>
      <TextPanel title="Key Questions in This Case" icon="❓" text={dossier.key_questions} cleanNums disclaimer download={()=>downloadPdf("keyquestions",dossier)} emptyText="Key questions will appear as you add evidence."/>
      <TextPanel title="Decision-Maker Summary" icon="⚖️" text={dossier.decision_summary} disclaimer download={()=>downloadPdf("decisionsummary",dossier)} emptyText="Decision-Maker Summary will appear after you add evidence. This is the one-page view for a judge, ombudsman, or regulator."/>
      {dossier.institution_response&&<TextPanel title="The Strongest Answer to Your Case" icon="⚔️" text={dossier.institution_response} disclaimer intro={<p style={{margin:"0 0 8px",fontSize:12,color:"#a0b4c8",lineHeight:1.6}}>Based strictly on the evidence filed so far. This identifies the strongest argument the evidence currently supports, what the evidence contradicts, and where no conclusion can yet be drawn. Check it against the actual response when it arrives.</p>}/>}
    </>}
    {active==="timeline"&&<TimelineView dossier={dossier} onEdit={readOnly?null:onEditTimeline}/>}
    {active==="evidence"&&<EvidenceView dossier={dossier} onEdit={readOnly?null:onEditEvidence} onMove={readOnly?null:onMoveEvidence}/>}
    {active==="statement"&&<StatementView dossier={dossier} onEdit={readOnly?null:onEditWitness}/>}
    {active==="allegations"&&<AllegationsView dossier={dossier} readOnly={readOnly||!onSaveAllegations} onSave={onSaveAllegations}/>}
    {active==="letters"&&!readOnly&&<><LetterCheck dossier={dossier}/><BriefBuilder dossier={dossier}/></>}
    {active==="letters"&&dossier.burden_of_proof_letter&&<Panel title="Burden of Proof Challenge Letter" icon="✉️" action={<Btn small variant="ghost" onClick={()=>downloadText("Challenge_Letter.txt",dossier.burden_of_proof_letter)}>↓</Btn>}><p style={{margin:"0 0 10px",fontSize:12,color:"#a0b4c8",lineHeight:1.6}}>This letter asks the claimant to prove their case before you are required to respond. Review, adapt if needed, then send by recorded post or email with read receipt.</p><p style={{margin:0,fontSize:13,lineHeight:1.8,color:LIGHT,whiteSpace:"pre-wrap",background:"#001830",padding:12,borderRadius:8,border:"1px solid #1e3a5f"}}>{dossier.burden_of_proof_letter}</p></Panel>}
    {active==="chat"&&chat&&<Panel title="Chat With This Case" icon="💬">{chat}</Panel>}
  </div>);
}

function ReadOnlyDossier({dossier}){
  const [showDownload,setShowDownload]=useState(false);
  return(<div style={{fontFamily:"'Open Sans', sans-serif",background:NAVY,minHeight:"100vh",color:LIGHT}}>
    <div style={{background:NAVY,borderBottom:`3px solid ${YELLOW}`,padding:"14px 20px"}}><div style={{maxWidth:860,margin:"0 auto",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}><img src="/getsafe-logo.png" alt="Get SAFE" style={{width:40,height:40,objectFit:"contain"}}/><div style={{flex:1,minWidth:0}}><div style={{fontSize:9,letterSpacing:3,color:YELLOW,textTransform:"uppercase",fontFamily:"'Poppins', sans-serif"}}>Get SAFE · Goliathon Evidence Dossier</div><h1 style={{margin:0,fontFamily:"'Poppins', sans-serif",fontSize:19,fontWeight:800,color:WHITE,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{dossier.case_title||"Evidence Dossier"}</h1></div><div style={{display:"flex",gap:8,alignItems:"center"}}><Tag>Read Only</Tag><Btn small onClick={()=>setShowDownload(true)}>↓ Download</Btn></div></div></div>
    <div style={{maxWidth:860,margin:"0 auto",padding:"20px 16px"}}>
      <CaseView dossier={dossier} readOnly/>
    </div>
    {showDownload&&<DownloadModal dossier={dossier} onClose={()=>setShowDownload(false)}/>}
    <style>{`@keyframes pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}`}</style>
  </div>);
}

function PrivacyPage({onBack}){
  const sections=[
    {title:"Your privacy matters",body:"Get SAFE exists to support people harmed by financial exploitation. We treat your information with care, respect, and confidentiality."},
    {title:"Who we are",body:"Get SAFE is fiscally hosted by the Academy of Life Planning Limited (AoLP), the legal data controller. Your data is used only for Get SAFE purposes.",contact:true},
    {title:"What Goliathon collects",bullets:["Dossier content stored in Supabase to enable the shareable link, identified by a random ID with no link to your identity.","No account required. We do not collect your name or email unless you include it in uploaded documents.","Camera scan images are sent to AI for analysis only — not stored by Goliathon.","Basic website data may be collected by Vercel and Supabase for operations.","Chat messages you send in Chat With This Case are stored with your dossier in Supabase. You can delete individual messages in the chat.","PDF files larger than 2.5MB are uploaded to secure file storage (Supabase) so they can be processed, and are kept there until deleted. They can be removed on request.","We do not use tracking cookies, advertising, or sell data."]},
    {title:"How your dossier is stored",body:"Your dossier is saved to Supabase automatically each time you add evidence, under a unique random ID. No personal identity is linked. If you click Share Dossier, anyone with that link can view it. Request deletion by emailing us with your share link."},
    {title:"Session files",body:"Save Session downloads a JSON file to your device only — not stored by Goliathon. Store it securely as it may contain sensitive information."},
    {title:"AI processing",body:"Your evidence, and any messages you send in Chat With This Case, are sent to Claude (Anthropic) via a secure server-side function, together with your case information so it can answer. Anthropic's privacy policy applies to this processing."},
    {title:"Contributions to Get SAFE",body:"If you choose to make a voluntary contribution, you are taken to a payment page run by Stripe, which processes the payment under its own privacy policy (stripe.com/privacy). Your card details go to Stripe and are never seen or stored by us. We receive a record of the payment, such as the amount, date and your email address, and keep it for accounting and tax purposes. Contributions are separate from Goliathon: no case information is sent to Stripe, and you do not need to contribute to use Goliathon. Contributions are payments to Academy of Life Planning Ltd, of which Get SAFE is a trading style."},{title:"Your rights",bullets:["See information held — email steve@academyoflifeplanning.com with your share link","Ask for corrections or deletion","Withdraw consent — request deletion at any time","Raise concerns with the ICO at ico.org.uk"]},
    {title:"Vulnerable adults",body:"We recognise many Goliathon users may be vulnerable. Your information is handled with care, dignity, and respect. You are not a case number. You are a person."},
    {title:"Changes to this policy",body:"We may update this policy from time to time. Last updated: October 2026."},
  ];
  return(<div style={{fontFamily:"'Open Sans', sans-serif",background:NAVY,minHeight:"100vh",width:"100%",color:LIGHT}}>
    <div style={{background:NAVY,borderBottom:`3px solid ${YELLOW}`,padding:"14px 20px"}}><div style={{maxWidth:760,margin:"0 auto",display:"flex",alignItems:"center",gap:14}}><img src="/getsafe-logo.png" alt="Get SAFE" style={{width:40,height:40,objectFit:"contain"}}/><div style={{flex:1}}><div style={{fontSize:9,letterSpacing:3,color:YELLOW,textTransform:"uppercase",fontFamily:"'Poppins', sans-serif"}}>Get SAFE · Goliathon</div><h1 style={{margin:0,fontFamily:"'Poppins', sans-serif",fontSize:19,fontWeight:800,color:WHITE}}>Privacy Policy</h1></div><Btn small variant="subtle" onClick={onBack}>← Back</Btn></div></div>
    <div style={{maxWidth:760,margin:"0 auto",padding:"28px 20px"}}>
      <div style={{background:PANEL,border:`1px solid ${BORDER}`,borderRadius:12,padding:"12px 18px",marginBottom:24,display:"flex",alignItems:"center",gap:12}}><span style={{fontSize:16}}>🔒</span><p style={{margin:0,fontSize:13,color:"#a0b4c8",lineHeight:1.6}}>This policy covers how Goliathon handles your information. Goliathon is a tool of <strong style={{color:WHITE}}>Get SAFE</strong>, fiscally hosted by the Academy of Life Planning Limited.</p></div>
      {sections.map((s,i)=>(<div key={i} style={{marginBottom:24}}><h2 style={{fontFamily:"'Poppins', sans-serif",fontSize:15,fontWeight:700,color:YELLOW,margin:"0 0 8px",borderBottom:`1px solid ${BORDER}`,paddingBottom:6}}>{s.title}</h2>{s.body&&<p style={{margin:0,fontSize:13,color:LIGHT,lineHeight:1.8}}>{s.body}</p>}{s.bullets&&<ul style={{margin:0,paddingLeft:18}}>{s.bullets.map((b,j)=><li key={j} style={{fontSize:13,color:LIGHT,lineHeight:1.8,marginBottom:3}}>{b}</li>)}</ul>}{s.contact&&<div style={{marginTop:10,background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:8,padding:"10px 14px"}}><p style={{margin:"0 0 3px",fontSize:12,color:"#a0b4c8"}}>📧 <a href="mailto:steve@academyoflifeplanning.com" style={{color:YELLOW}}>steve@academyoflifeplanning.com</a></p><p style={{margin:0,fontSize:12,color:"#7a96b0"}}>📍 9 Franklin Way, Spilsby, Lincolnshire, PE23 5GG</p></div>}</div>))}
      <div style={{background:YELLOW+"15",border:`1px solid ${YELLOW}40`,borderRadius:12,padding:20,textAlign:"center"}}><p style={{margin:"0 0 6px",fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:14,color:WHITE}}>A final reassurance</p><p style={{margin:0,fontSize:13,color:"#a0b4c8",fontStyle:"italic"}}>You are not a case number. You are a person. Your information is handled with care, dignity, and respect.</p></div>
    </div>
  </div>);
}

export default function GoliathonApp(){
  const [showWelcome,setShowWelcome]=useState(!hasBeenWelcomed());
  const [showPrivacy,setShowPrivacy]=useState(false);
  const [readOnly,setReadOnly]=useState(false);
  const [readOnlyDossier,setReadOnlyDossier]=useState(null);
  const [cases,setCases]=useState(()=>{const s=loadCases();if(!s.length){const c={id:genId(),title:"My Case",dossier:null,shareId:genId()};saveCases([c]);return[c];}return s;});
  const [activeId,setActiveIdState]=useState(()=>{const id=getActiveId();const s=loadCases();return s.find(c=>c.id===id)?id:s[0]?.id;});
  const setActiveId=useCallback((id)=>{setActiveIdState(id);try{localStorage.setItem(LS_ACTIVE,id);}catch{}},[]);
  const activeCase=cases.find(c=>c.id===activeId)||cases[0];
  const dossier=activeCase?.dossier||null;
  const shareId=activeCase?.shareId||genId();
  const [processing,setProcessing]=useState(false);
  const [processingMsg,setProcessingMsg]=useState("");
  const [urlInput,setUrlInput]=useState("");
  const [showUrl,setShowUrl]=useState(false);
  const [showPasteText,setShowPasteText]=useState(false);
  const [showThreatIntake,setShowThreatIntake]=useState(false);
  const [threatForm,setThreatForm]=useState({claimant:'',amount:'',deadline:'',claimType:'mortgage possession',details:''});
  const [threatFile,setThreatFile]=useState(null);
  const threatFileRef=useRef(null);
  const [threatProcessing,setThreatProcessing]=useState(false);
  const [fileHashes,setFileHashes]=useState(()=>{try{return JSON.parse(localStorage.getItem('goliathon_hashes_'+activeId)||'[]');}catch{return [];}});
  const [duplicateWarning,setDuplicateWarning]=useState(null);
  const [pasteTextContent,setPasteTextContent]=useState("");
  const [pasteTextDate,setPasteTextDate]=useState("");
  const [pasteTextTitle,setPasteTextTitle]=useState("");
  const [pasteFiles,setPasteFiles]=useState([]);
  const pasteFilesRef=useRef(null);
  const [dragOver,setDragOver]=useState(false);
  const [showShare,setShowShare]=useState(false);
  const [showDownload,setShowDownload]=useState(false);
  const [showCamera,setShowCamera]=useState(false);
  const [cameraPages,setCameraPages]=useState([]);
  const [cameraProcessing,setCameraProcessing]=useState(false);
  const [editingEvidence,setEditingEvidence]=useState(null);
  const [editingTimeline,setEditingTimeline]=useState(null);
  const [editingWitness,setEditingWitness]=useState(false);
  const [editingTitle,setEditingTitle]=useState(false);
  const [titleDraft,setTitleDraft]=useState("");
  const [saved,setSaved]=useState(false);
  const [saveFailed,setSaveFailed]=useState(false);
  const isSavedRef=useRef(false);

  // Check DB for existing save on mount — if this case already exists in
  // Supabase (from a previous session, before a refresh wiped local React
  // state), mark it as saved so the Chat panel and other saved-only UI
  // don't wrongly imply the case is unsaved.
  useEffect(()=>{
    if(!shareId)return;
    let cancelled=false;
    (async()=>{
      try{
        const existing=await loadDossierFromDb(shareId);
        if(!cancelled&&existing){
          isSavedRef.current=true;
          setSaved(true);
        }
      }catch{
        // Silently ignore — if the check fails, the user can still save
        // manually as before; this is a convenience check, not required.
      }
    })();
    return ()=>{cancelled=true;};
  },[shareId]);
  const fileRef=useRef(null);
  const restoreRef=useRef(null);
  const cameraRef=useRef(null);

  useEffect(()=>{
    const path=window.location.pathname;
    const m=path.match(/\/dossier\/([a-z0-9]+)/i);
    if(m){setReadOnly(true);loadDossierFromDb(m[1]).then(d=>{if(d)setReadOnlyDossier(d);});}
    if(path==="/privacy")setShowPrivacy(true);
  },[]);

  const updateCases=useCallback((updated)=>{setCases(updated);saveCases(updated);},[]);

  const updateDossier=useCallback(async(incoming)=>{
    // Every save keeps the timeline in date order (including manual edits).
    const newDossier=incoming&&Array.isArray(incoming.timeline)?{...incoming,timeline:sortTimeline(incoming.timeline)}:incoming;
    const updated=cases.map(c=>c.id===activeId?{...c,dossier:newDossier,title:newDossier.case_title||c.title}:c);
    updateCases(updated);setSaved(false);setSaveFailed(false);
    // allegations stay in this browser until the dossiers table has a column for them.
    const {burden_of_proof_letter:_bpl,allegations:_al,...dossierForDb}=newDossier;
    try{await saveDossierToDb({...dossierForDb,share_id:shareId},isSavedRef.current);isSavedRef.current=true;setSaved(true);}
    catch(e){console.error("Save error:",e);setSaveFailed(true);}
  },[cases,activeId,shareId,updateCases]);

  // Cases saved before 29 Oct 2026 may have entries out of order: fix on open.
  useEffect(()=>{
    if(dossier&&Array.isArray(dossier.timeline)&&dossier.timeline.length>1&&!timelineIsSorted(dossier.timeline))updateDossier(dossier);
  },[dossier,updateDossier]);

  const handleNewCase=useCallback(()=>{
    const c={id:genId(),title:"New Case",dossier:null,shareId:genId()};
    const updated=[...cases,c];updateCases(updated);setActiveId(c.id);isSavedRef.current=false;setSaved(false);
  },[cases,updateCases,setActiveId]);

  const handleSwitchCase=useCallback((id)=>{setActiveId(id);isSavedRef.current=false;setSaved(false);},[setActiveId]);

  const handleClearAll=useCallback(()=>{
    const c={id:genId(),title:"My Case",dossier:null,shareId:genId()};
    setCases([c]);saveCases([c]);setActiveId(c.id);
    isSavedRef.current=false;setSaved(false);
  },[setActiveId]);

  const handleDeleteCase=useCallback((id)=>{
    if(!window.confirm("Delete this case? This cannot be undone."))return;
    const updated=cases.filter(c=>c.id!==id);
    if(!updated.length){const c={id:genId(),title:"My Case",dossier:null,shareId:genId()};updated.push(c);}
    updateCases(updated);if(activeId===id){setActiveId(updated[0].id);}
  },[cases,activeId,updateCases,setActiveId]);

  const handleSaveLocal=useCallback(()=>{
    const session={version:3,savedAt:new Date().toISOString(),cases,activeId};
    const blob=new Blob([JSON.stringify(session,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");
    a.href=url;a.download=`Goliathon_${(dossier?.case_title||"session").replace(/[^a-z0-9]/gi,"_")}_${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);
  },[dossier,cases,activeId]);

  const handleRestoreLocal=useCallback((e)=>{
    const file=e.target.files[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=(ev)=>{try{const s=JSON.parse(ev.target.result);if(s.cases){updateCases(s.cases);setActiveId(s.activeId||s.cases[0]?.id);}else if(s.dossier){const updated=cases.map(c=>c.id===activeId?{...c,dossier:s.dossier}:c);updateCases(updated);}}catch{alert("Could not restore session. Please check the file.");}};
    reader.readAsText(file);
  },[cases,activeId,updateCases,setActiveId]);

  const handleReset=useCallback(()=>{
    if(!window.confirm("Reset this case? All dossier content will be cleared."))return;
    const freshCase={id:genId(),title:"My Case",dossier:null,shareId:genId()};
    const updated=cases.map(c=>c.id===activeId?freshCase:c);
    updateCases(updated);
    setActiveId(freshCase.id);
    isSavedRef.current=false;
    setSaved(false);
  },[cases,activeId,updateCases,setActiveId]);

  const handleDeleteDossier=useCallback(async()=>{
    if(!window.confirm("Permanently delete this dossier from the shared database? The share link will stop working."))return;
    await deleteDossierFromDb(shareId);
    const updated=cases.map(c=>c.id===activeId?{...c,dossier:null,savedToDb:false}:c);
    updateCases(updated);setSaved(false);isSavedRef.current=false;alert("Dossier deleted from database.");
  },[shareId,cases,activeId,updateCases]);

  const handleEditEvidence=useCallback((index,updated)=>{
    if(!dossier)return;const newEvidence=[...(dossier.evidence||[])];newEvidence[index]={...newEvidence[index],...updated};
    updateDossier({...dossier,evidence:newEvidence});setEditingEvidence(null);
  },[dossier,updateDossier]);

  const handleDeleteEvidence=useCallback((index)=>{
    if(!dossier)return;const newEvidence=(dossier.evidence||[]).filter((_,i)=>i!==index);
    updateDossier({...dossier,evidence:newEvidence});setEditingEvidence(null);
  },[dossier,updateDossier]);

  const [refreshingOverview,setRefreshingOverview]=useState(false);
  const handleRefreshOverview=useCallback(async()=>{
    if(!dossier||refreshingOverview)return;
    setRefreshingOverview(true);
    try{const ov=await generateWholeCaseOverview(dossier);if(ov)await updateDossier({...dossier,overview:ov});}
    catch(e){alert("Couldn't refresh the overview just now. Please try again.\n\n"+e.message);}
    setRefreshingOverview(false);
  },[dossier,refreshingOverview,updateDossier]);

  const handleEditTimeline=useCallback((index,updated)=>{
    if(!dossier)return;const newTimeline=[...(dossier.timeline||[])];newTimeline[index]={...newTimeline[index],...updated};
    updateDossier({...dossier,timeline:newTimeline});setEditingTimeline(null);
  },[dossier,updateDossier]);

  const handleDeleteTimeline=useCallback((index)=>{
    if(!dossier)return;const newTimeline=(dossier.timeline||[]).filter((_,i)=>i!==index);
    updateDossier({...dossier,timeline:newTimeline});setEditingTimeline(null);
  },[dossier,updateDossier]);

  const handleEditWitness=useCallback((newText)=>{
    if(!dossier)return;
    updateDossier({...dossier,witness_statement:newText});setEditingWitness(false);
  },[dossier,updateDossier]);

  const handleMoveEvidence=useCallback((index,dir)=>{
    if(!dossier)return;const newEvidence=[...(dossier.evidence||[])];const newIndex=index+dir;
    if(newIndex<0||newIndex>=newEvidence.length)return;
    [newEvidence[index],newEvidence[newIndex]]=[newEvidence[newIndex],newEvidence[index]];
    updateDossier({...dossier,evidence:newEvidence});
  },[dossier,updateDossier]);

  const handleSaveTitle=useCallback(()=>{
    if(!titleDraft.trim()){setEditingTitle(false);return;}
    const updated=cases.map(c=>c.id===activeId?{...c,title:titleDraft,dossier:c.dossier?{...c.dossier,case_title:titleDraft}:c.dossier}:c);
    updateCases(updated);if(dossier)updateDossier({...dossier,case_title:titleDraft});setEditingTitle(false);
  },[titleDraft,cases,activeId,dossier,updateCases,updateDossier]);

  const handleThreatIntake=useCallback(async()=>{
    if(!threatForm.claimant&&!threatFile)return;
    setThreatProcessing(true);
    setShowThreatIntake(false);
    try{
      // Read file first if attached so we can include it in the single analysis
      let fileContent=null;
      let fileMediaType='text/plain';
      if(threatFile){
        const ext=threatFile.name.split('.').pop().toLowerCase();
        if(['jpg','jpeg','png','gif','webp'].includes(ext)){
          fileContent=await new Promise(res=>{
            const img=new Image();
            const url=URL.createObjectURL(threatFile);
            img.onload=()=>{
              const scale=Math.min(1,1200/Math.max(img.width,img.height));
              const canvas=document.createElement('canvas');
              canvas.width=Math.round(img.width*scale);
              canvas.height=Math.round(img.height*scale);
              canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
              URL.revokeObjectURL(url);
              res(canvas.toDataURL('image/jpeg',0.82).split(',')[1]);
            };
            img.src=url;
          });
          fileMediaType='image/jpeg';
        } else if(ext==='pdf'){
          fileContent=await fileToBase64(threatFile);
          fileMediaType='application/pdf';
        } else {
          fileContent=await new Promise(res=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.readAsText(threatFile);});
        }
      }

      const contextLines=[
        threatForm.claimant?'- Claimant: '+threatForm.claimant:'',
        '- Claim type: '+threatForm.claimType,
        threatForm.amount?'- Amount demanded: '+threatForm.amount:'',
        threatForm.deadline?'- Response deadline: '+threatForm.deadline:'',
        threatForm.details?'- Additional context from recipient: '+threatForm.details:'',
        (fileContent&&fileMediaType==='text/plain')?'\n--- DOCUMENT TEXT ---\n'+fileContent.substring(0,3000):''
      ].filter(Boolean).join('\n');

      const jsonSpec='{"case_title":"[Recipient] v [exact claimant name from document or form]","overview":"3-4 sentences naming the exact sending organisation, reference numbers, amounts, and what is being claimed — use specific details from the document","witness_statement":"2-3 sentences in first person using specific names, amounts and dates from the document","timeline_entry":{"date":"today","event":"Received [exact document type e.g. Final Notice, Letter Before Action] from [exact sender name]"},"challenge_questions":["5 specific questions based on exact details in the document — name parties, reference numbers, specific amounts"],"burden_of_proof_letter":"Formal letter max 150 words naming the exact claimant/debt collector, referencing exact amounts and reference numbers from the document. Dear Sir/Madam / Yours faithfully.","next_steps":"5 numbered specific actions using exact names and details from the document","decision_summary":"one page naming specific parties, exact amounts, dates, and 5 questions they cannot answer","document_title":"short descriptive title naming the sender and document type","document_facts":"one sentence: exact sender name, recipient, amount, date, reference numbers as stated in the document","document_significance":"one or two short sentences, no more than 45 words, interpretation only: why this document appears relevant to the case. Use cautious wording such as appears to or would be relevant if accurate. Never use the words establishes or proves and never state a legal conclusion"}';

      const instructions='Analyse this carefully. Use SPECIFIC details — exact names of organisations, reference numbers, amounts, dates. Do NOT use generic placeholders. Return ONLY valid JSON:\n'+jsonSpec;

      let text;
      if(fileContent&&fileMediaType!=='text/plain'){
        const isImg=fileMediaType.startsWith('image/');
        text=await callClaude([{role:'user',content:[
          isImg?{type:'image',source:{type:'base64',media_type:fileMediaType,data:fileContent}}:{type:'document',source:{type:'base64',media_type:'application/pdf',data:fileContent}},
          {type:'text',text:'This is a legal claim or threat document received by the user.\n\nAdditional context:\n'+contextLines+'\n\n'+instructions}
        ]}]);
      } else {
        text=await callClaude([{role:'user',content:'A person has received a legal claim or threat.\n\nAll available information:\n'+contextLines+'\n\n'+instructions}]);
      }

      const parsed=extractJson(text);
      const today=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
      const newDossier={
        case_title:parsed.case_title||(threatForm.claimant?'Recipient v '+threatForm.claimant:'Legal Threat'),
        overview:parsed.overview||'',
        timeline:[{date:today,event:parsed.timeline_entry?.event||('Received legal claim from '+(threatForm.claimant||'unknown')),evidence:parsed.document_title||'Legal threat document'}],
        witness_statement:parsed.witness_statement||'',
        evidence:[{
          title:parsed.document_title||(threatForm.claimant?'Legal Claim — '+threatForm.claimant:'Legal Threat Document'),
          date:today,
          type:'Legal Threat',
          summary:parsed.overview||(threatForm.claimant?'Legal claim received from '+threatForm.claimant:''),
          facts_observed:parsed.document_facts||('Claim received'+(threatForm.claimant?' from '+threatForm.claimant:'')+(threatForm.amount?', demanding '+threatForm.amount:'')),
          significance:parsed.document_significance||'This is the formal legal threat that initiates the case.',
          red_flags:null
        }],
        next_steps:parsed.next_steps||'',
        key_questions:parsed.challenge_questions?parsed.challenge_questions.map((q,i)=>i+1+'. '+q).join('\n'):'',
        decision_summary:parsed.decision_summary||'',
        burden_of_proof_letter:parsed.burden_of_proof_letter||''
      };
      await updateDossier(newDossier);
      const h=await hashFile((threatForm.details||'')+(threatForm.claimant||'')+(threatFile?threatFile.name:''));
      const hashes=JSON.parse(localStorage.getItem('goliathon_hashes_'+activeId)||'[]');
      hashes.push({hash:h,title:parsed.document_title||('Legal Threat — '+(threatForm.claimant||'unknown'))});
      localStorage.setItem('goliathon_hashes_'+activeId,JSON.stringify(hashes));
    }catch(e){console.error('Threat intake error',e);alert('Something went wrong: '+e.message);}
    setThreatProcessing(false);
    setThreatForm({claimant:'',amount:'',deadline:'',claimType:'mortgage possession',details:''});
    setThreatFile(null);
  },[threatForm,threatFile,activeId]);



  // Files a message and its attachments as ONE evidence item (see
  // EVIDENCE BUNDLES above). `skipped` names attachments that could not be
  // included, so they still appear in the record as not read.
  const processBundle=useCallback(async({text,title,date,files,skipped=[]})=>{
    setProcessing(true);
    try{
      const attachments=[];
      for(let k=0;k<files.length;k++){
        setProcessingMsg(`Reading attachment ${k+1} of ${files.length}: ${files[k].name}…`);
        attachments.push(await describeAttachment(files[k],shareId));
      }
      skipped.forEach(sk=>{const name=typeof sk==="string"?sk:sk.filename;const reason=typeof sk==="string"?"it could not be included with this email.":sk.reason;attachments.push({filename:name,title:name,summary:"Not read: "+reason,not_read:true});});
      setProcessingMsg("Analysing the message and its attachments together…");
      const response=await callClaude([{role:"user",content:bundleMessageText({text,title,date,attachments})+buildEvidencePrompt(dossier)}]);
      const parsed=extractJson(response);
      if(!parsed||!parsed.evidence_item)throw new Error("The analysis came back incomplete. Please try again.");
      parsed.evidence_item={...parsed.evidence_item,attachments};
      const current=dossier||{evidence:[],timeline:[],witness_statement:"",overview:"",next_steps:""};
      setProcessingMsg("Updating case overview…");
      const newDossier=await withWholeCaseOverview(mergeParsedIntoDossier(current,parsed));
      await updateDossier(newDossier);
    }catch(e){alert("Nothing was filed: something went wrong reading this email and its attachments. Please try again.\n\n"+e.message+(/not allowed/i.test(e.message||"")?"\n\n(\"Not allowed\" means this web address is not permitted to use Goliathon's AI.)":""));}
    setProcessing(false);setProcessingMsg("");
  },[dossier,updateDossier,shareId]);

  const processEvidence=useCallback(async(content,filename,mediaType,isUrl=false)=>{
    setProcessing(true);setProcessingMsg(`Reading ${filename}…`);
    try{
      const isImage=mediaType?.startsWith("image/");const isPdf=mediaType==="application/pdf";
      let userMessage;
      if(isImage){userMessage={role:"user",content:[{type:"image",source:{type:"base64",media_type:mediaType,data:content}},{type:"text",text:`Analyse this uploaded image as evidence. Filename: ${filename}`}]};}
      else if(isPdf){userMessage={role:"user",content:[{type:"document",source:{type:"base64",media_type:"application/pdf",data:content}},{type:"text",text:`Analyse this uploaded document as evidence. Filename: ${filename}`}]};}
      else{userMessage={role:"user",content:`Analyse this evidence. ${isUrl?"Source URL: "+filename:"Filename: "+filename}\n\nContent:\n${content}`};}
      setProcessingMsg("Analysing evidence…");
      const prompt=buildEvidencePrompt(dossier);
      const response=await callClaude([{...userMessage,content:typeof userMessage.content==="string"?userMessage.content+prompt:[...(Array.isArray(userMessage.content)?userMessage.content:[userMessage.content]),{type:"text",text:prompt}]}]);
      const parsed=extractJson(response);
      setProcessingMsg("Updating dossier…");
      const current=dossier||{evidence:[],timeline:[],witness_statement:"",overview:"",next_steps:""};
      setProcessingMsg("Updating case overview…");
      const newDossier=await withWholeCaseOverview(mergeParsedIntoDossier(current,parsed));
      await updateDossier(newDossier);
    }catch(e){alert("Something went wrong processing this file. Please try again.\n\n"+e.message);}
    setProcessing(false);setProcessingMsg("");
  },[dossier,updateDossier]);

  // Handles PDFs too large for the direct/base64 path. Uploads the raw file
  // straight to Supabase Storage, then calls the new server endpoint with
  // only the storage path (a small string) — the file itself never crosses
  // back into a browser-to-Vercel request, so this bypasses the 4.5MB body
  // cap entirely. Shares buildEvidencePrompt/mergeParsedIntoDossier with
  // processEvidence so both paths produce identical analysis.
  const processLargeFile=useCallback(async(file)=>{
    setProcessing(true);setProcessingMsg(`Uploading ${file.name}…`);
    try{
      const storagePath=`${shareId}/${Date.now()}_${file.name}`;
      const {error:uploadError}=await supabaseBrowser.storage.from('evidence-uploads').upload(storagePath,file,{contentType:file.type||'application/pdf'});
      if(uploadError)throw new Error('Upload failed: '+uploadError.message);
      setProcessingMsg("Analysing evidence…");
      const promptText=`Analyse this uploaded document as evidence. Filename: ${file.name}`+buildEvidencePrompt(dossier);
      const res=await fetch("/api/process-large-file",{method:"POST",headers:aiHeaders({"Content-Type":"application/json"}),body:JSON.stringify({storagePath,mediaType:'application/pdf',promptText})});
      const data=await res.json();
      if(data.error){notifyAiError(data);throw new Error(data.error);}
      const response=data.content?.[0]?.text||"";
      const parsed=extractJson(response);
      setProcessingMsg("Updating dossier…");
      const current=dossier||{evidence:[],timeline:[],witness_statement:"",overview:"",next_steps:""};
      setProcessingMsg("Updating case overview…");
      const newDossier=await withWholeCaseOverview(mergeParsedIntoDossier(current,parsed));
      await updateDossier(newDossier);
    }catch(e){alert("Something went wrong processing this large file. Please try again.\n\n"+e.message);}
    setProcessing(false);setProcessingMsg("");
  },[dossier,updateDossier,shareId]);

  const handleFile=useCallback(async(file)=>{
    if(!file)return;const ext=file.name.split(".").pop().toLowerCase();
    const needsConversion=["html","htm","doc","docx","msg"].includes(ext);
    const allowed=["jpg","jpeg","png","gif","webp","pdf","txt","html","htm","doc","docx","msg"];
    if(!allowed.includes(ext)){alert("Unsupported file type. Goliathon accepts: JPG, PNG, PDF, TXT, HTML, DOC, DOCX, MSG.");return;}
    const isImg=['jpg','jpeg','png','gif','webp'].includes(ext);
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
          alert(`This file is ${(file.size/1024/1024).toFixed(1)}MB, which is larger than Goliathon currently supports (limit: 20MB). Try splitting it into smaller sections.`);
          return;
        }
        await processLargeFile(file);
        return;
      }
      alert(`This file is ${(file.size/1024/1024).toFixed(1)}MB, which is too large for Goliathon to process directly (limit: 2.5MB). Try compressing it, splitting it into smaller sections, or saving it as a plain text (.txt) file if possible.`);
      return;
    }
    if(needsConversion){
      setProcessing(true);setProcessingMsg(`Converting ${file.name}…`);
      try{const base64=await fileToBase64(file);const res=await fetch("/api/convert",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:file.name,mediaType:file.type,data:base64})});const data=await res.json();if(data.error)throw new Error(data.error);if(ext==="msg"&&((data.attachments||[]).length||(data.skipped||[]).length)){setProcessing(false);await processBundle({text:data.text,title:file.name.replace(/\.msg$/i,""),date:"",files:(data.attachments||[]).map(a=>base64ToFile(a.data,a.filename)),skipped:data.skipped||[]});}else{await processEvidence(data.text,file.name,"text/plain");}}
      catch(e){alert("Could not convert this file: "+e.message);setProcessing(false);setProcessingMsg("");}
      return;
    }
    if(isImg){
      const resized=await new Promise(res=>{
        const img=new Image();const url=URL.createObjectURL(file);
        img.onload=()=>{
          const scale=Math.min(1,1200/Math.max(img.width,img.height));
          const canvas=document.createElement('canvas');
          canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);
          canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
          URL.revokeObjectURL(url);res(canvas.toDataURL('image/jpeg',0.82).split(',')[1]);
        };img.src=url;
      });
      await processEvidence(resized,file.name,'image/jpeg');
    } else {
      const base64=await fileToBase64(file);await processEvidence(base64,file.name,file.type);
    }
  },[processEvidence,processLargeFile,processBundle]);

  const handlePasteText=useCallback(async()=>{
    const files=pasteFiles;
    if(!pasteTextContent.trim()&&!files.length)return;
    const datePrefix=pasteTextDate?pasteTextDate+"_":"";
    const titlePart=pasteTextTitle.trim()||(files.length?"Email with attachments":"File Note");
    const filename=datePrefix+titlePart;
    const text=pasteTextContent.trim();
    setShowPasteText(false);setPasteTextContent("");setPasteTextDate("");setPasteTextTitle("");setPasteFiles([]);
    if(files.length)await processBundle({text,title:titlePart,date:pasteTextDate,files});
    else await processEvidence(text,filename,"text/plain");
  },[pasteTextContent,pasteTextDate,pasteTextTitle,pasteFiles,processEvidence,processBundle]);

  const handleUrl=useCallback(async()=>{
    if(!urlInput.trim())return;setShowUrl(false);setProcessing(true);setProcessingMsg("Fetching URL…");
    try{const res=await fetch("/api/fetch-url",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:urlInput.trim()})});const data=await res.json();if(data.error)throw new Error(data.error);await processEvidence(data.text,urlInput.trim(),"text/plain",true);}
    catch(e){alert("Could not fetch URL: "+e.message);setProcessing(false);setProcessingMsg("");}
    setUrlInput("");
  },[urlInput,processEvidence]);

  const handleCameraCapture=useCallback(async(e)=>{
    const files=Array.from(e.target.files);if(!files.length)return;
    const newPages=[];for(const file of files){const compressed=await compressImage(file);newPages.push({data:compressed,name:file.name,preview:URL.createObjectURL(file)});}
    setCameraPages(prev=>[...prev,...newPages]);
  },[]);

  const handleCameraSubmit=useCallback(async()=>{
    if(!cameraPages.length)return;setCameraProcessing(true);setShowCamera(false);setProcessing(true);setProcessingMsg(`Processing ${cameraPages.length} page${cameraPages.length>1?"s":""}…`);
    try{
      const imageContent=cameraPages.map(p=>({type:"image",source:{type:"base64",media_type:"image/jpeg",data:p.data}}));
      imageContent.push({type:"text",text:"These are photographed pages of a physical document."});
      const prompt=`Analyse this photographed document (${cameraPages.length} page${cameraPages.length>1?"s":""}) as evidence.`+buildEvidencePrompt(dossier);
      const res=await fetch("/api/claude",{method:"POST",headers:aiHeaders({"Content-Type":"application/json"}),body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:8000,system:SYSTEM,messages:[{role:"user",content:[...imageContent,{type:"text",text:prompt}]}]})});
      const data=await res.json();if(data.error){notifyAiError(data);throw new Error(data.error);}const response=data.content?.[0]?.text||"";
      const parsed=extractJson(response);
      const current=dossier||{evidence:[],timeline:[],witness_statement:"",overview:"",next_steps:""};
      setProcessingMsg("Updating case overview…");
      await updateDossier(await withWholeCaseOverview(mergeParsedIntoDossier(current,parsed)));
    }catch(e){alert("Something went wrong with the camera scan.\n\n"+e.message);}
    cameraPages.forEach(p=>URL.revokeObjectURL(p.preview));setCameraPages([]);setCameraProcessing(false);setProcessing(false);setProcessingMsg("");
  },[cameraPages,dossier,updateDossier]);

  if(showPrivacy)return<PrivacyPage onBack={()=>{setShowPrivacy(false);window.history.pushState({},"","/");}}/>;
  if(readOnly){if(!readOnlyDossier)return<div style={{background:NAVY,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{textAlign:"center",color:LIGHT}}><Spinner/><p style={{marginTop:16,color:"#7a96b0"}}>Loading dossier…</p></div></div>;return<ReadOnlyDossier dossier={readOnlyDossier}/>;}
  if(showWelcome)return<WelcomeScreen onStart={()=>{markWelcomed();setShowWelcome(false);}} onClose={hasBeenWelcomed()?()=>setShowWelcome(false):null}/>;

  const evidenceCount=dossier?.evidence?.length||0;

  return(<div style={{fontFamily:"'Open Sans', sans-serif",background:NAVY,minHeight:"100vh",width:"100%",color:LIGHT}}>
    <div style={{background:NAVY,borderBottom:`3px solid ${YELLOW}`,padding:"12px 16px 0"}}>
      <div style={{maxWidth:1100,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
          <img src="/getsafe-logo.png" alt="Get SAFE" style={{width:40,height:40,objectFit:"contain",flexShrink:0}}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:9,letterSpacing:3,color:YELLOW,textTransform:"uppercase",fontFamily:"'Poppins', sans-serif"}}>Get SAFE · Academy of Life Planning</div>
            <h1 style={{margin:0,fontFamily:"'Poppins', sans-serif",fontSize:22,fontWeight:800,color:WHITE}}>GOLIATHON</h1>
          </div>
          <CaseSwitcher cases={cases} activeId={activeId} onSwitch={handleSwitchCase} onNew={handleNewCase} onDelete={handleDeleteCase} onClearAll={handleClearAll}/>
        </div>
        <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
          {saved&&<Tag color="#7e9e82">✓ Saved</Tag>}
          {saveFailed&&<Tag color="#e57373">⚠ Not saved to cloud — sharing may not work. Try Save again.</Tag>}
          <Btn small variant="subtle" onClick={handleSaveLocal}>💾 Save</Btn>
          <label style={{cursor:"pointer"}}><Btn small variant="subtle" onClick={()=>restoreRef.current?.click()}>📂 Restore</Btn><input ref={restoreRef} type="file" accept=".json" style={{display:"none"}} onChange={handleRestoreLocal}/></label>
          {dossier&&<Btn small variant="subtle" onClick={handleReset}>↺ Reset</Btn>}
          {dossier&&<Btn small danger onClick={handleDeleteDossier}>🗑 Delete</Btn>}
          {dossier&&<Btn small variant="ghost" onClick={async()=>{
            try{const {burden_of_proof_letter:_bpl,allegations:_al,...dForDb}=dossier;await saveDossierToDb({...dForDb,share_id:shareId},isSavedRef.current);isSavedRef.current=true;setSaved(true);setSaveFailed(false);setShowShare(true);}
            catch(e){setSaveFailed(true);alert("Could not save to the cloud before sharing. Please check your connection and try again.\n\n"+e.message);}
          }}>🔗 Share</Btn>}
          {dossier&&<Btn small onClick={()=>setShowDownload(true)}>↓ Download</Btn>}
        </div>
      </div>
    </div>

    <div style={{maxWidth:1100,margin:"0 auto",padding:"16px"}}>
      {dossier?.case_title&&(
        <div style={{background:YELLOW+"15",border:`1px solid ${YELLOW}40`,borderRadius:12,padding:"12px 16px",marginBottom:14,display:"flex",alignItems:"center",gap:10}}>
          {editingTitle?(
            <div style={{display:"flex",gap:8,flex:1,alignItems:"center"}}>
              <input value={titleDraft} onChange={e=>setTitleDraft(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSaveTitle()} autoFocus style={{flex:1,background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:6,padding:"6px 10px",color:WHITE,fontSize:14,outline:"none",fontFamily:"'Poppins', sans-serif",fontWeight:700}}/>
              <Btn small onClick={handleSaveTitle}>Save</Btn>
              <Btn small variant="subtle" onClick={()=>setEditingTitle(false)}>Cancel</Btn>
            </div>
          ):(
            <><div style={{flex:1}}><div style={{fontSize:9,letterSpacing:3,color:YELLOW,textTransform:"uppercase",fontFamily:"'Poppins', sans-serif",marginBottom:2}}>Case</div><h2 style={{margin:0,fontFamily:"'Poppins', sans-serif",fontSize:16,fontWeight:800,color:WHITE}}>{dossier.case_title}</h2></div><Tag>{evidenceCount} item{evidenceCount!==1?"s":""} filed</Tag><button onClick={()=>{setTitleDraft(dossier.case_title);setEditingTitle(true);}} style={{background:"none",border:`1px solid ${BORDER}`,borderRadius:6,padding:"4px 8px",color:"#7a96b0",fontSize:11,cursor:"pointer"}}>✏ Edit</button></>
          )}
        </div>
      )}

      {dossier&&<StrengthMeter dossier={dossier}/>}

      {evidenceCount===0&&!processing&&!threatProcessing&&<div style={{background:"#ffc72c15",border:"1px solid #ffc72c40",borderRadius:10,padding:"12px 14px",marginBottom:14,textAlign:"left"}}>
        <p style={{margin:"0 0 8px",fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:13,color:WHITE}}>⚡ Just received a legal claim or threat?</p>
        <p style={{margin:"0 0 10px",fontSize:12,color:"#a0b4c8",lineHeight:1.6}}>Start here. We will immediately identify what the claimant must prove and generate a challenge letter you can send today.</p>
        <Btn small onClick={()=>setShowThreatIntake(true)}>Respond to a Legal Threat</Btn>
      </div>}

      <div onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={e=>{e.preventDefault();setDragOver(false);handleFile(e.dataTransfer.files[0]);}} onClick={()=>!processing&&fileRef.current?.click()}
        style={{border:`2px dashed ${dragOver?YELLOW:(processing||threatProcessing)?YELLOW+"60":BORDER}`,borderRadius:16,padding:"22px 14px",textAlign:"center",cursor:(processing||threatProcessing)?"not-allowed":"pointer",background:dragOver?"#001e3d":(processing||threatProcessing)?"#001830":"transparent",transition:"all 0.2s",marginBottom:18}}>
        {(processing||threatProcessing)?(
          <div><div style={{marginBottom:10}}><Spinner/></div><p style={{margin:0,fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:15,color:YELLOW}}>{threatProcessing?"Generating your challenge…":processingMsg}</p><p style={{margin:"6px 0 0",fontSize:13,color:"#7a96b0"}}>{threatProcessing?"Identifying what they must prove and drafting your letter":"Goliathon is building your dossier…"}</p></div>
        ):(
          <div>
            <div style={{fontSize:38,marginBottom:10}}>{evidenceCount===0?"⚖️":"➕"}</div>
            <p style={{margin:"0 0 6px",fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:15,color:WHITE}}>{evidenceCount===0?"Upload your first piece of evidence to begin":"Upload your next piece of evidence"}</p>
            <p style={{margin:"0 0 14px",fontSize:13,color:"#7a96b0"}}>{evidenceCount===0?"Goliathon will build your case automatically":`${evidenceCount} item${evidenceCount!==1?"s":""} filed — keep adding to build your case`}</p>
            <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
              <label onClick={e=>e.stopPropagation()} style={{cursor:"pointer",background:YELLOW,color:NAVY,borderRadius:8,fontFamily:"'Poppins',sans-serif",fontWeight:700,fontSize:12,padding:"7px 16px",display:"inline-flex",alignItems:"center",gap:6,whiteSpace:"nowrap",letterSpacing:0.5}}>📎 Upload File<input type="file" accept="image/*,.pdf,.txt,.html,.htm,.doc,.docx,.msg" style={{display:"none"}} onChange={e=>{if(e.target.files[0])handleFile(e.target.files[0]);}}/></label>
              <Btn small variant="subtle" onClick={e=>{e.stopPropagation();setShowCamera(true);setCameraPages([]);}}>📷 Camera Scan</Btn>
              <Btn small variant="subtle" onClick={e=>{e.stopPropagation();setShowUrl(true);}}>🔗 Add URL</Btn>
              <Btn small variant="subtle" onClick={e=>{e.stopPropagation();setShowPasteText(true);}}>📝 Paste Email / Text</Btn>
            </div>
            <p style={{margin:"10px 0 0",fontSize:11,color:"#5a7a96"}}>Accepts JPG, PNG, PDF, TXT, HTML, DOC, DOCX, MSG — or drag and drop a file here</p>
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*,.pdf,.txt,.html,.htm,.doc,.docx,.msg" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple style={{display:"none"}} onChange={handleCameraCapture}/>

      {showThreatIntake&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,20,40,0.92)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:20,overflowY:"auto"}} onClick={()=>setShowThreatIntake(false)}>
          <div style={{background:"#0d2137",border:"1px solid #ffc72c60",borderRadius:16,padding:24,width:"100%",maxWidth:580}} onClick={e=>e.stopPropagation()}>
            <h3 style={{margin:"0 0 6px",color:"#ffc72c",fontFamily:"'Poppins', sans-serif",fontSize:17}}>⚡ Respond to a Legal Claim or Threat</h3>
            <p style={{margin:"0 0 18px",fontSize:12,color:"#7a96b0",lineHeight:1.7}}>Tell us about the claim you have received. We will identify what the claimant must prove and generate a challenge letter you can send today — before you are required to respond.</p>

            <label style={{display:"block",fontSize:11,color:"#7a96b0",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>Who is claiming against you?</label>
            <input value={threatForm.claimant} onChange={e=>setThreatForm(f=>({...f,claimant:e.target.value}))} placeholder="e.g. Barclays Bank PLC, Halifax, a debt collector…" style={{width:"100%",boxSizing:"border-box",background:"#0a1929",border:"1px solid #1e3a5f",borderRadius:8,padding:"8px 10px",color:"#c8dae6",fontSize:13,marginBottom:12}}/>

            <label style={{display:"block",fontSize:11,color:"#7a96b0",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>Type of claim</label>
            <select value={threatForm.claimType} onChange={e=>setThreatForm(f=>({...f,claimType:e.target.value}))} style={{width:"100%",boxSizing:"border-box",background:"#0a1929",border:"1px solid #1e3a5f",borderRadius:8,padding:"8px 10px",color:"#c8dae6",fontSize:13,marginBottom:12}}>
              <option>mortgage possession</option>
              <option>debt claim</option>
              <option>county court judgment</option>
              <option>letter before action</option>
              <option>charging order</option>
              <option>bankruptcy petition</option>
              <option>other legal threat</option>
            </select>

            <div style={{display:"flex",gap:10,marginBottom:12}}>
              <div style={{flex:1}}>
                <label style={{display:"block",fontSize:11,color:"#7a96b0",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>Amount claimed</label>
                <input value={threatForm.amount} onChange={e=>setThreatForm(f=>({...f,amount:e.target.value}))} placeholder="e.g. £7,502.13" style={{width:"100%",boxSizing:"border-box",background:"#0a1929",border:"1px solid #1e3a5f",borderRadius:8,padding:"8px 10px",color:"#c8dae6",fontSize:13}}/>
              </div>
              <div style={{flex:1}}>
                <label style={{display:"block",fontSize:11,color:"#7a96b0",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>Response deadline</label>
                <input value={threatForm.deadline} onChange={e=>setThreatForm(f=>({...f,deadline:e.target.value}))} placeholder="e.g. 14 days, 9 Dec 2025" style={{width:"100%",boxSizing:"border-box",background:"#0a1929",border:"1px solid #1e3a5f",borderRadius:8,padding:"8px 10px",color:"#c8dae6",fontSize:13}}/>
              </div>
            </div>

            <label style={{display:"block",fontSize:11,color:"#7a96b0",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>Describe the claim in your own words</label>
            <textarea value={threatForm.details} onChange={e=>setThreatForm(f=>({...f,details:e.target.value}))} placeholder="What are they claiming? What happened? What do you dispute?" rows={5} style={{width:"100%",boxSizing:"border-box",background:"#0a1929",border:"1px solid #1e3a5f",borderRadius:8,padding:"10px",color:"#c8dae6",fontSize:13,lineHeight:1.7,resize:"vertical",fontFamily:"inherit",marginBottom:16}}/>

            <label style={{display:"block",fontSize:11,color:"#7a96b0",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>Attach the letter or document (optional)</label>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
              <label style={{flex:1,background:"#0a1929",border:"1px solid #1e3a5f",borderRadius:8,padding:"8px 10px",color:threatFile?"#c8dae6":"#5a7a96",fontSize:12,cursor:"pointer",display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {threatFile?threatFile.name:"📎 Tap to attach photo or file of the letter…"}
                <input ref={threatFileRef} type="file" accept="image/*,.pdf,.doc,.docx,.txt" style={{display:"none"}} onChange={e=>{if(e.target.files[0])setThreatFile(e.target.files[0]);}}/>
              </label>
              {threatFile&&<Btn small variant="subtle" onClick={()=>{setThreatFile(null);if(threatFileRef.current)threatFileRef.current.value="";}}>✕</Btn>}
            </div>

            <div style={{background:"#001830",border:"1px solid #1e3a5f",borderRadius:8,padding:"10px 12px",marginBottom:16}}>
              <p style={{margin:0,fontSize:11,color:"#7a96b0",lineHeight:1.6}}>⚡ We will generate: five questions the claimant must answer · a challenge letter you can send today · your case overview · a Decision-Maker Summary{threatFile?" · full analysis of the attached document":""}</p>
            </div>

            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <Btn small variant="subtle" onClick={()=>{setShowThreatIntake(false);setThreatFile(null);}}>Cancel</Btn>
              <Btn small onClick={handleThreatIntake} disabled={!threatForm.claimant&&!threatFile}>Generate Challenge</Btn>
            </div>
          </div>
        </div>
      )}

      {showPasteText&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,20,40,0.85)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowPasteText(false)}>
          <div style={{background:"#0d2137",border:"1px solid #1e3a5f",borderRadius:16,padding:24,width:"100%",maxWidth:560}} onClick={e=>e.stopPropagation()}>
            <h3 style={{margin:"0 0 16px",color:"#ffc72c",fontFamily:"'Poppins',sans-serif",fontSize:16}}>📝 Paste text or an email</h3>
            <p style={{margin:"0 0 14px",fontSize:12,color:"#7a96b0",lineHeight:1.6}}>Paste a file note, letter, email, or any written record. Give it a date and title so it appears correctly in your evidence register. If it is an email with attachments, attach them below: the email and its attachments are filed together as one item.</p>
            <div style={{display:"flex",gap:10,marginBottom:10}}>
              <div style={{flex:1}}>
                <label style={{display:"block",fontSize:11,color:"#7a96b0",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>Date (e.g. 2026_06_03)</label>
                <input value={pasteTextDate} onChange={e=>setPasteTextDate(e.target.value)} placeholder="YYYY_MM_DD" style={{width:"100%",boxSizing:"border-box",background:"#0a1929",border:"1px solid #1e3a5f",borderRadius:8,padding:"8px 10px",color:"#c8dae6",fontSize:13,fontFamily:"monospace"}}/>
              </div>
              <div style={{flex:2}}>
                <label style={{display:"block",fontSize:11,color:"#7a96b0",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>Title / Description</label>
                <input value={pasteTextTitle} onChange={e=>setPasteTextTitle(e.target.value)} placeholder="e.g. File Note: mortgage discharge" style={{width:"100%",boxSizing:"border-box",background:"#0a1929",border:"1px solid #1e3a5f",borderRadius:8,padding:"8px 10px",color:"#c8dae6",fontSize:13}}/>
              </div>
            </div>
            <textarea value={pasteTextContent} onChange={e=>setPasteTextContent(e.target.value)} placeholder="Paste or type your text here…" rows={10} style={{width:"100%",boxSizing:"border-box",background:"#0a1929",border:"1px solid #1e3a5f",borderRadius:8,padding:"10px",color:"#c8dae6",fontSize:13,lineHeight:1.7,resize:"vertical",fontFamily:"inherit",marginBottom:10}}/>
            <div style={{border:"1px dashed #1e3a5f",borderRadius:8,padding:"10px 12px",marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                <span style={{fontSize:12,color:"#a0b4c8"}}>{pasteFiles.length?`${pasteFiles.length} attachment${pasteFiles.length!==1?"s":""}, filed with this text as one item`:"Attachments (optional)"}</span>
                <Btn small variant="ghost" onClick={()=>pasteFilesRef.current?.click()}>📎 Attach files</Btn>
              </div>
              <input ref={pasteFilesRef} type="file" multiple accept={BUNDLE_ACCEPT} style={{display:"none"}} onChange={e=>{const add=Array.from(e.target.files||[]);setPasteFiles(prev=>[...prev,...add].slice(0,10));e.target.value="";}}/>
              {pasteFiles.map((f,k)=>(<div key={k} style={{display:"flex",alignItems:"center",gap:8,marginTop:8,fontSize:12,color:"#c8dae6"}}>
                <span style={{color:YELLOW,fontWeight:700,minWidth:16}}>{BUNDLE_LETTERS[k]}</span>
                <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</span>
                <span style={{color:"#7a96b0",flexShrink:0}}>{f.size<1024*1024?Math.max(1,Math.round(f.size/1024))+"KB":(f.size/1024/1024).toFixed(1)+"MB"}</span>
                <button onClick={()=>setPasteFiles(prev=>prev.filter((_,j)=>j!==k))} aria-label={`Remove ${f.name}`} style={{background:"none",border:"1px solid #1e3a5f",borderRadius:4,color:"#e57373",fontSize:11,cursor:"pointer",padding:"1px 6px"}}>✕</button>
              </div>))}
              {pasteFiles.length>=10&&<p style={{margin:"8px 0 0",fontSize:11,color:"#7a96b0"}}>Up to 10 attachments per item.</p>}
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <Btn small variant="subtle" onClick={()=>{setShowPasteText(false);setPasteFiles([]);}}>Cancel</Btn>
              <Btn small onClick={handlePasteText} disabled={!pasteTextContent.trim()&&!pasteFiles.length}>{pasteFiles.length?"Analyse as one item":"Analyse Entry"}</Btn>
            </div>
          </div>
        </div>
      )}

      {showUrl&&(
        <div style={{background:PANEL,border:`1px solid ${BORDER}`,borderRadius:12,padding:16,marginBottom:18}}>
          <p style={{margin:"0 0 10px",fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:13,color:WHITE}}>Add a URL as evidence</p>
          <div style={{display:"flex",gap:8}}>
            <input value={urlInput} onChange={e=>setUrlInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleUrl()} placeholder="https://example.com/page" style={{flex:1,background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:8,padding:"8px 12px",color:WHITE,fontSize:13,outline:"none",fontFamily:"'Open Sans', sans-serif"}}/>
            <Btn onClick={handleUrl} disabled={!urlInput.trim()}>Add</Btn>
            <Btn variant="subtle" onClick={()=>setShowUrl(false)}>Cancel</Btn>
          </div>
        </div>
      )}

      {!dossier&&!processing&&(<div style={{textAlign:"center",padding:"44px 20px"}}><p style={{color:"#5a7a96",fontSize:14,fontStyle:"italic",maxWidth:420,margin:"0 auto",lineHeight:1.8}}>Your evidence dossier will appear here as you upload. Each document is automatically read, analysed, and filed. Your case builds itself.</p></div>)}

      {dossier&&<CaseView key={activeId} dossier={dossier}
        refreshingOverview={refreshingOverview} onRefreshOverview={handleRefreshOverview}
        onEditWitness={()=>setEditingWitness(true)} onEditTimeline={i=>setEditingTimeline(i)}
        onEditEvidence={ri=>setEditingEvidence(ri)} onMoveEvidence={handleMoveEvidence}
        onSaveAllegations={al=>updateDossier({...dossier,allegations:al})}
        chat={saved?<CaseChat caseId={shareId}/>:<p style={{margin:0,fontSize:12,color:"#7a96b0",lineHeight:1.7}}>Save this case to start chatting with it.</p>}/>}
    </div>

    <div style={{borderTop:`1px solid ${BORDER}`,padding:"14px 20px",textAlign:"center",marginTop:20}}>
      <div style={{marginBottom:10}}>
        <button onClick={()=>setShowWelcome(true)} style={{background:"none",border:`1px solid ${BORDER}`,borderRadius:6,padding:"6px 16px",color:"#7a96b0",fontSize:12,cursor:"pointer",fontFamily:"'Poppins', sans-serif"}}>ℹ About Goliathon</button>
      </div>
      <p style={{margin:0,fontSize:11,color:"#5a7a96"}}>Goliathon · Get SAFE (Support After Financial Exploitation) · Founded by Steve Conley · Academy of Life Planning · <a href="https://www.academyoflifeplanning.com/individuals/get-safe" style={{color:"#7a96b0"}}>academyoflifeplanning.com/individuals/get-safe</a> · <a href="/privacy" onClick={e=>{e.preventDefault();setShowPrivacy(true);window.history.pushState({},"","/privacy");}} style={{color:"#7a96b0"}}>Privacy Policy</a> · <a href="https://buy.stripe.com/dRm28r0MU6k77bb1vleIw01" target="_blank" rel="noopener noreferrer" style={{color:"#7a96b0"}}>Support Get SAFE</a> · Educational use only. Not legal, financial, or mental-health advice.</p>
    </div>

    {showCamera&&(
      <div style={{position:"fixed",inset:0,background:"#000000dd",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
        <div style={{background:PANEL,border:`1px solid ${BORDER}`,borderRadius:16,padding:26,maxWidth:460,width:"90%",maxHeight:"90vh",overflowY:"auto"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}><h3 style={{margin:0,fontFamily:"'Poppins', sans-serif",color:WHITE,fontSize:16,fontWeight:700}}>📷 Camera Scan</h3><Btn small variant="subtle" onClick={()=>{setShowCamera(false);setCameraPages([]);}}>✕</Btn></div>
          <p style={{color:"#7a96b0",fontSize:13,lineHeight:1.7,marginBottom:14}}>Photograph a physical document. Capture multiple pages — they will be analysed as a single evidence item.</p>
          {cameraPages.length>0&&(<div style={{marginBottom:12}}><div style={{fontSize:11,color:YELLOW,marginBottom:6,fontFamily:"'Poppins', sans-serif",fontWeight:600}}>{cameraPages.length} page{cameraPages.length>1?"s":""} captured</div><div style={{display:"flex",gap:7,flexWrap:"wrap"}}>{cameraPages.map((p,i)=>(<div key={i} style={{position:"relative"}}><img src={p.preview} alt={`Page ${i+1}`} style={{width:68,height:85,objectFit:"cover",borderRadius:6,border:`1px solid ${BORDER}`}}/><div onClick={()=>setCameraPages(prev=>prev.filter((_,j)=>j!==i))} style={{position:"absolute",top:2,right:2,background:NAVY,borderRadius:"50%",width:15,height:15,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:YELLOW,cursor:"pointer",fontWeight:700}}>✕</div><div style={{fontSize:9,color:"#7a96b0",textAlign:"center",marginTop:2}}>Page {i+1}</div></div>))}</div></div>)}
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <Btn variant="subtle" small onClick={()=>cameraRef.current?.click()}>{cameraPages.length===0?"📷 Open Camera":"📷 Add Page"}</Btn>
            {cameraPages.length>0&&<Btn small onClick={handleCameraSubmit} disabled={cameraProcessing}>{cameraProcessing?"Processing…":`Analyse ${cameraPages.length} Page${cameraPages.length>1?"s":""} →`}</Btn>}
          </div>
          <p style={{margin:"10px 0 0",fontSize:11,color:"#5a7a96"}}>Tip: Good lighting and steady hand give the best results.</p>
        </div>
      </div>
    )}

    {showShare&&<ShareModal shareId={shareId} onClose={()=>setShowShare(false)}/>}
    {showDownload&&dossier&&<DownloadModal dossier={dossier} onClose={()=>setShowDownload(false)}/>}
    {editingEvidence!==null&&dossier?.evidence?.[editingEvidence]&&(<EditEvidenceModal item={dossier.evidence[editingEvidence]} index={editingEvidence} onSave={handleEditEvidence} onDelete={handleDeleteEvidence} onClose={()=>setEditingEvidence(null)}/>)}
    {editingTimeline!==null&&dossier?.timeline?.[editingTimeline]&&(<EditTimelineModal item={dossier.timeline[editingTimeline]} index={editingTimeline} onSave={handleEditTimeline} onDelete={handleDeleteTimeline} onClose={()=>setEditingTimeline(null)}/>)}
    <OwnKeyPanel/>
    {editingWitness&&dossier&&(<EditWitnessModal text={toDisplayText(dossier.witness_statement)} onSave={handleEditWitness} onClose={()=>setEditingWitness(false)}/>)}

    <style>{`@keyframes pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}*{box-sizing:border-box}::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:#001e3d}::-webkit-scrollbar-thumb{background:${YELLOW}40;border-radius:3px}input::placeholder,textarea::placeholder{color:#5a7a96}`}</style>
  </div>);
}
