import { api, html, paint, icon, toast, money, int, age, pct, scoreClass, safeUrl, raw } from '../lib.js';
import { getMe } from '../main.js';
import { shell } from '../shell.js';

const GATE_ORDER = ['contract', 'honeypot', 'vamp', 'dev', 'bundle'];
const PART_LABELS = { momentum: 'Momentum', holders: 'Holder health', smart: 'Smart money', narrative: 'Narrative / social', dev: 'Dev reputation' };
const STATUS_ICON = { pass: 'check', fail: 'x', warn: 'warn', pending: 'dot' };

function sparkline(candles) {
  if (!candles || candles.length < 2) return html`<p class="empty">Chart fills in as trades arrive.</p>`;
  const W = 800, H = 220, ys = candles.map((c) => c[1]);
  const min = Math.min(...ys), max = Math.max(...ys), span = max - min || max || 1;
  const pts = candles.map((c, i) => `${((i / (candles.length - 1)) * W).toFixed(1)},${(H - 10 - ((c[1] - min) / span) * (H - 20)).toFixed(1)}`).join(' ');
  return raw(`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" role="img" aria-label="Price, one point per minute"><path d="M0 ${H / 3}H${W}M0 ${(2 * H) / 3}H${W}" stroke="#1B2129"/><polyline fill="none" stroke="#C6F432" stroke-width="2.5" vector-effect="non-scaling-stroke" points="${pts}"/></svg>`);
}

