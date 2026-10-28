// /api/claude - server-side relay to Anthropic for Goliathon.
//
// - Only requests from Goliathon's own web address are accepted.
// - The model and token ceiling are set HERE, not by the browser.
// - Only the fields Goliathon needs (system, messages) are passed on.
// - Uses the member's own Anthropic key if they have added one,
//   otherwise the shared allowance (see lib/ai-key.js).
// - Each call logs token counts only (no content, no personal data, no key).

import { originAllowed, resolveKey, describeAnthropicError } from '../lib/ai-key.js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 8000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  if (!originAllowed(req)) {
    return res.status(403).json({ error: 'Not allowed', content: [{ type: 'text', text: 'Error: 403' }] });
  }

  const resolved = resolveKey(req);
  if (resolved.error) {
    const e = resolved.error;
    return res.status(e.status).json({ error: e.message, code: e.code, content: [{ type: 'text', text: 'Error: ' + e.status }] });
  }

  const { system, messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages required', content: [{ type: 'text', text: 'Error: 400' }] });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': resolved.key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // system may be plain text, or an array of blocks (needed if
        // prompt caching on the system prompt is ever switched on).
        ...((typeof system === 'string' || Array.isArray(system)) ? { system } : {}),
        messages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      const d = describeAnthropicError(response.status, errText, resolved.ownKey);
      return res.status(response.status).json({ error: d.message, code: d.code, content: [{ type: 'text', text: 'Error: ' + response.status }] });
    }

    const data = await response.json();
    logUsage('claude', data, messages, resolved.ownKey);
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message, content: [{ type: 'text', text: 'Error: ' + e.message }] });
  }
}

// Logs token counts only. Search Vercel logs for "GOLIATHON_USAGE".
function logUsage(route, data, messages, ownKey) {
  try {
    const u = data && data.usage ? data.usage : {};
    const asText = JSON.stringify(messages);
    console.log('GOLIATHON_USAGE ' + JSON.stringify({
      route,
      own_key: ownKey,
      model: data && data.model,
      input: u.input_tokens || 0,
      output: u.output_tokens || 0,
      cache_write: u.cache_creation_input_tokens || 0,
      cache_read: u.cache_read_input_tokens || 0,
      stop: data && data.stop_reason,
      has_document: asText.includes('"type":"document"'),
      has_image: asText.includes('"type":"image"'),
    }));
  } catch (_) { /* logging must never break a request */ }
}
