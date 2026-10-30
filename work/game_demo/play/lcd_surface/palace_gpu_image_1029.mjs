// Native palace image backend; model/events/video playback stay with the caller.
import {createPalaceGpuProducer,PANEL,withRendererState} from './palace_gpu_producer_1029.mjs';
import {createPalaceBoundaryImage} from './palace_boundary_1030.mjs';
import {createContinuousRyuguBg} from './palace_gpu_fallback_1029.mjs';

// Pure boundary cache: at most one read attempt per immutable producer revision.
// Failed reads are cached as an image-path fallback as well; no retry storm.
export function createBoundaryCache({read,fallback}){
 let revision=null,value=null,cachedError=null;const stats={reads:0,hits:0,failures:0};
 return {get(nextRevision,reason){if(revision===nextRevision){stats.hits++;if(cachedError)throw cachedError;return value;}revision=nextRevision;value=null;cachedError=null;stats.reads++;
   try{return value=read(reason);}catch(error){stats.failures++;try{return value=fallback(error,reason);}catch(fallbackError){cachedError=fallbackError;throw fallbackError;}}},
   stats:()=>({...stats,revision}),clear(){revision=null;value=null;cachedError=null;}};
}

export async function createPalaceGpuImage({THREE,renderer,background,base,center,drawWarm=true}){
 const images=[];
 const load=async path=>{const r=await fetch(new URL(path,base));if(!r.ok)throw Error('Palace atlas HTTP '+r.status);const im=await createImageBitmap(await r.blob(),{premultiplyAlpha:'none',colorSpaceConversion:'none'});images.push(im);return im;};
 let palaceBoundary=null,producer,legacy=null,disposed=false,failed=false,legacyMode=false,manual=false,lastInput=null,flash={alpha:0,color:'#fff'},hud=null,hudTexture=null;
 let rawPanel=null,rawCtx=null,rawVisible=null,rawVisibleCtx=null;
 // ?palacecompose=0 restores one panel draw + one HUD upload per frame. Otherwise the panel is redrawn only when the producer image, HUD pixels or flash changed.
 const composeCache=new URLSearchParams(globalThis.location?.search??'').get('palacecompose')!=='0';let hudRevision=0,hudCanvasRevision,outputValid=false,composedKey=null;
 const stats={producerCalls:0,heldFrames:0,composites:0,composeReuses:0,hudUploads:0,boundaryMaterializations:0,legacyCalls:0,legacyCreates:0,legacyInitMs:0,legacyInitMaxMs:0,legacyDrawMs:0,legacyDrawMaxMs:0,boundaryReadMs:0,boundaryReadMaxMs:0,failures:[],boundaryReadbackMaySynchronize:true};
 try{
  const centerImages=center?{F:await load(center.F),T:await load(center.T),meta:center.meta}:null;
  producer=createPalaceGpuProducer({THREE,renderer,centerImages});
  palaceBoundary=new URLSearchParams(globalThis.location?.search??'').get('palacebridge')!=='0'?createPalaceBoundaryImage({THREE,renderer,palaceSurface:producer.surface}):null;
  const output=new THREE.WebGLRenderTarget(PANEL.width,PANEL.height,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,generateMipmaps:false,depthBuffer:false,stencilBuffer:false,samples:0,colorSpace:THREE.NoColorSpace});
  output.texture.generateMipmaps=false;output.texture.flipY=false;output.texture.name='palace-lifecycle-flash-hud';
  const dummy=new THREE.DataTexture(new Uint8Array([0,0,0,0]),1,1,THREE.RGBAFormat);dummy.needsUpdate=true;
  const uniforms={raw:{value:producer.surface.texture},hud:{value:dummy},hudOn:{value:0},flashA:{value:0},flashRGB:{value:new THREE.Vector3(1,1,1)}};
  const material=new THREE.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,blending:THREE.NoBlending,toneMapped:false,
   vertexShader:'varying vec2 q;void main(){q=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}',
   fragmentShader:'varying vec2 q;uniform sampler2D raw,hud;uniform float hudOn,flashA;uniform vec3 flashRGB;void main(){vec3 c=texture2D(raw,q).rgb;vec2 p=vec2(q.x*1240.,(1.-q.y)*1510.);if(p.x>=34.&&p.x<1186.&&p.y>=28.&&p.y<1296.)c=mix(c,flashRGB,flashA);vec2 h=(p-vec2(690.,130.))/vec2(496.,410.);if(hudOn>.5&&all(greaterThanEqual(h,vec2(0.)))&&all(lessThan(h,vec2(1.)))){vec4 t=texture2D(hud,vec2(h.x,1.-h.y));c=mix(c,t.rgb,t.a);}gl_FragColor=vec4(c,1.);}'
  });
  const geometry=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene(),camera=new THREE.Camera(),mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;scene.add(mesh);
  const fallbackImage=()=>{if(!lastInput)throw Error('No previous palace descriptor for fallback');
   if(!legacy){const at=performance.now();try{legacy=createContinuousRyuguBg({background,centerImages});stats.legacyCreates++;}finally{const ms=performance.now()-at;stats.legacyInitMs+=ms;stats.legacyInitMaxMs=Math.max(stats.legacyInitMaxMs,ms);}}
   stats.legacyCalls++;const at=performance.now();try{return legacy.render(lastInput);}finally{const ms=performance.now()-at;stats.legacyDrawMs+=ms;stats.legacyDrawMaxMs=Math.max(stats.legacyDrawMaxMs,ms);}
  };
  const prepareCanvases=()=>{if(rawPanel)return;rawPanel=document.createElement('canvas');rawPanel.width=PANEL.width;rawPanel.height=PANEL.height;rawCtx=rawPanel.getContext('2d',{alpha:false});rawVisible=document.createElement('canvas');rawVisible.width=PANEL.w;rawVisible.height=PANEL.h;rawVisibleCtx=rawVisible.getContext('2d',{alpha:false});};
  const fillFromLegacy=()=>{prepareCanvases();const image=fallbackImage();rawCtx.fillStyle='#000';rawCtx.fillRect(0,0,PANEL.width,PANEL.height);rawCtx.drawImage(image,PANEL.x,PANEL.y,PANEL.w,PANEL.h);rawVisibleCtx.drawImage(image,0,0,PANEL.w,PANEL.h);return {panel:rawPanel,visible:rawVisible,fallback:true};};
  const boundary=createBoundaryCache({read(){
   // Synchronous GPU->CPU readback: boundary-only, explicitly not a steady path.
   const at=performance.now();let read;try{read=producer.readPixels();}finally{const ms=performance.now()-at;stats.boundaryReadMs+=ms;stats.boundaryReadMaxMs=Math.max(stats.boundaryReadMaxMs,ms);}const rowBytes=read.width*4,top=new Uint8ClampedArray(read.bytes.length);
   for(let y=0;y<read.height;y++)top.set(read.bytes.subarray((read.height-1-y)*rowBytes,(read.height-y)*rowBytes),y*rowBytes);
   prepareCanvases();rawCtx.putImageData(new ImageData(top,read.width,read.height),0,0);
   rawVisibleCtx.drawImage(rawPanel,PANEL.x,PANEL.y,PANEL.w,PANEL.h,0,0,PANEL.w,PANEL.h);
   return {panel:rawPanel,visible:rawVisible,fallback:false};
  },fallback(error,reason){failed=true;stats.failures.push({reason,message:String(error?.message??error)});return fillFromLegacy();}});
  const sentinel={width:PANEL.w,height:PANEL.h,readyState:4,gpuPalaceImage:null};
  const api={
   hidden(){producer.hidden();},
   palaceBoundary,get boundaryAvailable(){return !!palaceBoundary&&!failed&&!legacyMode&&producer.surface.revision>0;},
   render(input){if(disposed)throw Error('Palace live image disposed');lastInput={...input};
    if(failed||legacyMode)return fallbackImage();
    try{const revision=producer.surface.revision;const rendered=producer.render({background,...input,sourceFrameKeys:manual?{background:background.currentTime,current:input.current?.currentTime,previous:input.previous?.currentTime}:undefined});
      if(producer.surface.revision!==revision)stats.producerCalls++;else stats.heldFrames++;
      if(legacy){legacy.dispose();legacy=null;}return rendered?sentinel:null;}
    catch(error){failed=true;stats.failures.push({reason:'render',message:String(error?.message??error),...(error.palaceVideoState?{video:{...error.palaceVideoState}}:{})});return fallbackImage();}
   },
   setManual(on){manual=!!on;},setLegacyMode(on){legacyMode=!!on;},
   setFlash(alpha=0,color='miss'){flash={alpha:Math.max(0,Math.min(1,alpha||0)),color:color==='hit'?'#fff':'#736099'};},
   setHudCanvas(canvas,revision){if(canvas!==hud)hudRevision++;hud=canvas;if(canvas){if(!hudTexture||hudTexture.image!==canvas){hudTexture?.dispose();hudTexture=new THREE.CanvasTexture(canvas);hudTexture.colorSpace=THREE.NoColorSpace;hudTexture.generateMipmaps=false;hudTexture.minFilter=hudTexture.magFilter=THREE.LinearFilter;hudCanvasRevision=undefined;}if(!composeCache||!Number.isSafeInteger(revision)||revision<0||hudCanvasRevision!==revision){hudTexture.needsUpdate=true;hudRevision++;stats.hudUploads++;}hudCanvasRevision=revision;}},
   getComposedPanelContext(){return renderer.getContext();},
   compose(){if(disposed)throw Error('Palace live image disposed');if(failed||legacyMode)return null;
    const key=composeCache?[producer.surface.revision,hudRevision,hud?1:0,flash.alpha,flash.color]:null;
    if(key&&outputValid&&composedKey&&composedKey.every((v,i)=>Object.is(v,key[i]))){stats.composeReuses++;return output.texture;}
    outputValid=false;
    uniforms.hud.value=hud?hudTexture:dummy;uniforms.hudOn.value=hud?1:0;uniforms.flashA.value=flash.alpha;
    uniforms.flashRGB.value.set(...(flash.color==='#fff'?[1,1,1]:[115/255,96/255,153/255]));
    try{withRendererState(THREE,renderer,()=>{renderer.autoClear=false;renderer.setRenderTarget(output);renderer.setViewport(0,0,PANEL.width,PANEL.height);renderer.setScissorTest(false);renderer.render(scene,camera);});stats.composites++;composedKey=key;outputValid=!!key;return output.texture;}
    catch(error){failed=true;stats.failures.push({reason:'compose',message:String(error?.message??error)});return null;}
   },
   materializeTo({panelCtx=null,heldCtx=null,reason='boundary'}={}){if(!lastInput)return null;
    const image=boundary.get(producer.surface.revision,reason);stats.boundaryMaterializations++;
    if(heldCtx){heldCtx.save();heldCtx.setTransform(1,0,0,1,0,0);heldCtx.globalAlpha=1;heldCtx.globalCompositeOperation='copy';heldCtx.filter='none';heldCtx.drawImage(image.visible,0,0);heldCtx.restore();}
    if(panelCtx){panelCtx.save();panelCtx.setTransform(1,0,0,1,0,0);panelCtx.globalAlpha=1;panelCtx.globalCompositeOperation='copy';panelCtx.filter='none';panelCtx.drawImage(image.panel,0,0);panelCtx.globalCompositeOperation='source-over';if(flash.alpha>0){panelCtx.globalAlpha=flash.alpha;panelCtx.fillStyle=flash.color;panelCtx.fillRect(PANEL.x,PANEL.y,PANEL.w,PANEL.h);}panelCtx.restore();}
    return image.visible;
   },
   rawCanvas(reason='raw-capture'){return legacy?.canvas??(failed||legacyMode?fallbackImage():this.materializeTo({reason}));},
   warm(){
    palaceBoundary?.warm();
    if(!drawWarm){try{return producer.warm(background,{draw:false});}catch(error){failed=true;stats.failures.push({reason:'warm',message:String(error?.message??error)});return {kind:'legacy-image-fallback-on-first-frame',error:String(error?.message??error)};}}
    if(disposed)throw Error('Palace warm disposed');if(lastInput||producer.surface.revision!==0||stats.producerCalls||stats.composites||legacy)throw Error('Palace image draw warm is boot-only');
    const saved={raw:uniforms.raw.value,hud:uniforms.hud.value,hudOn:uniforms.hudOn.value,flashA:uniforms.flashA.value,flashRGB:uniforms.flashRGB.value,flashCopy:uniforms.flashRGB.value.clone()};let temporary=null,composeAttempted=false;
    try{
     const result=producer.warm(background);if(result?.skipped)return result;
     const bytes=new Uint8Array(304*308*4);for(let i=0;i<bytes.length;i+=4){bytes[i]=180;bytes[i+1]=120;bytes[i+2]=64;bytes[i+3]=128;}
     temporary=new THREE.DataTexture(bytes,304,308,THREE.RGBAFormat,THREE.UnsignedByteType);temporary.needsUpdate=true;temporary.flipY=true;temporary.premultiplyAlpha=false;temporary.colorSpace=THREE.NoColorSpace;temporary.generateMipmaps=false;temporary.minFilter=temporary.magFilter=THREE.LinearFilter;
     composeAttempted=true;withRendererState(THREE,renderer,()=>{renderer.initRenderTarget(output);renderer.initTexture(temporary);renderer.initTexture(dummy);uniforms.raw.value=producer.surface.texture;uniforms.hud.value=temporary;uniforms.hudOn.value=1;uniforms.flashA.value=.125;uniforms.flashRGB.value.set(115/255,96/255,153/255);renderer.autoClear=false;renderer.setRenderTarget(output);renderer.setScissorTest(false);renderer.setViewport(0,0,PANEL.width,PANEL.height);renderer.render(scene,camera);});
     return {...result,imageComposeDraws:1,temporaryHudBytes:bytes.byteLength,imageTargetBytes:PANEL.width*PANEL.height*4};
    }catch(error){return {kind:'palace-draw-warm-incomplete',error:String(error?.message??error),playbackFallbackChanged:false};}
    finally{
     outputValid=false;
     try{if(composeAttempted)withRendererState(THREE,renderer,()=>{renderer.setRenderTarget(output);renderer.setScissorTest(false);renderer.setViewport(0,0,PANEL.width,PANEL.height);renderer.setClearColor(0,1);renderer.clear(true,false,false);});}
     finally{uniforms.raw.value=saved.raw;uniforms.hud.value=saved.hud;uniforms.hudOn.value=saved.hudOn;uniforms.flashA.value=saved.flashA;uniforms.flashRGB.value=saved.flashRGB;saved.flashRGB.copy(saved.flashCopy);temporary?.dispose();}
    }
   },
   diagnostics(){return {...stats,failures:stats.failures.map(f=>({...f,...(f.video?{video:{...f.video}}:{})})),failed,legacyMode,manual,boundary:boundary.stats(),producer:producer.diagnostics(),palaceBoundary:palaceBoundary?.diagnostics()??null,extraContexts:legacy?1:0};},
   dispose(){if(disposed)return;disposed=true;palaceBoundary?.dispose();producer.dispose();legacy?.dispose();output.dispose();material.dispose();geometry.dispose();dummy.dispose();hudTexture?.dispose();for(const image of images)image.close();images.length=0;boundary.clear();rawPanel=rawVisible=null;}
  };
  sentinel.gpuPalaceImage=api;return api;
 }catch(error){palaceBoundary?.dispose();producer?.dispose();for(const image of images)image.close();throw error;}
}
