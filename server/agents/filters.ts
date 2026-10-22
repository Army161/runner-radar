import type { TokenState, UserSettings } from '../types.ts';
import type { Config } from '../config.ts';
import { holderMetrics } from './gates.ts';
import { windowStats, WINDOWS } from './signals.ts';
import { clamp, num } from '../util.ts';

export const PRESETS: Record<UserSettings['preset'], UserSettings> = {
  degen: {
    preset: 'degen',
    gates: { honeypot: true, authority: true, vamp: true, devHistory: true, bundles: false, socials: false },
    limits: { maxBundle: 40, maxTop10: 45, maxDev: 10, maxSniper: 30, minScore: 55, minHolders: 50, minVolUsd: 5000, minSmart: 0 },
    alerts: { enabled: true, minScore: 75, devSell: true, scoreDrop: true, smartExit: true, graduate: false },
  },
  balanced: {
    preset: 'balanced',
    gates: { honeypot: true, authority: true, vamp: true, devHistory: true, bundles: true, socials: false },
    limits: { maxBundle: 25, maxTop10: 30, maxDev: 5, maxSniper: 15, minScore: 70, minHolders: 150, minVolUsd: 20000, minSmart: 0 },
    alerts: { enabled: true, minScore: 82, devSell: true, scoreDrop: true, smartExit: true, graduate: false },
  },
  strict: {
    preset: 'strict',
    gates: { honeypot: true, authority: true, vamp: true, devHistory: true, bundles: true, socials: true },
    limits: { maxBundle: 12, maxTop10: 22, maxDev: 3, maxSniper: 8, minScore: 80, minHolders: 300, minVolUsd: 50000, minSmart: 1 },
    alerts: { enabled: true, minScore: 88, devSell: true, scoreDrop: true, smartExit: true, graduate: true },
  },
};

const LIMIT_RANGES: Record<keyof UserSettings['limits'], [number, number]> = {
  maxBundle: [0, 100], maxTop10: [0, 100], maxDev: [0, 100], maxSniper: [0, 100],
  minScore: [0, 100], minHolders: [0, 100_000], minVolUsd: [0, 100_000_000], minSmart: [0, 50],
};

/** Merge untrusted input onto existing settings, keeping only known keys and sane ranges. */
export function sanitizeSettings(input: any, base: UserSettings): UserSettings {
  const out: UserSettings = structuredClone(base);
  if (input && typeof input === 'object') {
    if (typeof input.preset === 'string' && Object.hasOwn(PRESETS, input.preset)) {
      const p = structuredClone(PRESETS[input.preset as UserSettings['preset']]);
      out.preset = p.preset; out.gates = p.gates; out.limits = p.limits; out.alerts = { ...p.alerts, enabled: out.alerts.enabled };
    }
    for (const k of Object.keys(out.gates) as Array<keyof UserSettings['gates']>) {
      if (typeof input.gates?.[k] === 'boolean') out.gates[k] = input.gates[k];
    }
    for (const k of Object.keys(out.limits) as Array<keyof UserSettings['limits']>) {
      if (input.limits?.[k] !== undefined) { const [lo, hi] = LIMIT_RANGES[k]; out.limits[k] = clamp(num(input.limits[k], out.limits[k]), lo, hi); }
    }
    for (const k of ['enabled', 'devSell', 'scoreDrop', 'smartExit', 'graduate'] as const) {
      if (typeof input.alerts?.[k] === 'boolean') out.alerts[k] = input.alerts[k];
    }
    if (input.alerts?.minScore !== undefined) out.alerts.minScore = clamp(num(input.alerts.minScore, out.alerts.minScore), 0, 100);
  }
  return out;
}

export interface Verdict { blockedBy: Array<{ tag: string; why: string }>; meetsThresholds: boolean }

/** Applies one user's gates and limits to a token the agents have already analysed. */
export function evaluateFor(t: TokenState, s: UserSettings, cfg: Config, solUsd: number | null, smartCount: number, now = Date.now()): Verdict {
  const blockedBy: Verdict['blockedBy'] = [];
  const g = t.gates;
  if (s.gates.authority && g.contract?.status === 'fail') blockedBy.push({ tag: 'AUTHORITY', why: g.contract.summary });
  if (s.gates.honeypot && g.honeypot?.status === 'fail') blockedBy.push({ tag: 'HONEYPOT', why: g.honeypot.summary });
  if (s.gates.vamp && g.vamp?.status === 'fail') blockedBy.push({ tag: 'VAMP', why: g.vamp.summary });
  if (s.gates.devHistory && g.dev?.status === 'fail') blockedBy.push({ tag: t.rugged ? 'RUG' : 'DEV HISTORY', why: g.dev.summary });
  if (g.jev?.status === 'fail') blockedBy.push({ tag: 'AI SCAM', why: `Jev scam judge: ${g.jev.summary}` });
  if (s.gates.socials && !t.meta.twitter && !t.meta.telegram) blockedBy.push({ tag: 'NO SOCIALS', why: 'No X or Telegram linked' });

  const hasLaunchData = t.source === 'pump' || t.source === 'replay';
  if (hasLaunchData) {
    const h = holderMetrics(t, cfg);
    const L = s.limits;
    if (s.gates.bundles && h.bundlePct > L.maxBundle) blockedBy.push({ tag: 'BUNDLED', why: `${h.bundlePct}% bought in the launch window by ${h.bundleWallets} wallets (limit ${L.maxBundle}%)` });
    const mature = h.holders >= cfg.minHoldersForConcentration;
    if (mature && h.top10Pct > L.maxTop10) blockedBy.push({ tag: 'CONCENTRATED', why: `Top 10 wallets hold ${h.top10Pct}% (limit ${L.maxTop10}%)` });
    if (h.devPct > L.maxDev) blockedBy.push({ tag: 'DEV BAG', why: `Dev holds ${h.devPct}% (limit ${L.maxDev}%)` });
    if (mature && h.sniperPct > L.maxSniper) blockedBy.push({ tag: 'SNIPED', why: `Snipers hold ${h.sniperPct}% (limit ${L.maxSniper}%)` });
  }

  const vol = windowStats(t, WINDOWS['1h'], now).volSol;
  const volUsd = solUsd ? vol * solUsd : null;
  const holders = holderMetrics(t, cfg).holders;
  const meetsThresholds = t.score >= s.limits.minScore && holders >= s.limits.minHolders &&
    (volUsd === null || volUsd >= s.limits.minVolUsd) && smartCount >= s.limits.minSmart;
  return { blockedBy, meetsThresholds };
}
