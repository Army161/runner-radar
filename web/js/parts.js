// Pieces shared by several pages: the token table and the filter controls.
import { html, money, int, age, pct, scoreClass, safeUrl } from './lib.js';

export const GATES = [['honeypot', 'Sellability proven (no honeypot)'], ['authority', 'Mint & freeze authority revoked'], ['vamp', 'Block vamps / clones'],
  ['devHistory', 'Block devs with earlier rugs'], ['bundles', 'Block bundled launches'], ['socials', 'Require X or Telegram']];
export const LIMITS = [['maxBundle', 'Max bundle share', '%'], ['maxTop10', 'Max top-10 holders', '%'], ['maxDev', 'Max dev holding', '%'],
  ['maxSniper', 'Max sniper share', '%'], ['minScore', 'Min Runner Score', ''], ['minHolders', 'Min holders', ''],
  ['minVolUsd', 'Min 1h volume', '$'], ['minSmart', 'Min tracked wallets in', '']];
export const PRESET_COPY = {
  degen: ['Degen', 'See almost everything that is not an outright scam. Honeypots, clones, live authorities and known ruggers are still blocked.'],
  balanced: ['Balanced', 'Our default. Also blocks bundled launches, heavy dev bags and concentrated supply.'],
  strict: ['Strict', 'Only clean, well-distributed tokens with socials and at least one tracked wallet in.'],
};

export const presetButtons = (s) => html`<div class="seg3">${['degen', 'balanced', 'strict'].map((p) => html`<button class="${s.preset === p ? 'on' : ''}" aria-pressed="${s.preset === p}" data-preset="${p}">${PRESET_COPY[p][0]}</button>`)}</div>`;
export const gateSwitches = (s) => GATES.map(([k, label]) => html`<button class="switch-row" role="switch" aria-checked="${!!s.gates[k]}" data-gate="${k}"><span>${label}</span><span class="switch ${s.gates[k] ? 'on' : ''}"></span></button>`);
export const limitInputs = (s) => LIMITS.map(([k, label, unit]) => html`<label class="limit"><span>${label}</span><span class="limit-in">${unit === '$' ? html`<i>$</i>` : ''}<input type="number" min="0" data-limit="${k}" value="${s.limits[k]}">${unit === '%' ? html`<i>%</i>` : ''}</span></label>`);

export const tokenHead = (win, extra = '') => html`<div class="tr th ${extra}"><span>TOKEN</span><span>AGE</span><span>MCAP</span><span>VOL ${win}</span><span>HOLDERS</span><span>BONDING</span><span>SMART</span><span>SAFETY</span><span class="r">SCORE</span></div>`;

export const tokenRow = (r) => html`
  <a class="tr" href="/app/token/${r.mint}" data-link>
    <span class="tok">
      <span class="tok-img">${r.image && safeUrl(r.image) ? html`<img src="${safeUrl(r.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : r.symbol.slice(0, 2)}</span>
      <span class="tok-txt"><b>$${r.symbol}</b> <em class="${r.changePct >= 0 ? 'up' : 'down'}">${pct(r.changePct)}</em><small>${r.name}</small></span>
    </span>
    <span class="mono muted">${age(r.ageSec)}</span>
    <span class="mono">${money(r.mcapUsd, r.mcapSol)}</span>
    <span class="mono">${money(r.volUsd, r.volSol)}</span>
    <span class="mono">${int(r.holders)}</span>
    <span class="bond">${r.onCurve || r.graduated ? html`<span class="bar"><i class="${r.graduated ? 'grad' : ''}" style="width:${r.graduated ? 100 : r.bond}%"></i></span><span class="mono ${r.graduated ? 'blue' : 'lime'}">${r.graduated ? 'GRAD' : r.bond + '%'}</span>` : html`<span class="muted small">—</span>`}</span>
    <span class="mono">${r.smart}</span>
    <span class="badge ${r.safety.toLowerCase()}">${r.safety}</span>
    <span class="score ${r.status === 'blocked' ? 'lo' : scoreClass(r.score)} r">${r.status === 'blocked' ? '—' : r.score}</span>
  </a>`;
