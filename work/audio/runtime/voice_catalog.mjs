export const VOICE_FILES={
  amitaro:{ikuyo:'amitaro/ikuyo.wav',yatta:'amitaro/yatta.wav',thanks:'amitaro/thanks.wav'},
  hau:{ikuyo:'voicevox/ikuyo.wav',yatta:'voicevox/yatta.wav',thanks:'voicevox/thanks.wav'},
};
export const VOICE_CREDITS={
  amitaro:'音声素材：あみたろの声素材工房 https://amitaro.net/',
  hau:'VOICEVOX:雨晴はう',
};
// 直前のSEが伝わった後に短く話す。飛行中/失敗/購入催促では無言。
export function voiceForEvent(e) {
  if(e.id==='start')return {key:'ikuyo',priority:2,delay:.15};
  if(e.id==='lamp123'&&(e.state?.first?.light||e.data?.first))return {key:'yatta',priority:2,delay:.35};
  if(e.id==='challenge_declare'&&(e.state?.first?.challenge||e.data?.first))return {key:'ikuyo',priority:4,delay:.25};
  if(e.id==='success_small'||e.id==='success_big')return {key:'yatta',priority:5,delay:.5};
  if(e.id==='jp')return {key:'yatta',priority:7,delay:1.75};
  if(e.id==='result')return {key:'thanks',priority:6,delay:.55};
  return null;
}
