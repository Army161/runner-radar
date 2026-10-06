import { api, html, paint, icon, toast, ago } from '../lib.js';
import { getMe } from '../main.js';
import { shell } from '../shell.js';
import { tokenHead, tokenRow } from '../parts.js';

export async function mount(root) {
  const me = await getMe(true);
  const frame = shell(root, me, 'watchlist');
  const page = frame.body;
  let items = null;

  paint(page, html`
  <div class="wrap section-sm">
    <section class="card">
      <div class="card-head"><div class="row gap baseline"><h1>Watchlist</h1><span class="muted small">Exit signals follow every token here</span></div><span class="muted small" data-count></span></div>
      <div class="table-wrap"><div class="table" data-rows><p class="empty">Loading…</p></div></div>
    </section>
  </div>`);

  function draw() {
    const box = page.querySelector('[data-rows]');
    page.querySelector('[data-count]').textContent = items.length ? `${items.length} token${items.length === 1 ? '' : 's'}` : '';
    if (!items.length) {
      paint(box, html`<p class="empty">Nothing here yet. Open any token and press <b>Watch</b>. Tokens you get runner alerts for are added automatically.</p>`);
      return;
    }
    const live = items.filter((i) => i.tracked), gone = items.filter((i) => !i.tracked);
    paint(box, html`
      ${live.length ? html`${tokenHead('5m', 'with-x')}${live.map((r) => html`<div class="wl-row">${tokenRow(r)}<button class="icon-btn" aria-label="Remove $${r.symbol}" data-rm="${r.mint}">${icon('x', 16)}</button></div>`)}` : ''}
      ${gone.length ? html`<p class="label pad-x">NOT ON THE RADAR RIGHT NOW</p>${gone.map((r) => html`
        <div class="wl-gone"><a href="/app/token/${r.mint}" data-link class="mono"><b>$${r.symbol}</b> <span class="muted small">${r.mint.slice(0, 6)}…${r.mint.slice(-4)}</span></a>
        <span class="muted small">added ${ago(r.addedAt)} ago · no recent trades</span>
        <button class="icon-btn" aria-label="Remove $${r.symbol}" data-rm="${r.mint}">${icon('x', 16)}</button></div>`)}` : ''}`);
  }

  async function load() { try { items = (await api('/api/watchlist')).items; draw(); } catch (e) { toast(e.message, 'error'); } }

  page.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    e.preventDefault();
    try { await api(`/api/watchlist/${b.dataset.rm}`, { method: 'DELETE' }); items = items.filter((i) => i.mint !== b.dataset.rm); draw(); }
    catch (err) { toast(err.message, 'error'); }
  });

  await load();
  const timer = setInterval(load, 10_000);
  return () => { clearInterval(timer); frame.cleanup(); };
}
