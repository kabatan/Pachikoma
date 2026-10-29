import {createVideoDrawCache} from './video_draw_cache_1030.mjs';
import {createVideoBoundaryReplay} from './video_boundary_replay_1029.mjs';
// Candidate only: borrowed videos and owner-produced snapshots. No timeline,
// playback, decoder allocation, fetch, rules/audio, or production routing.
export const VIDEO_BODY_VERTEX='varying vec2 q;void main(){q=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}';
export const VIDEO_BODY_FRAGMENT='varying vec2 q;uniform sampler2D current,next;uniform float mixNext;void main(){vec3 a=texture2D(current,q).rgb;vec3 b=texture2D(next,q).rgb;gl_FragColor=vec4(mix(a,b,mixNext),1.);}';
export const VIDEO_PANEL_FRAGMENT='varying vec2 q;uniform sampler2D raw,overlay,hud;uniform float overlayOn,hudOn,flashA;uniform vec4 overlayRect;uniform vec3 flashRGB;void main(){vec2 p=vec2(q.x*1240.,(1.-q.y)*1510.);vec2 s=(p-vec2(34.,28.))/vec2(1152.,1268.);vec3 c=vec3(0.);if(all(greaterThanEqual(s,vec2(0.)))&&all(lessThan(s,vec2(1.)))){c=texture2D(raw,vec2(s.x,1.-s.y)).rgb;vec2 u=(p-vec2(34.,28.)-overlayRect.xy)/overlayRect.zw;if(overlayOn>.5&&all(greaterThanEqual(u,vec2(0.)))&&all(lessThan(u,vec2(1.)))){vec4 o=texture2D(overlay,vec2(u.x,1.-u.y));c+=o.rgb*o.a*(vec3(1.)-c);}c=mix(c,flashRGB,flashA);}vec2 h=(p-vec2(690.,130.))/vec2(496.,410.);if(hudOn>.5&&all(greaterThanEqual(h,vec2(0.)))&&all(lessThan(h,vec2(1.)))){vec4 t=texture2D(hud,vec2(h.x,1.-h.y));c=mix(c,t.rgb,t.a);}gl_FragColor=vec4(c,1.);}';
const W=1152,H=1268,PW=1240,PH=1510,PX=34,PY=28;
function withRendererState(T,r,fn){
 const state={target:r.getRenderTarget(),face:r.getActiveCubeFace(),level:r.getActiveMipmapLevel(),viewport:r.getViewport(new T.Vector4()),scissor:r.getScissor(new T.Vector4()),test:r.getScissorTest(),color:r.getClearColor(new T.Color()),alpha:r.getClearAlpha(),auto:r.autoClear};
 try{return fn();}finally{r.setRenderTarget(state.target,state.face,state.level);r.setViewport(state.viewport);r.setScissor(state.scissor);r.setScissorTest(state.test);r.setClearColor(state.color,state.alpha);r.autoClear=state.auto;}
}
export function createVideoGpuImage({THREE:T,renderer:r,width=PW,height=PH,visible={x:PX,y:PY,w:W,h:H}}){
 if(!r?.isWebGLRenderer)throw Error('Existing main THREE.WebGLRenderer required');
 if(width!==PW||height!==PH||visible.x!==PX||visible.y!==PY||visible.w!==W||visible.h!==H)throw Error('Video candidate requires original native panel/visible dimensions');
 if(r.getPixelRatio&&r.getPixelRatio()!==1)throw Error('Video candidate requires native renderer pixelRatio1');
 const replay=createVideoBoundaryReplay();
 const drawCache=createVideoDrawCache();let bodyReuses=0,panelReuses=0;
 const context=r.getContext(),owned=new Set(),videos=new Map(),identities=new WeakMap();let identitySequence=0;
 const own=x=>(owned.add(x),x),release=x=>{if(x&&owned.delete(x))x.dispose();};
 let disposed=false,enabled=true,failed=false,status='initial',reason='no-completed-body',bodyRevision=0,compositeRevision=0,rawValid=false,outputValid=false;
 let completed=null,lastRequest=null,overlayTexture=null,overlaySource=null,hudTexture=null,hudSource=null,hud=null,hudRevision=0,overlayRevision=0,flashRevision=0,flash={alpha:0,color:'miss'};
 const stats={kind:'video_compositor_injected',renderRequests:0,bodyDraws:0,composites:0,waitingFrames:0,recoveries:0,unsupportedFrames:0,disabledFrames:0,videoTexturesCreated:0,videoTexturesDisposed:0,videoUpdateRequests:0,videoTexturesMax:0,overlayUploads:0,hudUpdates:0,failures:[],boundary:{rawReads:0,panelReads:0,hits:0,failures:0,cpuFallbackPanels:0,readMs:0,readMaxMs:0}};
 const configure=(t,flip)=>{t.colorSpace=T.NoColorSpace;t.minFilter=t.magFilter=T.LinearFilter;t.wrapS=t.wrapT=T.ClampToEdgeWrapping;t.generateMipmaps=false;t.flipY=flip;t.premultiplyAlpha=false;t.unpackAlignment=4;return t;};
 const dummy=configure(own(new T.DataTexture(new Uint8Array([0,0,0,0]),1,1,T.RGBAFormat,T.UnsignedByteType)),false);dummy.needsUpdate=true;
 const makeTarget=(w,h,name)=>{const t=own(new T.WebGLRenderTarget(w,h,{format:T.RGBAFormat,type:T.UnsignedByteType,minFilter:T.LinearFilter,magFilter:T.LinearFilter,generateMipmaps:false,depthBuffer:false,stencilBuffer:false,samples:0,colorSpace:T.NoColorSpace}));t.texture.name=name;t.texture.flipY=false;t.texture.generateMipmaps=false;return t;};
 const raw=makeTarget(W,H,'video-candidate-native-body'),output=makeTarget(PW,PH,'video-lifecycle-flash-hud');
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

 return {
  surface,
  setEnabled(on){assertLive();enabled=!!on;if(!enabled){status='disabled';reason='explicit-gate';}else if(!failed){status=rawValid?'ready':'initial';reason=rawValid?null:'no-completed-body';}return enabled;},
  render(snapshot){assertLive();stats.renderRequests++;const requested=Array.isArray(snapshot?.layers)?snapshot.layers.filter(l=>l?.drawable!==false):null;if(requested?.every(l=>l?.video&&(typeof l.video==='object'||typeof l.video==='function')))lastRequest=stamp(snapshot,requested);if(!enabled){status='disabled';reason='explicit-gate';stats.disabledFrames++;return null;}if(failed)return null;
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
  setHudCanvas(canvas){assertLive();hud=canvas;if(canvas){if(hudSource!==canvas){release(hudTexture);hudTexture=configure(own(new T.CanvasTexture(canvas)),true);hudSource=canvas;}hudTexture.needsUpdate=true;hudRevision++;stats.hudUpdates++;}},
  compose(){assertLive();if(!rawValid||failed)return null;try{assertBoundary();const panelKey=()=>[bodyRevision,overlayRevision,hudRevision,hud,flashRevision,compositeRevision];if(outputValid&&drawCache.samePanel(panelKey())){panelReuses++;return output.texture;}withRendererState(T,r,()=>{panelValues(true);outputValid=false;draw(panelScene,output);});outputValid=true;compositeRevision++;drawCache.commitPanel(panelKey());stats.composites++;return output.texture;}catch(error){return fail(error,'compose');}},
  rawCanvas(reasonValue='raw-capture'){assertLive();return rawCanvas(reasonValue);},
  materializeTo({panelCtx=null,heldCtx=null,reason:reasonValue='boundary'}={}){assertLive();return replay.materializeTo({panelCtx,heldCtx,flash});
  },
  diagnostics(){return {...stats,drawReuse:{enabled:drawCache.enabled,bodyReuses,panelReuses},failures:stats.failures.map(f=>({...f})),boundary:{...stats.boundary,replayCount:replay.diagnostics().materializations,replayMs:replay.diagnostics().replayMs,replayMaxMs:replay.diagnostics().replayMaxMs,rawReplays:replay.diagnostics().rawReplays,panelReplays:replay.diagnostics().panelReplays},sourceFrames:replay.diagnostics(),status,reason,enabled,failed,disposed,bodyRevision,compositeRevision,rawValid,outputValid,completed:copyStamp(completed),request:copyStamp(lastRequest),flash:{...flash,revision:flashRevision},overlay:{active:!!overlayTexture,revision:overlayRevision},hud:{active:!!hud,revision:hudRevision},videoTextures:videos.size,videoKeys:[...videos.values()].map(e=>({identity:e.identity,key:e.key,sourceKey:e.sourceKey})),targetBytes:W*H*4+PW*PH*4,contextsCreated:0,videoElementsCreated:0};},
  dispose(){if(disposed)return;disposed=true;status='disposed';for(const resource of [...owned])release(resource);videos.clear();replay.dispose();rawValid=outputValid=false;}
 };
}
