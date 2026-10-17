// node physics/loan_reserve_test.mjs : 持ち玉が尽きた直後の追加100円で、最初の1球が待たされない(reserveForLoan)。
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { loadPlayConfig } from '../play/config.mjs';
import { PhysicsAdapter } from './adapter.mjs';
await RAPIER.init();
const CAB = new URL('../../cabinet/', import.meta.url);
const config = await loadPlayConfig(new URL('../../game_tuning/proto/config.json', import.meta.url).href, async p => readFileSync(new URL(p), 'utf8'));
async function firstLaunchWait(reserve) {
  const pa = await PhysicsAdapter.create(RAPIER, { readText: async (p) => readFileSync(new URL(p, CAB), 'utf8'), importModule: (p) => import(new URL(p, CAB).href), seed: 7, stageDir: config.stageDir, jitter: config.jitter, boardTimeScale: 0.35 });
  pa.beginGame(15); pa.stock = 0; pa.shuttleHas = false; pa.skipPayout = 0; pa.refillAt = pa.t + 1.0;   // 持ち玉が尽きた状態
  if (reserve) pa.reserveForLoan(15);
  pa.payout(15, true); pa.setAim(0.3, 1); pa.launch(1); const t0 = pa.t; let tl = null;
  for (let i = 0; i < 480 * 40 && tl === null; i++) { pa.step(); for (const e of pa.drainEvents()) if (e.type === 'launch') tl = pa.t - t0; }
  return tl;
}
const without = await firstLaunchWait(false), withR = await firstLaunchWait(true);
console.log(JSON.stringify({ without, withReserve: withR }));
assert.ok(without > 4, '予備球なしの最初の1球は遅い(実測6秒以上): ' + without);
assert.ok(withR < 0.3, '予備球ありは直ちに出る: ' + withR);
console.log('PASS loan reserve');
