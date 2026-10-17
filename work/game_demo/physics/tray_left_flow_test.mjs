// 右の払出口から全球が左へ転がって静止し、新しい払出でも台帳/接触を壊さない。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import R from '@dimforge/rapier3d-compat';
import { Stage1Tray } from './stage1_tray.mjs';
import { RollingResistance } from '../../cabinet/stage1/export/rolling_resistance.mjs';
await R.init();
for (const seed of [1, 43, 101]) {
  let s = seed; const rng = () => ((s = (1664525 * s + 1013904223) >>> 0) / 2 ** 32);
  const w = new R.World({x:0,y:-98.1,z:0}); w.timestep = 1/480; w.lengthUnit = .1;
  const tray = new Stage1Tray(R,w,{readText: async p=>readFileSync(new URL('../../cabinet/stage1/export/'+p,import.meta.url),'utf8'),rng,RollingResistance,overflow:{type:'closed'}});
  await tray.load();
  for (let i=0; i<18*480; i++) {
    if (i<18*72 && i%72===0) tray.spawnPayout();
    tray.beforeStep(1/480); w.step(); tray.afterStep(1/480);
  }
  assert.equal(tray.payoutExited,18);
  assert.equal(tray.counts().inDish,18);
  assert.equal(tray.events.filter(e=>e.sensor==='LOST').length,0);
  const balls=[...tray.balls.values()];
  for (const b of balls) {
    assert(tray.pos(b.body).x-tray.T[0]<-.06,'球が右側に残った');
    assert(Math.hypot(...Object.values(b.body.linvel()))/10<.003,'静止後の震え');
  }
  assert(balls.filter(b=>b.body.isSleeping()).length>=16,'皿の球が眠れない');
  for (let i=0;i<balls.length;i++) for(let j=0;j<i;j++) {
    const a=tray.pos(balls[i].body),b=tray.pos(balls[j].body);
    assert(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)>.011,'球が深く重なった');
  }
  // 出口の球には皿の横加速を与えない。
  const id=tray.spawnPayout(), b=tray.balls.get(id), vx=b.body.linvel().x;
  tray.beforeStep(1/480); assert.equal(b.body.linvel().x,vx);
  for(let i=0;i<6*480;i++){tray.beforeStep(1/480);w.step();tray.afterStep(1/480);}
  assert.equal(tray.payoutExited,19); assert.equal(tray.counts().inDish,19);
  console.log(JSON.stringify({seed,paid:19,left:balls.length,lost:0})); w.free();
}
