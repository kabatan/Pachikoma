// Synchronous, one-shot display recovery. No runtime replay, scheduling or DOM.
export function createFrameFaultBoundary({recover,onFault,onRecovered=()=>{}}={}) {
  if(typeof recover!=='function'||typeof onFault!=='function'||typeof onRecovered!=='function')throw TypeError('Frame fault callbacks must be functions');
  const describe=error=>({code:typeof error?.code==='string'?error.code:null,message:String(error?.message??error)});
  const state={status:'healthy',attempts:0,recoveries:0,faultNotifications:0,recoveredNotifications:0,stage:null,error:null,recoveryError:null,notificationError:null};
  const snapshot=()=>({...state,error:state.error?{...state.error}:null,recoveryError:state.recoveryError?{...state.recoveryError}:null,notificationError:state.notificationError?{...state.notificationError}:null});
  function fault(error,stage) {
    if(state.status==='fault')return false;
    state.status='fault';state.faultNotifications++;
    try{onFault(error,stage,snapshot());}catch(error){state.notificationError=describe(error);}
    return false;
  }
  function handle(error,stage) {
    if(state.status==='fault')return false;
    state.stage=stage;state.error=describe(error);
    const display=stage==='effects'||stage==='draw'||stage==='runtime'&&error?.code==='LCD_RESULT_HISTORY';
    if(!display||state.attempts)return fault(error,stage);
    state.attempts++;state.status='recovering';
    try{
      const result=recover(error,stage);
      if(result?.then){Promise.resolve(result).catch(()=>{});throw TypeError('Frame recovery must be synchronous');}
      if(result!==true||state.status==='fault')return fault(error,stage);
      state.status='recovered';state.recoveries++;state.recoveredNotifications++;
      onRecovered(error,stage,snapshot());
      return state.status!=='fault';
    }catch(recoveryError){state.recoveryError=describe(recoveryError);return fault(error,stage);}
  }
  // 10/31 検証: 表示の復旧のあと、液晶の復旧モードを解いた（次の客）なら、次の表示エラーでもう一度復旧を試せるようにする（でないと2回目は即停止）
  function rearm() { if(state.status!=='recovered')return false; state.status='healthy'; state.attempts=0; state.stage=null; state.error=null; state.rearms=(state.rearms??0)+1; return true; }
  return {handle,snapshot,rearm};
}

const recoveryBoundaries=new WeakSet();
// Install last, outside Choice/final/timer wrappers. The normal owner alone
// supplies the recovered image; stale wrappers must not paint or publish it.
export function installLcdRecoveryBoundary(lcd,{onCleared=()=>{}}={}) {
  if(recoveryBoundaries.has(lcd))return lcd;
  const gpu=Object.getOwnPropertyDescriptor(lcd,'gpuPanelSource');
  if(typeof lcd.frame!=='function'||typeof lcd.onEvent!=='function'||typeof lcd.prepare!=='function'||typeof lcd.renderRecoveredFrame!=='function'||!gpu?.configurable||typeof gpu.get!=='function')throw TypeError('LCD recovery boundary requires owner APIs and a configurable GPU getter');
  const frame=lcd.frame,onEvent=lcd.onEvent,prepare=lcd.prepare;
  lcd.frame=function(dt,...args){
    if(this.displayRecoveryActive)return this.renderRecoveredFrame(dt);
    const result=frame.call(this,dt,...args);
    if(this.displayRecoveryActive)return this.renderRecoveredFrame(0);
    return result;
  };
  // 復旧モードの間は合図を捨てる。ただし待機へ戻る 'attract'（reset）では復旧モードを解き、その合図から通常に戻す（次の客へ持ち越さない）
  lcd.onEvent=function(...args){
    if(this.displayRecoveryActive){
      if(args[0]==='attract'&&typeof this.clearDisplayRecovery==='function'&&this.clearDisplayRecovery()){try{onCleared();}catch{}}
      else return;
    }
    return onEvent.apply(this,args);
  };
  lcd.prepare=function(...args){if(this.displayRecoveryActive)return Promise.resolve();return prepare.apply(this,args);};
  Object.defineProperty(lcd,'gpuPanelSource',{...gpu,get(){return this.displayRecoveryActive?null:gpu.get.call(this);}});
  recoveryBoundaries.add(lcd);
  return lcd;
}
