// Patch script: adds the CaseChat import and inserts a "Chat With This Case"
// panel into src/App.jsx, right after the Evidence Library panel.
//
// Run from the project root:
//   node patch-add-chat.cjs
//
// Safe to run once. It checks both target strings exist and are unique
// before writing anything, and will refuse to run twice (it checks whether
// the import is already present).

const fs = require('fs');
const path = require('path');

const filePath = path.join('src', 'App.jsx');

if (!fs.existsSync(filePath)) {
  console.error(`Could not find ${filePath}. Run this from the project root (C:\\Users\\wharf\\Projects\\goliathon).`);
  process.exit(1);
}

let content = fs.readFileSync(filePath, 'utf8');

// --- Guard: already patched? ---
if (content.includes('import CaseChat from "./components/CaseChat"')) {
  console.log('Already patched — CaseChat import found. No changes made.');
  process.exit(0);
}

// --- Patch 1: add the import ---
const importOld = 'import { useState, useRef, useCallback, useEffect } from "react";';
const importNew = `import { useState, useRef, useCallback, useEffect } from "react";
import CaseChat from "./components/CaseChat";`;

const importMatches = content.split(importOld).length - 1;
if (importMatches !== 1) {
  console.error(`Expected exactly 1 match for the import line, found ${importMatches}. Aborting — no changes made.`);
  process.exit(1);
}
content = content.replace(importOld, importNew);

// --- Patch 2: insert the Chat panel after Evidence Library, before the
// right-hand column and two-column grid close. Gated on `saved` so it only
// renders once the case has actually been persisted to Supabase (case-chat.js
// looks the case up by share_id in the dossiers table, so an unsaved case
// would otherwise 404). ---
const panelOld = `                </div>);
              })}
            </Panel>
          </div>
        </div>
      )}
    </div>`;

const panelNew = `                </div>);
              })}
            </Panel>
            {saved&&<Panel title="Chat With This Case" icon="💬">
              <CaseChat caseId={shareId}/>
            </Panel>}
            {!saved&&dossier&&<Panel title="Chat With This Case" icon="💬">
              <p style={{margin:0,fontSize:12,color:"#7a96b0",lineHeight:1.7}}>Save this case to start chatting with it.</p>
            </Panel>}
          </div>
        </div>
      )}
    </div>`;

const panelMatches = content.split(panelOld).length - 1;
if (panelMatches !== 1) {
  console.error(`Expected exactly 1 match for the panel insertion point, found ${panelMatches}. Aborting — no changes made.`);
  console.error('This likely means App.jsx has changed since this patch was written. Send the current file back for a fresh patch.');
  process.exit(1);
}
content = content.replace(panelOld, panelNew);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Patched src/App.jsx successfully:');
console.log('  1. Added CaseChat import');
console.log('  2. Added "Chat With This Case" panel after Evidence Library (shown once the case is saved)');
