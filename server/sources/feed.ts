import type { EventEmitter } from 'node:events';
import type { Config } from '../config.ts';
import type { DB } from '../db.ts';
import type { TokenState } from '../types.ts';
import type { PumpPortal } from './pumpportal.ts';
import { getRep } from '../db.ts';

/**
 * Decides which tokens get a live trade subscription. PumpPortal bills trade and
 * wallet streams per event (0.01 SOL per 10,000 at the time of writing), so this is where
 * the money is spent. The other agents never subscribe directly.
 *
 *  - Every new launch gets a short trial (bundles, snipers and first buyers happen in seconds).
 *  - It stays subscribed only if it shows real traction, and is dropped when it goes quiet.
 *  - Spending is paced across the UTC day against a daily event budget, so coverage
 *    stays even instead of running out at noon. Runners and watched tokens always come first.
 */
export interface TradeFeed {
  readonly mode: 'paid' | 'free' | 'demo';
  onCreated(t: TokenState): void;
  consider(t: TokenState, why: 'scan' | 'traction'): boolean;
  isSubscribed(mint: string): boolean;
  wantWallets(wallets: string[]): void;
  dropped(mints: string[]): void;
  tick(tokens: Iterable<TokenState>): void;
  status(): FeedStatus;
}

export interface FeedStatus {
  mode: TradeFeed['mode']; eventsToday: number; budget: number; paceLimit: number;
  estSolToday: number; subscribed: number; maxSubs: number; skippedToday: number;
}

const SOL_PER_EVENT = 0.01 / 10_000;
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

interface Sub { since: number; trial: boolean }

export class BudgetedFeed implements TradeFeed {
  readonly mode: 'paid' | 'free';
  private pump: PumpPortal;
  private cfg: Config;
  private db: DB;
  private now: () => number;
  private subs = new Map<string, Sub>();
  private day: string;
  private events = 0;
  private skipped = 0;
  private dirtyMeter = false;
  private wallets: string[] = [];

  constructor(pump: PumpPortal, cfg: Config, db: DB, bus: EventEmitter, now: () => number = Date.now) {
    this.pump = pump; this.cfg = cfg; this.db = db; this.now = now;
    this.mode = cfg.pumpPortalKey ? 'paid' : 'free';
    db.exec('CREATE TABLE IF NOT EXISTS feed_meter (day TEXT PRIMARY KEY, events INTEGER NOT NULL)');
    this.day = day(now());
    const row = db.prepare('SELECT events FROM feed_meter WHERE day = ?').get(this.day) as { events: number } | undefined;
    this.events = row?.events ?? 0;
    bus.on('trade', () => { this.rollDay(); this.events++; this.dirtyMeter = true; });
  }

  private rollDay() {
    const d = day(this.now());
    if (d === this.day) return;
    this.flush();
    this.day = d; this.events = 0; this.skipped = 0;
  }

  flush() {
    if (!this.dirtyMeter) return;
    this.db.prepare('INSERT INTO feed_meter (day, events) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET events = excluded.events').run(this.day, this.events);
    this.dirtyMeter = false;
  }

  /** Budget available so far today: spread evenly over 24h, plus 5% of the day's budget as burst room. */
  paceLimit(): number {
    const t = this.now();
    const sinceMidnight = (t - Date.parse(`${day(t)}T00:00:00Z`)) / 86_400_000;
    return Math.round(this.cfg.feedBudget * Math.min(1, sinceMidnight + 0.05));
  }

  private canSpend(level: 'trial' | 'traction' | 'priority'): boolean {
    if (this.mode !== 'paid') return false;
    this.rollDay();
    if (level === 'priority') return this.events < this.cfg.feedBudget * 1.1;
    if (this.subs.size >= this.cfg.feedMaxSubs) return false;
    const limit = this.paceLimit();
    return level === 'trial' ? this.events < limit * 0.8 : this.events < limit;
  }

  private sub(mint: string, trial: boolean) {
    this.subs.set(mint, { since: this.now(), trial });
    this.pump.watch([mint]);
  }

