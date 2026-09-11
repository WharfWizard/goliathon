// Patch: adds a client-side file size guard to handleFile.
//
// Root cause confirmed 8 Aug 2026: PDFs and .txt files fall into the final
// `else` branch of handleFile with NO size check — they go straight to
// fileToBase64 and are sent to /api/claude uncompressed. Base64 encoding
// adds ~33% overhead on top of the raw file size, and Vercel serverless
// functions on this plan have a 4.5MB request body ceiling — so any PDF
// above roughly 2.5-3MB raw will silently fail with a 413 the user has no
// way to understand (the same class of bug hit earlier today with a
// separate scanned-PDF upload, and a likely contributor to a user's
// reported "black screen" crash after PDF upload trouble).
//
// Fix: check file.size up front for any non-image file, before any
// processing starts, and show a clear, actionable message.
//
// This version matches the target block regardless of whether the file on
// disk uses LF or CRLF line endings (Windows git checkouts can go either
// way depending on core.autocrlf and checkout history), then writes the
// result back using whichever line-ending style the file already had, so
// it doesn't introduce a whole-file line-ending diff as a side effect.
//
// Run from the project root:
//   node patch-file-size-guard.cjs

const fs = require('fs');
const path = require('path');

const filePath = path.join('src', 'App.jsx');

if (!fs.existsSync(filePath)) {
  console.error(`Could not find ${filePath}. Run this from the project root.`);
  process.exit(1);
}

const raw = fs.readFileSync(filePath, 'utf8');
const usesCRLF = raw.includes('\r\n');
const content = raw.replace(/\r\n/g, '\n'); // normalize to LF for matching

if (content.includes('MAX_DIRECT_UPLOAD_BYTES')) {
  console.log('Already patched. No changes made.');
  process.exit(0);
}

const oldBlock = `  const handleFile=useCallback(async(file)=>{
    if(!file)return;const ext=file.name.split(".").pop().toLowerCase();
    const needsConversion=["html","htm","doc","docx","msg"].includes(ext);
    const allowed=["jpg","jpeg","png","gif","webp","pdf","txt","html","htm","doc","docx","msg"];
    if(!allowed.includes(ext)){alert("Unsupported file type. Goliathon accepts: JPG, PNG, PDF, TXT, HTML, DOC, DOCX, MSG.");return;}
    if(needsConversion){
      setProcessing(true);setProcessingMsg(\`Converting \${file.name}…\`);
      try{const base64=await fileToBase64(file);const res=await fetch("/api/convert",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:file.name,mediaType:file.type,data:base64})});const data=await res.json();if(data.error)throw new Error(data.error);await processEvidence(data.text,file.name,"text/plain");}
      catch(e){alert("Could not convert this file: "+e.message);setProcessing(false);setProcessingMsg("");}
      return;
    }
    const isImg=['jpg','jpeg','png','gif','webp'].includes(ext);
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
  },[processEvidence]);`;

const newBlock = `  const handleFile=useCallback(async(file)=>{
    if(!file)return;const ext=file.name.split(".").pop().toLowerCase();
    const needsConversion=["html","htm","doc","docx","msg"].includes(ext);
    const allowed=["jpg","jpeg","png","gif","webp","pdf","txt","html","htm","doc","docx","msg"];
    if(!allowed.includes(ext)){alert("Unsupported file type. Goliathon accepts: JPG, PNG, PDF, TXT, HTML, DOC, DOCX, MSG.");return;}
    const isImg=['jpg','jpeg','png','gif','webp'].includes(ext);
    // Images are compressed/resized below before upload, so they rarely hit
    // the size limit. Everything else (PDF, TXT, and files awaiting
    // conversion) is sent close to its raw size, so check it up front.
    const MAX_DIRECT_UPLOAD_BYTES=2.5*1024*1024;
    if(!isImg&&file.size>MAX_DIRECT_UPLOAD_BYTES){
      alert(\`This file is \${(file.size/1024/1024).toFixed(1)}MB, which is too large for Goliathon to process directly (limit: 2.5MB). Try compressing the PDF, splitting it into smaller sections, or saving it as a plain text (.txt) file if possible.\`);
      return;
    }
    if(needsConversion){
      setProcessing(true);setProcessingMsg(\`Converting \${file.name}…\`);
      try{const base64=await fileToBase64(file);const res=await fetch("/api/convert",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:file.name,mediaType:file.type,data:base64})});const data=await res.json();if(data.error)throw new Error(data.error);await processEvidence(data.text,file.name,"text/plain");}
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
  },[processEvidence]);`;

const matches = content.split(oldBlock).length - 1;
if (matches !== 1) {
  console.error(`Expected exactly 1 match for the handleFile block, found ${matches}. Aborting — no changes made.`);
  console.error('If this keeps happening, the file may have changed since this patch was written — send the current handleFile block back for a fresh patch.');
  process.exit(1);
}

let patched = content.split(oldBlock).join(newBlock);
if (usesCRLF) patched = patched.replace(/\n/g, '\r\n'); // restore original line-ending style

fs.writeFileSync(filePath, patched, 'utf8');
console.log(`Patched src/App.jsx (line endings: ${usesCRLF ? 'CRLF' : 'LF'}): added a 2.5MB file size guard with a clear error message for oversized PDF/text uploads.`);
