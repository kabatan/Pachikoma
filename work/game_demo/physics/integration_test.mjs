// Nodeで同じruntimeを使う。600秒・追加・計数、およびJP600の払出中計数を監査。
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { PhysicsAdapter } from './adapter.mjs';
import { MedalRules } from '../rules/medal_rules.mjs';
import { MedalController } from '../ui/controller.mjs';
import { MedalPresenter } from '../ui/presenter.mjs';
import { createRuntime } from '../play/runtime.mjs';
await RAPIER.init();
const CAB = new URL('../../cabinet/', import.meta.url);
const pa = await PhysicsAdapter.create(RAPIER, { readText: async (p) => readFileSync(new URL(p, CAB), 'utf8'), importModule: (p) => import(new URL(p, CAB).href), seed: 3 });
const rules = MedalRules.fromJson(readFileSync(new URL('../rules/medal_game.json', import.meta.url), 'utf8'));
const ctrl = new MedalController({ rules, seed: 3, hooks: { launchBall(s, aim, dir) { pa.setAim(aim, dir); pa.launch(s.id); }, cancelFlights() { pa.reset(); } } });
const presenter = new MedalPresenter(ctrl), rows = [];
const rt = createRuntime({ ctrl, presenter, pa, log: { write(kind, detail) { if (kind === 'physics') rows.push(detail); } } });
let sessions = 0, added = 0, completed = [];
for (let f = 0; f < 600 * 60; f++) {
  const g = ctrl.game;
  if (g.phase === 'Attract') { ctrl.dispatch('start'); sessions++; }
  else if (g.canAdd && !g.addedCredit && g.secondsLeft < 60) { if (ctrl.dispatch('add')) added++; }
  else if (g.canFire && f % 9 === 0) ctrl.dispatch(g.lampCount > 0 && g.lampCount < 6 && !g.armed ? 'challenge' : 'fire');
  else if (g.phase === 'Continue') ctrl.dispatch('finish');
  else if (g.phase === 'Result' && rt.stats.countDone) {
    assert.equal(rt.stats.countDone.counted, g.wallet);
    completed.push({ wallet: g.wallet, counted: rt.stats.countDone.counted, forced: rt.stats.countDone.forced });
    ctrl.dispatch('reset');
  }
  rt.advance(1 / 60);
  assert.equal(rt.stats.maxLedgerDrift, 0, `inventory drift at frame ${f}`);
}
assert(completed.length > 0); assert(added > 0);
const cups = rows.filter((e) => e.type === 'cup'); assert(cups.length > 0);
for (const e of rows) { assert(Number.isInteger(e.tick)); assert(Number.isInteger(e.seq)); assert('ball_id' in e); assert('part_id' in e); }
console.log(JSON.stringify({ duration_s: 600, sessions, added, completed, cups: cups.length, lost: rt.stats.lost, maxLedgerDrift: rt.stats.maxLedgerDrift }));

// 規則を書き換えず、物理アダプタに600玉を要求する明示的な払出ストレス。
pa.beginGame(18); pa.payout(618); pa.startCount();
let done = null, max = 0;
for (let i = 0; i < 120 * 60 && !done; i++) {
  pa.advance(1 / 60); const L = pa.ledger();
  assert.equal(Object.values(L).reduce((a, b) => a + b, 0), 618);
  max = Math.max(max, pa.snapshot().count);
  done = pa.drainEvents().find((e) => e.type === 'count_done') ?? null;
}
assert(done); assert.equal(done.counted, 618); assert.equal(pa.ledger().counted, 618);
console.log(JSON.stringify({ payout_stress: 600, counted: done.counted, forced: done.forced, max_visible_balls: max, elapsed_s: pa.t, scale: pa.tray.S }));

// 新しい世界で同tick入力を再生。入力時刻とsnapshotが再現するか。
async function replay() {
  const p = await PhysicsAdapter.create(RAPIER, { readText: async (p) => readFileSync(new URL(p, CAB), 'utf8'), importModule: (p) => import(new URL(p, CAB).href), seed: 3 });
  p.setInput(1, { type: 'payout', n: 18 }); p.setInput(400, { type: 'launch', shotId: 1, aim: .2, dir: -1 });
  p.stock = 1; p.shuttleHas = true;
  const events = []; for (let i = 0; i < 2400; i++) { p.step(); events.push(...p.drainEvents()); }
  const s = p.snapshot(), result = { events, positions: Array.from(s.positions.slice(0, s.count * 3)), ledger: s.ledger };
  p.bw.free(); p.tw.free(); return result;
}
const a = await replay(), b = await replay();
assert.deepEqual(b, a);
for (let i=0;i<a.events.length;i++) { assert.equal(a.events[i].seq,i); if(i) assert(a.events[i].tick>=a.events[i-1].tick); }
console.log(JSON.stringify({ replay_ticks: 2400, identical_events: a.events.length, identical_positions: a.positions.length / 3 }));
pa.bw.free(); pa.tw.free();
