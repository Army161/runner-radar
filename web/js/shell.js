// Shared signed-in app frame: header, navigation, token search, data-source status, alerts inbox.
import { api, html, paint, icon, logo, toast, ago, safeUrl } from './lib.js';
import { navigate, clearMe } from './main.js';

const SOURCE_NAMES = { pumpfun: 'pump.fun', dexscreener: 'DexScreener', rpc: 'Solana RPC', telegram: 'Telegram' };

function feedChip(f) {
  if (!f || f.mode === 'demo') return [];
  if (f.mode === 'free') return [html`<span class="src off" title="No PumpPortal API key: new launches and DexScreener stats only. Add a key for live trades, bundles and holders.">${icon('dot', 12)}Free mode</span>`];
  const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
  const used = f.budget ? f.eventsToday / f.budget : 0;
  return [html`<span class="src ${used >= 1 ? 'down' : used >= 0.8 ? 'connecting' : 'connected'}" title="Live trade stream today: ${f.eventsToday} of ${f.budget} events (≈${f.estSolToday} SOL), ${f.subscribed} tokens streaming, ${f.skippedToday} launches skipped to stay on budget">${icon('dot', 12)}Feed ${k(f.eventsToday)}/${k(f.budget)}</span>`];
}

/**
 * Renders the frame into root and returns { body, bump, cleanup }.
 * active: 'scanner' | 'watchlist' | 'settings' | 'admin' | ''
 */
