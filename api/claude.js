// /api/claude - server-side relay to Anthropic for Goliathon.
//
// Locked down (28 Oct 2026):
// - Only requests from Goliathon's own web address are accepted.
// - The model and token ceiling are set HERE, not by the browser.
// - Only the fields Goliathon needs (system, messages) are passed on.
// - Each call logs token counts only (no content, no personal data),
//   so cost per upload / chat message can be measured in Vercel logs.

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 8000;

// Add your exact live address(es) here, or set ALLOWED_ORIGINS in Vercel
// as a comma-separated list, e.g. "https://goliathon.app,https://www.goliathon.app"
const DEFAULT_ORIGINS = ['https://goliathon.app', 'https://www.goliathon.app'];
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : DEFAULT_ORIGINS);

const API_KEY = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // A browser on goliathon.app always sends its Origin. Requests from
  // anywhere else (another site, or a script with no Origin) are refused.
  // Note: this stops casual misuse, not a determined attacker. The
  // membership pass check (from 1 Nov) is the stronger protection.
  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Not allowed', content: [{ type: 'text', text: 'Error: 403' }] });
  }

  if (!API_KEY) {
    return res.status(500).json({ error: 'Server not configured', content: [{ type: 'text', text: 'Error: 500' }] });
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
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      // Model and ceiling fixed server-side; anything else the browser
      // sends (other models, tools, larger max_tokens) is ignored.
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
      return res.status(response.status).json({ error: errText, content: [{ type: 'text', text: 'Error: ' + response.status }] });
    }

    const data = await response.json();
    logUsage('claude', data, messages);
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message, content: [{ type: 'text', text: 'Error: ' + e.message }] });
  }
}

// Logs token counts only. Search Vercel logs for "GOLIATHON_USAGE".
function logUsage(route, data, messages) {
  try {
    const u = data && data.usage ? data.usage : {};
    const hasDocument = JSON.stringify(messages).includes('"type":"document"');
    const hasImage = JSON.stringify(messages).includes('"type":"image"');
    console.log('GOLIATHON_USAGE ' + JSON.stringify({
      route,
      model: data && data.model,
      input: u.input_tokens || 0,
      output: u.output_tokens || 0,
      cache_write: u.cache_creation_input_tokens || 0,
      cache_read: u.cache_read_input_tokens || 0,
      stop: data && data.stop_reason,
      has_document: hasDocument,
      has_image: hasImage,
    }));
  } catch (_) { /* logging must never break a request */ }
}
