import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { config } from '../config.ts';
import { openDb, markRug } from '../db.ts';
import { blankToken } from '../store.ts';
import { BudgetedFeed } from '../sources/feed.ts';

class FakePump {
  subs = new Set<string>();
  wallets: string[] = [];
  watch(m: string[]) { m.forEach((x) => this.subs.add(x)); }
  unwatch(m: string[]) { m.forEach((x) => this.subs.delete(x)); }
  watchWallets(w: string[]) { this.wallets = w; }
}

function setup(over: Partial<typeof config> = {}, at = Date.parse('2026-10-03T12:00:00Z')) {
  const clock = { t: at };
  const cfg = { ...config, pumpPortalKey: 'k', feedBudget: 1000, feedMaxSubs: 3, feedTrialMs: 30_000, feedTractionBuyers: 3, feedCoolMs: 60_000, ...over };
  const db = openDb(':memory:');
  const bus = new EventEmitter();
  const pump = new FakePump();
  const feed = new BudgetedFeed(pump as any, cfg, db, bus, () => clock.t);
  const tok = (creator = 'Dev') => blankToken({ mint: `M${Math.random()}`, name: 'x', symbol: 'X', creator, createdAt: clock.t, source: 'pump' });
  return { clock, cfg, db, bus, pump, feed, tok };
}

test('no API key = free mode, never subscribes', () => {
  const { feed, pump, tok } = setup({ pumpPortalKey: '' });
  feed.onCreated(tok());
  assert.equal(feed.mode, 'free');
  assert.equal(pump.subs.size, 0);
});

test('trial ends: tokens with traction stay, the rest are dropped', () => {
  const { feed, pump, tok, clock } = setup();
  const hot = tok(), cold = tok();
  feed.onCreated(hot); feed.onCreated(cold);
  assert.equal(pump.subs.size, 2);
  ['a', 'b', 'c', 'd'].forEach((w) => hot.firstBuyAt.set(w, clock.t));
  hot.lastActivity = clock.t + 29_000;
  clock.t += 31_000;
  feed.tick([hot, cold]);
  assert.ok(pump.subs.has(hot.mint));
  assert.ok(!pump.subs.has(cold.mint));
  clock.t += 120_000;
  feed.tick([hot, cold]);
  assert.ok(!pump.subs.has(hot.mint), 'quiet token dropped after cool-down');
});

test('known rugger launches are never trialed; cap on concurrent subs holds', () => {
  const { feed, pump, tok, db, clock } = setup();
  markRug(db, 'Rugger', clock.t);
  feed.onCreated(tok('Rugger'));
  assert.equal(pump.subs.size, 0);
  for (let i = 0; i < 5; i++) feed.onCreated(tok());
  assert.equal(pump.subs.size, 3);
});

test('spending is paced through the day and stops at the budget', () => {
  const { feed, pump, tok, bus, clock } = setup({ feedMaxSubs: 100 });
  // 12:00 UTC → about 55% of the 1000-event budget is available; trials stop at 80% of that.
  for (let i = 0; i < 450; i++) bus.emit('trade');
  feed.onCreated(tok());
  assert.equal(pump.subs.size, 0, 'trial refused when ahead of pace');
  const runner = tok(); runner.status = 'runner';
  for (let i = 0; i < 600; i++) bus.emit('trade');
  feed.tick([runner]);
  assert.ok(pump.subs.has(runner.mint), 'runners still covered up to 110%');
  const s = feed.status();
  assert.equal(s.eventsToday, 1050);
  assert.equal(s.estSolToday, 0.00105);
  clock.t += 13 * 3_600_000; // next UTC day
  feed.onCreated(tok());
  assert.equal(feed.status().eventsToday, 0);
});

test('daily meter survives a restart', () => {
  const { db, bus, cfg, clock, feed } = setup();
  for (let i = 0; i < 42; i++) bus.emit('trade');
  feed.flush();
  const again = new BudgetedFeed(new FakePump() as any, cfg, db, new EventEmitter(), () => clock.t);
  assert.equal(again.status().eventsToday, 42);
});
