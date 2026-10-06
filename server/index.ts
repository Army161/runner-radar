import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config as cfg } from './config.ts';
import { openDb } from './db.ts';
import { TokenStore } from './store.ts';
import { PumpPortal } from './sources/pumpportal.ts';
import { DexScreener } from './sources/dexscreener.ts';
import { NoChain, RpcChain } from './sources/chain.ts';
import type { Chain } from './sources/chain.ts';
import { Replay, ReplayChain } from './sources/replay.ts';
import { BudgetedFeed, DemoFeed } from './sources/feed.ts';
import type { TradeFeed } from './sources/feed.ts';
import { Orchestrator } from './agents/orchestrator.ts';
import { AlertEngine, OwnerAlerts, Telegram } from './alerts.ts';
import { Backups } from './backup.ts';
import { Auth } from './http/auth.ts';
import { apiRoutes } from './http/api.ts';
import type { Ctx } from './http/core.ts';
import { HttpError, RateLimiter, Router, clientIp, json, parseCookies, readJsonBody, sameOrigin, securityHeaders, serveStatic } from './http/core.ts';
import { log, onError } from './util.ts';

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const SPA_ROUTES = /^\/(app(\/.*)?|login|signup|onboarding|terms|privacy|how-it-works)\/?$/;

const db = openDb(cfg.dbPath);
const bus = new EventEmitter();
bus.setMaxListeners(100);
const store = new TokenStore(cfg);

let pump: PumpPortal | null = null;
let dex: DexScreener | null = null;
let chain: Chain;
let replay: Replay | null = null;
let feed: TradeFeed;

if (cfg.demo) {
  replay = new Replay(bus);
  chain = new ReplayChain(replay);
  feed = new DemoFeed();
  log.warn('DEMO MODE — simulated tokens, not real market data.');
} else {
  pump = new PumpPortal(cfg.pumpPortalUrl, cfg.pumpPortalKey, bus);
  dex = cfg.dexscreener ? new DexScreener(bus) : null;
  chain = cfg.rpcUrl ? new RpcChain(cfg.rpcUrl, cfg.rpcMaxRps, cfg.jupiter) : new NoChain();
  feed = new BudgetedFeed(pump, cfg, db, bus);
  if (feed.mode === 'free') log.warn('PUMPPORTAL_API_KEY not set — free mode: new launches + DexScreener stats only, no live trade stream.');
  else log.info(`Live trade stream on — daily budget ${cfg.feedBudget.toLocaleString('en-US')} events (≈${(cfg.feedBudget / 1e6).toFixed(2)} SOL).`);
  if (!cfg.rpcUrl) log.warn('SOLANA_RPC_URL not set — contract and honeypot checks will show as pending.');
}

const orch = new Orchestrator({ cfg, db, bus, chain, store, feed, dex, extraSmart: replay?.smartWallets });
const tg = new Telegram(cfg, db);
const alerts = new AlertEngine(cfg, db, bus, tg, orch);
const auth = new Auth(cfg, db);
const owner = new OwnerAlerts(db, tg, cfg.adminEmails);
const backups = cfg.dbPath === ':memory:' ? null : new Backups(db, cfg.dbPath);
onError((msg) => owner.send('error', `Error: ${msg.split('\n')[0]}`));
const limiter = new RateLimiter();

const router = new Router();
auth.routes(router);
apiRoutes(router, { cfg, db, bus, store, orch, tg, alerts, pump, dex, feed, backups });
router.add('GET', '/healthz', () => ({ ok: true }));

const server = createServer(async (req, res) => {
  securityHeaders(res, cfg);
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';
  const ip = clientIp(req, cfg.trustProxy);
  try {
    const hit = router.match(method, url.pathname);
    if (!hit) {
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(404, 'Not found');
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) throw new HttpError(404, 'Not found');
      const path = url.pathname === '/' || SPA_ROUTES.test(url.pathname) ? '/index.html' : url.pathname;
      if (serveStatic(WEB_ROOT, path, res)) return;
      if (serveStatic(WEB_ROOT, '/index.html', res)) return;
      throw new HttpError(404, 'Not found');
    }
    const { route, params } = hit;
    if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req, cfg)) throw new HttpError(403, 'Cross-origin request blocked');
    if (!limiter.allow(route.opts.limit ?? 'api', ip)) throw new HttpError(429, 'Slow down — too many requests');
    const c: Ctx = { req, res, url, ip, params, cookies: parseCookies(req.headers.cookie), user: null, body: undefined };
    c.user = auth.userFromCookie(c);
    if (route.opts.auth && !c.user) throw new HttpError(401, 'Sign in required');
    if (route.opts.body) c.body = await readJsonBody(req);
    const out = await route.handler(c);
    if (out !== undefined && !res.headersSent) json(res, 200, out);
  } catch (e: any) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) log.error(e);
    if (!res.headersSent) json(res, status, { error: status === 500 ? 'Something went wrong' : e.message });
    else res.end();
  }
});

server.listen(cfg.port, cfg.host, () => {
  log.info(`Runner Radar on ${cfg.appUrl} (listening ${cfg.host}:${cfg.port})`);
  const providers = Object.entries(auth.enabledProviders()).filter(([, v]) => v).map(([k]) => k);
  log.info(`Sign-in methods: ${providers.length ? providers.join(', ') : 'none — set GOOGLE/DISCORD/X client IDs or ALLOW_DEV_LOGIN=1 locally'}`);
});

orch.start();
alerts.start();
pump?.start();
dex?.start();
replay?.start();
tg.start();
backups?.start();

// Owner watchdog: pump.fun feed down, trade budget used up, alert-history housekeeping.
let pumpDownSince: number | null = null;
setInterval(() => {
  const now = Date.now();
  if (pump && pump.status !== 'connected') {
    pumpDownSince ??= now;
    if (now - pumpDownSince > 5 * 60_000) owner.send('pump-down', 'The pump.fun feed (PumpPortal) has been disconnected for over 5 minutes. New launches are not being scanned. It keeps retrying on its own.', 60 * 60_000);
  } else if (pumpDownSince) {
    if (now - pumpDownSince > 5 * 60_000) owner.send('pump-up', 'The pump.fun feed is back.', 0);
    pumpDownSince = null;
  }
  const f = feed.status();
  if (f.mode === 'paid' && f.eventsToday >= f.budget) owner.send(`budget-${new Date().toISOString().slice(0, 10)}`, `Today's trade-feed budget is used up (${f.eventsToday.toLocaleString('en-US')} events ≈ ${f.estSolToday} SOL). Only runners and watched tokens stay on the live stream until midnight UTC. Raise FEED_DAILY_EVENTS to cover more.`, 24 * 60 * 60_000);
  db.prepare('DELETE FROM alerts WHERE at < ?').run(now - 30 * 86_400_000);
}, 60_000).unref();

process.on('unhandledRejection', (e) => log.error('Unhandled rejection:', e));
process.on('uncaughtException', (e) => {
  log.error('Crash:', e);
  // Give the owner alert a moment to go out, then exit so the host restarts a clean process.
  setTimeout(() => process.exit(1), 1500).unref();
});

const shutdown = () => {
  log.info('Shutting down');
  pump?.stop(); dex?.stop(); replay?.stop(); tg.stop(); orch.stop(); backups?.stop();
  if (feed instanceof BudgetedFeed) feed.flush();
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
