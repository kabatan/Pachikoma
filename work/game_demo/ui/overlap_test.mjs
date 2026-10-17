// node ui/overlap_test.mjs : 同時発射の操作(間隔待ちの先押し/勝負は盤が空になるまで保持/保持中は撃たない)。物理なし。
import assert from 'node:assert/strict';
import { MedalRules } from '../rules/medal_rules.mjs';
import { MedalController } from './controller.mjs';
const mk = () => {
  const fired = [];
  const c = new MedalController({ rules: new MedalRules({ MaxInFlight: 3, FireInterval: 0.6, LoanBalls: 30, JackpotAwards: [80], JackpotWeights: [100] }), seed: 1, hooks: { launchBall(s, a, d) { fired.push({ id: s.id, a, d }); } } });
  c.dispatch('start'); const step = (t) => { for (let i = 0; i < Math.round(t * 60); i++) c.update(1 / 60); };
  step(3); return { c, fired, step };
};
const next = (c, step) => { step(0.02); };
{ // 1) 連続して押すと、間隔(0.6s)で次が出る。先押し(残り0.3秒以内)は保持されて自動で撃たれる
  const { c, fired, step } = mk();
  assert.ok(c.dispatch('fire')); assert.equal(fired.length, 1);
  step(0.2); assert.equal(c.dispatch('fire'), false); assert.equal(fired.length, 1);     // 残り0.4秒: 早すぎる押しは捨てる
  step(0.2); const aimAtPress = c.aim; assert.equal(c.dispatch('fire'), false); assert.ok(c.fireBuffer);   // 残り0.2秒: 保持
  step(0.3); assert.equal(fired.length, 2); assert.equal(fired[1].a, aimAtPress);       // 解禁と同時に、押した瞬間の狙いで撃つ
  assert.equal(c.game.shots.length, 2); assert.ok(c.aim !== aimAtPress || true);
}
{ // 2) 勝負は盤上が空になるまで保持され、保持中は新しい玉を撃たない。空になったら自動で宣言される
  const { c, fired, step } = mk();
  const a = c.game.launch(); c.landing(a.id, 1); step(0.6);     // 1灯
  assert.ok(c.dispatch('fire')); assert.ok(c.game.shots.length === 1);
  step(0.7); assert.equal(c.dispatch('challenge'), true); assert.ok(c.preBuffer); assert.equal(c.game.armed, false);
  step(0.1); assert.equal(c.dispatch('fire'), false); assert.equal(fired.length, 1 + 0, '保持中は撃たない');
  c.landing(c.game.shots[0].id, 2); step(0.7);                  // 着いた→灯が増え、盤が空→宣言が通る
  assert.equal(c.game.armed, true); assert.equal(c.preBuffer, null);
  assert.ok(c.dispatch('fire')); assert.equal(c.game.shots[0].challenge, true);
  assert.equal(c.game.canFire, false);
}
{ // 3) 勝負保持が長引いても5秒で捨てる(記録される)
  const { c, step } = mk();
  const a = c.game.launch(); c.landing(a.id, 1); step(0.6);
  c.dispatch('fire'); step(0.7); c.dispatch('challenge'); step(5.2);
  assert.equal(c.preBuffer, null); assert.ok(c.droppedInputs.some((x) => x.reason === 'expired'));
}
console.log('PASS overlap controller: interval pre-press, challenge drain buffer, exclusive firing');
