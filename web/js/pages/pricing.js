import { api, html, paint, icon, logo, toast } from '../lib.js';
import { getMe, navigate } from '../main.js';

const FEATURES = (t) => [
  ['Live scanner, all six feeds', true],
  ['All 5 safety gates + Runner Score', true],
  [`${t.scansPerDay} token scans / day`, true],
  [`${t.wallets} tracked smart wallets`, true],
  [`Watchlist: ${t.watchlist} tokens`, true],
  [t.alertsPerDay === null ? 'Unlimited runner alerts' : `${t.alertsPerDay} runner alerts / day (in-app)`, true],
  ['Exit signals (dev sells, smart money leaves, score drops)', t.exitSignals],
  ['Telegram alerts', t.telegram],
  [t.playbook === 'all' ? 'Full Playbook incl. creator chapters' : t.playbook === 'trader' ? 'Trader Playbook (entries, exits, smart money)' : 'Playbook: ground rules + setup', true],
  ['Priority live-stream coverage when the feed budget is tight', t.priorityFeed],
];

export async function mount(root) {
  const [plans, me] = await Promise.all([api('/api/plans').catch(() => null), getMe().catch(() => null)]);
  const current = me?.plan?.tier ?? null;

  async function buy(tier) {
    if (!me) return navigate('/signup');
    try {
      const r = await api('/api/billing/checkout', { method: 'POST', body: { tier } });
      if (r.url) { location.href = r.url; return; }
      if (r.demo) { toast(`Demo checkout — ${tier === 'apex' ? 'Apex' : 'Runner Pro'} active`, 'good'); navigate('/app/settings'); }
    } catch (e) { toast(e.message, 'error'); }
  }

  const card = (t, hot) => {
    const isCurrent = current === t.tier;
    const cta = t.tier === 'free'
      ? (me ? (isCurrent ? html`<span class="btn ghost is-current">Current plan</span>` : html`<span class="btn ghost is-current">Included</span>`) : html`<a class="btn ghost" href="/signup" data-link>Start free</a>`)
      : isCurrent ? html`<span class="btn ghost is-current">${icon('check', 16)} Current plan</span>`
      : html`<button class="btn ${hot ? 'primary' : 'ghost'}" data-buy="${t.tier}">${me ? `Upgrade — $${t.priceUsd}/mo` : `Get ${t.name}`}</button>`;
    return html`
    <article class="plan ${hot ? 'hot' : ''}" aria-label="${t.name} plan">
      ${hot ? html`<span class="plan-flag">MOST POPULAR</span>` : ''}
      <h2>${t.name}</h2>
      <p class="muted">${t.tagline}</p>
      <p class="price"><b>$${t.priceUsd}</b><span>/month</span></p>
      <ul class="plan-feats">
        ${FEATURES(t).map(([label, on]) => html`<li class="${on ? '' : 'off'}">${icon(on ? 'check' : 'x', 15)}<span>${label}</span></li>`)}
      </ul>
      ${cta}
    </article>`;
  };

  paint(root, html`
  <header class="site-head">
    <div class="wrap row between">
      ${logo()}
      <nav class="row gap" aria-label="Main">
        <a href="/how-it-works" class="navlink hide-sm" data-link>How it works</a>
        ${me ? html`<a class="btn primary" href="/app" data-link>Open app</a>` : html`<a class="navlink" href="/login" data-link>Sign in</a><a class="btn primary" href="/signup" data-link>Get started</a>`}
      </nav>
    </div>
  </header>
  <main class="wrap section">
    <p class="eyebrow">Pricing · monthly, cancel anytime</p>
    <h1 class="pricing-h1">Less than one avoided rug.</h1>
    <p class="lede">Trading terminals take ~1% of every trade — an active trader pays hundreds a month in fees alone. Runner Radar is a flat rate for the intel layer: what to even look at, and when to get out.</p>
    ${plans ? html`<div class="plans">${plans.tiers.map((t) => card(t, t.tier === 'pro'))}</div>` : html`<p class="alert">Couldn't load plans. Refresh to try again.</p>`}
    <div class="pricing-notes">
      <div class="panel"><h2>Straight answers</h2>
        <dl class="faq">
          <dt>Do you guarantee profits?</dt>
          <dd>No — and nobody honestly can. Most meme coins go to zero. Runner Radar filters the obvious ways to lose and ranks what's left; the Playbook gives you the process. Your results depend on your discipline and the market.</dd>
          <dt>How does billing work?</dt>
          <dd>Monthly through Stripe. Cancel anytime from Settings — access runs to the end of the period. We never see your card details.</dd>
          <dt>What happens if I downgrade?</dt>
          <dd>Nothing is deleted. Limits apply again: extra tracked wallets and watchlist entries stay stored but inactive until you trim or re-upgrade.</dd>
          <dt>Is there a free trial of Pro?</dt>
          <dd>Scout is free forever and uses the same live data. Upgrade when the capped alerts start costing you more than $29.</dd>
        </dl>
      </div>
    </div>
  </main>
  <footer class="site-foot wrap">
    <p><strong>Not financial advice.</strong> Meme coins are extremely risky. Filters reduce risk; they can't remove it, and a high score is not a prediction. Only trade what you can afford to lose.</p>
    <p class="row gap"><a href="/terms" data-link>Terms</a><a href="/privacy" data-link>Privacy</a></p>
  </footer>`);

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-buy]');
    if (b) buy(b.dataset.buy);
  });
}
