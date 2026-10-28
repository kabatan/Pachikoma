// Approved G, 2026-10-28. Four awards plus participation; JP secured sum.
import {MedalRules as BaseRules,MedalGame as BaseGame,MedalPhase} from './medal_rules_g_base_20261028.mjs';
export {makeRng,MedalPhase,MedalEvent,loanSeconds,winSeconds,JACKPOT_SECONDS} from './medal_rules_g_base_20261028.mjs';
const rankNames=['参加賞','C賞','B賞','A賞','S賞'];
export class MedalRules extends BaseRules {
 constructor(o={}){
  if(o.PrizeNames&&(o.PrizeNames.length!==5||o.PrizeNames.some((v,i)=>v!==rankNames[i])))throw Error('G requires four awards plus participation');
  super({...o,MaxExtraCredits:o.MaxExtraCredits===null?4:o.MaxExtraCredits,PrizeNames:rankNames,PrizeThresholds:[0,30,200,320,500]});
  this.PrizeNames=o.PrizeNames??rankNames;this.PrizeThresholds=o.PrizeThresholds??[0,70,100,150,500];
  this.MaxExtraCredits=o.MaxExtraCredits===null?Number.MAX_SAFE_INTEGER:(o.MaxExtraCredits??4);
  this.JackpotChainLaneOrder=o.JackpotChainLaneOrder??null;this.RuleVariant='G_20261028';this.validate();
 }
 validate(){
  const {PrizeNames:n,PrizeThresholds:t,MaxExtraCredits:m}=this;
  if(!Array.isArray(n)||n.length!==5||n.some((v,i)=>v!==rankNames[i])||!Array.isArray(t)||t.length!==5||t[0]!==0||t[4]!==500||t.some((v,i)=>!Number.isFinite(v)||v<0||(i&&v<=t[i-1]))||!Number.isSafeInteger(m)||m<1)throw Error('Invalid G boundaries/credits');
  const order=this.JackpotChainLaneOrder;
  if(order!=null&&(order.length!==7||new Set(order).size!==7||order.some(v=>!Number.isInteger(v)||v<1||v>7)))throw Error('Invalid G public chain order');
  try{this.PrizeThresholds=[0,30,200,320,500];this.MaxExtraCredits=Math.min(m,10);super.validate();}
  finally{this.PrizeThresholds=t;this.MaxExtraCredits=m;}
 }
 static fromJson(text){return new MedalRules(typeof text==='string'?JSON.parse(text):text);}
}
export class MedalGame extends BaseGame {
 get prize(){let rank=0;for(let i=0;i<this.rules.PrizeThresholds.length;i++)if(this.jackpotEarnings>=this.rules.PrizeThresholds[i])rank=i;return this.rules.PrizeNames[rank];}
 chooseChain(continueChain){
  const ok=super.chooseChain(continueChain);
  if(ok&&continueChain&&this.rules.JackpotChainLaneOrder){const count=this.lampCount;this._lamps=new Set(this.rules.JackpotChainLaneOrder.slice(0,count));}
  return ok;
 }
 // Existing add action must not bypass ticket receipt. Staff authorization is a separate call.
 get canAdd(){return !!this._staffAuthorized&&this.phase==='StaffWait'&&this.extraCreditsUsed<this.rules.MaxExtraCredits;}
 addCredit(){return false;}
 requestExtra(){
  if(this.phase!==MedalPhase.Continue||this.offerLeft<=0||this.extraCreditsUsed>=this.rules.MaxExtraCredits)return null;
  this.phase='StaffWait';this.offerLeft=0;this.staffWaitSeconds=0;this.staffReminder=false;
  this.extraRequestId=(this._requestSequence=(this._requestSequence??0)+1);return this.extraRequestId;
 }
 activateExtra(requestId=this.extraRequestId){
  if(this.phase!=='StaffWait'||requestId==null||requestId!==this.extraRequestId)return false;
  this._staffAuthorized=true;
  let ok;try{ok=super.addCredit();}finally{this._staffAuthorized=false;}
  if(ok)this.extraRequestId=null;return ok;
 }
 cancelExtra(){
  if(this.phase!=='StaffWait')return false;
  this.extraRequestId=null;this.phase=MedalPhase.Continue;return this.finish();
 }
 advance(dt){
  if(this.phase==='StaffWait'){
   if(!Number.isFinite(dt)||dt<0)throw new RangeError('seconds');
   this.staffWaitSeconds+=dt;if(this.staffWaitSeconds>=120)this.staffReminder=true;return;
  }
  super.advance(dt);
 }
}
