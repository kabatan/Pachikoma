// H_20261029 の操作。G の操作に、(1) ルーレットはボタンで止める (2) 連打中の誤操作を防ぐ (3) 規則のイベントを listeners へ流す、を足す。
// 連打（発射）は G と同じ経路: 'fire' → _fire → game.launch()（連打メーター中は無料の球）。
import {MedalController as GController} from './controller_g_20261028.mjs';
import {MedalGame,HPhase,MedalPhase} from '../rules/medal_rules_h_20261029.mjs';
export class MedalController extends GController {
 constructor(o={}){super(o);this.game=new MedalGame(this.rules,this.seed);this.lastGameEvent=null;}
 update(dt){super.update(dt);this._flushEvents();}
 landing(shotId,lane,reached=true){const ok=super.landing(shotId,lane,reached);this._flushEvents();return ok;}
 dispatch(action){const ok=super.dispatch(action);this._flushEvents();return ok;}
 /** 規則のイベント（meterReady/meterStart/meterFire/meterLand/meterEnd/rouletteStart/rouletteStopPress/rouletteStopped）を、行動と同じ listeners へ流す。 */
 _flushEvents(){
  for(const ev of this.game.takeEvents()){this.lastGameEvent=ev;for(const fn of this.listeners)fn(ev.type,this);}
 }
 _dispatch(action){
  const g=this.game;
  if(action==='reset'&&g.phase===MedalPhase.Result){
   if(this._lastActionFrame===this.frame||!(this.hooks.canReset?.()??true))return false;
   this.hooks.cancelFlights?.();this.game=new MedalGame(this.rules,this.seed==null?undefined:this.seed+1+this.sessionId);
   this.aimClock=0;this.confirmFinish=false;this.fireBuffer=this.preBuffer=null;return this._notifyG('reset');
  }
  if(g.phase===HPhase.Roulette){
   // ルーレット中は 'fire'（左）も 'challenge'（右）も「止める」。受け付け前（回り始めの押し残し）は無視する。
   if(this._lastActionFrame===this.frame)return false;
   if(['fire','challenge'].includes(action)){
    this.fireBuffer=this.preBuffer=null;
    if(!g.stopRoulette('button'))return false;
    this._lastActionFrame=this.frame;return true;   // 通知は game のイベント 'rouletteStopPress' で出る
   }
   return false;
  }
  if(g.meter&&['challenge','finish','confirmFinish'].includes(action))return false;   // 連打中は終了・勝負の宣言を受けない
  return super._dispatch(action);
 }
}
