import {warmPausedVideo} from './startup_warm.mjs';
// v2: v1 + 中図柄の別部品(center_atlas)を、背景と前面の間に重ねる。final = F + T*(Fc + Tc*B)
// One palace decoder/clock shared by first-JP and continuation foregrounds.
// Scene changes and foreground loop seeks never seek/reload this video.
export async function createSharedPalace({base,config,onError=()=>{},center=null,imageFactory=null}){
 const video=document.createElement('video');video.muted=true;video.playsInline=true;video.loop=true;video.preload='auto';
 let startupWarmMute=false,warmBusy=false;const errors=[],events=[],audit=[];let clock=0,loops=0,lastAudit=-1,manual=false,presentedTime=0,lastPresented=0,visible=false,segment=0;
 // Presentation callbacks are needed only while the palace is visible. The
 // video itself keeps playing on its original media clock, including while hidden.
 let lazyPresentation=false,presentationId=null,presentationActive=false,lastMedia=0,presentationCallbacks=0;
 const schedulePresentation=()=>{if(presentationActive&&presentationId===null)presentationId=video.requestVideoFrameCallback(presented);};
 const presented=(wall,m)=>{presentationId=null;if(!presentationActive)return;presentationCallbacks++;if(!startupWarmMute){if(!lazyPresentation&&!manual&&m.mediaTime<lastPresented-.2)loops++;lastPresented=m.mediaTime;presentedTime=m.mediaTime;}schedulePresentation();};
 const startPresentation=()=>{presentationActive=true;schedulePresentation();};
 const stopPresentation=()=>{presentationActive=false;if(presentationId!==null)video.cancelVideoFrameCallback(presentationId);presentationId=null;};
 const trackMediaLoop=()=>{if(lazyPresentation&&!manual&&!startupWarmMute){const t=video.currentTime;if(t<lastMedia-.2)loops++;lastMedia=t;}};
 video.addEventListener('timeupdate',trackMediaLoop);
 startPresentation();
 for(const kind of ['waiting','stalled','error','playing','ended'])video.addEventListener(kind,()=>{if(startupWarmMute)return;events.push({kind,wall:performance.now(),time:video.currentTime});if(kind==='error'){errors.push('palace video');onError('palace video');}});
 const ready=new Promise((resolve,reject)=>{video.addEventListener('loadeddata',resolve,{once:true});video.addEventListener('error',()=>reject(Error('palace decode')),{once:true});});
 video.src=new URL(config.file,base).href;video.load();await ready;
 // Optional candidate image producer; original video/time/event owner remains here.
 if(imageFactory&&!new URLSearchParams(location.search).has('jpaudit')){
  let image;try{image=await imageFactory({background:video,base,center});}catch(error){console.warn('[palace-injection] original image path fallback',error);}
  if(image){lazyPresentation=new URLSearchParams(location.search).get('palaceidle')!=='0';return {video,audit,events,errors,
   get canvas(){return image.rawCanvas('palace-canvas-consumer');},get imageBackend(){return image;},
   warm(){return image.warm();},
   advance(dt){startupWarmMute=false;trackMediaLoop();clock+=dt;if(!manual&&video.paused)video.play().catch(e=>{onError(e.message);});},
   hidden(){visible=false;if(lazyPresentation){stopPresentation();image.hidden?.();}},
   render(current,previous,alpha,scene,frame,centerState=null,blackBg=false){if(lazyPresentation){if(blackBg)stopPresentation();else startPresentation();}if(!visible){segment++;visible=true;}return image.render({current,previous,mixOld:previous?alpha:0,center:centerState,blackBg});},
   setManual(on){manual=!!on;lastMedia=video.currentTime;image.setManual(on);if(manual)video.pause();},
   async prepare(dt){if(!manual)return;const target=(clock+dt)%12;if(Math.abs(video.currentTime-target)<1e-4)return;await new Promise(resolve=>{video.addEventListener('seeked',resolve,{once:true});video.currentTime=target;});},
   diagnostics(){return {kind:'continuous_palace_injected',idleUpdates:lazyPresentation,presentationActive,presentationCallbacks,time:video.currentTime,clock,loops,visible,segment,presentedTime,ready:video.readyState,src:video.currentSrc,errors:[...errors],image:image.diagnostics()};},
   dispose(){stopPresentation();video.removeEventListener('timeupdate',trackMediaLoop);image.dispose();video.pause();video.removeAttribute('src');video.load();}
  };}
 }
 const cameras=await(await fetch(new URL(config.camera,base))).json();
 const canvas=document.createElement('canvas');canvas.width=1152;canvas.height=1268;canvas.readyState=4;
 const gl=canvas.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});if(!gl)throw Error('palace compositor WebGL unavailable');
 const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
 const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec2 p;varying vec2 uv;void main(){uv=(p+1.)*.5;gl_Position=vec4(p,0.,1.);}'));
 gl.attachShader(program,shader(gl.FRAGMENT_SHADER,`precision highp float;varying vec2 uv;uniform sampler2D bg;uniform sampler2D fg;uniform sampler2D old;uniform sampler2D cF;uniform sampler2D cT;uniform float mixOld;
 uniform float cOn;uniform vec2 cDst;uniform float cScale;uniform float cGain;uniform vec4 cCell;uniform float cSmear;uniform vec2 cAtlas;uniform vec2 cSize;uniform float cResid;uniform float cLevelStride;uniform float bgOn;
 vec3 linear(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
 vec3 srgb(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),c));}
 void centerLayer(vec2 px,vec4 cell,out vec3 F,out float T){
  vec2 r=(px-cDst)/cScale+cSize*.5-vec2(0.,cResid);F=vec3(0.);T=1.;
  if(r.x<0.5||r.y<0.5||r.x>cSize.x-.5||r.y>cSize.y-.5)return;
  vec2 q=(cell.xy+r)/cAtlas;vec3 f0=linear(texture2D(cF,q).rgb);float t0=texture2D(cT,q).r;
  vec2 q1=(cell.zw+r)/cAtlas;vec3 f1=linear(texture2D(cF,q1).rgb);float t1=texture2D(cT,q1).r;
  F=mix(f0,f1,cSmear)*cGain;T=mix(t0,t1,cSmear);}
 void main(){vec2 c=vec2(uv.x*.5,uv.y),m=vec2(.5+uv.x*.5,uv.y);vec3 a=linear(texture2D(fg,c).rgb),t=texture2D(fg,m).rgb;
 if(mixOld>0.){a=mix(a,linear(texture2D(old,c).rgb),mixOld);t=mix(t,texture2D(old,m).rgb,mixOld);}
 vec3 b=linear(texture2D(bg,uv).rgb)*bgOn;
 if(cOn>0.){vec3 F;float T;centerLayer(vec2(uv.x*1152.,(1.-uv.y)*1268.),cCell,F,T);b=F+T*b;}
 gl_FragColor=vec4(clamp(srgb(a+t*b),0.,1.),1.);}`));
 gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
 const locations=Object.fromEntries(['bg','fg','old','cF','cT','mixOld','bgOn','cOn','cDst','cScale','cGain','cCell','cSmear','cAtlas','cSize','cResid'].map(n=>[n,gl.getUniformLocation(program,n)])),U=n=>locations[n];
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
 const at=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,2,gl.FLOAT,false,0,0);
 const textures=['bg','fg','old','cF','cT'].map((name,i)=>{gl.activeTexture(gl.TEXTURE0+i);const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);for(const k of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,k,gl.CLAMP_TO_EDGE);for(const k of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,k,gl.LINEAR);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,1,1,0,gl.RGB,gl.UNSIGNED_BYTE,new Uint8Array(3));gl.uniform1i(U(name),i);return t;});
 // Keep a native decoder frame in its texture until a new frame is presented.
 // No downsampling, skipped effect frames or reduced canvas size.
 const tracked=new Map(),uploaded=[];let uploads=0,uploadSkips=0;
 const frameKey=v=>{if(manual)return v.currentTime;let t=tracked.get(v);if(!t){t={frame:0,id:null};tracked.set(v,t);const tick=(_wall,m)=>{t.frame=m.presentedFrames;t.id=v.requestVideoFrameCallback(tick);};t.id=v.requestVideoFrameCallback(tick);}return v.currentSrc+"|"+t.frame;};
 const upload=(i,v)=>{const key=frameKey(v);if(uploaded[i]?.v===v&&uploaded[i]?.key===key){uploadSkips++;return;}uploaded[i]={v,key};uploads++;gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,textures[i]);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,v);};
 const thumbnail=document.createElement('canvas');thumbnail.width=144;thumbnail.height=158;const probe=thumbnail.getContext('2d',{willReadFrequently:true});
 const enabled=new URLSearchParams(location.search).has('jpaudit');
 const sample=(scene,foregroundFrame)=>{
  const f=Math.min(359,Math.round(presentedTime*30)),key=segment*1000000+loops*360+f;if(key===lastAudit)return;lastAudit=key;
  if(!enabled)return;
  probe.drawImage(video,0,0,144,158);const data=probe.getImageData(0,0,144,158).data;let sum=0;for(let i=0;i<data.length;i+=4)sum+=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];
  audit.push({wall:performance.now(),scene,foregroundFrame,clock,mediaTime:presentedTime,decoderTime:video.currentTime,loop:loops,segment,f,camera:cameras[f],luminance:sum/(144*158),thumbnail:thumbnail.toDataURL('image/jpeg',.85)});
 };
 let atlas=null;
 if(center){const [fi,ti]=await Promise.all([center.F,center.T].map(async u=>{const r=await fetch(new URL(u,base));if(!r.ok)throw Error('center atlas HTTP '+r.status);return createImageBitmap(await r.blob(),{premultiplyAlpha:'none',colorSpaceConversion:'none'});}));
  for(const [i,img] of [[3,fi],[4,ti]]){gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,textures[i]);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);}
  atlas=center.meta;gl.uniform2f(U('cAtlas'),fi.width,fi.height);gl.uniform2f(U('cSize'),atlas.cell[0],atlas.cell[1]);fi.close();ti.close();}
 const setCenter=c=>{if(!atlas||!c){gl.uniform1f(U('cOn'),0);return;}const[w,h]=atlas.cell,cols=atlas.cols,cellXY=i=>[(i%cols)*w,Math.floor(i/cols)*h];const a=cellXY(c.cell),b=cellXY(c.cell+atlas.steps*7);gl.uniform1f(U('cOn'),1);gl.uniform2f(U('cDst'),c.x,c.y);gl.uniform1f(U('cScale'),c.scale);gl.uniform1f(U('cGain'),c.gain);gl.uniform4f(U('cCell'),a[0],a[1],b[0],b[1]);gl.uniform1f(U('cSmear'),c.smear);gl.uniform1f(U('cResid'),c.resid);};
 return {canvas,video,audit,events,errors,
  async warm(){
   if(warmBusy||clock!==0||segment!==0||visible||uploads!==0||!video.paused||video.currentTime!==0)throw Error('palace warm is boot-only');
   warmBusy=true;startupWarmMute=true;
   const active=gl.getParameter(gl.ACTIVE_TEXTURE),flip=gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL),clear=gl.getParameter(gl.COLOR_CLEAR_VALUE);
   const bindings=textures.map((_,i)=>{gl.activeTexture(gl.TEXTURE0+i);return gl.getParameter(gl.TEXTURE_BINDING_2D);});
   const oldOn=gl.getUniform(program,U('cOn')),oldMix=gl.getUniform(program,U('mixOld'));
   try{return await warmPausedVideo(video,v=>{
     gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,textures[0]);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
     gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,v);
     gl.uniform1f(U('cOn'),0);gl.uniform1f(U('mixOld'),0);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);gl.finish();
   });}finally{
     // Keep actual bg storage in this existing texture; first real render must reupload.
     uploaded.length=0;
     gl.uniform1f(U('cOn'),oldOn);gl.uniform1f(U('mixOld'),oldMix);
     gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.clearColor(...clear);
     for(let i=0;i<bindings.length;i++){gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,bindings[i]);}
     gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,flip);gl.activeTexture(active);warmBusy=false;
     // Keep native callbacks muted until actual gameplay advance; no audit/event/clock change.
   }
  },
  advance(dt){startupWarmMute=false;clock+=dt;if(!manual&&video.paused)video.play().catch(e=>{onError(e.message);});},
  hidden(){visible=false;},
  render(current,previous,alpha,scene,frame,centerState=null,blackBg=false){gl.uniform1f(U('bgOn'),blackBg?0:1);setCenter(centerState);if(!visible){segment++;visible=true;}upload(0,video);upload(1,current);if(previous)upload(2,previous);gl.uniform1f(U('mixOld'),previous?alpha:0);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);sample(scene,frame);return canvas;},
  setManual(on){manual=!!on;if(manual)video.pause();},
  async prepare(dt){if(!manual)return;const target=(clock+dt)%12;if(Math.abs(video.currentTime-target)<1e-4)return;await new Promise(resolve=>{video.addEventListener('seeked',resolve,{once:true});video.currentTime=target;});},
  diagnostics(){return {uploads,uploadSkips,presentedTime,videoQuality:(()=>{const q=video.getVideoPlaybackQuality?.();return q?{totalVideoFrames:q.totalVideoFrames,droppedVideoFrames:q.droppedVideoFrames}:null;})(),kind:'continuous_palace',time:video.currentTime,clock,loops,visible,segment,ready:video.readyState,src:video.currentSrc,errors:[...errors]};},
  dispose(){for(const [v,t] of tracked)v.cancelVideoFrameCallback(t.id);tracked.clear();video.pause();video.removeAttribute('src');video.load();for(const t of textures)gl.deleteTexture(t);gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();},
 };
}
