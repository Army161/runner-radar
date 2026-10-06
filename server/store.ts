import type { CreateEvent, TradeEvent, TokenState, Candle, TimelineEvent } from './types.ts';
import type { Config } from './config.ts';

const HOUR = 3_600_000;
const MAX_CANDLES = 24 * 60;
const MAX_TIMELINE = 40;

export function bondProgress(cfg: Config, vTokens: number): number {
  if (!vTokens) return 0;
  const real = vTokens - cfg.pump.virtualOffset;
  return Math.max(0, Math.min(100, 100 * (1 - real / cfg.pump.sellable)));
}

export function priceSol(t: { vSol: number; vTokens: number; mcapSol: number }, supply: number): number {
  if (t.vSol > 0 && t.vTokens > 0) return t.vSol / t.vTokens;
  return t.mcapSol > 0 ? t.mcapSol / supply : 0;
}

export function blankToken(partial: Pick<TokenState, 'mint' | 'name' | 'symbol' | 'creator' | 'createdAt' | 'source'> & Partial<TokenState>): TokenState {
  return {
    uri: '', meta: {}, metaLoaded: false, pool: 'pump', graduated: false,
    vSol: 0, vTokens: 0, mcapSol: 0, peakMcapSol: 0, bondProgress: 0,
    balances: new Map(), firstBuyAt: new Map(), trades: [], candles: [],
    buys: 0, sells: 0, sellers: new Set(), creatorMax: 0, creatorSold: 0,
    earlyBuys: [], snipers: new Set(), smartIn: new Map(), smartOut: new Set(),
    auditQueued: false, gates: {}, signals: {}, scoreParts: {}, score: 0,
    status: 'watching', hardFails: [], rugged: false, timeline: [],
    firstSeen: partial.createdAt, lastActivity: partial.createdAt, dirty: true,
    ...partial,
  };
}

export class TokenStore {
  readonly tokens = new Map<string, TokenState>();
  private cfg: Config;
  constructor(cfg: Config) { this.cfg = cfg; }

  get(mint: string) { return this.tokens.get(mint); }
  all() { return this.tokens.values(); }
  get size() { return this.tokens.size; }

  addTimeline(t: TokenState, text: string, kind: TimelineEvent['kind'] = 'info', at = Date.now()) {
    t.timeline.push({ t: at, text, kind });
    if (t.timeline.length > MAX_TIMELINE) t.timeline.splice(0, t.timeline.length - MAX_TIMELINE);
  }

  create(e: CreateEvent, source: TokenState['source'] = 'pump'): TokenState {
    const existing = this.tokens.get(e.mint);
    if (existing) return existing;
    const t = blankToken({
      mint: e.mint, name: e.name || '?', symbol: e.symbol || '?', creator: e.creator,
      createdAt: e.at, source, uri: e.uri, bondingCurve: e.bondingCurve, pool: e.pool || 'pump',
      vSol: e.vSol, vTokens: e.vTokens, mcapSol: e.mcapSol, peakMcapSol: e.mcapSol,
    });
    if (e.meta) { t.meta = e.meta; t.metaLoaded = true; }
    t.bondProgress = bondProgress(this.cfg, e.vTokens);
    if (e.initialBuy > 0) {
      t.balances.set(e.creator, e.initialBuy);
      t.firstBuyAt.set(e.creator, e.at);
      t.creatorMax = e.initialBuy;
      t.trades.push({ t: e.at, wallet: e.creator, side: 'buy', sol: e.solAmount, tokens: e.initialBuy, mcapSol: e.mcapSol });
      t.buys = 1;
    }
    this.pushCandle(t, e.at, priceSol(t, this.cfg.pump.supply), e.solAmount);
    this.addTimeline(t, `Created on pump.fun by ${short(e.creator)}`, 'info', e.at);
    this.tokens.set(e.mint, t);
    return t;
  }

  applyTrade(e: TradeEvent): TokenState | null {
    const t = this.tokens.get(e.mint);
    if (!t) return null;
    const cfg = this.cfg;
    t.vSol = e.vSol || t.vSol;
    t.vTokens = e.vTokens || t.vTokens;
    t.mcapSol = e.mcapSol || t.mcapSol;
    if (t.mcapSol > t.peakMcapSol) t.peakMcapSol = t.mcapSol;
    if (!t.graduated) t.bondProgress = bondProgress(cfg, t.vTokens);
    if (e.pool && e.pool !== 'pump') t.pool = e.pool;

    const prev = t.balances.get(e.wallet) ?? 0;
    const next = e.newBalance ?? Math.max(0, prev + (e.side === 'buy' ? e.tokens : -e.tokens));
    if (next > 0.5) t.balances.set(e.wallet, next); else t.balances.delete(e.wallet);

    const age = e.at - t.createdAt;
    if (e.side === 'buy') {
      t.buys++;
      if (!t.firstBuyAt.has(e.wallet)) t.firstBuyAt.set(e.wallet, e.at);
      if (e.wallet !== t.creator && age >= 0 && age <= cfg.bundleWindowMs) t.earlyBuys.push({ wallet: e.wallet, tokens: e.tokens, sol: e.sol });
      if (e.wallet !== t.creator && age >= 0 && age <= cfg.sniperWindowMs) t.snipers.add(e.wallet);
      if (e.wallet === t.creator) t.creatorMax = Math.max(t.creatorMax, next);
    } else {
      t.sells++;
      if (e.wallet !== t.creator) t.sellers.add(e.wallet);
      else t.creatorSold += e.tokens;
    }

    t.trades.push({ t: e.at, wallet: e.wallet, side: e.side, sol: e.sol, tokens: e.tokens, mcapSol: t.mcapSol });
    const cutoff = e.at - HOUR;
    if (t.trades.length > 50 && t.trades[0].t < cutoff) {
      let i = 0;
      while (i < t.trades.length && t.trades[i].t < cutoff) i++;
      t.trades.splice(0, i);
    }
    if (t.trades.length > 20_000) t.trades.splice(0, t.trades.length - 20_000);

    this.pushCandle(t, e.at, priceSol(t, cfg.pump.supply), e.sol);
    t.lastActivity = e.at;
    t.dirty = true;
    return t;
  }

  migrate(mint: string, at: number, pool?: string): TokenState | null {
    const t = this.tokens.get(mint);
    if (!t || t.graduated) return t ?? null;
    t.graduated = true;
    t.graduatedAt = at;
    t.bondProgress = 100;
    if (pool) t.pool = pool;
    this.addTimeline(t, 'Graduated — bonding curve complete, migrated to AMM', 'good', at);
    t.dirty = true;
    return t;
  }

  private pushCandle(t: TokenState, at: number, price: number, vol: number) {
    if (!(price > 0)) return;
    const minute = Math.floor(at / 60_000) * 60_000;
    const last: Candle | undefined = t.candles[t.candles.length - 1];
    if (last && last.t === minute) {
      last.h = Math.max(last.h, price); last.l = Math.min(last.l, price); last.c = price; last.v += vol;
    } else {
      t.candles.push({ t: minute, o: last?.c ?? price, h: price, l: price, c: price, v: vol });
      if (t.candles.length > MAX_CANDLES) t.candles.shift();
    }
  }

  remove(mint: string) { this.tokens.delete(mint); }
}

export const short = (a: string) => (a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
