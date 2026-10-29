import {resultMeterSteps} from './final_result_state_20261029.mjs';
// Perf-only final result adapter. Video, result state and clock belong to surface.
import {createFinalResultRendererInjected} from './final_result_compositor_gpu_1029.mjs';
const W=1152,H=1268,PW=1240,PH=1510,PX=34,PY=28;
function restored(T,r,fn){
 const s={target:r.getRenderTarget(),face:r.getActiveCubeFace(),level:r.getActiveMipmapLevel(),vp:r.getViewport(new T.Vector4()),sc:r.getScissor(new T.Vector4()),test:r.getScissorTest(),color:r.getClearColor(new T.Color()),alpha:r.getClearAlpha(),auto:r.autoClear};
 try{return fn();}finally{r.resetState();r.setRenderTarget(s.target,s.face,s.level);r.setViewport(s.vp);r.setScissor(s.sc);r.setScissorTest(s.test);r.setClearColor(s.color,s.alpha);r.autoClear=s.auto;}
}
export function createFinalResultImageBackend({THREE:T,renderer:r,core,actualWarm=true}){
 let disposed=false,panelValid=false,panelRevision=0,hud=null,hudTexture=null,hudRevision=0,lastPanelKey=null,cachedNative=null,cachedPanel=null,cachedRevision=null;
 let completedGeneration=0,completedStamp=null,publishedStamp=null;const producerToken={};
 const sameStamp=(a,b)=>a&&b&&['owner','publishedGeneration','nativeRevision','panelRevision','completedHud'].every(k=>a[k]===b[k]);
 const pinned=stamp=>!!(stamp&&core.surface.valid&&panelValid&&!hud&&stamp.completedHud===false&&sameStamp(stamp,publishedStamp)&&sameStamp(stamp,completedStamp)&&stamp.nativeRevision===core.surface.revision&&stamp.panelRevision===panelRevision&&stamp.publishedGeneration===completedGeneration);
 let actualWarmReceipt={status:actualWarm?'pending':'disabled',frame:301};
 const stats={kind:'final_result_image_injected',composites:0,reads:0,readHits:0,materializations:0,warmCalls:0,failures:[]};
 const target=new T.WebGLRenderTarget(PW,PH,{format:T.RGBAFormat,type:T.UnsignedByteType,minFilter:T.LinearFilter,magFilter:T.LinearFilter,generateMipmaps:false,depthBuffer:false,stencilBuffer:false,samples:0,colorSpace:T.NoColorSpace});target.texture.flipY=false;target.texture.generateMipmaps=false;target.texture.name='final-result-full-panel';
 const dummy=new T.DataTexture(new Uint8Array([0,0,0,0]),1,1,T.RGBAFormat);dummy.needsUpdate=true;
 const u={raw:{value:core.surface.texture},hud:{value:dummy},hudOn:{value:0}};
 const mat=new T.ShaderMaterial({uniforms:u,depthTest:false,depthWrite:false,blending:T.NoBlending,toneMapped:false,
  vertexShader:'varying vec2 q;void main(){q=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader:'varying vec2 q;uniform sampler2D raw,hud;uniform float hudOn;void main(){vec2 p=vec2(q.x*1240.,(1.-q.y)*1510.);vec2 s=(p-vec2(34.,28.))/vec2(1152.,1268.);vec3 c=vec3(0.);if(all(greaterThanEqual(s,vec2(0.)))&&all(lessThan(s,vec2(1.))))c=texture2D(raw,vec2(s.x,1.-s.y)).rgb;vec2 h=(p-vec2(866.,156.))/vec2(304.,308.);if(hudOn>.5&&all(greaterThanEqual(h,vec2(0.)))&&all(lessThan(h,vec2(1.)))){vec4 t=texture2D(hud,vec2(h.x,1.-h.y));c=mix(c,t.rgb,t.a);}gl_FragColor=vec4(c,1.);}'});
 const geometry=new T.PlaneGeometry(2,2),scene=new T.Scene(),camera=new T.Camera(),mesh=new T.Mesh(geometry,mat);mesh.frustumCulled=false;scene.add(mesh);
 const panelSurface={type:'lcd-gpu-surface',texture:target.texture,target,width:PW,height:PH,context:r.getContext(),origin:'bottom-left',encoding:'srgb-encoded',alphaMode:'opaque',get revision(){return panelRevision;},get valid(){return panelValid&&!disposed;}};
 const sentinel={width:W,height:H,readyState:4,get resultRevision(){return core.surface.revision;}};
 const live=()=>{if(disposed)throw Error('Final result image disposed');};
 const fail=(reason,error)=>stats.failures.push({reason,message:String(error?.message??error)});
 const nativeImage=()=>{
  live();if(!core.surface.valid)return null;if(cachedRevision===core.surface.revision&&cachedNative){stats.readHits++;return cachedNative;}
  const image=core.readPixels(),row=W*4,top=new Uint8ClampedArray(image.bytes.length);stats.reads++;
  for(let y=0;y<H;y++)top.set(image.bytes.subarray((H-1-y)*row,(H-y)*row),y*row);
  if(!cachedNative){cachedNative=document.createElement('canvas');cachedNative.width=W;cachedNative.height=H;cachedNative.readyState=4;cachedPanel=document.createElement('canvas');cachedPanel.width=PW;cachedPanel.height=PH;cachedPanel.readyState=4;}
  cachedNative.getContext('2d',{alpha:false}).putImageData(new ImageData(top,W,H),0,0);cachedNative.resultRevision=core.surface.revision;
  const ctx=cachedPanel.getContext('2d',{alpha:false});ctx.fillStyle='#000';ctx.fillRect(0,0,PW,PH);ctx.drawImage(cachedNative,PX,PY,W,H);cachedRevision=core.surface.revision;return cachedNative;
 };
 const api={core,surface:core.surface,panelSurface,
  get canvas(){return core.surface.valid?sentinel:null;},get ready(){return core.ready;},
  prewarm:()=>core.prewarm(),
  // Allocation/compile only, never manufacture a completed native revision.
  warmup(){live();if(core.surface.revision!==0)throw Error('Final warmup is boot-only');if(r.getRenderTarget()!==null)throw Error('Final warm requires default-target boundary');try{return restored(T,r,()=>{r.initRenderTarget(target);r.initTexture(dummy);r.compile(scene,camera);r.setRenderTarget(target);r.setViewport(0,0,PW,PH);r.setScissorTest(false);r.setClearColor(0,1);r.clear(true,false,false);stats.warmCalls++;return {kind:'final-result-panel-allocation-compile',producerDraws:0,completedRevision:0};});}catch(error){panelValid=false;fail('warmup',error);throw error;}},
  warmActualDraw(){
   live();if(!actualWarm)return actualWarmReceipt;
   if(core.surface.revision!==0||panelRevision||panelValid||stats.composites||stats.reads||completedGeneration||completedStamp||publishedStamp||cachedNative||cachedPanel||hud)throw Error('Final actual warm is unused-boot-only');
   if(actualWarmReceipt.status==='ready')return actualWarmReceipt;
   const thresholds=[0,70,100,150,500],state=Object.freeze({value:1000000,totalText:'99999',rankIndex:4,prize:'S',thresholds,meterSteps:resultMeterSteps(thresholds),jp:8,best:2000000,newRecord:false,nextIndex:null,need:0,dreamRequired:false,nextMessage:'warm-only',day:'warm-no-storage',savedBest:2000000});
   const oldUniforms=Object.fromEntries(Object.entries(u).map(([k,v])=>[k,v.value]));let receipt;
   try{receipt=core.warmActual({state,afterNative:()=>restored(T,r,()=>{u.raw.value=core.surface.texture;u.hud.value=dummy;u.hudOn.value=0;r.autoClear=false;r.setRenderTarget(target);r.setViewport(0,0,PW,PH);r.setScissorTest(false);r.render(scene,camera);})});}
   finally{
    try{restored(T,r,()=>{r.setRenderTarget(target);r.setViewport(0,0,PW,PH);r.setScissorTest(false);r.setClearColor(0,1);r.clear(true,false,false);});}
    catch(error){receipt={...(receipt??{status:'failed',frame:301}),status:'failed',panelBlackCleared:false,panelCleanupError:String(error?.message??error)};}
    finally{for(const[k,value]of Object.entries(oldUniforms))u[k].value=value;panelValid=false;lastPanelKey=null;panelRevision=0;completedGeneration=0;completedStamp=publishedStamp=null;cachedRevision=null;}
   }
   actualWarmReceipt={...receipt,panelBlackCleared:receipt?.panelBlackCleared!==false,extraTargets:0,extraDecoders:0};
   if(actualWarmReceipt.panelBlackCleared===false||receipt?.blackCleared===false)throw Error('Final warm black cleanup incomplete: '+(receipt?.panelCleanupError??receipt?.cleanupErrors?.join('; ')));
   return actualWarmReceipt;
  },
  render(f,state){live();try{const result=core.render(f,state);return result||core.surface.valid?sentinel:null;}catch(error){panelValid=false;fail('render',error);throw error;}},
  setHudCanvas(canvas){live();if(canvas===hud&&!canvas)return;hud=canvas;hudRevision++;if(canvas){if(!hudTexture){hudTexture=new T.CanvasTexture(canvas);hudTexture.colorSpace=T.NoColorSpace;hudTexture.generateMipmaps=false;hudTexture.minFilter=hudTexture.magFilter=T.LinearFilter;hudTexture.premultiplyAlpha=false;}hudTexture.needsUpdate=true;}},
  compose(){live();if(!core.surface.valid)return null;const key=core.surface.revision+':'+hudRevision;if(!hud&&panelValid&&key===lastPanelKey)return target.texture;if(r.getRenderTarget()!==null)throw Error('Final panel requires default-target boundary');panelValid=false;
   try{restored(T,r,()=>{u.raw.value=core.surface.texture;u.hud.value=hud?hudTexture:dummy;u.hudOn.value=hud?1:0;r.autoClear=false;r.setRenderTarget(target);r.setViewport(0,0,PW,PH);r.setScissorTest(false);r.render(scene,camera);});panelRevision++;stats.composites++;lastPanelKey=key;panelValid=true;completedStamp={owner:'final-result',publishedGeneration:completedGeneration,nativeRevision:core.surface.revision,panelRevision,completedHud:!!hud};return target.texture;}catch(error){fail('compose',error);return null;}
  },
  setCompletedGeneration(generation){if(!Number.isInteger(generation)||generation<1)throw Error('Completed final generation required');completedGeneration=generation;},
  notePublished(generation){if(panelValid&&completedStamp&&core.surface.valid&&completedStamp.nativeRevision===core.surface.revision&&completedStamp.publishedGeneration===generation)publishedStamp=Object.freeze({...completedStamp});},
  capturePublishedSource(){if(!pinned(publishedStamp))return null;const stamp={...publishedStamp};return {token:producerToken,context:r.getContext(),width:PW,height:PH,valid:true,texture:target.texture,stamp,verify:expected=>pinned(expected)};},
  materializePublishedTo(args){if(!publishedStamp||!core.surface.valid||publishedStamp.nativeRevision!==core.surface.revision||publishedStamp.publishedGeneration!==completedGeneration)return null;return api.materializeTo(args);},
  getComposedPanelContext:()=>r.getContext(),
  rawCanvas:()=>nativeImage(),
  materializeTo({panelCtx=null,heldCtx=null,reason='final-boundary'}={}){live();const image=nativeImage();if(!image)return null;stats.materializations++;for(const [ctx,source]of [[heldCtx,image],[panelCtx,cachedPanel]])if(ctx){ctx.save();try{ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='copy';ctx.filter='none';ctx.drawImage(source,0,0);}finally{ctx.restore();}}return image;},
  diagnostics:()=>({...stats,failures:stats.failures.map(x=>({...x})),mode:'gpu',legacyMode:false,actualWarm:JSON.parse(JSON.stringify(actualWarmReceipt)),disposed,valid:core.surface.valid,panelValid,revision:core.surface.revision,panelRevision,hud:!!hud,hudRevision,cachedRevision,completedStamp:completedStamp?{...completedStamp}:null,publishedStamp:publishedStamp?{...publishedStamp}:null,extraContexts:0,core:core.diagnostics()}),
  dispose(){if(disposed)return;disposed=true;panelValid=false;target.dispose();dummy.dispose();hudTexture?.dispose();mat.dispose();geometry.dispose();core.dispose();cachedNative=cachedPanel=null;}
 };
 sentinel.gpuFinalResultImage=api;return api;
}
export async function createFinalResultGpuImage({base,man,video,THREE,renderer,actualWarm=true}){
 const core=await createFinalResultRendererInjected(base,man,video,{THREE,renderer});
 try{return createFinalResultImageBackend({THREE,renderer,core,actualWarm});}catch(error){core.dispose();throw error;}
}
