// 実Rapier球で初回JP→未確定の連勝→確定→計数。未確定配当の台帳加算を回帰検査。
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import RAPIER from '../physics/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs';
import {PhysicsAdapter,RAPID_SUPPLY} from '../physics/adapter.mjs';
import {loadPlayConfig,loadPlayRules} from './config.mjs';
import {MedalController} from '../ui/controller.mjs';
import {MedalPresenter} from '../ui/presenter.mjs';
import {createRuntime} from './runtime.mjs';
await RAPIER.init();
const readText=async p=>readFileSync(new URL(p),'utf8');
const config=await loadPlayConfig('work/game_tuning/r3/config_r3.json',readText);
const rules=await loadPlayRules(config.rules,readText), CAB=new URL('../../cabinet/',import.meta.url);
const pa=await PhysicsAdapter.create(RAPIER,{seed:1,...RAPID_SUPPLY,stageDir:config.stageDir,jitter:config.jitter,
  readText:async p=>readFileSync(new URL(p,CAB),'utf8'),importModule:p=>import(new URL(p,CAB).href)});
const ctrl=new MedalController({rules,seed:1,hooks:{launchBall(s,aim,dir){pa.setAim(aim,dir);pa.launch(s.id);},cancelFlights(){pa.reset();}}});
const presenter=new MedalPresenter(ctrl),rt=createRuntime({ctrl,presenter,pa});
const step=s=>{for(let t=0;t<s-1e-8;t+=.05)rt.advance(Math.min(.05,s-t));};
function until(test,label){for(let i=0;i<2000;i++){if(test())return;step(.05);}throw new Error('timeout '+label);}
function shotAt(lane){
  until(()=>ctrl.game.canFire&&pa.shuttleHas,'can fire');
  assert.ok(ctrl.dispatch('fire'));
  const paid=ctrl.game.shot,ball=pa.board.balls.get(paid.id),cup=pa.board.layout.cups.find(c=>c.n===lane),z=ball.body.translation().z;
  ball.body.setTranslation({x:cup.xc/1000*10,y:(cup.ym/1000+.025)*10,z},true);
  ball.body.setLinvel({x:0,y:-20,z:0},true);
  until(()=>!pa.board.balls.has(paid.id),'physical cup');
  assert.equal(ctrl.game.receipt.lane,lane);assert.equal(rt.stats.maxLedgerDrift,0);
}
try {
  ctrl.dispatch('start');
  for(const lane of [1,2,3,4,5,6,7])shotAt(lane);
  until(()=>ctrl.phase==='ChainChoice','first choice');
  const base=ctrl.game.wallet,first=ctrl.game.jackpotEarnings;
  ctrl.dispatch('chainContinue');step(.7);
  shotAt([1,2,3,4,5,6,7].find(n=>!ctrl.game.lamps.includes(n)));
  const pending=ctrl.game.chainStatus.pendingAward;
  assert.ok(pending>0);assert.equal(ctrl.game.wallet,base-1);assert.equal(ctrl.game.jackpotEarnings,first);
  until(()=>ctrl.phase==='ChainChoice','pending choice');
  assert.ok(ctrl.dispatch('chainStop'));step(.05);
  assert.equal(ctrl.game.wallet,base-1+pending);
  until(()=>ctrl.game.canFire,'after bank');
  step(.05);ctrl.dispatch('finish');step(.05);ctrl.dispatch('confirmFinish');
  until(()=>rt.stats.countDone,'counted');
  assert.equal(rt.stats.countDone.counted,ctrl.game.wallet);assert.equal(rt.stats.maxLedgerDrift,0);assert.equal(rt.stats.lost,0);
  console.log('PASS real R3 chain: unpaid stays pending; bank/count match; ledger=0',JSON.stringify({first,pending,wallet:ctrl.game.wallet,counted:rt.stats.countDone.counted}));
} finally {pa.bw.free();pa.tw.free();}
