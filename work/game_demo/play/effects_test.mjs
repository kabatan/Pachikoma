import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MedalRules } from '../rules/medal_rules.mjs';
import { MedalController } from '../ui/controller.mjs';
import { MedalPresenter } from '../ui/presenter.mjs';
import { EffectsBus, EFFECT_IDS, connectEffects } from './effects_bus.mjs';
import { attachInput } from '../ui/input.mjs';

const spec = JSON.parse(readFileSync(new URL('../../effects/spec/events.json', import.meta.url)));
const CHAIN_IDS = ['chain_choice', 'chain_continue', 'chain_stop', 'jp_heat', 'jp_mouth'];   // R3の継続。この古い規則の試験では出ない。確認は lcd_surface/jp_seq_test.mjs
assert.deepEqual(new Set(EFFECT_IDS), new Set([...spec.events.map(e => e.id), 'challenge_cancel', ...CHAIN_IDS.filter(id => !spec.events.some(e => e.id === id))]));
const bus = new EffectsBus(); let called = 0, errors = 0;
const oldError = console.error;
try {
  console.error = () => errors++;
  const off = bus.on('launch', () => { throw new Error('intentional'); });
  bus.on('*', e => { assert.equal(e.id, 'launch'); called++; });
  const data = { aim: 1 }; const e = bus.emit('launch', { data }); data.aim = 99;
  assert.equal(e.data.aim, 1); assert.throws(() => { e.data.aim = 4; });
  off(); bus.emit('launch'); assert.equal(errors, 1); assert.equal(called, 2);
  const snapshot = bus.snapshot(); snapshot.counts.launch = -1;
  assert.equal(bus.snapshot().counts.launch, 2);
} finally { console.error = oldError; }

// キーを保持してrepeatが来ても再発射しない。ポインタも1回の押下だけを配送する。
const keys = {}, pointers = {}, actions = [], humanInputs = [];
const surface = handlers => ({ addEventListener(k, fn) { handlers[k] = fn; }, removeEventListener(k) { delete handlers[k]; } });
const detach = attachInput({ phase: 'Ready', dispatch: a => { actions.push(a); return true; } }, { target: surface(keys), overlayRoot: surface(pointers), onInput: input => humanInputs.push(input) });
keys.keydown({ code: 'Space', repeat: false, preventDefault() {} });
for (let i = 0; i < 10; i++) keys.keydown({ code: 'Space', repeat: true });
pointers.pointerdown({ target: { closest: () => ({ dataset: { action: 'fire' } }) } });
assert.deepEqual(actions, ['fire', 'fire']); detach();
assert.deepEqual(humanInputs.map(input => [input.source, input.action, input.accepted]), [
  ['keyboard', 'fire', true], ['pointer', 'fire', true],
]);

