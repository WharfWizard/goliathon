// Patch script: fixes the "Save this case to start chatting with it" gap
// that appears after a page refresh even when the case was already saved.
//
// Root cause: `saved` is React state, initialised to false on every load.
// It only flips to true as a side effect of adding evidence (via
// updateDossier -> saveDossierToDb -> setSaved(true)). A refresh loses that
// in-memory state even though the case is still sitting in the database.
//
// Fix: on mount, check whether this case's share_id already exists in the
// dossiers table (loadDossierFromDb, already defined in this file). If it
// does, set both `saved` and `isSavedRef.current` to true — the latter
// matters because it controls whether the next save uses POST (create) or
// PUT (update); without it, a case that already exists in the DB would
// incorrectly attempt a duplicate POST on the next edit.
//
// Run from the project root:
//   node patch-fix-saved-state.cjs

const fs = require('fs');
const path = require('path');

const filePath = path.join('src', 'App.jsx');

if (!fs.existsSync(filePath)) {
  console.error(`Could not find ${filePath}. Run this from the project root.`);
  process.exit(1);
}

let content = fs.readFileSync(filePath, 'utf8');

if (content.includes('// Check DB for existing save on mount')) {
  console.log('Already patched. No changes made.');
  process.exit(0);
}

const anchorOld = 'const isSavedRef=useRef(false);';

const matches = content.split(anchorOld).length - 1;
if (matches !== 1) {
  console.error(`Expected exactly 1 match for the anchor line, found ${matches}. Aborting — no changes made.`);
  process.exit(1);
}

const anchorNew = `const isSavedRef=useRef(false);

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
  },[shareId]);`;

content = content.replace(anchorOld, anchorNew);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Patched src/App.jsx: added on-mount check for an existing saved case.');
