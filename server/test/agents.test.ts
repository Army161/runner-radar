import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { config } from '../config.ts';
import { openDb, getRep } from '../db.ts';
import { TokenStore, bondProgress } from '../store.ts';
import { contractAuditor, honeypotSimulator, vampDetector, bundleScan, devForensics, holderMetrics } from '../agents/gates.ts';
import type { GateCtx } from '../agents/gates.ts';
import { PRESETS, evaluateFor, sanitizeSettings } from '../agents/filters.ts';
import { Orchestrator } from '../agents/orchestrator.ts';
import { NoChain } from '../sources/chain.ts';
import { DemoFeed } from '../sources/feed.ts';
import type { CreateEvent, MintInfo, TradeEvent } from '../types.ts';

const cfg = { ...config, demo: false };
let n = 0;
const addr = () => `W${String(++n).padStart(43, '1')}`;

function launch(store: TokenStore, over: Partial<CreateEvent> = {}) {
  const now = Date.now();
  return store.create({
    mint: addr(), name: 'Test Frog', symbol: 'TFROG', uri: '', creator: addr(), initialBuy: 20_000_000, solAmount: 0.6,
    vSol: 30.6, vTokens: 1_053_000_000, mcapSol: 29, signature: 's', at: now, ...over,
  });
}

function trade(store: TokenStore, mint: string, wallet: string, side: 'buy' | 'sell', tokens: number, at = Date.now(), sol = 0.5): TradeEvent {
  const e: TradeEvent = { mint, wallet, side, tokens, sol, newBalance: null, vSol: 31, vTokens: 1_040_000_000, mcapSol: 30, signature: 's', at };
  store.applyTrade(e);
  return e;
}

const ctx = (over: Partial<GateCtx> = {}): GateCtx => ({ now: Date.now(), cfg, chainLive: true, vamp: null, rep: null, funderRep: null, ...over });
const mintInfo = (over: Partial<MintInfo> = {}): MintInfo => ({ program: 'spl', mintAuthority: null, freezeAuthority: null, decimals: 6, supply: 1e9, extensions: [], ...over });

test('bonding progress runs 0 → 100 across the pump.fun curve', () => {
  assert.equal(Math.round(bondProgress(cfg, 1_073_000_000)), 0);
  assert.equal(Math.round(bondProgress(cfg, cfg.pump.virtualOffset)), 100);
});

test('contract auditor fails live mint authority and passes clean mints', () => {
  const store = new TokenStore(cfg);
  const t = launch(store);
  assert.equal(contractAuditor(t, ctx()).status, 'pending');
  t.audit = { at: Date.now(), mint: mintInfo({ mintAuthority: addr() }), sellQuote: null, funder: null };
  assert.equal(contractAuditor(t, ctx()).status, 'fail');
  t.audit.mint = mintInfo();
  assert.equal(contractAuditor(t, ctx()).status, 'pass');
});

test('honeypot simulator: Token-2022 transfer hook fails, proven sells pass', () => {
  const store = new TokenStore(cfg);
  const t = launch(store);
  t.audit = { at: Date.now(), mint: mintInfo({ program: 'token2022', extensions: [{ name: 'transferHook', state: { programId: addr() } }] }), sellQuote: null, funder: null };
  assert.equal(honeypotSimulator(t, ctx()).status, 'fail');
  t.audit.mint = mintInfo();
  const a = addr(), b = addr();
  trade(store, t.mint, a, 'buy', 5_000_000); trade(store, t.mint, b, 'buy', 5_000_000);
  trade(store, t.mint, a, 'sell', 5_000_000); trade(store, t.mint, b, 'sell', 2_000_000);
  assert.equal(honeypotSimulator(t, ctx()).status, 'pass');
});

test('honeypot simulator warns on many buys with zero sells', () => {
  const store = new TokenStore(cfg);
  const t = launch(store, { at: Date.now() - 300_000 });
  for (let i = 0; i < 30; i++) trade(store, t.mint, addr(), 'buy', 1_000_000);
  assert.equal(honeypotSimulator(t, ctx()).status, 'warn');
});

