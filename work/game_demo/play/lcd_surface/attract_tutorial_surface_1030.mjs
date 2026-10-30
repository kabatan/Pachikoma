// 10/30 attract_surface_20261029 の拡張: 待機(attract)ループに加えて、開始ボタン後の「遊び方」(howto)に冒頭チュートリアル動画(1152x1268, 再生は1回)を流す。
// 起動時にデコーダを予熱し、GPU合成(createAttractGpu)も動画ごとに用意するので、場面の切替で新しい読み込み/シェーダ作成は起きない。
// ルールのhowto(開始ボタン→howto→ticket→開始、押すと飛ばせる)は ctrl 側のまま。?tutorial=old のとき play.mjs はこのファイルを使わず従来の attract_surface_20261029 を使う。
import {createAttractGpu,suppressCanvasPaint} from './attract_gpu_1030.mjs';
import {warmPausedVideo,withRestored2D} from './startup_warm.mjs';
import {createSkipOverlay,OV_VIDEO_X,OV_Y_MAIN} from './tutorial_skip_overlay_1030.mjs';   // 10/30 説明中の「長押しでスキップ」ゲージ(controller.tutSkipView を getState().skip で受ける)
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
export async function attachAttractSurface(lcd,{getState,manifestUrl=new URL('../../../effects/attract/prod/manifest.json',import.meta.url),tutorialManifestUrl=null,tutorialShortManifestUrl=new URL('../../../effects/tutorial/prod/manifest_short.json',import.meta.url)}={}) {
  if(!lcd?.production||lcd.attractSurface)return lcd;
  const response=await fetch(manifestUrl);if(!response.ok)throw Error(`attract manifest: HTTP ${response.status}`);
  const man=await response.json(),base=new URL('.',manifestUrl);
  const ctx=lcd.canvas.getContext('2d'),errors=[];
  const query=new URLSearchParams(globalThis.location?.search??'');
  // 10/30 v09: 説明は ?tutv=old で旧(v07, 16秒)に戻る。既定は新(v09)。2回目の客(結果の「もう一度」経由)には短い版(要点3行のまとめ)を流す(?tutshort=0 で常に通常版)
  if(!tutorialManifestUrl)tutorialManifestUrl=new URL(query.get('tutv')==='old'?'../../../effects/tutorial/prod/manifest_v07.json':'../../../effects/tutorial/prod/manifest.json',import.meta.url);
  const shortEnabled=query.get('tutv')!=='old'&&query.get('tutshort')!=='0';
  const gpuEnabled=query.get('attractgpu')!=='0',skipEnabled=query.get('attractskip')!=='0';
  const innerSkip=query.get('attractinner')==='1';   // 10/30 実機で待機映像が映らない件で既定は切（=1で隠しコピー省略）
  const liteMedia=m=>query.get('videolite')==='1'&&m.liteSource===m.file&&m.liteFile?m.liteFile:m.file;
  const attractLoaded=await loadVideo(new URL(liteMedia(man),base).href,{loop:true,label:'attract',errors});
  // チュートリアル動画。読めなくても待機は動かす(その場合 howto は従来の説明に戻る)
  const loadTut=async(url,label)=>{
    try {
      const tr=await fetch(url);if(!tr.ok)throw Error(`HTTP ${tr.status}`);
      const m=await tr.json();const l=await loadVideo(new URL(liteMedia(m),new URL('.',url)).href,{loop:false,label,errors});return [m,l];
    } catch(e){console.error(label+' video unavailable: '+(e?.message??e));errors.push(label+': '+(e?.message??e));return [null,null];}
  };
  const [tman,tloaded]=await loadTut(tutorialManifestUrl,'tutorial');
  const [sman,sloaded]=tman&&shortEnabled?await loadTut(tutorialShortManifestUrl,'tutorialShort'):[null,null];
  let disposed=false;
  const stats={frames:0,hiddenFrames:0,canvasDraws:0,decodedFrames:0,boundaryCopies:0};
  const mk=(v,m)=>({v,man:m,gpu:null,frameRevision:0,heldFrame:null,heldRevision:-1,callback:null,fallbackKey:null});
  const sources={attract:mk(attractLoaded.v,man),tutorial:tloaded?mk(tloaded.v,tman):null,tutorialShort:sloaded?mk(sloaded.v,sman):null};
  const isTut=k=>k==='tutorial'||k==='tutorialShort';
  const all=Object.values(sources).filter(Boolean);
  for(const s of all){
    s.decoded=()=>{s.frameRevision++;stats.decodedFrames++;};
    s.watch=()=>{s.callback=s.v.requestVideoFrameCallback(()=>{s.callback=null;if(disposed)return;s.decoded();s.watch();});};
    if(gpuEnabled&&typeof s.v.requestVideoFrameCallback==='function')s.watch();
    s.v.addEventListener('seeked',s.decoded);s.v.addEventListener('loadeddata',s.decoded);
  }
  const skipOv=(sources.tutorial||sources.tutorialShort)&&query.get('tutskip')!=='0'?createSkipOverlay({x:PX+OV_VIDEO_X,y:PY+OV_Y_MAIN,videoTop:PY}):null;
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
    if(skipOv?.visible&&isTut(kind))ctx.drawImage(skipOv.canvas,skipOv.x,skipOv.y,skipOv.w,skipOv.h);
    stats.canvasDraws++;
  };
  const materialize=()=>{draw(true);published=false;stats.boundaryCopies++;};
  // 何を流すか: Attract 中、howto でなければ待機ループ、howto 中(動画が読めていれば)チュートリアル
  const wantedKind=()=>{const s=getState();if(lcd.displayRecoveryActive||s.phase!=='Attract')return null;return s.howto?((s.repeat&&sources.tutorialShort)?'tutorialShort':sources.tutorial?'tutorial':null):'attract';};
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
    if(skipOv)skipOv.update(isTut(kind)?getState().skip:null,isTut(kind)?cur.v.currentTime:0,isTut(kind)?cur.man.skipLayout:null);
    // Only these fully covered title modes use the simple normal Canvas path.
    // JP/choice/result and all transition ownership still execute unmodified.
    const skip=active&&skipEnabled&&cur.v.readyState>=2&&(kind==='attract'?['attract','title']:['howto']).includes(lcd.current?.mode);
    if(skip){
      const prior=lcd.attractCoveredPaint;lcd.attractCoveredPaint=innerSkip;
      try{paint.run(()=>original.frame(dt,F));stats.hiddenFrames++;}
      finally{lcd.attractCoveredPaint=prior;}
    }else original.frame(dt,F);
    if(!active)return;
    stats.frames++;refresh();
    if(!direct()||!cur.heldFrame){published=false;draw();}
    if(manual){time+=dt;if(cur.man.loop!==false)time%=cur.man.duration;else time=Math.min(time,cur.man.duration);}
  };
  lcd.onEvent=(id,...args)=>{
    if(active&&published)materialize();
    if(id==='attract'){sources.attract.v.currentTime=0;if(kind==='attract')time=0;}
    if(id==='howto'){for(const k of ['tutorial','tutorialShort'])if(sources[k]){sources[k].v.currentTime=0;if(kind===k)time=0;}}
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
  const warm={tutorial:null,tutorialShort:null};
  for(const k of ['tutorial','tutorialShort'])if(sources[k]){
    try{warm[k]=await withRestored2D(ctx,()=>warmPausedVideo(sources[k].v,v=>{ctx.drawImage(v,PX,PY,W,H);}));}
    catch(e){warm[k]={skipped:true,reason:String(e?.message??e)};}
  }
  lcd.attractSurface={video:sources.attract.v,manifest:man,errors,
    tutorial:sources.tutorial?{video:sources.tutorial.v,manifest:tman,duration:tman.duration,durationShort:sources.tutorialShort?sman.duration:null,warm}:null,
    get kind(){return kind;},get sceneKey(){return active&&isTut(kind)?(cur.man.lightScene??null):null;},get active(){return active;},get time(){return manual?time:cur.v.currentTime;},
    connectGpu(options){
      if(!gpuEnabled)return;
      for(const s of all)if(!s.gpu){
        s.gpu=createAttractGpu({...options,video:s.v,width:lcd.canvas.width,height:lcd.canvas.height,overlay:(s===sources.tutorial||s===sources.tutorialShort)&&skipOv?skipOv:null});
        // 切替時の初回合成でシェーダ/ターゲットを作らせない(ここで一度だけ描いておく。revisionは使われない値)
        if(s===sources.tutorial||s===sources.tutorialShort){try{s.gpu.compose(-2);}catch(e){errors.push('tutorial gpu warm: '+(e?.message??e));}}
      }
    },
    get directActive(){return active&&direct();},
    compose(){if(!active||!direct())return null;const texture=cur.gpu.compose(cur.frameRevision,isTut(kind)&&skipOv?skipOv.revision:0);published=!!texture;return texture;},
    materialize,
    diagnostics:()=>({...stats,gpuEnabled,skipEnabled,innerSkip,kind,frameRevision:cur.frameRevision,heldFrame:!!cur.heldFrame,paintSkipped:paint.stats.skipped,tutorialWarm:warm.tutorial,tutorialShortWarm:warm.tutorialShort,gpu:Object.fromEntries(Object.entries(sources).map(([k,s])=>[k,s?.gpu?.diagnostics()??null])),tutorialQuality:(q=>q?{total:q.totalVideoFrames,dropped:q.droppedVideoFrames,corrupted:q.corruptedVideoFrames}:null)(sources.tutorial?.v.getVideoPlaybackQuality?.())})};
  lcd.dispose=()=>{
    if(disposed)return;disposed=true;
    for(const s of all){if(s.callback!==null)s.v.cancelVideoFrameCallback?.(s.callback);s.heldFrame?.close();s.heldFrame=null;s.gpu?.dispose();s.v.pause();s.v.removeEventListener('seeked',s.decoded);s.v.removeEventListener('loadeddata',s.decoded);s.v.removeAttribute('src');s.v.load();}
    paint.dispose();original.dispose();
  };
  sync();return lcd;
}
