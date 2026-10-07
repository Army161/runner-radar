import { html, paint, icon, logo } from '../lib.js';
import { getMe } from '../main.js';

const AGENTS = [
  ['Contract auditor', 'gate', 'Mint and freeze authority, Token-2022 extensions that can tax or block transfers.'],
  ['Honeypot simulator', 'gate', 'Proves a token can actually be sold: real sells by other wallets, plus a live sell quote after graduation.'],
  ['Vamp detector', 'gate', 'Catches clones by name, ticker, image fingerprint and reused X accounts. The first one wins.'],
  ['Dev forensics', 'gate', 'Traces the deployer and the wallet that funded it. Every rug it sees is remembered for the next launch.'],
  ['Bundle & sniper scan', 'gate', 'Launch-window buys, look-alike buy sizes, sniper bags, top-10 concentration.'],
  ['Momentum', 'signal', 'Volume, buy/sell balance, new buyers and price move, measured live per trade.'],
  ['Smart money', 'signal', 'Entries and exits by wallets you choose to track, the moment they happen.'],
  ['Narrative', 'signal', 'Linked socials, reused accounts, DexScreener boosts and fresh profiles.'],
  ['Graduation watch', 'signal', 'Bonding-curve progress, how fast it is filling and an ETA to graduation.'],
];

export async function mount(root, params) {
  const me = await getMe().catch(() => null);
  const cta = me ? html`<a class="btn primary lg" href="${me.user.onboarded ? '/app' : '/onboarding'}" data-link>Open scanner</a>`
    : html`<a class="btn primary lg" href="/signup" data-link>Create free account</a><a class="btn ghost lg" href="/login" data-link>Sign in</a>`;

  paint(root, html`
  <header class="site-head">
    <div class="wrap row between">
      ${logo()}
      <nav class="row gap" aria-label="Main">
        <a href="#how" class="navlink hide-sm">How it works</a>
        <a href="#safety" class="navlink hide-sm">Safety</a>
        <a href="/pricing" class="navlink" data-link>Pricing</a>
        ${me ? html`<a class="btn primary" href="/app" data-link>Open app</a>` : html`<a class="navlink" href="/login" data-link>Sign in</a><a class="btn primary" href="/signup" data-link>Get started</a>`}
      </nav>
    </div>
  </header>

  <main>
    <section class="hero wrap">
      <p class="eyebrow">Solana · pump.fun · live</p>
      <h1>Find the runners.<br><span class="accent">Skip the rugs.</span></h1>
      <p class="lede">Nine AI agents check every new meme coin the second it launches. Honeypots, vamps, bundled launches and serial ruggers are blocked before they reach your screen. What survives is ranked by how it is actually trading.</p>
      <div class="row gap wrap-row">${cta}</div>
      <p class="fine">Free to start · Runner Pro $29/mo · <a href="/pricing" data-link>see plans</a>. Sign in with Google, Discord or X. We never ask for your seed phrase or private keys, and we can't trade from your wallet.</p>

      <div class="hero-board" aria-hidden="true">
        <div class="hb-row hb-head"><span>TOKEN</span><span>SAFETY</span><span>SCORE</span></div>
        <div class="hb-row"><span><b>$EXAMPLE</b> runner</span><span class="badge pass">PASS</span><span class="score hi">91</span></div>
        <div class="hb-row"><span><b>$EXAMPLE2</b> clone</span><span class="badge fail">VAMP</span><span class="score lo">—</span></div>
        <div class="hb-row"><span><b>$EXAMPLE3</b> trap</span><span class="badge fail">HONEYPOT</span><span class="score lo">—</span></div>
        <div class="hb-row"><span><b>$EXAMPLE4</b> watching</span><span class="badge warn">WARN</span><span class="score mid">72</span></div>
        <p class="hb-note">Illustration</p>
      </div>
    </section>

    <section id="how" class="wrap section">
      <p class="eyebrow">How it works</p>
      <h2>Gatekeepers first. Then the score.</h2>
      <ol class="pipeline">
        <li><span class="step">1</span><h3>Ingest</h3><p>pump.fun launches, trades and graduations stream in live. DexScreener trending tokens are pulled in every minute.</p></li>
        <li><span class="step warnc">2</span><h3>Gatekeepers</h3><p>Five agents run in parallel. One hard fail blocks the token for good, with the reason shown.</p></li>
        <li><span class="step bluec">3</span><h3>Signals</h3><p>Survivors are scored on momentum, holder health, smart money, narrative and dev reputation.</p></li>
        <li><span class="step limec">4</span><h3>Alerts</h3><p>Runners hit your board and Telegram. Exit signals follow the tokens you were alerted on.</p></li>
      </ol>
      <div class="agent-grid">
        ${AGENTS.map(([name, kind, text]) => html`<article class="agent-card ${kind}"><span class="kind">${kind === 'gate' ? 'GATEKEEPER' : 'SIGNAL'}</span><h3>${name}</h3><p>${text}</p></article>`)}
      </div>
    </section>

    <section id="safety" class="wrap section two-col">
      <div class="panel danger">
        <h2>Instant kill rules</h2>
        <ul class="checks">
          <li>${icon('x', 16)} Sells revert or the token can be frozen</li>
          <li>${icon('x', 16)} Mint authority still live — supply can be printed</li>
          <li>${icon('x', 16)} Clone of a token already trading</li>
          <li>${icon('x', 16)} Deployer or its funder tied to an earlier rug</li>
          <li>${icon('x', 16)} Launch bundled past your limit</li>
        </ul>
      </div>
      <div class="panel">
        <h2>Runner Score</h2>
        <p class="muted">Safety is a gate, never a weight. A dangerous token can't score its way onto your board.</p>
        <ul class="weights">
          <li><span>Momentum</span><b>30%</b></li><li><span>Holder health</span><b>25%</b></li>
          <li><span>Smart money</span><b>20%</b></li><li><span>Narrative</span><b>15%</b></li><li><span>Dev reputation</span><b>10%</b></li>
        </ul>
      </div>
    </section>

    <section class="wrap section cta-band">
      <h2>Your filters. Your alerts.</h2>
      <p class="muted">Pick Degen, Balanced or Strict, fine-tune every limit, link Telegram and track the wallets you trust. Takes about a minute.</p>
      <div class="row gap wrap-row center">${cta}</div>
    </section>
  </main>

  <footer class="site-foot wrap">
    <p><strong>Not financial advice.</strong> Meme coins are extremely risky. Filters reduce risk; they can't remove it, and a high score is not a prediction. Only trade what you can afford to lose.</p>
    <p class="row gap"><a href="/terms" data-link>Terms</a><a href="/privacy" data-link>Privacy</a></p>
  </footer>`);

  if (params.section === 'how') document.getElementById('how')?.scrollIntoView();
}
