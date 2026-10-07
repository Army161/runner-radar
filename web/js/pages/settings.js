import { api, html, paint, icon, toast } from '../lib.js';
import { getMe, navigate, clearMe } from '../main.js';
import { shell } from '../shell.js';
import { PRESET_COPY, gateSwitches, limitInputs } from '../parts.js';

const PROVIDER_NAMES = { google: 'Google', discord: 'Discord', x: 'X', dev: 'Local dev' };

export async function mount(root) {
  const me = await getMe(true);
  const status = await api('/api/status').catch(() => ({}));
  const frame = shell(root, me, 'settings', { showSources: false });
  const page = frame.body;
  const st = { settings: me.settings, wallets: me.wallets, tgLinked: me.telegramLinked, tg: null, plan: me.plan };
  let poll = null;

  const billingParam = new URLSearchParams(location.search).get('billing');
  if (billingParam) {
    history.replaceState(null, '', '/app/settings');
    if (billingParam === 'success') { toast('Subscription active — welcome aboard', 'good'); getMe(true).then((m) => { st.plan = m.plan; draw(); }).catch(() => {}); }
    else toast('Checkout cancelled — no charge', 'info');
  }

  async function refreshPlan() { const m = await getMe(true); st.plan = m.plan; frame.setPlan(m.plan); draw(); }

  const save = async (patch) => {
    try { st.settings = (await api('/api/settings', { method: 'PUT', body: patch })).settings; draw(); toast('Saved', 'good'); }
    catch (e) { toast(e.message, 'error'); }
  };

  function billingBlock() {
    const p = st.plan;
    if (!p) return '';
    const bar = (label, used, max) => html`<div class="use"><span class="row between small"><span>${label}</span><b class="mono">${used} / ${max}</b></span><span class="bar"><i class="${used >= max ? 'blue' : ''}" style="width:${Math.min(100, Math.round((used / max) * 100))}%"></i></span></div>`;
    const renews = p.periodEnd ? new Date(p.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
    return html`
      <div class="row between wrap-row gap">
        <div><span class="plan-chip ${p.tier}">${p.name}</span>
          <span class="muted small">${p.tier === 'free' ? 'Free forever' : p.status === 'past_due' ? 'Payment issue — update your card' : renews ? `Renews ${renews}` : 'Active'}${p.demoBilling ? ' · demo billing' : ''}</span></div>
        <div class="row gap wrap-row">
          ${p.tier !== 'pro' && p.tier !== 'apex' ? html`<button class="btn primary" data-buy="pro">Runner Pro — $29/mo</button>` : ''}
          ${p.tier !== 'apex' ? html`<button class="btn ${p.tier === 'pro' ? 'primary' : 'ghost'}" data-buy="apex">Apex — $79/mo</button>` : ''}
          ${p.tier !== 'free' ? html`<button class="btn ghost" data-portal>${p.manageable ? 'Manage billing' : 'Cancel plan'}</button>` : html`<a class="btn ghost" href="/pricing" data-link>Compare plans</a>`}
        </div>
      </div>
      <div class="uses">
        ${bar('Tracked wallets', p.usage.wallets, p.limits.wallets)}
        ${bar('Watchlist', p.usage.watchlist, p.limits.watchlist)}
        ${bar('Scans today', p.usage.scansToday, p.limits.scansPerDay)}
      </div>
      ${p.tier === 'free' ? html`<p class="muted small">Scout gets ${p.limits.alertsPerDay} runner alerts a day in-app. Runner Pro adds unlimited alerts, exit signals, Telegram delivery and the full trader Playbook.</p>` : ''}`;
  }

  function telegramBlock() {
    if (status.sources?.telegram !== 'connected') return html`<p class="muted">Telegram alerts aren't configured on this server yet. In-app alerts still work.</p>`;
    if (st.tgLinked) return html`<div class="row between wrap-row gap"><p class="ok-line">${icon('check', 16)} Telegram linked</p><button class="btn ghost sm" data-tg-unlink>Unlink</button></div>`;
    if (st.tg) return html`<div class="tg-code"><p>Open the bot and press <b>Start</b>, or send it this code:</p><code>/start ${st.tg.code}</code>
      ${st.tg.link ? html`<a class="btn primary" href="${st.tg.link}" target="_blank" rel="noopener noreferrer">Open Telegram ${icon('out', 16)}</a>` : ''}
      <p class="muted small">Waiting for you to press Start…</p></div>`;
    return html`<button class="btn primary" data-tg>Link Telegram</button>`;
  }

  function draw() {
    const s = st.settings, a = s.alerts;
    const toggle = (key, label) => html`<button class="switch-row" role="switch" aria-checked="${!!a[key]}" data-alert="${key}"><span>${label}</span><span class="switch ${a[key] ? 'on' : ''}"></span></button>`;
    paint(page, html`
    <div class="settings wrap">
      <h1>Settings</h1>

      <section class="card pad" aria-labelledby="h-plan">
        <h2 id="h-plan">Plan & billing</h2>
        ${billingBlock()}
      </section>

      <section class="card pad" aria-labelledby="h-filters">
        <h2 id="h-filters">Filters</h2>
        <p class="muted small">Applies to everything you see on the scanner and to which runner alerts you get.</p>
        <div class="preset-grid" role="radiogroup" aria-label="Risk preset">
          ${Object.entries(PRESET_COPY).map(([k, [name, text]]) => html`
            <button class="preset ${s.preset === k ? 'on' : ''}" role="radio" aria-checked="${s.preset === k}" data-preset="${k}"><b>${name}</b><span>${text}</span></button>`)}
        </div>
        <div class="two">
          <div><h3 class="label">SAFETY GATE · HARD BLOCKS</h3>${gateSwitches(s)}</div>
          <div><h3 class="label">THRESHOLDS</h3>${limitInputs(s)}</div>
        </div>
      </section>

      <section class="card pad" aria-labelledby="h-alerts">
        <h2 id="h-alerts">Alerts</h2>
        ${toggle('enabled', 'Runner alerts')}
        <label class="limit"><span>Alert when Runner Score reaches</span><span class="limit-in"><input type="number" min="0" max="100" data-alert-min value="${a.minScore}"></span></label>
        <h3 class="label">EXIT SIGNALS FOR TOKENS YOU'RE WATCHING</h3>
        ${toggle('devSell', 'Dev sells any amount')}
        ${toggle('scoreDrop', 'Score drops below 70')}
        ${toggle('smartExit', 'Tracked wallets start exiting')}
        ${toggle('graduate', 'Token graduates')}
      </section>

      <section class="card pad" aria-labelledby="h-tg"><h2 id="h-tg">Telegram</h2>${telegramBlock()}</section>

      <section class="card pad" aria-labelledby="h-wallets">
        <h2 id="h-wallets">Tracked wallets</h2>
        <p class="muted small">When these wallets buy, the Smart money agent scores it, and the token is picked up even if it's off the radar. Up to 50.</p>
        <form class="row gap wallet-form" data-wallet-form>
          <label class="sr" for="w-addr">Wallet address</label>
          <input id="w-addr" name="address" placeholder="Solana wallet address" autocomplete="off" spellcheck="false" required>
          <label class="sr" for="w-label">Label</label>
          <input id="w-label" name="label" placeholder="Label (optional)" maxlength="40" class="narrow">
          <button class="btn primary" type="submit">${icon('plus', 16)} Add</button>
        </form>
        <ul class="wallet-list">
          ${st.wallets.length ? st.wallets.map((w) => html`<li><code>${w.address}</code><span class="muted">${w.label}</span>
            <button class="icon-btn" aria-label="Remove ${w.address}" data-rm="${w.address}">${icon('trash', 16)}</button></li>`)
            : html`<li class="muted">No tracked wallets yet.</li>`}
        </ul>
      </section>

      <section class="card pad" aria-labelledby="h-account">
        <h2 id="h-account">Account</h2>
        <dl class="kv">
          <dt>Name</dt><dd>${me.user.name}</dd>
          <dt>Email</dt><dd>${me.user.email ?? '—'}</dd>
          <dt>Signed in with</dt><dd>${me.user.providers.map((p) => PROVIDER_NAMES[p] ?? p).join(', ')}</dd>
        </dl>
        <div class="row gap wrap-row">
          <button class="btn ghost" data-logout-all>Sign out on all devices</button>
          <button class="btn ghost danger-btn" data-delete>Delete account</button>
        </div>
        <p class="muted small">Deleting removes your profile, settings, tracked wallets, watchlist and alert history. It can't be undone.</p>
      </section>
    </div>`);
  }

  page.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.buy) {
      try {
        const r = await api('/api/billing/checkout', { method: 'POST', body: { tier: t.dataset.buy } });
        if (r.url) { location.href = r.url; return; }
        if (r.demo) { toast(`Demo checkout — ${r.tier === 'apex' ? 'Apex' : 'Runner Pro'} active`, 'good'); await refreshPlan(); }
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
    if ('portal' in t.dataset) {
      try {
        const r = await api('/api/billing/portal', { method: 'POST' });
        if (r.url) { location.href = r.url; return; }
        if (r.demo) { toast('Plan cancelled (demo)', 'info'); await refreshPlan(); }
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
    if (t.dataset.preset) save({ preset: t.dataset.preset });
    else if (t.dataset.gate) save({ gates: { [t.dataset.gate]: !st.settings.gates[t.dataset.gate] } });
    else if (t.dataset.alert) save({ alerts: { [t.dataset.alert]: !st.settings.alerts[t.dataset.alert] } });
    else if ('tg' in t.dataset) {
      try {
        st.tg = await api('/api/telegram/code', { method: 'POST' }); draw();
        clearInterval(poll);
        poll = setInterval(async () => {
          const m = await getMe(true).catch(() => null);
          if (m?.telegramLinked) { st.tgLinked = true; st.tg = null; clearInterval(poll); draw(); toast('Telegram linked', 'good'); }
        }, 3000);
      } catch (err) { toast(err.message, 'error'); }
    } else if ('tgUnlink' in t.dataset) {
      await api('/api/telegram', { method: 'DELETE' }).then(() => { st.tgLinked = false; draw(); toast('Telegram unlinked', 'good'); }).catch((err) => toast(err.message, 'error'));
    } else if (t.dataset.rm) {
      await api(`/api/wallets/${encodeURIComponent(t.dataset.rm)}`, { method: 'DELETE' }).then(() => { st.wallets = st.wallets.filter((w) => w.address !== t.dataset.rm); draw(); }).catch((err) => toast(err.message, 'error'));
    } else if ('logoutAll' in t.dataset) {
      await api('/auth/logout-all', { method: 'POST' }).catch(() => {}); clearMe(); navigate('/login');
    } else if ('delete' in t.dataset) {
      if (!confirm('Delete your Runner Radar account permanently?')) return;
      try { await api('/api/account', { method: 'DELETE' }); await api('/auth/logout', { method: 'POST' }).catch(() => {}); clearMe(); navigate('/'); }
      catch (err) { toast(err.message, 'error'); }
    }
  });
  page.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.limit) save({ limits: { [el.dataset.limit]: Number(el.value) } });
    if ('alertMin' in el.dataset) save({ alerts: { minScore: Number(el.value) } });
  });
  page.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-wallet-form]')) return;
    e.preventDefault();
    const f = new FormData(e.target);
    const address = String(f.get('address') || '').trim(), label = String(f.get('label') || '').trim();
    try {
      await api('/api/wallets', { method: 'POST', body: { address, label } });
      if (!st.wallets.some((w) => w.address === address)) st.wallets.push({ address, label });
      draw(); toast('Wallet added', 'good');
    } catch (err) { toast(err.message, 'error'); }
  });

  draw();
  return () => { clearInterval(poll); frame.cleanup(); };
}
