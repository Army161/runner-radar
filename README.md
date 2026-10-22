# Runner Radar

A multi-agent Solana meme coin scanner. Every new pump.fun launch runs through six **gatekeeper** agents (one hard fail blocks it, with the reason shown). Survivors are scored by **signal** agents into a 0–100 **Runner Score**. Runners reach your board and Telegram, and exit signals follow the tokens you were alerted on.

Includes a landing page, Google / Discord / X sign-up and login, a 3-step onboarding, the live scanner, token deep-dive pages, a watchlist, an alerts inbox, the Runner Playbook (step-by-step strategy guide), a settings page with billing, Stripe monthly subscriptions, and an admin dashboard with MRR and track record. It installs on a phone home screen as an app.

**Zero dependencies.** Node 22.18+ runs it directly: built-in SQLite, WebSocket, fetch and TypeScript. There's no `npm install`, no build step, and no third-party packages to keep patched.

> Not financial advice. Filters reduce risk; they can't remove it.

---

## Quick start

```bash
node -v            # needs v22.18 or newer
npm run demo       # simulated market + one-click dev login → http://localhost:8787 (works on Windows, macOS, Linux)
npm test           # 36 tests: agents, filters, rug memory, feed budget, backups, OAuth/session security, billing, API
```

Demo mode simulates launches on a real constant-product curve, including honeypots, vamps, bundles, serial ruggers and real runners, so you can see every agent fire. It is clearly labelled in the UI.

## Going live