export async function mount(root, { mint }) {
  const me = await getMe(true);
  const frame = shell(root, me, '', { showSources: false });
  const page = frame.body;
  let t = null;
  let timer = null;

  async function load() {
    try { t = await api(`/api/token/${mint}`); draw(); }
    catch (e) {
      paint(page, html`<div class="wrap section"><a class="back" href="/app" data-link>${icon('back', 16)} Back to scanner</a><p class="alert">${e.message}</p></div>`);
      clearInterval(timer);
    }
  }

  function draw() {
    const blocked = t.blockedBy.length > 0;
    const gates = GATE_ORDER.map((k) => t.gates.find((g) => g.key === k)).filter(Boolean);
    const passCount = gates.filter((g) => g.status === 'pass').length;
    const hm = t.holderMetrics;
    const L = t.links;
    paint(page, html`
    <div class="detail wrap">
      <a class="back" href="/app" data-link>${icon('back', 16)} Back to scanner</a>

      <header class="card pad dhead">
        <div class="row gap">
          <span class="tok-img lg">${t.image && safeUrl(t.image) ? html`<img src="${safeUrl(t.image)}" alt="" referrerpolicy="no-referrer">` : t.symbol.slice(0, 2)}</span>
          <div>
            <div class="row gap baseline wrap-row"><h1>$${t.symbol}</h1><span class="muted">${t.name}</span></div>
            <div class="chips">
              <span class="chip mono" title="${t.mint}">${t.mint.slice(0, 6)}…${t.mint.slice(-6)}</span>
              ${t.onCurve ? html`<span class="chip">${t.graduated ? 'graduated' : `bonding ${t.bond}%`}</span>` : html`<span class="chip">${t.source}</span>`}
              <span class="chip">age ${age(t.ageSec)}</span>
              ${t.rugged ? html`<span class="chip bad">RUGGED</span>` : ''}
            </div>
          </div>
        </div>
        <div class="row gap wrap-row">
          <div class="bigscore"><span class="label">RUNNER SCORE</span><b class="score ${blocked ? 'lo' : scoreClass(t.score)}">${blocked ? '—' : t.score}</b></div>
          <div class="row gap wrap-row">
            ${L ? html`<a class="btn primary" href="${L.axiom}" target="_blank" rel="noopener noreferrer">Trade on Axiom ${icon('out', 14)}</a>
              <a class="btn ghost" href="${L.gmgn}" target="_blank" rel="noopener noreferrer">GMGN</a>
              <a class="btn ghost" href="${L.pumpfun}" target="_blank" rel="noopener noreferrer">pump.fun</a>
              <a class="btn ghost" href="${L.dexscreener}" target="_blank" rel="noopener noreferrer">DexScreener</a>` : html`<span class="muted small">Trade links hidden in demo mode</span>`}
            <button class="btn ghost" data-watch aria-pressed="${t.watching}">${icon('bell', 16)} ${t.watching ? 'Watching' : 'Watch'}</button>
          </div>
        </div>
      </header>

      ${blocked ? html`<section class="card pad danger"><h2>Blocked for you</h2><ul class="checks">${t.blockedBy.map((b) => html`<li>${icon('x', 16)} <b>${b.tag}</b> — ${b.why}</li>`)}</ul></section>` : ''}

      <div class="stats">
        <div class="stat"><span class="label">MARKET CAP</span><b>${money(t.mcapUsd, t.mcapSol)}</b></div>
        <div class="stat"><span class="label">VOLUME 5M</span><b>${money(t.volUsd, t.volSol)}</b></div>
        <div class="stat"><span class="label">HOLDERS</span><b>${int(t.holders)}</b></div>
        <div class="stat"><span class="label">BUYS / SELLS 5M</span><b>${t.buys5m} / ${t.sells5m}</b></div>
        <div class="stat"><span class="label">TRACKED WALLETS IN</span><b>${t.smart}</b></div>
      </div>

      <div class="dgrid">
        <div class="col">
          <section class="card pad"><div class="row between"><h2>Price</h2><span class="${t.changePct >= 0 ? 'up' : 'down'} mono">${pct(t.changePct)} (5m)</span></div>${sparkline(t.candles)}</section>

          <section class="card pad">
            <h2>Holder forensics</h2>
            <div class="mini-stats">
              <div><span class="muted small">Top 10 holders</span><b class="mono">${hm.top10Pct}%</b></div>
              <div><span class="muted small">Launch-window bundle</span><b class="mono">${hm.bundlePct}% · ${hm.bundleWallets} wallets</b></div>
              <div><span class="muted small">Snipers still holding</span><b class="mono">${hm.sniperPct}% · ${hm.snipers}</b></div>
              <div><span class="muted small">Dev holding</span><b class="mono">${hm.devPct}%</b></div>
            </div>
            ${t.topHolders.length ? html`<div class="holders"><div class="hr th"><span>#</span><span>WALLET</span><span>TAGS</span><span class="r">SHARE</span></div>
              ${t.topHolders.map((h, i) => html`<div class="hr"><span class="mono muted">${i + 1}</span><span class="mono" title="${h.wallet}">${h.short}</span><span class="tags">${h.tags.map((g) => html`<i class="t-${g.replace(' ', '-')}">${g}</i>`)}</span><span class="mono r">${h.pct}%</span></div>`)}</div>`
              : html`<p class="muted small">Holder list builds from live trades; tokens found after launch show on-chain data only.</p>`}
          </section>

          <section class="card pad">
            <h2>Signal timeline</h2>
            <ol class="timeline">${t.timeline.map((e) => html`<li class="${e.kind}"><span class="mono muted">${fmtOffset(e.offsetSec)}</span><span>${e.text}</span></li>`)}</ol>
          </section>
        </div>

        <div class="col">
          <section class="card pad">
            <div class="row between"><h2>Safety gate</h2><span class="badge ${passCount === 5 ? 'pass' : blocked ? 'fail' : 'warn'}">${passCount} / 5 PASS</span></div>
            <ul class="gates">${gates.map((g) => html`<li class="${g.status}">${icon(STATUS_ICON[g.status], 18)}<div><b>${g.agent}</b><span>${g.summary}</span></div></li>`)}</ul>
          </section>

          <section class="card pad">
            <h2>Score breakdown</h2>
            ${Object.entries(PART_LABELS).map(([k, label]) => html`
              <div class="part"><div class="row between small"><span>${label} <span class="muted">· ${Math.round(t.weights[k] * 100)}%</span></span><b class="mono">${t.scoreParts[k] ?? 0}</b></div>
              <div class="bar"><i class="${(t.scoreParts[k] ?? 0) >= 70 ? '' : 'blue'}" style="width:${t.scoreParts[k] ?? 0}%"></i></div></div>`)}
            <ul class="sig-list">${t.signals.map((s) => html`<li><b>${s.agent}</b><span class="muted">${s.summary}</span></li>`)}</ul>
          </section>

          ${t.socials.twitter || t.socials.telegram || t.socials.website || t.description ? html`
          <section class="card pad">
            <h2>About</h2>
            ${t.description ? html`<p class="muted">${t.description}</p>` : ''}
            <div class="row gap wrap-row">
              ${t.socials.twitter && safeUrl(t.socials.twitter) ? html`<a class="btn ghost sm" href="${safeUrl(t.socials.twitter)}" target="_blank" rel="noopener noreferrer nofollow">X ${icon('out', 14)}</a>` : ''}
              ${t.socials.telegram && safeUrl(t.socials.telegram) ? html`<a class="btn ghost sm" href="${safeUrl(t.socials.telegram)}" target="_blank" rel="noopener noreferrer nofollow">Telegram ${icon('out', 14)}</a>` : ''}
              ${t.socials.website && safeUrl(t.socials.website) ? html`<a class="btn ghost sm" href="${safeUrl(t.socials.website)}" target="_blank" rel="noopener noreferrer nofollow">Website ${icon('out', 14)}</a>` : ''}
            </div>
            <p class="muted small">Links come from the token's own metadata. Verify before trusting them.</p>
          </section>` : ''}
        </div>
      </div>
    </div>`);
  }

  page.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-watch]');
    if (!b || !t) return;
    try {
      await api(`/api/watchlist/${t.mint}`, { method: t.watching ? 'DELETE' : 'POST' });
      t.watching = !t.watching;
      toast(t.watching ? 'Watching — exit signals will alert you' : 'Stopped watching', 'good');
      draw();
    } catch (err) { toast(err.message, 'error'); }
  });

  await load();
  timer = setInterval(load, 3000);
  return () => { clearInterval(timer); frame.cleanup(); };
}

function fmtOffset(s) {
  if (s < 0) return '—';
  const m = Math.floor(s / 60), sec = s % 60;
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
