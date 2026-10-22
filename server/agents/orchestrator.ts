import type { EventEmitter } from 'node:events';
import type { Config } from '../config.ts';
import type { DB } from '../db.ts';
import { bumpLaunch, getRep, markRug, setFunder } from '../db.ts';
import type { CreateEvent, FeedItem, MigrateEvent, TokenState, TradeEvent } from '../types.ts';
import type { Chain } from '../sources/chain.ts';
import type { DexInfo, DexScreener } from '../sources/dexscreener.ts';
import type { TradeFeed } from '../sources/feed.ts';
import { fetchMetadata } from '../sources/metadata.ts';
import { TokenStore, blankToken, short } from '../store.ts';
import { GATE_TAGS, holderMetrics, runGates } from './gates.ts';
import type { VampMatch } from './gates.ts';
import { devReputation, graduationWatch, holderHealth, momentum, narrative, runnerScore, smartMoney } from './signals.ts';
import { jevGate } from './jev.ts';
import type { JevJudge } from './jev.ts';
import { WorkQueue, imageKey, log, normName, twitterHandle } from '../util.ts';

interface Deps {
  cfg: Config; db: DB; bus: EventEmitter; chain: Chain; store: TokenStore;
  feed: TradeFeed; dex: DexScreener | null; extraSmart?: string[];
  /** Jev scam judge (TypeSafe System One). Optional: off without TYPESAFE_API_KEY. */
  jev?: JevJudge | null;
}

interface IndexEntry { mint: string; symbol: string; at: number }

const AGENT_NAMES: Record<string, string> = { contract: 'CONTRACT AUDITOR', honeypot: 'HONEYPOT SIM', vamp: 'VAMP DETECTOR', dev: 'DEV FORENSICS', jev: 'JEV SCAM JUDGE' };

export class Orchestrator {
  readonly feed: FeedItem[] = [];
  solUsd: number | null = null;
  private d: Deps;
  private feedId = 0;
  private index = new Map<string, IndexEntry>();
  private vamps = new Map<string, VampMatch>();
  private reusedSocial = new Set<string>();
  private smartGlobal: Set<string>;
  private userSmart = new Set<string>();
  private smartBurst = new Map<string, number[]>();
  private metaQ = new WorkQueue(4, 300);
  private auditQ = new WorkQueue(2, 400);
  private jevQ = new WorkQueue(3, 100);
  private timers: NodeJS.Timeout[] = [];

  constructor(d: Deps) {
    this.d = d;
    this.smartGlobal = new Set([...d.cfg.smartWallets, ...(d.extraSmart ?? [])]);
  }

  get smart(): Set<string> { return new Set([...this.smartGlobal, ...this.userSmart]); }

  start() {
    const { bus } = this.d;
    bus.on('create', (e: CreateEvent) => this.onCreate(e));
    bus.on('trade', (e: TradeEvent) => this.onTrade(e));
    bus.on('migrate', (e: MigrateEvent) => this.onMigrate(e));
    bus.on('dex:trending', (infos: DexInfo[]) => this.onTrending(infos));
    this.timers.push(setInterval(() => this.tick(), 1000));
    this.timers.push(setInterval(() => { for (const t of this.d.store.all()) t.dirty = true; }, 15_000));
    this.timers.push(setInterval(() => this.sweep(), 30_000));
    this.timers.push(setInterval(() => this.d.feed.tick(this.d.store.all()), 10_000));
    if (this.d.dex && !this.d.cfg.demo) this.timers.push(setInterval(() => this.pollStats().catch(() => {}), 45_000));
    const price = () => this.d.chain.solUsd().then((v) => { if (v) this.solUsd = v; }).catch(() => {});
    price();
    this.timers.push(setInterval(price, 60_000));
    this.d.feed.wantWallets([...this.smart]);
    setTimeout(() => this.restoreWatched().catch(() => {}), 5000);
  }

  stop() { this.timers.forEach(clearInterval); }

