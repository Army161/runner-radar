import type { MintInfo } from '../types.ts';
import { TokenBucket, fetchJson, log } from '../util.ts';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export interface Chain {
  readonly live: boolean;
  mintInfo(mint: string): Promise<MintInfo | null>;
  funderOf(wallet: string): Promise<string | null>;
  sellQuote(mint: string, uiAmount: number, decimals: number): Promise<{ ok: boolean; impactPct?: number } | null>;
  solUsd(): Promise<number | null>;
}

/** Token-2022 extensions that let an issuer block or tax selling. */
export function dangerousExtensions(info: MintInfo): string[] {
  const out: string[] = [];
  for (const e of info.extensions) {
    const n = e.name;
    if (n === 'transferHook' && e.state?.programId) out.push('transfer hook (custom code runs on every transfer)');
    else if (n === 'permanentDelegate' && e.state?.delegate) out.push('permanent delegate (can move anyone’s tokens)');
    else if (n === 'nonTransferable') out.push('non-transferable');
    else if (n === 'defaultAccountState' && String(e.state?.accountState).toLowerCase() === 'frozen') out.push('accounts frozen by default');
    else if (n === 'pausableConfig' || n === 'pausable') { if (!e.state || e.state.paused !== false) out.push('pausable transfers'); }
    else if (n === 'transferFeeConfig') {
      const bps = Number(e.state?.newerTransferFee?.transferFeeBasisPoints ?? e.state?.olderTransferFee?.transferFeeBasisPoints ?? 0);
      if (bps > 0) out.push(`transfer fee ${(bps / 100).toFixed(2)}%`);
    }
  }
  return out;
}

export class RpcChain implements Chain {
  readonly live = true;
  private url: string;
  private bucket: TokenBucket;
  private useJupiter: boolean;
  private solPrice: { v: number; at: number } | null = null;
  private id = 0;

  constructor(url: string, maxRps: number, useJupiter: boolean) {
    this.url = url;
    this.bucket = new TokenBucket(maxRps, maxRps);
    this.useJupiter = useJupiter;
  }

  private async rpc(method: string, params: unknown[]): Promise<any> {
    await this.bucket.wait();
    const body = JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params });
    const res = await fetchJson(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, timeoutMs: 10_000 });
    if (res.error) throw new Error(`${method}: ${res.error.message ?? 'rpc error'}`);
    return res.result;
  }

  async mintInfo(mint: string): Promise<MintInfo | null> {
    const r = await this.rpc('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    const v = r?.value;
    const info = v?.data?.parsed?.info;
    if (!info) return null;
    return {
      program: v.owner === TOKEN_2022 ? 'token2022' : 'spl',
      mintAuthority: info.mintAuthority ?? null,
      freezeAuthority: info.freezeAuthority ?? null,
      decimals: Number(info.decimals ?? 6),
      supply: Number(info.supply ?? 0) / 10 ** Number(info.decimals ?? 6),
      extensions: Array.isArray(info.extensions) ? info.extensions.map((e: any) => ({ name: String(e.extension), state: e.state })) : [],
    };
  }

  /** First wallet that sent SOL to a fresh deployer. Costs 2 RPC calls; skipped for busy wallets. */
  async funderOf(wallet: string): Promise<string | null> {
    const sigs = await this.rpc('getSignaturesForAddress', [wallet, { limit: 1000 }]);
    if (!Array.isArray(sigs) || sigs.length === 0 || sigs.length >= 1000) return null;
    const oldest = sigs[sigs.length - 1].signature;
    const tx = await this.rpc('getTransaction', [oldest, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
    const ixs: any[] = tx?.transaction?.message?.instructions ?? [];
    for (const ix of ixs) {
      const p = ix?.parsed;
      if (ix?.program === 'system' && p?.type === 'transfer' && p.info?.destination === wallet) return String(p.info.source);
    }
    return null;
  }

  async sellQuote(mint: string, uiAmount: number, decimals: number) {
    if (!this.useJupiter) return null;
    const amount = BigInt(Math.max(1, Math.floor(uiAmount * 10 ** decimals))).toString();
    try {
      const q = await fetchJson(`https://lite-api.jup.ag/swap/v1/quote?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${amount}&slippageBps=1500`, { timeoutMs: 6000 });
      const ok = Number(q?.outAmount ?? 0) > 0;
      return { ok, impactPct: q?.priceImpactPct !== undefined ? Number(q.priceImpactPct) * 100 : undefined };
    } catch (e: any) {
      if (String(e?.message).includes('HTTP 400')) return { ok: false };
      return null;
    }
  }

  async solUsd(): Promise<number | null> {
    if (this.solPrice && Date.now() - this.solPrice.at < 60_000) return this.solPrice.v;
    try {
      const r = await fetchJson(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`, { timeoutMs: 5000 });
      const v = Number(r?.[SOL_MINT]?.usdPrice);
      if (v > 0) this.solPrice = { v, at: Date.now() };
    } catch (e: any) {
      log.warn('SOL price fetch failed', e?.message);
    }
    return this.solPrice?.v ?? null;
  }
}

/** Used when no RPC is configured: on-chain checks report "pending" instead of guessing. */
export class NoChain implements Chain {
  readonly live = false;
  async mintInfo() { return null; }
  async funderOf() { return null; }
  async sellQuote() { return null; }
  async solUsd() { return null; }
}
