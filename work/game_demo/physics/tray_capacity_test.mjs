// 大払出でも玉を省略/削除せず、実際の収納センサーを通って全数が計数される。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import R from '@dimforge/rapier3d-compat';
import { PhysicsAdapter } from './adapter.mjs';
await R.init();const CAB=new URL('../../cabinet/',import.meta.url);
for(const seed of [1,43,101])for(const N of [100,300]){
  const p=await PhysicsAdapter.create(R,{readText:async s=>readFileSync(new URL(s,CAB),'utf8'),importModule:s=>import(new URL(s,CAB)),seed});
  p.beginGame(0);p.stock=0;p.shuttleHas=false;p.skipPayout=0;p._feed=()=>{};p._shuttle=()=>{};p.payout(N,true,25);
  let done=null,maxLive=0;const events=[];
  for(let f=0;f<45*60&&!done;f++){
    if(f===30*60)p.startCount();p.advance(1/60);
    const ev=p.drainEvents();events.push(...ev);done=ev.find(e=>e.type==='count_done')??null;
    maxLive=Math.max(maxLive,p.tray.activeBalls.size);
    assert.equal(Object.values(p.ledger()).reduce((a,b)=>a+b,0),N,'台帳差');
  }
  assert.equal(p.tray.nextBall,N,'生成を省略した');assert.equal(p.valve,0,'直接収納/玉の削除');
  assert.equal(events.filter(e=>e.type==='tray_lost').length,0,'皿の外へ消失');
  assert(done,`詰まり seed=${seed} N=${N}`);assert.equal(done.forced,0);assert.equal(done.counted,N);
  assert.equal(p.tray.stored.count+p.tray.stored.overflow,N,'センサー以外の収納');
  if(N===300)assert(p.tray.stored.overflow>0,'溢れ口を通らなかった');
  console.log(JSON.stringify({seed,N,generated:p.tray.nextBall,overflow:p.tray.stored.overflow,count:p.tray.stored.count,forced:done.forced,maxLive,seconds:p.t}));
  p.bw.free();p.tw.free();
}