export function shell(root, me, active, { showSources = true } = {}) {
  const nav = [['scanner', '/app', 'Scanner'], ['watchlist', '/app/watchlist', 'Watchlist'], ['playbook', '/app/playbook', 'Playbook'], ['settings', '/app/settings', 'Settings']];
  if (me.user.admin) nav.push(['admin', '/app/admin', 'Admin']);
  paint(root, html`
  <div class="app">
    <header class="app-head">
      ${logo()}
      <nav class="app-nav" aria-label="App">
        ${nav.map(([k, href, label]) => html`<a href="${href}" data-link class="${k === active ? 'on' : ''}" ${k === active ? html`aria-current="page"` : ''}>${label}</a>`)}
      </nav>
      <form class="search" data-search role="search">
        ${icon('search', 16)}
        <label class="sr" for="q">Scan a token</label>
        <input id="q" name="q" placeholder="Paste a token address to scan it" autocomplete="off" spellcheck="false">
      </form>
      <div class="user">
        ${me.plan ? html`<a class="plan-chip ${me.plan.tier}" href="${me.plan.tier === 'free' ? '/pricing' : '/app/settings'}" data-link title="${me.plan.tier === 'free' ? 'See plans' : 'Manage plan'}">${me.plan.name}</a>` : ''}
        <div class="inbox-wrap">
          <button class="bell" data-bell aria-label="Alerts" aria-expanded="false" aria-haspopup="true">${icon('bell', 18)}<b data-unread hidden></b></button>
          <div class="inbox" data-inbox hidden></div>
        </div>
        <span class="avatar">${me.user.avatar ? html`<img src="${safeUrl(me.user.avatar)}" alt="" referrerpolicy="no-referrer">` : icon('user', 18)}</span>
        <span class="hide-sm">${me.user.name}</span>
        <button class="btn ghost sm" data-logout>Sign out</button>
      </div>
    </header>
    ${showSources ? html`<div class="status-strip sources" data-sources aria-label="Data sources"></div>` : ''}
    <div data-demo></div>
    <div data-body class="app-body"></div>
    <footer class="app-foot muted small">Not financial advice. Filters reduce risk, they can't remove it. <a href="/terms" data-link>Terms</a> · <a href="/privacy" data-link>Privacy</a></footer>
  </div>`);

  const $ = (s) => root.querySelector(s);
  let unread = 0;
  const timers = [];

  const setUnread = (n) => { unread = n; const b = $('[data-unread]'); if (!b) return; b.hidden = n <= 0; b.textContent = n > 99 ? '99+' : String(n); };

  async function loadStatus() {
    try {
      const s = await api('/api/status');
      const box = $('[data-sources]');
      if (box) paint(box, Object.entries(SOURCE_NAMES).map(([k, name]) => {
        const v = s.sources?.[k] ?? 'off';
        return html`<span class="src ${v}" title="${name}: ${v}">${icon('dot', 12)}${name}</span>`;
      }).concat(feedChip(s.feed)));
      paint($('[data-demo]'), s.demo ? html`<p class="demo-bar">${icon('warn', 16)} Demo mode — simulated tokens, not real market data.</p>` : '');
    } catch { /* keep last state */ }
  }
  async function loadUnread() { try { setUnread((await api('/api/alerts')).unread); } catch { /* ignore */ } }

  async function openInbox() {
    const box = $('[data-inbox]');
    paint(box, html`<p class="empty small">Loading…</p>`);
    box.hidden = false;
    $('[data-bell]').setAttribute('aria-expanded', 'true');
    try {
      const r = await api('/api/alerts');
      paint(box, html`
        <div class="inbox-head"><b>Alerts</b><span class="muted small">last 30 days</span></div>
        ${r.items.length ? html`<ol>${r.items.map((a) => html`<li class="${a.read ? '' : 'new'}"><a href="/app/token/${a.mint}" data-link>
          <span class="row between"><b class="${a.title.startsWith('RUNNER') ? 'lime' : 'warnc-t'}">${a.title}</b><span class="muted small">${ago(a.at)}</span></span>
          <span class="muted small">${a.body}</span></a></li>`)}</ol>`
          : html`<p class="empty small">No alerts yet. Runner alerts arrive here when a token crosses your alert score, and exit signals follow tokens you're watching.</p>`}`);
      if (r.unread) { await api('/api/alerts/read', { method: 'POST' }).catch(() => {}); setUnread(0); }
    } catch (e) { paint(box, html`<p class="empty small">${e.message}</p>`); }
  }
  function closeInbox() { const box = $('[data-inbox]'); if (box && !box.hidden) { box.hidden = true; $('[data-bell]').setAttribute('aria-expanded', 'false'); } }

  const onDocClick = (e) => { if (!e.target.closest('.inbox-wrap')) closeInbox(); };
  const onKey = (e) => { if (e.key === 'Escape') closeInbox(); };
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);

  root.querySelector('.app-head').addEventListener('click', async (e) => {
    if (e.target.closest('[data-bell]')) { $('[data-inbox]').hidden ? openInbox() : closeInbox(); return; }
    if (e.target.closest('[data-inbox] a')) { closeInbox(); return; }
    if (e.target.closest('[data-logout]')) { await api('/auth/logout', { method: 'POST' }).catch(() => {}); clearMe(); navigate('/'); }
  });
  root.querySelector('[data-search]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = String(new FormData(e.target).get('q') || '').trim();
    if (!q) return;
    try { const r = await api('/api/scan', { method: 'POST', body: { mint: q } }); e.target.reset(); navigate(`/app/token/${r.mint}`); }
    catch (err) { toast(err.message, 'error'); }
  });

  loadStatus(); loadUnread();
  timers.push(setInterval(loadStatus, 30_000), setInterval(loadUnread, 30_000));

  return {
    body: $('[data-body]'),
    setPlan(plan) {
      const chip = root.querySelector('.plan-chip');
      if (!chip || !plan) return;
      chip.className = `plan-chip ${plan.tier}`;
      chip.textContent = plan.name;
      chip.setAttribute('href', plan.tier === 'free' ? '/pricing' : '/app/settings');
    },
    bump(alert) { setUnread(unread + 1); if (alert) toast(`${alert.title}: ${alert.body}`, 'good'); },
    cleanup() { timers.forEach(clearInterval); document.removeEventListener('click', onDocClick); document.removeEventListener('keydown', onKey); },
  };
}
