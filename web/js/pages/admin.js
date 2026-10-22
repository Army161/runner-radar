import { api, html, paint, toast, ago, int } from '../lib.js';
import { getMe, navigate } from '../main.js';
import { shell } from '../shell.js';

const dur = (s) => (s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`);
const x = (v) => (v === null || v === undefined ? '—' : `${v}×`);
const p = (v) => (v === null || v === undefined ? '—' : `${v}%`);

export async function mount(root) {
  const me = await getMe(true);
  if (!me.user.admin) { navigate('/app', true); return; }
  const frame = shell(root, me, 'admin');
  const page = frame.body;
  let days = 30;

  async function load() {
    let d;
    try { d = await api(`/api/admin?days=${days}`); } catch (e) { toast(e.message, 'error'); return; }
    const tr = d.trackRecord, f = d.feed, u = d.users;
    const stat = (label, value, note = '') => html`<div class="stat"><span class="label">${label}</span><b>${value}</b>${note ? html`<span class="muted small">${note}</span>` : ''}</div>`;
    paint(page, html`
    <div class="wrap section-sm admin">
      <div class="row between wrap-row gap"><h1>Admin</h1><span class="muted small">Up ${dur(d.uptimeSec)} · ${d.memoryMb} MB memory</span></div>

      <h2 class="label">USERS</h2>
      <div class="stats">
        ${stat('TOTAL', int(u.total), `${int(u.onboarded)} finished onboarding`)}
        ${stat('NEW (7 DAYS)', int(u.new7d))}
        ${stat('ACTIVE (24H)', int(u.active24h))}
        ${stat('TELEGRAM LINKED', int(u.telegram))}
        ${stat('ALERTS SENT (24H)', int(u.alerts24h))}
      </div>

      <div class="row between wrap-row gap"><h2 class="label">TRACK RECORD · PROMOTED RUNNERS</h2>
        <div class="seg" role="group" aria-label="Period">${[7, 30, 90].map((n) => html`<button class="${n === days ? 'on' : ''}" aria-pressed="${n === days}" data-days="${n}">${n}d</button>`)}</div></div>
      <div class="stats">
        ${stat('PROMOTED', int(tr.promoted))}
        ${stat('HIT 2× AFTER ALERT', p(tr.hit2x))}
        ${stat('HIT 5× AFTER ALERT', p(tr.hit5x))}
        ${stat('MEDIAN PEAK', x(tr.medianPeak))}
        ${stat('RUGGED LATER', p(tr.rugRate))}
      </div>
      <p class="muted small">Measured from the market cap at the moment a token was promoted to RUNNER, using what the scanner saw while it was tracking the token. This is real data from your server, not a projection. It shows whether the score weights are working.</p>
      ${tr.recent.length ? html`<section class="card"><div class="table-wrap"><div class="table narrow-table">
        <div class="ar th"><span>TOKEN</span><span>PROMOTED</span><span>SCORE</span><span>PEAK</span><span>NOW</span><span>RUG</span></div>
        ${tr.recent.map((o) => html`<a class="ar" href="/app/token/${o.mint}" data-link><b class="mono">$${o.symbol}</b><span class="muted">${ago(o.at)} ago</span><span class="mono">${Math.round(o.score)}</span><span class="mono ${o.peakX >= 2 ? 'lime' : ''}">${x(o.peakX)}</span><span class="mono ${o.nowX < 1 ? 'bad' : ''}">${x(o.nowX)}</span><span>${o.rugged ? html`<span class="tag">RUG</span>` : ''}</span></a>`)}
      </div></div></section>` : html`<p class="empty card">No runners promoted in this period yet.</p>`}

      <h2 class="label">PIPELINE</h2>
      <div class="stats">
        ${stat('TOKENS TRACKED NOW', int(d.pipeline.watching))}
        ${stat('DEPLOYERS SEEN', int(d.pipeline.deployersSeen))}
        ${stat('KNOWN RUGGERS', int(d.pipeline.ruggersKnown))}
        ${f.mode === 'paid' ? stat('TRADE FEED TODAY', `${int(f.eventsToday)} / ${int(f.budget)}`, `≈${f.estSolToday} SOL · ${f.subscribed} streaming · ${int(f.skippedToday)} skipped`) : stat('TRADE FEED', f.mode === 'demo' ? 'Demo' : 'Free mode', f.mode === 'free' ? 'Add PUMPPORTAL_API_KEY for live trades' : '')}
        ${d.jev?.enabled ? stat('JEV SCAM JUDGE', `${int(d.jev.callsToday)} / ${int(d.jev.budget)}`, d.jev.lastError ? `Last call failed: ${d.jev.lastError}` : `calls today · ${d.jev.model} · ≈$${(d.jev.callsToday * 0.00005).toFixed(2)}`) : stat('JEV SCAM JUDGE', 'Off', 'Add TYPESAFE_API_KEY to enable')}
        ${stat('LAST BACKUP', d.backups?.lastAt ? `${ago(d.backups.lastAt)} ago` : 'none yet', d.backups?.lastError ? `Last attempt failed: ${d.backups.lastError}` : `daily, keeps ${d.backups?.keep ?? 7}`)}
      </div>

      <h2 class="label">RECENT ERRORS</h2>
      ${d.errors.length ? html`<section class="card"><ol class="errors">${d.errors.map((e) => html`<li><span class="muted small mono">${ago(e.t)} ago</span><pre>${e.msg}</pre></li>`)}</ol></section>`
        : html`<p class="empty card">No errors since the last restart.</p>`}
    </div>`);
  }

  page.addEventListener('click', (e) => { const b = e.target.closest('[data-days]'); if (b) { days = Number(b.dataset.days); load(); } });
  await load();
  const timer = setInterval(load, 30_000);
  return () => { clearInterval(timer); frame.cleanup(); };
}
