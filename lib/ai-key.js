// Shared helpers for choosing which Anthropic key pays for a request.
//
// - If the member has supplied their own key (header x-goliathon-user-key),
//   that key is used for this one request only. It is never stored, and it
//   must never be logged.
// - Otherwise Goliathon's shared key (Vercel: ANTHROPIC_API_KEY) is used,
//   which draws on the monthly shared allowance.

export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : ['https://goliathon.app', 'https://www.goliathon.app']);

export function originAllowed(req) {
  const origin = req.headers.origin;
  return !!origin && ALLOWED_ORIGINS.includes(origin);
}

const KEY_PATTERN = /^sk-ant-[A-Za-z0-9_\-]{20,300}$/;

// Returns { key, ownKey } or { error: { code, message, status } }.
export function resolveKey(req) {
  const raw = req.headers['x-goliathon-user-key'];
  const own = typeof raw === 'string' ? raw.trim() : '';

  if (own) {
    if (!KEY_PATTERN.test(own)) {
      return { error: {
        status: 400,
        code: 'own_key_malformed',
        message: "That doesn't look like a complete Anthropic key. It should start with sk-ant- . Please copy it again from your Anthropic Console.",
      } };
    }
    return { key: own, ownKey: true };
  }

  const shared = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY;
  if (!shared) {
    return { error: { status: 500, code: 'server_not_configured', message: 'Server not configured' } };
  }
  return { key: shared, ownKey: false };
}

// Turns an Anthropic error into a plain-English message and a code the app
// can act on (for example, opening the "use your own key" panel).
//
// Anthropic's docs say a spend limit you set returns HTTP 400
// (invalid_request_error), and billing problems return 402. The exact
// wording of the spend-limit message is matched loosely below; check the
// GOLIATHON_AI_ERROR log line the first time it happens and tighten if needed.
export function describeAnthropicError(status, bodyText, ownKey) {
  let type = '';
  let msg = '';
  try {
    const j = JSON.parse(bodyText);
    type = j?.error?.type || '';
    msg = j?.error?.message || '';
  } catch (_) { msg = String(bodyText || '').slice(0, 300); }

  // Log the error type and Anthropic's message only. Never the key.
  try {
    console.log('GOLIATHON_AI_ERROR ' + JSON.stringify({ status, type, own_key: ownKey, message: msg.slice(0, 300) }));
  } catch (_) {}

  const looksLikeSpendLimit = /spend limit|usage limit|credit balance|billing/i.test(msg);

  if (ownKey) {
    if (status === 401) return { code: 'own_key_invalid', message: "Anthropic didn't accept your key. It may have been deleted, or copied incompletely. Please check it in your Anthropic Console and paste it again." };
    if (status === 402 || (status === 400 && looksLikeSpendLimit)) return { code: 'own_key_billing', message: 'Your Anthropic account has run out of credit or reached the spend limit you set. Add credit or raise your limit in your Anthropic Console, then try again.' };
    if (status === 403) return { code: 'own_key_permission', message: "Your key doesn't have permission to use this model. Please create a new key in your Anthropic Console and try again." };
  } else {
    if (status === 402 || (status === 400 && looksLikeSpendLimit)) {
      return { code: 'shared_allowance_exhausted', message: "Goliathon's shared AI allowance for this month has been used up. You can carry on straight away with your own Anthropic key, or wait until the allowance refreshes on the 1st of next month." };
    }
  }

  if (status === 429 || status === 529) {
    return { code: 'busy', message: 'The AI service is busy right now. Please wait a minute and try again.' };
  }
  return { code: null, message: msg || ('AI error ' + status) };
}
