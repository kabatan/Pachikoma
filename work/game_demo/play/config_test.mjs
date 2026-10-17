import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPlayConfig, loadPlayRules, resolveConfigPath } from './config.mjs';
const read = async p => readFileSync(new URL(p), 'utf8');
const defaults=await loadPlayConfig(null,read);
assert.equal(defaults.stageDir,new URL('../../cabinet/stage3',import.meta.url).href);
assert.deepEqual(defaults.jitter,{x_mm:0,vx_pct:0,vy_pct:0});
const current=await loadPlayConfig('work/game_tuning/proto/config.json',read);
const example=await loadPlayConfig('work/game_tuning/proto/config.example.json',read);
assert.ok(current.stageDir.startsWith('file:///')&&current.rules);
await loadPlayRules(current.rules,read);
assert.equal(example.seed,1201201);
assert.equal(JSON.parse(await read(example.stageDir+'/layout3.json')).pins.length,81);
await loadPlayRules(defaults.rules,read); await loadPlayRules(example.rules,read);
const partial=await loadPlayConfig('https://example.invalid/tuning/config.json',async()=>JSON.stringify({stageDir:'./board',rules:'./rules.json',jitter:{x_mm:2}}));
assert.equal(partial.stageDir,'https://example.invalid/tuning/board');
assert.equal(partial.rules,'https://example.invalid/tuning/rules.json');
assert.deepEqual(partial.jitter,{x_mm:2,vx_pct:0,vy_pct:0});
assert.equal(resolveConfigPath('work/game_tuning/proto/config.json'),new URL('../../game_tuning/proto/config.json',import.meta.url).href);
for (const raw of [{jitter:{x_mm:-1}},{seed:1.5},[]]) await assert.rejects(()=>loadPlayConfig('https://example.invalid/config.json',async()=>JSON.stringify(raw)));
for (const [raw,reason] of [[{LoanBalls:1},'LoanBalls'],[{InitialSeconds:200},'165'],[{ResetWeights:[1,2,3,4]},'合計100']]) {
  await assert.rejects(()=>loadPlayRules('bad_rules.json',async()=>JSON.stringify(raw)),e=>e.message.includes('bad_rules.json')&&e.message.includes(reason));
}
console.log(JSON.stringify({passed:true,defaults,current:current.name,example:example.name,relativeUrls:true,invalidRules:true}));
