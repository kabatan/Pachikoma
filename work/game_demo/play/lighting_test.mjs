import assert from 'node:assert/strict';
import { LightingDriver } from './lighting.mjs';
const entries = [{ source_id:'lamp',side:'back' }, { source_id:'lamp',side:'front' }];
const d = new LightingDriver(entries, { sources: { lamp: { lamp:1,rgb:[1,.5,.25],weight:2 } } });
const li = (clock, lamps=[], extra={}) => ({ clock,lamps,armed:false,mode:'base',...extra });
const eq = (a,b) => assert(Math.abs(a-b)<1e-9, `${a} != ${b}`);
d.frame(li(0),0); d.frame(li(1,[1]),480);
let f = d.frame(li(1.4,[1]),672);
// 0.15秒遅延 + 0.25秒の二乗立上げ = .25。
eq(f.q.lamp.rgb[0],.5); eq(f.ea[0],Math.exp(Math.log(.08)*.8));
f = d.frame(li(1.65,[1]),792); eq(f.q.lamp.rgb[0],2); eq(f.q.lamp.rgb[1],1); eq(f.ea[0],.08);
assert.equal(Object.keys(f.q).length,1); assert.deepEqual(f.ea,f.eb);
const gate = new LightingDriver(entries,{sources:{lamp:{lamp:1,gate_at4:0}}});
eq(gate.frame(li(0,[1,2,3,4]),0).q.lamp.rgb[0],0);
const unmapped = new LightingDriver(entries); assert.deepEqual(unmapped.unmapped,['lamp']); eq(unmapped.frame(li(0),0).q.lamp.rgb[0],0);
for (const mode of ['base','reach','challenge','final']) for (const t of [0,.2,.5,.9]) {
  f = d.frame(li(2+t,[1,2,3,4,5,6],{mode,armed:true,reveal:true,jackpot:{t,settled:t>.8}}),960+Math.round(t*480));
  assert(f.ea.every(Number.isFinite)); assert(Object.values(f.q).every((v)=>v.rgb.every((c)=>Number.isFinite(c)&&c>=0)));
}
console.log(JSON.stringify({transition_delay_s:.15,transition_duration_s:.5,shared_source_count:1,modes_checked:4}));
