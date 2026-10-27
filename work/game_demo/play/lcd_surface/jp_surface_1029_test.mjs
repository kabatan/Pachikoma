import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JpTimeline,jpEffectSeconds} from './jp_surface_1029.mjs';
const man=JSON.parse(readFileSync(new URL('./jp1029_proto/manifest.json',import.meta.url)));
const events=[];const t=new JpTimeline(man,c=>events.push(c));
const step=n=>{for(let i=0;i<n;i++)t.update(1/30);};
const until=name=>{for(let i=0;i<2000&&t.name!==name;i++)step(1);assert.equal(t.name,name);};
const six=()=>t.onEvent('lamp6',{after:[1,2,3,5,6,7]});
for(const f of [24,84,96]){six();step(30+f);t.onEvent('challenge_flight',{});step(15);assert.ok(t.name.startsWith('fly_'));}
six();until('jp_aim_d4');step(18*30);assert.equal(t.name,'jp_aim_d4');
t.onEvent('timeup');assert.equal(t.dim,true);t.onEvent('add100');assert.equal(t.dim,false);
t.onEvent('challenge_flight');until('fly_t0_d4');
for(let tier=1;tier<=3;tier++){t.onEvent('jp_heat',{tier});step(7);assert.equal(t.name,`fly_t${tier}_d4`);}
t.onEvent('jp_heat',{tier:0});assert.equal(t.heat,3);
t.onEvent('jp_mouth',{unlit:true});assert.equal(t.name,'tame_hit_d4');
for(const payout of [30,40,100,200,500]){six();events.length=0;t.onEvent('jp',{payout});assert.equal(t.name,'jp_land_d4');until('jp_rush');until('jp_bridge');until(`roulette_${payout}`);assert.equal(events.filter(c=>c.kind==='reveal').length,0);until(`reward_${payout}`);assert.equal(events.filter(c=>c.kind==='reveal').length,1);step(300);assert.equal(t.active,false);assert.ok(jpEffectSeconds(man,payout)>14);}
for(const earnings of [0,1,30,500,9999]){six();t.onEvent('fail',{lane:5,jackpotEarnings:earnings});assert.equal(t.name,earnings?'fail_chain':'fail_first');step(150);assert.equal(t.active,false);}
six();t.onEvent('chain_continue',{chain:1});assert.equal(t.active,false);
assert.equal(t.onEvent('jp',{chain:true,payout:30}),false);
console.log('PASS JP early/late shot, monotone heat, loop_from, result interrupts, five payouts, reward, failure, timeup, continuation handoff');
