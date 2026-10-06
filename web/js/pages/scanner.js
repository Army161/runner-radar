import { api, html, paint, toast, ago } from '../lib.js';
import { getMe } from '../main.js';
import { shell } from '../shell.js';
import { presetButtons, gateSwitches, limitInputs, tokenHead, tokenRow } from '../parts.js';

const TABS = [['newpairs', 'New pairs', 'Freshest mints, checked on arrival'], ['bonding', 'Bonding', 'On the curve, closest to graduating'],
  ['graduated', 'Graduated', 'Migrated to an AMM pool'], ['trending', 'Trending', 'Ranked by Runner Score'],
  ['held', 'Most held', 'Ranked by unique holders'], ['gainers', 'Gainers', 'Biggest move in the window']];
const WINDOWS = ['1m', '5m', '1h', '24h'];
export async function mount(root) {
  const me = await getMe(true);
  const saved = (() => { try { return JSON.parse(localStorage.getItem('rr_view') || '{}'); } catch { return {}; } })();
  const st = {
    tab: TABS.some(([k]) => k === saved.tab) ? saved.tab : 'trending', win: WINDOWS.includes(saved.win) ? saved.win : '5m',
    settings: me.settings, list: null, blocked: [], feed: [], showBlocked: true,
  };
  let es = null;
  const timers = [];

  const frame = shell(root, me, 'scanner');
  const page = frame.body;
  paint(page, html`
    <div class="toolbar">
      <nav class="tabs" aria-label="Feeds" data-tabs></nav>
      <div class="seg" role="group" aria-label="Time window" data-wins></div>
    </div>
    <div class="layout">
      <aside class="side" aria-label="Filters" data-side></aside>
      <main class="main">
        <section class="card">
          <div class="card-head"><div class="row gap baseline"><h1 data-title></h1><span class="muted small" data-hint></span></div><span class="muted small" data-count></span></div>
          <div class="table-wrap"><div class="table" data-rows><p class="empty">Loading live data…</p></div></div>
        </section>
        <section class="card blocked-card">
          <button class="blocked-toggle" data-toggle-blocked aria-expanded="true"><span class="row gap baseline"><b>Blocked by agents</b><span class="bad small" data-bcount></span></span><span class="muted small" data-bcta>Hide</span></button>
          <div data-blocked></div>
        </section>
      </main>
      <aside class="card feed" aria-label="Agent activity">
        <div class="card-head"><h2>Agent activity</h2><span class="muted small">live</span></div>
        <ol data-feed></ol>
      </aside>
    </div>`);

  const $ = (s) => page.querySelector(s);

  function drawTabs() {
    paint($('[data-tabs]'), TABS.map(([k, label]) => html`<button class="tab ${k === st.tab ? 'on' : ''}" aria-pressed="${k === st.tab}" data-tab="${k}">${label}</button>`));
    paint($('[data-wins]'), WINDOWS.map((w) => html`<button class="${w === st.win ? 'on' : ''}" aria-pressed="${w === st.win}" data-win="${w}">${w}</button>`));
    const t = TABS.find(([k]) => k === st.tab);
    $('[data-title]').textContent = t[1];
    $('[data-hint]').textContent = t[2];
  }

  function drawSide() {
    const s = st.settings;
    paint($('[data-side]'), html`
      <section class="card pad"><h2 class="label">PRESET</h2>${presetButtons(s)}</section>
      <section class="card pad"><h2 class="label">SAFETY GATE · HARD BLOCKS</h2>${gateSwitches(s)}</section>
      <section class="card pad">
        <h2 class="label">THRESHOLDS</h2>
        ${limitInputs(s)}
        <p class="muted small">Holder limits apply once a token has 30+ holders. Score, holder and volume minimums apply to Trending, Most held and Gainers.</p>
      </section>`);
  }

  function drawRows() {
    const box = $('[data-rows]');
    if (!st.list) return;
    $('[data-count]').textContent = `${st.list.total} passing · ${st.list.blocked} blocked`;
    if (!st.list.rows.length) {
      paint(box, html`<p class="empty">Nothing passes your filters on this tab right now. New tokens arrive every few seconds — try New pairs or Bonding, or relax a threshold on the left.</p>`);
      return;
    }
    paint(box, html`${tokenHead(st.win)}${st.list.rows.map(tokenRow)}`);
  }

  function drawBlocked() {
    $('[data-bcount]').textContent = `${st.blocked.length} recent`;
    $('[data-bcta]').textContent = st.showBlocked ? 'Hide' : 'Show';
    $('[data-toggle-blocked]').setAttribute('aria-expanded', String(st.showBlocked));
    paint($('[data-blocked]'), st.showBlocked ? (st.blocked.length ? st.blocked.map((b) => html`
      <a class="brow" href="/app/token/${b.mint}" data-link><s class="mono">$${b.symbol}</s><span class="tag">${b.tag}</span><span class="why">${b.why}</span></a>`)
      : html`<p class="empty">Nothing blocked yet.</p>`) : '');
  }

  function drawFeed() {
    paint($('[data-feed]'), st.feed.slice(0, 60).map((f) => html`
      <li class="${f.level}">
        <span class="row between"><b class="agent">${f.agent}</b><span class="muted">${ago(f.t)}</span></span>
        ${f.mint ? html`<a href="/app/token/${f.mint}" data-link>${f.text}</a>` : html`<span>${f.text}</span>`}
      </li>`));
  }

  function connect() {
    es?.close();
    es = new EventSource(`/api/stream?tab=${st.tab}&window=${st.win}`);
    es.addEventListener('tokens', (e) => { st.list = JSON.parse(e.data); drawRows(); });
    es.addEventListener('feed', (e) => { st.feed.unshift(JSON.parse(e.data)); if (st.feed.length > 100) st.feed.pop(); drawFeed(); });
    es.addEventListener('alert', (e) => frame.bump(JSON.parse(e.data)));
    es.onerror = () => { if (es.readyState === EventSource.CLOSED) setTimeout(connect, 3000); };
  }

  const loadBlocked = async () => { try { st.blocked = (await api('/api/blocked')).items; drawBlocked(); } catch { /* retry next tick */ } };
  const saveView = () => { try { localStorage.setItem('rr_view', JSON.stringify({ tab: st.tab, win: st.win })); } catch { /* private mode */ } };

  async function saveSettings(patch) {
    try {
      st.settings = (await api('/api/settings', { method: 'PUT', body: patch })).settings;
      drawSide();
      loadBlocked();
      st.list = await api(`/api/tokens?tab=${st.tab}&window=${st.win}`); drawRows();
    } catch (e) { toast(e.message, 'error'); }
  }

  page.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tab) { st.tab = b.dataset.tab; st.list = null; paint($('[data-rows]'), html`<p class="empty">Loading…</p>`); drawTabs(); saveView(); connect(); }
    else if (b.dataset.win) { st.win = b.dataset.win; drawTabs(); saveView(); connect(); }
    else if (b.dataset.preset) saveSettings({ preset: b.dataset.preset });
    else if (b.dataset.gate) saveSettings({ gates: { [b.dataset.gate]: !st.settings.gates[b.dataset.gate] } });
    else if ('toggleBlocked' in b.dataset) { st.showBlocked = !st.showBlocked; drawBlocked(); }
  });
  page.addEventListener('change', (e) => { const k = e.target.dataset?.limit; if (k) saveSettings({ limits: { [k]: Number(e.target.value) } }); });
  drawTabs(); drawSide(); drawBlocked();
  api('/api/feed').then((r) => { st.feed = r.items; drawFeed(); }).catch(() => {});
  loadBlocked(); connect();
  timers.push(setInterval(loadBlocked, 8000), setInterval(drawFeed, 15_000));
  return () => { es?.close(); timers.forEach(clearInterval); frame.cleanup(); };
}