  setUserWallets(wallets: string[]) {
    this.userSmart = new Set(wallets);
    this.d.feed.wantWallets([...this.smart]);
  }

  // ---------- feed ----------
  push(agent: string, level: FeedItem['level'], text: string, t?: TokenState) {
    const item: FeedItem = { id: ++this.feedId, t: Date.now(), agent, level, text, mint: t?.mint, symbol: t?.symbol };
    this.feed.push(item);
    if (this.feed.length > 200) this.feed.shift();
    this.d.bus.emit('feed', item);
  }

  // ---------- ingest ----------
  private onCreate(e: CreateEvent) {
    const { store, cfg, db } = this.d;
    if (store.size >= cfg.maxWatched) this.evict(true);
    if (store.size >= cfg.maxWatched) return;
    const t = store.create(e, cfg.demo ? 'replay' : 'pump');
    if (e.creator) bumpLaunch(db, e.creator, e.at);
    this.checkVamp(t);
    if (!this.vamps.get(t.mint)?.hard) this.d.feed.onCreated(t);
    if (!t.metaLoaded && t.uri) this.metaQ.push(() => this.loadMeta(t));
  }

  private onTrade(e: TradeEvent) {
    const { store, cfg } = this.d;
    const smart = this.smart.has(e.wallet);
    let t = store.applyTrade(e);
    if (!t) {
      if (smart && e.side === 'buy') { this.scan(e.mint, 'smart').then((tok) => { if (tok) store.applyTrade(e); }).catch(() => {}); }
      return;
    }
    if (smart) this.onSmartTrade(t, e);
    if (e.wallet === t.creator && e.side === 'sell' && e.tokens > 0) {
      const pct = t.creatorMax > 0 ? (e.tokens / t.creatorMax) * 100 : 0;
      store.addTimeline(t, `Dev sold ${pct.toFixed(0)}% of their bag`, 'warn', e.at);
      this.d.bus.emit('devSell', t, pct);
    }
    if (!t.auditQueued && t.buys >= cfg.auditAfterBuys) this.queueAudit(t);
  }

  private onSmartTrade(t: TokenState, e: TradeEvent) {
    if (e.side === 'sell') {
      if ((t.balances.get(e.wallet) ?? 0) <= 0 && !t.smartOut.has(e.wallet)) {
        t.smartOut.add(e.wallet);
        this.d.store.addTimeline(t, `Tracked wallet ${short(e.wallet)} exited`, 'warn', e.at);
        this.push('SMART MONEY', 'warn', `Tracked wallet ${short(e.wallet)} fully exited $${t.symbol}.`, t);
        this.d.bus.emit('smartExit', t);
      }
      return;
    }
    if (t.smartIn.has(e.wallet)) return;
    t.smartIn.set(e.wallet, e.at);
    this.d.store.addTimeline(t, `Tracked wallet ${short(e.wallet)} bought ${e.sol.toFixed(2)} SOL`, 'good', e.at);
    const burst = (this.smartBurst.get(t.mint) ?? []).filter((x) => e.at - x < 90_000);
    burst.push(e.at);
    this.smartBurst.set(t.mint, burst);
    const text = burst.length > 1 ? `${burst.length} tracked wallets bought $${t.symbol} within 90 seconds.` : `Tracked wallet ${short(e.wallet)} bought $${t.symbol} (${e.sol.toFixed(2)} SOL).`;
    this.push('SMART MONEY', 'info', text, t);
  }

  private onMigrate(e: MigrateEvent) {
    const t = this.d.store.migrate(e.mint, e.at, e.pool);
    if (!t) return;
    this.push('GRADUATION WATCH', 'good', `$${t.symbol} graduated — bonding curve complete.`, t);
    this.d.bus.emit('graduated', t);
    if (t.audit) { t.audit = undefined; t.auditQueued = false; this.queueAudit(t); }
  }

  private onTrending(infos: DexInfo[]) {
    for (const i of infos) {
      const t = this.d.store.get(i.mint);
      if (t) { this.applyDex(t, i); continue; }
      if (this.d.store.size < this.d.cfg.maxWatched) this.addExternal(i, 'dexscreener');
    }
  }

