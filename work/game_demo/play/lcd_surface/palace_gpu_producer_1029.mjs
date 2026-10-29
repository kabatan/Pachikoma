// Main-renderer image producer. No new context, fetch, seek, play,
// model/frame/clock call, or production routing. Caller owns source images/videos.
import {PALACE_FRAGMENT, PALACE_VERTEX} from './palace_gpu_shader_1029.mjs';

export const PANEL = Object.freeze({width:1240,height:1510,x:34,y:28,w:1152,h:1268});

export function withRendererState(THREE, renderer, callback) {
  const state={
    target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace(),level:renderer.getActiveMipmapLevel(),
    viewport:renderer.getViewport(new THREE.Vector4()),scissor:renderer.getScissor(new THREE.Vector4()),
    scissorTest:renderer.getScissorTest(),color:renderer.getClearColor(new THREE.Color()),alpha:renderer.getClearAlpha(),
    autoClear:renderer.autoClear,autoClearColor:renderer.autoClearColor,
    autoClearDepth:renderer.autoClearDepth,autoClearStencil:renderer.autoClearStencil,
  };
  try{return callback();}
  finally{
    renderer.setRenderTarget(state.target,state.face,state.level);
    renderer.setViewport(state.viewport);renderer.setScissor(state.scissor);renderer.setScissorTest(state.scissorTest);
    renderer.setClearColor(state.color,state.alpha);
    for(const key of ['autoClear','autoClearColor','autoClearDepth','autoClearStencil'])renderer[key]=state[key];
  }
}

