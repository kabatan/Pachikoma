import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MedalRules, winSeconds } from './medal_rules.mjs';
import { MedalController } from '../ui/controller.mjs';
import { connectEffects, EffectsBus } from '../play/effects_bus.mjs';

const product = JSON.parse(readFileSync(new URL('../../game_tuning/proto/rules_final.json', import.meta.url)));
assert.equal(product.ResetWhileShooting, true);
assert.equal(product.ClockStopOnReset, false);
assert.equal(product.R2Enabled ?? false, true);   // 10/18 公開版：R2-T 推奨（経済80玉）を採用
assert.equal(product.LoanBalls, 80);
const create = (overrides = {}) => {
  const rules = new MedalRules({ ...product, R2Enabled: false, LoanBalls: 30, ResetWeightsByLamps: null, ResetWeights: [100, 0, 0, 0], ...overrides });
  const controller = new MedalController({ rules, seed: 123 });
  controller.dispatch('start'); controller.update(controller.game.effectLeft);
  const game = controller.game; game.firstProtection = false;
  return { controller, game };
};
const land = (game, lane) => {
  game.advance(Math.max(game.rules.FireInterval, game.effectLeft));
  const shot = game.launch(); assert.ok(shot);
  assert.equal(game.resolve(shot.id, lane), true);
  return game.receipt;
};
for (const lamps of [4, 5]) {
  const { game } = create({ ClockStopOnReset: true });
  game._lamps = new Set(Array.from({ length: lamps }, (_, index) => index + 1));
  const receipt = land(game, 1), remaining = game.secondsLeft;
  assert.equal(receipt.kind, 'Reset'); assert.equal(receipt.duration, 0);
  assert.equal(receipt.visualDuration, lamps === 4 ? 4.5 : 6);
  assert.equal(game.canAim, true);
  game.advance(.6); assert.equal(game.canFire, true);
  assert.ok(Math.abs(game.secondsLeft - (remaining - .6)) < 1e-8);
  assert.equal(game.clockStoppedSeconds, 0);
  assert.equal(game.resetDisplays.length, 1);
  assert.equal(game.launch().challenge, false);
}
for (const enabled of [false, true]) {
  const { game } = create({ ResetWhileShooting: enabled, ClockStopOnReset: true });
  game._lamps = new Set([1, 2, 3, 4]);
  const receipt = land(game, 1), remaining = game.secondsLeft;
  game.advance(.6);
  assert.equal(game.canFire, enabled);
  assert.equal(receipt.duration, enabled ? 0 : 6);
  assert.ok(Math.abs(game.secondsLeft - (remaining - (enabled ? .6 : 0))) < 1e-8);
}
{
  const { game } = create(); game._lamps = new Set([1, 2, 3, 4]);
  const receipts = [];
  for (const lane of [1, 2, 3, 4]) {
    receipts.push(land(game, lane));
    if (lane !== 4) land(game, lane);
    assert.ok(game.resetDisplays.length <= 3);
  }
  assert.deepEqual(receipts.map(receipt => receipt.resetSlot), [0, 1, 2, 0]);
  assert.deepEqual(receipts.map(receipt => receipt.resetReplaces), [null, null, null, receipts[0].id]);
  assert.deepEqual(game.resetDisplays.map(display => display.receiptId), receipts.slice(1).map(receipt => receipt.id));
  assert.equal(game.lampCount, 3);
  const displays = game.resetDisplays; displays[0].slot = 100;
  assert.ok(game.resetDisplays.every(display => display.slot < 3));
  game.advance(6); assert.equal(game.resetDisplays.length, 0);
  assert.equal(game.wallet, game.purchased + game.won - game.spent);
}
{
  const { game } = create({ ResetWhileShooting: true, ResetVisualSecondsByLamps: [0, 0, 0, 0, 0, 0] });
  game._lamps = new Set([1, 2, 3, 4]);
  assert.equal(land(game, 1).visualDuration, 0); assert.equal(game.resetDisplays.length, 0);
}
{
  const { game } = create({ MaxInFlight: 1 }); game._lamps = new Set([1, 2, 3, 4]);
  land(game, 1); assert.equal(game.canFire, true);
}
{
  const { game } = create({ FireInterval: 0 }); game._lamps = new Set([1, 2, 3]);
  const shots = [game.launch(), game.launch(), game.launch()];
  for (const [index, shot] of shots.entries()) game.resolve(shot.id, index + 1);
  assert.equal(game._pendingLandings.length, 0);
  assert.equal(game.shots.length, 0);
  assert.equal(game.lampCount, 0);
  assert.equal(game.resetDisplays.length, 3);
}
for (const win of [false, true]) {
  const { game } = create(); game._lamps = new Set([1, 2, 3, 4]);
  land(game, 1); game.advance(.6); assert.equal(game.toggleChallenge(), true);
  const shot = game.launch(); game.resolve(shot.id, win ? 7 : 2);
  assert.equal(game.receipt.kind, win ? 'Win' : 'Miss');
  assert.equal(game.canAim, false); assert.equal(game.canFire, false);
  assert.equal(game.receipt.duration, win ? winSeconds(game.receipt.award) : 1.35);
}
{
  const { game } = create(); game._lamps = new Set([1, 2, 3, 4]); land(game, 1);
  game.advance(.6); game._lamps = new Set([1, 2, 3, 4, 5, 6]); game.armed = true;
  const shot = game.launch(); game.resolve(shot.id, 7);
  assert.ok(game.receipt.jackpot >= 0); const remaining = game.secondsLeft;
  game.advance(6); assert.equal(game.canFire, false);
  assert.equal(game.secondsLeft, remaining); assert.equal(game.resetDisplays.length, 0);
}
{
  const { game } = create({ R2Enabled: true, ChallengePrepareSeconds: 1.4 });
  game._lamps = new Set([1, 2, 3, 4]); game.toggleChallenge();
  assert.equal(game.challengeStatus.stage, 'preparing'); assert.equal(game.canFire, false);
  game.advance(1); assert.equal(game.canFire, false);
}
{
  const { game } = create(); game._lamps = new Set([1, 2, 3, 4]);
  game.wallet = 1; game.purchased = 1;
  land(game, 1); assert.equal(game.wallet, 0); game.advance(.01);
  assert.equal(game.phase, 'Continue'); assert.equal(game.resetDisplays.length, 1);
}
{
  const outcomes = [];
  for (const enabled of [false, true]) {
    const { game } = create({ ResetWhileShooting: enabled, ClockStopOnReset: false, ResetWeights: [55, 25, 15, 5] });
    const receipts = [];
    for (let index = 0; index < 8; index++) {
      game._lamps = new Set([1, 2, 3, 4]);
      const receipt = land(game, 1);
      receipts.push({ choice: receipt.resetChoice, lamps: receipt.after, wallet: receipt.walletAfter });
    }
    outcomes.push(receipts);
  }
  assert.deepEqual(outcomes[0], outcomes[1]);
}
{
  const { controller, game } = create();
  const bus = new EffectsBus(), events = []; bus.on('roulette', event => events.push(event));
  const presenter = { on() { return () => {}; }, reveal: null, fx: {} };
  const bridge = connectEffects({ ctrl: controller, presenter, bus });
  game._lamps = new Set([1, 2, 3, 4]); land(game, 1);
  bridge.physics({ type: 'cup', cup: 1 });
  assert.equal(events.length, 1);
  assert.equal(events[0].data.duration, 4.5); assert.equal(events[0].data.ruleDuration, 0);
  assert.equal(events[0].data.maxConcurrent, 3); assert.equal(events[0].data.resetSlot, 0);
  assert.equal(bus.snapshot().state.resetDisplays.length, 1);
  bridge.dispose();
}
{
  const { controller, game } = create({ FireInterval: 0 });
  const bus = new EffectsBus(), results = []; bus.on('ascend', event => results.push(event));
  const bridge = connectEffects({ ctrl: controller, presenter: { on() { return () => {}; }, reveal: null, fx: {} }, bus });
  game._lamps = new Set([1, 2, 3, 4, 5]);
  const receipts = [];
  for (const lane of [1, 2, 3, 4]) {
    receipts.push(land(game, lane)); bridge.physics({ type: 'cup', cup: lane });
  }
  bridge.advance(1.2);
  assert.equal(results.length, 3);
  assert.deepEqual(results.map(event => event.data.receiptId), receipts.slice(1).map(receipt => receipt.id));
  bridge.dispose();
}
assert.equal(new MedalRules().ResetWhileShooting, false);
{
  const { game } = create({ LoanBalls: 40, ExtraLoanBalls: 15 });
  assert.equal(game.wallet, 40); assert.equal(game.rules.R2Enabled, false);
  game.phase = 'Continue'; assert.equal(game.addCredit(), true);
  assert.equal(game.receipt.award, 15); assert.equal(game.wallet, 55);
}
for (const raw of [{ ResetWhileShooting: 1 }, { ResetVisualSecondsByLamps: [0] },
  { ResetVisualSecondsByLamps: [0, 1, 1, 1, -1, 1] }]) assert.throws(() => new MedalRules(raw));
console.log('PASS default Reset shooting: nonblocking, continuous clock, separate visual duration, three slots/oldest restart, outcomes unchanged, locks preserved, bus and rollback');
