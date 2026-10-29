// Approved native result producer: existing main GL, no scene/model/video clock.
import {createResultCompositorInjected} from './result_compositor_gpu_1029.mjs';
import {createResultCompositor} from './result_compositor_confirm1029.mjs';
const W=1152,H=1268,PW=1240,PH=1510,PX=34,PY=28;
function withRendererState(THREE,r,fn){
 const state={target:r.getRenderTarget(),face:r.getActiveCubeFace(),level:r.getActiveMipmapLevel(),viewport:r.getViewport(new THREE.Vector4()),scissor:r.getScissor(new THREE.Vector4()),test:r.getScissorTest(),color:r.getClearColor(new THREE.Color()),alpha:r.getClearAlpha(),auto:r.autoClear};
 try{return fn();}finally{r.setRenderTarget(state.target,state.face,state.level);r.setViewport(state.viewport);r.setScissor(state.scissor);r.setScissorTest(state.test);r.setClearColor(state.color,state.alpha);r.autoClear=state.auto;}
}
// Synchronous image contract shared with normal/palace. Exported for CPU mocks.
export function createResultImageBackend({THREE,renderer,core,onFailure=()=>{},boundaryGpu=null}){
 let disposed=false,failed=false,cachedRevision=null,cachedVisible=null,cachedPanel=null,visibleCtx=null,panelCtx=null,hud=null,hudTexture=null,flash={alpha:0,color:'#fff'};
 const beforeOverwrite=new Set();let notifyingOverwrite=false;
 const notifyBeforeOverwrite=next=>{if(notifyingOverwrite)return;notifyingOverwrite=true;try{for(const notify of [...beforeOverwrite])notify(next);}finally{notifyingOverwrite=false;}};
 const boundaryToken={};let boundaryOwner=null,completedBoundary=null,boundaryHasRendered=false;const boundaryPrototype={captures:0,rejected:0,lastUnsupported:null};
 const stats={kind:'result_compositor_injected',composites:0,boundaryMaterializations:0,boundaryReadMs:0,boundaryReadMaxMs:0,failures:[]},boundary={reads:0,hits:0,failures:0};
 const output=new THREE.WebGLRenderTarget(PW,PH,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,generateMipmaps:false,depthBuffer:false,stencilBuffer:false,samples:0,colorSpace:THREE.NoColorSpace});
 output.texture.name='result-lifecycle-flash-hud';output.texture.flipY=false;output.texture.generateMipmaps=false;
 const dummy=new THREE.DataTexture(new Uint8Array([0,0,0,0]),1,1,THREE.RGBAFormat);dummy.needsUpdate=true;
 const uniforms={raw:{value:core.surface.texture},hud:{value:dummy},hudOn:{value:0},flashA:{value:0},flashRGB:{value:new THREE.Vector3(1,1,1)}};
 const material=new THREE.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,blending:THREE.NoBlending,toneMapped:false,
  vertexShader:'varying vec2 q;void main(){q=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader:'varying vec2 q;uniform sampler2D raw,hud;uniform float hudOn,flashA;uniform vec3 flashRGB;void main(){vec2 p=vec2(q.x*1240.,(1.-q.y)*1510.);vec2 s=(p-vec2(34.,28.))/vec2(1152.,1268.);vec3 c=vec3(0.);if(all(greaterThanEqual(s,vec2(0.)))&&all(lessThan(s,vec2(1.)))){c=texture2D(raw,vec2(s.x,1.-s.y)).rgb;c=mix(c,flashRGB,flashA);}vec2 h=(p-vec2(690.,130.))/vec2(496.,410.);if(hudOn>.5&&all(greaterThanEqual(h,vec2(0.)))&&all(lessThan(h,vec2(1.)))){vec4 t=texture2D(hud,vec2(h.x,1.-h.y));c=mix(c,t.rgb,t.a);}gl_FragColor=vec4(c,1.);}'});
 const geometry=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene(),camera=new THREE.Camera(),mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;scene.add(mesh);
 const sentinel={width:W,height:H,readyState:4,gpuResultImage:null,get resultRevision(){return core.surface.revision;}};
 const fail=(error,reason)=>{const message=String(error?.message??error);if(!failed){notifyBeforeOverwrite(null);failed=true;stats.failures.push({reason,message});onFailure(error,reason);}return message;};
 function nativeImage(reason){
  const revision=core.surface.revision;if(!revision||disposed)return cachedVisible;
  if(cachedRevision===revision){boundary.hits++;return cachedVisible;}
  cachedRevision=revision;boundary.reads++;
  try{
   const at=performance.now();let image;try{image=core.readPixels();}finally{const ms=performance.now()-at;stats.boundaryReadMs+=ms;stats.boundaryReadMaxMs=Math.max(stats.boundaryReadMaxMs,ms);}
   const row=W*4,top=new Uint8ClampedArray(image.bytes.length);for(let y=0;y<H;y++)top.set(image.bytes.subarray((H-1-y)*row,(H-y)*row),y*row);
   if(!cachedVisible){cachedVisible=document.createElement('canvas');cachedVisible.width=W;cachedVisible.height=H;cachedVisible.readyState=4;visibleCtx=cachedVisible.getContext('2d',{alpha:false});cachedPanel=document.createElement('canvas');cachedPanel.width=PW;cachedPanel.height=PH;panelCtx=cachedPanel.getContext('2d',{alpha:false});}
   visibleCtx.putImageData(new ImageData(top,W,H),0,0);cachedVisible.resultRevision=revision;
   panelCtx.fillStyle='#000';panelCtx.fillRect(0,0,PW,PH);panelCtx.drawImage(cachedVisible,PX,PY,W,H);return cachedVisible;
  }catch(error){boundary.failures++;fail(error,reason);return cachedVisible;}
 }
 function boundarySource(){if(disposed||failed||!completedBoundary||completedBoundary.revision!==core.surface.revision)return null;return {...completedBoundary,flashAlpha:flash.alpha,flashColor:flash.color,hud:'omitted'};}
 function drawCleanBoundary(target){const old={raw:uniforms.raw.value,hud:uniforms.hud.value,hudOn:uniforms.hudOn.value,flashA:uniforms.flashA.value};try{uniforms.raw.value=core.surface.texture;uniforms.hud.value=dummy;uniforms.hudOn.value=0;uniforms.flashA.value=0;renderer.autoClear=false;renderer.setRenderTarget(target);renderer.setViewport(0,0,PW,PH);renderer.setScissorTest(false);renderer.render(scene,camera);}finally{uniforms.raw.value=old.raw;uniforms.hud.value=old.hud;uniforms.hudOn.value=old.hudOn;uniforms.flashA.value=old.flashA;}}
 const api={
  get canvas(){return failed?cachedVisible:core.surface.revision?sentinel:null;},surface:core.surface,
  render(...args){if(disposed)throw Error('Result GPU image disposed');if(failed)return cachedVisible;
   const first=args[0]==='confirm'?84:64,last=args[0]==='confirm'?213:149,f=Math.min(last,Math.max(first,args[1]));
   if(completedBoundary&&args[1]>=first&&core.ready(args[0],f)){
    const next={ownerId:'result',...boundaryOwner,kind:args[0],frame:f,value:args[2],chain:args[3],revision:core.surface.revision};
    if(!['generation','serial','kind','frame','value','chain'].every(k=>next[k]===completedBoundary[k])||completedBoundary.revision!==core.surface.revision){next.revision=core.surface.revision+1;notifyBeforeOverwrite(next);}
   }
   try{const result=core.render(...args);if(result){boundaryHasRendered=true;completedBoundary=boundaryOwner?{ownerId:'result',...boundaryOwner,kind:args[0],frame:Math.min(args[0]==='confirm'?213:149,Math.max(args[0]==='confirm'?84:64,args[1])),value:args[2],chain:args[3],revision:core.surface.revision}:null;}return result?sentinel:null;}catch(error){fail(error,'render');nativeImage('render-failed-capture');return cachedVisible;}},
  setFlash(alpha=0,color='miss'){flash={alpha:Math.max(0,Math.min(1,alpha||0)),color:color==='hit'?'#fff':'#736099'};},
  setHudCanvas(canvas){hud=canvas;if(canvas){if(!hudTexture){hudTexture=new THREE.CanvasTexture(canvas);hudTexture.colorSpace=THREE.NoColorSpace;hudTexture.generateMipmaps=false;hudTexture.minFilter=hudTexture.magFilter=THREE.LinearFilter;}hudTexture.needsUpdate=true;}},
  getComposedPanelContext(){return renderer.getContext();},
  compose(){if(disposed)throw Error('Result GPU image disposed');if(failed||!core.surface.revision)return null;
   uniforms.hud.value=hud?hudTexture:dummy;uniforms.hudOn.value=hud?1:0;uniforms.flashA.value=flash.alpha;uniforms.flashRGB.value.set(...(flash.color==='#fff'?[1,1,1]:[115/255,96/255,153/255]));
   try{if(renderer.getRenderTarget()!==null)throw Error('Result panel requires a default-target frame boundary');withRendererState(THREE,renderer,()=>{renderer.autoClear=false;renderer.setRenderTarget(output);renderer.setViewport(0,0,PW,PH);renderer.setScissorTest(false);renderer.render(scene,camera);});stats.composites++;return output.texture;}
   catch(error){fail(error,'compose');nativeImage('compose-failed-capture');return null;}
  },
  setBoundaryOwner({generation,serial,dim=false}={}){if(disposed)throw Error('Result GPU image disposed');if(!Number.isInteger(generation)||generation<0||!Number.isInteger(serial)||serial<0)throw Error('Result boundary generation/serial required');boundaryOwner={generation,serial,dim:!!dim};},
  boundarySource,
  addBeforeBoundaryOverwrite(notify){if(disposed)throw Error('Result GPU image disposed');if(typeof notify!=='function')throw TypeError('Result overwrite listener required');beforeOverwrite.add(notify);return ()=>beforeOverwrite.delete(notify);},
  warmBoundary(){if(disposed||boundaryHasRendered)throw Error('Result boundary warm is boot-only');if(!boundaryGpu)return {skipped:true,reason:'boundary-helper-not-injected'};return boundaryGpu.warm({drawClean:drawCleanBoundary});},
  captureCleanPanel({expectedRevision,expectedGeneration,reason='result-exit'}={}){if(disposed)return null;const stamp=boundarySource();if(!boundaryGpu||!stamp||stamp.flashAlpha!==0||stamp.dim){boundaryPrototype.rejected++;boundaryPrototype.lastUnsupported=!boundaryGpu?'boundary-helper-not-injected':!stamp?'no-current-completed-stamp':'flash-or-dim';return null;}const lease=boundaryGpu.capture({producerContext:renderer.getContext(),producerToken:boundaryToken,stamp:{...stamp,reason},expectedRevision,expectedGeneration,drawClean:target=>{if(core.surface.revision!==stamp.revision)throw Error('Result revision changed before boundary copy');drawCleanBoundary(target);if(core.surface.revision!==stamp.revision)throw Error('Result revision changed during boundary copy');}});if(lease){boundaryPrototype.captures++;boundaryPrototype.lastUnsupported=null;}else{boundaryPrototype.rejected++;boundaryPrototype.lastUnsupported=boundaryGpu.diagnostics().lastUnsupported??'capture-failed';}return lease;},
  rawCanvas(reason='result-raw-capture'){return nativeImage(reason);},
  materializeTo({panelCtx:destination=null,heldCtx=null,reason='result-boundary'}={}){
   const image=nativeImage(reason);if(!image)return null;stats.boundaryMaterializations++;
   if(heldCtx){heldCtx.save();heldCtx.setTransform(1,0,0,1,0,0);heldCtx.globalAlpha=1;heldCtx.globalCompositeOperation='copy';heldCtx.filter='none';heldCtx.drawImage(image,0,0);heldCtx.restore();}
   if(destination){destination.save();destination.setTransform(1,0,0,1,0,0);destination.globalAlpha=1;destination.globalCompositeOperation='copy';destination.filter='none';destination.drawImage(cachedPanel,0,0);destination.globalCompositeOperation='source-over';if(flash.alpha>0){destination.globalAlpha=flash.alpha;destination.fillStyle=flash.color;destination.fillRect(PX,PY,W,H);}destination.restore();}
   return image;
  },
  fail,
  diagnostics(){return {...stats,failures:stats.failures.map(f=>({...f})),revision:core.surface.revision,failed,disposed,boundary:{...boundary,revision:cachedRevision},boundaryPrototype:{...boundaryPrototype,completed:completedBoundary?{...completedBoundary}:null,source:boundarySource()},segment:core.segmentDiagnostics(),extraContexts:0};},
  dispose(){if(disposed)return;notifyBeforeOverwrite(null);disposed=true;beforeOverwrite.clear();output.dispose();material.dispose();geometry.dispose();dummy.dispose();hudTexture?.dispose();core.dispose();}
 };
 sentinel.gpuResultImage=api;return api;
}

