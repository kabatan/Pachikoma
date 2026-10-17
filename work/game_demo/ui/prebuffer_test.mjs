// R-04: 演出中の勝負ボタン先押しを0.3秒だけ1回保持する。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MedalRules } from '../rules/medal_rules.mjs';
import { MedalController } from './controller.mjs';
const base = JSON.parse(readFileSync(new URL('../rules/medal_game.json', import.meta.url)));
function make() {
  const c = new MedalController({ rules: new MedalRules({ ...base, LoanBalls: 40 }), seed: 5 }); const got = [];
  c.onAction(a => got.push(a)); c.dispatch('start'); c.update(0.01); c.update(c.game.effectLeft + 0.1);
  return { c, got, tick: dt => c.update(dt), land(lane) { c.update(0); assert.ok(c.dispatch('fire')); const id = c.game.shot.id; c.update(0.05); assert.ok(c.landing(id, lane)); } };
}
{ // 灯なし(0灯)・飛行中の押しは捨てて記録
  const { c, tick } = make(); tick(0.01); c.dispatch('fire'); tick(0.01);
  assert.equal(c.game.phase, 'Flight'); assert.equal(c.dispatch('challenge'), false); assert.equal(c.droppedInputs.at(-1).reason, 'Flight');
}
{ // 着地(1灯)→Effect中に先押し→Effect終了で適用(終了まで0.3秒以内)
  const { c, got, tick, land } = make(); land(1);
  assert.equal(c.game.phase, 'Effect'); assert.ok(c.game.lampCount >= 1);
  const left = c.game.effectLeft; tick(Math.max(0, left - 0.2));
  assert.equal(c.dispatch('challenge'), true); assert.equal(c.game.armed, false); tick(0.01); assert.equal(c.dispatch('challenge'), false);
  assert.equal(c.droppedInputs.at(-1).reason, 'already-buffered');
  tick(0.3); assert.equal(c.game.armed, true); assert.ok(got.includes('challenge'));
}
{ // 0.3秒を超えたら失効して記録
  const { c, tick, land } = make(); land(1);
  if (c.game.effectLeft > 0.4) { tick(0.01); assert.equal(c.dispatch('challenge'), true); tick(0.35); assert.equal(c.game.armed, false); assert.equal(c.droppedInputs.at(-1).reason, 'expired'); }
}
console.log('PASS pre-press buffer');
