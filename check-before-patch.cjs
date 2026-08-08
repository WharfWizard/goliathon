// Diagnostic script — run this FIRST, before adding case-chat.js.
// It checks two things that determine whether case-chat.js needs edits
// before it'll work in this codebase:
//
// 1. Does api/claude.js use @anthropic-ai/sdk, or a raw fetch() call?
//    case-chat.js as written uses the SDK's streaming helper
//    (anthropic.messages.stream). If claude.js uses raw fetch instead,
//    either add the SDK dependency (recommended, simplest) or rewrite
//    case-chat.js's streaming section to use fetch with stream: true
//    against the /v1/messages endpoint directly.
//
// 2. Is @anthropic-ai/sdk already in package.json?
//    If not, `npm install @anthropic-ai/sdk` before deploying.

const fs = require('fs');
const path = require('path');

function checkFile(label, filePath, checks) {
  console.log(`\n--- ${label} (${filePath}) ---`);
  if (!fs.existsSync(filePath)) {
    console.log('  NOT FOUND');
    return;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  for (const [desc, pattern] of checks) {
    const found = pattern.test(content);
    console.log(`  ${found ? '✓' : '✗'} ${desc}`);
  }
}

checkFile('api/claude.js', path.join('api', 'claude.js'), [
  ["imports '@anthropic-ai/sdk'", /@anthropic-ai\/sdk/],
  ['uses raw fetch() to api.anthropic.com', /fetch\(\s*['"`]https:\/\/api\.anthropic\.com/],
]);

checkFile('package.json', 'package.json', [
  ["lists '@anthropic-ai/sdk' as a dependency", /"@anthropic-ai\/sdk"/],
]);

console.log('\nIf api/claude.js uses raw fetch() and NOT the SDK, either:');
console.log('  (a) run: npm install @anthropic-ai/sdk   — then case-chat.js works as-is, or');
console.log('  (b) tell me, and I will rewrite case-chat.js\'s streaming section to match');
console.log('      your existing fetch()-based pattern instead of the SDK.\n');
