// Palace -> plain/result seam. Images only: the JP owner retains every clock,
// decoder, event, source choice and both original 0.12-second fade envelopes.
import {withRendererState,PANEL} from './palace_gpu_producer_1029.mjs';
const VERTEX='out vec2 q;void main(){q=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}';
const BODY=`in vec2 q;out vec4 color;uniform sampler2D sourceTex,palaceTex,previousTex;
uniform float nativeVideo,innerAlpha,outerAlpha,dim,flashA,rawOnly;
uniform vec3 flashRGB;
vec3 q8(vec3 c){return floor(clamp(c,0.,1.)*255.+.5)/255.;}
void main(){
 vec2 p=vec2(q.x*1240.,(1.-q.y)*1510.),s=(p-vec2(34.,28.))/vec2(1152.,1268.);
 bool inside=all(greaterThanEqual(s,vec2(0.)))&&all(lessThan(s,vec2(1.)));
 vec3 c=vec3(0.);
 if(inside){
  c=nativeVideo>.5?texelFetch(sourceTex,ivec2(gl_FragCoord.xy)-ivec2(34,214),0).rgb:texelFetch(sourceTex,ivec2(gl_FragCoord.xy),0).rgb;
  if(innerAlpha>0.)c=q8(mix(c,texelFetch(palaceTex,ivec2(gl_FragCoord.xy),0).rgb,innerAlpha));
  if(rawOnly<.5){
   if(dim>.5){float l=dot(c,vec3(.213,.715,.072));c=q8(.5*(.6*c+.4*l));}
   c=q8(mix(c,flashRGB,flashA));
  }
 }
 if(rawOnly<.5&&outerAlpha>0.)c=q8(mix(c,texelFetch(previousTex,ivec2(gl_FragCoord.xy),0).rgb,outerAlpha));
 color=vec4(c,1.);
}`;
const COPY='in vec2 q;out vec4 color;uniform sampler2D sourceTex;void main(){color=texelFetch(sourceTex,ivec2(gl_FragCoord.xy),0);}';
const HUD=`in vec2 q;out vec4 color;uniform sampler2D sourceTex,hud;uniform float hudOn;void main(){
 vec3 c=texelFetch(sourceTex,ivec2(gl_FragCoord.xy),0).rgb;vec2 p=vec2(q.x*1240.,(1.-q.y)*1510.),h=(p-vec2(690.,130.))/vec2(496.,410.);
 if(hudOn>.5&&all(greaterThanEqual(h,vec2(0.)))&&all(lessThan(h,vec2(1.)))){vec4 t=texelFetch(hud,ivec2(gl_FragCoord.xy)-ivec2(690,970),0);c=t.rgb+c*(1.-t.a);}
 color=vec4(c,1.);
}`;

