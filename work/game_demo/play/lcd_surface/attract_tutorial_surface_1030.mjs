// 10/30 attract_surface_20261029 の拡張: 待機(attract)ループに加えて、開始ボタン後の「遊び方」(howto)に冒頭チュートリアル動画(1152x1268, 再生は1回)を流す。
// 起動時にデコーダを予熱し、GPU合成(createAttractGpu)も動画ごとに用意するので、場面の切替で新しい読み込み/シェーダ作成は起きない。
// ルールのhowto(開始ボタン→howto→ticket→開始、押すと飛ばせる)は ctrl 側のまま。?tutorial=old のとき play.mjs はこのファイルを使わず従来の attract_surface_20261029 を使う。
import {createAttractGpu,suppressCanvasPaint} from './attract_gpu_1030.mjs';
import {warmPausedVideo,withRestored2D} from './startup_warm.mjs';
const W=1152,H=1268,PX=34,PY=28;
async function loadVideo(url,{loop,label,errors}) {
  const v=document.createElement('video');
  v.muted=true;v.playsInline=true;v.loop=loop;v.preload='auto';
  const error=()=>{const message=`${label} video: ${v.error?.message??'unavailable'}`;errors.push(message);console.error(message);};
  v.addEventListener('error',error);
  await new Promise((resolve,reject)=>{
    const done=()=>{clearTimeout(timer);v.removeEventListener('loadeddata',done);v.removeEventListener('error',bad);resolve();};
    const bad=()=>{clearTimeout(timer);v.removeEventListener('loadeddata',done);v.removeEventListener('error',bad);reject(Error(`${label} video unavailable`));};
    const timer=setTimeout(bad,20000);v.addEventListener('loadeddata',done,{once:true});v.addEventListener('error',bad,{once:true});
    v.src=url;v.load();
  });
  return {v,error};
}
export async function attachAttractSurface(lcd,{getState,manifestUrl=new URL('../../../effects/attract/prod/manifest.json',import.meta.url),tutorialManifestUrl=new URL('../../../effects/tutorial/prod/manifest.json',import.meta.url)}={}) {
  if(!lcd?.production||lcd.attractSurface)return lcd;
  const response=await fetch(manifestUrl);if(!response.ok)throw Error(`attract manifest: HTTP ${response.status}`);
  const man=await response.json(),base=new URL('.',manifestUrl);
  const ctx=lcd.canvas.getContext('2d'),errors=[];
  const query=new URLSearchParams(globalThis.location?.search??'');
  const gpuEnabled=query.get('attractgpu')!=='0',skipEnabled=query.get('attractskip')!=='0';
  const liteMedia=m=>query.get('videolite')==='1'&&m.liteSource===m.file&&m.liteFile?m.liteFile:m.file;
  const attractLoaded=await loadVideo(new URL(liteMedia(man),base).href,{loop:true,label:'attract',errors});
  // チュートリアル動画。読めなくても待機は動かす(その場合 howto は従来の説明に戻る)
  let tman=null,tloaded=null;
  try {
    const tr=await fetch(tutorialManifestUrl);if(!tr.ok)throw Error(`HTTP ${tr.status}`);
    tman=await tr.json();tloaded=await loadVideo(new URL(liteMedia(tman),new URL('.',tutorialManifestUrl)).href,{loop:false,label:'tutorial',errors});
  } catch(e){console.error('tutorial video unavailable: '+(e?.message??e));errors.push('tutorial: '+(e?.message??e));tman=null;tloaded=null;}
  let disposed=false;
  const stats={frames:0,hiddenFrames:0,canvasDraws:0,decodedFrames:0,boundaryCopies:0};
  const mk=(v,m)=>({v,man:m,gpu:null,frameRevision:0,heldFrame:null,heldRevision:-1,callback:null,fallbackKey:null});
  const sources={attract:mk(attractLoaded.v,man),tutorial:tloaded?mk(tloaded.v,tman):null};
  const all=Object.values(sources).filter(Boolean);
  for(const s of all){
    s.decoded=()=>{s.frameRevision++;stats.decodedFrames++;};
    s.watch=()=>{s.callback=s.v.requestVideoFrameCallback(()=>{s.callback=null;if(disposed)return;s.decoded();s.watch();});};
    if(gpuEnabled&&typeof s.v.requestVideoFrameCallback==='function')s.watch();
    s.v.addEventListener('seeked',s.decoded);s.v.addEventListener('loadeddata',s.decoded);
  }
  let active=false,kind=null,manual=false,time=0,published=false,cur=sources.attract;
  const paint=skipEnabled?suppressCanvasPaint(ctx):{stats:{skipped:0},run:fn=>fn(),dispose(){}};
  const refresh=()=>{
    const s=cur;if(!s.gpu)return;const v=s.v;
    if(typeof v.requestVideoFrameCallback!=='function'){
      const quality=v.getVideoPlaybackQuality?.(),key=quality?.totalVideoFrames||Math.floor(v.currentTime*(s.man.fps||30));
      if(key!==s.fallbackKey){s.fallbackKey=key;s.decoded();}
    }
    if(s.heldRevision!==s.frameRevision&&v.readyState>=2){
      // Retain the frame last presented, so event-time transitions do not read
      // a newer decoder frame. This is a frame reference, not a CPU pixel copy.
      if(typeof VideoFrame==='function'){const next=new VideoFrame(v);s.heldFrame?.close();s.heldFrame=next;}
      s.heldRevision=s.frameRevision;
    }
  };
  const direct=()=>!!cur.gpu&&!lcd.choiceV20?.active&&!lcd.choiceV20?.holding&&!lcd.finalResultSurface?.active&&!lcd.timeupSurface?.active;
  const draw=(boundary=false)=>{
    ctx.fillStyle='#000';ctx.fillRect(0,0,lcd.canvas.width,lcd.canvas.height);
    if(cur.v.readyState>=2)ctx.drawImage(boundary?(cur.heldFrame??cur.v):cur.v,PX,PY,W,H);
    stats.canvasDraws++;
  };
  const materialize=()=>{draw(true);published=false;stats.boundaryCopies++;};
  // 何を流すか: Attract 中、howto でなければ待機ループ、howto 中(動画が読めていれば)チュートリアル
  const wantedKind=()=>{const s=getState();if(lcd.displayRecoveryActive||s.phase!=='Attract')return null;return s.howto?(sources.tutorial?'tutorial':null):'attract';};
  const original={frame:lcd.frame.bind(lcd),onEvent:lcd.onEvent.bind(lcd),prepare:lcd.prepare.bind(lcd),setManual:lcd.setManual.bind(lcd),applyLights:lcd.applyLights.bind(lcd),dispose:lcd.dispose.bind(lcd)};
  const revision=Object.getOwnPropertyDescriptor(lcd,'uploadRevision')?.get;
  const sync=()=>{
    const k=wantedKind();
    if(k!==kind){
      if(active&&published)materialize();
      if(active)cur.v.pause();
      kind=k;active=k!==null;
      if(active){cur=sources[k];time=0;cur.v.currentTime=0;}
    }
    if(active&&!manual&&cur.v.paused&&!cur.v.ended)cur.v.play().catch(()=>{});
  };
  lcd.frame=(dt,F)=>{
    sync();
    // Only these fully covered title modes use the simple normal Canvas path.
    // JP/choice/result and all transition ownership still execute unmodified.
    const skip=active&&skipEnabled&&cur.v.readyState>=2&&(kind==='attract'?['attract','title']:['howto']).includes(lcd.current?.mode);
    if(skip){paint.run(()=>original.frame(dt,F));stats.hiddenFrames++;}else original.frame(dt,F);
    if(!active)return;
    stats.frames++;refresh();
    if(!direct()||!cur.heldFrame){published=false;draw();}
    if(manual){time+=dt;if(cur.man.loop!==false)time%=cur.man.duration;else time=Math.min(time,cur.man.duration);}
  };
  lcd.onEvent=(id,...args)=>{
    if(active&&published)materialize();
    if(id==='attract'){sources.attract.v.currentTime=0;if(kind==='attract')time=0;}
    if(id==='howto'&&sources.tutorial){sources.tutorial.v.currentTime=0;if(kind==='tutorial')time=0;}
    const result=original.onEvent(id,...args);sync();return result;
  };
  lcd.setManual=on=>{manual=!!on;for(const s of all)s.v.pause();original.setManual(on);sync();};
  lcd.prepare=async dt=>{
    sync();if(!active){await original.prepare(dt);return;}
    if(!manual)return;const t=cur.man.loop!==false?(time+dt)%cur.man.duration:Math.min(time+dt,cur.man.duration-.001);
    if(Math.abs(cur.v.currentTime-t)<.0001)return;
    const v=cur.v;
    await new Promise(resolve=>{const done=()=>{clearTimeout(timer);v.removeEventListener('seeked',done);resolve();};const timer=setTimeout(done,2000);v.addEventListener('seeked',done,{once:true});v.currentTime=t;});
  };
  // Preserve the existing cabinet lighting path; only replace the LCD pixels.
  lcd.applyLights=F=>original.applyLights(F);
  if(revision)Object.defineProperty(lcd,'uploadRevision',{configurable:true,enumerable:true,get:()=>active?undefined:revision.call(lcd)});
  // 起動時の予熱: チュートリアルのデコーダを一度動かして最初のフレームを用意する(開始ボタン後の初回再生で遅れない)
  const warm={tutorial:null};
  if(sources.tutorial){
    try{warm.tutorial=await withRestored2D(ctx,()=>warmPausedVideo(sources.tutorial.v,v=>{ctx.drawImage(v,PX,PY,W,H);}));}
    catch(e){warm.tutorial={skipped:true,reason:String(e?.message??e)};}
  }
  lcd.attractSurface={video:sources.attract.v,manifest:man,errors,
    tutorial:sources.tutorial?{video:sources.tutorial.v,manifest:tman,duration:tman.duration,warm}:null,
    get kind(){return kind;},get active(){return active;},get time(){return manual?time:cur.v.currentTime;},
    connectGpu(options){
      if(!gpuEnabled)return;
      for(const s of all)if(!s.gpu){
        s.gpu=createAttractGpu({...options,video:s.v,width:lcd.canvas.width,height:lcd.canvas.height});
        // 切替時の初回合成でシェーダ/ターゲットを作らせない(ここで一度だけ描いておく。revisionは使われない値)
        if(s===sources.tutorial){try{s.gpu.compose(-2);}catch(e){errors.push('tutorial gpu warm: '+(e?.message??e));}}
      }
    },
    get directActive(){return active&&direct();},
    compose(){if(!active||!direct())return null;const texture=cur.gpu.compose(cur.frameRevision);published=!!texture;return texture;},
    materialize,
    diagnostics:()=>({...stats,gpuEnabled,skipEnabled,kind,frameRevision:cur.frameRevision,heldFrame:!!cur.heldFrame,paintSkipped:paint.stats.skipped,tutorialWarm:warm.tutorial,gpu:Object.fromEntries(Object.entries(sources).map(([k,s])=>[k,s?.gpu?.diagnostics()??null])),tutorialQuality:(q=>q?{total:q.totalVideoFrames,dropped:q.droppedVideoFrames,corrupted:q.corruptedVideoFrames}:null)(sources.tutorial?.v.getVideoPlaybackQuality?.())})};
  lcd.dispose=()=>{
    if(disposed)return;disposed=true;
    for(const s of all){if(s.callback!==null)s.v.cancelVideoFrameCallback?.(s.callback);s.heldFrame?.close();s.heldFrame=null;s.gpu?.dispose();s.v.pause();s.v.removeEventListener('seeked',s.decoded);s.v.removeEventListener('loadeddata',s.decoded);s.v.removeAttribute('src');s.v.load();}
    paint.dispose();original.dispose();
  };
  sync();return lcd;
}