const base = JSON.parse(readFileSync(new URL('../rules/medal_game.json', import.meta.url)));
const events = [];
function fixture(rapid = false) {
  const ctrl = new MedalController({ rules: new MedalRules({ ...base, LoanBalls: 80, RapidFire: rapid, JackpotAwards: [80], JackpotWeights: [100] }), seed: 7 });
  const presenter = new MedalPresenter(ctrl);
  const bus = new EffectsBus(); bus.on('*', e => events.push(e));
  const bridge = connectEffects({ ctrl, presenter, bus });
  const tick = dt => { bridge.advance(dt); ctrl.update(dt); presenter.update(dt); bridge.sync(); };
  const action = name => { ctrl.update(0); assert.ok(ctrl.dispatch(name), name); presenter.update(0); bridge.sync(); };
  const shoot = lane => {
    action('fire'); const shotId = ctrl.game.shot.id;
    assert.equal(bus.snapshot().state.canLaunch, false);
    bridge.physics({ type: 'launch', shotId });
    assert.equal(ctrl.dispatch('fire'), false);
    tick(.1); assert.ok(ctrl.landing(shotId, lane));
    bridge.physics({ type: 'cup', cup: lane, shotId });
    const count = bus.snapshot().total;
    presenter.update(0); bridge.sync();
    // receiptの物理通知とPresenter通知が重なっても二重配送しない。
    if (ctrl.game.receipt.kind !== 'Reset') assert.equal(bus.snapshot().total, count);
    assert.equal(bus.snapshot().state.canLaunch, ctrl.game.canFire);
    assert.equal(bus.snapshot().state.declared, ctrl.game.armed);
    return ctrl.game.receipt;
  };
  if (!rapid) ctrl.howtoSeconds = 5.2;   // 開始前のルール説明(howto)を通す
  action('start'); if (ctrl.howto) { assert.equal(ctrl.game.phase, 'Attract'); tick(5.3); assert.notEqual(ctrl.game.phase, 'Attract'); }
  tick(ctrl.game.effectLeft);
  return { ctrl, presenter, bridge, bus, tick, action, shoot, settle() { tick(ctrl.game.effectLeft); tick(3); } };
}
const f = fixture(true);
assert.equal(f.bus.snapshot().state.canLaunch, true);
f.ctrl.confirmFinish = true; assert.equal(f.bus.snapshot().state.canLaunch, false); f.ctrl.confirmFinish = false;
f.ctrl.freezeRules = true; assert.equal(f.bus.snapshot().state.canLaunch, false); f.ctrl.freezeRules = false;
const beforeSnapshot = f.bus.snapshot(); f.tick(.01);
assert.ok(f.bus.snapshot().t > beforeSnapshot.t); assert.ok(f.bus.snapshot().state.secondsLeft < beforeSnapshot.state.secondsLeft);
for (const lane of [1, 1, 2, 3, 4]) f.shoot(lane); // 着地直後に次球。保護中の重複も含む。
assert.ok(events.filter(e => e.id === 'lamp123').every((e, i) => e.state.first.light === (i === 0)));
f.action('challenge'); f.action('challenge'); f.shoot(4); // 消灯重複
const roulette = events.findLast(e => e.id === 'roulette');
assert.equal(roulette.data.removed.length, roulette.data.removedCount);
assert.equal(roulette.data.k, roulette.data.removedCount);
assert.equal(roulette.data.n_from, roulette.data.before.length);
assert.ok(roulette.data.removed.includes(4));
f.settle();
const r = f.ctrl.game;
while (r.lampCount < 6) { f.shoot([1,2,3,4,5,6,7].find(l => !r.lamps.includes(l))); }
f.shoot([1,2,3,4,5,6,7].find(l => !r.lamps.includes(l)));
assert.equal(events.at(-1).id, 'jp'); assert.equal(r.canFire, false); f.settle();
f.shoot(1); f.action('challenge'); f.shoot(2); f.settle(); // small
for (const lane of [1,2,3,4]) f.shoot(lane);
f.action('challenge'); f.shoot(5); f.settle(); // big
f.shoot(1); f.action('challenge'); f.shoot(1); f.settle(); // fail
f.ctrl.game.secondsLeft = 10.01; f.tick(.02); f.tick(.1);
assert.equal(f.bus.snapshot().counts.warn10, 1);
f.shoot(2); f.ctrl.game.secondsLeft = 0; f.tick(.01);
assert.notEqual(f.ctrl.game.phase, 'Continue'); // 結果演出完了までは通知しない
f.tick(f.ctrl.game.effectLeft); assert.equal(events.at(-1).id, 'timeup');
assert.equal(events.at(-1).data.reason, '時間になりました');
assert.equal(events.at(-1).data.reasonCode, 'time');
f.action('add'); f.tick(f.ctrl.game.effectLeft);
f.ctrl.game.secondsLeft = 10.01; f.tick(.02); assert.equal(f.bus.snapshot().counts.warn10, 2);
f.ctrl.game.secondsLeft = 0; f.tick(.01);
assert.equal(f.ctrl.game.phase, 'Result'); assert.equal(f.bus.snapshot().counts.timeup, 1);
assert.equal(events.at(-1).id, 'finish_count');
f.bridge.physics({ type: 'overflow', valve: true });
f.bridge.physics({ type: 'count_done', counted: f.ctrl.game.wallet });
f.bridge.physics({ type: 'count_done', counted: f.ctrl.game.wallet });
assert.equal(f.bus.snapshot().counts.result, 1);
assert.ok(['participation','C','B','A','S','SS'].includes(events.at(-1).data.prizeRank));
f.bridge.enterTitle();