1. `cp .env.example .env`
2. Set **`SOLANA_RPC_URL`**. Most RPC providers (Helius, QuickNode, Triton…) have a free plan that's enough to start. Without it, the contract and honeypot checks stay "pending".
3. Add at least one **OAuth app** (below).
4. Recommended: **`PUMPPORTAL_API_KEY`** for the live trade stream (see Costs).
5. Set **`ADMIN_EMAILS`** to the email you sign in with. That gives you the Admin page, and owner alerts if you link Telegram.
6. Recommended: **`TYPESAFE_API_KEY`** for the Jev scam judge (see below). Get one at [console.typesafe.ai](https://console.typesafe.ai).
7. Optional: **Telegram** (`TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` from @BotFather) and global `SMART_WALLETS`.
8. `npm install` then `npm start`

### OAuth apps

Register this redirect URI with each provider: `{APP_URL}/auth/{provider}/callback`

| Provider | Where | Notes |
|---|---|---|
| Google | console.cloud.google.com → APIs & Services → Credentials → OAuth client (Web) | Scopes: openid, email, profile |
| Discord | discord.com/developers → Applications → OAuth2 | Scopes: identify, email |
| X | developer.x.com → Project → App → User authentication settings | OAuth 2.0, type **Web App (confidential)**, scopes users.read tweet.read |

## Deploying on Vercel (web) + Render (engine)

Vercel serves the site on your domain; the scanner engine runs on an always-on host behind it. The engine keeps a live pump.fun WebSocket, background agents, and a database on disk. Vercel Functions scale to zero and have no persistent disk, so the engine can't live there. Visitors only ever see your Vercel URL: `/api/*`, `/auth/*` and `/healthz` are proxied to the engine, so cookies, OAuth and Stripe webhooks all stay first-party.

1. Deploy the engine on Render (section below). Note its URL, e.g. `https://runner-radar.onrender.com`.
2. Vercel → **Add New → Project** → import this repo. `vercel.json` handles the build (no framework, no dependencies).
3. Vercel project → **Settings → Environment Variables** → `BACKEND_URL` = the engine URL → redeploy.
4. On the engine (Render → Environment), set:
   - `APP_URL` = your Vercel URL, e.g. `https://runner-radar.vercel.app`, or your custom domain
   - `TRUST_PROXY=2` (visitor → Vercel → Render)
5. Register OAuth redirect URIs on the Vercel URL: `https://<your-vercel-domain>/auth/google/callback`.

Without `BACKEND_URL`, the Vercel site still builds: pages load, and sign-in and data calls return a clear 503 message. Live updates use Server-Sent Events through the proxy and reconnect on their own if the proxy recycles a connection.

**Plans:** Vercel's Hobby plan is for personal, non-commercial use. Move the team to Pro before you charge subscribers.

## Deploying on Render

`render.yaml` is a Render Blueprint: one always-on **Starter** web service with a 1 GB persistent disk for the database. Free Render instances sleep after 15 minutes and can't have disks, so they won't work for a 24/7 scanner.

1. Put this folder in a GitHub repo, with `render.yaml` at the repo root.
2. Render → **New → Blueprint** → pick the repo → **Apply**.
3. Once it's live, copy the service URL (`https://<name>.onrender.com`). Render passes it to the app automatically.
4. Create the OAuth app(s) with redirect `https://<name>.onrender.com/auth/google/callback` (or discord/x).
5. Service → **Environment** → add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SOLANA_RPC_URL`, `ADMIN_EMAILS`, `PUMPPORTAL_API_KEY`, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` → **Save, rebuild and deploy**.
6. In Google Cloud → OAuth consent screen → **Publish app**. Until you do, only test users you list can sign in.

Keep it to a single instance: the token pipeline is in memory, and Render disks are single-instance anyway. Deploys have a few seconds of downtime because of the disk. For a custom domain, add it in Render, then set `APP_URL` and update the OAuth redirect URIs.

Other hosts (Fly.io, Railway, a VPS) work the same way. Run `npm start` on Node 22.18+ with a persistent volume for `DB_PATH`, HTTPS in front, `NODE_ENV=production`, `APP_URL` and `TRUST_PROXY=1`.

## Costs

| Item | What it costs | Notes |
|---|---|---|
| Hosting (Render Starter + 1 GB disk) | ~$7/month plus a small disk fee | Hobby workspace is free |
| PumpPortal live trade stream | 0.01 SOL per 10,000 events | Capped by `FEED_DAILY_EVENTS` (default 50,000/day ≈ 0.05 SOL/day max). Paced evenly through the day. Runners and watched tokens first |
| Solana RPC | free plan to start | Calls are only spent on tokens with 5+ buys, and are rate-limited |
| Jev scam judge (TypeSafe) | ~$0.00005 per token judged | $0.042 per million input tokens, output free. Only tokens that passed the hard gates with Runner Score ≥ 55, at most once per 10 min, capped by `JEV_DAILY_CALLS` (default 5,000/day ≈ $0.25/day max) |
| DexScreener, Jupiter, Telegram | free | |

The scanner header shows today's feed usage ("Feed 12k/50k"). Hover it for the estimated SOL, tokens streaming, and launches skipped to stay on budget.

**How the trade budget is spent:**
- Every new launch is streamed for 30 seconds, long enough to catch bundles, snipers and the first buyers.
- It stays subscribed only if 6+ different wallets bought, and is dropped after 3 minutes with no trades.
- Launches by known ruggers and obvious clones are never streamed.
- Tokens that later heat up on DexScreener (free) are put back on the stream.

**Without a PumpPortal key (free mode),** you still get new launches, graduations, DexScreener trending and 5-minute stats, contract/vamp/dev checks and alerts. But there are no bundle, sniper or holder breakdowns or tracked-wallet signals, so far fewer tokens can qualify as runners. The PumpPortal API key controls a wallet: anyone with the key can trade its funds. Keep only a small balance there.

## Plans & billing

Monthly tiers, enforced server-side (`server/billing.ts` is the source of truth):

| | Scout (free) | Runner Pro $29/mo | Apex $79/mo |
|---|---|---|---|
| Live scanner + safety gates + score | ✓ | ✓ | ✓ |
| Token scans / day | 10 | 100 | 300 |
| Tracked smart wallets | 3 | 25 | 50 |
| Watchlist | 20 | 100 | 200 |
| Runner alerts | 5/day, in-app | unlimited | unlimited |
| Exit signals (dev sells, smart exits, score drop) | — | ✓ | ✓ |
| Telegram delivery | — | ✓ | ✓ |
| Runner Playbook | intro chapters | trader chapters | all incl. creator chapters |
| Priority stream coverage when the feed budget is tight | — | — | ✓ |

**Why these prices:** trading terminals (Photon, BullX, Trojan…) take ~1% per trade — an active trader pays far more than $29/mo in fees alone — and Nansen Pro is $49/mo for smart-money analytics. Runner Pro sits under that as the pump.fun-focused intel layer; Apex is for multi-wallet traders and creators. Change prices anytime with `PRICE_PRO_USD` / `PRICE_APEX_USD` (new Stripe prices are created automatically; existing subscribers keep their old price).

**Stripe setup is one env var.** Set `STRIPE_SECRET_KEY`; on boot the app finds-or-creates the products/prices (by lookup key) and registers the webhook endpoint, storing its signing secret in the database. Webhooks are signature-verified with a 5-minute tolerance. Customers manage/cancel via the Stripe customer portal (enable it once in Stripe → Settings → Billing → Customer portal). Use test keys + card `4242 4242 4242 4242` to try the full flow. In `DEMO=1` mode checkout is simulated so you can click through every state without a Stripe account.

**Honesty guardrail:** no copy in the app promises profits, and the Playbook opens with the ground rules. Tools that promise guaranteed wins invite chargebacks, platform bans and legal trouble — and are lying. Sell the edge, not a fantasy.

## Running it

- **Admin page** (`/app/admin`, visible to `ADMIN_EMAILS` accounts):
  - user counts and the trade feed's spend today
  - the **track record** of every token promoted to RUNNER: % that hit 2× and 5× after the alert, median peak, and how many rugged later
  - last backup and recent errors
- **Owner alerts:** if an admin account links Telegram, it gets a message when the app crashes or logs errors, when the pump.fun feed has been down for 5+ minutes, and when the daily trade budget runs out. Messages are throttled.
- **Backups:** one SQLite backup per UTC day in `backups/` next to the database, keeping the last 7. They sit on the same disk, so also turn on your host's disk snapshots if it offers them.
- **Crashes:** the process logs the error, alerts you, and exits so the host restarts it cleanly. Render does this automatically.
- **CI:** `.github/workflows/test.yml` runs the test suite on every push.

## How it works

```
pump.fun stream (PumpPortal) ─┐                 ┌─ Contract auditor ──┐
DexScreener trending (1/min) ─┼─► token store ─►├─ Honeypot simulator ├─► any FAIL → blocked (+ reason)
Tracked-wallet trades ────────┘                 ├─ Vamp detector      │
Solana RPC + Jupiter (lazy) ───────────────────►├─ Dev forensics      │
                                                ├─ Bundle & sniper    │
                                                └─ Jev scam judge ────┘  (TypeSafe System One, survivors only)
                                                         │ survivors
                    Momentum · Holder health · Smart money · Narrative · Dev reputation · Graduation watch
                                                         │
                                     Orchestrator → Runner Score → board · SSE · Telegram · outcomes
```

| Agent | What it actually checks |
|---|---|
| **Contract auditor** | Mint/freeze authority, SPL vs Token-2022, risky extensions (transfer hook, permanent delegate, transfer fee, default-frozen, non-transferable, pausable) |
| **Honeypot simulator** | Fails on freeze authority or sell-blocking extensions. Passes once ≥2 non-dev wallets have sold. Warns on many buys with zero sells. Graduated tokens get a live Jupiter sell quote. |
| **Vamp detector** | Same name+ticker, same image (IPFS CID) or same X account as an earlier token. The earliest one is the original. |
| **Dev forensics** | Deployer launch and rug history, kept in its own database. Optionally checks the wallet that funded the deployer. Flags early dev dumps. |
| **Bundle & sniper scan** | Supply bought in the launch window, look-alike buy sizes (one buyer, many wallets), sniper bags, top-10 and dev share |
| **Jev scam judge** | Sends the measurements above (never your keys or users' data) to [Jev](https://typesafe.ai), TypeSafe AI's System One decision model, through its official SDK. Jev returns a calibrated scam probability, a 0–3 risk level and the launch pattern (organic, insider, dev dump, copycat, dead, too early). Warns at 60%, blocks at 90%. Creator-written text is labelled untrusted, which makes it harder for a scammer's description to sway the verdict. |
| **Momentum** | 5-minute volume, buy/sell balance, unique buyers, price move, curve velocity |
| **Smart money** | Tracked wallets holding or exiting, via a live account-trade subscription |
| **Narrative** | Socials present, X account reused from another token, DexScreener boost or profile |
| **Graduation watch** | Curve progress, %/5 min and ETA |

**Runner Score** = 30% momentum + 25% holder health + 20% smart money + 15% narrative + 10% dev reputation. Safety is a gate, never a weight. A token is promoted to RUNNER at a score of 80 with 40+ holders and live buying. It stays a runner until the score drops below 70.

**Rug memory:** when a dev sells most of their bag and the price collapses, the deployer and its funder are flagged, and their next launch is blocked automatically. Promoted tokens' outcomes are stored in `outcomes` (`GET /api/stats`) so you can check the weights against real results.

**Cost control:** one shared WebSocket, with a paced daily budget on paid trade events (see Costs). RPC checks run only after a token gets 5 buys, are rate-limited, and are cached. DexScreener is polled once a minute. The browser gets server-sent pushes only when its view changes.

## Data sources, honestly

- **pump.fun:** via PumpPortal's real-time feed. New tokens and migrations are free; trades and wallet trades are paid per event.
- **DexScreener:** public API for trending boosts and profiles on Solana.
- **Solana RPC / Jupiter:** on-chain checks, SOL price, sell quotes.
- **fomo, GMGN, Axiom:** none publish a public API for this data, so the app doesn't scrape them. Each token links straight to GMGN, Axiom, pump.fun and DexScreener for trading. If you get API access later, add a source next to `server/sources/dexscreener.ts` that emits `dex:trending`.
- **KOL / X mentions:** not included, because it needs a paid X API plan. The Narrative agent is where it would plug in.

## Security

- OAuth 2.0 authorization code flow with **PKCE (S256)** and a single-use **state** that is checked against an HttpOnly cookie, which stops login CSRF. The state expires after 10 minutes.
- Accounts are never auto-linked by email across providers, which closes an account-takeover route.
- Sessions are a random 256-bit token in an **HttpOnly, SameSite=Lax** cookie (`__Host-` prefixed and Secure in production). Only its SHA-256 is stored. Sessions slide over 30 days, and logout revokes them server-side.
- Every state-changing request needs a **same-origin** `Origin` header. JSON bodies are size-capped. Requests are rate-limited per IP (auth, scan and API buckets).
- Strict **CSP** (`script-src 'self'`, no inline scripts, no third-party JS), plus `frame-ancestors 'none'`, nosniff, HSTS in production and a tight Permissions-Policy.
- Token names and metadata are attacker-controlled. Every value is HTML-escaped and every link is checked to be http(s).
- The app never asks for seed phrases or private keys and can't move funds.
- Users can delete their account from Settings.

`web/js/pages/legal.js` holds **template** Terms and Privacy pages. Have them reviewed before launch.

## Project layout

```
server/
  index.ts              boot: sources → orchestrator → alerts → HTTP
  agents/               gates.ts · signals.ts · orchestrator.ts · filters.ts (per-user presets/limits) · jev.ts (TypeSafe Jev judge)
  sources/              pumpportal.ts · dexscreener.ts · chain.ts (RPC/Jupiter) · metadata.ts · replay.ts (demo)
  http/                 core.ts (router, headers, rate limit) · auth.ts (OAuth + sessions) · api.ts (REST + SSE) · views.ts
  alerts.ts             Telegram bot + alert engine
  test/                 node:test suites
  backup.ts             daily SQLite backups
  billing.ts            Stripe REST client, tiers + entitlements, webhook verify
  playbook.ts           the Runner Playbook content (mirrored at docs/PLAYBOOK.md)
  demo.ts               cross-platform `npm run demo` entry
scripts/vercel-build.mjs  Vercel Build Output: static web + proxy to BACKEND_URL
web/                    plain ES modules: shell.js (app frame, alerts inbox) · parts.js (shared table/filters)
  js/pages/             landing · auth · onboarding · scanner · token · watchlist · settings · admin · legal
```
