import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const now = () => Date.now();
export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');
export const sha256B64url = (s: string) => createHash('sha256').update(s).digest('base64url');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const isBase58Address = (s: unknown): s is string => typeof s === 'string' && B58.test(s);

export function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function str(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** Lowercase alphanumerics with trailing digits removed, for clone matching. */
export function normName(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '').replace(/\d+$/, '');
}

export function twitterHandle(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(/(?:twitter\.com|x\.com)\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i);
  if (!m) return null;
  const h = m[1].toLowerCase();
  return ['i', 'home', 'search', 'intent', 'share'].includes(h) ? null : h;
}

/** Content identifier from an IPFS-style URL, or the URL itself. */
export function imageKey(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(/(?:ipfs\/|ipfs:\/\/)([A-Za-z0-9]{40,70})/);
  return m ? m[1] : url.length > 10 ? url : null;
}

/** Last errors, shown on the admin dashboard; onError lets the owner-alert system hear about them. */
export const recentErrors: Array<{ t: number; msg: string }> = [];
const errorHooks: Array<(msg: string) => void> = [];
export const onError = (fn: (msg: string) => void) => { errorHooks.push(fn); };

const fmt = (a: unknown[]) => a.map((x) => (x instanceof Error ? x.stack ?? x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ');

export const log = {
  info: (...a: unknown[]) => console.log(new Date().toISOString(), 'INFO', ...a),
  warn: (...a: unknown[]) => console.warn(new Date().toISOString(), 'WARN', ...a),
  error: (...a: unknown[]) => {
    console.error(new Date().toISOString(), 'ERROR', ...a);
    const msg = fmt(a).slice(0, 800);
    recentErrors.push({ t: Date.now(), msg });
    if (recentErrors.length > 50) recentErrors.shift();
    for (const h of errorHooks) { try { h(msg); } catch { /* never throw from logging */ } }
  },
};

/** Simple async concurrency queue that drops work when it backs up. */
export class WorkQueue {
  private running = 0;
  private q: Array<() => Promise<void>> = [];
  private concurrency: number;
  private maxQueue: number;
  constructor(concurrency: number, maxQueue = 500) {
    this.concurrency = concurrency;
    this.maxQueue = maxQueue;
  }
  push(job: () => Promise<void>): boolean {
    if (this.q.length >= this.maxQueue) return false;
    this.q.push(job);
    this.drain();
    return true;
  }
  get size() { return this.q.length + this.running; }
  private drain() {
    while (this.running < this.concurrency && this.q.length) {
      const job = this.q.shift()!;
      this.running++;
      job().catch((e) => log.warn('job failed', e?.message ?? e)).finally(() => { this.running--; this.drain(); });
    }
  }
}

/** Token bucket used for RPC pacing and HTTP rate limiting. */
export class TokenBucket {
  private tokens: number;
  private last = now();
  private rate: number;
  private cap: number;
  constructor(ratePerSec: number, capacity: number) {
    this.rate = ratePerSec;
    this.cap = capacity;
    this.tokens = capacity;
  }
  take(n = 1): boolean {
    const t = now();
    this.tokens = Math.min(this.cap, this.tokens + ((t - this.last) / 1000) * this.rate);
    this.last = t;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
  async wait(n = 1) {
    while (!this.take(n)) await sleep(Math.ceil(1000 / this.rate));
  }
}

export async function fetchJson(url: string, init: RequestInit & { timeoutMs?: number; maxBytes?: number } = {}): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url.split('?')[0]}`);
    const text = await res.text();
    if (init.maxBytes && text.length > init.maxBytes) throw new Error('response too large');
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}
