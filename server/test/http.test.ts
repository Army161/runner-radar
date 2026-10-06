import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = `/tmp/rr-http-test-${PORT}.db`;
let proc: ChildProcess;

before(async () => {
  const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.ts');
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', entry], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, DEMO: '1', ALLOW_DEV_LOGIN: '1', APP_URL: BASE,
      GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', NODE_ENV: 'test' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${BASE}/api/status`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});

after(() => { proc.kill(); for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true }); });

const cookieOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

test('security headers are set', async () => {
  const res = await fetch(`${BASE}/`);
  assert.match(res.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('protected API needs a session', async () => {
  assert.equal((await fetch(`${BASE}/api/me`)).status, 401);
  assert.equal((await fetch(`${BASE}/api/tokens`)).status, 401);
});

test('OAuth start sends PKCE S256 + state and sets a matching HttpOnly state cookie', async () => {
  const res = await fetch(`${BASE}/auth/google/start`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('location')!);
  assert.equal(loc.origin, 'https://accounts.google.com');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  assert.ok((loc.searchParams.get('code_challenge') ?? '').length >= 43);
  assert.equal(loc.searchParams.get('redirect_uri'), `${BASE}/auth/google/callback`);
  const state = loc.searchParams.get('state')!;
  const setCookie = res.headers.getSetCookie().join(';');
  assert.match(setCookie, new RegExp(`rr_oauth=${state}`));
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
});

test('OAuth callback rejects a missing or mismatched state (login CSRF)', async () => {
  const start = await fetch(`${BASE}/auth/google/start`, { redirect: 'manual' });
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const noCookie = await fetch(`${BASE}/auth/google/callback?code=x&state=${state}`, { redirect: 'manual' });
  assert.equal(noCookie.headers.get('location'), '/login?error=state');
  const wrong = await fetch(`${BASE}/auth/google/callback?code=x&state=${state}`, { redirect: 'manual', headers: { cookie: 'rr_oauth=somethingelse' } });
  assert.equal(wrong.headers.get('location'), '/login?error=state');
});

test('unconfigured providers are not available', async () => {
  const res = await fetch(`${BASE}/auth/discord/start`, { redirect: 'manual' });
  assert.equal(res.status, 404);
  const p = await (await fetch(`${BASE}/auth/providers`)).json();
  assert.deepEqual(p, { google: true, discord: false, x: false, dev: true });
});

test('state-changing requests from another origin are blocked', async () => {
  const res = await fetch(`${BASE}/auth/dev`, { method: 'POST', headers: { origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
});

test('session cookie is HttpOnly, opaque, and logout revokes it server-side', async () => {
  const login = await fetch(`${BASE}/auth/dev`, { method: 'POST', headers: { origin: BASE } });
  assert.equal(login.status, 200);
  const raw = login.headers.getSetCookie().join(';');
  assert.match(raw, /rr_session=[A-Za-z0-9_-]{40,}/);
  assert.match(raw, /HttpOnly/);
  const cookie = cookieOf(login);
  assert.equal((await fetch(`${BASE}/api/me`, { headers: { cookie } })).status, 200);
  const bad = await fetch(`${BASE}/api/settings`, { method: 'PUT', headers: { cookie, origin: BASE, 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(bad.status, 415);
  await fetch(`${BASE}/auth/logout`, { method: 'POST', headers: { cookie, origin: BASE } });
  assert.equal((await fetch(`${BASE}/api/me`, { headers: { cookie } })).status, 401);
});

test('static file serving cannot escape the web root', async () => {
  const res = await fetch(`${BASE}/..%2f..%2fpackage.json`);
  const text = await res.text();
  assert.ok(!text.includes('"engines"'));
});

test('prototype names are not treated as providers', async () => {
  for (const name of ['constructor', '__proto__', 'toString']) {
    const res = await fetch(`${BASE}/auth/${name}/start`, { redirect: 'manual' });
    assert.equal(res.status, 404, name);
  }
});

test('signed-in pages: watchlist, alerts inbox, admin, logout everywhere', async () => {
  const login = await fetch(`${BASE}/auth/dev`, { method: 'POST', headers: { origin: BASE } });
  const cookie = cookieOf(login);
  const mint = 'So11111111111111111111111111111111111111112';
  const h = { cookie, origin: BASE };
  assert.equal((await fetch(`${BASE}/api/watchlist/${mint}`, { method: 'POST', headers: h })).status, 200);
  const wl = await (await fetch(`${BASE}/api/watchlist`, { headers: h })).json();
  assert.equal(wl.items.length, 1);
  assert.equal(wl.items[0].mint, mint);
  const inbox = await (await fetch(`${BASE}/api/alerts`, { headers: h })).json();
  assert.deepEqual(inbox, { items: [], unread: 0 });
  const admin = await fetch(`${BASE}/api/admin`, { headers: h });
  assert.equal(admin.status, 200, 'local dev account is admin when dev login is on');
  const a = await admin.json();
  assert.ok(a.users.total >= 1);
  assert.ok('trackRecord' in a && 'feed' in a && 'errors' in a);
  const second = cookieOf(await fetch(`${BASE}/auth/dev`, { method: 'POST', headers: { origin: BASE } }));
  await fetch(`${BASE}/auth/logout-all`, { method: 'POST', headers: { cookie: second, origin: BASE } });
  assert.equal((await fetch(`${BASE}/api/me`, { headers: { cookie } })).status, 401, 'other sessions revoked too');
});

test('PWA manifest and icons are served', async () => {
  const m = await fetch(`${BASE}/manifest.webmanifest`);
  assert.equal(m.status, 200);
  assert.match(m.headers.get('content-type') ?? '', /manifest\+json/);
  assert.equal((await m.json()).start_url, '/app');
  assert.equal((await fetch(`${BASE}/icon-512.png`)).headers.get('content-type'), 'image/png');
});
