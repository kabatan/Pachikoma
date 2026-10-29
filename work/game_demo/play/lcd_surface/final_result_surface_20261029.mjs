import {createFinalResultRenderer} from './final_result_renderer_20261029.mjs';
import {createDailyResultBest,finalResultState} from './final_result_state_20261029.mjs';
const W=1152,H=1268,PX=34,PY=28,DURATION=350/30;
export async function attachFinalResultSurface(lcd,{controller,finalResultImageFactory=null,fullPanelPrevious=null,manifestUrl=new URL('../../../effects/jp_teacher/10_result/prod/manifest.json',import.meta.url)}={}){
 if(!lcd?.production||lcd.finalResultSurface)return lcd;
 const response=await fetch(manifestUrl);if(!response.ok)throw Error(`final result manifest HTTP ${response.status}`);
 const man=await response.json(),base=new URL('.',manifestUrl),video=document.createElement('video'),errors=[];
 video.muted=true;video.playsInline=true;video.preload='auto';
 await new Promise((resolve,reject)=>{const done=()=>{clearTimeout(timer);video.removeEventListener('loadeddata',done);video.removeEventListener('error',bad);resolve();},bad=()=>{clearTimeout(timer);video.removeEventListener('loadeddata',done);video.removeEventListener('error',bad);reject(Error('final result video unavailable'));},timer=setTimeout(bad,30000);video.addEventListener('loadeddata',done,{once:true});video.addEventListener('error',bad,{once:true});video.src=new URL(man.file,base).href;video.load();});
 let renderer=null,gpuMode=false;const initErrors=[];
 if(finalResultImageFactory){try{renderer=await finalResultImageFactory({base,man,video});if(!renderer?.render||!renderer?.prewarm||!renderer?.compose||!renderer?.setHudCanvas||!renderer?.materializeTo||!renderer?.surface)throw Error('Invalid final result GPU factory API');gpuMode=true;}catch(error){renderer?.dispose?.();renderer=null;const message='final GPU factory: '+String(error?.message??error);errors.push(message);initErrors.push(message);}}
 renderer??=await createFinalResultRenderer(base,man,video);const ctx=lcd.canvas.getContext('2d');
 const baseGpu=Object.getOwnPropertyDescriptor(lcd,'gpuPanelSource')?.get,baseMaterialize=lcd.materializeGpuLcd?.bind(lcd);let gpuFrame=null,generation=0,completedGeneration=0;
 const materializeFinal=reason=>{if(!gpuMode||!gpuFrame)return false;const image=renderer.materializeTo({panelCtx:ctx,reason});if(!image)throw Error('Final completed image unavailable: '+reason);return true;};
 const delegatePrevious=(reason,fn)=>{if(!active||!gpuFrame?.published)return fn();if(fullPanelPrevious&&typeof lcd.withFullPanelPreviousSource==='function')return lcd.withFullPanelPreviousSource({capture:()=>{const source=renderer.capturePublishedSource?.();return source?fullPanelPrevious.capture(source,{expectedStamp:source.stamp}):null;},materialize:why=>{const image=renderer.materializePublishedTo?.({panelCtx:ctx,reason:why});if(!image)throw Error('Old published final is unavailable: '+why);return true;}},fn);materializeFinal(reason);return fn();};


 let storage;try{storage=window.localStorage;}catch{}
 const daily=createDailyResultBest({storage}),original={};for(const k of ['frame','onEvent','prepare','setManual','dispose'])original[k]=lcd[k].bind(lcd);
 const revision=Object.getOwnPropertyDescriptor(lcd,'uploadRevision')?.get;
 let active=false,manual=false,time=0,state=null,disposed=false,game=null,replayAfter=null,renderedFrame=-1,presentedTime=0,videoCallback=null;
 const trackFrame=()=>{if(disposed||!video.requestVideoFrameCallback)return;videoCallback=video.requestVideoFrameCallback((_,meta)=>{presentedTime=meta.mediaTime;trackFrame();});};trackFrame();
 const recordError=e=>{const m=e.message??String(e);if(!errors.includes(m)){errors.push(m);console.error('[final-result]',m);}};
 // A requested pause may cancel an earlier play promise. Preserve that receipt,
 // but keep unowned AbortError and every other playback failure in errors.
 let pauseGeneration=0,lastPauseReason=null,playRequest=0;
 const playback={expectedPauseInterruptions:0,interruptions:[]};
 const pauseVideo=reason=>{pauseGeneration++;lastPauseReason=reason;video.pause();};
 const playVideo=()=>{const generation=pauseGeneration,request=++playRequest;video.play().catch(e=>{
  if(e?.name==='AbortError'&&/interrupted by a call to pause\(\)/.test(e.message??'')&&pauseGeneration!==generation){
   playback.expectedPauseInterruptions++;if(playback.interruptions.length<32)playback.interruptions.push({request,startedGeneration:generation,pausedGeneration:pauseGeneration,reason:lastPauseReason,message:e.message});
  }else recordError(e);
 });};
 const warm=()=>renderer.prewarm().catch(recordError);
 const seek=t=>new Promise(resolve=>{t=Math.min(video.duration-1/60,Math.max(0,t));if(Math.abs(video.currentTime-t)<.00001){resolve();return;}const done=()=>{clearTimeout(timer);video.removeEventListener('seeked',done);resolve();},timer=setTimeout(done,5000);video.addEventListener('seeked',done,{once:true});video.currentTime=t;});
 const exit=()=>{if(!active)return;gpuFrame=null;active=false;pauseVideo('exit');if(replayAfter!=null)controller.replayAfter=replayAfter;replayAfter=null;};
 const start=()=>{if(active&&game===controller.game)return;exit();game=controller.game;state=finalResultState(game,daily);generation++;time=0;presentedTime=0;renderedFrame=-1;active=true;video.currentTime=0;replayAfter=controller.replayAfter;controller.replayAfter=Math.max(replayAfter,controller.resultAge+DURATION);warm();if(!manual)playVideo();};
 lcd.onEvent=(id,...args)=>{const value=delegatePrevious('final-event:'+id,()=>original.onEvent(id,...args));if(id==='finish_count'||id==='timeup')warm();if(id==='result')start();if(['start','attract','title','ticket','howto'].includes(id))exit();return value;};
 lcd.frame=(dt,F)=>{if(active&&(controller.game!==game||controller.game.phase!=='Result')){delegatePrevious('final-phase-exit',()=>{exit();original.frame(dt,F);});}else original.frame(dt,F);if(!active)return;time+=dt;const mediaClock=!manual&&video.requestVideoFrameCallback&&time<DURATION?Math.min(time,presentedTime):time,f=Math.floor((mediaClock+1e-7)*30);if(!manual){const desired=Math.min(time,video.duration-1/60);if(Math.abs(video.currentTime-desired)>.14&&!video.seeking)video.currentTime=desired;if(time<video.duration-.04&&video.paused)playVideo();if(time>=video.duration-.04)pauseVideo('ended');}
  if(f!==renderedFrame){const before=gpuMode?renderer.surface.revision:0;renderer.render(f,state);renderedFrame=f;if(gpuMode&&renderer.surface.revision!==before){completedGeneration=generation;renderer.setCompletedGeneration?.(completedGeneration);}}
  if(gpuMode&&renderer.surface.valid){if(!gpuFrame||gpuFrame.generation!==completedGeneration)gpuFrame={owner:'final-result',backend:renderer,generation:completedGeneration,_published:false,get published(){return this._published;},set published(v){this._published=!!v;if(v)renderer.notePublished?.(this.generation);}};return;}
  gpuFrame=null;ctx.fillStyle='#000';ctx.fillRect(0,0,lcd.canvas.width,lcd.canvas.height);if(renderer.canvas)ctx.drawImage(renderer.canvas,PX,PY,W,H);
 };
 lcd.setManual=on=>{manual=!!on;pauseVideo('manual');original.setManual(on);if(active&&!manual)playVideo();};
 lcd.prepare=async dt=>{if(!active){await original.prepare(dt);return;}if(manual){await warm();await seek(time+dt);}};
 if(revision)Object.defineProperty(lcd,'uploadRevision',{configurable:true,enumerable:true,get:()=>active?undefined:revision.call(lcd)});
 Object.defineProperty(lcd,'gpuPanelSource',{configurable:true,enumerable:true,get:()=>active?gpuFrame:baseGpu?.call(lcd)});
 lcd.materializeGpuLcd=(reason,force)=>active&&gpuFrame?materializeFinal(reason):baseMaterialize?.(reason,force);
 lcd.finalResultSurface={video,renderer,errors,initErrors,get gpuMode(){return gpuMode;},get generation(){return generation;},diagnostics:()=>renderer.diagnostics?.()??{mode:'legacy',extraContexts:1},playback,manifest:man,daily,get active(){return active;},get time(){return time;},get state(){return state;},get frame(){return renderedFrame;}};
 lcd.dispose=()=>{if(disposed)return;disposed=true;exit();if(videoCallback!=null)video.cancelVideoFrameCallback?.(videoCallback);video.removeAttribute('src');video.load();renderer.dispose();original.dispose();};
 // Load sparse lossless FX while attract/howto is displayed, never on a result stamp.
 try{await renderer.prewarm();renderer.warmup?.();}catch(error){disposed=true;if(videoCallback!=null)video.cancelVideoFrameCallback?.(videoCallback);renderer.dispose();video.removeAttribute('src');video.load();throw error;}return lcd;
}
