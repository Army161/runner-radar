import type { AgentResult, TokenState } from '../types.ts';
import type { Config } from '../config.ts';
import type { WalletRep } from '../db.ts';
import { dangerousExtensions } from '../sources/chain.ts';

/**
 * Gatekeeper agents. Each is a pure function of the token's state so it can be
 * re-run cheaply on every update and unit-tested. A "fail" from any of the first
 * four is a hard block; bundle metrics are judged against each user's limits.
 */

export interface VampMatch { hard: boolean; mint: string; symbol: string; why: string }

export interface GateCtx {
  now: number;
  cfg: Config;
  chainLive: boolean;
  vamp: VampMatch | null;
  rep: WalletRep | null;
  funderRep: WalletRep | null;
}

const r = (agent: string, status: AgentResult['status'], summary: string, metrics?: AgentResult['metrics']): AgentResult =>
  ({ agent, status, summary, metrics, at: Date.now() });

export function contractAuditor(t: TokenState, ctx: GateCtx): AgentResult {
  const A = 'Contract auditor';
  if (!t.audit) return r(A, 'pending', ctx.chainLive ? 'Queued — runs once the token shows traction' : 'Not checked — add SOLANA_RPC_URL to enable');
  const m = t.audit.mint;
  if (!m) return r(A, 'pending', 'Mint account not readable yet');
  const problems: string[] = [];
  if (m.mintAuthority) problems.push('mint authority active — supply can be inflated');
  if (m.freezeAuthority) problems.push('freeze authority active — wallets can be frozen');
  problems.push(...dangerousExtensions(m));
  const metrics = { mintRevoked: !m.mintAuthority, freezeRevoked: !m.freezeAuthority, program: m.program };
  if (problems.length) return r(A, 'fail', cap(problems.join('; ')), metrics);
  return r(A, 'pass', `Mint & freeze revoked · ${m.program === 'token2022' ? 'Token-2022, no risky extensions' : 'SPL token'}`, metrics);
}

export function honeypotSimulator(t: TokenState, ctx: GateCtx): AgentResult {
  const A = 'Honeypot simulator';
  const m = t.audit?.mint;
  const blockers = m ? [...(m.freezeAuthority ? ['freeze authority'] : []), ...dangerousExtensions(m)] : [];
  if (blockers.length) return r(A, 'fail', cap(`Selling can be blocked: ${blockers.join(', ')}`), { sellers: t.sellers.size });
  const q = t.audit?.sellQuote;
  if (q && !q.ok) return r(A, 'fail', 'No sell route found — sell quote failed', { sellers: t.sellers.size });
  const sellers = t.sellers.size;
  const age = ctx.now - t.createdAt;
  const impact = q?.impactPct !== undefined ? ` · sell impact ${q.impactPct.toFixed(1)}%` : '';
  if (sellers >= 2) return r(A, 'pass', `${sellers} wallets sold successfully${impact}`, { sellers });
  if (q?.ok) return r(A, 'pass', `Sell route confirmed${impact}`, { sellers });
  if (age > 180_000 && t.buys >= 25 && sellers === 0) return r(A, 'warn', `${t.buys} buys but no successful sells yet`, { sellers });
  return r(A, 'pending', 'Waiting for sells to prove it can be sold', { sellers });
}

export function vampDetector(t: TokenState, ctx: GateCtx): AgentResult {
  const A = 'Vamp detector';
  const v = ctx.vamp;
  if (v?.hard) return r(A, 'fail', `Clone of $${v.symbol} — ${v.why}`, { original: v.mint });
  if (v) return r(A, 'warn', `Shares a ticker with earlier $${v.symbol}`, { original: v.mint });
  return r(A, 'pass', t.metaLoaded ? 'Original — no earlier token with this name, image or X account' : 'No name/ticker clash (image check pending)');
}