  private applyDex(t: TokenState, i: DexInfo, trending = true) {
    if (trending) t.trending = { boosted: i.boosted, profile: i.profile, at: Date.now() };
    t.external = {
      ...t.external, mcapUsd: i.mcapUsd, liquidityUsd: i.liquidityUsd, volume24hUsd: i.volume24hUsd, change24h: i.change24h,
      m5: i.m5, h1: i.h1, statsAt: Date.now(),
    };
    if (!t.trades.length && i.mcapUsd && this.solUsd) {
      t.mcapSol = i.mcapUsd / this.solUsd;
      if (t.mcapSol > t.peakMcapSol) t.peakMcapSol = t.mcapSol;
    }
    const m5 = i.m5;
    if (m5 && m5.buys + m5.sells > 0) t.lastActivity = Math.max(t.lastActivity, Date.now() - 60_000);
    if (!t.meta.image && i.image) t.meta.image = i.image;
    if (!t.meta.twitter && i.twitter) t.meta.twitter = i.twitter;
    if (!t.meta.telegram && i.telegram) t.meta.telegram = i.telegram;
    if (!t.meta.website && i.website) t.meta.website = i.website;
    t.dirty = true;
  }

  private addExternal(i: DexInfo, source: TokenState['source']): TokenState {
    const at = i.createdAt && i.createdAt < Date.now() ? i.createdAt : Date.now();
    const t = blankToken({ mint: i.mint, name: i.name, symbol: i.symbol, creator: '', createdAt: at, source, metaLoaded: true });
    t.firstSeen = Date.now();
    t.lastActivity = Date.now();
    if (i.mcapUsd && this.solUsd) { t.mcapSol = i.mcapUsd / this.solUsd; t.peakMcapSol = t.mcapSol; }
    this.applyDex(t, i);
    this.d.store.tokens.set(t.mint, t);
    this.d.store.addTimeline(t, source === 'dexscreener' ? 'Picked up from DexScreener trending' : 'Scanned on request', 'info');
    this.checkVamp(t);
    if (source === 'scan') this.d.feed.consider(t, 'scan');
    this.queueAudit(t);
    return t;
  }

  /** On-demand scan of any mint (search box, smart-wallet buy on an unwatched token). */
  async scan(mint: string, why: 'user' | 'smart' = 'user'): Promise<TokenState | null> {
    const existing = this.d.store.get(mint);
    if (existing) return existing;
    let info: DexInfo | undefined;
    if (this.d.dex && !this.d.cfg.demo) info = (await this.d.dex.lookup([mint]).catch(() => []))[0];
    const t = this.addExternal(info ?? { mint, name: 'Unknown token', symbol: mint.slice(0, 4), boosted: false, profile: false }, 'scan');
    if (why === 'smart') this.d.store.addTimeline(t, 'Picked up because a tracked wallet bought', 'info');
    return t;
  }

  /**
   * Free momentum data from DexScreener for tokens without a live trade stream.
   * Tokens that show traction there are promoted to the (paid) live stream.
   */
  private async pollStats() {
    const now = Date.now();
    const cands = [...this.d.store.all()]
      .filter((t) => t.status !== 'blocked' && !this.d.feed.isSubscribed(t.mint) && now - t.firstSeen < 3 * 3_600_000)
      .sort((a, b) => (b.external?.m5?.buys ?? 0) - (a.external?.m5?.buys ?? 0) || b.createdAt - a.createdAt)
      .slice(0, 120);
    if (!cands.length) return;
    const infos = await this.d.dex!.lookup(cands.map((t) => t.mint));
    for (const i of infos) {
      const t = this.d.store.get(i.mint);
      if (!t) continue;
      this.applyDex(t, i, false);
      const m5 = i.m5;
      if (m5 && m5.buys >= 15 && m5.volUsd >= 2000) {
        if (!t.auditQueued) this.queueAudit(t);
        if (this.d.feed.consider(t, 'traction')) this.d.store.addTimeline(t, 'Traction on DexScreener — live trade stream on', 'info');
      }
    }
  }

