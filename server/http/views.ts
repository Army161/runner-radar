import type { Config } from '../config.ts';
import type { TokenState, UserSettings } from '../types.ts';
import type { Verdict } from '../agents/filters.ts';
import { evaluateFor } from '../agents/filters.ts';
import { holderMetrics } from '../agents/gates.ts';
import { WINDOWS, windowStats } from '../agents/signals.ts';
import { short } from '../store.ts';

export const TABS = ['newpairs', 'bonding', 'graduated', 'trending', 'held', 'gainers'] as const;
export type Tab = (typeof TABS)[number];

interface ViewCtx { cfg: Config; solUsd: number | null; now: number }

function safety(t: TokenState): 'PASS' | 'WARN' | 'FAIL' | 'PENDING' {
  const core = ['contract', 'honeypot', 'vamp', 'dev'].map((k) => t.gates[k]?.status);
  if (core.includes('fail') || t.gates.jev?.status === 'fail') return 'FAIL';
  if (core.includes('warn') || t.gates.bundle?.status === 'warn' || t.gates.jev?.status === 'warn') return 'WARN';
  if (core.every((s) => s === 'pass')) return 'PASS';
  return 'PENDING';
}

function links(t: TokenState, cfg: Config) {
  if (cfg.demo) return null;
  return {
    pumpfun: `https://pump.fun/coin/${t.mint}`,
    gmgn: `https://gmgn.ai/sol/token/${t.mint}`,
    axiom: `https://axiom.trade/meme/${t.bondingCurve ?? t.mint}`,
    dexscreener: `https://dexscreener.com/solana/${t.mint}`,
  };
}

export function rowOf(t: TokenState, win: string, v: ViewCtx) {
  let w = windowStats(t, WINDOWS[win] ?? WINDOWS['5m'], v.now);
  const ext = win === '5m' ? t.external?.m5 : win === '1h' ? t.external?.h1 : undefined;
  if (w.buys + w.sells === 0 && w.volSol === 0 && ext && v.solUsd) {
    w = { volSol: ext.volUsd / v.solUsd, buys: ext.buys, sells: ext.sells, uniqueBuyers: 0, changePct: ext.change };
  }
  const h = holderMetrics(t, v.cfg);
  const mcapUsd = t.external?.mcapUsd && !t.trades.length ? t.external.mcapUsd : v.solUsd ? t.mcapSol * v.solUsd : null;
  return {
    mint: t.mint, symbol: t.symbol, name: t.name, image: t.meta.image ?? null,
    ageSec: Math.max(0, Math.round((v.now - t.createdAt) / 1000)),
    mcapSol: round(t.mcapSol, 2), mcapUsd: mcapUsd !== null ? Math.round(mcapUsd) : null,
    volSol: round(w.volSol, 2), volUsd: v.solUsd ? Math.round(w.volSol * v.solUsd) : (win === '24h' ? t.external?.volume24hUsd ?? null : null),
    changePct: Math.round(win === '24h' && t.external?.change24h !== undefined && !t.trades.length ? t.external.change24h : w.changePct),
    holders: h.holders, bond: Math.round(t.bondProgress), graduated: t.graduated,
    onCurve: t.source === 'pump' || t.source === 'replay',
    smart: Number(t.signals.smart?.metrics?.holding ?? 0),
    safety: safety(t), score: t.score, status: t.status,
  };
}

export function detailOf(t: TokenState, v: ViewCtx, verdict: Verdict | null, smart: Set<string>) {
  const h = holderMetrics(t, v.cfg);
  const supply = v.cfg.pump.supply;
  const top = [...t.balances.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([wallet, bal]) => {
    const tags: string[] = [];
    if (wallet === t.creator) tags.push('dev');
    if (smart.has(wallet)) tags.push('smart money');
    if (t.snipers.has(wallet)) tags.push('sniper');
    if (t.earlyBuys.some((b) => b.wallet === wallet)) tags.push('bundle');
    return { wallet, short: short(wallet), pct: round((bal / supply) * 100, 2), tags };
  });
  const w5 = windowStats(t, WINDOWS['5m'], v.now);
  return {
    ...rowOf(t, '5m', v),
    creator: t.creator || null, source: t.source, pool: t.pool, description: t.meta.description ?? null,
    socials: { twitter: t.meta.twitter ?? null, telegram: t.meta.telegram ?? null, website: t.meta.website ?? null },
    buys5m: w5.buys, sells5m: w5.sells, links: links(t, v.cfg),
    gates: Object.entries(t.gates).map(([key, r]) => ({ key, ...r })),
    signals: Object.entries(t.signals).map(([key, r]) => ({ key, ...r })),
    scoreParts: t.scoreParts, weights: v.cfg.weights,
    holderMetrics: h, topHolders: top,
    timeline: [...t.timeline].reverse().map((e) => ({ ...e, offsetSec: Math.round((e.t - t.createdAt) / 1000) })),
    candles: priceSeries(t, v.cfg),
    blockedBy: verdict?.blockedBy ?? [], rugged: t.rugged, external: t.external ?? null,
  };
}

