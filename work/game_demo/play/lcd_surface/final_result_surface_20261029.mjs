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
 const start=()=>{if(active&&game===controller.game)return;exit();plain=false;lastCheck=0;guard.bad=0;guard.force=null;if(guard.stage==='gpu')guard.reason=null;if(guard.stage==='plain'){guard.stage='legacy';}game=controller.game;state=withExtras(finalResultState(game,daily),game);generation++;time=0;presentedTime=0;renderedFrame=-1;active=true;video.currentTime=0;replayAfter=controller.replayAfter;controller.replayAfter=Math.max(replayAfter,controller.resultAge+DURATION);warm();if(!manual)playVideo();};

 // 10/30 保険（?finalguard=0 で無し）: 最終結果が出て2秒たっても動画が readyState<2、または画が黒(中央付近の輝度がほぼ0)なら、旧の描画経路へ切り替えて結果を必ず見せる。
 // 段階: GPU合成 → 旧の描画(WebGL2・2D転写) → それでも黒/動画なしなら、結果の数字だけの静止カード。原因は console.error と errors に残す。
 const GUARD=new URLSearchParams(globalThis.location?.search??'').get('finalguard')!=='0';
 const guard={enabled:GUARD,stage:'gpu',reason:null,checks:0,bad:0,switchedAt:null,force:null,log:[]};let legacy=null,lastCheck=0,plain=false;
 const probe=document.createElement('canvas');probe.width=probe.height=8;const probeCtx=probe.getContext('2d',{willReadFrequently:true});
 const lumaOf=d=>{let t=0;for(let i=0;i<d.length;i+=4)t+=(d[i]+d[i+1]+d[i+2])/765;return t/(d.length/4);};
 const videoLuma=()=>{if(video.readyState<2||!video.videoWidth)return null;try{probeCtx.drawImage(video,video.videoWidth*.35,video.videoHeight*.35,video.videoWidth*.3,video.videoHeight*.3,0,0,8,8);return lumaOf(probeCtx.getImageData(0,0,8,8).data);}catch{return null;}};
 const panelLuma=()=>{try{probeCtx.drawImage(lcd.canvas,PX+W*.35,PY+H*.35,W*.3,H*.3,0,0,8,8);return lumaOf(probeCtx.getImageData(0,0,8,8).data);}catch{return null;}};
 const guardLog=(level,msg)=>{const m='[final-result-guard] '+msg;guard.log.push(m);if(guard.log.length>20)guard.log.shift();if(!errors.includes(m))errors.push(m);console[level](m);};
 const drawPlain=()=>{
  ctx.fillStyle='#000';ctx.fillRect(0,0,lcd.canvas.width,lcd.canvas.height);ctx.save();ctx.translate(PX,PY);
  const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#2a1260');g.addColorStop(1,'#14082e');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='#e8b830';ctx.lineWidth=14;ctx.strokeRect(14,14,W-28,H-28);ctx.textAlign='center';ctx.lineJoin='round';
  const t=(txt,y,sz,fill)=>{ctx.font=sz+'px "Dela Gothic One","MPLUS1p-ExtraBold",sans-serif';ctx.lineWidth=sz*.18;ctx.strokeStyle='#08020f';ctx.strokeText(txt,W/2,y);ctx.fillStyle=fill;ctx.fillText(txt,W/2,y);};
  const st=state??{totalText:'-----',prize:'',nextMessage:''};
  t(st.prize||'',330,150,'#ffd23a');t('TOTAL',560,80,'#ffffff');t(String(st.totalText)+' 玉',760,150,'#ffe27a');t(st.nextMessage||'',930,54,'#ffffff');t('もう一度挑戦！',1100,70,'#ffd23a');
  ctx.restore();
 };
 const toLegacy=async reason=>{
  if(guard.stage!=='gpu')return;guard.stage='legacy-pending';guard.reason=reason;guardLog('error','GPU合成の最終結果が出ていません（'+reason+'）。旧の描画へ切り替えます');
  try{const r=await createFinalResultRenderer(base,man,video);await r.prewarm();if(disposed){r.dispose?.();return;}legacy=r;renderer=r;gpuMode=false;gpuFrame=null;renderedFrame=-1;guard.stage='legacy';guard.switchedAt=performance.now();guard.bad=0;guardLog('warn','旧の描画へ切り替えました');}
  catch(e){guardLog('error','旧の描画を作れません: '+String(e?.message??e));guard.stage='legacy';guard.bad=2;}
 };
 const guardTick=()=>{
  if(!GUARD||manual||plain||time<2)return;const now=performance.now();if(now-lastCheck<250)return;lastCheck=now;guard.checks++;
  let bad=guard.force&&(guard.stage==='gpu'||guard.force==='persist')?'test:'+guard.force:null;
  if(!bad){if(video.readyState<2)bad='video readyState='+video.readyState;
   else if(gpuMode&&renderer.surface?.valid===false)bad='gpu surface invalid';
   else{const l=videoLuma();if(l!=null&&l<.02)bad='video black luma='+l.toFixed(3);else if(!gpuMode&&guard.stage==='legacy'){const p=panelLuma();if(p!=null&&p<.02)bad='panel black luma='+p.toFixed(3);}}}
  if(!bad){guard.bad=0;return;}guard.bad++;guard.reason=bad;
  if(guard.stage==='gpu')toLegacy(bad);
  else if(guard.stage==='legacy'&&guard.bad>=3){plain=true;guard.stage='plain';guardLog('error','旧の描画でも表示できません（'+bad+'）。結果だけの静止カードを出します');}
 };

 // 10/30 初見向けの一言（?resulthelp=0 で無し）: TOTAL の説明・どの賞でも褒める一言・その回の惜しさ・「またね」。compositor が state.extras を字にして下段の行へ回す。
 const HELP=new URLSearchParams(globalThis.location?.search??'').get('resulthelp')!=='0';
 const trk={game:null,maxLamps:0,lastJp:null,phase:null};
 const track=()=>{const g=controller.game;if(!g)return;if(trk.game!==g||(g.phase==='Attract'&&trk.phase!=='Attract')){trk.game=g;trk.maxLamps=0;trk.lastJp=null;}trk.phase=g.phase;const l=g.lampCount??0;if(l>trk.maxLamps)trk.maxLamps=l;const m=g.meter;if(m&&m.kind==='jp'&&m.threshold)trk.lastJp={count:m.count??0,threshold:m.threshold};};
 const PRAISE=['遊んでくれて ありがとう！','ナイスプレイ！','いい調子！','すごい！ 上級者！','最高賞！ 神プレイ！'];
 const withExtras=(st,g)=>{
  if(!HELP)return st;try{
   const names=g.rules?.PrizeNames??[],pj=g.jackpotSuccesses??0,ml=trk.maxLamps,jp=trk.lastJp,line=(key,parts,w=800,h=130,size=70)=>({key:key+':'+parts.map(p=>p[0]).join(''),w,h,size,parts});
   const prize=st.rankIndex>0?names[st.rankIndex]:'';const lines={};
   lines.total=line('t',[['TOTAL＝いま手元に残った玉の数','w']],780,64,34);
   lines.praise=line('p',[[prize?prize+' ':'','g'],[PRAISE[st.rankIndex]??'ナイスプレイ！','w']]);
   let miss=null;
   if(pj>0)miss=[['JACKPOT ','g'],[`${pj}回！ すごい！`,'w']];
   else if(jp&&ml>=6&&jp.threshold-jp.count>0&&jp.threshold-jp.count<=3)miss=[['封印あと','w'],[`${jp.threshold-jp.count}本`,'g'],['だった！ おしい！','w']];
   else if(ml>=5)miss=[['5灯！ あと1つで ','w'],['JACKPOT CHANCE','g'],['！','w']];
   else if(ml>=1)miss=[[`最高${ml}灯！ 次は `,'w'],['6灯','g'],[' をねらおう！','w']];
   if(miss)lines.miss=line('m',miss);
   lines.bye=line('b',st.nextIndex!=null?[['またね！ 次は ','w'],[names[st.nextIndex],'g'],[' をねらおう！','w']]:[['またね！ ','w'],['最高賞','g'],[' おめでとう！','w']]);
   return {...st,extras:{lines}};}catch(e){return st;}
 };
 lcd.onEvent=(id,...args)=>{const value=delegatePrevious('final-event:'+id,()=>original.onEvent(id,...args));if(id==='finish_count'||id==='timeup')warm();if(id==='result')start();if(['start','attract','title','ticket','howto'].includes(id))exit();return value;};
 lcd.frame=(dt,F)=>{track();if(active&&(controller.game!==game||controller.game.phase!=='Result')){delegatePrevious('final-phase-exit',()=>{exit();original.frame(dt,F);});}else original.frame(dt,F);if(!active)return;time+=dt;guardTick();if(plain){gpuFrame=null;drawPlain();return;}const mediaClock=!manual&&video.requestVideoFrameCallback&&time<DURATION?Math.min(time,presentedTime):time,f=Math.floor((mediaClock+1e-7)*30);if(!manual){const desired=Math.min(time,video.duration-1/60);if(Math.abs(video.currentTime-desired)>.14&&!video.seeking)video.currentTime=desired;if(time<video.duration-.04&&video.paused)playVideo();if(time>=video.duration-.04)pauseVideo('ended');}
  if(f!==renderedFrame){const before=gpuMode?renderer.surface.revision:0;renderer.render(f,state);renderedFrame=f;if(gpuMode&&renderer.surface.revision!==before){completedGeneration=generation;renderer.setCompletedGeneration?.(completedGeneration);}}
  if(gpuMode&&renderer.surface.valid){if(!gpuFrame||gpuFrame.generation!==completedGeneration)gpuFrame={owner:'final-result',backend:renderer,generation:completedGeneration,_published:false,get published(){return this._published;},set published(v){this._published=!!v;if(v)renderer.notePublished?.(this.generation);}};return;}
  gpuFrame=null;ctx.fillStyle='#000';ctx.fillRect(0,0,lcd.canvas.width,lcd.canvas.height);if(renderer.canvas)ctx.drawImage(renderer.canvas,PX,PY,W,H);
 };
 lcd.setManual=on=>{manual=!!on;pauseVideo('manual');original.setManual(on);if(active&&!manual)playVideo();};
 lcd.prepare=async dt=>{if(!active){await original.prepare(dt);return;}if(manual){await warm();await seek(time+dt);}};
 if(revision)Object.defineProperty(lcd,'uploadRevision',{configurable:true,enumerable:true,get:()=>active?undefined:revision.call(lcd)});
 Object.defineProperty(lcd,'gpuPanelSource',{configurable:true,enumerable:true,get:()=>active?gpuFrame:baseGpu?.call(lcd)});
 lcd.materializeGpuLcd=(reason,force)=>active&&gpuFrame?materializeFinal(reason):baseMaterialize?.(reason,force);
 lcd.finalResultSurface={video,get renderer(){return renderer;},guard,errors,initErrors,get gpuMode(){return gpuMode;},get generation(){return generation;},diagnostics:()=>renderer.diagnostics?.()??{mode:'legacy',extraContexts:1},playback,manifest:man,daily,get active(){return active;},get time(){return time;},get state(){return state;},get frame(){return renderedFrame;}};
 lcd.dispose=()=>{if(disposed)return;disposed=true;exit();if(videoCallback!=null)video.cancelVideoFrameCallback?.(videoCallback);video.removeAttribute('src');video.load();renderer.dispose();original.dispose();};
 // Load sparse lossless FX while attract/howto is displayed, never on a result stamp.
 try{await renderer.prewarm();renderer.warmup?.();renderer.warmActualDraw?.();}catch(error){disposed=true;if(videoCallback!=null)video.cancelVideoFrameCallback?.(videoCallback);renderer.dispose();video.removeAttribute('src');video.load();throw error;}return lcd;
}