  // ---------- enrichment ----------
  private async loadMeta(t: TokenState) {
    try {
      const m = await fetchMetadata(t.uri, this.d.cfg.ipfsGateway);
      if (m) { t.meta = { ...m, ...pick(t.meta) }; }
    } catch { /* metadata hosts are flaky; name/ticker checks still run */ }
    t.metaLoaded = true;
    this.checkVamp(t);
    t.dirty = true;
  }

  private queueAudit(t: TokenState) {
    if (t.auditQueued) return;
    t.auditQueued = true;
    const { chain, db, cfg } = this.d;
    if (!chain.live) return;
    this.auditQ.push(async () => {
      if (!this.d.store.get(t.mint)) return;
      const mint = await chain.mintInfo(t.mint).catch((e) => { log.warn('mintInfo', e.message); return null; });
      let funder: string | null = null;
      if (t.creator) {
        funder = getRep(db, t.creator)?.funder ?? null;
        if (!funder && (cfg.funderTrace || cfg.demo)) {
          funder = await chain.funderOf(t.creator).catch(() => null);
          if (funder) setFunder(db, t.creator, funder, Date.now());
        }
      }
      const needsQuote = t.graduated || t.source === 'dexscreener' || t.source === 'scan';
      const sellQuote = needsQuote && mint ? await chain.sellQuote(t.mint, cfg.pump.supply * 0.001, mint.decimals).catch(() => null) : null;
      t.audit = { at: Date.now(), mint, sellQuote, funder };
      t.dirty = true;
    });
  }

  /** Asks Jev for a verdict. Runs in the background; the next evaluation applies it. */
  private queueJev(t: TokenState) {
    const jev = this.d.jev!;
    t.jevQueued = true;
    t.jevTriedAt = Date.now();
    const queued = this.jevQ.push(async () => {
      try {
        if (!this.d.store.get(t.mint)) return;
        const before = jevGateStatus(t, this.d.cfg);
        const v = await jev.judge(t, Number(t.signals.smart?.metrics?.holding ?? 0));
        if (!v) return;
        t.jev = v;
        t.dirty = true;
        const after = jevGateStatus(t, this.d.cfg);
        if (after === before || after === 'pass') return;
        const pct = Math.round(v.scam * 100);
        const pattern = v.pattern.replace('_', ' ');
        if (after === 'fail') {
          this.d.store.addTimeline(t, `Jev: ${pct}% scam probability (${pattern})`, 'warn');
        } else {
          this.d.store.addTimeline(t, `Jev: elevated risk — ${pct}% scam probability (${pattern})`, 'warn');
          this.push('JEV SCAM JUDGE', 'warn', `Caution on $${t.symbol}: Jev puts it at ${pct}% scam probability (${pattern}).`, t);
        }
      } finally {
        t.jevQueued = false;
      }
    });
    if (!queued) t.jevQueued = false;
  }

  private checkVamp(t: TokenState) {
    const keys: Array<[string, string, boolean]> = [];
    const n = normName(t.name), s = normName(t.symbol);
    if (n && s) keys.push([`ns:${n}|${s}`, 'same name and ticker', true]);
    const img = imageKey(t.meta.image);
    if (img) keys.push([`img:${img}`, 'same image', true]);
    const x = twitterHandle(t.meta.twitter);
    if (x) keys.push([`x:${x}`, 'same X account', true]);
    if (s) keys.push([`s:${s}`, 'same ticker', false]);
    let match: VampMatch | null = this.vamps.get(t.mint) ?? null;
    for (const [key, why, hard] of keys) {
      const e = this.index.get(key);
      if (!e) { this.index.set(key, { mint: t.mint, symbol: t.symbol, at: t.createdAt }); continue; }
      if (e.mint === t.mint) continue;
      if (e.at > t.createdAt) { this.index.set(key, { mint: t.mint, symbol: t.symbol, at: t.createdAt }); continue; }
      if (!match || (hard && !match.hard)) match = { hard, mint: e.mint, symbol: e.symbol, why };
      if (key.startsWith('x:')) this.reusedSocial.add(t.mint);
    }
    if (match) this.vamps.set(t.mint, match);
  }

