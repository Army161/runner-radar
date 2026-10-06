import type { AgentResult, TokenState } from '../types.ts';
import type { Config } from '../config.ts';
import type { WalletRep } from '../db.ts';
import { clamp } from '../util.ts';
import type { HolderMetrics } from './gates.ts';

export const WINDOWS: Record<string, number> = { '1m': 60_000, '5m': 300_000, '1h': 3_600_000, '24h': 86_400_000 };

export interface WindowStats { volSol: number; buys: number; sells: number; uniqueBuyers: number; changePct: number }

export function windowStats(t: TokenState, ms: number, now: number): WindowStats {
  const from = now - ms;
  if (ms <= 3_600_000) {
    let volSol = 0, buys = 0, sells = 0, startMcap = 0;
    const buyers = new Set<string>();
    for (let i = t.trades.length - 1; i >= 0; i--) {
      const tr = t.trades[i];
      if (tr.t < from) { startMcap = tr.mcapSol; break; }
      volSol += tr.sol;
      if (tr.side === 'buy') { buys++; buyers.add(tr.wallet); } else sells++;
      startMcap = tr.mcapSol;
    }
    if (t.createdAt >= from && t.trades.length) startMcap = t.trades[0].mcapSol;
    const changePct = startMcap > 0 ? ((t.mcapSol - startMcap) / startMcap) * 100 : 0;
    return { volSol, buys, sells, uniqueBuyers: buyers.size, changePct };
  }
  let volSol = 0, open = 0;
  for (const c of t.candles) { if (c.t >= from) { volSol += c.v; if (!open) open = c.o; } }
  const last = t.candles[t.candles.length - 1]?.c ?? 0;
  const changePct = open > 0 ? ((last - open) / open) * 100 : (t.external?.change24h ?? 0);
  return { volSol, buys: 0, sells: 0, uniqueBuyers: 0, changePct };
}

const r = (agent: string, status: AgentResult['status'], score: number, summary: string, metrics?: AgentResult['metrics']): AgentResult =>
  ({ agent, status, score: Math.round(clamp(score, 0, 100)), summary, metrics, at: Date.now() });

/** Bonding progress implied by a pump.fun price (constant product k = 30 SOL × 1.073B tokens). */
export function progressAtPrice(price: number, cfg: Config): number {
  if (!(price > 0)) return 0;
  const vTokens = Math.sqrt((30 * 1_073_000_000) / price);
  return clamp(100 * (1 - (vTokens - cfg.pump.virtualOffset) / cfg.pump.sellable), 0, 100);
}

export function graduationWatch(t: TokenState, now: number, cfg: Config): AgentResult {
  const A = 'Graduation watch';
  if (t.graduated) return r(A, 'pass', 100, `Graduated ${t.graduatedAt ? Math.round((now - t.graduatedAt) / 60_000) + 'm ago' : ''}`.trim(), { progress: 100, velocity: 0 });
  if (t.source !== 'pump' && t.source !== 'replay') return r(A, 'pending', 0, 'Not on a pump.fun curve');
  const past = [...t.candles].reverse().find((c) => c.t <= now - 300_000);
  const before = past ? progressAtPrice(past.c, cfg) : 0;
  const velocity = Math.max(0, t.bondProgress - before);
  const eta = velocity > 0.5 ? Math.round(((100 - t.bondProgress) / velocity) * 5) : null;
  const score = clamp(t.bondProgress / 100) * 50 + clamp(velocity / 25) * 50;
  const summary = `Bonding ${t.bondProgress.toFixed(0)}% · +${velocity.toFixed(0)}%/5m${eta !== null && eta < 120 ? ` · ETA ~${eta}m` : ''}`;
  return r(A, t.bondProgress > 85 ? 'pass' : 'pending', score, summary, { progress: Math.round(t.bondProgress), velocity: Math.round(velocity), etaMin: eta });
}

