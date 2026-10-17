// ルール説明(開始前)の流れ: start押下→howto(5.2s)→ticket→start。2度押しで飛ばせる。時計は説明中は進まない。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MedalRules } from '../rules/medal_rules.mjs';
import { MedalController } from '../ui/controller.mjs';
import { MedalPresenter } from '../ui/presenter.mjs';
import { EffectsBus, connectEffects } from './effects_bus.mjs';
const base = JSON.parse(readFileSync(new URL('../rules/medal_game.json', import.meta.url)));
function make() {
  const ctrl = new MedalController({ rules: new MedalRules(base), seed: 3 }); ctrl.howtoSeconds = 5.2;
  const presenter = new MedalPresenter(ctrl), bus = new EffectsBus(), ids = [];
  bus.on('*', e => ids.push([e.id, +e.t.toFixed(2)]));
  const bridge = connectEffects({ ctrl, presenter, bus });
  let t = 0; const tick = dt => { t += dt; bridge.advance(dt); ctrl.update(dt); presenter.update(dt); bridge.sync(); };
  return { ctrl, ids, tick };
}
{ // 自然に待つ
  const { ctrl, ids, tick } = make(); tick(0.1); assert.equal(ctrl.dispatch('start'), true);
  assert.equal(ctrl.game.phase, 'Attract'); assert.deepEqual(ids.map(x => x[0]).filter(x => x === 'howto' || x === 'ticket'), ['howto']);
  for (let i = 0; i < 50; i++) tick(0.1); assert.equal(ctrl.game.phase, 'Attract');   // 5.0s
  for (let i = 0; i < 4; i++) tick(0.1);
  assert.notEqual(ctrl.game.phase, 'Attract'); const order = ids.map(x => x[0]).filter(x => x === 'howto' || x === 'ticket');
  assert.deepEqual(order, ['howto', 'ticket']); assert.equal(ctrl.game.wallet, base.LoanBalls ?? ctrl.game.wallet);
}
{ // 説明は2コマ。各コマ最低2.5秒は読ませ、押すと次のコマ→開始。連打では飛ばない
  const { ctrl, ids, tick } = make(); ctrl.howtoSeconds = 10; ctrl.howtoPanels = 2; tick(0.1); ctrl.dispatch('start'); tick(0.1);
  assert.equal(ctrl.dispatch('start'), false); tick(0.4); assert.equal(ctrl.dispatch('start'), false);   // 0.6秒: 無視
  for (let i = 0; i < 20; i++) tick(0.1);                                                                 // 2.6秒
  assert.equal(ctrl.dispatch('start'), true); assert.equal(ctrl.game.phase, 'Attract'); assert.ok(ctrl.howto.t >= 5);   // 次のコマへ(まだ開始しない)
  tick(0.1); assert.equal(ctrl.dispatch('start'), false);                                                 // 2コマ目も最低2.5秒
  for (let i = 0; i < 26; i++) tick(0.1);
  assert.equal(ctrl.dispatch('start'), true); assert.notEqual(ctrl.game.phase, 'Attract');
  assert.deepEqual(ids.map(x => x[0]).filter(x => x === 'howto' || x === 'ticket'), ['howto', 'ticket']);
}
{ // 5コマ(既定): 各コマ最低2.5秒、押すたび次のコマ、最後で開始
  const { ctrl, tick } = make(); ctrl.howtoSeconds = 25; tick(0.1); ctrl.dispatch('start'); tick(0.1);
  for (let k = 1; k <= 4; k++) { for (let i = 0; i < 26; i++) tick(0.1); assert.equal(ctrl.dispatch('start'), true); assert.equal(ctrl.game.phase, 'Attract'); assert.ok(ctrl.howto.t >= k * 5 && ctrl.howto.t < (k + 1) * 5); tick(0.1); assert.equal(ctrl.dispatch('start'), false); }
  for (let i = 0; i < 26; i++) tick(0.1); assert.equal(ctrl.dispatch('start'), true); assert.notEqual(ctrl.game.phase, 'Attract');
}
{ // 既定(0秒)は従来どおり即開始
  const ctrl = new MedalController({ rules: new MedalRules(base), seed: 3 }); assert.equal(ctrl.dispatch('start'), true); assert.notEqual(ctrl.game.phase, 'Attract');
}
console.log('PASS howto flow');
