// Tiny, dependency-free helpers: escaped templates, API calls, formatting, routing.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(String(s));

/** Tagged template that HTML-escapes every interpolation unless it is already a template. */
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return new Safe(out);
}
function render(v) {
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
}

export function paint(el, tpl) { if (el) el.innerHTML = render(tpl); }
export const $ = (sel, root = document) => root.querySelector(sel);

/** Only allow http(s) URLs into href/src attributes (token metadata is attacker-controlled). */
export function safeUrl(u) {
  try { const url = new URL(u); return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : ''; } catch { return ''; }
}

export class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data;
}

// ---------- formatting ----------
export function usd(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`;
  return `$${Math.round(n)}`;
}
export const sol = (n) => (n === null || n === undefined ? '—' : `${n >= 100 ? Math.round(n) : n.toFixed(1)} SOL`);
export const money = (usdVal, solVal) => (usdVal !== null && usdVal !== undefined ? usd(usdVal) : sol(solVal));
export const int = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US'));
export function age(sec) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}
export const pct = (n) => `${n > 0 ? '+' : ''}${Number(n).toLocaleString('en-US')}%`;
export const ago = (t) => age(Math.max(0, Math.round((Date.now() - t) / 1000)));
export const scoreClass = (s) => (s >= 85 ? 'hi' : s >= 70 ? 'mid' : 'lo');

// ---------- toasts ----------
export function toast(msg, kind = 'info') {
  const box = $('#toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// ---------- icons (inline stroke SVG) ----------
const ICONS = {
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 12l7-6"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  back: '<path d="M14 6l-6 6 6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
  dot: '<circle cx="12" cy="12" r="3.5"/>',
  bell: '<path d="M6 16V11a6 6 0 0112 0v5l1.5 1.5h-15z"/><path d="M10 20a2 2 0 004 0"/>',
  out: '<path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
  google: '<path d="M20.5 12.2c0-.6-.1-1.2-.2-1.7H12v3.3h4.8a4.1 4.1 0 01-1.8 2.7v2.2h2.9c1.7-1.6 2.6-3.9 2.6-6.5z"/><path d="M12 21c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.9.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H3.9v2.3A9 9 0 0012 21z"/><path d="M6.9 13.7a5.4 5.4 0 010-3.4V8H3.9a9 9 0 000 8z"/><path d="M12 6.6c1.3 0 2.5.5 3.5 1.4l2.6-2.6A9 9 0 003.9 8l3 2.3C7.6 8.2 9.6 6.6 12 6.6z"/>',
  discord: '<path d="M8 8.5c2.5-1 5.5-1 8 0M8 15.5c2.5 1 5.5 1 8 0"/><path d="M7 7l-2 9c1.5 1.2 3 1.8 4 2l1-2M17 7l2 9c-1.5 1.2-3 1.8-4 2l-1-2"/><circle cx="9.5" cy="12" r="1"/><circle cx="14.5" cy="12" r="1"/>',
  xlogo: '<path d="M5 5l14 14M19 5l-5.5 6.3M10.5 12.7L5 19"/>',
};
export const icon = (name, size = 18, cls = '') =>
  raw(`<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`);

export const logo = () => html`<a class="logo" href="/" data-link>${icon('radar', 26)}<span>RUNNER RADAR</span></a>`;