  // ---------- evaluation ----------
  private tick() {
    for (const t of this.d.store.all()) if (t.dirty) this.evaluate(t);
  }

  evaluate(t: TokenState) {
    const { cfg, db, store, bus } = this.d;
    const now = Date.now();
    const rep = t.creator ? getRep(db, t.creator) : null;
    const funderRep = t.audit?.funder ? getRep(db, t.audit.funder) : null;

    if (!t.rugged && t.creatorMax > 0 && t.creatorSold >= 0.8 * t.creatorMax && t.mcapSol <= 0.35 * t.peakMcapSol && now - t.createdAt < 3 * 3_600_000) {
      t.rugged = true;
      markRug(db, t.creator, now);
      if (t.audit?.funder) markRug(db, t.audit.funder, now);
      store.addTimeline(t, 'Rug detected — dev dumped, price collapsed. Deployer flagged.', 'warn', now);
      this.push('DEV FORENSICS', 'warn', `Rug on $${t.symbol}: dev dumped and price fell ${Math.round((1 - t.mcapSol / t.peakMcapSol) * 100)}%. Deployer flagged for future launches.`, t);
    }

    t.gates = runGates(t, { now, cfg, chainLive: this.d.chain.live, vamp: this.vamps.get(t.mint) ?? null, rep, funderRep });
    const h = holderMetrics(t, cfg);
    const grad = graduationWatch(t, now, cfg);
    const sig = {
      momentum: momentum(t, now, grad, this.solUsd),
      holders: holderHealth(h, t.balances.size > 0 || !!t.external?.holders),
      smart: smartMoney(t, this.smart),
      narrative: narrative(t, this.reusedSocial.has(t.mint)),
      dev: devReputation(t, rep),
      graduation: grad,
    };
    t.signals = sig;
    t.scoreParts = { momentum: sig.momentum.score!, holders: sig.holders.score!, smart: sig.smart.score!, narrative: sig.narrative.score!, dev: sig.dev.score! };
    const prevScore = t.score;
    const prevStatus = t.status;
    t.score = runnerScore(t.scoreParts, cfg.weights);

    t.hardFails = Object.entries(GATE_TAGS)
      .filter(([k]) => t.gates[k]?.status === 'fail')
      .map(([k, tag]) => ({ tag: k === 'dev' && t.rugged ? 'RUG' : tag, why: t.gates[k].summary }));

    const age = now - t.createdAt;
    const active = Number(sig.momentum.metrics?.buys5m ?? 0) > 0;
    if (t.hardFails.length) t.status = 'blocked';
    else if (prevStatus === 'runner' && t.score >= cfg.runnerScore - 10) t.status = 'runner';
    else if (t.score >= cfg.runnerScore && h.holders >= 40 && age >= 45_000 && active) t.status = 'runner';
    else t.status = 'watching';

    if (t.status !== prevStatus) this.onStatusChange(t, prevStatus);
    if (this.d.jev?.wants(t, now)) this.queueJev(t);
    t.dirty = false;
    bus.emit('evaluated', t, prevScore, prevStatus);
  }