export function createPalaceGpuProducer({THREE,renderer,centerImages=null}) {
  if(!renderer?.isWebGLRenderer)throw Error('Existing THREE.WebGLRenderer is required');
  if(centerImages&&(!centerImages.F?.width||!centerImages.T?.width||!centerImages.meta?.cell))throw Error('Invalid center images/meta');
  const context=renderer.getContext();
  const resources=[],videoTextures=new Map();let disposed=false,revision=0;
  const stats={renders:0,videoTextures:0,videoUpdateRequests:0,readbacks:0,contextsCreated:0,canvasCopies:0,ownsClock:false,waitFrames:0,initialWaitFrames:0,recoveredWaits:0,waiting:false,waitReasonCounts:{},lastWait:[],lastVideoStates:[]};
  const own=x=>(resources.push(x),x);
  const configure=(texture,flipY)=>{
    texture.colorSpace=THREE.NoColorSpace;texture.minFilter=texture.magFilter=THREE.LinearFilter;
    texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;texture.generateMipmaps=false;
    texture.flipY=flipY;texture.premultiplyAlpha=false;texture.unpackAlignment=4;
    return texture;
  };
  const placeholder=configure(own(new THREE.DataTexture(new Uint8Array([0,0,0,255]),1,1,THREE.RGBAFormat,THREE.UnsignedByteType)),false);
  placeholder.needsUpdate=true;
  const imageTexture=image=>{const t=configure(own(new THREE.Texture(image)),false);t.needsUpdate=true;return t;};
  const centerF=centerImages?imageTexture(centerImages.F):placeholder;
  const centerT=centerImages?imageTexture(centerImages.T):placeholder;
  const uniforms={
    bg:{value:placeholder},fg:{value:placeholder},old:{value:placeholder},cF:{value:centerF},cT:{value:centerT},
    mixOld:{value:0},bgOn:{value:1},cOn:{value:0},cDst:{value:new THREE.Vector2()},cScale:{value:1},
    cGain:{value:1},cCell:{value:new THREE.Vector4()},cSmear:{value:0},cAtlas:{value:new THREE.Vector2(1,1)},
    cSize:{value:new THREE.Vector2(1,1)},cResid:{value:0},cLevelStride:{value:0},
  };
  if(centerImages){
    uniforms.cAtlas.value.set(centerImages.F.width,centerImages.F.height);
    uniforms.cSize.value.set(...centerImages.meta.cell);
  }
  const target=own(new THREE.WebGLRenderTarget(PANEL.width,PANEL.height,{
    format:THREE.RGBAFormat,type:THREE.UnsignedByteType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,
    generateMipmaps:false,depthBuffer:false,stencilBuffer:false,samples:0,colorSpace:THREE.NoColorSpace,
  }));
  target.texture.name='palace-injected-native-panel';target.texture.generateMipmaps=false;target.texture.flipY=false;
  const material=own(new THREE.ShaderMaterial({uniforms,vertexShader:PALACE_VERTEX,fragmentShader:PALACE_FRAGMENT,
    depthTest:false,depthWrite:false,blending:THREE.NoBlending,transparent:false,toneMapped:false,dithering:false}));
  const geometry=own(new THREE.PlaneGeometry(2,2));
  const scene=new THREE.Scene(),camera=new THREE.Camera(),mesh=new THREE.Mesh(geometry,material);
  mesh.frustumCulled=false;scene.add(mesh);
  const surface=Object.freeze({type:'lcd-gpu-surface',texture:target.texture,target,width:PANEL.width,height:PANEL.height,
    visible:Object.freeze({x:PANEL.x,y:PANEL.y,w:PANEL.w,h:PANEL.h}),encoding:'srgb',opaque:true,
    owner:'jp-layered-snapshot',context,get revision(){return revision;},storageOrigin:'bottom-left'});
  function assertLive(){if(disposed)throw Error('Palace snapshot backend disposed');}
  function videoState(v,width,role){
    const state={role,width:v?.videoWidth??0,height:v?.videoHeight??0,expectedWidth:width,expectedHeight:PANEL.h,
      src:v?.currentSrc??'',requestedSrc:v?.src??'',readyState:v?.readyState??0,seeking:!!v?.seeking};
    if(!v||v.error){state.state='invalid';state.reason=!v?'missing-video':'media-error';}
    else if(v.readyState<2||v.seeking||!v.videoWidth||!v.videoHeight){
      state.state='waiting';state.reason=v.readyState<2?'ready-state':v.seeking?'seeking':'dimensions-pending';
    }else if(v.videoWidth!==width||v.videoHeight!==PANEL.h){state.state='invalid';state.reason='native-dimensions';}
    else{state.state='ready';state.reason=null;}
    return state;
  }
  function videoTexture(video,key){
    let entry=videoTextures.get(video);
    if(!entry){
      if(videoTextures.size>=3)throw Error('Snapshot backend is limited to background/current/previous (3 videos)');
      const texture=configure(own(new THREE.VideoTexture(video)),true);
      entry={texture,key:null};videoTextures.set(video,entry);stats.videoTextures++;
    }
    // Explicit paused-seek upload; never change the video or its presentation clock.
    const frameKey=key??'native-rVFC';
    if(entry.key!==frameKey){entry.texture.needsUpdate=true;entry.key=frameKey;stats.videoUpdateRequests++;}
    return entry.texture;
  }
  function setCenter(c){
    uniforms.cOn.value=c?1:0;if(!c)return;
    if(!centerImages)throw Error('Center state requires original center F/T images');
    const m=centerImages.meta,[w,h]=m.cell,xy=i=>[(i%m.cols)*w,Math.floor(i/m.cols)*h];
    const a=xy(c.cell),b=xy(c.cell+m.steps*7);
    uniforms.cDst.value.set(c.x,c.y);uniforms.cScale.value=c.scale;uniforms.cGain.value=c.gain;
    uniforms.cCell.value.set(a[0],a[1],b[0],b[1]);uniforms.cSmear.value=c.smear;uniforms.cResid.value=c.resid;
  }
  return {
    surface,
    warm(background,{draw=true}={}){
      if(!draw){assertLive();renderer.initTexture(videoTexture(background,'startup'));renderer.initTexture(centerF);renderer.initTexture(centerT);renderer.initRenderTarget(target);renderer.compile(scene,camera);return {kind:'injected-palace-shaders-atlases-bg',extraContexts:0};}
      assertLive();if(revision!==0||stats.renders!==0)throw Error('Palace draw warm requires unused producer');
      if(renderer.getRenderTarget()!==null)throw Error('Palace draw warm requires default-target boundary');
      const state=videoState(background,PANEL.w,'background');if(state.state!=='ready')return {skipped:true,reason:'background-not-ready',state};
      const temporary=configure(new THREE.DataTexture(new Uint8Array([32,24,16,255,224,208,192,255]),2,1,THREE.RGBAFormat,THREE.UnsignedByteType),false);temporary.needsUpdate=true;
      // Preserve all references and vector contents. Existing warm's retained bg
      // VideoTexture/cache is intentional; synthetic foreground never enters it.
      const saved=Object.fromEntries(Object.entries(uniforms).map(([key,u])=>[key,{value:u.value,copy:u.value?.isVector2||u.value?.isVector3||u.value?.isVector4?u.value.clone():null}]));
      let draws=0;try{return withRendererState(THREE,renderer,()=>{
        renderer.initTexture(videoTexture(background,'startup'));renderer.initTexture(centerF);renderer.initTexture(centerT);renderer.initRenderTarget(target);renderer.initTexture(temporary);renderer.compile(scene,camera);
        uniforms.bg.value=videoTextures.get(background).texture;uniforms.fg.value=temporary;uniforms.old.value=temporary;
        uniforms.mixOld.value=.37;uniforms.bgOn.value=1;
        if(centerImages)setCenter({cell:0,x:PANEL.w/2,y:PANEL.h/2,scale:1,gain:1,smear:.2,resid:0});else uniforms.cOn.value=0;
        renderer.autoClear=false;renderer.setRenderTarget(target);renderer.setScissorTest(false);renderer.setClearColor(0,1);renderer.setViewport(0,0,PANEL.width,PANEL.height);renderer.clear(true,false,false);
        renderer.setViewport(PANEL.x,PANEL.height-PANEL.y-PANEL.h,PANEL.w,PANEL.h);renderer.render(scene,camera);draws++;
        return {kind:'injected-palace-actual-draw-warm',extraContexts:0,draws,temporaryPackedBytes:8,sourceVideoUploads:'existing background init only; real packed VideoTexture remains cold'};
      });}finally{
        try{withRendererState(THREE,renderer,()=>{renderer.setRenderTarget(target);renderer.setScissorTest(false);renderer.setViewport(0,0,PANEL.width,PANEL.height);renderer.setClearColor(0,1);renderer.clear(true,false,false);});}
        finally{for(const[key,old]of Object.entries(saved)){uniforms[key].value=old.value;if(old.copy)old.value.copy(old.copy);}temporary.dispose();}
      }
    },
    render({background,current,previous=null,mixOld=0,center=null,blackBg=false,sourceFrameKeys={}}){
      assertLive();
      // Snapshot v1 runs between main frames, never inside a caller's FBO pass.
      // Three getViewport/getScissor expose logical default state, not all active
      // FBO overrides. Restricting the seam avoids an ambiguous partial restore.
      if(renderer.getRenderTarget()!==null)throw Error('Snapshot render requires a default-target frame boundary');
      const states=[videoState(background,PANEL.w,'background'),videoState(current,PANEL.w*2,'current')];
      if(previous)states.push(videoState(previous,PANEL.w*2,'previous'));
      stats.lastVideoStates=states;
      const invalid=states.find(s=>s.state==='invalid');
      if(invalid){const error=Error('Palace '+invalid.role+' '+invalid.reason);error.palaceVideoState={...invalid};throw error;}
      const waiting=states.filter(s=>s.state==='waiting');
      if(waiting.length){
        // Pool reuse/loop seeks can temporarily lower readyState after loadeddata.
        // Keep the last complete panel; never allocate the legacy compositor for
        // an expected wait. No valid output yet means the owner keeps its held image.
        stats.waitFrames++;if(!revision)stats.initialWaitFrames++;stats.waiting=true;stats.lastWait=waiting;
        for(const s of waiting){const key=s.role+':'+s.reason;stats.waitReasonCounts[key]=(stats.waitReasonCounts[key]??0)+1;}
        return revision?surface:null;
      }
      if(stats.waiting)stats.recoveredWaits++;stats.waiting=false;
      if(!Number.isFinite(mixOld)||mixOld<0||mixOld>1)throw Error('mixOld must be in [0,1]');
      // The live pool rotates decoder elements. Retain only this frame's at-most
      // three sources, and release VideoTexture callbacks for inactive elements.
      const required=new Set([background,current,previous].filter(Boolean));
      for(const [video,entry] of videoTextures)if(!required.has(video)){
        entry.texture.dispose();videoTextures.delete(video);
        const i=resources.indexOf(entry.texture);if(i>=0)resources.splice(i,1);
      }
      setCenter(center);
      uniforms.bg.value=videoTexture(background,sourceFrameKeys.background);
      uniforms.fg.value=videoTexture(current,sourceFrameKeys.current);
      uniforms.old.value=previous?videoTexture(previous,sourceFrameKeys.previous):placeholder;
      uniforms.mixOld.value=previous?mixOld:0;uniforms.bgOn.value=blackBg?0:1;
      withRendererState(THREE,renderer,()=>{
        renderer.autoClear=false;renderer.setRenderTarget(target);renderer.setScissorTest(false);
        renderer.setViewport(0,0,PANEL.width,PANEL.height);renderer.setClearColor(0,1);renderer.clear(true,false,false);
        // GL origin is bottom-left. Preserve original top-left visible offset.
        renderer.setViewport(PANEL.x,PANEL.height-PANEL.y-PANEL.h,PANEL.w,PANEL.h);
        renderer.render(scene,camera);
      });
      revision++;stats.renders++;return surface;
    },
    // Temporary sampler selection for same-instant main screenshot only.
    // Does not replace plate.tex or alter geometry/M3 uniforms/legacy CanvasTexture.
    withPlateSampler(plate,callback){
      assertLive();if(typeof callback!=='function'||!plate?.mat?.uniforms?.uT)throw Error('plate sampler/callback required');
      const uniform=plate.mat.uniforms.uT,old=uniform.value;uniform.value=target.texture;
      try{return callback(surface);}finally{uniform.value=old;}
    },
    readPixels({visibleOnly=false}={}){
      assertLive();if(renderer.getRenderTarget()!==null)throw Error('Snapshot readback requires a default-target frame boundary');
      const x=visibleOnly?PANEL.x:0,y=visibleOnly?PANEL.height-PANEL.y-PANEL.h:0;
      const w=visibleOnly?PANEL.w:PANEL.width,h=visibleOnly?PANEL.h:PANEL.height,bytes=new Uint8Array(w*h*4);
      withRendererState(THREE,renderer,()=>renderer.readRenderTargetPixels(target,x,y,w,h,bytes));stats.readbacks++;
      return {bytes,width:w,height:h,format:'RGBA8',origin:'bottom-left'};
    },
    diagnostics(){return {...stats,waitReasonCounts:{...stats.waitReasonCounts},lastWait:stats.lastWait.map(s=>({...s})),lastVideoStates:stats.lastVideoStates.map(s=>({...s})),disposed,revision,targetBytes:PANEL.width*PANEL.height*4,videoReferences:[...videoTextures.keys()]};},
    dispose(){if(disposed)return;disposed=true;for(const resource of resources)resource.dispose();resources.length=0;videoTextures.clear();},
  };
}
