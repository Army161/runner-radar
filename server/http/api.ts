import type { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import type { Config } from '../config.ts';
import type { DB } from '../db.ts';
import type { Orchestrator } from '../agents/orchestrator.ts';
import type { TokenStore } from '../store.ts';
import type { AlertEngine, Telegram } from '../alerts.ts';
import type { PumpPortal } from '../sources/pumpportal.ts';
import type { DexScreener } from '../sources/dexscreener.ts';
import type { TradeFeed } from '../sources/feed.ts';
import type { Backups } from '../backup.ts';
import { recentErrors } from '../util.ts';
import type { FeedItem } from '../types.ts';
import type { Ctx, Router } from './core.ts';
import { HttpError, json } from './core.ts';
import { loadSettings } from '../alerts.ts';
import { PRESETS, evaluateFor, sanitizeSettings } from '../agents/filters.ts';
import { TABS, blockedFor, detailOf, listFor, rowOf } from './views.ts';
import type { Tab } from './views.ts';
import { isBase58Address, str } from '../util.ts';

interface Deps {
  cfg: Config; db: DB; bus: EventEmitter; store: TokenStore; orch: Orchestrator; tg: Telegram; alerts: AlertEngine;
  pump: PumpPortal | null; dex: DexScreener | null; feed: TradeFeed; backups: Backups | null;
}

interface Client { userId: string; res: ServerResponse; tab: Tab; win: string; last: string }

export function apiRoutes(r: Router, d: Deps) {
  const { cfg, db, store, orch } = d;
  const view = () => ({ cfg, solUsd: orch.solUsd, now: Date.now() });
  const tabOf = (s: string | null): Tab => (TABS.includes(s as Tab) ? (s as Tab) : 'trending');
  const winOf = (s: string | null) => (['1m', '5m', '1h', '24h'].includes(s ?? '') ? s! : '5m');
  const me = (c: Ctx) => c.user!;
  const isAdmin = (c: Ctx) => {
    const u = c.user;
    if (!u) return false;
    if (u.email && cfg.adminEmails.includes(u.email.toLowerCase())) return true;
    return cfg.allowDevLogin && !!db.prepare("SELECT 1 FROM oauth_accounts WHERE user_id = ? AND provider = 'dev'").get(u.id);
  };
  const touch = db.prepare('UPDATE users SET last_seen = ? WHERE id = ?');

  const refreshWallets = () => {
    const rows = db.prepare('SELECT DISTINCT address FROM tracked_wallets').all() as Array<{ address: string }>;
    orch.setUserWallets(rows.map((x) => x.address));
  };
  refreshWallets();

  r.add('GET', '/api/status', () => ({
    demo: cfg.demo,
    sources: {
      pumpfun: cfg.demo ? 'demo' : d.pump?.status ?? 'off',
      dexscreener: cfg.demo ? 'demo' : d.dex?.status ?? 'off',
      rpc: cfg.demo ? 'demo' : cfg.rpcUrl ? 'connected' : 'off',
      telegram: d.tg.enabled ? 'connected' : 'off',
    },
    feed: d.feed.status(),
    telegramBot: cfg.telegramBot || null,
    watching: store.size,
    solUsd: orch.solUsd,
  }));

  r.add('GET', '/api/me', (c) => {
    const u = me(c);
    const tg = db.prepare('SELECT linked_at FROM telegram_links WHERE user_id = ?').get(u.id);
    const wallets = db.prepare('SELECT address, label FROM tracked_wallets WHERE user_id = ? ORDER BY address').all(u.id);
    const providers = db.prepare('SELECT provider FROM oauth_accounts WHERE user_id = ?').all(u.id).map((x: any) => x.provider);
    touch.run(Date.now(), u.id);
    return { user: { id: u.id, name: u.name, email: u.email, avatar: u.avatar, onboarded: !!u.onboarded, providers, admin: isAdmin(c) }, settings: loadSettings(db, u.id), telegramLinked: !!tg, wallets, presets: PRESETS };
  }, { auth: true });

  r.add('PUT', '/api/settings', (c) => {
    const u = me(c);
    const next = sanitizeSettings(c.body, loadSettings(db, u.id));
    db.prepare('INSERT INTO settings (user_id, json) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json').run(u.id, JSON.stringify(next));
    d.alerts.invalidate();
    return { settings: next };
  }, { auth: true, body: true });

  r.add('POST', '/api/onboarding/complete', (c) => {
    db.prepare('UPDATE users SET onboarded = 1 WHERE id = ?').run(me(c).id);
    d.alerts.invalidate();
    return { ok: true };
  }, { auth: true });

  r.add('POST', '/api/wallets', (c) => {
    const address = str(c.body?.address, 60).trim();
    if (!isBase58Address(address)) throw new HttpError(400, 'That is not a valid Solana address');
    const count = (db.prepare('SELECT COUNT(*) AS n FROM tracked_wallets WHERE user_id = ?').get(me(c).id) as { n: number }).n;
    if (count >= 50) throw new HttpError(400, 'Up to 50 tracked wallets');
    db.prepare('INSERT OR IGNORE INTO tracked_wallets (user_id, address, label) VALUES (?, ?, ?)').run(me(c).id, address, str(c.body?.label, 40));
    refreshWallets();
    return { ok: true };
  }, { auth: true, body: true });

  r.add('DELETE', '/api/wallets/:address', (c) => {
    db.prepare('DELETE FROM tracked_wallets WHERE user_id = ? AND address = ?').run(me(c).id, c.params.address);
    refreshWallets();
    return { ok: true };
  }, { auth: true });

  r.add('POST', '/api/telegram/code', (c) => {
    if (!d.tg.enabled) throw new HttpError(400, 'Telegram alerts are not configured on this server');
    return d.tg.newLinkCode(me(c).id);
  }, { auth: true });

  r.add('DELETE', '/api/telegram', (c) => { db.prepare('DELETE FROM telegram_links WHERE user_id = ?').run(me(c).id); return { ok: true }; }, { auth: true });

  r.add('GET', '/api/tokens', (c) => {
    const s = loadSettings(db, me(c).id);
    return listFor(store.all(), s, tabOf(c.url.searchParams.get('tab')), winOf(c.url.searchParams.get('window')), view());
  }, { auth: true });

  r.add('GET', '/api/blocked', (c) => ({ items: blockedFor(store.all(), loadSettings(db, me(c).id), view()) }), { auth: true });

  r.add('GET', '/api/token/:mint', (c) => {
    const t = store.get(c.params.mint);
    if (!t) throw new HttpError(404, 'Not tracked right now — paste the address in search to scan it');
    const s = loadSettings(db, me(c).id);
    const verdict = t.gates.contract ? evaluateFor(t, s, cfg, orch.solUsd, Number(t.signals.smart?.metrics?.holding ?? 0)) : null;
    const watching = !!db.prepare('SELECT 1 FROM watchlist WHERE user_id = ? AND mint = ?').get(me(c).id, t.mint);
    return { ...detailOf(t, view(), verdict, orch.smart), watching };
  }, { auth: true });

  r.add('POST', '/api/scan', async (c) => {
    const mint = str(c.body?.mint, 60).trim();
    if (!isBase58Address(mint)) throw new HttpError(400, 'Paste a valid Solana token address');
    const t = await orch.scan(mint, 'user');
    if (!t) throw new HttpError(404, 'Token not found');
    orch.evaluate(t);
    return { mint: t.mint };
  }, { auth: true, body: true, limit: 'scan' });

  r.add('POST', '/api/watchlist/:mint', (c) => {
    if (!isBase58Address(c.params.mint)) throw new HttpError(400, 'Bad address');
    const count = (db.prepare('SELECT COUNT(*) AS n FROM watchlist WHERE user_id = ?').get(me(c).id) as { n: number }).n;
    if (count >= 200) throw new HttpError(400, 'Up to 200 tokens on your watchlist');
    db.prepare('INSERT OR IGNORE INTO watchlist (user_id, mint, added_at, symbol) VALUES (?, ?, ?, ?)').run(me(c).id, c.params.mint, Date.now(), store.get(c.params.mint)?.symbol ?? null);
    return { ok: true };
  }, { auth: true });

  r.add('DELETE', '/api/watchlist/:mint', (c) => {
    db.prepare('DELETE FROM watchlist WHERE user_id = ? AND mint = ?').run(me(c).id, c.params.mint);
    return { ok: true };
  }, { auth: true });

  r.add('GET', '/api/feed', () => ({ items: orch.feed.slice(-60).reverse() }), { auth: true });

  r.add('GET', '/api/watchlist', (c) => {
    const rows = db.prepare('SELECT mint, symbol, added_at FROM watchlist WHERE user_id = ? ORDER BY added_at DESC').all(me(c).id) as Array<{ mint: string; symbol: string | null; added_at: number }>;
    const v = view();
    return {
      items: rows.map((w) => {
        const t = store.get(w.mint);
        return t ? { ...rowOf(t, '5m', v), addedAt: w.added_at, tracked: true } : { mint: w.mint, symbol: w.symbol ?? w.mint.slice(0, 4), addedAt: w.added_at, tracked: false };
      }),
    };
  }, { auth: true });

  r.add('GET', '/api/alerts', (c) => {
    const items = db.prepare('SELECT id, mint, symbol, title, body, at, read FROM alerts WHERE user_id = ? ORDER BY at DESC LIMIT 50').all(me(c).id);
    const unread = (db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE user_id = ? AND read = 0').get(me(c).id) as { n: number }).n;
    return { items, unread };
  }, { auth: true });

  r.add('POST', '/api/alerts/read', (c) => { db.prepare('UPDATE alerts SET read = 1 WHERE user_id = ? AND read = 0').run(me(c).id); return { ok: true }; }, { auth: true });

  r.add('GET', '/api/admin', (c) => {
    if (!isAdmin(c)) throw new HttpError(403, 'Admins only');
    const now = Date.now();
    const days = Math.min(365, Math.max(1, Number(c.url.searchParams.get('days')) || 30));
    const since = now - days * 86_400_000;
    const one = (sql: string, ...p: any[]) => Number((db.prepare(sql).get(...p) as any)?.n ?? 0);
    const outcomes = db.prepare('SELECT mint, symbol, promoted_at, score, mcap_at_promote, peak_mcap, last_mcap, rugged FROM outcomes WHERE promoted_at >= ? ORDER BY promoted_at DESC').all(since) as any[];
    const mult = outcomes.map((o) => (o.mcap_at_promote > 0 ? o.peak_mcap / o.mcap_at_promote : 1)).sort((a, b) => a - b);
    const pct = (k: number) => (outcomes.length ? Math.round((100 * outcomes.filter((o) => o.mcap_at_promote > 0 && o.peak_mcap / o.mcap_at_promote >= k).length) / outcomes.length) : null);
    return {
      users: {
        total: one('SELECT COUNT(*) AS n FROM users'),
        onboarded: one('SELECT COUNT(*) AS n FROM users WHERE onboarded = 1'),
        new7d: one('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', now - 7 * 86_400_000),
        active24h: one('SELECT COUNT(*) AS n FROM users WHERE last_seen >= ?', now - 86_400_000),
        telegram: one('SELECT COUNT(*) AS n FROM telegram_links'),
        alerts24h: one('SELECT COUNT(*) AS n FROM alerts WHERE at >= ?', now - 86_400_000),
      },
      trackRecord: {
        days, promoted: outcomes.length,
        hit2x: pct(2), hit5x: pct(5),
        medianPeak: mult.length ? Math.round(mult[Math.floor(mult.length / 2)] * 100) / 100 : null,
        rugRate: outcomes.length ? Math.round((100 * outcomes.filter((o) => o.rugged).length) / outcomes.length) : null,
        recent: outcomes.slice(0, 25).map((o) => ({ mint: o.mint, symbol: o.symbol, at: o.promoted_at, score: o.score, peakX: o.mcap_at_promote > 0 ? Math.round((o.peak_mcap / o.mcap_at_promote) * 100) / 100 : null, nowX: o.mcap_at_promote > 0 ? Math.round((o.last_mcap / o.mcap_at_promote) * 100) / 100 : null, rugged: !!o.rugged })),
      },
      pipeline: { watching: store.size, ruggersKnown: one('SELECT COUNT(*) AS n FROM wallets_rep WHERE rugs > 0'), deployersSeen: one('SELECT COUNT(*) AS n FROM wallets_rep WHERE launches > 0') },
      feed: d.feed.status(),
      backups: d.backups?.status() ?? null,
      errors: [...recentErrors].reverse().slice(0, 20),
      uptimeSec: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1e6),
    };
  }, { auth: true });

  r.add('GET', '/api/stats', () => {
    const rows = db.prepare('SELECT COUNT(*) AS n, SUM(rugged) AS rugs, AVG(peak_mcap / mcap_at_promote) AS avgPeakX FROM outcomes').get() as any;
    return { promoted: rows.n ?? 0, rugged: rows.rugs ?? 0, avgPeakMultiple: rows.avgPeakX ? Math.round(rows.avgPeakX * 100) / 100 : null };
  }, { auth: true });

  r.add('DELETE', '/api/account', (c) => {
    db.prepare('DELETE FROM users WHERE id = ?').run(me(c).id);
    refreshWallets();
    return { ok: true };
  }, { auth: true });

  // ---------- live stream (Server-Sent Events) ----------
  const clients = new Set<Client>();

  const pushList = (cl: Client) => {
    const s = loadSettings(db, cl.userId);
    const data = JSON.stringify(listFor(store.all(), s, cl.tab, cl.win, view()));
    if (data === cl.last) return;
    cl.last = data;
    cl.res.write(`event: tokens\ndata: ${data}\n\n`);
  };

  setInterval(() => { for (const cl of clients) pushList(cl); }, 2000).unref();
  setInterval(() => { for (const cl of clients) cl.res.write(': ping\n\n'); }, 25_000).unref();
  d.bus.on('feed', (f: FeedItem) => { const msg = `event: feed\ndata: ${JSON.stringify(f)}\n\n`; for (const cl of clients) cl.res.write(msg); });
  d.bus.on('userAlert', (a: { userId: string }) => {
    const msg = `event: alert\ndata: ${JSON.stringify(a)}\n\n`;
    for (const cl of clients) if (cl.userId === a.userId) cl.res.write(msg);
  });

  r.add('GET', '/api/stream', (c) => {
    const userId = me(c).id;
    if ([...clients].filter((x) => x.userId === userId).length >= 5) throw new HttpError(429, 'Too many open streams');
    c.res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    c.res.write('retry: 3000\n\n');
    const cl: Client = { userId, res: c.res, tab: tabOf(c.url.searchParams.get('tab')), win: winOf(c.url.searchParams.get('window')), last: '' };
    clients.add(cl);
    pushList(cl);
    c.req.on('close', () => clients.delete(cl));
    return undefined;
  }, { auth: true });
}
