import type { Config } from '../config.ts';
import type { AgentResult, JevVerdict, TokenState } from '../types.ts';
import { holderMetrics } from './gates.ts';
import { WINDOWS, windowStats } from './signals.ts';
import { log } from '../util.ts';

/**
 * Jev scam judge. Sends a compact snapshot of what the other agents measured to Jev,
 * TypeSafe AI's System One decision model, through TypeSafe's official SDK
 * (@typesafe-ai/sdk), and gets back typed, calibrated answers: a scam probability,
 * a risk level and the launch pattern. Jev doesn't write text, so each call is cheap
 * (~$0.04 per million input tokens, output free) and fast (~150 ms).
 *
 * It only runs on tokens that already passed the hard gates and show real traction,
 * at most once per token per JEV_RECHECK_MS, and within a daily call budget.
 */

/** The slice of the SDK client this agent uses, so tests can pass a fake. */
export interface SystemOneClient {
  systemOne(req: { state: unknown; questions: Record<string, unknown>; model?: string }, opts?: { timeout?: number }):
    Promise<{ model: string; answers: Record<string, any> }>;
}

export const PATTERNS = {
  organic: 'Independent buyers arriving over time, supply spread out, no sign of one group in control',
  insider: 'A bundled or sniped launch: a few linked wallets bought most of the supply early and still hold it',
  dev_dump: 'The dev or early wallets are selling into new buyers',
  copycat: "A clone riding another token's name, image or X account",
  dead: 'Little real trading activity',
  too_early: 'Too little data to tell yet',
} as const;

export const RISK_LEVELS = [
  'Low: organic buyers, healthy distribution, dev not selling',
  'Moderate: one or two warning signs',
  'High: several red flags',
  'Extreme: looks set up to rug or dump on buyers',
] as const;

export const QUESTIONS = {
  scam: {
    type: 'noul',
    instructions: 'Based on the measured on-chain and social data, is this Solana meme coin likely a scam: a rug pull, a honeypot, a coordinated dump on buyers, a copycat of another token, or a launch controlled by one insider group?',
    criteria: {
      true: 'Likely a scam: insiders or the dev control the supply, the launch was bundled or sniped, the dev is selling, the identity is cloned, or there are no real independent buyers.',
      false: 'Looks like a genuine launch with independent buyers and no clear insider control.',
    },
  },
  risk: { type: 'score', instructions: 'How risky is buying this token right now?', criteria: [...RISK_LEVELS] },
  pattern: { type: 'choice', instructions: 'Which pattern best describes this launch?', criteria: { ...PATTERNS } },
};

const round = (n: number, d = 1) => { const f = 10 ** d; return Math.round(n * f) / f; };

/** What Jev sees: measurements only. Creator-written text is labelled untrusted. */
export function jevState(t: TokenState, cfg: Config, smartHolding: number, now = Date.now()) {
  const h = holderMetrics(t, cfg);
  const w5 = windowStats(t, WINDOWS['5m'], now);
  const devSoldPct = t.creatorMax > 0 ? Math.min(100, (t.creatorSold / t.creatorMax) * 100) : 0;
  const gates = Object.fromEntries(Object.entries(t.gates)
    .filter(([k]) => k !== 'jev')
    .map(([k, g]) => [k, `${g.status}: ${g.summary}`]));
  const launchData = t.source === 'pump' || t.source === 'replay';
  return {
    token: {
      name: t.name, ticker: t.symbol, age_minutes: round((now - t.createdAt) / 60_000),
      venue: t.graduated ? 'graduated to an AMM pool' : launchData ? 'pump.fun bonding curve' : 'found on DexScreener after launch',
      bonding_curve_progress_pct: launchData ? round(t.bondProgress) : null,
    },
    creator_written_text_untrusted: {
      description: (t.meta.description ?? '').slice(0, 280) || null,
      has_x: !!t.meta.twitter, has_telegram: !!t.meta.telegram, has_website: !!t.meta.website,
    },
    other_agents_verdicts: gates,
    supply: launchData ? {
      holders: h.holders, top10_pct: h.top10Pct, dev_pct: h.devPct,
      bought_in_launch_window_pct: h.bundlePct, launch_window_wallets: h.bundleWallets,
      lookalike_early_buys: h.linkedWallets, sniper_held_pct: h.sniperPct, snipers: h.snipers,
    } : { holders: h.holders },
    dev: t.creator ? { sold_pct_of_bag: round(devSoldPct), rugged_before_or_now: t.rugged } : null,
    trading: {
      buys_total: t.buys, sells_total: t.sells, wallets_that_sold: t.sellers.size,
      last_5m: { buys: w5.buys, sells: w5.sells, unique_buyers: w5.uniqueBuyers, volume_sol: round(w5.volSol, 2), price_change_pct: round(w5.changePct) },
      mcap_sol: round(t.mcapSol), drawdown_from_peak_pct: t.peakMcapSol > 0 ? round((1 - t.mcapSol / t.peakMcapSol) * 100) : 0,
      tracked_smart_wallets_holding: smartHolding,
    },
    dexscreener: t.external ? {
      liquidity_usd: t.external.liquidityUsd ?? null, volume_24h_usd: t.external.volume24hUsd ?? null,
      change_24h_pct: t.external.change24h ?? null, boosted: t.trending?.boosted ?? false,
    } : null,
  };
}

