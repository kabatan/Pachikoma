import assert from 'node:assert/strict';
import { readFileSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import RAPIER from '@dimforge/rapier3d-compat';
import { Board3 } from './board3.mjs';
import { JitterBoard, lcg } from './board3_jitter.mjs';
import { JitterBoard as LabBoard } from '../../game_tuning/lab/jitter_board.mjs';

const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const run = '../../game_tuning/lab/results/sweep_baseline_J12/';
const model = read(run+'model3.json'), layout = read(run+'layout3.json'), dims = read('../../cabinet/dims/dims.json');
await RAPIER.init();
function make(Type, options) {
  const world = Board3.makeWorld(RAPIER);
  return new Type(RAPIER, world, {model, layout, dims, ...options});
}
function free(b) { b.queue.free(); b.world.free(); }
const state = b => [...b.balls].map(([id,v]) => [id, v.body.translation(), v.body.linvel(), v.body.angvel()]);
let calls = [0,0];
const boards = [Board3, JitterBoard].map((Type,i) => {
  const random = lcg(123);
  return make(Type, {seed:123, jitter:{x_mm:0,vx_pct:0,vy_pct:0}, rng:()=>{calls[i]++;return random();}});
});
try {
  for (let tick=0; tick<1600; tick++) {
    if ([0,32,64].includes(tick)) boards.forEach(b=>b.launch(tick, tick/100-0.8, tick===32?-1:1));
    boards.forEach(b=>b.step());
    assert.deepEqual(state(boards[0]), state(boards[1]));
    assert.deepEqual(boards[0].drain(), boards[1].drain());
    assert.equal(calls[0], calls[1]);
  }
  // ゼロ揺らぎでは独立rngも1回も使わない。
  let used=0; boards[1].jitterRng=()=>{used++;return .5;}; boards[1].launch(9,0,1); assert.equal(used,0);
} finally { boards.forEach(free); }

// 保存済みshots.jsonlから両方向2球ずつ。記録の実現値・入賞・tick・sensorXを照合。
const samples=[];
const lines=createInterface({input:createReadStream(new URL(run+'shots.jsonl', import.meta.url)), crlfDelay:Infinity});
for await (const line of lines) {
  const row=JSON.parse(line);
  if (row.aimIndex===0 && row.trial<2) samples.push(row);
  if (samples.length===4) break;
}
assert.equal(samples.length,4);
const config=read(run+'config.json'), comparisons=[];
for (const row of samples) {
  const bs=[make(LabBoard,{seed:row.seed,rng:lcg(row.seed),jitter:config.jitter}),
    make(JitterBoard,{seed:row.seed,rng:lcg(row.seed),jitter:{x_mm:config.jitter.x,vx_pct:config.jitter.v,vy_pct:config.jitter.y}})];
  try {
    bs.forEach(b=>b.launch(row.shotId,row.aim,row.dir));
    assert.deepEqual(bs[1].launchDelta,row.launchDelta);
    assert.deepEqual(bs[0].launchDelta,bs[1].launchDelta);
    assert.deepEqual(state(bs[0]),state(bs[1]));
    assert.deepEqual(bs[1].shuttle(row.aim,row.dir),Board3.prototype.shuttle.call(bs[1],row.aim,row.dir));
    let hit;
    for (let tick=1;tick<=row.elapsedTicks;tick++) {
      bs.forEach(b=>b.step());
      assert.deepEqual(state(bs[0]),state(bs[1]));
      const events=bs.map(b=>b.drain()); assert.deepEqual(events[0],events[1]);
      hit=events[1].find(e=>e.type==='cup') ?? hit;
      if (hit) assert.equal(tick,row.elapsedTicks);
    }
    assert(hit); assert.equal(hit.cup,row.sensorCup); assert.equal(hit.x,row.sensorX);
    comparisons.push({seed:row.seed,dir:row.dir,cup:hit.cup,ticks:row.elapsedTicks,launchDelta:bs[1].launchDelta});
  } finally {bs.forEach(free);}
}
console.log(JSON.stringify({passed:true,zeroJitter:{ticks:1600,shots:3,rngCalls:calls[0],identical:true},labRun:'sweep_baseline_J12',comparisons}));
