// /api/check-key - confirms a member's own Anthropic key works, before they
// rely on it. Asks Anthropic for its list of models, which runs no AI
// processing. The key is used for this one request and never stored or logged.

import { originAllowed, resolveKey, describeAnthropicError } from '../lib/ai-key.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!originAllowed(req)) return res.status(403).json({ error: 'Not allowed' });

  const resolved = resolveKey(req);
  if (resolved.error) return res.status(resolved.error.status).json({ ok: false, code: resolved.error.code, error: resolved.error.message });
  if (!resolved.ownKey) return res.status(400).json({ ok: false, code: 'no_key', error: 'Please paste your key first.' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      method: 'GET',
      headers: {
        'x-api-key': resolved.key,
        'anthropic-version': '2023-06-01',
      },
    });
    if (r.ok) return res.status(200).json({ ok: true });
    const text = await r.text().catch(() => '');
    const d = describeAnthropicError(r.status, text, true);
    return res.status(200).json({ ok: false, code: d.code, error: d.message });
  } catch (e) {
    return res.status(502).json({ ok: false, code: 'unreachable', error: "Couldn't reach Anthropic just now. Please try again in a moment." });
  }
}
