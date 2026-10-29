import { AudioEngine } from './audio_engine.mjs';
import { observeContacts } from './contact_observer.mjs';
// busは既存 EffectsBus の購読のみ。on/offや規則通知の仕様は変更しない。
export async function connectAudio({pa,bus,master=.45,voiceProvider=new URLSearchParams(globalThis.location?.search??'').get('voice')??'amitaro',onError=console.error,bgmEnabled=false,bgmVolume=.65,bgmManifest,onBgmError=onError,getPhase=()=>null,jpPrewarmEvents=[],nativeQueryProof=null}) {
  const engine=new AudioEngine({master,voiceProvider,jpPrewarmEvents,bgmEnabled,bgmVolume,bgmManifest,onBgmError,getPhase});
  try {await engine.ready;} catch(error) {engine.dispose();throw error;}
  const off=bus.on('*',e=>engine.handleEvent(e));
  const observer=observeContacts(pa,c=>engine.contact(c),{onError,onPayout:e=>engine.payout(e.count),nativeQueryProof});
  const unlock=()=>engine.unlock().catch(onError);
  window.addEventListener('pointerdown',unlock);window.addEventListener('keydown',unlock);
  const visibility=()=>{if(document.hidden){engine.stopAll();engine.ctx.suspend();}else engine.ctx.resume?.().catch?.(()=>{});};   // 戻ったら音を再開（QA10/30 E: 最初のボタンを押すまで無音だった）
  document.addEventListener('visibilitychange',visibility);
  return {engine,observer,dispose(){off();observer.dispose();engine.dispose();window.removeEventListener('pointerdown',unlock);window.removeEventListener('keydown',unlock);document.removeEventListener('visibilitychange',visibility);}};
}
