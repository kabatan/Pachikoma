// 実Rapier+通常画面と共通runtimeで、入金→追加→計数まで両フラグを検査。
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import RAPIER from '../physics/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs';
import { PhysicsAdapter } from '../physics/adapter.mjs';
import { MedalRules } from '../rules/medal_rules.mjs';
import { MedalController } from '../ui/controller.mjs';
import { MedalPresenter } from '../ui/presenter.mjs';
import { EffectsBus, EFFECT_IDS } from './effects_bus.mjs';
import { createRuntime } from './runtime.mjs';
await RAPIER.init();
const CAB = new URL('../../cabinet/', import.meta.url), results = [];
for (const rapid of [false, true]) {
  const rules = new MedalRules({ ...JSON.parse(readFileSync(new URL('../rules/medal_game.json', import.meta.url))), RapidFire: rapid });
  const pa = await PhysicsAdapter.create(RAPIER, { seed: 3,
    readText: async p => readFileSync(new URL(p, CAB), 'utf8'), importModule: p => import(new URL(p, CAB).href) });
  const ctrl = new MedalController({ rules, seed: 3, hooks: {
    launchBall(s, aim, dir) { pa.setAim(aim, dir); pa.launch(s.id); }, cancelFlights() { pa.reset(); }
  } });
  const presenter = new MedalPresenter(ctrl), effects = new EffectsBus(), events = [];
  effects.on('*', e => events.push(e));
  const rt = createRuntime({ ctrl, presenter, pa, effects });
  assert.equal(rt.effects, effects);
  ctrl.dispatch('start');
  for (let f = 0; f < 240 * 60; f++) {
    const g = ctrl.game;
    if (g.phase === 'Continue') assert.ok(ctrl.dispatch('add'));
    else if (g.canFire && f % 3 === 0)
      ctrl.dispatch(g.lampCount >= 4 && g.lampCount < 6 && !g.armed ? 'challenge' : 'fire');
    rt.advance(1 / 60);
    if (ctrl.game.phase === 'Result' && rt.stats.countDone) break;
  }
  assert.equal(ctrl.game.phase, 'Result'); assert.ok(rt.stats.countDone);
  assert.equal(rt.stats.maxLedgerDrift, 0); assert.equal(rt.stats.lost, 0);
  assert.equal(rt.stats.countDone.counted, ctrl.game.wallet);
  let shot = null, resolved = 0, previousT = 0, countStarted = false;
  const landings = ['lamp123','lamp4','lamp5','lamp6','dup_protect','roulette','success_small','success_big','fail','jp'];
  for (const e of events) {
    assert.ok(e.t >= previousT); previousT = e.t;
    if (e.id === 'launch') { assert.equal(shot, null, 'one physical flight at a time'); shot = e.data.shotId; }
    if (e.id === 'challenge_flight') assert.equal(e.data.shotId, shot);
    if (landings.includes(e.id)) { assert.ok(shot !== null, 'result follows launch'); shot = null; resolved++; }
    if (e.id === 'finish_count') { assert.equal(shot, null); countStarted = true; }
    if (e.id === 'result') { assert.ok(countStarted); assert.equal(e.data.balls, rt.stats.countDone.counted); }
  }
  assert.equal(shot, null);
  assert.equal(resolved, rt.stats.cups.reduce((a,b) => a+b, 0));
  const counts = Object.fromEntries(EFFECT_IDS.map(id => [id, events.filter(e => e.id === id).length]));
  assert.ok(counts.launch > 0); assert.equal(counts.launch, resolved);
  assert.equal(counts.ticket, 1); assert.equal(counts.start, 1); assert.equal(counts.timeup, 1);
  assert.equal(counts.add100, 1); assert.equal(counts.finish_count, 1); assert.equal(counts.result, 1);
  results.push({ RapidFire: rapid, counts, emittedOf25: EFFECT_IDS.filter(id => id !== 'challenge_cancel' && counts[id]).length,
    seconds: previousT, wallet: ctrl.game.wallet, counted: rt.stats.countDone.counted, maxLedgerDrift: rt.stats.maxLedgerDrift,
    order: events.map(e => e.id) });
  pa.bw.free(); pa.tw.free();
}
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
writeFileSync(new URL('./out/effects_test.json', import.meta.url), JSON.stringify(results, null, 2) + '\n');
console.log('PASS actual Rapier sessions, launch/result/count order, default and RapidFire:', JSON.stringify(results.map(({ order, ...r }) => r)));