  private onStatusChange(t: TokenState, prev: TokenState['status']) {
    const { db, store } = this.d;
    const now = Date.now();
    if (t.status === 'blocked') {
      t.blockedAt = now;
      const first = Object.keys(GATE_TAGS).find((k) => t.gates[k]?.status === 'fail')!;
      store.addTimeline(t, `Blocked: ${t.gates[first].summary}`, 'warn', now);
      this.push(AGENT_NAMES[first], 'warn', `Blocked $${t.symbol}: ${t.gates[first].summary}.`, t);
      if (prev === 'runner') this.d.bus.emit('demoted', t);
    } else if (t.status === 'runner') {
      t.promotedAt = now;
      store.addTimeline(t, `Promoted to RUNNER · score ${t.score}`, 'good', now);
      this.push('ORCHESTRATOR', 'good', `$${t.symbol} promoted to RUNNER (score ${t.score}).`, t);
      db.prepare(`INSERT INTO outcomes (mint, symbol, creator, promoted_at, score, parts, mcap_at_promote, peak_mcap, last_mcap, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(mint) DO NOTHING`)
        .run(t.mint, t.symbol, t.creator, now, t.score, JSON.stringify(t.scoreParts), t.mcapSol, t.mcapSol, t.mcapSol, now);
      this.d.bus.emit('runner', t);
    } else if (prev === 'runner') {
      store.addTimeline(t, `Demoted — score fell to ${t.score}`, 'warn', now);
      this.d.bus.emit('demoted', t);
    }
  }

  // ---------- housekeeping ----------
  private sweep() {
    const { store, db } = this.d;
    const now = Date.now();
    const upd = db.prepare('UPDATE outcomes SET peak_mcap = MAX(peak_mcap, ?), last_mcap = ?, rugged = ?, updated_at = ? WHERE mint = ?');
    for (const t of store.all()) {
      if (t.promotedAt) upd.run(t.peakMcapSol, t.mcapSol, t.rugged ? 1 : 0, now, t.mint);
      if (t.status === 'runner' && t.audit && now - t.audit.at > 10 * 60_000 && (t.graduated || t.source !== 'pump')) {
        t.auditQueued = false; this.queueAudit(t);
      }
    }
    this.evict(false);
    for (const [k, e] of this.index) if (now - e.at > 24 * 3_600_000) this.index.delete(k);
    for (const m of this.vamps.keys()) if (!store.get(m)) this.vamps.delete(m);
    for (const m of this.smartBurst.keys()) if (!store.get(m)) this.smartBurst.delete(m);
  }

  private watchedMints(): Set<string> {
    const rows = this.d.db.prepare('SELECT DISTINCT mint FROM watchlist').all() as Array<{ mint: string }>;
    return new Set(rows.map((r) => r.mint));
  }

  /** After a restart, put tokens people are watching back on the board (DexScreener lookup, free). */
  async restoreWatched() {
    if (!this.d.dex || this.d.cfg.demo) return;
    const missing = [...this.watchedMints()].filter((m) => !this.d.store.get(m)).slice(0, 300);
    if (!missing.length) return;
    const infos = await this.d.dex.lookup(missing).catch(() => []);
    for (const i of infos) if (!this.d.store.get(i.mint)) this.addExternal(i, 'scan');
    log.info(`Restored ${infos.length} watched tokens`);
  }

  private evict(force: boolean) {
    const { store, cfg } = this.d;
    const now = Date.now();
    const drop: string[] = [];
    const watched = this.watchedMints();
    for (const t of store.all()) {
      if (watched.has(t.mint)) continue;
      const idle = now - t.lastActivity;
      const keepBlocked = t.status === 'blocked' && now - (t.blockedAt ?? 0) < 15 * 60_000;
      if (t.status === 'runner' && idle < 60 * 60_000) continue;
      if (keepBlocked && idle < 30 * 60_000) continue;
      if (idle > cfg.idleDropMs || (force && idle > 60_000 && t.buys < 5)) drop.push(t.mint);
    }
    if (store.size - drop.length > cfg.maxWatched) {
      const rest = [...store.all()].filter((t) => !drop.includes(t.mint) && t.status !== 'runner').sort((a, b) => a.lastActivity - b.lastActivity);
      drop.push(...rest.slice(0, store.size - drop.length - cfg.maxWatched).map((t) => t.mint));
    }
    for (const m of drop) store.remove(m);
    if (drop.length) this.d.feed.dropped(drop);
  }
}

const jevGateStatus = (t: TokenState, cfg: Config) => jevGate(t, cfg).status;

const pick = (m: TokenState['meta']) => Object.fromEntries(Object.entries(m).filter(([, v]) => v));
