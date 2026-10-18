import { api, html, paint, icon, logo, toast } from '../lib.js';
import { getMe, navigate, clearMe } from '../main.js';

const PRESET_COPY = {
  degen: ['Degen', 'See almost everything that is not an outright scam. Honeypots, clones, live authorities and known ruggers are still blocked.'],
  balanced: ['Balanced', 'Our default. Also blocks bundled launches, heavy dev bags and concentrated supply.'],
  strict: ['Strict', 'Only clean, well-distributed tokens with socials and at least one tracked wallet in.'],
};
const STEPS = ['Risk level', 'Alerts', 'Smart wallets'];

export async function mount(root) {
  let me = await getMe(true);
  const status = await api('/api/status').catch(() => ({}));
  const st = { step: 0, settings: me.settings, tg: null, wallets: me.wallets, tgLinked: me.telegramLinked };
  let poll = null;

  const save = async (patch) => {
    try { st.settings = (await api('/api/settings', { method: 'PUT', body: patch })).settings; draw(); } catch (e) { toast(e.message, 'error'); }
  };

  const limitRow = (label, key, suffix = '') => html`
    <label class="limit"><span>${label}</span><span class="limit-in"><input type="number" inputmode="decimal" min="0" data-limit="${key}" value="${st.settings.limits[key]}">${suffix ? html`<i>${suffix}</i>` : ''}</span></label>`;

  function stepPreset() {
    const s = st.settings;
    return html`
      <h2>How much risk do you want to see?</h2>
      <p class="muted">You can change any of this later from the scanner sidebar.</p>
      <div class="preset-grid" role="radiogroup" aria-label="Risk preset">
        ${Object.entries(PRESET_COPY).map(([k, [name, text]]) => html`
          <button class="preset ${s.preset === k ? 'on' : ''}" role="radio" aria-checked="${s.preset === k}" data-preset="${k}">
            <b>${name}</b><span>${text}</span>
          </button>`)}
      </div>
      <details class="adv">
        <summary>Fine-tune limits</summary>
        <div class="limits">
          ${limitRow('Max launch-bundle share', 'maxBundle', '%')}
          ${limitRow('Max top-10 holders', 'maxTop10', '%')}
          ${limitRow('Max dev holding', 'maxDev', '%')}
          ${limitRow('Max sniper share', 'maxSniper', '%')}
          ${limitRow('Min Runner Score', 'minScore')}
          ${limitRow('Min holders', 'minHolders')}
          ${limitRow('Min 1h volume', 'minVolUsd', 'USD')}
        </div>
      </details>`;
  }

  function stepAlerts() {
    const a = st.settings.alerts;
    const toggle = (key, label) => html`<button class="switch-row" role="switch" aria-checked="${!!a[key]}" data-alert="${key}"><span>${label}</span><span class="switch ${a[key] ? 'on' : ''}"></span></button>`;
    const tgBlock = status.sources?.telegram !== 'connected'
      ? html`<p class="muted small">Telegram alerts aren't configured on this server yet. In-app alerts still work.</p>`
      : st.tgLinked
        ? html`<p class="ok-line">${icon('check', 16)} Telegram linked</p>`
        : st.tg
          ? html`<div class="tg-code"><p>Open the bot and press <b>Start</b>, or send it this code:</p><code>/start ${st.tg.code}</code>
              ${st.tg.link ? html`<a class="btn primary" href="${st.tg.link}" target="_blank" rel="noopener noreferrer">Open Telegram ${icon('out', 16)}</a>` : ''}
              <p class="muted small">Waiting for you to press Start…</p></div>`
          : html`<button class="btn primary" data-tg>Link Telegram</button>`;
    return html`
      <h2>When should we ping you?</h2>
      <p class="muted">Alerts arrive in the app, and on Telegram if you link it.</p>
      <div class="panel flat">
        ${toggle('enabled', 'Runner alerts')}
        <label class="limit"><span>Alert when Runner Score reaches</span><span class="limit-in"><input type="number" min="0" max="100" data-alert-min value="${a.minScore}"></span></label>
      </div>
      <h3 class="sub">Exit signals for tokens you were alerted on</h3>
      <div class="panel flat">
        ${toggle('devSell', 'Dev sells any amount')}
        ${toggle('scoreDrop', 'Score drops below 70')}
        ${toggle('smartExit', 'Tracked wallets start exiting')}
        ${toggle('graduate', 'Token graduates')}
      </div>
      <h3 class="sub">Telegram</h3>
      <div class="panel flat">${tgBlock}</div>`;
  }

  function stepWallets() {
    return html`
      <h2>Track wallets you trust</h2>
      <p class="muted">Optional. When these wallets buy, the Smart money agent scores it and the token is picked up even if it's off our radar. Up to 50.</p>
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
          : html`<li class="muted">No wallets yet — you can skip this.</li>`}
      </ul>`;
  }

  function draw() {
    const body = [stepPreset, stepAlerts, stepWallets][st.step]();
    paint(root, html`
    <div class="onb">
      <header class="row between onb-head">${logo()}<span class="muted small">Step ${st.step + 1} of ${STEPS.length}</span></header>
      <ol class="stepper" aria-label="Progress">${STEPS.map((s, i) => html`<li class="${i === st.step ? 'cur' : i < st.step ? 'done' : ''}" ${i === st.step ? html`aria-current="step"` : ''}>${s}</li>`)}</ol>
      <section class="onb-body">${body}</section>
      <footer class="row between onb-foot">
        ${st.step > 0 ? html`<button class="btn ghost" data-back>${icon('back', 16)} Back</button>` : html`<span></span>`}
        ${st.step < STEPS.length - 1 ? html`<button class="btn primary" data-next>Continue</button>` : html`<button class="btn primary" data-finish>Open scanner</button>`}
      </footer>
    </div>`);
  }

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.preset) save({ preset: t.dataset.preset });
    else if (t.dataset.alert) save({ alerts: { [t.dataset.alert]: !st.settings.alerts[t.dataset.alert] } });
    else if ('next' in t.dataset) { st.step++; draw(); }
    else if ('back' in t.dataset) { st.step--; draw(); }
    else if ('tg' in t.dataset) {
      try {
        st.tg = await api('/api/telegram/code', { method: 'POST' });
        draw();
        clearInterval(poll);
        poll = setInterval(async () => {
          const m = await getMe(true).catch(() => null);
          if (m?.telegramLinked) { st.tgLinked = true; clearInterval(poll); draw(); toast('Telegram linked', 'good'); }
        }, 3000);
      } catch (err) { toast(err.message, 'error'); }
    } else if (t.dataset.rm) {
      await api(`/api/wallets/${encodeURIComponent(t.dataset.rm)}`, { method: 'DELETE' }).catch((err) => toast(err.message, 'error'));
      st.wallets = st.wallets.filter((w) => w.address !== t.dataset.rm); draw();
    } else if ('finish' in t.dataset) {
      try { await api('/api/onboarding/complete', { method: 'POST' }); clearMe(); navigate('/app'); toast("You're on Scout (free) — upgrade anytime in Settings", 'good'); } catch (err) { toast(err.message, 'error'); }
    }
  });

  root.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.limit) save({ limits: { [el.dataset.limit]: Number(el.value) } });
    if ('alertMin' in el.dataset) save({ alerts: { minScore: Number(el.value) } });
  });

  root.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-wallet-form]')) return;
    e.preventDefault();
    const f = new FormData(e.target);
    const address = String(f.get('address') || '').trim();
    const label = String(f.get('label') || '').trim();
    try {
      await api('/api/wallets', { method: 'POST', body: { address, label } });
      if (!st.wallets.some((w) => w.address === address)) st.wallets.push({ address, label });
      draw();
    } catch (err) { toast(err.message, 'error'); }
  });

  draw();
  return () => clearInterval(poll);
}
