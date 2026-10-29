import {createVideoDrawCache} from './video_draw_cache_1030.mjs';
import {createVideoBoundaryReplay} from './video_boundary_replay_1029.mjs';
// Result history: borrowed videos and owner-produced snapshots. No timeline,
// playback, decoder allocation, fetch, rules/audio, or production routing.
export const VIDEO_BODY_VERTEX='varying vec2 q;void main(){q=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}';
export const VIDEO_BODY_FRAGMENT='varying vec2 q;uniform sampler2D current,next;uniform float mixNext;void main(){vec3 a=texture2D(current,q).rgb;vec3 b=texture2D(next,q).rgb;gl_FragColor=vec4(mix(a,b,mixNext),1.);}';
export const VIDEO_PANEL_FRAGMENT='varying vec2 q;uniform sampler2D raw,overlay,hud;uniform float overlayOn,hudOn,flashA;uniform vec4 overlayRect;uniform vec3 flashRGB;void main(){vec2 p=vec2(q.x*1240.,(1.-q.y)*1510.);vec2 s=(p-vec2(34.,28.))/vec2(1152.,1268.);vec3 c=vec3(0.);if(all(greaterThanEqual(s,vec2(0.)))&&all(lessThan(s,vec2(1.)))){c=texture2D(raw,vec2(s.x,1.-s.y)).rgb;vec2 u=(p-vec2(34.,28.)-overlayRect.xy)/overlayRect.zw;if(overlayOn>.5&&all(greaterThanEqual(u,vec2(0.)))&&all(lessThan(u,vec2(1.)))){vec4 o=texture2D(overlay,vec2(u.x,1.-u.y));c+=o.rgb*o.a*(vec3(1.)-c);}c=mix(c,flashRGB,flashA);}vec2 h=(p-vec2(690.,130.))/vec2(496.,410.);if(hudOn>.5&&all(greaterThanEqual(h,vec2(0.)))&&all(lessThan(h,vec2(1.)))){vec4 t=texture2D(hud,vec2(h.x,1.-h.y));c=mix(c,t.rgb,t.a);}gl_FragColor=vec4(c,1.);}';
const W=1152,H=1268,PW=1240,PH=1510,PX=34,PY=28;
export const HISTORY_COPY_FRAGMENT='varying vec2 q;uniform sampler2D sourceTex;uniform vec4 sourceUv;void main(){gl_FragColor=vec4(texture2D(sourceTex,sourceUv.xy+q*sourceUv.zw).rgb,1.);}';
export const HISTORY_STEP_FRAGMENT='varying vec2 q;uniform sampler2D historyTex,sourceTex;uniform float opAlpha;void main(){vec3 s=texture2D(sourceTex,q).rgb;vec3 c=opAlpha>=1.?s:mix(texture2D(historyTex,q).rgb,s,opAlpha);gl_FragColor=vec4(c,1.);}';
export const HISTORY_PANEL_FRAGMENT=VIDEO_PANEL_FRAGMENT.replace('uniform sampler2D raw,overlay,hud;','uniform sampler2D raw,overlay,hud,bridgeTex;uniform float bridgeAlpha;vec3 quant8(vec3 c){return floor(clamp(c,0.,1.)*255.+.5)/255.;}').replace('c+=o.rgb*o.a*(vec3(1.)-c);','c=quant8(c+o.rgb*o.a*(vec3(1.)-c));').replace('c=mix(c,flashRGB,flashA);','c=quant8(mix(c,flashRGB,flashA));').replace('}vec2 h=','}c=quant8(mix(c,texture2D(bridgeTex,q).rgb,bridgeAlpha));vec2 h=');
function withRendererState(T,r,fn){
 const state={target:r.getRenderTarget(),face:r.getActiveCubeFace(),level:r.getActiveMipmapLevel(),viewport:r.getViewport(new T.Vector4()),scissor:r.getScissor(new T.Vector4()),test:r.getScissorTest(),color:r.getClearColor(new T.Color()),alpha:r.getClearAlpha(),auto:r.autoClear};
 try{return fn();}finally{r.setRenderTarget(state.target,state.face,state.level);r.setViewport(state.viewport);r.setScissor(state.scissor);r.setScissorTest(state.test);r.setClearColor(state.color,state.alpha);r.autoClear=state.auto;}
}
export function createVideoGpuImage({THREE:T,renderer:r,width=PW,height=PH,visible={x:PX,y:PY,w:W,h:H}}){
 if(!r?.isWebGLRenderer)throw Error('Existing main THREE.WebGLRenderer required');
 if(width!==PW||height!==PH||visible.x!==PX||visible.y!==PY||visible.w!==W||visible.h!==H)throw Error('Video candidate requires original native panel/visible dimensions');
 if(r.getPixelRatio&&r.getPixelRatio()!==1)throw Error('Video candidate requires native renderer pixelRatio1');
 let replay=createVideoBoundaryReplay();
 const drawCache=createVideoDrawCache();let bodyReuses=0,panelReuses=0;
 const context=r.getContext(),owned=new Set(),videos=new Map(),identities=new WeakMap();let identitySequence=0;
 const own=x=>(owned.add(x),x),release=x=>{if(x&&owned.delete(x))x.dispose();};
 let disposed=false,enabled=true,failed=false,status='initial',reason='no-completed-body',bodyRevision=0,compositeRevision=0,rawValid=false,outputValid=false;
 let hudCanvasRevision;
 let completed=null,lastRequest=null,overlayTexture=null,overlaySource=null,hudTexture=null,hudSource=null,hud=null,hudRevision=0,overlayRevision=0,flashRevision=0,flash={alpha:0,color:'miss'};
 const stats={kind:'video_compositor_injected',renderRequests:0,bodyDraws:0,composites:0,waitingFrames:0,recoveries:0,unsupportedFrames:0,disabledFrames:0,videoTexturesCreated:0,videoTexturesDisposed:0,videoUpdateRequests:0,videoTexturesMax:0,overlayUploads:0,hudUpdates:0,failures:[],boundary:{rawReads:0,panelReads:0,hits:0,failures:0,cpuFallbackPanels:0,readMs:0,readMaxMs:0}};
 const configure=(t,flip)=>{t.colorSpace=T.NoColorSpace;t.minFilter=t.magFilter=T.LinearFilter;t.wrapS=t.wrapT=T.ClampToEdgeWrapping;t.generateMipmaps=false;t.flipY=flip;t.premultiplyAlpha=false;t.unpackAlignment=4;return t;};
 const dummy=configure(own(new T.DataTexture(new Uint8Array([0,0,0,0]),1,1,T.RGBAFormat,T.UnsignedByteType)),false);dummy.needsUpdate=true;
 const makeTarget=(w,h,name)=>{const t=own(new T.WebGLRenderTarget(w,h,{format:T.RGBAFormat,type:T.UnsignedByteType,minFilter:T.LinearFilter,magFilter:T.LinearFilter,generateMipmaps:false,depthBuffer:false,stencilBuffer:false,samples:0,colorSpace:T.NoColorSpace}));t.texture.name=name;t.texture.flipY=false;t.texture.generateMipmaps=false;return t;};
 let raw=makeTarget(W,H,'video-candidate-native-body'),historySpare=makeTarget(W,H,'video-history-pingpong');const output=makeTarget(PW,PH,'video-lifecycle-flash-hud');
 const geometry=own(new T.PlaneGeometry(2,2)),camera=new T.Camera();
 const bodyUniforms={current:{value:dummy},next:{value:dummy},mixNext:{value:0}},panelUniforms={raw:{value:raw.texture},overlay:{value:dummy},hud:{value:dummy},overlayOn:{value:0},hudOn:{value:0},flashA:{value:0},flashRGB:{value:new T.Vector3(1,1,1)},overlayRect:{value:new T.Vector4(0,0,1,1)}};
 const scene=(fragment,uniforms)=>{const material=own(new T.ShaderMaterial({uniforms,vertexShader:VIDEO_BODY_VERTEX,fragmentShader:fragment,depthTest:false,depthWrite:false,blending:T.NoBlending,toneMapped:false,dithering:false})),scene=new T.Scene(),mesh=new T.Mesh(geometry,material);mesh.frustumCulled=false;scene.add(mesh);return scene;};
 const bodyScene=scene(VIDEO_BODY_FRAGMENT,bodyUniforms),panelScene=scene(VIDEO_PANEL_FRAGMENT,panelUniforms);
 const surface=Object.freeze({type:'lcd-gpu-surface',texture:output.texture,target:output,width:PW,height:PH,visible:Object.freeze({...visible}),encoding:'srgb-encoded',alphaMode:'opaque',origin:'bottom-left',context,get revision(){return compositeRevision;},get bodyRevision(){return bodyRevision;},get compositeRevision(){return compositeRevision;}});
 function identity(video){if(!identities.has(video))identities.set(video,++identitySequence);return identities.get(video);}
 const copyStamp=s=>s?{...s,layers:s.layers.map(l=>({...l})),overlay:s.overlay?{...s.overlay}:null}:null;
 function stamp(s,layers){return {owner:s.owner,generation:s.generation??0,serial:s.serial??null,manual:!!s.manual,layers:layers.map(l=>({identity:identity(l.video),name:l.name??null,generation:l.generation??s.generation??0,time:l.time??l.video.currentTime,alpha:l.alpha,src:l.src??l.video.currentSrc??'',requestedSrc:l.video.src??'',readyState:l.video.readyState,seeking:!!l.video.seeking,width:l.video.videoWidth,height:l.video.videoHeight})),overlay:s.overlay?{x:s.overlay.x,y:s.overlay.y,width:s.overlay.width,height:s.overlay.height,blend:s.overlay.blend,revision:s.overlay.revision??null}:null};}
 function assertLive(){if(disposed)throw Error('Video GPU image disposed');}
 function assertBoundary(){if(r.getRenderTarget()!==null)throw Error('Video GPU candidate requires default-target frame boundary');if(context.isContextLost?.())throw Error('Main GL context lost');}
 function unsupported(why){status='unsupported';reason=why;stats.unsupportedFrames++;return null;}
 function fail(error,phase){failed=true;status='failed';reason=phase;stats.failures.push({phase,message:String(error?.message??error)});if(phase!=='compose')rawValid=false;outputValid=false;return null;}
 function videoTexture(l,s){
  const video=l.video,generation=l.generation??s.generation??0,src=(l.src??video.currentSrc??'')+'|'+(video.src??''),sourceKey=String(generation)+'|'+src;
  let entry=videos.get(video);if(entry&&entry.sourceKey!==sourceKey){release(entry.texture);videos.delete(video);stats.videoTexturesDisposed++;entry=null;}
  if(!entry){entry={texture:configure(own(new T.VideoTexture(video)),true),sourceKey,key:null,identity:identity(video)};videos.set(video,entry);stats.videoTexturesCreated++;}
  const key=sourceKey+(s.manual?'|'+String(l.time??video.currentTime):'|rVFC');
  if(entry.key!==key){entry.texture.needsUpdate=true;entry.key=key;stats.videoUpdateRequests++;}
  return entry.texture;
 }
 function commitOverlay(overlay){
  if(!overlay){release(overlayTexture);overlayTexture=overlaySource=null;panelUniforms.overlay.value=dummy;panelUniforms.overlayOn.value=0;overlayRevision++;return;}
  if(overlaySource!==overlay.canvas){release(overlayTexture);overlayTexture=configure(own(new T.CanvasTexture(overlay.canvas)),true);overlaySource=overlay.canvas;}
  overlayTexture.needsUpdate=true;
  // Freeze the owner's mutable crop into its GPU texture before returning.
  // Boundary clean compose must not upload a later mutation of the same canvas.
  r.initTexture(overlayTexture);stats.overlayUploads++;overlayRevision++;
  panelUniforms.overlay.value=overlayTexture;panelUniforms.overlayOn.value=1;panelUniforms.overlayRect.value.set(overlay.x,overlay.y,overlay.width,overlay.height);
 }
 function draw(scene,target){r.autoClear=false;r.setRenderTarget(target);r.setScissorTest(false);r.setViewport(0,0,target.width,target.height);r.render(scene,camera);}
 function panelValues(withHud){panelUniforms.hud.value=hud?hudTexture:dummy;panelUniforms.hudOn.value=withHud&&hud?1:0;panelUniforms.flashA.value=flash.alpha;panelUniforms.flashRGB.value.set(...(flash.color==='hit'?[1,1,1]:[115/255,96/255,153/255]));}
 function rawCanvas(reasonValue){return replay.rawCanvas();}

 const history={owned:false,dependent:false,seedPending:false,bridge:null,completed:null,seeds:0,steps:0,opaqueResets:0,fallbackReads:0,fallbackBytes:0,cleanCopies:0,failures:[],rawCache:null,panelCache:null};
 const copyU={sourceTex:{value:dummy},sourceUv:{value:new T.Vector4(0,0,1,1)}},stepU={historyTex:{value:dummy},sourceTex:{value:dummy},opAlpha:{value:0}};
 const historyU={...panelUniforms,bridgeTex:{value:dummy},bridgeAlpha:{value:0}};
 const copyScene=scene(HISTORY_COPY_FRAGMENT,copyU),stepScene=scene(HISTORY_STEP_FRAGMENT,stepU),historyPanelScene=scene(HISTORY_PANEL_FRAGMENT,historyU);
 const leaseValid=l=>!!l?.live&&l.context===context&&l.width===PW&&l.height===PH&&l.texture?.isRenderTargetTexture&&l.texture!==raw.texture&&l.texture!==historySpare.texture&&l.texture!==output.texture;
 function releaseHistoryCompletion(){history.completed?.bridge?.lease?.release();history.completed=null;}
 function historyDiagnostics(){return {owned:history.owned,dependent:history.dependent,seedPending:history.seedPending,bridgeActive:!!history.bridge&&history.bridge.alpha>0,seeds:history.seeds,steps:history.steps,opaqueResets:history.opaqueResets,rawRevision:bodyRevision,completedRevision:history.completed?.revision??null,completedBodyRevision:history.completed?.bodyRevision??null,fallbackReads:history.fallbackReads,fallbackBytes:history.fallbackBytes,cleanCopies:history.cleanCopies,failures:history.failures.map(x=>({...x})),extraTargetBytes:W*H*4};}
 function seedResultHistory(lease){assertLive();if(!enabled||failed||!leaseValid(lease)||lease.stamp?.flashAlpha!==0||lease.stamp?.dim)return false;let pinned=null;try{assertBoundary();pinned=lease.retain();history.seedPending=true;withRendererState(T,r,()=>{copyU.sourceTex.value=pinned.texture;copyU.sourceUv.value.set(PX/PW,(PH-PY-H)/PH,W/PW,H/PH);rawValid=false;draw(copyScene,raw);});releaseHistoryCompletion();replay.dispose();replay=createVideoBoundaryReplay();history.owned=true;history.dependent=true;history.seeds++;bodyRevision++;rawValid=true;outputValid=false;completed=lastRequest=null;history.rawCache=history.panelCache=null;status='history-seeded';reason=null;return true;}catch(e){return !!fail(e,'history-seed');}finally{history.seedPending=false;pinned?.release();copyU.sourceTex.value=dummy;}}
 function setResultBridge({lease,alpha}={}){assertLive();if(!Number.isFinite(alpha)||alpha<0||alpha>1||alpha>0&&!leaseValid(lease))return false;history.bridge=alpha>0?{lease,alpha}:null;return true;}
 function clearResultBridge(){assertLive();history.bridge=null;}
 function endResultHistory(){assertLive();const dependent=history.dependent;history.owned=history.dependent=history.seedPending=false;history.bridge=null;releaseHistoryCompletion();history.rawCache=history.panelCache=null;if(dependent){rawValid=outputValid=false;completed=lastRequest=null;replay.dispose();replay=createVideoBoundaryReplay();}status=rawValid?'ready':'initial';reason=rawValid?null:'history-ended-needs-opaque';return !dependent;}
 function renderHistory(snapshot){assertLive();stats.renderRequests++;if(!enabled){status='disabled';stats.disabledFrames++;return null;}if(failed||!rawValid)return null;if(!snapshot||!['normal','jp-plain'].includes(snapshot.owner)||!Array.isArray(snapshot.layers))return unsupported('history-snapshot-layout');const layers=snapshot.layers.filter(l=>l?.drawable!==false);if(layers.length>2||layers.some(l=>!l.video||!Number.isFinite(l.alpha)||l.alpha<0||l.alpha>1))return unsupported('history-layers');lastRequest=stamp(snapshot,layers);
  const o=snapshot.overlay;if(o&&(o.blend!=='screen'||!o.canvas||o.canvas.width!==o.width||o.canvas.height!==o.height||![o.x,o.y,o.width,o.height].every(Number.isFinite)||o.x<0||o.y<0||o.width<=0||o.height<=0||o.x+o.width>W||o.y+o.height>H))return unsupported('history-overlay-layout');if(layers.some(l=>l.video.error||l.video.videoWidth&&l.video.videoWidth!==W||l.video.videoHeight&&l.video.videoHeight!==H))return unsupported('history-media-layout');if(layers.some(l=>l.video.readyState<2||l.video.seeking||!l.video.videoWidth||!l.video.videoHeight)){status='waiting';reason='history-source-not-ready';stats.waitingFrames++;return rawValid?surface:null;}
  let pending=null,lastOpaque=-1;for(let k=0;k<layers.length;k++)if(layers[k].alpha===1)lastOpaque=k;
  try{if(lastOpaque>=0)pending=replay.stage({...snapshot,layers:layers.slice(lastOpaque)});assertBoundary();withRendererState(T,r,()=>{const required=new Set(layers.map(l=>l.video));for(const[v,e]of videos)if(!required.has(v)){release(e.texture);videos.delete(v);stats.videoTexturesDisposed++;}for(const l of layers){stepU.historyTex.value=raw.texture;stepU.sourceTex.value=videoTexture(l,snapshot);stepU.opAlpha.value=l.alpha;if(historySpare.texture===stepU.historyTex.value||historySpare.texture===stepU.sourceTex.value)throw Error('History feedback');rawValid=false;draw(stepScene,historySpare);[raw,historySpare]=[historySpare,raw];history.steps++;}panelUniforms.raw.value=raw.texture;commitOverlay(o);});if(pending){pending.commit();pending=null;history.dependent=false;history.opaqueResets++;}else if(layers.some(l=>l.alpha>0))history.dependent=true;rawValid=true;bodyRevision++;stats.bodyDraws++;completed=copyStamp(lastRequest);history.rawCache=history.panelCache=null;status='ready';reason=null;return surface;}catch(e){pending?.discard();history.failures.push({phase:'render',message:String(e?.message??e)});return fail(e,'history-render');}finally{stepU.historyTex.value=stepU.sourceTex.value=dummy;}
 }
 function drawHistoryPanel(target,{withHud=false,includeBridge=true,completion=null}={}){const old={hud:panelUniforms.hud.value,hudOn:panelUniforms.hudOn.value,flashA:panelUniforms.flashA.value,flashRGB:panelUniforms.flashRGB.value.clone(),bridge:historyU.bridgeTex.value,bridgeAlpha:historyU.bridgeAlpha.value};const style=completion??{flash,bridge:history.bridge};try{panelUniforms.raw.value=raw.texture;panelUniforms.hud.value=hud?hudTexture:dummy;panelUniforms.hudOn.value=withHud&&hud?1:0;panelUniforms.flashA.value=style.flash.alpha;panelUniforms.flashRGB.value.set(...(style.flash.color==='hit'?[1,1,1]:[115/255,96/255,153/255]));const b=includeBridge?style.bridge:null;if(b?.alpha>0&&!leaseValid(b.lease))throw Error('Completed bridge lease no longer live');historyU.bridgeTex.value=b?.alpha>0?b.lease.texture:dummy;historyU.bridgeAlpha.value=b?.alpha??0;if(target.texture===raw.texture||target.texture===historyU.bridgeTex.value)throw Error('History panel feedback');draw(historyPanelScene,target);}finally{panelUniforms.hud.value=old.hud;panelUniforms.hudOn.value=old.hudOn;panelUniforms.flashA.value=old.flashA;panelUniforms.flashRGB.value.copy(old.flashRGB);historyU.bridgeTex.value=old.bridge;historyU.bridgeAlpha.value=old.bridgeAlpha;}}
 function composeHistory(){assertLive();if(!rawValid||failed)return null;let pinned=null;try{assertBoundary();if(history.bridge?.alpha>0){if(!leaseValid(history.bridge.lease))throw Error('Bridge lease expired before compose');pinned=history.bridge.lease.retain();}withRendererState(T,r,()=>{outputValid=false;drawHistoryPanel(output,{withHud:true});});const next={revision:compositeRevision+1,bodyRevision,flash:{...flash},bridge:pinned?{lease:pinned,alpha:history.bridge.alpha}:null,hudRevision,overlayRevision};pinned=null;releaseHistoryCompletion();history.completed=next;outputValid=true;compositeRevision++;stats.composites++;history.panelCache=null;return output.texture;}catch(e){pinned?.release();history.failures.push({phase:'compose',message:String(e?.message??e)});return fail(e,'compose');}}
 function completeHistory(){return history.owned&&rawValid&&outputValid&&!failed&&history.completed?.bodyRevision===bodyRevision&&history.completed.overlayRevision===overlayRevision;}
 function warmHistory(){
  assertLive();if(bodyRevision||compositeRevision||history.seeds||history.owned)throw Error('History warm is boot-only');assertBoundary();
  const uniformSets=[bodyUniforms,panelUniforms,copyU,stepU,historyU],saved=[...new Set(uniformSets.flatMap(o=>Object.values(o)))].map(u=>[u,u.value]);
  let scratch=null,warmHud=null;const kinds=[],at=performance.now();
  try{
   scratch=document.createElement('canvas');scratch.width=496;scratch.height=410;const c=scratch.getContext('2d');if(!c)throw Error('HUD warm canvas unavailable');c.clearRect(0,0,496,410);c.fillStyle='rgba(255,255,255,0.5)';c.fillRect(0,0,496,410);
   warmHud=own(new T.CanvasTexture(scratch));configure(warmHud,true);
   withRendererState(T,r,()=>{
    for(const t of [raw,historySpare,output])r.initRenderTarget(t);r.initTexture(dummy);r.initTexture(warmHud);
    for(const s of [copyScene,stepScene,bodyScene,historyPanelScene,panelScene])r.compile(s,camera);
    copyU.sourceTex.value=dummy;copyU.sourceUv.value=new T.Vector4(0,0,1,1);draw(copyScene,raw);kinds.push('copy');
    stepU.historyTex.value=raw.texture;stepU.sourceTex.value=dummy;stepU.opAlpha.value=.5;draw(stepScene,historySpare);kinds.push('step');
    bodyUniforms.current.value=bodyUniforms.next.value=dummy;bodyUniforms.mixNext.value=.25;draw(bodyScene,raw);kinds.push('body');
    panelUniforms.raw.value=historySpare.texture;panelUniforms.overlay.value=warmHud;panelUniforms.overlayOn.value=1;panelUniforms.overlayRect.value=new T.Vector4(120,24,304,308);panelUniforms.flashA.value=.25;panelUniforms.flashRGB.value=new T.Vector3(115/255,96/255,153/255);panelUniforms.hud.value=warmHud;panelUniforms.hudOn.value=1;
    historyU.bridgeTex.value=dummy;historyU.bridgeAlpha.value=.5;draw(historyPanelScene,output);kinds.push('historyPanel');
    draw(panelScene,output);kinds.push('ordinaryPanel');
   });
   return {targetBytes:2*W*H*4+PW*PH*4,extraNativeTargetBytes:W*H*4,compiled:5,draws:kinds.length,sceneKinds:kinds,hudUpload:true,temporaryHudBytes:304*308*4,cpuSubmitMs:performance.now()-at};
  }finally{for(const[u,value]of saved)u.value=value;release(warmHud);if(scratch){scratch.width=0;scratch.height=0;}}
 }
 function captureCompletedClean({target,expectedRevision=compositeRevision,includeBridge=true}={}){assertLive();if(!completeHistory()||expectedRevision!==compositeRevision||!target||target.width!==PW||target.height!==PH||[raw.texture,historySpare.texture,output.texture].includes(target.texture))return false;try{assertBoundary();withRendererState(T,r,()=>drawHistoryPanel(target,{includeBridge,completion:history.completed}));history.cleanCopies++;return true;}catch(e){history.failures.push({phase:'clean-copy',message:String(e?.message??e)});return false;}}
 function readTarget(target,w,h){const bytes=new Uint8Array(w*h*4);r.readRenderTargetPixels(target,0,0,w,h,bytes);history.fallbackReads++;history.fallbackBytes+=bytes.byteLength;const top=new Uint8ClampedArray(bytes.length),stride=w*4;for(let y=0;y<h;y++)top.set(bytes.subarray((h-y-1)*stride,(h-y)*stride),y*stride);const c=document.createElement('canvas');c.width=w;c.height=h;c.readyState=4;c.getContext('2d',{alpha:false}).putImageData(new ImageData(top,w,h),0,0);return c;}
 function historyRawCanvas(){assertLive();if(!completeHistory())return null;if(history.rawCache?.revision===bodyRevision)return history.rawCache.canvas;try{assertBoundary();const canvas=withRendererState(T,r,()=>readTarget(raw,W,H));history.rawCache={revision:bodyRevision,canvas};return canvas;}catch(e){history.failures.push({phase:'raw-fallback',message:String(e?.message??e)});return null;}}
 function materializeHistoryTo({panelCtx=null,heldCtx=null,includeBridge=true,reason:why='explicit-history-fallback'}={}){assertLive();if(!completeHistory())return null;const completion=history.completed,key=completion.revision+':'+includeBridge;let rawCanvas=null,panelCanvas=null;try{assertBoundary();rawCanvas=historyRawCanvas();if(!rawCanvas)return null;if(panelCtx){if(history.panelCache?.key===key)panelCanvas=history.panelCache.canvas;else{panelCanvas=withRendererState(T,r,()=>{try{outputValid=false;drawHistoryPanel(output,{includeBridge,completion});return readTarget(output,PW,PH);}finally{drawHistoryPanel(output,{withHud:true,completion});outputValid=true;}});history.panelCache={key,canvas:panelCanvas};}}for(const[ctx,c]of [[heldCtx,rawCanvas],[panelCtx,panelCanvas]])if(ctx&&c){ctx.save();try{ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='copy';ctx.filter='none';ctx.drawImage(c,0,0);}finally{ctx.restore();}}return rawCanvas;}catch(e){outputValid=false;history.failures.push({phase:'materialize',reason:why,message:String(e?.message??e)});return null;}}

 const api={
  seedResultHistory,setResultBridge,clearResultBridge,endResultHistory,historyDiagnostics,materializeHistoryTo,captureCompletedClean,warmHistory,
  surface,
  setEnabled(on){assertLive();enabled=!!on;if(!enabled){status='disabled';reason='explicit-gate';}else if(!failed){status=rawValid?'ready':'initial';reason=rawValid?null:'no-completed-body';}return enabled;},
  render(snapshot){if(history.owned)return renderHistory(snapshot);assertLive();stats.renderRequests++;const requested=Array.isArray(snapshot?.layers)?snapshot.layers.filter(l=>l?.drawable!==false):null;if(requested?.every(l=>l?.video&&(typeof l.video==='object'||typeof l.video==='function')))lastRequest=stamp(snapshot,requested);if(!enabled){status='disabled';reason='explicit-gate';stats.disabledFrames++;return null;}if(failed)return null;
   if(!snapshot||!['normal','jp-plain'].includes(snapshot.owner)||!Array.isArray(snapshot.layers))return unsupported('snapshot-owner-or-layout');
   const layers=snapshot.layers.filter(l=>l?.drawable!==false);if(layers.length>2||!layers.length)return layers.length?unsupported('more-than-two-videos'):(status='waiting',reason='no-drawable-layers',stats.waitingFrames++,rawValid?surface:null);
   if(layers.some(l=>!l.video||!Number.isFinite(l.alpha)||l.alpha<0||l.alpha>1)||layers[0].alpha!==1)return unsupported('opaque-first-layer-required');
   lastRequest=stamp(snapshot,layers);
   const overlay=snapshot.overlay;if(overlay&&(overlay.blend!=='screen'||!overlay.canvas||overlay.canvas.width!==overlay.width||overlay.canvas.height!==overlay.height||![overlay.x,overlay.y,overlay.width,overlay.height].every(Number.isFinite)||overlay.width<=0||overlay.height<=0||overlay.x<0||overlay.y<0||overlay.x+overlay.width>W||overlay.y+overlay.height>H))return unsupported('overlay-layout-or-blend');
   if(layers.some(l=>l.video.error))return unsupported('media-error');
   if(layers.some(l=>l.video.readyState<2||l.video.seeking||!l.video.videoWidth||!l.video.videoHeight)){status='waiting';reason=layers.some(l=>l.video.seeking)?'seeking':'ready-or-dimensions';stats.waitingFrames++;return rawValid?surface:null;}
   if(layers.some(l=>l.video.videoWidth!==W||l.video.videoHeight!==H))return unsupported('non-native-video');
   if(layers.length===2&&layers[0].video===layers[1].video&&(layers[0].generation??snapshot.generation)!==(layers[1].generation??snapshot.generation))return unsupported('one-video-two-generations');
   const wasWaiting=status==='waiting';
   let pendingReplay=null;
   try{assertBoundary();const renderTextures=layers.map(l=>videoTexture(l,snapshot));
    if(rawValid&&drawCache.sameBody(snapshot,layers,renderTextures,bodyRevision)){
     bodyReuses++;completed=copyStamp(lastRequest);if(wasWaiting)stats.recoveries++;status='ready';reason=null;return surface;
    }
    pendingReplay=replay.stage({...snapshot,layers});withRendererState(T,r,()=>{
     const required=new Set(layers.map(l=>l.video));for(const [video,entry]of videos)if(!required.has(video)){release(entry.texture);videos.delete(video);stats.videoTexturesDisposed++;}
     bodyUniforms.current.value=renderTextures[0];bodyUniforms.next.value=renderTextures[1]??renderTextures[0];bodyUniforms.mixNext.value=layers[1]?.alpha??0;
     // A thrown GL operation invalidates, rather than relabels, a possibly partial target.
     rawValid=false;draw(bodyScene,raw);commitOverlay(overlay);
    });
    pendingReplay.commit();pendingReplay=null;rawValid=true;bodyRevision++;drawCache.commitBody(snapshot,layers,renderTextures,bodyRevision);stats.bodyDraws++;stats.videoTexturesMax=Math.max(stats.videoTexturesMax,videos.size);completed=copyStamp(lastRequest);if(wasWaiting)stats.recoveries++;status='ready';reason=null;return surface;
   }catch(error){pendingReplay?.discard();return fail(error,'render');}
  },
  setFlash(alpha=0,color='miss'){assertLive();const next={alpha:Math.max(0,Math.min(1,alpha||0)),color:color==='hit'?'hit':'miss'};if(next.alpha!==flash.alpha||next.color!==flash.color)flashRevision++;flash=next;},
  setHudCanvas(canvas,revision){assertLive();hud=canvas;if(canvas){if(hudSource!==canvas){release(hudTexture);hudTexture=configure(own(new T.CanvasTexture(canvas)),true);hudSource=canvas;hudCanvasRevision=undefined;}if(!Number.isSafeInteger(revision)||revision<0||hudCanvasRevision!==revision){hudTexture.needsUpdate=true;hudRevision++;stats.hudUpdates++;}hudCanvasRevision=revision;}},
  compose(){if(history.owned)return composeHistory();assertLive();if(!rawValid||failed)return null;try{assertBoundary();const panelKey=()=>[bodyRevision,overlayRevision,hudRevision,hud,flashRevision,compositeRevision];if(outputValid&&drawCache.samePanel(panelKey())){panelReuses++;return output.texture;}withRendererState(T,r,()=>{panelValues(true);outputValid=false;draw(panelScene,output);});outputValid=true;compositeRevision++;drawCache.commitPanel(panelKey());stats.composites++;return output.texture;}catch(error){return fail(error,'compose');}},
  rawCanvas(reasonValue='raw-capture'){assertLive();return history.owned?historyRawCanvas():rawCanvas(reasonValue);},
  materializeTo({panelCtx=null,heldCtx=null,reason:reasonValue='boundary'}={}){assertLive();if(history.owned)return materializeHistoryTo({panelCtx,heldCtx,includeBridge:true,reason:reasonValue});return replay.materializeTo({panelCtx,heldCtx,flash});
  },
  diagnostics(){return {...stats,drawReuse:{enabled:drawCache.enabled,bodyReuses,panelReuses},failures:stats.failures.map(f=>({...f})),boundary:{...stats.boundary,replayCount:replay.diagnostics().materializations,replayMs:replay.diagnostics().replayMs,replayMaxMs:replay.diagnostics().replayMaxMs,rawReplays:replay.diagnostics().rawReplays,panelReplays:replay.diagnostics().panelReplays},sourceFrames:replay.diagnostics(),status,reason,enabled,failed,disposed,bodyRevision,compositeRevision,rawValid,outputValid,completed:copyStamp(completed),request:copyStamp(lastRequest),flash:{...flash,revision:flashRevision},overlay:{active:!!overlayTexture,revision:overlayRevision},hud:{active:!!hud,revision:hudRevision},videoTextures:videos.size,videoKeys:[...videos.values()].map(e=>({identity:e.identity,key:e.key,sourceKey:e.sourceKey})),history:historyDiagnostics(),targetBytes:2*W*H*4+PW*PH*4,contextsCreated:0,videoElementsCreated:0};},
  dispose(){if(disposed)return;releaseHistoryCompletion();history.bridge=null;disposed=true;status='disposed';for(const resource of [...owned])release(resource);videos.clear();replay.dispose();rawValid=outputValid=false;}
 };return api;
}
