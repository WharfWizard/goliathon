// Patch script: replaces every reference to the old get-safe.org.uk domain
// and hello@get-safe.org.uk email with the new Academy of Life Planning URL
// and email, across src/App.jsx.
//
// Confirmed via findstr search on 8 Aug 2026: all 5 occurrences live in
// src/App.jsx. index.html and public/privacy.html do not reference the old
// domain (privacy is handled inline in React state, not a separate file).
//
// Run from the project root:
//   node patch-update-domain.cjs

const fs = require('fs');
const path = require('path');

const filePath = path.join('src', 'App.jsx');
const OLD_EMAIL = 'hello@get-safe.org.uk';
const NEW_EMAIL = 'steve@academyoflifeplanning.com';
const OLD_HREF = 'href="https://www.get-safe.org.uk/"';
const NEW_HREF = 'href="https://www.academyoflifeplanning.com/individuals/get-safe"';
const OLD_DOMAIN_TEXT = 'www.get-safe.org.uk';
const NEW_DOMAIN_TEXT = 'academyoflifeplanning.com/individuals/get-safe';

if (!fs.existsSync(filePath)) {
  console.error(`Could not find ${filePath}. Run this from the project root.`);
  process.exit(1);
}

let content = fs.readFileSync(filePath, 'utf8');

function countOccurrences(str, sub) {
  return str.split(sub).length - 1;
}

function replaceAndVerify(str, oldStr, newStr, expectedCount, label) {
  const actualCount = countOccurrences(str, oldStr);
  if (actualCount !== expectedCount) {
    console.error(`Expected ${expectedCount} occurrence(s) of ${label}, found ${actualCount}. Aborting — no changes made.`);
    console.error(`Looking for: ${oldStr}`);
    process.exit(1);
  }
  return str.split(oldStr).join(newStr);
}

// Step 1: the footer link's href (contains the domain as a substring, so
// this must run before the generic domain-text replace below).
content = replaceAndVerify(content, OLD_HREF, NEW_HREF, 1, 'the footer link href');

// Step 2: the email address, everywhere it appears (privacy modal bullet +
// mailto link + displayed link text).
content = replaceAndVerify(content, OLD_EMAIL, NEW_EMAIL, 3, 'the old email address');

// Step 3: remaining plain-text domain mentions (the dossier export text
// footer, and the footer link's visible text) — should be exactly 2 left
// now that the href itself was already handled in step 1.
content = replaceAndVerify(content, OLD_DOMAIN_TEXT, NEW_DOMAIN_TEXT, 2, 'the remaining domain text');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Patched src/App.jsx successfully:');
console.log('  1. Updated footer link href to the new Academy of Life Planning URL');
console.log('  2. Replaced all 3 instances of hello@get-safe.org.uk with steve@academyoflifeplanning.com');
console.log('  3. Replaced remaining 2 domain-text mentions with the new URL');
