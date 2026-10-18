import { html, paint, logo } from '../lib.js';

const UPDATED = 'October 18, 2026';
// Shown as the contact point in both documents. Swap for a dedicated support address when you have one.
const CONTACT = '[SUPPORT EMAIL]';

const DOCS = {
  terms: ['Terms of Service', html`
    <p class="muted">Last updated: ${UPDATED}</p>

    <p>These Terms of Service ("Terms") are an agreement between you and the operator of Runner Radar ("Runner Radar", "we", "us"). By creating an account or using runnerradar's websites and applications (the "Service"), you agree to these Terms. If you do not agree, do not use the Service.</p>

    <h2>1. What the Service is — and is not</h2>
    <p>Runner Radar provides automated, informational analysis of publicly available blockchain and market data: screening, scoring, alerts and educational content. The Service <strong>does not</strong> execute trades, hold or transmit funds, provide wallet custody, or ask for your seed phrase or private keys.</p>
    <p><strong>Not financial advice.</strong> Nothing in the Service — including the Runner Score, safety gates, alerts and the Playbook — is investment, financial, legal or tax advice, or a recommendation to buy or sell any asset. We are not a broker, dealer, exchange or investment adviser. Scores and labels are automated estimates that can be wrong, delayed or incomplete.</p>
    <p><strong>No performance promises.</strong> We make no guarantee of profit or protection from loss. Digital assets — meme coins especially — are extremely volatile; most lose their entire value. You are solely responsible for your decisions, and you should never risk money you cannot afford to lose.</p>

    <h2>2. Eligibility and your account</h2>
    <p>You must be at least 18 years old and able to form a binding contract. You sign in through a third-party provider (Google, Discord or X); keep that account secure, and tell us about any unauthorized use. You are responsible for activity under your account. One account per person; don't share accounts or resell access.</p>

    <h2>3. Subscriptions and billing</h2>
    <p>Paid plans are billed monthly in advance through Stripe and renew automatically until cancelled. You can cancel anytime in Settings; access continues to the end of the paid period, and no further charges are made. Except where the law requires otherwise, fees already paid are non-refundable. We may change prices with at least 30 days' notice; changes apply from your next renewal. Taxes may be added where required. If a payment fails, we may downgrade the account after a grace period.</p>

    <h2>4. Acceptable use</h2>
    <p>You agree not to: (a) use the Service for anything unlawful, including market manipulation or fraud; (b) scrape, bulk-export, resell or redistribute the Service's data or alerts; (c) probe, overload, or interfere with the Service or evade rate limits and plan limits; (d) reverse engineer the Service except where the law permits; (e) misrepresent your identity or impersonate others. We may suspend or terminate accounts that violate these Terms.</p>

    <h2>5. Third-party data and links</h2>
    <p>The Service relies on third-party sources (such as pump.fun data feeds, Solana RPC providers, DexScreener and Jupiter) that may be inaccurate, delayed or unavailable; we are not responsible for them. Links to external sites — including links found in token metadata — are provided for convenience and are not endorsements. Token metadata is created by unknown third parties and may be deceptive.</p>

    <h2>6. Intellectual property</h2>
    <p>The Service, including its software, design and content, belongs to us or our licensors. We grant you a limited, revocable, non-transferable license to use it for your own purposes under these Terms. If you send us feedback, we may use it without obligation to you.</p>

    <h2>7. Disclaimers</h2>
    <p>THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE", WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, ACCURACY AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, TIMELY, SECURE OR ERROR-FREE, OR THAT ANY TOKEN FLAGGED AS SAFE OR SCORED HIGHLY WILL PERFORM IN ANY WAY.</p>

    <h2>8. Limitation of liability</h2>
    <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, LOST DATA OR TRADING LOSSES, ARISING FROM OR RELATING TO THE SERVICE. OUR TOTAL LIABILITY FOR ALL CLAIMS WILL NOT EXCEED THE GREATER OF (A) THE FEES YOU PAID US IN THE 12 MONTHS BEFORE THE CLAIM AROSE, OR (B) US $100. Some jurisdictions do not allow certain limitations, so parts of this section may not apply to you.</p>

    <h2>9. Indemnification</h2>
    <p>You will defend and hold us harmless from claims arising out of your use of the Service, your trading decisions, or your violation of these Terms or applicable law.</p>

    <h2>10. Termination</h2>
    <p>You may stop using the Service or delete your account (Settings → Delete account) at any time. We may suspend or terminate access for breach of these Terms, legal requirements, or risk to the Service, with refund of any unused prepaid period only where the termination was not caused by your breach. Sections 5–11 survive termination.</p>

    <h2>11. General</h2>
    <p>These Terms are governed by the laws of the State of Ohio, USA, without regard to conflict-of-law rules, and disputes will be resolved in the state or federal courts located in Ohio, except where your local consumer law provides otherwise. We may update these Terms; material changes will be announced in the Service at least 14 days before taking effect, and continued use after that constitutes acceptance. If any provision is unenforceable, the rest remain in effect. These Terms are the entire agreement between us regarding the Service.</p>

    <h2>12. Contact</h2>
    <p>Questions about these Terms: ${CONTACT}</p>`],

  privacy: ['Privacy Policy', html`
    <p class="muted">Last updated: ${UPDATED}</p>

    <p>This policy explains what Runner Radar ("we", "us") collects, why, and your choices. We built the Service to collect as little as possible.</p>

    <h2>1. What we collect</h2>
    <p><strong>Account data</strong> from the sign-in provider you choose (Google, Discord or X): a provider account ID, your display name, profile picture, and — from Google and Discord — your verified email address. We never see or store a password.</p>
    <p><strong>Things you add:</strong> filter settings, tracked wallet addresses, your watchlist, and your in-app alert history.</p>
    <p><strong>Billing data:</strong> payments are processed by Stripe. We store only your Stripe customer ID, subscription ID, plan and billing status — never card numbers. Stripe's handling of your payment details is covered by Stripe's own privacy policy.</p>
    <p><strong>Telegram:</strong> if you link Telegram for alerts, we store the chat ID needed to message you. Unlink anytime in Settings.</p>
    <p><strong>Technical data:</strong> IP addresses are used transiently for rate limiting and abuse prevention and appear in short-lived server logs. We use no advertising or analytics trackers.</p>

    <h2>2. What we do with it</h2>
    <p>We use this data to run the Service: signing you in, applying your filters, delivering alerts, processing subscriptions, preventing abuse, and fixing problems. We do <strong>not</strong> sell or rent your personal data, and we don't use it for third-party advertising.</p>

    <h2>3. Who it's shared with</h2>
    <p>Only service providers that host and operate the Service — our hosting providers, Stripe (payments), Telegram (if you link it), and your chosen sign-in provider — each receiving only what they need. We may also disclose data if the law requires it, or to protect the Service and its users. Public blockchain data shown in the app (wallet addresses, trades) is already public and is not tied to your identity by us.</p>

    <h2>4. Cookies and local storage</h2>
    <p>We use one essential, HttpOnly session cookie to keep you signed in and one short-lived cookie during sign-in to protect against forgery. Your browser's local storage remembers interface preferences (like your selected tab). No advertising or cross-site tracking cookies.</p>

    <h2>5. Retention and deletion</h2>
    <p>Account data is kept while your account exists. Alert history is deleted after 30 days. Server backups age out within 7 days. Deleting your account (Settings → Delete account) immediately removes your profile, settings, tracked wallets, watchlist, alert history and subscription records from the live database; backup copies expire within 7 days. Stripe retains transaction records as required by financial regulations.</p>

    <h2>6. Security</h2>
    <p>All traffic is encrypted in transit (HTTPS). Session tokens are stored only as cryptographic hashes, sign-in uses industry-standard OAuth with PKCE, and the Service never asks for seed phrases or private keys. No system is perfectly secure; if a breach affects your data, we will notify you as the law requires.</p>

    <h2>7. Your rights</h2>
    <p>You can access most of your data directly in the app and delete your account yourself at any time. Depending on where you live (for example, under the GDPR or the California Consumer Privacy Act) you may also have rights to access, correct, export or delete personal data, and to complain to a supervisory authority. To exercise any of these, contact us at ${CONTACT} and we will respond within the time the law requires.</p>

    <h2>8. Children</h2>
    <p>The Service is for adults 18 and over. We do not knowingly collect data from anyone under 18; if we learn we have, we will delete it.</p>

    <h2>9. International users</h2>
    <p>The Service is operated from the United States, and data is processed on servers in the United States. By using the Service you understand your data is transferred to and processed in the US.</p>

    <h2>10. Changes and contact</h2>
    <p>If this policy changes materially, we will announce it in the Service before the change takes effect. Questions or requests: ${CONTACT}</p>`],
};

export async function mount(root, { doc }) {
  const [title, body] = DOCS[doc] ?? DOCS.terms;
  paint(root, html`<header class="site-head"><div class="wrap row between">${logo()}</div></header>
    <main class="wrap section prose"><h1>${title}</h1>${body}</main>`);
}