export function createPalaceBoundaryImage({THREE:T,renderer:r,palaceSurface}){
 if(!r?.isWebGLRenderer||palaceSurface.context!==r.getContext())throw Error('Palace boundary requires its existing main context');
 const context=r.getContext(),owned=[],videos=new Map();let disposed=false,warmed=false,bridge=false,alpha=0,stage=null,hud=null,hudTexture=null,hudCanvas=null,valid=false,revision=0,published=false;
 const stats={kind:'palace_boundary',captures:0,rebridges:0,releases:0,frames:0,composites:0,rawReads:0,panelReads:0,fallbacks:[],videoTextures:0,failures:[]};
 const own=x=>(owned.push(x),x);
 const configure=(t,flip)=>{t.flipY=flip;t.colorSpace=T.NoColorSpace;t.premultiplyAlpha=false;t.generateMipmaps=false;t.minFilter=t.magFilter=T.LinearFilter;return t;};
 const target=name=>{const t=own(new T.WebGLRenderTarget(PANEL.width,PANEL.height,{format:T.RGBAFormat,type:T.UnsignedByteType,minFilter:T.LinearFilter,magFilter:T.LinearFilter,generateMipmaps:false,depthBuffer:false,stencilBuffer:false,samples:0,colorSpace:T.NoColorSpace}));configure(t.texture,false);t.texture.name=name;return t;};
 const previous=target('palace-boundary-previous'),clean=target('palace-boundary-clean'),output=target('palace-boundary-hud');
 const dummy=configure(own(new T.DataTexture(new Uint8Array([0,0,0,255]),1,1,T.RGBAFormat)),false);dummy.needsUpdate=true;
 const geometry=own(new T.PlaneGeometry(2,2)),camera=new T.Camera();
 const make=(fragment,uniforms)=>{const material=own(new T.ShaderMaterial({glslVersion:T.GLSL3,vertexShader:VERTEX,fragmentShader:fragment,uniforms,depthTest:false,depthWrite:false,blending:T.NoBlending,toneMapped:false,dithering:false})),scene=new T.Scene(),mesh=new T.Mesh(geometry,material);mesh.frustumCulled=false;scene.add(mesh);return scene;};
 const U={sourceTex:{value:dummy},palaceTex:{value:palaceSurface.texture},previousTex:{value:previous.texture},nativeVideo:{value:0},innerAlpha:{value:0},outerAlpha:{value:0},dim:{value:0},flashA:{value:0},flashRGB:{value:new T.Vector3()},rawOnly:{value:0}};
 const C={sourceTex:{value:dummy}},H={sourceTex:{value:clean.texture},hud:{value:dummy},hudOn:{value:0}};
 const bodyScene=make(BODY,U),copyScene=make(COPY,C),hudScene=make(HUD,H);
 function check(){if(disposed)throw Error('Palace boundary disposed');if(r.getRenderTarget()!==null)throw Error('Palace boundary requires default-target seam');}
 function draw(scene,t){r.autoClear=false;r.setRenderTarget(t);r.setViewport(0,0,PANEL.width,PANEL.height);r.setScissorTest(false);r.render(scene,camera);}
 function copy(texture,t){C.sourceTex.value=texture;draw(copyScene,t);}
 function videoTexture(v,manual){let t=videos.get(v);if(!t){t=configure(new T.VideoTexture(v),true);videos.set(v,t);stats.videoTextures++;}if(manual)t.needsUpdate=true;return t;}
 function trimVideo(keep){for(const[v,t]of videos)if(v!==keep){t.dispose();videos.delete(v);}}
 function values(){
  if(!stage)return false;
  let texture;
  if(stage.kind==='backend'){stage.backend.setHudCanvas(null);texture=stage.backend.compose();if(!texture)return false;}
  else texture=stage.kind==='video'?videoTexture(stage.video,stage.manual):palaceSurface.texture;
  U.sourceTex.value=texture;U.nativeVideo.value=stage.kind==='video'?1:0;U.innerAlpha.value=stage.innerAlpha??0;U.outerAlpha.value=bridge?alpha:0;
  U.dim.value=stage.dim?1:0;U.flashA.value=Math.max(0,Math.min(1,stage.flash||0));U.flashRGB.value.set(...(stage.flashColor==='hit'?[1,1,1]:[115/255,96/255,153/255]));U.rawOnly.value=0;
  return true;
 }
 function read(t,kind){const bytes=new Uint8Array(PANEL.width*PANEL.height*4);withRendererState(T,r,()=>r.readRenderTargetPixels(t,0,0,PANEL.width,PANEL.height,bytes));stats[kind]++;const top=new Uint8ClampedArray(bytes.length),row=PANEL.width*4;for(let y=0;y<PANEL.height;y++)top.set(bytes.subarray((PANEL.height-1-y)*row,(PANEL.height-y)*row),y*row);const c=document.createElement('canvas');c.width=PANEL.width;c.height=PANEL.height;c.getContext('2d',{alpha:false}).putImageData(new ImageData(top,PANEL.width,PANEL.height),0,0);return c;}
 const copyCtx=(ctx,c,raw=false)=>{if(!ctx)return;ctx.save();try{ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='copy';ctx.filter='none';if(raw)ctx.drawImage(c,PANEL.x,PANEL.y,PANEL.w,PANEL.h,0,0,PANEL.w,PANEL.h);else ctx.drawImage(c,0,0);}finally{ctx.restore();}};
 const api={
  get active(){return bridge;},get ownsFrame(){return !!stage;},get published(){return published;},set published(v){published=!!v;},
  warm(){check();if(warmed)return;withRendererState(T,r,()=>{r.initTexture(dummy);for(const t of [previous,clean,output]){r.initRenderTarget(t);copy(dummy,t);}U.palaceTex.value=dummy;draw(bodyScene,clean);draw(hudScene,output);U.palaceTex.value=palaceSurface.texture;});warmed=true;},
  begin(backend){check();if(!warmed)return false;let texture;
   if(backend===api){if(!valid)return false;texture=clean.texture;}
   else{if(backend?.getComposedPanelContext?.()!==context)return false;backend.setHudCanvas(null);texture=backend.compose();if(!texture)return false;}
   withRendererState(T,r,()=>copy(texture,previous));if(bridge)stats.rebridges++;bridge=true;alpha=1;stats.captures++;return true;
  },
  setFrame(descriptor){check();stage=descriptor;trimVideo(descriptor.kind==='video'?descriptor.video:null);valid=false;published=false;stats.frames++;return api;},
  setAlpha(value){if(!bridge)return false;alpha=Math.max(0,Math.min(1,value));if(alpha===0){bridge=false;stats.releases++;}return true;},
  abandon(){if(bridge)stats.releases++;bridge=false;alpha=0;stage=null;valid=false;published=false;trimVideo(null);},
  setHudCanvas(value){hud=value;if(value){if(hudCanvas!==value){hudTexture?.dispose();hudCanvas=value;hudTexture=configure(new T.CanvasTexture(value),true);hudTexture.premultiplyAlpha=true;}hudTexture.needsUpdate=true;}},
  getComposedPanelContext:()=>context,
  compose(){check();if(!values())return null;withRendererState(T,r,()=>{draw(bodyScene,clean);H.hud.value=hud?hudTexture:dummy;H.hudOn.value=hud?1:0;draw(hudScene,output);});valid=true;revision++;stats.composites++;return output.texture;},
  materializeTo({panelCtx=null,heldCtx=null,previousCtx=null,reason='palace-boundary-fallback'}={}){check();if(!stage)return null;stats.fallbacks.push(reason);let rawCanvas=null;
   if(previousCtx&&bridge)copyCtx(previousCtx,read(previous,'panelReads'));
   if(heldCtx&&stage.kind==='backend'){stage.backend.materializeTo({heldCtx,reason:reason+'-raw'});heldCtx=null;}
   if(heldCtx){if(!values())return null;withRendererState(T,r,()=>{U.rawOnly.value=1;draw(bodyScene,output);U.rawOnly.value=0;});rawCanvas=read(output,'rawReads');copyCtx(heldCtx,rawCanvas,true);}
   if(!valid&&!this.compose())return null;const panel=panelCtx?read(clean,'panelReads'):null;copyCtx(panelCtx,panel);if(heldCtx&&hud)this.compose();return rawCanvas??panel;
  },
  diagnostics:()=>({...stats,fallbacks:[...stats.fallbacks],failures:[...stats.failures],warmed,disposed,active:bridge,alpha,ownsFrame:!!stage,stage:stage?.kind??null,revision,valid,published,liveVideos:videos.size,targetBytes:3*PANEL.width*PANEL.height*4,extraContexts:0,extraDecoders:0}),
  dispose(){if(disposed)return;api.abandon();disposed=true;hudTexture?.dispose();for(const x of owned)x.dispose();}
 };
 return api;
}