export async function createResultGpuImage({base,config,THREE,renderer,boundaryGpu=null}){
 const core=await createResultCompositorInjected(base,config,{THREE,renderer});
 let image,legacy=null,preparingLegacy=null,legacyPending=null,legacyPublished=false,disposed=false,lastArgs=null,fallbackFailed=false;
 const releasedNative=new WeakSet(),releaseNative=next=>{if(next&&!releasedNative.has(next)){releasedNative.add(next);next.dispose();}};
 const fallbackFailures=[];let legacyCreates=0,legacyStartupMs=null;
 const startLegacy=(error,reason)=>{
  if(disposed||legacyPending)return;
  const at=performance.now();fallbackFailures.push({reason,message:String(error?.message??error)});
  // Actual GL/readback failures only. Expected decode waits never enter here.
  // Start outside the synchronous frame stack; keep a completed image while loading.
  legacyPending=Promise.resolve().then(()=>disposed?null:createResultCompositor(base,config)).then(async next=>{
   if(!next)return null;preparingLegacy=next;
   if(disposed){releaseNative(next);preparingLegacy=null;return null;}
   try{if(lastArgs&&lastArgs[1]>=(lastArgs[0]==='confirm'?84:64))await next.prepare(lastArgs[0],lastArgs[1]);}
   catch(error){releaseNative(next);preparingLegacy=null;throw error;}
   if(disposed){releaseNative(next);preparingLegacy=null;return null;}legacy=next;preparingLegacy=null;legacyCreates++;legacyStartupMs=performance.now()-at;return next;
  }).catch(e=>{fallbackFailed=true;fallbackFailures.push({reason:'legacy-factory',message:String(e?.message??e)});return null;});
 };
 try{image=createResultImageBackend({THREE,renderer,core,onFailure:startLegacy,boundaryGpu});}catch(error){core.dispose();throw error;}
 return {
  get canvas(){return legacyPublished?legacy.canvas:image.canvas;},surface:core.surface,
  get errors(){return [...core.errors,...image.diagnostics().failures.map(f=>'Result GPU '+f.reason+': '+f.message),...fallbackFailures.filter(f=>f.reason==='legacy-factory').map(f=>'Result fallback '+f.message),...(legacy?.errors??[])];},
  render(kind,f,V,C){if(disposed)throw Error('Result GPU compositor disposed');lastArgs=[kind,f,V,C];if(legacy){const result=legacy.render(kind,f,V,C);if(result){result.readyState=4;legacyPublished=true;image.dispose();}return result;}return image.render(kind,f,V,C);},
  ready:(kind,f)=>disposed?false:legacy?legacy.ready(kind,f):legacyPending?false:core.ready(kind,f),
  prepare:async(kind,f)=>{if(disposed)return null;if(legacyPending){const next=await legacyPending;return next?.prepare(kind,f)??null;}return core.prepare(kind,f);},
  prefetch(kind,f){if(disposed)return;if(legacy)legacy.prefetch(kind,f);else if(!legacyPending)core.prefetch(kind,f);},
  async warmup(){if(disposed)throw Error('Result GPU compositor disposed');try{return legacy?await legacy.warmup():await core.warmup();}catch(error){image.fail(error,'warmup');const next=await legacyPending;if(!next)throw error;const result=await next.warmup();image.dispose();return {...result,imageFallback:true};}},
  setBoundaryOwner(owner){return image.setBoundaryOwner(owner);},
  boundarySource:()=>legacyPending||legacyPublished?null:image.boundarySource(),
  warmBoundary:()=>legacyPending||legacyPublished?{skipped:true,reason:'native-fallback'}:image.warmBoundary(),
  captureCleanPanel:options=>legacyPending||legacyPublished?null:image.captureCleanPanel(options),
  schedulerDiagnostics:()=>legacy?.schedulerDiagnostics()??core.schedulerDiagnostics(),
  diagnostics(){return {...image.diagnostics(),legacyMode:!!legacyPending,mode:legacy?'native-fallback':fallbackFailed?'native-fallback-failed':legacyPending?'native-fallback-loading':'gpu',legacyCreates,legacyStartupMs,fallbackFailures:fallbackFailures.map(f=>({...f}))};},
  dispose(){if(disposed)return;disposed=true;image.dispose();releaseNative(preparingLegacy);releaseNative(legacy);}
 };
}
