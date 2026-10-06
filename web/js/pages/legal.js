import { html, paint, logo } from '../lib.js';

const DOCS = {
  terms: ['Terms of Service', html`
    <p class="alert">Template — replace with terms reviewed for your business and jurisdiction before launch.</p>
    <h2>The service</h2><p>Runner Radar provides automated analysis of public blockchain data. It does not execute trades, hold funds or access your wallet.</p>
    <h2>No financial advice</h2><p>Scores, labels and alerts are informational and can be wrong. Nothing in the service is investment, financial, legal or tax advice. Digital assets, and meme coins especially, are highly volatile and you can lose everything you put in.</p>
    <h2>Third-party data</h2><p>Data comes from third parties such as pump.fun data feeds, Solana RPC providers and DexScreener, which may be delayed, incomplete or unavailable.</p>
    <h2>Your account</h2><p>You sign in through a third-party provider. Keep that account secure. You may delete your Runner Radar account at any time.</p>
    <h2>Contact</h2><p>[YOUR CONTACT EMAIL]</p>`],
  privacy: ['Privacy Policy', html`
    <p class="alert">Template — replace with a policy reviewed for your business and jurisdiction before launch.</p>
    <h2>What we collect</h2><p>From your sign-in provider: an account ID, your display name, profile picture and (Google/Discord only) a verified email. From you: filter settings, tracked wallet addresses, and a Telegram chat ID if you link it.</p>
    <h2>What we don't collect</h2><p>Passwords, seed phrases, private keys or wallet signatures.</p>
    <h2>Cookies</h2><p>One essential, HttpOnly session cookie to keep you signed in, and a short-lived cookie during sign-in to protect against forgery. No advertising or tracking cookies.</p>
    <h2>Deletion</h2><p>Deleting your account removes your profile, settings, tracked wallets and alert history.</p>
    <h2>Contact</h2><p>[YOUR CONTACT EMAIL]</p>`],
};

export async function mount(root, { doc }) {
  const [title, body] = DOCS[doc] ?? DOCS.terms;
  paint(root, html`<header class="site-head"><div class="wrap row between">${logo()}</div></header>
    <main class="wrap section prose"><h1>${title}</h1>${body}</main>`);
}
