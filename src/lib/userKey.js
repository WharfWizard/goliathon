// Keeps a member's own Anthropic key in THIS browser only.
//
// - By default it lasts until the tab is closed (sessionStorage).
// - If the member ticks "Remember on this device", it is kept in
//   localStorage until they press "Forget my key".
// - It is sent to Goliathon's own server with each AI request (HTTPS),
//   used for that request only, and never stored or logged there.

const STORE_KEY = 'goliathon_own_anthropic_key';

function safe(fn, fallback) { try { return fn(); } catch (_) { return fallback; } }

export function getOwnKey() {
  return safe(() => sessionStorage.getItem(STORE_KEY), '') ||
         safe(() => localStorage.getItem(STORE_KEY), '') || '';
}

export function isRemembered() {
  return !!safe(() => localStorage.getItem(STORE_KEY), '');
}

export function setOwnKey(key, remember) {
  clearOwnKey(true);
  const k = String(key || '').trim();
  if (!k) return;
  safe(() => (remember ? localStorage : sessionStorage).setItem(STORE_KEY, k));
  window.dispatchEvent(new Event('goliathon:key-changed'));
}

export function clearOwnKey(silent) {
  safe(() => sessionStorage.removeItem(STORE_KEY));
  safe(() => localStorage.removeItem(STORE_KEY));
  if (!silent) window.dispatchEvent(new Event('goliathon:key-changed'));
}

// Adds the member's key (if any) to the headers of an AI request.
export function aiHeaders(extra) {
  const k = getOwnKey();
  return { ...(extra || {}), ...(k ? { 'x-goliathon-user-key': k } : {}) };
}

// Call with any JSON reply from an AI route. If the server says the shared
// allowance is used up (or the member's own key has a problem), this opens
// the "Use your own key" panel with the explanation.
const PANEL_CODES = new Set([
  'shared_allowance_exhausted', 'chat_daily_limit',
  'own_key_invalid', 'own_key_billing', 'own_key_permission', 'own_key_malformed',
]);

export function notifyAiError(data) {
  if (data && PANEL_CODES.has(data.code)) {
    window.dispatchEvent(new CustomEvent('goliathon:open-own-key', { detail: { code: data.code, message: data.error } }));
  }
}

export function openOwnKeyPanel() {
  window.dispatchEvent(new CustomEvent('goliathon:open-own-key', { detail: {} }));
}
