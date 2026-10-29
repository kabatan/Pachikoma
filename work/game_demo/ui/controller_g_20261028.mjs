// Keep the existing 3-ball / 0.6s / one-buffer firing path unchanged.
import {MedalController as BaseController} from './controller.mjs';
import {MedalGame,MedalPhase} from '../rules/medal_rules_g_20261028.mjs';
export class MedalController extends BaseController {
 constructor(o={}){
  super(o);this.game=new MedalGame(this.rules,this.seed);
  // 結果画面を放置したら、この秒数で次の客の待機画面へ戻す(10/30 D9)。?resultauto=0 で戻さない(従来)・?resultauto=秒 で変更
  let q=null;try{q=new URLSearchParams(globalThis.location?.search??'').get('resultauto');}catch{}
  this.resultAutoSeconds=o.resultAutoSeconds??(q===null||q===''?25:(Number(q)||0));this._resultAutoAt=null;
 }
 update(dt){
  super.update(dt);
  if(this.game.phase!==MedalPhase.Result){this._resultAutoAt=null;return;}
  if(this.resultAutoSeconds>0&&(this.resultAge??0)>=this.resultAutoSeconds&&(this._resultAutoAt==null||this.resultAge-this._resultAutoAt>=1)){this._resultAutoAt=this.resultAge;this.dispatch('reset');}
 }
 _dispatch(action){
  const g=this.game;
  if(action==='reset'&&g.phase===MedalPhase.Result){
   if(this._lastActionFrame===this.frame||!(this.hooks.canReset?.()??true))return false;
   this.hooks.cancelFlights?.();this.game=new MedalGame(this.rules,this.seed==null?undefined:this.seed+1+this.sessionId);
   this.aimClock=0;this.confirmFinish=false;this.fireBuffer=this.preBuffer=null;return this._notifyG('reset');
  }
  if(g.phase===MedalPhase.Continue){
   if(this._lastActionFrame===this.frame)return false;
   if(['fire','add','requestExtra'].includes(action)){
    if(g.requestExtra()===null)return false;this.fireBuffer=this.preBuffer=null;return this._notifyG('requestExtra');
   }
   if(['challenge','finish','quit'].includes(action))return g.finish()?this._notifyG('finish'):false;
  }
  if(g.phase==='StaffWait'){
   if(this._lastActionFrame===this.frame)return false;
   if(action==='staffActivate')return g.activateExtra()?this._notifyG('add'):false;
   if(['challenge','finish','quit','cancelExtra'].includes(action))return g.cancelExtra()?this._notifyG('finish'):false;
   return false;
  }
  return super._dispatch(action);
 }
 _notifyG(action){this._lastActionFrame=this.frame;this.fireBuffer=this.preBuffer=null;for(const fn of this.listeners)fn(action,this);return true;}
}
