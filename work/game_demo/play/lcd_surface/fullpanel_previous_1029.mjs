// PERF ONLY. Independent completed fullpanel leases; never a raw-held/video seed.
const W=1240,H=1510;
export const PREVIOUS_VERTEX='varying vec2 q;void main(){q=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}';
export const PREVIOUS_FRAGMENT='varying vec2 q;uniform sampler2D current,previous,hud;uniform float alpha,hudOn;void main(){vec3 c=mix(texture2D(current,q).rgb,texture2D(previous,q).rgb,alpha);vec2 p=vec2(q.x*1240.,(1.-q.y)*1510.),h=(p-vec2(866.,156.))/vec2(304.,308.);if(hudOn>.5&&all(greaterThanEqual(h,vec2(0.)))&&all(lessThan(h,vec2(1.)))){vec4 t=texture2D(hud,vec2(h.x,1.-h.y));c=mix(c,t.rgb,t.a);}gl_FragColor=vec4(c,1.);}';
function restored(T,r,fn){const s={target:r.getRenderTarget(),face:r.getActiveCubeFace(),level:r.getActiveMipmapLevel(),vp:r.getViewport(new T.Vector4()),sc:r.getScissor(new T.Vector4()),test:r.getScissorTest(),color:r.getClearColor(new T.Color()),a:r.getClearAlpha(),auto:r.autoClear};try{return fn();}finally{r.resetState();r.setRenderTarget(s.target,s.face,s.level);r.setViewport(s.vp);r.setScissor(s.sc);r.setScissorTest(s.test);r.setClearColor(s.color,s.a);r.autoClear=s.auto;}}
const equal=(a,b)=>a&&b&&['owner','publishedGeneration','nativeRevision','panelRevision','completedHud'].every(k=>a[k]===b[k]);
export function createFullPanelPreviousBridge({THREE:T,renderer:r,maxLeases=2}){
 if(maxLeases!==2||!r?.isWebGLRenderer)throw Error('Fullpanel previous requires main renderer and two lease slots');
 const context=r.getContext(),entries=new Set(),handles=new WeakMap(),owned=[];let disposed=false,warmed=false,sequence=0,revision=0,outputValid=false,publishedRevision=0,completion=null,cpuTexture=null,cpuCanvas=null,hudTexture=null,hudCanvas=null,cachedRevision=-1,cachedCanvas=null;
 const own=x=>(owned.push(x),x),configure=(t,flip)=>{t.flipY=flip;t.colorSpace=T.NoColorSpace;t.premultiplyAlpha=false;t.generateMipmaps=false;t.minFilter=t.magFilter=T.LinearFilter;return t;};
 const target=name=>{const t=own(new T.WebGLRenderTarget(W,H,{format:T.RGBAFormat,type:T.UnsignedByteType,minFilter:T.LinearFilter,magFilter:T.LinearFilter,generateMipmaps:false,depthBuffer:false,stencilBuffer:false,samples:0,colorSpace:T.NoColorSpace}));configure(t.texture,false);t.texture.name=name;return t;};
 const slots=[{target:target('fullpanel-previous-0'),busy:false},{target:target('fullpanel-previous-1'),busy:false}],output=target('fullpanel-previous-composite');
 const dummy=configure(own(new T.DataTexture(new Uint8Array([0,0,0,255]),1,1,T.RGBAFormat)),false);dummy.needsUpdate=true;
 const uniforms={current:{value:dummy},previous:{value:dummy},hud:{value:dummy},alpha:{value:0},hudOn:{value:0}},material=own(new T.ShaderMaterial({vertexShader:PREVIOUS_VERTEX,fragmentShader:PREVIOUS_FRAGMENT,uniforms,depthTest:false,depthWrite:false,blending:T.NoBlending,toneMapped:false})),geometry=own(new T.PlaneGeometry(2,2)),scene=new T.Scene(),camera=new T.Camera(),mesh=new T.Mesh(geometry,material);mesh.frustumCulled=false;scene.add(mesh);
 const stats={kind:'fullpanel_previous',captures:0,reuses:0,captureFailures:0,capacityMisses:0,bridges:0,releases:0,liveMax:0,reads:0,readHits:0,cpuUploadRequests:0,hudUploadRequests:0,warmCalls:0,failures:[]};
 const check=()=>{if(disposed)throw Error('Fullpanel previous disposed');if(r.getRenderTarget()!==null)throw Error('Fullpanel previous requires default-target boundary');};
 const fail=(phase,e)=>stats.failures.push({phase,message:String(e?.message??e)});
 function handle(e){let released=false;const h=Object.freeze({id:e.id,context,width:W,height:H,origin:'bottom-left',encoding:'srgb-encoded',alphaMode:'opaque',stamp:e.stamp,get live(){return !released&&!e.dead&&!disposed;},get texture(){if(!this.live)throw Error('Fullpanel lease released');return e.slot.target.texture;},retain(){if(!this.live)throw Error('Fullpanel retain released');e.refs++;return handle(e);},release(){if(released)return;released=true;if(!e.dead&&--e.refs===0){e.dead=true;e.slot.busy=false;entries.delete(e);stats.releases++;}}});handles.set(h,e);return h;}
 const validLease=l=>l?.live&&l.context===context&&l.width===W&&l.height===H&&handles.has(l);
 function draw(t,{current=dummy,previous=dummy,alpha=0,hud=dummy,hudOn=0}){uniforms.current.value=current;uniforms.previous.value=previous;uniforms.alpha.value=alpha;uniforms.hud.value=hud;uniforms.hudOn.value=hudOn;r.autoClear=false;r.setRenderTarget(t);r.setViewport(0,0,W,H);r.setScissorTest(false);r.render(scene,camera);}
 const clearCompletion=()=>{completion?.lease.release();completion=null;publishedRevision=0;};
 function capture({context:sourceContext,token,stamp,valid,texture,verify,drawClean,width=W,height=H}={}, {expectedStamp=stamp}={}){
  check();if(!warmed||sourceContext!==context||width!==W||height!==H||!token||!valid||!stamp||!equal(stamp,expectedStamp)||!['final-result','fullpanel-previous'].includes(stamp.owner)||stamp.owner==='final-result'&&(stamp.publishedGeneration<1||stamp.nativeRevision<1)||stamp.completedHud!==false||!Number.isInteger(stamp.publishedGeneration)||stamp.publishedGeneration<0||!Number.isInteger(stamp.nativeRevision)||stamp.nativeRevision<0||!Number.isInteger(stamp.panelRevision)||stamp.panelRevision<=0||typeof verify!=='function'||drawClean?.constructor.name==='AsyncFunction'||!verify(stamp))return null;
  const old=[...entries].find(e=>e.token===token&&equal(e.stamp,stamp));if(old){old.refs++;stats.reuses++;return handle(old);}
  const slot=slots.find(x=>!x.busy);if(!slot){stats.capacityMisses++;return null;}slot.busy=true;
  try{restored(T,r,()=>{if(!verify(stamp))throw Error('Capture source changed before copy');if(drawClean){const v=drawClean(slot.target);if(v?.then){Promise.resolve(v).catch(()=>{});throw Error('Clean copy must complete synchronously');}if(v===false)throw Error('Clean copy declined');}else draw(slot.target,{current:texture});if(!verify(stamp))throw Error('Capture source changed during copy');});const e={id:++sequence,slot,token,stamp:Object.freeze({...stamp}),refs:1,dead:false};entries.add(e);stats.captures++;stats.liveMax=Math.max(stats.liveMax,entries.size);return handle(e);}catch(e){slot.busy=false;stats.captureFailures++;fail('capture',e);return null;}
 }
 function read(target){const bytes=new Uint8Array(W*H*4);restored(T,r,()=>r.readRenderTargetPixels(target,0,0,W,H,bytes));stats.reads++;const top=new Uint8ClampedArray(bytes.length),row=W*4;for(let y=0;y<H;y++)top.set(bytes.subarray((H-1-y)*row,(H-y)*row),y*row);const c=document.createElement('canvas');c.width=W;c.height=H;c.getContext('2d',{alpha:false}).putImageData(new ImageData(top,W,H),0,0);return c;}
 function copyTo(ctx,c){if(!ctx)return;ctx.save();try{ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='copy';ctx.filter='none';ctx.drawImage(c,0,0);}finally{ctx.restore();}}
 const api={context,
  warmup({sourceCanvas=null}={}){check();if(warmed)return {warmed:true,already:true};if(entries.size||revision)throw Error('Fullpanel warm is boot-only');const saved=Object.fromEntries(Object.entries(uniforms).map(([k,u])=>[k,u.value]));if(sourceCanvas){cpuCanvas=sourceCanvas;cpuTexture=configure(own(new T.CanvasTexture(sourceCanvas)),true);cpuTexture.needsUpdate=true;}try{restored(T,r,()=>{r.initTexture(dummy);if(cpuTexture)r.initTexture(cpuTexture);r.compile(scene,camera);for(const t of [...slots.map(x=>x.target),output]){r.initRenderTarget(t);draw(t,{current:cpuTexture??dummy});r.setClearColor(0,1);r.clear(true,false,false);}});warmed=true;stats.warmCalls++;return {warmed:true,targetBytes:3*W*H*4};}finally{for(const[k,v]of Object.entries(saved))uniforms[k].value=v;}},
  capture,
  clearCompletion,
  compose({sourceBackend=null,sourceCanvas=null,lease,alpha,hud=null}={}){check();if(!warmed||!validLease(lease)||!Number.isFinite(alpha)||alpha<0||alpha>1)return null;
   let current,sourceStamp=null,verifyCurrent=()=>true;outputValid=false;try{if(sourceBackend){if(sourceBackend.getComposedPanelContext?.()!==context)throw Error('Foreign current backend');sourceBackend.setHudCanvas(null);current=sourceBackend.compose();if(!current)throw Error('Current compose unavailable');const d=sourceBackend.diagnostics?.();sourceStamp=d?.revision??sourceBackend.surface?.revision;verifyCurrent=()=>{const now=sourceBackend.diagnostics?.();return (now?.revision??sourceBackend.surface?.revision)===sourceStamp;};}else if(sourceCanvas){if(cpuCanvas!==sourceCanvas){if(cpuTexture){cpuTexture.dispose();owned.splice(owned.indexOf(cpuTexture),1);}cpuCanvas=sourceCanvas;cpuTexture=configure(own(new T.CanvasTexture(sourceCanvas)),true);}cpuTexture.needsUpdate=true;stats.cpuUploadRequests++;current=cpuTexture;}else return null;
    if(hud){if(hudCanvas!==hud){if(hudTexture){hudTexture.dispose();owned.splice(owned.indexOf(hudTexture),1);}hudCanvas=hud;hudTexture=configure(own(new T.CanvasTexture(hud)),true);}hudTexture.needsUpdate=true;stats.hudUploadRequests++;}
    outputValid=false;restored(T,r,()=>draw(output,{current,previous:lease.texture,alpha,hud:hud?hudTexture:dummy,hudOn:hud?1:0}));clearCompletion();completion={current,lease:lease.retain(),alpha,verifyCurrent,hud:hud?hudTexture:dummy,hudOn:hud?1:0};revision++;outputValid=true;cachedCanvas=null;stats.bridges++;return output.texture;
   }catch(e){outputValid=false;fail('compose',e);return null;}
  },
  notePublished(){if(outputValid)publishedRevision=revision;},
  captureCompleted(){check();if(!outputValid||publishedRevision!==revision||!completion||!completion.verifyCurrent())return null;const c=completion,stamp={owner:'fullpanel-previous',publishedGeneration:0,nativeRevision:0,panelRevision:revision,completedHud:false};return capture({context,token:api,stamp,valid:true,verify:()=>outputValid&&publishedRevision===revision&&completion===c&&c.verifyCurrent(),drawClean:t=>draw(t,{current:c.current,previous:c.lease.texture,alpha:c.alpha})});},
  materializeLease(lease,{panelCtx,reason='fullpanel-lease-fallback'}={}){check();if(!validLease(lease))return null;const e=handles.get(lease);try{if(!e.cpu)e.cpu=read(e.slot.target);else stats.readHits++;copyTo(panelCtx,e.cpu);return e.cpu;}catch(error){fail(reason,error);return null;}},
  materializeCompleted({panelCtx,reason='fullpanel-completion-fallback'}={}){check();if(!outputValid||!completion||!completion.verifyCurrent())return null;try{if(cachedRevision!==revision||!cachedCanvas){try{restored(T,r,()=>draw(output,{current:completion.current,previous:completion.lease.texture,alpha:completion.alpha}));cachedCanvas=read(output);cachedRevision=revision;}finally{restored(T,r,()=>draw(output,{current:completion.current,previous:completion.lease.texture,alpha:completion.alpha,hud:completion.hud,hudOn:completion.hudOn}));}}else stats.readHits++;copyTo(panelCtx,cachedCanvas);return cachedCanvas;}catch(e){outputValid=false;fail(reason,e);return null;}},
  diagnostics:()=>({...stats,failures:stats.failures.map(x=>({...x})),warmed,disposed,live:entries.size,refs:[...entries].map(e=>({id:e.id,refs:e.refs,stamp:{...e.stamp}})),revision,publishedRevision,outputValid,completion:!!completion,targetBytes:3*W*H*4,extraContexts:0,rawHeldSeeds:0}),
  dispose(){if(disposed)return;clearCompletion();disposed=true;outputValid=false;for(const e of entries){e.dead=true;e.slot.busy=false;}entries.clear();for(const x of owned.splice(0))x.dispose();}
 };
 return api;
}