test('vamp detector flags the later clone, orchestrator keeps the original clean', () => {
  const db = openDb(':memory:');
  const store = new TokenStore(cfg);
  const orch = new Orchestrator({ cfg, db, bus: new EventEmitter(), chain: new NoChain(), store, feed: new DemoFeed(), dex: null });
  const bus = (orch as any).d.bus as EventEmitter;
  orch.start();
  const now = Date.now();
  bus.emit('create', { mint: addr(), name: 'Glorp', symbol: 'GLORP', uri: '', creator: addr(), initialBuy: 1e7, solAmount: 0.3, vSol: 30.3, vTokens: 1.06e9, mcapSol: 28, signature: 's', at: now - 60_000 });
  const cloneMint = addr();
  bus.emit('create', { mint: cloneMint, name: 'GLORP', symbol: 'glorp', uri: '', creator: addr(), initialBuy: 1e7, solAmount: 0.3, vSol: 30.3, vTokens: 1.06e9, mcapSol: 28, signature: 's', at: now });
  const all = [...store.all()];
  for (const t of all) orch.evaluate(t);
  orch.stop();
  const clone = store.get(cloneMint)!;
  const orig = all.find((t) => t.mint !== cloneMint)!;
  assert.equal(clone.gates.vamp.status, 'fail');
  assert.equal(orig.gates.vamp.status, 'pass');
  assert.equal(clone.status, 'blocked');
  assert.equal(vampDetector(orig, ctx()).status, 'pass');
});

test('bundle scan measures launch-window buys and look-alike sizes', () => {
  const store = new TokenStore(cfg);
  const t = launch(store);
  for (let i = 0; i < 8; i++) trade(store, t.mint, addr(), 'buy', 40_000_000, t.createdAt + 300 + i * 50, 1.5);
  const h = holderMetrics(t, cfg);
  assert.ok(h.bundlePct >= 31, `bundle ${h.bundlePct}`);
  assert.ok(h.linkedWallets >= 8);
  assert.equal(bundleScan(t, ctx()).status, 'warn');
  const v = evaluateFor(t, PRESETS.balanced, cfg, 150, 0);
  assert.ok(v.blockedBy.some((b) => b.tag === 'BUNDLED'));
  const degen = evaluateFor(t, PRESETS.degen, cfg, 150, 0);
  assert.ok(!degen.blockedBy.some((b) => b.tag === 'BUNDLED'));
});

test('dev forensics: rug history blocks, rug is detected and remembered', () => {
  const db = openDb(':memory:');
  const store = new TokenStore(cfg);
  const orch = new Orchestrator({ cfg, db, bus: new EventEmitter(), chain: new NoChain(), store, feed: new DemoFeed(), dex: null });
  const t = launch(store);
  t.peakMcapSol = 200;
  trade(store, t.mint, t.creator, 'sell', 20_000_000);
  t.mcapSol = 40;
  orch.evaluate(t);
  assert.equal(t.rugged, true);
  assert.equal(t.gates.dev.status, 'fail');
  assert.equal(getRep(db, t.creator)?.rugs, 1);
  const next = launch(store, { creator: t.creator });
  const verdict = devForensics(next, ctx({ rep: getRep(db, t.creator) }));
  assert.equal(verdict.status, 'fail');
});

test('settings sanitizer ignores unknown keys and clamps ranges', () => {
  const s = sanitizeSettings({ limits: { maxBundle: 500, minScore: -4, evil: 1 }, gates: { vamp: 'no' }, preset: '__proto__' }, PRESETS.balanced);
  assert.equal(s.limits.maxBundle, 100);
  assert.equal(s.limits.minScore, 0);
  assert.equal((s.limits as any).evil, undefined);
  assert.equal(s.gates.vamp, true);
  assert.equal(s.preset, 'balanced');
  assert.equal(sanitizeSettings({ preset: 'strict' }, PRESETS.balanced).limits.maxBundle, PRESETS.strict.limits.maxBundle);
});
