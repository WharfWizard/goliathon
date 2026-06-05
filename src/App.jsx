import { useState, useRef, useCallback, useEffect } from "react";

if (!document.getElementById("goliathon-fonts")) {
  const link = document.createElement("link");
  link.id = "goliathon-fonts"; link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&family=Open+Sans:wght@400;500;600&display=swap";
  document.head.appendChild(link);
}

const NAVY="#00274d",YELLOW="#ffc72c",WHITE="#ffffff",GREY="#555555",PANEL="#002a57",BORDER="#003a6e",LIGHT="#e8eef4";
const SYSTEM=`You are the Goliathon AI created by Steve Conley, Founder of Get SAFE (Support After Financial Exploitation) and the Academy of Life Planning. Goliathon builds a professional evidence dossier for anyone in a dispute with an institution. Core values: dignity, precision, clarity, empowerment. Never give legal, financial, or mental-health advice. Write in plain English. Be warm, calm, and strategic.`;

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
function formatDate(iso){if(!iso)return"";try{return new Date(iso).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});}catch{return iso;}}
async function callClaude(messages){
  const r=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:4000,system:SYSTEM,messages})});
  const d=await r.json();return d.content?.[0]?.text||"";
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
function downloadText(filename,content){const blob=new Blob([content],{type:"text/plain"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);}

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
    doc.text(caseTitle,margin,33);
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
    .replace(/&.*$/,'')             // strip anything from & onwards (mid-string artefact)
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
  // Strip "1. 1." "2. 2." duplicate numbering (array join then manual prefix)
  return text
    .replace(/^(\d+)\.\s+\1\.\s+/gm,'$1. ')
    .replace(/^(\d+)\.\s+(\d+)\.\s+(?=\D)/gm,(m,a,b)=>a===b?a+'. ':m);
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
    pdfAddFooter(doc,pageNums.current,999);
    doc.addPage();
    pageNums.current++;
    const newY=pdfAddHeader(doc,logoB64,caseTitle,sectionTitle);
    return newY+4;
  }
  return y;
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
    timeline:{title:"Chronological Timeline",data:()=>(dossier.timeline||[]).map((t,i)=>({type:"timeline",num:i+1,date:t.date||"Date unknown",event:t.event,evidence:t.evidence}))},
    statement:{title:"Witness Statement",data:()=>[{type:"body",text:dossier.witness_statement||"No statement available."}]},
    evidence:{title:`Evidence Library — ${(dossier.evidence||[]).length} Items`,data:()=>(dossier.evidence||[]).map((e,i)=>({type:"evidence",num:i+1,title:e.title,date:e.date,docType:e.type,summary:e.summary,factsObserved:e.facts_observed,significance:e.significance,redFlags:e.red_flags}))},
    nextsteps:{title:"Next Steps",data:()=>[{type:"body",text:dossier.next_steps||"No next steps available."}]},
    keyquestions:{title:"Key Questions in This Case",data:()=>[{type:"body",text:dossier.key_questions||"No key questions identified yet."}]},
    decisionsummary:{title:"Decision-Maker Summary",data:()=>[{type:"body",text:dossier.decision_summary||"Decision-Maker Summary not yet generated."}]},
    complete:{title:"Complete Evidence Dossier",data:()=>{
      const items=[];
      items.push({type:"sectionHeader",title:"Case Overview"});
      items.push({type:"body",text:dossier.overview||""});
      items.push({type:"sectionHeader",title:"Chronological Timeline"});
      (dossier.timeline||[]).forEach((t,i)=>items.push({type:"timeline",num:i+1,date:t.date||"Date unknown",event:t.event,evidence:t.evidence}));
      items.push({type:"sectionHeader",title:"Witness Statement"});
      items.push({type:"body",text:dossier.witness_statement||""});
      items.push({type:"sectionHeader",title:`Evidence Library — ${(dossier.evidence||[]).length} Items`});
      (dossier.evidence||[]).forEach((e,i)=>items.push({type:"evidence",num:i+1,title:e.title,date:e.date,docType:e.type,summary:e.summary,factsObserved:e.facts_observed,significance:e.significance,redFlags:e.red_flags}));
      items.push({type:"sectionHeader",title:"Next Steps"});
      items.push({type:"body",text:dossier.next_steps||""});
      if(dossier.decision_summary){items.push({type:"sectionHeader",title:"Decision-Maker Summary"});items.push({type:"body",text:dossier.decision_summary});}
      if(dossier.key_questions){items.push({type:"sectionHeader",title:"Key Questions in This Case"});items.push({type:"body",text:dossier.key_questions});}
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
      y=checkNewPage(doc,y,16,logoB64,caseTitle,sec.title,pageNums);
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
      const eventLines=doc.splitTextToSize(item.event||"",contentWidth-22);
      const neededH=6+eventLines.length*4.5+(item.evidence?4:0)+4;
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
        doc.text(item.evidence,margin+10,ey);ey+=3.5;
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
  pdfAddFooter(doc,pageNums.current,pageNums.current);

  const filename=`${caseTitle.replace(/[^a-z0-9]/gi,"_")}_${sectionKey}.pdf`;
  doc.save(filename);
}
function buildFullDossierText(d){return["GOLIATHON EVIDENCE DOSSIER","Get SAFE (Support After Financial Exploitation)",`Generated: ${formatDate(new Date().toISOString())}`,"","═══════════════════════════════","CASE OVERVIEW","═══════════════════════════════",d.overview||"","","═══════════════════════════════","CHRONOLOGICAL TIMELINE","═══════════════════════════════",...(d.timeline||[]).map((t,i)=>`${i+1}. [${t.date||"Date unknown"}] ${t.event}`),"","═══════════════════════════════","WITNESS STATEMENT","═══════════════════════════════",d.witness_statement||"","","═══════════════════════════════",`EVIDENCE LIBRARY (${(d.evidence||[]).length} items)`,"═══════════════════════════════",...(d.evidence||[]).map((e,i)=>`[${String(i+1).padStart(3,"0")}] ${e.title}\n${e.summary}`),"","═══════════════════════════════","NEXT STEPS","═══════════════════════════════",d.next_steps||"","─────────────────────────────","Goliathon · Get SAFE · www.get-safe.org.uk","Educational use only. Not legal advice."].join("\n");}
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
function Tag({children,color=YELLOW}){return<span style={{background:color+"20",color,border:`1px solid ${color}40`,borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600,fontFamily:"'Poppins', sans-serif"}}>{children}</span>;}
function EmptyState({text}){return<p style={{color:"#5a7a96",fontSize:13,fontStyle:"italic",margin:0}}>{text}</p>;}

function StrengthMeter({dossier}){
  const score=caseStrength(dossier);
  const label=score<20?"Just started":score<40?"Building":score<60?"Developing":score<80?"Strong":"Comprehensive";
  const color=score<40?"#e57373":score<70?YELLOW:"#7e9e82";
  return(<div style={{background:PANEL,border:`1px solid ${BORDER}`,borderRadius:10,padding:"12px 16px",marginBottom:16}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}><span style={{fontSize:12,color:"#a0b4c8",fontFamily:"'Poppins', sans-serif",fontWeight:600}}>Case Strength</span><span style={{fontSize:12,color,fontFamily:"'Poppins', sans-serif",fontWeight:700}}>{label} · {score}%</span></div><div style={{height:6,background:"#001e3d",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${score}%`,background:color,borderRadius:3,transition:"width 0.6s ease"}}/></div></div>);
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
          <p style={{margin:"12px 0 0",fontSize:11,color:"#5a7a96"}}>Free · No account required · Educational use only · Not legal advice</p>
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
  const field=(val,set,label)=>(<div style={{marginBottom:12}}><label style={{fontSize:11,color:"#a0b4c8",letterSpacing:1,textTransform:"uppercase",fontFamily:"'Poppins', sans-serif",display:"block",marginBottom:3}}>{label}</label>{label==="Summary"?<textarea value={val} onChange={e=>set(e.target.value)} rows={3} style={{width:"100%",background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:6,padding:"7px 10px",color:LIGHT,fontSize:13,outline:"none",fontFamily:"'Open Sans', sans-serif",resize:"vertical",boxSizing:"border-box"}}/>:<input value={val} onChange={e=>set(e.target.value)} style={{width:"100%",background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:6,padding:"7px 10px",color:LIGHT,fontSize:13,outline:"none",fontFamily:"'Open Sans', sans-serif",boxSizing:"border-box"}}/>}</div>);
  return(<div style={{position:"fixed",inset:0,background:"#000000cc",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div style={{background:PANEL,border:`1px solid ${BORDER}`,borderRadius:16,padding:26,maxWidth:480,width:"90%",maxHeight:"90vh",overflowY:"auto"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}><h3 style={{margin:0,fontFamily:"'Poppins', sans-serif",color:WHITE,fontSize:16,fontWeight:700}}>Edit Evidence #{String(index+1).padStart(3,"0")}</h3><Btn small variant="subtle" onClick={onClose}>✕</Btn></div>
      {field(title,setTitle,"Title")}{field(date,setDate,"Date")}{field(type,setType,"Type")}{field(summary,setSummary,"Summary")}{field(factsObserved,setFactsObserved,"What This Shows")}{field(significance,setSignificance,"Why It Matters")}
      <div style={{display:"flex",gap:8,justifyContent:"space-between",marginTop:8}}>
        <Btn danger small onClick={()=>{if(window.confirm("Remove this item?"))onDelete(index);}}>🗑 Remove</Btn>
        <div style={{display:"flex",gap:8}}><Btn variant="subtle" small onClick={onClose}>Cancel</Btn><Btn small onClick={()=>onSave(index,{title,date,type,summary,facts_observed:factsObserved,significance})}>Save</Btn></div>
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
  ];
  return(<div style={{position:"fixed",inset:0,background:"#000000cc",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
    <div style={{background:PANEL,border:`1px solid ${BORDER}`,borderRadius:16,padding:24,maxWidth:460,width:"90%",maxHeight:"90vh",overflowY:"auto"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}><h3 style={{margin:0,fontFamily:"'Poppins', sans-serif",color:WHITE,fontSize:17,fontWeight:700}}>Download Dossier</h3><Btn variant="subtle" small onClick={onClose}>✕</Btn></div>
      {opts.map((o,i)=>(<div key={i} onClick={o.action} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 12px",background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:10,marginBottom:7,cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.borderColor=YELLOW+"60"} onMouseLeave={e=>e.currentTarget.style.borderColor=BORDER}><span style={{fontSize:20,flexShrink:0}}>{o.icon}</span><div style={{flex:1}}><div style={{fontFamily:"'Poppins', sans-serif",fontWeight:700,color:WHITE,fontSize:13,marginBottom:1}}>{o.label}</div><div style={{fontSize:11,color:"#7a96b0"}}>{o.desc}</div></div><span style={{color:YELLOW,fontSize:15}}>↓</span></div>))}
    </div>
  </div>);
}

function ReadOnlyDossier({dossier}){
  const [showDownload,setShowDownload]=useState(false);
  return(<div style={{fontFamily:"'Open Sans', sans-serif",background:NAVY,minHeight:"100vh",color:LIGHT}}>
    <div style={{background:NAVY,borderBottom:`3px solid ${YELLOW}`,padding:"14px 20px"}}><div style={{maxWidth:860,margin:"0 auto",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}><img src="/getsafe-logo.png" alt="Get SAFE" style={{width:40,height:40,objectFit:"contain"}}/><div style={{flex:1,minWidth:0}}><div style={{fontSize:9,letterSpacing:3,color:YELLOW,textTransform:"uppercase",fontFamily:"'Poppins', sans-serif"}}>Get SAFE · Goliathon Evidence Dossier</div><h1 style={{margin:0,fontFamily:"'Poppins', sans-serif",fontSize:19,fontWeight:800,color:WHITE,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{dossier.case_title||"Evidence Dossier"}</h1></div><div style={{display:"flex",gap:8,alignItems:"center"}}><Tag>Read Only</Tag><Btn small onClick={()=>setShowDownload(true)}>↓ Download</Btn></div></div></div>
    <div style={{maxWidth:860,margin:"0 auto",padding:"20px 16px"}}>
      <Panel title="Case Overview" icon="📋">{dossier.overview?<p style={{margin:0,fontSize:14,lineHeight:1.8,color:LIGHT}}>{dossier.overview}</p>:<EmptyState text="No overview yet."/>}</Panel>
      <Panel title="Timeline" icon="📅">{!(dossier.timeline||[]).length?<EmptyState text="No timeline yet."/>:(dossier.timeline||[]).map((t,i)=>(<div key={i} style={{display:"flex",gap:12,marginBottom:12,paddingBottom:12,borderBottom:i<dossier.timeline.length-1?`1px solid ${BORDER}`:"none"}}><div style={{width:26,height:26,background:YELLOW,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:11,color:NAVY,flexShrink:0}}>{i+1}</div><div><div style={{fontSize:11,color:YELLOW,fontWeight:600,marginBottom:2}}>{t.date||"Date unknown"}</div><div style={{fontSize:13,color:LIGHT,lineHeight:1.6}}>{t.event}</div></div></div>))}</Panel>
      <Panel title="Witness Statement" icon="📝">{dossier.witness_statement?<p style={{margin:0,fontSize:14,lineHeight:1.9,color:LIGHT,whiteSpace:"pre-wrap"}}>{dossier.witness_statement}</p>:<EmptyState text="No statement yet."/>}</Panel>
      <Panel title={`Evidence Library — ${(dossier.evidence||[]).length} items`} icon="🗂️">{!(dossier.evidence||[]).length?<EmptyState text="No evidence yet."/>:(dossier.evidence||[]).map((e,i)=>(<div key={i} style={{background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:10,padding:13,marginBottom:9}}><div style={{display:"flex",alignItems:"center",gap:7,marginBottom:6,flexWrap:"wrap"}}><span style={{fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:11,color:YELLOW}}>#{String(i+1).padStart(3,"0")}</span><span style={{fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:13,color:WHITE,flex:1}}>{e.title}</span>{e.date&&<Tag>{e.date}</Tag>}{e.type&&<Tag color="#7a96b0">{e.type}</Tag>}</div><p style={{margin:"0 0 6px",fontSize:12,color:LIGHT,lineHeight:1.6}}>{e.summary}</p>{e.facts_observed&&<p style={{margin:"0 0 3px",fontSize:11,color:"#7a96b0"}}><span style={{fontWeight:600,textTransform:"uppercase",fontSize:10,letterSpacing:"0.05em"}}>What this shows: </span>{e.facts_observed}</p>}{e.significance&&<p style={{margin:0,fontSize:11,color:YELLOW}}><span style={{fontWeight:600,textTransform:"uppercase",fontSize:10,letterSpacing:"0.05em"}}>Why it matters: </span>{e.significance}</p>}</div>))}</Panel>
      <Panel title="Next Steps" icon="📌">{dossier.next_steps?<p style={{margin:0,fontSize:14,lineHeight:1.8,color:LIGHT,whiteSpace:"pre-wrap"}}>{dossier.next_steps}</p>:<EmptyState text="No next steps yet."/>}</Panel>
      <Panel title="Key Questions in This Case" icon="❓">{dossier.key_questions?<p style={{margin:0,fontSize:14,lineHeight:1.8,color:LIGHT,whiteSpace:"pre-wrap"}}>{cleanNumbering(dossier.key_questions)}</p>:<EmptyState text="Key questions will appear as you add evidence."/>}</Panel>
      <Panel title="Decision-Maker Summary" icon="⚖️">{dossier.decision_summary?<p style={{margin:0,fontSize:14,lineHeight:1.8,color:LIGHT,whiteSpace:"pre-wrap"}}>{dossier.decision_summary}</p>:<EmptyState text="Decision-Maker Summary will appear after you add evidence. This is the one-page view for a judge, ombudsman, or regulator."/>}</Panel>
    </div>
    {showDownload&&<DownloadModal dossier={dossier} onClose={()=>setShowDownload(false)}/>}
    <style>{`@keyframes pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}`}</style>
  </div>);
}

function PrivacyPage({onBack}){
  const sections=[
    {title:"Your privacy matters",body:"Get SAFE exists to support people harmed by financial exploitation. We treat your information with care, respect, and confidentiality."},
    {title:"Who we are",body:"Get SAFE is fiscally hosted by the Academy of Life Planning Limited (AoLP), the legal data controller. Your data is used only for Get SAFE purposes.",contact:true},
    {title:"What Goliathon collects",bullets:["Dossier content stored in Supabase to enable the shareable link, identified by a random ID with no link to your identity.","No account required. We do not collect your name or email unless you include it in uploaded documents.","Camera scan images are sent to AI for analysis only — not stored by Goliathon.","Basic website data may be collected by Vercel and Supabase for operations.","We do not use tracking cookies, advertising, or sell data."]},
    {title:"How your dossier is stored",body:"When you click Share Dossier, your dossier is saved to Supabase with a unique random ID. No personal identity is linked. Request deletion by emailing us with your share link."},
    {title:"Session files",body:"Save Session downloads a JSON file to your device only — not stored by Goliathon. Store it securely as it may contain sensitive information."},
    {title:"AI processing",body:"Your evidence is sent to Claude (Anthropic) via a secure server-side function. Anthropic's privacy policy applies to this processing."},
    {title:"Your rights",bullets:["See information held — email hello@get-safe.org.uk with your share link","Ask for corrections or deletion","Withdraw consent — request deletion at any time","Raise concerns with the ICO at ico.org.uk"]},
    {title:"Vulnerable adults",body:"We recognise many Goliathon users may be vulnerable. Your information is handled with care, dignity, and respect. You are not a case number. You are a person."},
    {title:"Changes to this policy",body:"We may update this policy from time to time. Last updated: June 2026."},
  ];
  return(<div style={{fontFamily:"'Open Sans', sans-serif",background:NAVY,minHeight:"100vh",width:"100%",color:LIGHT}}>
    <div style={{background:NAVY,borderBottom:`3px solid ${YELLOW}`,padding:"14px 20px"}}><div style={{maxWidth:760,margin:"0 auto",display:"flex",alignItems:"center",gap:14}}><img src="/getsafe-logo.png" alt="Get SAFE" style={{width:40,height:40,objectFit:"contain"}}/><div style={{flex:1}}><div style={{fontSize:9,letterSpacing:3,color:YELLOW,textTransform:"uppercase",fontFamily:"'Poppins', sans-serif"}}>Get SAFE · Goliathon</div><h1 style={{margin:0,fontFamily:"'Poppins', sans-serif",fontSize:19,fontWeight:800,color:WHITE}}>Privacy Policy</h1></div><Btn small variant="subtle" onClick={onBack}>← Back</Btn></div></div>
    <div style={{maxWidth:760,margin:"0 auto",padding:"28px 20px"}}>
      <div style={{background:PANEL,border:`1px solid ${BORDER}`,borderRadius:12,padding:"12px 18px",marginBottom:24,display:"flex",alignItems:"center",gap:12}}><span style={{fontSize:16}}>🔒</span><p style={{margin:0,fontSize:13,color:"#a0b4c8",lineHeight:1.6}}>This policy covers how Goliathon handles your information. Goliathon is a tool of <strong style={{color:WHITE}}>Get SAFE</strong>, fiscally hosted by the Academy of Life Planning Limited.</p></div>
      {sections.map((s,i)=>(<div key={i} style={{marginBottom:24}}><h2 style={{fontFamily:"'Poppins', sans-serif",fontSize:15,fontWeight:700,color:YELLOW,margin:"0 0 8px",borderBottom:`1px solid ${BORDER}`,paddingBottom:6}}>{s.title}</h2>{s.body&&<p style={{margin:0,fontSize:13,color:LIGHT,lineHeight:1.8}}>{s.body}</p>}{s.bullets&&<ul style={{margin:0,paddingLeft:18}}>{s.bullets.map((b,j)=><li key={j} style={{fontSize:13,color:LIGHT,lineHeight:1.8,marginBottom:3}}>{b}</li>)}</ul>}{s.contact&&<div style={{marginTop:10,background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:8,padding:"10px 14px"}}><p style={{margin:"0 0 3px",fontSize:12,color:"#a0b4c8"}}>📧 <a href="mailto:hello@get-safe.org.uk" style={{color:YELLOW}}>hello@get-safe.org.uk</a></p><p style={{margin:0,fontSize:12,color:"#7a96b0"}}>📍 9 Franklin Way, Spilsby, Lincolnshire, PE23 5GG</p></div>}</div>))}
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
  const [fileHashes,setFileHashes]=useState(()=>{try{return JSON.parse(localStorage.getItem('goliathon_hashes_'+activeId)||'[]');}catch{return [];}});
  const [duplicateWarning,setDuplicateWarning]=useState(null);
  const [pasteTextContent,setPasteTextContent]=useState("");
  const [pasteTextDate,setPasteTextDate]=useState("");
  const [pasteTextTitle,setPasteTextTitle]=useState("");
  const [dragOver,setDragOver]=useState(false);
  const [showShare,setShowShare]=useState(false);
  const [showDownload,setShowDownload]=useState(false);
  const [showCamera,setShowCamera]=useState(false);
  const [cameraPages,setCameraPages]=useState([]);
  const [cameraProcessing,setCameraProcessing]=useState(false);
  const [editingEvidence,setEditingEvidence]=useState(null);
  const [editingTitle,setEditingTitle]=useState(false);
  const [titleDraft,setTitleDraft]=useState("");
  const [saved,setSaved]=useState(false);
  const isSavedRef=useRef(false);
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

  const updateDossier=useCallback(async(newDossier)=>{
    const updated=cases.map(c=>c.id===activeId?{...c,dossier:newDossier,title:newDossier.case_title||c.title}:c);
    updateCases(updated);setSaved(false);
    try{await saveDossierToDb({...newDossier,share_id:shareId},isSavedRef.current);isSavedRef.current=true;setSaved(true);}
    catch(e){console.error("Save error:",e);}
  },[cases,activeId,shareId,updateCases]);

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

  const handlePasteText=useCallback(async()=>{
    if(!pasteTextContent.trim())return;
    const datePrefix=pasteTextDate?pasteTextDate+"_":"";
    const titlePart=pasteTextTitle.trim()||"File Note";
    const filename=datePrefix+titlePart;
    setShowPasteText(false);setPasteTextContent("");setPasteTextDate("");setPasteTextTitle("");
    await processEvidence(pasteTextContent.trim(),filename,"text/plain");
  },[pasteTextContent,pasteTextDate,pasteTextTitle]);

  const processEvidence=useCallback(async(content,filename,mediaType,isUrl=false)=>{
    setProcessing(true);setProcessingMsg(`Reading ${filename}…`);
    try{
      const isImage=mediaType?.startsWith("image/");const isPdf=mediaType==="application/pdf";
      let userMessage;
      if(isImage){userMessage={role:"user",content:[{type:"image",source:{type:"base64",media_type:mediaType,data:content}},{type:"text",text:`Analyse this uploaded image as evidence. Filename: ${filename}`}]};}
      else if(isPdf){userMessage={role:"user",content:[{type:"document",source:{type:"base64",media_type:"application/pdf",data:content}},{type:"text",text:`Analyse this uploaded document as evidence. Filename: ${filename}`}]};}
      else{userMessage={role:"user",content:`Analyse this evidence. ${isUrl?"Source URL: "+filename:"Filename: "+filename}\n\nContent:\n${content}`};}
      const nextStepsText=typeof dossier?.next_steps==="string"?dossier.next_steps:Array.isArray(dossier?.next_steps)?dossier.next_steps.join("\n"):"";
      const existing=dossier?`\n\nExisting case:\nTitle: ${dossier.case_title||"Unknown"}\nOverview: ${(dossier.overview||"").substring(0,600)}\nTimeline: ${(dossier.timeline||[]).map(t=>`[${t.date}] ${t.event}`).join("; ").substring(0,400)}\nStatement: ${(dossier.witness_statement||"").substring(0,400)}\nEvidence filed (${(dossier.evidence||[]).length}): ${(dossier.evidence||[]).map(e=>e.title).join(", ")}\nNext steps: ${nextStepsText.substring(0,200)}`:"\n\nThis is the FIRST piece of evidence — establish the case title, parties, and initial overview.";
      setProcessingMsg("Analysing evidence…");
      const prompt=`${existing}\n\nAnalyse this evidence and return ONLY valid JSON with no preamble or markdown:\n{"case_title":"short case title","evidence_item":{"title":"descriptive title","date":"DD Mon YYYY or null","type":"Letter/Email/Statement/Report/Photo/Web Page/Other","summary":"2-3 sentence factual summary of what this document shows","facts_observed":"one sentence listing only what is directly stated or shown in the document — no interpretation","significance":"one sentence explaining why this matters to the case — clearly interpretive"},"timeline_entry":{"date":"DD Mon YYYY or null","event":"one sentence","evidence":"reference to this document"},"overview_update":"updated 3-4 sentence case overview","witness_update":"one or two new sentences in first person only","next_steps_update":"updated numbered list of 3-5 priority actions","key_questions_update":"updated list of 3-5 plain-language questions this case still needs to answer, from the survivor's point of view","decision_summary_update":"updated one-page decision-maker summary with: (1) What this case is about — 2 sentences; (2) The core dispute — bullet list of 3-5 unanswered questions Barclays/the institution cannot yet answer; (3) Strongest evidence — the 2-3 most significant items filed so far; (4) What happens next — the single most important action. Written in plain English for a judge, ombudsman, or regulator reading this for the first time."}`;
      const response=await callClaude([{...userMessage,content:typeof userMessage.content==="string"?userMessage.content+prompt:[...(Array.isArray(userMessage.content)?userMessage.content:[userMessage.content]),{type:"text",text:prompt}]}]);
      let parsed;try{parsed=JSON.parse(response.replace(/```json|```/g,"").trim());}catch{throw new Error("Could not parse AI response");}
      setProcessingMsg("Updating dossier…");
      const current=dossier||{evidence:[],timeline:[],witness_statement:"",overview:"",next_steps:""};
      const newEvidence=[...(current.evidence||[]),parsed.evidence_item];
      const newTimeline=[...(current.timeline||[])];
      if(parsed.timeline_entry?.event){newTimeline.push(parsed.timeline_entry);newTimeline.sort((a,b)=>{if(!a.date)return 1;if(!b.date)return-1;return new Date(a.date)-new Date(b.date);});}
      const newWitness=current.witness_statement?current.witness_statement+"\n\n"+(parsed.witness_update||""):parsed.witness_update||"";
      const rawNextSteps=typeof parsed.next_steps_update==="string"?parsed.next_steps_update:Array.isArray(parsed.next_steps_update)?parsed.next_steps_update.map((s,i)=>`${i+1}. ${s}`).join("\n"):(typeof current.next_steps==="string"?current.next_steps:"");
      const newNextSteps=cleanNumbering(rawNextSteps);
      const rawKeyQ=typeof parsed.key_questions_update==="string"?parsed.key_questions_update:Array.isArray(parsed.key_questions_update)?parsed.key_questions_update.map((s,i)=>`${i+1}. ${s}`).join("\n"):(typeof current.key_questions==="string"?current.key_questions:"");
      const newKeyQuestions=cleanNumbering(rawKeyQ);
      const newDossier={...current,case_title:parsed.case_title||current.case_title,overview:parsed.overview_update||current.overview,timeline:newTimeline,witness_statement:newWitness,next_steps:newNextSteps,key_questions:newKeyQuestions,evidence:newEvidence,decision_summary:parsed.decision_summary_update||current.decision_summary};
      await updateDossier(newDossier);
    }catch(e){alert("Something went wrong processing this file. Please try again.\n\n"+e.message);}
    setProcessing(false);setProcessingMsg("");
  },[dossier,updateDossier]);

  const handleFile=useCallback(async(file)=>{
    if(!file)return;const ext=file.name.split(".").pop().toLowerCase();
    const needsConversion=["html","htm","doc","docx","msg"].includes(ext);
    const allowed=["jpg","jpeg","png","gif","webp","pdf","txt","html","htm","doc","docx","msg"];
    if(!allowed.includes(ext)){alert("Unsupported file type. Goliathon accepts: JPG, PNG, PDF, TXT, HTML, DOC, DOCX, MSG.");return;}
    if(needsConversion){
      setProcessing(true);setProcessingMsg(`Converting ${file.name}…`);
      try{const base64=await fileToBase64(file);const res=await fetch("/api/convert",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:file.name,mediaType:file.type,data:base64})});const data=await res.json();if(data.error)throw new Error(data.error);await processEvidence(data.text,file.name,"text/plain");}
      catch(e){alert("Could not convert this file: "+e.message);setProcessing(false);setProcessingMsg("");}
      return;
    }
    const base64=await fileToBase64(file);await processEvidence(base64,file.name,file.type);
  },[processEvidence]);

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
      const existing=dossier?`\n\nExisting case:\nTitle: ${dossier.case_title}\nOverview: ${(dossier.overview||"").substring(0,400)}\nEvidence filed: ${(dossier.evidence||[]).length} items`:"\n\nThis is the FIRST piece of evidence.";
      const prompt=`${existing}\n\nAnalyse this photographed document (${cameraPages.length} pages) and return ONLY valid JSON:\n{"case_title":"short title","evidence_item":{"title":"title","date":"DD Mon YYYY or null","type":"Letter/Court Document/Medical/Financial/Other","summary":"2-3 sentence factual summary of what this document shows","facts_observed":"one sentence listing only what is directly stated or shown in the document — no interpretation","significance":"one sentence explaining why this matters to the case — clearly interpretive"},"timeline_entry":{"date":"DD Mon YYYY or null","event":"one sentence","evidence":"reference"},"overview_update":"updated overview","witness_update":"new sentences only","next_steps_update":"numbered 3-5 actions","key_questions_update":"updated list of 3-5 plain-language questions this case still needs to answer","decision_summary_update":"updated one-page decision-maker summary with the same structure as above"}`;
      const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:4000,system:SYSTEM,messages:[{role:"user",content:[...imageContent,{type:"text",text:prompt}]}]})});
      const data=await res.json();const response=data.content?.[0]?.text||"";
      let parsed;try{parsed=JSON.parse(response.replace(/```json|```/g,"").trim());}catch{throw new Error("Could not parse AI response");}
      const current=dossier||{evidence:[],timeline:[],witness_statement:"",overview:"",next_steps:""};
      const newEvidence=[...(current.evidence||[]),parsed.evidence_item];
      const newTimeline=[...(current.timeline||[])];
      if(parsed.timeline_entry?.event){newTimeline.push(parsed.timeline_entry);newTimeline.sort((a,b)=>{if(!a.date)return 1;if(!b.date)return-1;return new Date(a.date)-new Date(b.date);});}
      const newWitness=current.witness_statement?current.witness_statement+"\n\n"+(parsed.witness_update||""):parsed.witness_update||"";
      const newNextSteps=cleanNumbering(typeof parsed.next_steps_update==="string"?parsed.next_steps_update:Array.isArray(parsed.next_steps_update)?parsed.next_steps_update.map((s,i)=>`${i+1}. ${s}`).join("\n"):(typeof current.next_steps==="string"?current.next_steps:""));
      await updateDossier({...current,case_title:parsed.case_title||current.case_title,overview:parsed.overview_update||current.overview,timeline:newTimeline,witness_statement:newWitness,next_steps:newNextSteps,evidence:newEvidence});
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
          <Btn small variant="subtle" onClick={handleSaveLocal}>💾 Save</Btn>
          <label style={{cursor:"pointer"}}><Btn small variant="subtle" onClick={()=>restoreRef.current?.click()}>📂 Restore</Btn><input ref={restoreRef} type="file" accept=".json" style={{display:"none"}} onChange={handleRestoreLocal}/></label>
          {dossier&&<Btn small variant="subtle" onClick={handleReset}>↺ Reset</Btn>}
          {dossier&&<Btn small danger onClick={handleDeleteDossier}>🗑 Delete</Btn>}
          {dossier&&<Btn small variant="ghost" onClick={()=>setShowShare(true)}>🔗 Share</Btn>}
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

      <div onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={e=>{e.preventDefault();setDragOver(false);handleFile(e.dataTransfer.files[0]);}} onClick={()=>!processing&&fileRef.current?.click()}
        style={{border:`2px dashed ${dragOver?YELLOW:processing?YELLOW+"60":BORDER}`,borderRadius:16,padding:"22px 14px",textAlign:"center",cursor:processing?"not-allowed":"pointer",background:dragOver?"#001e3d":processing?"#001830":"transparent",transition:"all 0.2s",marginBottom:18}}>
        {processing?(
          <div><div style={{marginBottom:10}}><Spinner/></div><p style={{margin:0,fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:15,color:YELLOW}}>{processingMsg}</p><p style={{margin:"6px 0 0",fontSize:13,color:"#7a96b0"}}>Goliathon is building your dossier…</p></div>
        ):(
          <div>
            <div style={{fontSize:38,marginBottom:10}}>{evidenceCount===0?"⚖️":"➕"}</div>
            <p style={{margin:"0 0 6px",fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:15,color:WHITE}}>{evidenceCount===0?"Upload your first piece of evidence to begin":"Upload your next piece of evidence"}</p>
            <p style={{margin:"0 0 14px",fontSize:13,color:"#7a96b0"}}>{evidenceCount===0?"Goliathon will build your case automatically":`${evidenceCount} item${evidenceCount!==1?"s":""} filed — keep adding to build your case`}</p>
            <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
              <Btn small>📎 Upload File</Btn>
              <Btn small variant="subtle" onClick={e=>{e.stopPropagation();setShowCamera(true);setCameraPages([]);}}>📷 Camera Scan</Btn>
              <Btn small variant="subtle" onClick={e=>{e.stopPropagation();setShowUrl(true);}}>🔗 Add URL</Btn>
              <Btn small variant="subtle" onClick={e=>{e.stopPropagation();setShowPasteText(true);}}>📝 Paste Text</Btn>
            </div>
            <p style={{margin:"10px 0 0",fontSize:11,color:"#5a7a96"}}>Accepts JPG, PNG, PDF, TXT, HTML, DOC, DOCX, MSG — or drag and drop a file here</p>
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*,.pdf,.txt,.html,.htm,.doc,.docx,.msg" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple style={{display:"none"}} onChange={handleCameraCapture}/>

      {showPasteText&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,20,40,0.85)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowPasteText(false)}>
          <div style={{background:"#0d2137",border:"1px solid #1e3a5f",borderRadius:16,padding:24,width:"100%",maxWidth:560}} onClick={e=>e.stopPropagation()}>
            <h3 style={{margin:"0 0 16px",color:"#ffc72c",fontFamily:"'Poppins',sans-serif",fontSize:16}}>📝 Paste Text Entry</h3>
            <p style={{margin:"0 0 14px",fontSize:12,color:"#7a96b0",lineHeight:1.6}}>Paste a file note, letter, email, or any written record. Give it a date and title so it appears correctly in your evidence register.</p>
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
            <textarea value={pasteTextContent} onChange={e=>setPasteTextContent(e.target.value)} placeholder="Paste or type your text here…" rows={10} style={{width:"100%",boxSizing:"border-box",background:"#0a1929",border:"1px solid #1e3a5f",borderRadius:8,padding:"10px",color:"#c8dae6",fontSize:13,lineHeight:1.7,resize:"vertical",fontFamily:"inherit",marginBottom:14}}/>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <Btn small variant="subtle" onClick={()=>setShowPasteText(false)}>Cancel</Btn>
              <Btn small onClick={handlePasteText} disabled={!pasteTextContent.trim()}>Analyse Entry</Btn>
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

      {dossier&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(300px, 1fr))",gap:16}}>
          <div>
            <Panel title="Case Overview" icon="📋" action={<Btn small variant="ghost" onClick={()=>downloadPdf("overview",dossier)}>↓</Btn>}>{dossier.overview?<p style={{margin:0,fontSize:13,lineHeight:1.8,color:LIGHT}}>{dossier.overview}</p>:<EmptyState text="Building overview…"/>}</Panel>
            <Panel title="Witness Statement" icon="📝" action={<Btn small variant="ghost" onClick={()=>downloadPdf("statement",dossier)}>↓</Btn>}>{dossier.witness_statement?<p style={{margin:0,fontSize:13,lineHeight:1.9,color:LIGHT,whiteSpace:"pre-wrap"}}>{dossier.witness_statement}</p>:<EmptyState text="Building statement…"/>}</Panel>
            <Panel title="Next Steps" icon="📌" action={<Btn small variant="ghost" onClick={()=>downloadPdf("nextsteps",dossier)}>↓</Btn>}>{dossier.next_steps?<p style={{margin:0,fontSize:13,lineHeight:1.8,color:LIGHT,whiteSpace:"pre-wrap"}}>{dossier.next_steps}</p>:<EmptyState text="Next steps will appear here…"/>}</Panel>
            <Panel title="Key Questions in This Case" icon="❓" action={<Btn small variant="ghost" onClick={()=>downloadPdf("keyquestions",dossier)}>↓</Btn>}>{dossier.key_questions?<p style={{margin:0,fontSize:13,lineHeight:1.8,color:LIGHT,whiteSpace:"pre-wrap"}}>{cleanNumbering(dossier.key_questions)}</p>:<EmptyState text="Key questions will appear as you add evidence."/>}</Panel>
            <Panel title="Decision-Maker Summary" icon="⚖️" action={<Btn small variant="ghost" onClick={()=>downloadPdf("decisionsummary",dossier)}>↓</Btn>}>{dossier.decision_summary?<p style={{margin:0,fontSize:13,lineHeight:1.8,color:LIGHT,whiteSpace:"pre-wrap"}}>{dossier.decision_summary}</p>:<EmptyState text="Decision-Maker Summary will appear after you add evidence. This is the one-page view for a judge, ombudsman, or regulator."/>}</Panel>
          </div>
          <div>
            <Panel title="Timeline" icon="📅" action={<Btn small variant="ghost" onClick={()=>downloadPdf("timeline",dossier)}>↓</Btn>}>
              {!(dossier.timeline||[]).length?<EmptyState text="Timeline building…"/>:(dossier.timeline||[]).map((t,i)=>(<div key={i} style={{display:"flex",gap:10,marginBottom:11,paddingBottom:11,borderBottom:i<dossier.timeline.length-1?`1px solid ${BORDER}`:"none"}}><div style={{width:24,height:24,background:YELLOW,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:10,color:NAVY,flexShrink:0}}>{i+1}</div><div><div style={{fontSize:11,color:YELLOW,fontWeight:600,marginBottom:2}}>{t.date||"Date unknown"}</div><div style={{fontSize:13,color:LIGHT,lineHeight:1.6}}>{t.event}</div></div></div>))}
            </Panel>
            <Panel title={`Evidence Library — ${evidenceCount} item${evidenceCount!==1?"s":""}`} icon="🗂️" action={<Btn small variant="ghost" onClick={()=>downloadPdf("evidence",dossier)}>↓</Btn>}>
              {!evidenceCount?<EmptyState text="No evidence uploaded yet."/>:[...(dossier.evidence||[])].reverse().map((e,i)=>{
                const ri=evidenceCount-1-i;
                return(<div key={i} style={{background:"#001e3d",border:`1px solid ${BORDER}`,borderRadius:10,padding:"10px 12px",marginBottom:8}}>
                  <div style={{display:"flex",alignItems:"flex-start",gap:7,marginBottom:5}}>
                    <span style={{fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:11,color:YELLOW,flexShrink:0}}>#{String(ri+1).padStart(3,"0")}</span>
                    <span style={{fontFamily:"'Poppins', sans-serif",fontWeight:700,fontSize:13,color:WHITE,flex:1}}>{e.title}</span>
                    <div style={{display:"flex",gap:3,flexShrink:0}}>
                      <button onClick={()=>handleMoveEvidence(ri,-1)} disabled={ri===0} style={{background:"none",border:`1px solid ${BORDER}`,borderRadius:4,padding:"2px 5px",color:"#7a96b0",fontSize:10,cursor:ri===0?"not-allowed":"pointer",opacity:ri===0?0.3:1}}>↑</button>
                      <button onClick={()=>handleMoveEvidence(ri,1)} disabled={ri===evidenceCount-1} style={{background:"none",border:`1px solid ${BORDER}`,borderRadius:4,padding:"2px 5px",color:"#7a96b0",fontSize:10,cursor:ri===evidenceCount-1?"not-allowed":"pointer",opacity:ri===evidenceCount-1?0.3:1}}>↓</button>
                      <button onClick={()=>setEditingEvidence(ri)} style={{background:"none",border:`1px solid ${BORDER}`,borderRadius:4,padding:"2px 7px",color:YELLOW,fontSize:10,cursor:"pointer"}}>✏</button>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:5}}>{e.date&&<Tag>{e.date}</Tag>}{e.type&&<Tag color="#7a96b0">{e.type}</Tag>}</div>
                  <p style={{margin:"0 0 4px",fontSize:12,color:LIGHT,lineHeight:1.6}}>{e.summary}</p>
                  {e.facts_observed&&<p style={{margin:"0 0 3px",fontSize:11,color:"#7a96b0"}}><span style={{fontWeight:600,textTransform:"uppercase",fontSize:10,letterSpacing:"0.05em"}}>What this shows: </span>{e.facts_observed}</p>}{e.significance&&<p style={{margin:0,fontSize:11,color:YELLOW}}><span style={{fontWeight:600,textTransform:"uppercase",fontSize:10,letterSpacing:"0.05em"}}>Why it matters: </span>{e.significance}</p>}
                </div>);
              })}
            </Panel>
          </div>
        </div>
      )}
    </div>

    <div style={{borderTop:`1px solid ${BORDER}`,padding:"14px 20px",textAlign:"center",marginTop:20}}>
      <div style={{marginBottom:10}}>
        <button onClick={()=>setShowWelcome(true)} style={{background:"none",border:`1px solid ${BORDER}`,borderRadius:6,padding:"6px 16px",color:"#7a96b0",fontSize:12,cursor:"pointer",fontFamily:"'Poppins', sans-serif"}}>ℹ About Goliathon</button>
      </div>
      <p style={{margin:0,fontSize:11,color:"#5a7a96"}}>Goliathon · Get SAFE (Support After Financial Exploitation) · Founded by Steve Conley · Academy of Life Planning · <a href="https://www.get-safe.org.uk/" style={{color:"#7a96b0"}}>www.get-safe.org.uk</a> · <a href="/privacy" onClick={e=>{e.preventDefault();setShowPrivacy(true);window.history.pushState({},"","/privacy");}} style={{color:"#7a96b0"}}>Privacy Policy</a> · Educational use only. Not legal, financial, or mental-health advice.</p>
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

    <style>{`@keyframes pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}*{box-sizing:border-box}::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:#001e3d}::-webkit-scrollbar-thumb{background:${YELLOW}40;border-radius:3px}input::placeholder,textarea::placeholder{color:#5a7a96}`}</style>
  </div>);
}
