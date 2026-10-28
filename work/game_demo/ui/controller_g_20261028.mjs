// Keep the existing 3-ball / 0.6s / one-buffer firing path unchanged.
import {MedalController as BaseController} from './controller.mjs';
import {MedalGame,MedalPhase} from '../rules/medal_rules_g_20261028.mjs';
export class MedalController extends BaseController {
 constructor(o={}){super(o);this.game=new MedalGame(this.rules,this.seed);}
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
