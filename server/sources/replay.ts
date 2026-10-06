import type { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import type { Chain } from './chain.ts';
import type { MintInfo } from '../types.ts';

/**
 * DEMO MODE ONLY. Simulates pump.fun launches on a real constant-product curve,
 * including the scam patterns the agents must catch. Nothing here is real data.
 */

type Arch = 'runner' | 'dud' | 'bundled' | 'vamp' | 'honeypot' | 'authority' | 'rug' | 'serial';
const ARCH_WEIGHTS: Array<[Arch, number]> = [
  ['dud', 30], ['runner', 18], ['bundled', 10], ['vamp', 9], ['honeypot', 6], ['authority', 6], ['rug', 12], ['serial', 9],
];
const LIFETIME: Record<Arch, number> = { runner: 14 * 60_000, dud: 70_000, bundled: 5 * 60_000, vamp: 3 * 60_000, honeypot: 4 * 60_000, authority: 3 * 60_000, rug: 4 * 60_000, serial: 3 * 60_000 };

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function fakeAddress(suffix = ''): string {
  const bytes = randomBytes(44);
  let s = '';
  for (let i = 0; i < 44 - suffix.length; i++) s += B58[bytes[i] % 58];
  return s + suffix;
}

const ADJ = ['Lil', 'Based', 'Turbo', 'Sir', 'Baby', 'Mega', 'Sleepy', 'Angry', 'Tiny', 'Cosmic', 'Wet', 'Golden', 'Feral', 'Smol', 'Rich', 'Sad', 'Space', 'Hyper'];
const NAMES = ['Glorp', 'Skrrt', 'Otter', 'Ducky', 'Beanz', 'Honk', 'Womp', 'Pebble', 'Toad', 'Crumb', 'Bonk', 'Zoomer', 'Yam', 'Snorlax', 'Biscuit', 'Mole', 'Wobble', 'Snail', 'Pig', 'Gronk', 'Frog', 'Hamster', 'Goose', 'Pickle'];

interface Sim {
  mint: string; arch: Arch; creator: string; start: number; vSol: number; vTokens: number;
  balances: Map<string, number>; holders: string[]; done: boolean; name: string; symbol: string; image: string;
  rugAt: number; heat: number; migrated: boolean;
}

export class Replay {
  readonly smartWallets = Array.from({ length: 6 }, () => fakeAddress());
  private bus: EventEmitter;
  private sims = new Map<string, Sim>();
  private archOf = new Map<string, Arch>();
  private ruggers: string[] = [];
  private ruggerFunders = new Map<string, string>();
  private recentRunners: Sim[] = [];
  private timers: NodeJS.Timeout[] = [];

  constructor(bus: EventEmitter) { this.bus = bus; }

  start() {
    this.timers.push(setInterval(() => this.spawn(), 2200));
    this.timers.push(setInterval(() => this.step(), 300));
    for (let i = 0; i < 6; i++) this.spawn('runner');
  }
  stop() { this.timers.forEach(clearInterval); }

  archetype(mint: string) { return this.archOf.get(mint); }
  funderFor(wallet: string) { return this.ruggerFunders.get(wallet) ?? null; }

  private pick(): Arch {
    const total = ARCH_WEIGHTS.reduce((a, [, w]) => a + w, 0);
    let r = Math.random() * total;
    for (const [a, w] of ARCH_WEIGHTS) { if ((r -= w) <= 0) return a; }
    return 'dud';
  }

  private spawn(force?: Arch) {
    if (this.sims.size >= 45) return;
    let arch = force ?? this.pick();
    if (arch === 'vamp' && !this.recentRunners.length) arch = 'dud';
    if (arch === 'serial' && !this.ruggers.length) arch = 'rug';
    const base = `${ADJ[Math.floor(Math.random() * ADJ.length)]} ${NAMES[Math.floor(Math.random() * NAMES.length)]}`;
    let name = base, symbol = base.split(' ')[1].toUpperCase().slice(0, 6), image = `ipfs://${fakeAddress()}`;
    if (arch === 'vamp') {
      const orig = this.recentRunners[Math.floor(Math.random() * this.recentRunners.length)];
      name = orig.name; symbol = orig.symbol; image = orig.image;
    }
    const creator = arch === 'serial' ? this.ruggers[Math.floor(Math.random() * this.ruggers.length)] : fakeAddress();
    const mint = fakeAddress('pump');
    const s: Sim = {
      mint, arch, creator, start: Date.now(), vSol: 30, vTokens: 1_073_000_000, balances: new Map(), holders: [], done: false,
      name, symbol, image, rugAt: 50_000 + Math.random() * 60_000, heat: arch === 'runner' ? 0.9 + Math.random() * 0.8 : 0.35, migrated: false,
    };
    this.sims.set(mint, s);
    this.archOf.set(mint, arch);
    const devSol = arch === 'rug' || arch === 'serial' ? 3 + Math.random() * 2 : 0.3 + Math.random() * 1.2;
    const got = this.buy(s, devSol);
    s.balances.set(creator, got);
    const socials = arch === 'dud' && Math.random() < 0.5 ? {} : { twitter: `https://x.com/${symbol.toLowerCase()}${arch === 'vamp' ? '' : Math.floor(Math.random() * 999)}`, telegram: `https://t.me/${symbol.toLowerCase()}portal` };
    this.bus.emit('create', {
      mint, name, symbol, uri: '', creator, bondingCurve: fakeAddress(), initialBuy: got, solAmount: devSol,
      vSol: s.vSol, vTokens: s.vTokens, mcapSol: this.mcap(s), signature: fakeAddress(), at: Date.now(), pool: 'pump',
      meta: { image, description: `${name} — demo token`, ...socials },
    });
    if (arch === 'bundled') {
      const amt = 1.5 + Math.random();
      for (let i = 0; i < 9; i++) setTimeout(() => this.trade(s, fakeAddress(), 'buy', amt * (0.995 + Math.random() * 0.01)), 150 + i * 90);
    }
  }

  private mcap(s: Sim) { return (s.vSol / s.vTokens) * 1_000_000_000; }

  private buy(s: Sim, sol: number): number {
    const k = s.vSol * s.vTokens;
    const nv = s.vSol + sol;
    const out = s.vTokens - k / nv;
    s.vSol = nv; s.vTokens = k / nv;
    return out;
  }

  private sell(s: Sim, tokens: number): number {
    const k = s.vSol * s.vTokens;
    const nt = s.vTokens + tokens;
    const out = s.vSol - k / nt;
    s.vTokens = nt; s.vSol = k / nt;
    return out;
  }

  private trade(s: Sim, wallet: string, side: 'buy' | 'sell', amount: number) {
    if (s.done) return;
    let tokens: number, sol: number;
    if (side === 'buy') { sol = amount; tokens = this.buy(s, sol); s.balances.set(wallet, (s.balances.get(wallet) ?? 0) + tokens); if (!s.holders.includes(wallet)) s.holders.push(wallet); }
    else { tokens = Math.min(amount, s.balances.get(wallet) ?? 0); if (tokens <= 0) return; sol = this.sell(s, tokens); s.balances.set(wallet, (s.balances.get(wallet) ?? 0) - tokens); }
    this.bus.emit('trade', {
      mint: s.mint, wallet, side, tokens, sol, newBalance: s.balances.get(wallet) ?? 0,
      vSol: s.vSol, vTokens: s.vTokens, mcapSol: this.mcap(s), signature: fakeAddress(), at: Date.now(), pool: 'pump',
    });
    if (s.vTokens <= 279_900_000 && !s.migrated) {
      s.migrated = true;
      this.bus.emit('migrate', { mint: s.mint, pool: 'pump-amm', at: Date.now() });
    }
  }

  private step() {
    const t = Date.now();
    for (const s of this.sims.values()) {
      const age = t - s.start;
      if (age > LIFETIME[s.arch] || s.done) {
        this.sims.delete(s.mint);
        if (s.arch === 'runner') { this.recentRunners.push(s); if (this.recentRunners.length > 8) this.recentRunners.shift(); }
        continue;
      }
      const r = Math.random();
      switch (s.arch) {
        case 'runner': {
          const rate = s.heat * (age < 20_000 ? 0.16 : 0.28);
          if (r < rate) this.trade(s, fakeAddress(), 'buy', 0.04 + Math.random() * 0.5 * s.heat);
          if (r > 0.86 && s.holders.length > 4) this.trade(s, s.holders[Math.floor(Math.random() * s.holders.length)], 'sell', 2_000_000 + Math.random() * 6_000_000);
          if (s.heat > 1.25 && age > 40_000 && age < 240_000 && r > 0.985) this.trade(s, this.smartWallets[Math.floor(Math.random() * this.smartWallets.length)], 'buy', 2 + Math.random() * 4);
          break;
        }
        case 'dud':
          if (age < 30_000 && r < 0.15) this.trade(s, fakeAddress(), 'buy', 0.05 + Math.random() * 0.4);
          if (age > 20_000 && r > 0.93 && s.holders.length) this.trade(s, s.holders[0], 'sell', 1e12);
          break;
        case 'honeypot':
          if (r < 0.4) this.trade(s, fakeAddress(), 'buy', 0.2 + Math.random() * 1.2);
          break;
        case 'rug':
        case 'serial':
          if (age < s.rugAt && r < 0.5) this.trade(s, fakeAddress(), 'buy', 0.2 + Math.random() * 1.5);
          if (age >= s.rugAt && (s.balances.get(s.creator) ?? 0) > 1) {
            this.trade(s, s.creator, 'sell', 1e12);
            if (!this.ruggers.includes(s.creator)) {
              this.ruggers.push(s.creator);
              this.ruggerFunders.set(s.creator, fakeAddress());
            }
          }
          break;
        default:
          if (r < 0.3) this.trade(s, fakeAddress(), 'buy', 0.1 + Math.random());
          if (r > 0.9 && s.holders.length > 3) this.trade(s, s.holders[Math.floor(Math.random() * s.holders.length)], 'sell', 3_000_000);
      }
    }
  }
}

/** Chain stand-in for demo mode: answers on-chain checks from each simulated token's archetype. */
export class ReplayChain implements Chain {
  readonly live = true;
  private replay: Replay;
  constructor(replay: Replay) { this.replay = replay; }
  async mintInfo(mint: string): Promise<MintInfo | null> {
    const a = this.replay.archetype(mint);
    if (!a) return null;
    return {
      program: 'token2022', mintAuthority: a === 'authority' ? fakeAddress() : null,
      freezeAuthority: a === 'honeypot' ? fakeAddress() : null, decimals: 6, supply: 1_000_000_000,
      extensions: a === 'honeypot' ? [{ name: 'transferHook', state: { programId: fakeAddress() } }] : [{ name: 'metadataPointer', state: {} }],
    };
  }
  async funderOf(wallet: string) { return this.replay.funderFor(wallet); }
  async sellQuote(mint: string) { return { ok: this.replay.archetype(mint) !== 'honeypot', impactPct: 3 }; }
  async solUsd() { return 150; }
}