  private unsub(mints: string[]) {
    const gone = mints.filter((m) => this.subs.delete(m));
    if (gone.length) this.pump.unwatch(gone);
  }

  onCreated(t: TokenState) {
    // Free pre-checks first: no money on deployers we already know rugged.
    const rep = t.creator ? getRep(this.db, t.creator) : null;
    if ((rep?.rugs ?? 0) > 0) { this.skipped++; return; }
    if (this.canSpend('trial')) this.sub(t.mint, true); else this.skipped++;
  }

  consider(t: TokenState, why: 'scan' | 'traction'): boolean {
    if (this.subs.has(t.mint)) return true;
    if (t.status === 'blocked') return false;
    if (!this.canSpend(why === 'scan' ? 'priority' : 'traction')) return false;
    this.sub(t.mint, false);
    return true;
  }

  isSubscribed(mint: string) { return this.mode === 'demo' || this.subs.has(mint); }

  wantWallets(wallets: string[]) {
    this.wallets = wallets.slice(0, this.cfg.feedMaxWallets);
    if (this.mode === 'paid') this.pump.watchWallets(this.wallets);
  }

  dropped(mints: string[]) { this.unsub(mints); }

  private watchedMints(): Set<string> {
    const rows = this.db.prepare('SELECT DISTINCT mint FROM watchlist').all() as Array<{ mint: string }>;
    return new Set(rows.map((r) => r.mint));
  }

  tick(tokens: Iterable<TokenState>) {
    if (this.mode !== 'paid') return;
    this.rollDay();
    const now = this.now();
    const watched = this.watchedMints();
    const byMint = new Map<string, TokenState>();
    for (const t of tokens) byMint.set(t.mint, t);
    const overBudget = this.events >= this.cfg.feedBudget;
    const drop: string[] = [];
    for (const [mint, s] of this.subs) {
      const t = byMint.get(mint);
      if (!t) { drop.push(mint); continue; }
      const priority = t.status === 'runner' || watched.has(mint);
      if (priority) { s.trial = false; continue; }
      if (overBudget || t.status === 'blocked') { drop.push(mint); continue; }
      if (s.trial && now - s.since >= this.cfg.feedTrialMs) {
        const buyers = [...t.firstBuyAt.keys()].filter((w) => w !== t.creator).length;
        if (buyers >= this.cfg.feedTractionBuyers) s.trial = false; else drop.push(mint);
        continue;
      }
      if (!s.trial && now - t.lastActivity > this.cfg.feedCoolMs) drop.push(mint);
    }
    this.unsub(drop);
    // Make sure runners and watched tokens are covered (budget allowing).
    for (const t of byMint.values()) {
      if (!this.subs.has(t.mint) && (t.status === 'runner' || watched.has(t.mint)) && this.canSpend('priority')) this.sub(t.mint, false);
    }
    if (overBudget && this.wallets.length) this.pump.watchWallets([]);
    else if (!overBudget) this.pump.watchWallets(this.wallets);
    this.flush();
  }

  status(): FeedStatus {
    this.rollDay();
    return {
      mode: this.mode, eventsToday: this.events, budget: this.cfg.feedBudget, paceLimit: this.paceLimit(),
      estSolToday: Math.round(this.events * SOL_PER_EVENT * 1e6) / 1e6,
      subscribed: this.subs.size, maxSubs: this.cfg.feedMaxSubs, skippedToday: this.skipped,
    };
  }
}

/** Demo mode: the simulator streams everything, nothing is billed. */
export class DemoFeed implements TradeFeed {
  readonly mode = 'demo' as const;
  onCreated() {}
  consider() { return true; }
  isSubscribed() { return true; }
  wantWallets() {}
  dropped() {}
  tick() {}
  status(): FeedStatus { return { mode: 'demo', eventsToday: 0, budget: 0, paceLimit: 0, estSolToday: 0, subscribed: 0, maxSubs: 0, skippedToday: 0 }; }
}