export function createFullPanelPreviousOwner({manager,ctx,previous,blocked=()=>false}){
 let disposed=false,scope=null,lease=null,alpha=0,frames=0,hud=null,baseFrame=null;
 const stats={scopes:0,unusedScopes:0,captures:0,rebridges:0,releases:0,cpuFallbacks:[],failures:[]};
 const release=()=>{if(lease){lease.release();lease=null;stats.releases++;}manager.clearCompletion();alpha=0;frames=0;};
 const required=(ok,reason)=>{if(!ok){stats.failures.push(reason);throw Error('Fullpanel previous: '+reason);}};
 const restore=(reason,{toPrevious=false}={})=>{const image=frames?manager.materializeCompleted({panelCtx:ctx,reason}):manager.materializeLease(lease,{panelCtx:ctx,reason});required(image,'completed bridge restoration failed: '+reason);if(toPrevious)required(manager.materializeLease(lease,{panelCtx:previous,reason:reason+'-old-transition'}),'previous restoration failed');return image;};
 const wrapper={
  getComposedPanelContext:()=>manager.context,
  setHudCanvas(value){hud=value;},
  compose(){if(!lease||disposed)return null;const texture=manager.compose({sourceBackend:baseFrame?.backend??null,sourceCanvas:ctx.canvas,lease,alpha,hud});if(texture)frames++;return texture;},
  materializeTo({panelCtx=ctx,heldCtx=null,reason='fullpanel-consumer'}={}){if(!lease)return null;if(heldCtx&&baseFrame?.backend)baseFrame.backend.materializeTo({heldCtx,reason:reason+'-raw-only'});const image=frames?manager.materializeCompleted({panelCtx,reason}):manager.materializeLease(lease,{panelCtx,reason});required(image,'materialize failed: '+reason);return image;},
  diagnostics:()=>({kind:'fullpanel_previous_image',revision:manager.diagnostics().revision,failed:false,manager:manager.diagnostics()})
 };
 const api={
  get active(){return !!lease;},
  withSource(source,fn){if(disposed)throw Error('Fullpanel previous owner disposed');if(scope)throw Error('Nested external previous scope unsupported');if(typeof fn!=='function'||fn.constructor.name==='AsyncFunction')throw Error('Synchronous external previous scope required');const current={source,used:false};scope=current;stats.scopes++;try{const value=fn();if(value?.then)throw Error('External previous scope returned Promise');return value;}finally{if(!current.used)stats.unusedScopes++;scope=null;}},
  begin(){if(disposed)return null;
   const request=scope&&!scope.used?scope:null;let next=null;
   if(request){request.used=true;if(!blocked())next=request.source.capture?.();if(!next){stats.cpuFallbacks.push(blocked()?'final-previous-conflict':'final-previous-capture-unavailable');required(request.source.materialize?.('final-previous-fallback'),'external previous fallback failed');release();return 'cpu';}}
   else if(lease){if(!blocked())next=frames?manager.captureCompleted():lease.retain();if(!next){stats.cpuFallbacks.push('fullpanel-rebridge-unavailable');restore('fullpanel-rebridge-unavailable');release();return 'cpu';}stats.rebridges++;}
   else return null;
   const old=lease;lease=next;alpha=1;frames=0;manager.clearCompletion();if(old){old.release();stats.releases++;}stats.captures++;return 'gpu';
  },
  blend(value){if(!lease)return false;alpha=value;if(alpha<=0)release();return true;},
  abandon(){release();},
  fallback(reason){if(!lease)return false;restore(reason,{toPrevious:true});stats.cpuFallbacks.push(reason);release();return true;},
  wrap(base){if(!lease||disposed)return base;baseFrame=base;return {owner:'fullpanel-previous',backend:wrapper,get published(){const d=manager.diagnostics();return d.outputValid&&d.publishedRevision===d.revision;},set published(v){if(v)manager.notePublished();}};},
  materialize(reason){if(!lease)return false;restore(reason,{toPrevious:true});release();return true;},
  diagnostics:()=>({...stats,cpuFallbacks:[...stats.cpuFallbacks],failures:[...stats.failures],active:!!lease,alpha,frames,lease:lease?{id:lease.id,stamp:{...lease.stamp}}:null,manager:manager.diagnostics(),disposed}),
  dispose(){if(disposed)return;disposed=true;release();scope=null;}
 };
 return api;
}
