// Approved 08490fad attract/title loop. The rule state still owns start/howto.
import {createAttractGpu,suppressCanvasPaint} from './attract_gpu_1030.mjs';
const W=1152,H=1268,PX=34,PY=28;
export async function attachAttractSurface(lcd,{getState,manifestUrl=new URL('../../../effects/attract/prod/manifest.json',import.meta.url)}={}) {
  if(!lcd?.production||lcd.attractSurface)return lcd;
  const response=await fetch(manifestUrl);if(!response.ok)throw Error(`attract manifest: HTTP ${response.status}`);
  const man=await response.json(),base=new URL('.',manifestUrl),v=document.createElement('video');
  const ctx=lcd.canvas.getContext('2d'),errors=[];
  v.muted=true;v.playsInline=true;v.loop=true;v.preload='auto';
  const error=()=>{const message=`attract video: ${v.error?.message??'unavailable'}`;errors.push(message);console.error(message);};
  v.addEventListener('error',error);
  await new Promise((resolve,reject)=>{
    const done=()=>{clearTimeout(timer);v.removeEventListener('loadeddata',done);v.removeEventListener('error',bad);resolve();};
    const bad=()=>{clearTimeout(timer);v.removeEventListener('loadeddata',done);v.removeEventListener('error',bad);reject(Error('attract video unavailable'));};
    const timer=setTimeout(bad,20000);v.addEventListener('loadeddata',done,{once:true});v.addEventListener('error',bad,{once:true});
    v.src=new URL(man.file,base).href;v.load();
  });
  let active=false,manual=false,time=0,disposed=false;
  const query=new URLSearchParams(globalThis.location?.search??'');
  const gpuEnabled=query.get('attractgpu')!=='0',skipEnabled=query.get('attractskip')!=='0';
  const paint=skipEnabled?suppressCanvasPaint(ctx):{stats:{skipped:0},run:fn=>fn(),dispose(){}};
  let gpu=null,published=false,frameRevision=0,heldFrame=null,heldRevision=-1,callback=null,fallbackKey=null;
  const stats={frames:0,hiddenFrames:0,canvasDraws:0,decodedFrames:0,boundaryCopies:0};
  const decoded=()=>{frameRevision++;stats.decodedFrames++;};
  const watch=()=>{callback=v.requestVideoFrameCallback(()=>{callback=null;if(disposed)return;decoded();watch();});};
  if(gpuEnabled&&typeof v.requestVideoFrameCallback==='function')watch();
  v.addEventListener('seeked',decoded);v.addEventListener('loadeddata',decoded);
  const refresh=()=>{
    if(!gpu)return;
    if(typeof v.requestVideoFrameCallback!=='function'){
      const quality=v.getVideoPlaybackQuality?.(),key=quality?.totalVideoFrames||Math.floor(v.currentTime*(man.fps||30));
      if(key!==fallbackKey){fallbackKey=key;decoded();}
    }
    if(heldRevision!==frameRevision&&v.readyState>=2){
      // Retain the frame last presented, so event-time transitions do not read
      // a newer decoder frame. This is a frame reference, not a CPU pixel copy.
      if(typeof VideoFrame==='function'){const next=new VideoFrame(v);heldFrame?.close();heldFrame=next;}
      heldRevision=frameRevision;
    }
  };
  const direct=()=>!!gpu&&!lcd.choiceV20?.active&&!lcd.choiceV20?.holding&&!lcd.finalResultSurface?.active&&!lcd.timeupSurface?.active;
  const draw=(boundary=false)=>{
    ctx.fillStyle='#000';ctx.fillRect(0,0,lcd.canvas.width,lcd.canvas.height);
    if(v.readyState>=2)ctx.drawImage(boundary?(heldFrame??v):v,PX,PY,W,H);
    stats.canvasDraws++;
  };
  const materialize=()=>{draw(true);published=false;stats.boundaryCopies++;};
  const wanted=()=>{const s=getState();return !lcd.displayRecoveryActive&&s.phase==='Attract'&&!s.howto;};
  const original={frame:lcd.frame.bind(lcd),onEvent:lcd.onEvent.bind(lcd),prepare:lcd.prepare.bind(lcd),setManual:lcd.setManual.bind(lcd),applyLights:lcd.applyLights.bind(lcd),dispose:lcd.dispose.bind(lcd)};
  const revision=Object.getOwnPropertyDescriptor(lcd,'uploadRevision')?.get;
  const sync=()=>{const next=wanted();if(next!==active){if(active&&published)materialize();active=next;if(active){time=0;v.currentTime=0;}else v.pause();}if(active&&!manual&&v.paused)v.play().catch(()=>{});};
  lcd.frame=(dt,F)=>{
    sync();
    // Only these fully covered title modes use the simple normal Canvas path.
    // JP/choice/result and all transition ownership still execute unmodified.
    const skip=active&&skipEnabled&&v.readyState>=2&&['attract','title'].includes(lcd.current?.mode);
    if(skip){paint.run(()=>original.frame(dt,F));stats.hiddenFrames++;}else original.frame(dt,F);
    if(!active)return;
    stats.frames++;refresh();
    if(!direct()||!heldFrame){published=false;draw();}
    if(manual)time=(time+dt)%man.duration;
  };
  lcd.onEvent=(id,...args)=>{if(active&&published)materialize();if(id==='attract'){time=0;v.currentTime=0;}const result=original.onEvent(id,...args);sync();return result;};
  lcd.setManual=on=>{manual=!!on;v.pause();original.setManual(on);sync();};
  lcd.prepare=async dt=>{
    sync();if(!active){await original.prepare(dt);return;}
    if(!manual)return;const t=(time+dt)%man.duration;
    if(Math.abs(v.currentTime-t)<.0001)return;
    await new Promise(resolve=>{const done=()=>{clearTimeout(timer);v.removeEventListener('seeked',done);resolve();};const timer=setTimeout(done,2000);v.addEventListener('seeked',done,{once:true});v.currentTime=t;});
  };
  // Preserve the existing cabinet lighting path; only replace the LCD pixels.
  lcd.applyLights=F=>original.applyLights(F);
  if(revision)Object.defineProperty(lcd,'uploadRevision',{configurable:true,enumerable:true,get:()=>active?undefined:revision.call(lcd)});
  lcd.attractSurface={video:v,manifest:man,errors,get active(){return active;},get time(){return manual?time:v.currentTime;},
    connectGpu(options){if(gpuEnabled&&!gpu)gpu=createAttractGpu({...options,video:v,width:lcd.canvas.width,height:lcd.canvas.height});},
    get directActive(){return active&&direct();},
    compose(){if(!active||!direct())return null;const texture=gpu.compose(frameRevision);published=!!texture;return texture;},
    materialize,
    diagnostics:()=>({...stats,gpuEnabled,skipEnabled,frameRevision,heldFrame:!!heldFrame,paintSkipped:paint.stats.skipped,gpu:gpu?.diagnostics()??null})};
  lcd.dispose=()=>{if(disposed)return;disposed=true;if(callback!==null)v.cancelVideoFrameCallback?.(callback);heldFrame?.close();heldFrame=null;gpu?.dispose();paint.dispose();v.pause();v.removeEventListener('seeked',decoded);v.removeEventListener('loadeddata',decoded);v.removeEventListener('error',error);v.removeAttribute('src');v.load();original.dispose();};
  sync();return lcd;
}