/** Turns Jev's typed answers into the verdict stored on the token. */
export function parseAnswers(answers: Record<string, any>, model: string, at = Date.now()): JevVerdict {
  const scam = Number(answers.scam?.noul);
  const risk = Number(answers.risk?.score);
  const pattern = String(answers.pattern?.choice ?? 'too_early');
  if (!Number.isFinite(scam) || !Number.isFinite(risk)) throw new Error('Jev returned an unexpected answer shape');
  return { at, model, scam, risk, pattern, patternConf: Number(answers.pattern?.confidence ?? 0) };
}

/** Pure gate: reads the last verdict, so it re-runs every evaluation for free. */
export function jevGate(t: TokenState, cfg: Config): AgentResult {
  const A = 'Jev scam judge';
  const at = Date.now();
  if (!cfg.jev.apiKey) return { agent: A, status: 'pending', summary: 'Not checked — add TYPESAFE_API_KEY to enable', at };
  const v = t.jev;
  if (!v) return { agent: A, status: 'pending', summary: 'Queued — judged once the token passes the other gates and shows traction', at };
  const pct = Math.round(v.scam * 100);
  const level = RISK_LEVELS[Math.max(0, Math.min(RISK_LEVELS.length - 1, Math.round(v.risk)))].split(':')[0];
  const label = PATTERNS[v.pattern as keyof typeof PATTERNS] ? v.pattern.replace('_', ' ') : 'unclear';
  const metrics = { scamProb: round(v.scam, 3), risk: round(v.risk, 2), pattern: v.pattern, model: v.model };
  const summary = `${pct}% scam probability · ${level} risk · pattern: ${label}`;
  if (v.scam >= cfg.jev.blockAt) return { agent: A, status: 'fail', summary, metrics, at: v.at };
  if (v.scam >= cfg.jev.warnAt || v.risk >= 2.5) return { agent: A, status: 'warn', summary, metrics, at: v.at };
  return { agent: A, status: 'pass', summary, metrics, at: v.at };
}

export class JevJudge {
  private cfg: Config;
  private client: SystemOneClient | null;
  private loading: Promise<SystemOneClient | null> | null = null;
  private day = '';
  calls = 0;
  failures = 0;
  lastError: string | null = null;

  constructor(cfg: Config, client: SystemOneClient | null = null) {
    this.cfg = cfg;
    this.client = client;
  }

  get enabled() { return !!this.cfg.jev.apiKey || !!this.client; }

  /** Calls left today (UTC). */
  get remaining() {
    this.rollDay();
    return Math.max(0, this.cfg.jev.dailyCalls - this.calls);
  }

  status() {
    return { enabled: this.enabled, model: this.cfg.jev.model, callsToday: this.calls, budget: this.cfg.jev.dailyCalls, failures: this.failures, lastError: this.lastError };
  }

  /** Should this token be (re)judged now? Cheap checks first; nothing here costs a call. */
  wants(t: TokenState, now = Date.now()): boolean {
    if (!this.enabled || t.jevQueued || t.status === 'blocked' || t.rugged) return false;
    if (t.jevTriedAt && now - t.jevTriedAt < this.cfg.jev.recheckMs) return false;
    if (t.score < this.cfg.jev.minScore) return false;
    const hardFail = ['contract', 'honeypot', 'vamp', 'dev'].some((k) => t.gates[k]?.status === 'fail');
    if (hardFail) return false;
    const traction = t.buys >= this.cfg.auditAfterBuys || (t.external?.m5?.buys ?? 0) >= 15;
    return traction && this.remaining > 0;
  }

  async judge(t: TokenState, smartHolding: number): Promise<JevVerdict | null> {
    const client = await this.getClient();
    if (!client || this.remaining <= 0) return null;
    this.calls++;
    try {
      const res = await client.systemOne(
        { state: jevState(t, this.cfg, smartHolding), questions: QUESTIONS, model: this.cfg.jev.model },
        { timeout: this.cfg.jev.timeoutMs },
      );
      this.lastError = null;
      return parseAnswers(res.answers, res.model);
    } catch (e: any) {
      this.failures++;
      this.lastError = `${e?.name ?? 'Error'}: ${String(e?.message ?? e).slice(0, 200)}`;
      log.warn('Jev', this.lastError);
      return null;
    }
  }

  private rollDay() {
    const d = new Date().toISOString().slice(0, 10);
    if (d !== this.day) { this.day = d; this.calls = 0; }
  }

  /** Loads TypeSafe's official SDK only when a key is set, so the engine runs without it. */
  private getClient(): Promise<SystemOneClient | null> {
    if (this.client) return Promise.resolve(this.client);
    this.loading ??= import('@typesafe-ai/sdk')
      .then(({ TypeSafeClient }) => {
        this.client = new TypeSafeClient({
          apiKey: this.cfg.jev.apiKey,
          defaultModel: this.cfg.jev.model,
          timeout: this.cfg.jev.timeoutMs,
          retry: { maxRetries: 1 },
          ...(this.cfg.jev.baseUrl ? { baseURL: this.cfg.jev.baseUrl } : {}),
        }) as unknown as SystemOneClient;
        log.info(`Jev scam judge on — model ${this.cfg.jev.model}, up to ${this.cfg.jev.dailyCalls.toLocaleString('en-US')} calls/day`);
        return this.client;
      })
      .catch((e) => {
        this.lastError = `Could not load @typesafe-ai/sdk (run npm install): ${e?.message ?? e}`;
        log.error(this.lastError);
        return null;
      });
    return this.loading;
  }
}
