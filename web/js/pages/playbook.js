import { api, html, paint, icon, raw, esc, toast } from '../lib.js';
import { getMe, navigate } from '../main.js';
import { shell } from '../shell.js';

/** Render the playbook's tiny markdown subset ("## ", "- ", "1. ", paragraphs) with everything escaped. */
function renderBody(body) {
  const out = [];
  let list = null; // { type: 'ul'|'ol', items: [] }
  const flush = () => { if (list) { out.push(`<${list.type}>${list.items.map((i) => `<li>${i}</li>`).join('')}</${list.type}>`); list = null; } };
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith('## ')) { flush(); out.push(`<h3>${esc(line.slice(3))}</h3>`); continue; }
    const ol = line.match(/^(\d+)\.\s+(.*)$/);
    if (ol) { if (!list || list.type !== 'ol') { flush(); list = { type: 'ol', items: [] }; } list.items.push(esc(ol[2])); continue; }
    if (line.startsWith('- ')) { if (!list || list.type !== 'ul') { flush(); list = { type: 'ul', items: [] }; } list.items.push(esc(line.slice(2))); continue; }
    flush();
    out.push(`<p>${esc(line)}</p>`);
  }
  flush();
  return raw(out.join(''));
}

export async function mount(root) {
  const me = await getMe(true);
  const frame = shell(root, me, 'playbook', { showSources: false });
  const page = frame.body;
  let data = null;

  async function upgrade(tier) {
    try {
      const r = await api('/api/billing/checkout', { method: 'POST', body: { tier } });
      if (r.url) { location.href = r.url; return; }
      if (r.demo) { toast('Demo checkout complete', 'good'); frame.setPlan((await getMe(true)).plan); await load(); }
    } catch (e) { toast(e.message, 'error'); }
  }

  function draw() {
    paint(page, html`
    <div class="wrap section-sm playbook">
      <header class="pb-head">
        <p class="eyebrow">The Runner Playbook</p>
        <h1>Process beats luck.</h1>
        <p class="lede">The exact, step-by-step way to use the scanner — from bankroll rules to the 60-second runner check to exits. Read it once, then let the checklists do the thinking under pressure.</p>
        <p class="muted small">Honest by design: nothing here guarantees profits, and most meme coins go to zero. This playbook exists to raise the quality of your shots and get you out with discipline.</p>
      </header>
      <nav class="pb-toc" aria-label="Chapters">
        ${data.sections.map((s, i) => html`<a href="#pb-${s.id}" class="${s.unlocked ? '' : 'locked'}">${i + 1}. ${s.title} ${s.unlocked ? '' : icon('shield', 13)}</a>`)}
      </nav>
      ${data.sections.map((s, i) => s.unlocked
        ? html`<section class="card pad pb-section" id="pb-${s.id}">
            <p class="label">CHAPTER ${i + 1}${s.minTier !== 'free' ? html` · ${s.minTier.toUpperCase()}` : ''}</p>
            <h2>${s.title}</h2>
            ${renderBody(s.body)}
          </section>`
        : html`<section class="card pad pb-section pb-locked" id="pb-${s.id}">
            <p class="label">CHAPTER ${i + 1} · ${s.minTier.toUpperCase()}</p>
            <h2>${s.title}</h2>
            <p class="muted">${s.summary}</p>
            <div class="row gap wrap-row">
              <button class="btn primary" data-up="${s.minTier}">Unlock with ${s.minTier === 'apex' ? 'Apex' : 'Runner Pro'}</button>
              <a class="btn ghost" href="/pricing" data-link>Compare plans</a>
            </div>
          </section>`)}
      <p class="muted small">Nothing in this playbook is financial advice. It is a process for using information well; outcomes stay uncertain.</p>
    </div>`);
  }

  async function load() {
    data = await api('/api/playbook');
    draw();
  }

  page.addEventListener('click', (e) => { const b = e.target.closest('[data-up]'); if (b) upgrade(b.dataset.up); });
  await load();
  return () => frame.cleanup();
}
