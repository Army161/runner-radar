import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Config } from '../config.ts';
import { TokenBucket } from '../util.ts';

export interface User { id: string; name: string; email: string | null; avatar: string | null; onboarded: number }

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  ip: string;
  params: Record<string, string>;
  cookies: Record<string, string>;
  user: User | null;
  body: any;
}

export type Handler = (c: Ctx) => unknown | Promise<unknown>;
interface RouteOpts { auth?: boolean; limit?: 'auth' | 'scan' | 'api'; body?: boolean }
interface Route { method: string; re: RegExp; keys: string[]; handler: Handler; opts: RouteOpts }

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export class Router {
  routes: Route[] = [];
  add(method: string, path: string, handler: Handler, opts: RouteOpts = {}) {
    const keys: string[] = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handler, opts });
  }
  match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.re.exec(path);
      if (!m) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route, params };
    }
    return null;
  }
}

export function securityHeaders(res: ServerResponse, cfg: Config) {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' https: data:", "connect-src 'self'",
    "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (cfg.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

export function json(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

export function redirect(res: ServerResponse, location: string) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed */ }
  }
  return out;
}

export interface CookieOpts { maxAge?: number; path?: string; secure: boolean; sameSite?: 'Lax' | 'Strict' }

export function setCookie(res: ServerResponse, name: string, value: string, o: CookieOpts) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path ?? '/'}`, 'HttpOnly', `SameSite=${o.sameSite ?? 'Lax'}`];
  if (o.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(o.maxAge)}`);
  if (o.secure) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  const list = Array.isArray(prev) ? prev : prev ? [String(prev)] : [];
  res.setHeader('Set-Cookie', [...list, parts.join('; ')]);
}

export async function readJsonBody(req: IncomingMessage, limit = 32_768): Promise<any> {
  const type = req.headers['content-type'] ?? '';
  if (!type.startsWith('application/json')) throw new HttpError(415, 'Expected application/json');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'Body too large');
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

/** Per-IP token buckets for auth, scan and general API traffic. */
export class RateLimiter {
  private buckets = new Map<string, TokenBucket>();
  private specs = { auth: [20 / 60, 20], scan: [10 / 60, 10], api: [10, 300] } as const;
  constructor() { setInterval(() => this.buckets.clear(), 10 * 60_000).unref(); }
  allow(group: keyof RateLimiter['specs'], ip: string): boolean {
    const key = `${group}:${ip}`;
    let b = this.buckets.get(key);
    if (!b) { const [rate, cap] = this.specs[group]; b = new TokenBucket(rate, cap); this.buckets.set(key, b); }
    return b.take();
  }
}

/** Same-origin check for every state-changing request (CSRF defence alongside SameSite cookies). */
export function sameOrigin(req: IncomingMessage, cfg: Config): boolean {
  const origin = req.headers.origin;
  if (origin) return origin === new URL(cfg.appUrl).origin;
  return req.headers['sec-fetch-site'] === 'same-origin';
}

/** With N trusted proxies in front, the client IP is the Nth entry from the right of X-Forwarded-For. */
export function clientIp(req: IncomingMessage, trustedHops: number): string {
  if (trustedHops > 0) {
    const xff = req.headers['x-forwarded-for'];
    const parts = (Array.isArray(xff) ? xff.join(',') : xff ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const ip = parts[parts.length - trustedHops] ?? parts[0];
    if (ip) return ip;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

export function serveStatic(root: string, urlPath: string, res: ServerResponse): boolean {
  const base = resolve(root);
  const target = resolve(join(base, normalize(decodeURIComponent(urlPath))));
  if (target !== base && !target.startsWith(base + sep)) return false;
  let st;
  try { st = statSync(target); } catch { return false; }
  if (!st.isFile()) return false;
  const ext = extname(target);
  res.writeHead(200, {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
  });
  createReadStream(target).pipe(res);
  return true;
}