export function devForensics(t: TokenState, ctx: GateCtx): AgentResult {
  const A = 'Dev forensics';
  if (!t.creator) return r(A, 'pending', 'Deployer unknown — token discovered after launch');
  const rep = ctx.rep;
  const prior = Math.max(0, (rep?.launches ?? 1) - 1);
  const devPct = ((t.balances.get(t.creator) ?? 0) / ctx.cfg.pump.supply) * 100;
  const soldPct = t.creatorMax > 0 ? Math.min(100, (t.creatorSold / t.creatorMax) * 100) : 0;
  const metrics = { priorLaunches: prior, rugs: rep?.rugs ?? 0, devPct: round(devPct), devSoldPct: round(soldPct) };
  if (t.rugged) return r(A, 'fail', 'Dev dumped and price collapsed — rug', metrics);
  const rugs = Math.max(0, (rep?.rugs ?? 0));
  if (rugs > 0) return r(A, 'fail', `Deployer linked to ${rugs} earlier rug${rugs > 1 ? 's' : ''}`, metrics);
  if ((ctx.funderRep?.rugs ?? 0) > 0) return r(A, 'fail', `Funded by a wallet linked to ${ctx.funderRep!.rugs} rug${ctx.funderRep!.rugs > 1 ? 's' : ''}`, metrics);
  if (ctx.now - t.createdAt < 600_000 && soldPct > 50) return r(A, 'warn', `Dev sold ${soldPct.toFixed(0)}% within 10 minutes`, metrics);
  if (prior > 15) return r(A, 'warn', `Serial launcher — ${prior} earlier launches`, metrics);
  return r(A, 'pass', `${prior} earlier launch${prior === 1 ? '' : 'es'}, no rugs · dev holds ${devPct.toFixed(1)}%`, metrics);
}

export interface HolderMetrics {
  holders: number; top10Pct: number; devPct: number; bundlePct: number; bundleWallets: number;
  linkedWallets: number; sniperPct: number; snipers: number;
}

export function holderMetrics(t: TokenState, cfg: Config): HolderMetrics {
  const supply = cfg.pump.supply;
  const bals = [...t.balances.values()].sort((a, b) => b - a);
  const top10 = bals.slice(0, 10).reduce((a, b) => a + b, 0);
  const bundleTokens = t.earlyBuys.reduce((a, b) => a + b.tokens, 0);
  const buckets = new Map<number, number>();
  for (const b of t.earlyBuys) {
    const key = Math.round(Math.log(Math.max(b.sol, 1e-6)) / Math.log(1.03));
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  let sniperTokens = 0;
  for (const w of t.snipers) sniperTokens += t.balances.get(w) ?? 0;
  return {
    holders: t.external?.holders ?? t.balances.size,
    top10Pct: round((top10 / supply) * 100),
    devPct: round(((t.balances.get(t.creator) ?? 0) / supply) * 100),
    bundlePct: round((bundleTokens / supply) * 100),
    bundleWallets: new Set(t.earlyBuys.map((b) => b.wallet)).size,
    linkedWallets: Math.max(0, ...buckets.values()),
    sniperPct: round((sniperTokens / supply) * 100),
    snipers: t.snipers.size,
  };
}

export function bundleScan(t: TokenState, ctx: GateCtx): AgentResult {
  const A = 'Bundle & sniper scan';
  if (t.source === 'dexscreener' || (t.source === 'scan' && t.trades.length < 3)) {
    return r(A, 'pending', 'No launch data — token found after launch');
  }
  const h = holderMetrics(t, ctx.cfg);
  const metrics = { ...h };
  const flags: string[] = [];
  if (h.bundlePct > 25) flags.push(`${h.bundlePct.toFixed(1)}% bought in the launch window by ${h.bundleWallets} wallets`);
  if (h.linkedWallets >= 4) flags.push(`${h.linkedWallets} early buys with near-identical sizes (likely one buyer)`);
  const mature = h.holders >= ctx.cfg.minHoldersForConcentration;
  if (mature && h.sniperPct > 20) flags.push(`snipers still hold ${h.sniperPct.toFixed(1)}%`);
  if (mature && h.top10Pct > 40) flags.push(`top 10 wallets hold ${h.top10Pct.toFixed(1)}%`);
  if (flags.length) return r(A, 'warn', cap(flags.join('; ')), metrics);
  return r(A, 'pass', `Bundle ${h.bundlePct.toFixed(1)}% · snipers ${h.sniperPct.toFixed(1)}% · top 10 ${h.top10Pct.toFixed(1)}%`, metrics);
}

export const GATE_TAGS: Record<string, string> = { contract: 'AUTHORITY', honeypot: 'HONEYPOT', vamp: 'VAMP', dev: 'DEV HISTORY' };

export function runGates(t: TokenState, ctx: GateCtx): Record<string, AgentResult> {
  return {
    contract: contractAuditor(t, ctx),
    honeypot: honeypotSimulator(t, ctx),
    vamp: vampDetector(t, ctx),
    dev: devForensics(t, ctx),
    bundle: bundleScan(t, ctx),
  };
}

const round = (n: number) => Math.round(n * 10) / 10;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
