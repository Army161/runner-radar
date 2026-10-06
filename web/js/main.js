import { api, $ } from './lib.js';
import * as landing from './pages/landing.js';
import * as authPage from './pages/auth.js';
import * as onboarding from './pages/onboarding.js';
import * as scanner from './pages/scanner.js';
import * as token from './pages/token.js';
import * as legal from './pages/legal.js';
import * as settings from './pages/settings.js';
import * as watchlist from './pages/watchlist.js';
import * as admin from './pages/admin.js';

// Web fonts load in the background so a slow or blocked font host never blanks the page.
(() => {
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=Space+Grotesk:wght@500;700&display=swap';
  document.head.appendChild(l);
})();

const routes = [
  { re: /^\/$/, page: landing, title: 'Runner Radar — find runners, skip the rugs' },
  { re: /^\/how-it-works\/?$/, page: landing, title: 'How it works — Runner Radar', params: { section: 'how' } },
  { re: /^\/login\/?$/, page: authPage, title: 'Sign in — Runner Radar', params: { mode: 'login' } },
  { re: /^\/signup\/?$/, page: authPage, title: 'Create account — Runner Radar', params: { mode: 'signup' } },
  { re: /^\/onboarding\/?$/, page: onboarding, title: 'Set up — Runner Radar', auth: true },
  { re: /^\/app\/?$/, page: scanner, title: 'Scanner — Runner Radar', auth: true, onboarded: true },
  { re: /^\/app\/settings\/?$/, page: settings, title: 'Settings — Runner Radar', auth: true, onboarded: true },
  { re: /^\/app\/watchlist\/?$/, page: watchlist, title: 'Watchlist — Runner Radar', auth: true, onboarded: true },
  { re: /^\/app\/admin\/?$/, page: admin, title: 'Admin — Runner Radar', auth: true, onboarded: true },
  { re: /^\/app\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})\/?$/, page: token, title: 'Token — Runner Radar', auth: true, onboarded: true, keys: ['mint'] },
  { re: /^\/terms\/?$/, page: legal, title: 'Terms — Runner Radar', params: { doc: 'terms' } },
  { re: /^\/privacy\/?$/, page: legal, title: 'Privacy — Runner Radar', params: { doc: 'privacy' } },
];

let cleanup = null;
let meCache = null;

export async function getMe(force = false) {
  if (meCache && !force) return meCache;
  try { meCache = await api('/api/me'); } catch (e) { meCache = null; if (e.status !== 401) throw e; }
  return meCache;
}
export function clearMe() { meCache = null; }

export function navigate(path, replace = false) {
  if (replace) history.replaceState(null, '', path); else history.pushState(null, '', path);
  route();
}

async function route() {
  const path = location.pathname;
  const match = routes.find((r) => r.re.test(path)) ?? routes[0];
  const m = path.match(match.re) ?? [];
  const params = { ...(match.params ?? {}) };
  (match.keys ?? []).forEach((k, i) => { params[k] = m[i + 1]; });

  if (match.auth || match.page === authPage) {
    const me = await getMe().catch(() => null);
    if (match.auth && !me) return navigate('/login', true);
    if (match.page === authPage && me) return navigate(me.user.onboarded ? '/app' : '/onboarding', true);
    if (match.onboarded && me && !me.user.onboarded) return navigate('/onboarding', true);
  }

  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  document.title = match.title;
  // Fresh container per page, so no page's event listeners outlive it.
  const old = $('#app');
  const root = old.cloneNode(false);
  old.replaceWith(root);
  cleanup = await match.page.mount(root, params);
  if (!location.hash) window.scrollTo(0, 0);
  root.focus({ preventScroll: true });
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  const href = a.getAttribute('href');
  if (!href || !href.startsWith('/') || href.startsWith('//')) return;
  e.preventDefault();
  navigate(href);
});
window.addEventListener('popstate', route);
route();
