import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';
import { openDb } from '../db.ts';
import { config } from '../config.ts';
import { TIERS, tierOf } from '../billing.ts';
import { playbookFor } from '../playbook.ts';

const PORT = 19000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = `/tmp/rr-billing-test-${PORT}.db`;
const WHSEC = 'whsec_test_secret_for_suite';
let proc: ChildProcess;

before(async () => {
  const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.ts');
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', entry], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, DEMO: '1', ALLOW_DEV_LOGIN: '1', APP_URL: BASE, STRIPE_WEBHOOK_SECRET: WHSEC, NODE_ENV: 'test' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${BASE}/api/status`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});
after(() => { proc.kill(); for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true }); });

const cookieOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const login = async () => cookieOf(await fetch(`${BASE}/auth/dev`, { method: 'POST', headers: { origin: BASE } }));
const signed = (payload: string, secret = WHSEC, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;

test('plans endpoint is public and prices match config', async () => {
  const p = await (await fetch(`${BASE}/api/plans`)).json();
  assert.equal(p.checkout, 'demo');
  const pro = p.tiers.find((t: any) => t.tier === 'pro');
  assert.equal(pro.priceUsd, 29);
  assert.equal(p.tiers.find((t: any) => t.tier === 'apex').priceUsd, 79);
  assert.equal(p.tiers.find((t: any) => t.tier === 'free').priceUsd, 0);
});

test('free tier caps are enforced; demo upgrade lifts them', async () => {
  const cookie = await login();
  const h = { cookie, origin: BASE, 'content-type': 'application/json' };
  // free: 3 tracked wallets
  for (let i = 1; i <= 3; i++) {
    const r = await fetch(`${BASE}/api/wallets`, { method: 'POST', headers: h, body: JSON.stringify({ address: `W${String(i).padStart(43, '1')}` }) });
    assert.equal(r.status, 200, `wallet ${i}`);
  }
  const fourth = await fetch(`${BASE}/api/wallets`, { method: 'POST', headers: h, body: JSON.stringify({ address: `W${'4'.repeat(43)}` }) });
  assert.equal(fourth.status, 402);
  assert.match((await fourth.json()).error, /Scout tracks up to 3 wallets/);

  // playbook: only intro sections before upgrade
  const pb1 = await (await fetch(`${BASE}/api/playbook`, { headers: h })).json();
  assert.equal(pb1.tier, 'free');
  assert.ok(pb1.sections.filter((s: any) => s.unlocked).length === 2);
  assert.equal(pb1.sections.find((s: any) => s.id === 'exits').body, null);

  // demo checkout → pro
  const up = await (await fetch(`${BASE}/api/billing/checkout`, { method: 'POST', headers: h, body: JSON.stringify({ tier: 'pro' }) })).json();
  assert.deepEqual(up, { demo: true, tier: 'pro' });
  const me = await (await fetch(`${BASE}/api/me`, { headers: h })).json();
  assert.equal(me.plan.tier, 'pro');
  assert.equal(me.plan.limits.wallets, 25);
  assert.equal((await fetch(`${BASE}/api/wallets`, { method: 'POST', headers: h, body: JSON.stringify({ address: `W${'4'.repeat(43)}` }) })).status, 200);

  // playbook now unlocked through trader tier, creator section still locked
  const pb2 = await (await fetch(`${BASE}/api/playbook`, { headers: h })).json();
  assert.ok(pb2.sections.find((s: any) => s.id === 'exits').body);
  assert.equal(pb2.sections.find((s: any) => s.id === 'creators').body, null);

  // demo cancel via portal → back to free
  await fetch(`${BASE}/api/billing/portal`, { method: 'POST', headers: h });
  const me2 = await (await fetch(`${BASE}/api/me`, { headers: h })).json();
  assert.equal(me2.plan.tier, 'free');
});

test('webhook: rejects bad signatures, applies subscription events', async () => {
  const cookie = await login();
  const me = await (await fetch(`${BASE}/api/me`, { headers: { cookie } })).json();
  const userId = me.user.id;

  const sub = { id: 'sub_123', customer: 'cus_123', status: 'active', current_period_end: Math.floor(Date.now() / 1000) + 2592000, metadata: { user_id: userId }, items: { data: [{ price: { lookup_key: 'rr_apex_monthly', metadata: { tier: 'apex' } } }] } };
  const payload = JSON.stringify({ type: 'customer.subscription.updated', data: { object: sub } });

  const bad = await fetch(`${BASE}/api/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': signed(payload, 'whsec_wrong') }, body: payload });
  assert.equal(bad.status, 400);
  const stale = await fetch(`${BASE}/api/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': signed(payload, WHSEC, Math.floor(Date.now() / 1000) - 3600) }, body: payload });
  assert.equal(stale.status, 400);
  const none = await fetch(`${BASE}/api/billing/webhook`, { method: 'POST', body: payload });
  assert.equal(none.status, 400);

  const ok = await fetch(`${BASE}/api/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': signed(payload) }, body: payload });
  assert.equal(ok.status, 200);
  const after1 = await (await fetch(`${BASE}/api/me`, { headers: { cookie } })).json();
  assert.equal(after1.plan.tier, 'apex');

  const del = JSON.stringify({ type: 'customer.subscription.deleted', data: { object: { ...sub, status: 'canceled' } } });
  await fetch(`${BASE}/api/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': signed(del) }, body: del });
  const after2 = await (await fetch(`${BASE}/api/me`, { headers: { cookie } })).json();
  assert.equal(after2.plan.tier, 'free');
});

test('tierOf: admins are apex, expiry + grace downgrades', () => {
  const db = openDb(':memory:');
  const cfg = { ...config, adminEmails: ['boss@x.com'] };
  db.prepare("INSERT INTO users (id, name, email, created_at) VALUES ('u1', 'A', 'boss@x.com', 1), ('u2', 'B', 'b@x.com', 1)").run();
  assert.equal(tierOf(db, cfg, { id: 'u1', email: 'Boss@X.com' }), 'apex');
  assert.equal(tierOf(db, cfg, { id: 'u2', email: 'b@x.com' }), 'free');
  const ins = db.prepare("INSERT INTO subscriptions (user_id, tier, status, period_end, updated_at) VALUES ('u2', 'pro', ?, ?, 1) ON CONFLICT(user_id) DO UPDATE SET status=excluded.status, period_end=excluded.period_end");
  ins.run('active', Date.now() + 86400000);
  assert.equal(tierOf(db, cfg, { id: 'u2', email: 'b@x.com' }), 'pro');
  ins.run('past_due', Date.now() - 86400000); // within 3-day grace
  assert.equal(tierOf(db, cfg, { id: 'u2', email: 'b@x.com' }), 'pro');
  ins.run('past_due', Date.now() - 5 * 86400000); // past grace
  assert.equal(tierOf(db, cfg, { id: 'u2', email: 'b@x.com' }), 'free');
  ins.run('canceled', Date.now() + 86400000);
  assert.equal(tierOf(db, cfg, { id: 'u2', email: 'b@x.com' }), 'free');
});

test('playbook gating by tier', () => {
  assert.equal(playbookFor('free').filter((s) => s.unlocked).length, 2);
  assert.equal(playbookFor('pro').filter((s) => !s.unlocked).length, 1);
  assert.equal(playbookFor('apex').every((s) => s.unlocked && s.body), true);
  assert.equal(TIERS.free.exitSignals, false);
});
