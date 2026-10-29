import {createFinalResultRenderer} from './final_result_renderer_20261029.mjs';
import {createDailyResultBest,finalResultState} from './final_result_state_20261029.mjs';
const W=1152,H=1268,PX=34,PY=28,DURATION=350/30;
export async function attachFinalResultSurface(lcd,{controller,manifestUrl=new URL('../../../effects/jp_teacher/10_result/prod/manifest.json',import.meta.url)}={}){
 if(!lcd?.production||lcd.finalResultSurface)return lcd;
 const response=await fetch(manifestUrl);if(!response.ok)throw Error(`final result manifest HTTP ${response.status}`);
 const man=await response.json(),base=new URL('.',manifestUrl),video=document.createElement('video'),errors=[];
 video.muted=true;video.playsInline=true;video.preload='auto';
 await new Promise((resolve,reject)=>{const done=()=>{clearTimeout(timer);video.removeEventListener('loadeddata',done);video.removeEventListener('error',bad);resolve();},bad=()=>{clearTimeout(timer);video.removeEventListener('loadeddata',done);video.removeEventListener('error',bad);reject(Error('final result video unavailable'));},timer=setTimeout(bad,30000);video.addEventListener('loadeddata',done,{once:true});video.addEventListener('error',bad,{once:true});video.src=new URL(man.file,base).href;video.load();});
 const renderer=await createFinalResultRenderer(base,man,video),ctx=lcd.canvas.getContext('2d');
 let storage;try{storage=window.localStorage;}catch{}
 const daily=createDailyResultBest({storage}),original={};for(const k of ['frame','onEvent','prepare','setManual','dispose'])original[k]=lcd[k].bind(lcd);
 const revision=Object.getOwnPropertyDescriptor(lcd,'uploadRevision')?.get;
 let active=false,manual=false,time=0,state=null,disposed=false,game=null,replayAfter=null,renderedFrame=-1,presentedTime=0,videoCallback=null;
 const trackFrame=()=>{if(disposed||!video.requestVideoFrameCallback)return;videoCallback=video.requestVideoFrameCallback((_,meta)=>{presentedTime=meta.mediaTime;trackFrame();});};trackFrame();
 const recordError=e=>{const m=e.message??String(e);if(!errors.includes(m)){errors.push(m);console.error('[final-result]',m);}};
 const warm=()=>renderer.prewarm().catch(recordError);
 const seek=t=>new Promise(resolve=>{t=Math.min(video.duration-1/60,Math.max(0,t));if(Math.abs(video.currentTime-t)<.00001){resolve();return;}const done=()=>{clearTimeout(timer);video.removeEventListener('seeked',done);resolve();},timer=setTimeout(done,5000);video.addEventListener('seeked',done,{once:true});video.currentTime=t;});
 const exit=()=>{if(!active)return;active=false;video.pause();if(replayAfter!=null)controller.replayAfter=replayAfter;replayAfter=null;};
 const start=()=>{if(active&&game===controller.game)return;exit();game=controller.game;state=finalResultState(game,daily);time=0;presentedTime=0;renderedFrame=-1;active=true;video.currentTime=0;replayAfter=controller.replayAfter;controller.replayAfter=Math.max(replayAfter,controller.resultAge+DURATION);warm();if(!manual)video.play().catch(recordError);};
 lcd.onEvent=(id,...args)=>{const value=original.onEvent(id,...args);if(id==='finish_count'||id==='timeup')warm();if(id==='result')start();if(['start','attract','title','ticket','howto'].includes(id))exit();return value;};
 lcd.frame=(dt,F)=>{if(active&&(controller.game!==game||controller.game.phase!=='Result'))exit();original.frame(dt,F);if(!active)return;time+=dt;const mediaClock=!manual&&video.requestVideoFrameCallback&&time<DURATION?Math.min(time,presentedTime):time,f=Math.floor((mediaClock+1e-7)*30);if(!manual){const desired=Math.min(time,video.duration-1/60);if(Math.abs(video.currentTime-desired)>.14&&!video.seeking)video.currentTime=desired;if(time<video.duration-.04&&video.paused)video.play().catch(recordError);if(time>=video.duration-.04)video.pause();}
  if(f!==renderedFrame){renderer.render(f,state);renderedFrame=f;}
  ctx.fillStyle='#000';ctx.fillRect(0,0,lcd.canvas.width,lcd.canvas.height);ctx.drawImage(renderer.canvas,PX,PY,W,H);
 };
 lcd.setManual=on=>{manual=!!on;video.pause();original.setManual(on);if(active&&!manual)video.play().catch(recordError);};
 lcd.prepare=async dt=>{if(!active){await original.prepare(dt);return;}if(manual){await warm();await seek(time+dt);}};
 if(revision)Object.defineProperty(lcd,'uploadRevision',{configurable:true,enumerable:true,get:()=>active?undefined:revision.call(lcd)});
 lcd.finalResultSurface={video,renderer,errors,manifest:man,daily,get active(){return active;},get time(){return time;},get state(){return state;},get frame(){return renderedFrame;}};
 lcd.dispose=()=>{if(disposed)return;disposed=true;exit();if(videoCallback!=null)video.cancelVideoFrameCallback?.(videoCallback);video.removeAttribute('src');video.load();renderer.dispose();original.dispose();};
 // Load sparse lossless FX while attract/howto is displayed, never on a result stamp.
 await renderer.prewarm();return lcd;
}
