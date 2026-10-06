import type { EventEmitter } from 'node:events';
import type { CreateEvent, TradeEvent, MigrateEvent } from '../types.ts';
import { log, num, str } from '../util.ts';

/**
 * PumpPortal real-time data stream (third-party pump.fun feed).
 * One shared connection: new tokens + migrations always, trades only for
 * tokens and wallets we are actively watching, to keep load and cost low.
 */
export class PumpPortal {
  status: 'connecting' | 'connected' | 'down' = 'down';
  private ws: WebSocket | null = null;
  private url: string;
  private bus: EventEmitter;
  private mints = new Set<string>();
  private wallets = new Set<string>();
  private backoff = 1000;
  private stopped = false;

  constructor(baseUrl: string, apiKey: string, bus: EventEmitter) {
    this.url = apiKey ? `${baseUrl}?api-key=${encodeURIComponent(apiKey)}` : baseUrl;
    this.bus = bus;
  }

  start() { this.stopped = false; this.connect(); }
  stop() { this.stopped = true; this.ws?.close(); }

  watch(mints: string[]) {
    const fresh = mints.filter((m) => !this.mints.has(m));
    fresh.forEach((m) => this.mints.add(m));
    if (fresh.length) this.send('subscribeTokenTrade', fresh);
  }

  unwatch(mints: string[]) {
    const gone = mints.filter((m) => this.mints.delete(m));
    if (gone.length) this.send('unsubscribeTokenTrade', gone);
  }

  watchWallets(wallets: string[]) {
    const want = new Set(wallets);
    const add = [...want].filter((w) => !this.wallets.has(w));
    const remove = [...this.wallets].filter((w) => !want.has(w));
    this.wallets = want;
    if (add.length) this.send('subscribeAccountTrade', add);
    if (remove.length) this.send('unsubscribeAccountTrade', remove);
  }

  private send(method: string, keys?: string[]) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!keys) { this.ws.send(JSON.stringify({ method })); return; }
    for (let i = 0; i < keys.length; i += 100) this.ws.send(JSON.stringify({ method, keys: keys.slice(i, i + 100) }));
  }

  private connect() {
    if (this.stopped) return;
    this.status = 'connecting';
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.status = 'connected';
      this.backoff = 1000;
      log.info('PumpPortal connected');
      this.send('subscribeNewToken');
      this.send('subscribeMigration');
      if (this.mints.size) this.send('subscribeTokenTrade', [...this.mints]);
      if (this.wallets.size) this.send('subscribeAccountTrade', [...this.wallets]);
    };
    ws.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data as ArrayBuffer).toString()); } catch { return; }
      this.route(msg);
    };
    ws.onerror = () => { /* onclose handles reconnect */ };
    ws.onclose = () => {
      this.status = 'down';
      if (this.stopped) return;
      log.warn(`PumpPortal disconnected, retrying in ${this.backoff}ms`);
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30_000);
    };
  }

  private route(m: any) {
    if (!m || typeof m !== 'object' || typeof m.mint !== 'string') return;
    const at = Date.now();
    const tx = m.txType;
    if (tx === 'create') {
      const e: CreateEvent = {
        mint: m.mint, name: str(m.name, 80), symbol: str(m.symbol, 20), uri: str(m.uri, 300),
        creator: str(m.traderPublicKey, 60), bondingCurve: str(m.bondingCurveKey, 60) || undefined,
        initialBuy: num(m.initialBuy), solAmount: num(m.solAmount), vSol: num(m.vSolInBondingCurve),
        vTokens: num(m.vTokensInBondingCurve), mcapSol: num(m.marketCapSol), signature: str(m.signature, 120), at, pool: str(m.pool, 30),
      };
      this.bus.emit('create', e);
    } else if (tx === 'buy' || tx === 'sell') {
      const e: TradeEvent = {
        mint: m.mint, wallet: str(m.traderPublicKey, 60), side: tx, tokens: num(m.tokenAmount), sol: num(m.solAmount),
        newBalance: m.newTokenBalance === undefined ? null : num(m.newTokenBalance),
        vSol: num(m.vSolInBondingCurve), vTokens: num(m.vTokensInBondingCurve), mcapSol: num(m.marketCapSol),
        signature: str(m.signature, 120), at, pool: str(m.pool, 30),
      };
      this.bus.emit('trade', e);
    } else if (tx === 'migrate' || (m.signature && !tx && m.pool)) {
      const e: MigrateEvent = { mint: m.mint, pool: str(m.pool, 30), signature: str(m.signature, 120), at };
      this.bus.emit('migrate', e);
    }
  }
}
