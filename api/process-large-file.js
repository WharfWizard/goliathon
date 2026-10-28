import { createClient } from '@supabase/supabase-js';
import { originAllowed, resolveKey, describeAnthropicError } from '../lib/ai-key.js';

// Processes a large evidence file (PDF or similar) that's too big to send
// directly through /api/claude's request body. The browser has already
// uploaded the raw file to Supabase Storage (bucket: evidence-uploads);
// this endpoint receives only the small storage path, fetches the actual
// file server-side (no size restriction on that step), base64-encodes it,
// and sends it on to Anthropic directly - the file itself never crosses
// back into a browser-to-Vercel request, so the 4.5MB body cap that
// affects /api/claude never comes into play here.
//
// Reuses the exact same content-block shape as the existing PDF path in
// App.jsx's processEvidence (confirmed 8 Aug 2026):
//   {type:"document", source:{type:"base64", media_type:"application/pdf", data:...}}
// The prompt text itself is built client-side exactly as before (existing
// case-context logic is unchanged) and passed in as `promptText`, so this
// endpoint's only job is the large-file handling - not prompt construction.
// Locked down (28 Oct 2026): origin check, member's own key or shared
// allowance (lib/ai-key.js), token-only usage logging ("GOLIATHON_USAGE").

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!originAllowed(req)) {
    return res.status(403).json({ error: 'Not allowed' });
  }

  const resolved = resolveKey(req);
  if (resolved.error) {
    return res.status(resolved.error.status).json({ error: resolved.error.message, code: resolved.error.code });
  }

  const { storagePath, mediaType, promptText } = req.body || {};
  if (!storagePath || !mediaType || !promptText) {
    return res.status(400).json({ error: 'storagePath, mediaType, and promptText are required' });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !resolved.key) {
    return res.status(500).json({ error: 'Missing required environment variables' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

  // Fetch the file from Storage server-side - no size restriction here,
  // unlike an incoming Vercel function request body.
  const { data: fileBlob, error: downloadError } = await supabase
    .storage
    .from('evidence-uploads')
    .download(storagePath);

  if (downloadError || !fileBlob) {
    return res.status(404).json({ error: downloadError?.message || 'File not found in storage' });
  }

  const arrayBuffer = await fileBlob.arrayBuffer();
  const base64Data = Buffer.from(arrayBuffer).toString('base64');

  const SYSTEM = `You are the Goliathon AI created by Steve Conley, Founder of Get SAFE (Support After Financial Exploitation) and the Academy of Life Planning. Goliathon builds a professional evidence dossier for anyone in a dispute with an institution. Core values: dignity, precision, clarity, empowerment. Never give legal, financial, or mental-health advice. Write in plain English. Be warm, calm, and strategic.`;

  let anthropicResponse;
  try {
    anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': resolved.key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: mediaType, data: base64Data } },
              { type: 'text', text: promptText },
            ],
          },
        ],
      }),
    });
  } catch (e) {
    return res.status(502).json({ error: 'Failed to reach Anthropic API' });
  }

  if (!anthropicResponse.ok) {
    const errText = await anthropicResponse.text().catch(() => 'Unknown error');
    const d = describeAnthropicError(anthropicResponse.status, errText, resolved.ownKey);
    return res.status(anthropicResponse.status).json({ error: d.message, code: d.code });
  }

  const data = await anthropicResponse.json();
  try {
    const u = data.usage || {};
    console.log('GOLIATHON_USAGE ' + JSON.stringify({
      route: 'process-large-file',
      own_key: resolved.ownKey,
      model: data.model,
      file_kb: Math.round(arrayBuffer.byteLength / 1024),
      input: u.input_tokens || 0,
      output: u.output_tokens || 0,
      cache_write: u.cache_creation_input_tokens || 0,
      cache_read: u.cache_read_input_tokens || 0,
      stop: data.stop_reason,
    }));
  } catch (_) { /* logging must never break a request */ }
  if (data.stop_reason === 'max_tokens') {
    return res.status(502).json({ error: 'The AI response was too long and was cut off before it finished, so nothing was added. Please try again. If it keeps happening, upload a shorter document.' });
  }
  const responseText = data.content?.[0]?.text || '';

  // Return the same shape processEvidence already expects from /api/claude,
  // so the existing client-side parsing (JSON.parse after cleaning
  // markdown fences) works completely unchanged.
  return res.status(200).json({ content: [{ text: responseText }] });
}