const b = fixture(); b.ctrl.game.wallet = 1; b.shoot(1);
b.tick(.44); assert.equal(b.ctrl.game.phase, 'Effect');
b.tick(.02); assert.equal(b.ctrl.game.phase, 'Continue');
assert.equal(events.at(-1).data.reason, '持ち玉を使いきりました');
assert.equal(events.at(-1).data.reasonCode, 'balls');
b.action('finish'); b.bridge.physics({ type: 'count_done', counted: 0 });
assert.equal(events.at(-1).data.prizeRank, 'participation');

{ // 同時発射: 盤上に玉があるあいだの勝負の先押しは challenge_wait で受け付けを知らせ、盤が空になってから challenge_declare が自動で出る
  const ctrl = new MedalController({ rules: new MedalRules({ ...base, LoanBalls: 80, MaxInFlight: 3, FireInterval: 0.6, JackpotAwards: [80], JackpotWeights: [100] }), seed: 7 });
  const presenter = new MedalPresenter(ctrl), bus = new EffectsBus(); bus.on('*', e => events.push(e));
  const bridge = connectEffects({ ctrl, presenter, bus });
  const tick = dt => { bridge.advance(dt); ctrl.update(dt); presenter.update(dt); bridge.sync(); };
  const press = name => { ctrl.update(0); return ctrl.dispatch(name); };
  press('start'); tick(ctrl.game.effectLeft + .01);
  assert.ok(press('fire')); const a = ctrl.game.shot.id; bridge.physics({ type: 'launch', shotId: a });
  tick(.65); assert.ok(press('fire')); const b2 = ctrl.game.shot.id; bridge.physics({ type: 'launch', shotId: b2 });
  assert.equal(bus.snapshot().state.canLaunch, true);   // 狙いは止まらない
  assert.ok(ctrl.landing(a, 1)); bridge.physics({ type: 'cup', cup: 1, shotId: a }); tick(.5);
  const before = events.length; assert.ok(press('challenge'));
  assert.equal(events.slice(before).map(e => e.id).join(), 'challenge_wait'); assert.equal(ctrl.game.armed, false);
  assert.equal(press('fire'), false);   // 勝負待ちの間は新しい玉を撃たない
  assert.ok(ctrl.landing(b2, 2)); bridge.physics({ type: 'cup', cup: 2, shotId: b2 }); tick(.5);
  assert.equal(ctrl.game.armed, true); assert.ok(events.slice(before).some(e => e.id === 'challenge_declare'));
}
for (const e of events) {
  assert.ok(EFFECT_IDS.includes(e.id)); assert.equal(e.state.lit, e.state.pockets.length);
  assert.ok(e.state.pockets.every(l => l >= 1 && l <= 7));
  assert.equal(Object.keys(e.state.first).length, 6);
  assert.equal(typeof e.state.canLaunch, 'boolean'); assert.equal(typeof e.state.declared, 'boolean');
  assert.equal(typeof e.data.first, 'boolean');
  if (e.data.lane !== undefined) assert.equal(e.data.pocket, e.data.lane);
  if (e.id === 'jp') assert.equal(e.data.payout, e.data.award);
  if (e.id === 'result') { assert.equal(e.data.rank, e.data.prizeRank); assert.equal(e.data.total, e.data.balls); }
}
const counts = Object.fromEntries(EFFECT_IDS.map(id => [id, events.filter(e => e.id === id).length]));
assert.ok(Object.entries(counts).every(([id, n]) => n > 0 || CHAIN_IDS.includes(id)));
console.log('PASS bus isolation, 26 event fixtures, rapid overlap, roulette, first flags, deadlines/rearm, count order:', JSON.stringify(counts));
