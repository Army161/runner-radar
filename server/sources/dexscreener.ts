import type { EventEmitter } from 'node:events';
import type { WindowExt } from '../types.ts';
import { fetchJson, log } from '../util.ts';

const BASE = 'https://api.dexscreener.com';

export interface DexInfo {
  mint: string; name: string; symbol: string; pair?: string;
  mcapUsd?: number; liquidityUsd?: number; volume24hUsd?: number; change24h?: number; createdAt?: number;
  image?: string; twitter?: string; telegram?: string; website?: string;
  boosted: boolean; profile: boolean;
  m5?: WindowExt; h1?: WindowExt;
}

/**
 * Public DexScreener API: trending boosts and fresh token profiles on Solana.
 * Polled once a minute (3-4 requests), well inside the free limits.
 */
export class DexScreener {
  status: 'connected' | 'down' | 'off' = 'off';
  private bus: EventEmitter;
  private timer: NodeJS.Timeout | null = null;

  constructor(bus: EventEmitter) { this.bus = bus; }

  start(intervalMs = 60_000) {
    const run = () => this.poll().catch((e) => { this.status = 'down'; log.warn('DexScreener poll failed', e?.message); });
    run();
    this.timer = setInterval(run, intervalMs);
  }
  stop() { if (this.timer) clearInterval(this.timer); }

  private async poll() {
    let ok = 0;
    const get = (path: string) => fetchJson(`${BASE}${path}`).then((r) => { ok++; return r; }).catch(() => []);
    const [boostsLatest, boostsTop, profiles] = await Promise.all([
      get('/token-boosts/latest/v1'), get('/token-boosts/top/v1'), get('/token-profiles/latest/v1'),
    ]);
    if (!ok) throw new Error('all DexScreener endpoints unreachable');
    const boosted = new Set<string>();
    const profiled = new Set<string>();
    for (const b of [...asArr(boostsLatest), ...asArr(boostsTop)]) if (b?.chainId === 'solana' && b.tokenAddress) boosted.add(b.tokenAddress);
    for (const p of asArr(profiles)) if (p?.chainId === 'solana' && p.tokenAddress) profiled.add(p.tokenAddress);
    const mints = [...new Set([...boosted, ...profiled])].slice(0, 60);
    const infos = await this.lookup(mints);
    for (const i of infos) { i.boosted = boosted.has(i.mint); i.profile = profiled.has(i.mint); }
    this.status = 'connected';
    this.bus.emit('dex:trending', infos);
  }

  async lookup(mints: string[]): Promise<DexInfo[]> {
    const out: DexInfo[] = [];
    for (let i = 0; i < mints.length; i += 30) {
      const pairs = asArr(await fetchJson(`${BASE}/tokens/v1/solana/${mints.slice(i, i + 30).join(',')}`).catch(() => []));
      const best = new Map<string, any>();
      for (const p of pairs) {
        const m = p?.baseToken?.address;
        if (!m) continue;
        const cur = best.get(m);
        if (!cur || Number(p.liquidity?.usd ?? 0) > Number(cur.liquidity?.usd ?? 0)) best.set(m, p);
      }
      for (const [mint, p] of best) {
        const socials: any[] = p.info?.socials ?? [];
        out.push({
          mint, name: String(p.baseToken?.name ?? '?').slice(0, 80), symbol: String(p.baseToken?.symbol ?? '?').slice(0, 20),
          pair: p.pairAddress, mcapUsd: n(p.marketCap ?? p.fdv), liquidityUsd: n(p.liquidity?.usd), volume24hUsd: n(p.volume?.h24),
          change24h: n(p.priceChange?.h24), createdAt: n(p.pairCreatedAt), image: p.info?.imageUrl,
          twitter: socials.find((s) => s.type === 'twitter')?.url, telegram: socials.find((s) => s.type === 'telegram')?.url,
          website: p.info?.websites?.[0]?.url, boosted: false, profile: false,
          m5: win(p, 'm5'), h1: win(p, 'h1'),
        });
      }
    }
    return out;
  }
}

const win = (p: any, k: 'm5' | 'h1'): WindowExt | undefined =>
  p?.txns?.[k] ? { buys: Number(p.txns[k].buys ?? 0), sells: Number(p.txns[k].sells ?? 0), volUsd: Number(p.volume?.[k] ?? 0), change: Number(p.priceChange?.[k] ?? 0) } : undefined;
const asArr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