export function listFor(tokens: Iterable<TokenState>, s: UserSettings, tab: Tab, win: string, v: ViewCtx) {
  const visible: TokenState[] = [];
  let blocked = 0;
  for (const t of tokens) {
    if (!t.gates.contract) continue;
    const smart = Number(t.signals.smart?.metrics?.holding ?? 0);
    const verdict = evaluateFor(t, s, v.cfg, v.solUsd, smart, v.now);
    if (verdict.blockedBy.length) { blocked++; continue; }
    const thresholdTabs = tab === 'trending' || tab === 'held' || tab === 'gainers';
    if (thresholdTabs && !verdict.meetsThresholds) continue;
    visible.push(t);
  }
  let list = visible;
  const ms = WINDOWS[win] ?? WINDOWS['5m'];
  switch (tab) {
    case 'newpairs': list = list.filter((t) => v.now - t.createdAt < 30 * 60_000 && t.source !== 'dexscreener').sort((a, b) => b.createdAt - a.createdAt); break;
    case 'bonding': list = list.filter((t) => !t.graduated && (t.source === 'pump' || t.source === 'replay') && t.bondProgress >= 15).sort((a, b) => b.bondProgress - a.bondProgress); break;
    case 'graduated': list = list.filter((t) => t.graduated || t.source === 'dexscreener').sort((a, b) => (b.graduatedAt ?? b.firstSeen) - (a.graduatedAt ?? a.firstSeen)); break;
    case 'held': list.sort((a, b) => holderMetrics(b, v.cfg).holders - holderMetrics(a, v.cfg).holders); break;
    case 'gainers': {
      const ch = new Map(list.map((t) => [t.mint, windowStats(t, ms, v.now).changePct]));
      list = list.filter((t) => (ch.get(t.mint) ?? 0) > 0).sort((a, b) => ch.get(b.mint)! - ch.get(a.mint)!);
      break;
    }
    default: list.sort((a, b) => b.score - a.score);
  }
  return { rows: list.slice(0, 50).map((t) => rowOf(t, win, v)), blocked, total: visible.length };
}

export function blockedFor(tokens: Iterable<TokenState>, s: UserSettings, v: ViewCtx) {
  const out: Array<{ mint: string; symbol: string; name: string; tag: string; why: string; reasons: Verdict['blockedBy']; at: number }> = [];
  for (const t of tokens) {
    if (!t.gates.contract) continue;
    const verdict = evaluateFor(t, s, v.cfg, v.solUsd, Number(t.signals.smart?.metrics?.holding ?? 0), v.now);
    if (!verdict.blockedBy.length) continue;
    out.push({ mint: t.mint, symbol: t.symbol, name: t.name, tag: verdict.blockedBy[0].tag, why: verdict.blockedBy[0].why, reasons: verdict.blockedBy, at: t.blockedAt ?? t.lastActivity });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 30);
}

/** Trade-level price points for the last hour (downsampled), minute candles beyond that. */
function priceSeries(t: TokenState, cfg: Config): Array<[number, number]> {
  const supply = cfg.pump.supply;
  if (t.trades.length >= 2 && Date.now() - t.createdAt < 3_600_000) {
    const step = Math.max(1, Math.ceil(t.trades.length / 180));
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < t.trades.length; i += step) pts.push([t.trades[i].t, t.trades[i].mcapSol / supply]);
    const last = t.trades[t.trades.length - 1];
    pts.push([last.t, last.mcapSol / supply]);
    return pts;
  }
  return t.candles.slice(-180).map((c) => [c.t, c.c]);
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
