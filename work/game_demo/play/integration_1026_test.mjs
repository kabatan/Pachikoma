import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { MedalGame, MedalRules } from '../rules/medal_rules.mjs';
import { playEventParams } from './effect_params.mjs';
import { normalClipFor } from './lcd_surface/normal_surface_1026.mjs';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const rules = MedalRules.fromJson(json('../../game_tuning/r3/rules_r3.json'));
assert.deepEqual(rules.JackpotChainLamps, [1,2,3,4,5,6]);
assert.deepEqual(rules.PrizeThresholds, [0,30,200,320,500]);
assert.deepEqual(rules.JackpotWeights, [700000,200000,50000,49996,4]);

// R3の到達経路：低灯数で昇天映像を要求しない。4灯で保護2回の後にReset。
const game = new MedalGame(rules, 1); game.start(); game.advance(game.effectLeft + .01);
const observed = [];
for (const lane of [1,1,2,2,3,3,3,4,4,4,4]) {
  game.advance(.6); const shot = game.launch(); assert.ok(shot);
  game.resolve(shot.id, lane); observed.push(game.receipt.kind);
}
assert.deepEqual(observed, ['Fresh','Protected','Fresh','Protected','Fresh','Protected','Protected','Fresh','Protected','Protected','Reset']);
assert.deepEqual(game.lamps, [1,2,3]);
assert.equal(normalClipFor('roulette', { before:[1,2,3,4], after:[1,2,3], removedCount:1 }), 'reset4');
assert.equal(normalClipFor('roulette', { before:[1,2,3], after:[1,2], removedCount:1 }), null);
assert.equal(normalClipFor('dup_protect', { before:[1,2,3], after:[1,2,3] }), 'protect3');
assert.equal(normalClipFor('lamp123', { after:[1,2,3] }), 'lamp3');
assert.equal(normalClipFor('lamp123', { after:[1,2,3] }, 1), 'lamp3b');

// 本物のplay_fxが使う変換関数で、中継漏れを回帰検査する。
for (const id of ['chain_choice','chain_continue','challenge_flight','jp','fail','chain_stop','roulette']) {
  const data = { chain:true, lamps:3, pending:70, base:30, chainStage:2, chainLost:40,
    banked:70, total:100, duration:6.6, before:[1,2,3,4], after:[1,2,3], removed:[4],
    removedCount:1, resetSlot:1, resetReplaces:11, payout:40, paid:false };
  const p = playEventParams({ id, state:{lit:3,pockets:[1,2,3],first:{}}, data });
  for (const [key,value] of Object.entries(data)) assert.deepEqual(p[key], value, id + ':' + key);
}
const bridge = readFileSync(new URL('../../effects/runtime/play_fx.mjs', import.meta.url), 'utf8');
assert.match(bridge, /paramsOf = \(e\) => playEventParams\(e, RANKS\)/);
const entry = readFileSync(new URL('./play.mjs', import.meta.url), 'utf8');
assert.match(entry, /q.get\('cabinet'\) !== 'r2'/);
assert.match(entry, /q.get\('lcd'\) !== 'legacy'/);
assert.match(entry, /jpManifestUrl: null/);
assert.doesNotMatch(entry, /jp_film\/tmp\/export/);
const pins = json('./m3/data/pins_px.json');
assert.equal(pins.n, 82); assert.ok(pins.ids.includes('PIN_0082'));
assert.match(pins.stageDir, /r3\/boards\/cup1_4_wide20/);
const holes = json('./m3/data/holes_r3_1026.json');
assert.deepEqual([0,3,6].map(i=>holes.cups[i].width_mm), [20,20,42]);
const pack = json('./m3/pack1026/manifest.json');
assert.equal(pack.physics.pin_count, 82); assert.deepEqual(pack.physics.meter,['C','B','A','S']);
for (const r of Object.values(pack.arrays)) assert.ok(existsSync(new URL('./m3/pack1026/'+r.file, import.meta.url)));
// 実Effectsの払い出しcueも確認。未確定の数字を物理へ送らない。
const Effects = createRequire(import.meta.url)('../../effects/runtime/effects.js');
const fx = new Effects({events:json('../../effects/spec/events.json'),geom:json('../../effects/spec/geometry.json')});
const paid=[];fx.setTray({award(n){paid.push(n);}});
fx._trayCue({pat:'payout',event:'jp',p:{},params:{payout:30,paid:false},t0:0,t1:3});
assert.deepEqual(paid,[]);
fx._trayCue({pat:'payout',event:'jp',p:{},params:{payout:30,paid:true},t0:0,t1:3});
assert.deepEqual(paid,[30]);
console.log('PASS R3 duplicate route, params and paid/unpaid bridge, defaults, 82 pins, mouth widths, 4-rank meter');
