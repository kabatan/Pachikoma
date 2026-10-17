import assert from 'node:assert/strict';
import { MedalRules, MedalGame } from './medal_rules.mjs';

const mk = (o = {}, seed = 1) => {
  const g = new MedalGame(new MedalRules({ MaxInFlight: 3, FireInterval: 0.6, LoanBalls: 30, JackpotAwards: [80], JackpotWeights: [100], ...o }), seed);
  g.start(); g.advance(g.effectLeft); return g;
};
assert.equal(new MedalRules().MaxInFlight, 1);
assert.throws(() => new MedalRules({ MaxInFlight: 0 })); assert.throws(() => new MedalRules({ FireInterval: -1 }));

// 1) 間隔・同時数
{
  const g = mk(); const a = g.launch(); assert.ok(a);
  assert.equal(g.canFire, false);   // 間隔待ち
  assert.equal(g.canAim, true);     // 狙いは止めない
  g.advance(0.59); assert.equal(g.canFire, false); g.advance(0.02); assert.equal(g.canFire, true);
  const b = g.launch(), _ = (g.advance(0.6), g.launch()); assert.ok(b && _);
  g.advance(0.6); assert.equal(g.shots.length, 3); assert.equal(g.canFire, false);   // 同時3球まで
  assert.ok(g.resolve(a.id, 1)); assert.equal(g.receipt.kind, 'Fresh'); assert.equal(g.canFire, true);   // 0.45秒の保護ロック中でも撃てる
  assert.ok(g.resolve(b.id, 2)); assert.ok(g.resolve(_.id, 3));
  assert.deepEqual(g.lamps, [1, 2, 3]); assert.equal(g.shots.length, 0);
  assert.equal(g.wallet, 30 - 3 + 0);
}
// 2) 灯+盤上の通常球は6を超えない
{
  const g = mk({ FireInterval: 0 });
  for (const l of [1, 2, 3, 4]) { const s = g.launch(); g.resolve(s.id, l); g.advance(g.effectLeft); }
  assert.equal(g.lampCount, 4);
  const s1 = g.launch(), s2 = g.launch(); assert.ok(s1 && s2); assert.equal(g.canFire, false); assert.equal(g.launch(), null);
  g.resolve(s1.id, 5); g.resolve(s2.id, 6); assert.equal(g.lampCount, 6); assert.equal(g.armed, true);
}
// 3) 勝負は盤上が空のときだけ。勝負球の間は他を撃てない
{
  const g = mk({ FireInterval: 0 });
  const a = g.launch(); g.resolve(a.id, 1); g.advance(g.effectLeft);
  const b = g.launch(); assert.equal(g.toggleChallenge(), false); assert.equal(g.armed, false);
  g.resolve(b.id, 2); g.advance(g.effectLeft);
  assert.equal(g.toggleChallenge(), true); assert.equal(g.armed, true);
  const c = g.launch(); assert.equal(c.challenge, true); assert.equal(g.phase, 'Flight'); assert.equal(g.canFire, false); assert.equal(g.launch(), null);
  g.resolve(c.id, 7); assert.equal(g.receipt.kind, 'Win'); assert.equal(g.lampCount, 0); assert.equal(g.canFire, false);
  g.advance(g.effectLeft); assert.equal(g.canFire, true);
}
// 4) 長いロック中に着いた玉は演出後に反映される
{
  const g = mk({ FireInterval: 0, ResetEffectSecondsByLamps: [0, 0.5, 0.5, 0.5, 6, 12] });
  for (const l of [1, 2, 3, 4]) { const s = g.launch(); g.resolve(s.id, l); g.advance(g.effectLeft); }
  g.firstProtection = false;
  const a = g.launch(), b = g.launch();
  g.resolve(a.id, 4);   // 重複: 4灯のルーレット(長いロック)
  assert.equal(g.receipt.kind, 'Reset'); assert.ok(g.receipt.duration > 3); assert.equal(g.canFire, false);
  const lampsAfterA = g.lamps.length;
  assert.ok(g.resolve(b.id, 6)); assert.equal(g.lamps.length, lampsAfterA);   // まだ反映されない
  assert.equal(g.shots.length, 1);
  g.advance(g.effectLeft - 0.01); assert.equal(g.shots.length, 1);
  g.advance(0.02); assert.equal(g.shots.length, 0); assert.ok(g.receipt.lane === 6);
}
// 5) 終了は盤上の玉が着くまで待つ。計数も同様
{
  const g = mk({ FireInterval: 0 }); g.secondsLeft = 0.5;
  const a = g.launch(), b = g.launch(); g.advance(1); assert.equal(g.secondsLeft, 0); assert.equal(g.phase, 'Ready');
  assert.equal(g.canFire, false); assert.equal(g.finish(), false);
  g.resolve(a.id, 1); g.advance(g.effectLeft); assert.equal(g.phase, 'Ready');
  g.resolve(b.id, 2); g.advance(g.effectLeft); assert.equal(g.phase, 'Continue');
  assert.equal(g.wallet, g.purchased + g.won - g.spent);
}
// 6) 故障は盤上の玉を全部返す
{
  const g = mk({ FireInterval: 0 }); const a = g.launch(), b = g.launch(); g.launch();
  assert.ok(g.resolve(b.id, 0, false)); assert.equal(g.phase, 'Fault'); assert.equal(g.wallet, 30); assert.equal(g.shots.length, 0); assert.equal(g.spent, 0);
  assert.equal(g.resolve(a.id, 1), false);
}
// 7) 既定(1球ずつ)の挙動は変わらない
{
  const g = new MedalGame(new MedalRules({ LoanBalls: 30 }), 1); g.start(); g.advance(g.effectLeft);
  const a = g.launch(); assert.equal(g.canFire, false); assert.equal(g.launch(), null); assert.equal(g.canAim, false); g.resolve(a.id, 1); assert.equal(g.canFire, false);
}
console.log('PASS overlap: interval/max-in-flight, lamp cap, exclusive challenge, deferred landing, end waits, fault refund, legacy unchanged');
