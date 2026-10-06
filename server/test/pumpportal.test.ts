import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PumpPortal } from '../sources/pumpportal.ts';

test('PumpPortal messages map to create / trade / migrate events', () => {
  const bus = new EventEmitter();
  const got: Record<string, any> = {};
  for (const k of ['create', 'trade', 'migrate']) bus.on(k, (e) => { got[k] = e; });
  const pp = new PumpPortal('wss://example.invalid', '', bus) as any;
  pp.route({ signature: 'sig1', mint: 'MintAAA', traderPublicKey: 'Dev111', txType: 'create', initialBuy: 35000000.5, solAmount: 1,
    bondingCurveKey: 'Curve1', vTokensInBondingCurve: 1037999999.5, vSolInBondingCurve: 31.01, marketCapSol: 29.87, name: 'Test <b>', symbol: 'TST', uri: 'https://ipfs.io/ipfs/Qm', pool: 'pump' });
  pp.route({ signature: 'sig2', mint: 'MintAAA', traderPublicKey: 'Buyer1', txType: 'buy', tokenAmount: 1000, solAmount: 0.5, newTokenBalance: 1000,
    bondingCurveKey: 'Curve1', vTokensInBondingCurve: 1, vSolInBondingCurve: 2, marketCapSol: 30, pool: 'pump' });
  pp.route({ signature: 'sig3', mint: 'MintAAA', txType: 'migrate', pool: 'pump-amm' });
  pp.route({ message: 'Successfully subscribed to keys.' });
  pp.route('garbage');
  assert.equal(got.create.creator, 'Dev111');
  assert.equal(got.create.initialBuy, 35000000.5);
  assert.equal(got.create.name, 'Test <b>');
  assert.equal(got.trade.side, 'buy');
  assert.equal(got.trade.newBalance, 1000);
  assert.equal(got.migrate.pool, 'pump-amm');
});