export function momentum(t: TokenState, now: number, grad: AgentResult, solUsd: number | null = null): AgentResult {
  let s = windowStats(t, 300_000, now);
  let src = '';
  const ext = t.external;
  if (s.buys + s.sells === 0 && ext?.m5 && ext.statsAt && now - ext.statsAt < 180_000 && solUsd) {
    // No live trades for this token: fall back to DexScreener's 5-minute window (no per-wallet data).
    s = { volSol: ext.m5.volUsd / solUsd, buys: ext.m5.buys, sells: ext.m5.sells, uniqueBuyers: Math.round(ext.m5.buys * 0.6), changePct: ext.m5.change };
    src = ' · via DexScreener';
  }
  const vol = clamp(Math.log10(1 + s.volSol) / Math.log10(1 + 150));
  const total = s.buys + s.sells;
  const ratio = total ? clamp((s.buys / total - 0.45) / 0.4) : 0;
  const uniq = clamp(s.uniqueBuyers / 120);
  const growth = clamp(s.changePct / 150);
  const velo = clamp(Number(grad.metrics?.velocity ?? 0) / 25);
  const score = 100 * (0.27 * vol + 0.18 * ratio + 0.22 * uniq + 0.2 * growth + 0.13 * velo);
  return r('Momentum', score >= 60 ? 'pass' : 'pending', score,
    `${s.volSol.toFixed(1)} SOL vol · ${s.buys}/${s.sells} buys/sells${src ? '' : ` · ${s.uniqueBuyers} buyers`} (5m)${src}`,
    { volSol5m: Math.round(s.volSol * 10) / 10, buys5m: s.buys, sells5m: s.sells, buyers5m: s.uniqueBuyers, change5m: Math.round(s.changePct) });
}

export function holderHealth(h: HolderMetrics, known = true): AgentResult {
  if (!known) return r('Holder health', 'pending', 40, 'Holder data needs the live trade stream');
  let score = 40 * clamp(h.holders / 300) + 60;
  score -= Math.max(0, h.top10Pct - 20) * 1.2;
  score -= Math.max(0, h.devPct - 3) * 4;
  score -= h.bundlePct;
  score -= Math.max(0, h.sniperPct - 5) * 1.5;
  return r('Holder health', score >= 60 ? 'pass' : 'warn', score, `${h.holders} holders · top 10 ${h.top10Pct}% · dev ${h.devPct}%`);
}

export function smartMoney(t: TokenState, smart: Set<string>): AgentResult {
  let holding = 0;
  for (const w of smart) if ((t.balances.get(w) ?? 0) > 0) holding++;
  const exits = t.smartOut.size;
  const score = clamp(holding / 4) * 100 - exits * 15;
  const summary = holding || exits ? `${holding} tracked wallet${holding === 1 ? '' : 's'} holding${exits ? ` · ${exits} exited` : ''}` : 'No tracked wallets in yet';
  return r('Smart money', holding >= 2 ? 'pass' : exits > holding ? 'warn' : 'pending', score, summary, { holding, exits });
}

export function narrative(t: TokenState, socialReused: boolean): AgentResult {
  const m = t.meta;
  const socials = [m.twitter, m.telegram, m.website].filter(Boolean).length;
  let score = socials * 15;
  if ((m.description?.length ?? 0) > 20) score += 10;
  if (t.trending?.boosted) score += 25;
  if (t.trending?.profile) score += 15;
  if (socialReused) score -= 35;
  const bits = [`${socials}/3 socials`];
  if (t.trending?.boosted) bits.push('DexScreener boosted');
  if (t.trending?.profile) bits.push('DexScreener profile');
  if (socialReused) bits.push('X account reused from another token');
  return r('Narrative', socialReused ? 'warn' : score >= 45 ? 'pass' : 'pending', score, bits.join(' · '), { socials, reused: socialReused });
}

export function devReputation(t: TokenState, rep: WalletRep | null): AgentResult {
  if (!t.creator) return r('Dev reputation', 'pending', 50, 'Deployer unknown');
  const prior = Math.max(0, (rep?.launches ?? 1) - 1);
  let score = prior === 0 ? 60 : prior <= 5 ? 75 : prior <= 15 ? 55 : 35;
  if ((rep?.rugs ?? 0) > 0 || t.rugged) score = 0;
  const sold = t.creatorMax > 0 ? t.creatorSold / t.creatorMax : 0;
  if (sold < 0.2) score += 15; else if (sold > 0.5) score -= 30;
  return r('Dev reputation', score >= 60 ? 'pass' : score < 30 ? 'warn' : 'pending', score, `${prior} earlier launches · dev sold ${(sold * 100).toFixed(0)}%`);
}

export function runnerScore(parts: Record<string, number>, w: Config['weights']): number {
  return Math.round(parts.momentum * w.momentum + parts.holders * w.holders + parts.smart * w.smart + parts.narrative * w.narrative + parts.dev * w.dev);
}
