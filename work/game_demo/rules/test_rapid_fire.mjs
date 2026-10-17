import assert from 'node:assert/strict';
import { MedalRules, MedalGame } from './medal_rules.mjs';

assert.equal(new MedalRules().RapidFire, false);
assert.equal(MedalRules.fromJson('{"RapidFire":true}').RapidFire, true);
assert.throws(() => new MedalRules({ RapidFire: 'true' }));
for (const enabled of [false, true]) {
  const make = () => {
    const g = new MedalGame(new MedalRules({ RapidFire: enabled, LoanBalls: 30, JackpotAwards: [80], JackpotWeights: [100] }), 1);
    g.start(); assert.equal(g.canFire, false); g.advance(g.effectLeft); return g;
  };
  const land = (g, lane) => { const s = g.launch(); assert.ok(s); assert.equal(g.canFire, false); assert.equal(g.launch(), null); assert.ok(g.resolve(s.id, lane)); };
  const g = make(); land(g, 1);
  assert.equal(g.phase, 'Effect'); assert.equal(g.canFire, enabled); assert.equal(g.receipt.duration, .45);
  if (!enabled) g.advance(g.effectLeft);
  land(g, 1); assert.equal(g.receipt.kind, 'Protected'); assert.equal(g.canFire, enabled);
  if (!enabled) g.advance(g.effectLeft);
  for (const lane of [2, 3, 4]) { land(g, lane); if (!enabled) g.advance(g.effectLeft); }
  land(g, 4); assert.equal(g.receipt.kind, 'Reset'); assert.equal(g.canFire, false); assert.equal(g.launch(), null);
  g.advance(g.effectLeft);
  assert.ok(g.toggleChallenge()); land(g, 7); assert.equal(g.receipt.kind, 'Win'); assert.equal(g.canFire, false);
  g.advance(g.effectLeft); land(g, 1); if (!enabled) g.advance(g.effectLeft);
  assert.ok(g.toggleChallenge()); land(g, 1); assert.equal(g.receipt.kind, 'Miss'); assert.equal(g.canFire, false);
  const jp = make();
  for (const lane of [1, 2, 3, 4, 5, 6]) { land(jp, lane); if (!enabled) jp.advance(jp.effectLeft); }
  assert.equal(jp.toggleChallenge(), false); land(jp, 7); assert.equal(jp.receipt.jackpot, 0); assert.equal(jp.canFire, false);
  assert.equal(jp.wallet, jp.purchased + jp.won - jp.spent);
  const last = make(); last.secondsLeft = .01; land(last, 1); last.advance(.02);
  assert.equal(last.canFire, false); assert.equal(last.phase, 'Effect'); last.advance(last.effectLeft);
  assert.equal(last.phase, 'Continue'); assert.equal(last.endReason, '時間になりました');
  assert.ok(last.addCredit()); last.advance(last.effectLeft); last.wallet = 1; land(last, 2);
  assert.equal(last.canFire, false); assert.equal(last.phase, 'Effect'); last.advance(last.effectLeft);
  assert.equal(last.phase, 'Result'); assert.equal(last.endReason, '持ち玉を使いきりました');
  if (enabled) { const f = make(); land(f, 1); assert.ok(f.finish()); assert.equal(f.phase, 'Result'); }
}
console.log('PASS RapidFire: default/JSON, Fresh/Protected overlap, flight/reset/win/miss/JP locks, last ball/time, second boundary, finish');
