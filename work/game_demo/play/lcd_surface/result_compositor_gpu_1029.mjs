import {createGlSegment,createThreeOutput} from './result_gpu_segment_1029.mjs';
// Native production source compositor. MP4 is never re-encoded. Text-bearing
// frames use lossless linear-light backgrounds and the original glyph PNGs.
const W=1152,H=1268, SCL=265/257, PITCH=300*SCL;
const ease=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
const pop=(t,a)=>t>=0&&t<a.length?a[t]:1;
const CH=[2.4,1.55,1.12,.93,1.04,1], MID=[1.20,.96,1.03,1], LAST=[1.85,1.38,.92,1.08,.98,1];
// Main-thread delivery only. The existing Worker remains responsible for decoding.
export const resultFrameSchedulerMetadata=Object.freeze({version:1,maxInflight:2,lookahead:4,dropPolicy:'unstarted-prefetch-only',runningPolicy:'finish-without-stale-prefetch-cache'});
export function createResultFrameScheduler({load,cache=new Map(),onError=()=>{},diagnostics=false,now=()=>performance.now()}){
 const jobs=new Map();let wanted=null,active=0,sequence=0,disposed=false;
 const stats={started:0,completed:0,failed:0,droppedQueued:0,staleCompleted:0,inflightMax:0,queuedMax:0,waitCount:0,waitTotalMs:0,waitMaxMs:0};
 const current=j=>wanted&&j.kind===wanted.kind&&j.frame===wanted.frame;
 const useful=j=>!wanted||j.kind===wanted.kind&&j.frame>=wanted.frame&&j.frame<=wanted.frame+4;
 const cacheable=j=>j.explicit||!wanted||j.kind===wanted.kind&&j.frame>=wanted.frame-2&&j.frame<=wanted.frame+4;
 function settle(job,error,value){if(job.settled)return;job.settled=true;if(error)job.reject(error);else job.resolve(value);}
 function finish(job,error,value){
  active--;if(jobs.get(job.key)===job)jobs.delete(job.key);
  if(!disposed&&!job.settled){
   if(error){stats.failed++;settle(job,error);if(!job.explicit)onError(error);}
   else{stats.completed++;if(cacheable(job))cache.set(job.key,value);else stats.staleCompleted++;settle(job,null,value);}
  }
  pump();
 }
 function pump(){
  if(disposed)return;
  while(active<2){
   let next=null,rank=Infinity;
   for(const job of jobs.values())if(job.state==='queued'){
    const r=current(job)?0:job.explicit?1:2;
    if(r<rank||r===rank&&(!next||job.order<next.order)){next=job;rank=r;}
   }
   if(!next)break;
   const job=next;job.state='active';active++;stats.started++;stats.inflightMax=Math.max(stats.inflightMax,active);
   if(diagnostics){const ms=now()-job.queuedAt;stats.waitCount++;stats.waitTotalMs+=ms;stats.waitMaxMs=Math.max(stats.waitMaxMs,ms);}
   // Catch synchronous load errors too, and always attach both completion paths.
   Promise.resolve().then(()=>disposed?null:load(job.kind,job.frame)).then(value=>finish(job,null,value),error=>finish(job,error));
  }
 }
 function request(kind,frame,explicit){
  if(disposed)return Promise.resolve(null);
  const key=kind+':'+frame;if(cache.has(key))return Promise.resolve(cache.get(key));
  const existing=jobs.get(key);if(existing){if(explicit)existing.explicit=true;return existing.promise;}
  const job={key,kind,frame,explicit,state:'queued',order:++sequence,settled:false,queuedAt:diagnostics?now():0};
  job.promise=new Promise((resolve,reject)=>{job.resolve=resolve;job.reject=reject;});
  // Prefetch consumers need no rejection channel; explicit callers still receive
  // the original rejecting Promise. Deliberately dropped work resolves null.
  job.promise.catch(()=>{});jobs.set(key,job);stats.queuedMax=Math.max(stats.queuedMax,[...jobs.values()].filter(j=>j.state==='queued').length);
  return job.promise;
 }
 return {
  prepare(kind,frame){const promise=request(kind,frame,true);pump();return promise;},
  prefetch(kind,frame){
   if(disposed)return;wanted={kind,frame};
   for(const job of jobs.values())if(job.state==='queued'&&!job.explicit&&!useful(job)){jobs.delete(job.key);stats.droppedQueued++;settle(job,null,null);}
   // Match the original cache retention for already completed frames. Explicit
   // prepare calls retain their usual cache/ready semantics until this eviction.
   for(const key of cache.keys()){const [k,n]=key.split(':');if(k===kind&&+n<frame-2)cache.delete(key);}
   const end=kind==='confirm'?213:149;for(let f=frame;f<=Math.min(end,frame+4);f++)request(kind,f,false);
   pump();
  },
  diagnostics(){return {...stats,inflight:active,queued:[...jobs.values()].filter(j=>j.state==='queued').length,pending:jobs.size,wanted:wanted?{...wanted}:null,disposed,waitMeanMs:stats.waitCount?stats.waitTotalMs/stats.waitCount:null};},
  dispose(){disposed=true;for(const job of jobs.values())settle(job,null,null);jobs.clear();}
 };
}

export async function createResultCompositorInjected(base,config,{THREE,renderer}){
 if(!renderer?.isWebGLRenderer)throw Error('Existing main THREE.WebGLRenderer required');
 const gl=renderer.getContext();
 if(!gl||!gl.getExtension('EXT_color_buffer_float'))throw Error('Native result compositor requires float render targets');
 gl.getExtension('OES_texture_float_linear');

 const failBloom=new URLSearchParams(globalThis.location?.search??'').get('failbloom')!=='0';
 const canvas={width:W,height:H,readyState:4,isConnected:false,resultGpuSentinel:true};
 let vao=null,buffer=null,disposed=false,worker=null,scheduler=null;
 const workerPending=new Map();
 const segment=createGlSegment({THREE,renderer,getVao:()=>vao,getBuffer:()=>buffer});
 const output=createThreeOutput({THREE,renderer,width:W,height:H,segment});
 const surface=Object.freeze({type:'lcd-gpu-surface',texture:output.texture,target:output.target,width:W,height:H,encoding:'srgb-gamma-2.2',origin:'bottom-left',alphaMode:'opaque',opaque:true,context:gl,get revision(){return canvas.resultRevision??0;}});
 canvas.gpuResultSurface=surface;

 const programs=[],textures=[],fbos=[],locations=new Map();
 try{
 const vert=`#version 300 es\nlayout(location=0) in vec2 p;out vec2 uv;void main(){uv=(p+1.)*.5;gl_Position=vec4(p,0,1);}`;
 const prog=body=>segment.run('program-create',()=>{const p=gl.createProgram();programs.push(p);for(const [type,src] of [[gl.VERTEX_SHADER,vert],[gl.FRAGMENT_SHADER,`#version 300 es\nprecision highp float;in vec2 uv;out vec4 o;${body}`]]){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);gl.deleteShader(s);}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));const uniforms=Object.create(null);for(const m of body.matchAll(/uniform\s+\w+\s+([^;]+);/g))for(const name of m[1].split(','))uniforms[name.trim()]=gl.getUniformLocation(p,name.trim());locations.set(p,uniforms);return p;});
 segment.run('own-VAO-buffer-init',()=>{vao=gl.createVertexArray();gl.bindVertexArray(vao);buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);});
 const tex=(w,h,data=null,html=false,rgb=false)=>segment.run('texture-create',()=>{const t=gl.createTexture();textures.push(t);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);if(html)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,data);else gl.texImage2D(gl.TEXTURE_2D,0,rgb?gl.RGB16F:gl.RGBA16F,w,h,0,rgb?gl.RGB:gl.RGBA,gl.HALF_FLOAT,data);return {t,w,h};});
 const target=(w=W,h=H)=>segment.run('float-target-create',()=>{const t=tex(w,h),f=gl.createFramebuffer();fbos.push(f);gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t.t,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Result framebuffer incomplete');return {...t,f};});
 const use=(p,out,inputs={},values={},rect=null)=>segment.run('draw',()=>{gl.bindFramebuffer(gl.FRAMEBUFFER,out?.f??output.framebuffer);gl.viewport(...(rect??[0,0,out?.w??W,out?.h??H]));gl.useProgram(p);const loc=locations.get(p);let i=0;for(const [k,t] of Object.entries(inputs)){gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,t.t);gl.uniform1i(loc[k],i++);}for(const [k,v]of Object.entries(values)){const l=loc[k];if(Array.isArray(v))gl[`uniform${v.length}fv`](l,v);else gl.uniform1f(l,v);}gl.drawArrays(gl.TRIANGLE_STRIP,0,4);});
 const clear=out=>segment.run('clear',()=>{gl.bindFramebuffer(gl.FRAMEBUFFER,out.f);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);});
 const drawP=prog(`uniform sampler2D im;uniform float gammaIn,opacity,mask,boost,rgbGain;void main(){vec4 c=texture(im,uv);if(gammaIn>0.)c.rgb=pow(max(c.rgb,vec3(0)),vec3(2.2))*c.a;float m=mask>0.?clamp((175.*${SCL} -abs((uv.y-.5)*mask))/(25.*${SCL}),0.,1.):1.;o=c*(opacity*m);o.a=clamp(o.a*boost,0.,1.);o.rgb*=boost*rgbGain;}`);
 let letterBounds=null;
 const draw=(im,out,cx,cy,sx=1,sy=sx,opacity=1,gammaIn=1,mask=0,boost=1,rgbGain=1)=>{gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);const w=Math.max(1,Math.round(im.w*sx)),h=Math.max(1,Math.round(im.h*sy));const x=Math.round(cx-w/2),y=Math.round(cy-h/2);if(out===slot&&(x>=slot.w||y>=slot.h||x+w<=0||y+h<=0)){gl.disable(gl.BLEND);return;}if(out===L){const b=[Math.max(0,x),Math.max(0,y),Math.min(W,x+w),Math.min(H,y+h)];if(b[2]>b[0]&&b[3]>b[1])letterBounds=letterBounds?[Math.min(letterBounds[0],b[0]),Math.min(letterBounds[1],b[1]),Math.max(letterBounds[2],b[2]),Math.max(letterBounds[3],b[3])]:b;}use(drawP,out,{im},{gammaIn,opacity,mask,boost,rgbGain},[x,y,w,h]);gl.disable(gl.BLEND);};
 const filterP=prog(`uniform sampler2D im;uniform vec2 stepUV;uniform float sigma,box;void main(){vec4 s=texture(im,uv);float total=1.;int r=int(box>0.?box:ceil(4.*sigma));for(int i=1;i<=144;i+=2){if(i>r)break;float a=box>0.?1.:exp(-.5*pow(float(i)/sigma,2.));float b=i+1>r?0.:(box>0.?1.:exp(-.5*pow(float(i+1)/sigma,2.)));float w=a+b;float d=(float(i)*a+float(i+1)*b)/w;s+=(texture(im,uv+stepUV*d)+texture(im,uv-stepUV*d))*w;total+=2.*w;}o=s/total;}`);
 const blur=(src,tmp,out,sigma)=>{
  // Only letter targets have a known exact zero exterior. Keep the full-size
  // textures, original UVs and every filter tap; skip solely guaranteed zeros.
  if(src===L){
   clear(tmp);clear(out);if(!letterBounds)return;
   const r=Math.ceil(4*sigma)+2,[x0,y0,x1,y1]=letterBounds,left=Math.max(0,x0-r),right=Math.min(W,x1+r),bottom=Math.max(0,y0-r),top=Math.min(H,y1+r);
   gl.enable(gl.SCISSOR_TEST);gl.scissor(left,Math.max(0,y0-2),right-left,Math.min(H,y1+2)-Math.max(0,y0-2));use(filterP,tmp,{im:src},{stepUV:[1/src.w,0],sigma,box:0});
   gl.scissor(left,bottom,right-left,top-bottom);use(filterP,out,{im:tmp},{stepUV:[0,1/src.h],sigma,box:0});gl.disable(gl.SCISSOR_TEST);
  }else{use(filterP,tmp,{im:src},{stepUV:[1/src.w,0],sigma,box:0});use(filterP,out,{im:tmp},{stepUV:[0,1/src.h],sigma,box:0});}
 };
 const composeP=prog(`uniform sampler2D bg,letters,shadow,glow,post;uniform float gain,f,isFail,nd;void main(){vec3 b=texture(bg,uv).rgb;vec4 l=texture(letters,uv);float sh=texture(shadow,uv-vec2(4.,10.)/vec2(1152,1268)).a;b*=1.-(isFail>.5?.65:.6)*sh;vec3 g=texture(glow,uv).rgb;b+=g*(isFail>.5?vec3(.45,.55,.9)*.18:vec3(1.,.3,.12)*gain);b=b*(1.-l.a)+l.rgb;
 if(isFail<.5){float t=f-156.;if(t>=3.&&t<24.){float sx=mix(-200.,1452.,(t-3.)/21.);float band=pow(clamp(1.-abs((uv.x*1152.+uv.y*1268.*.4-sx)/46.),0.,1.),2.);b+=band*l.a*vec3(1.,.9,.8)*.30;}
 vec4 p=texture(post,uv);b=b*p.a+p.rgb;
 for(int k=1;k<5;k++){float lk=156.-2.*float(k);if(float(k)<nd&&f>=lk&&f<lk+3.){vec2 d=(uv*vec2(1152,1268)-vec2(197.+float(4-k)*164.,787.5))/vec2(80,130);b+=exp(-dot(d,d)/2.)*vec3(1.,.8,.4)*.22*(1.-(f-lk)/3.);}}}
 o=vec4(b,1);}`);
 const warpP=prog(`uniform sampler2D im;uniform vec2 shift;uniform float zoom;void main(){vec2 p=(uv*vec2(1152,1268)-vec2(576,634)-shift)/zoom+vec2(576,634);o=texture(im,p/vec2(1152,1268));}`);
 const hiP=prog(`uniform sampler2D im;void main(){o=vec4(max(texture(im,uv).rgb-vec3(.92),vec3(0)),1);}`);
 const reduceP=failBloom?prog(`uniform sampler2D im;void main(){ivec2 p=ivec2(gl_FragCoord.xy)*2;o=(texelFetch(im,p,0)+texelFetch(im,p+ivec2(1,0),0)+texelFetch(im,p+ivec2(0,1),0)+texelFetch(im,p+ivec2(1,1),0))*.25;}`):null;
 const finalP=prog(`uniform sampler2D im,b10,b36;void main(){vec2 v=vec2(uv.x,1.-uv.y);vec3 c=texture(im,v).rgb+(texture(b10,v).rgb*.6+texture(b36,v).rgb*.9)*.18;o=vec4(pow(clamp(c,0.,1.),vec3(1./2.2)),1);}`);
 const L=target(),tmp=target(),shadow=target(),glow=target(),image=target(),warped=target(),hi=target(),b10=target(),b36=target();
 // Keep native text, highlights and output. Only broad fail bloom is sampled at half/quarter size.
 const bloomTargets=failBloom?[target(W/2,H/2),target(W/2,H/2),target(W/2,H/2),target(W/4,H/4),target(W/4,H/4),target(W/4,H/4)]:[];
 const [hi2,tmp2,b102,hi4,tmp4,b364]=bloomTargets;
 const slot=target(244,Math.floor(760*SCL)),slotBlur=target(244,Math.floor(760*SCL));
 const atlas={};const load=async(url)=>{const r=await fetch(url);if(!r.ok)throw Error('Result asset '+r.status+' '+url);const b=await createImageBitmap(await r.blob(),{premultiplyAlpha:'none',colorSpaceConversion:'none'});const t=tex(b.width,b.height,b,true);b.close();return t;};
 for(const [kind,path]of Object.entries(config.parts)){atlas[kind]={};for(const name of [...'0123456789'].flatMap(d=>['d'+d,'c'+d]).concat(['total','tama','ren','x']))atlas[kind][name]=await load(new URL(path+'/'+name+'.png',base));}
 const happy=await load(new URL(config.happy,base)),sad=await load(new URL(config.sad,base));
 const packed=!!config.packed_bases,bgTex=tex(W,H,null,false,packed),postTex=target(),cache=new Map();let lastKey=null,lastTextKey=null,bgRgba=null;
 const warmupToken={};let warmupPromise=null,warmupActive=false;
 const halfValue=h=>{const sign=h&0x8000?-1:1,e=(h>>>10)&31,m=h&1023;return sign*(e===0?m*2**-24:e===31?(m?NaN:Infinity):(1+m/1024)*2**(e-15));};
 function unpack(a){
  if(!packed)return new Uint16Array(a);
  const d=new DataView(a);if(a.byteLength<40||d.getUint32(0,true)!==0x31504352||d.getUint16(4,true)!==1||d.getUint16(6,true)!==40||d.getUint16(8,true)!==W||d.getUint16(10,true)!==H)throw Error('Invalid result frame header');
  const x=d.getUint16(12,true),y=d.getUint16(14,true),w=d.getUint16(16,true),h=d.getUint16(18,true),count=d.getUint32(28,true),flags=d.getUint16(32,true),rgba=!!(flags&1);
  if(flags>1||count!==W*H*(rgba?4:3)||x+w>W||y+h>H||a.byteLength!==40+(count+w*h*4)*2)throw Error('Invalid result frame layout');
  return {rgba,bg:new Uint16Array(a,40,count),post:new Uint16Array(a,40+count*2),x,y,w,h,color:Float32Array.from([20,22,24,26],offset=>halfValue(d.getUint16(offset,true)))};
 }
 let workerId=0;
 if(packed&&(config.delta_bases||config.shuffled_bases)&&typeof Worker==='function'){
  try{
   worker=new Worker(new URL(config.frame_worker??'../result_frame_worker_1029.mjs',base),{type:'module'});
   worker.addEventListener('message',({data})=>{const entry=workerPending.get(data.id);if(!entry)return;workerPending.delete(data.id);if(data.type==='ready')entry.resolve(data.buffer);else entry.reject(Error(data.message??'Result frame worker failed'));});
   worker.addEventListener('error',e=>{for(const p of workerPending.values())p.reject(Error(e.message??'Result frame worker failed'));workerPending.clear();worker?.terminate();worker=null;});
  }catch{worker=null;}
 }
 const fetchPacked=async(kind,f)=>{
  if(worker&&(kind==='confirm'||config.delta_bases)){try{return await new Promise((resolve,reject)=>{const id=++workerId;workerPending.set(id,{resolve,reject});worker.postMessage({type:'prepare',id,basesUrl:new URL((kind==='fail'?config.delta_bases:(config.shuffled_bases??config.packed_bases))+'/',base).href,kind,frame:f,keyframes:config.delta_keyframes});});}catch(e){if(disposed)throw e;}}
  const r=await fetch(new URL(`${config.packed_bases??config.bases}/${kind}/${String(f).padStart(3,'0')}.bin`,base));if(!r.ok)throw Error('Result base '+r.status+' '+kind+':'+f);return new Response(r.body.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
 };
 const errors=[];
 scheduler=createResultFrameScheduler({cache,load:async(kind,f)=>{const a=await fetchPacked(kind,f);return disposed?null:unpack(a);},diagnostics:!!config.frame_scheduler_diagnostics,onError:e=>{if(!errors.includes(e.message)){errors.push(e.message);console.error(e);}}});
 const fetchFrame=(kind,f)=>scheduler.prepare(kind,f);
 const prefetch=(kind,f)=>scheduler.prefetch(kind,f);
 if(config.frame_scheduler_diagnostics)canvas.resultSchedulerDiagnostics=()=>scheduler.diagnostics();
 function digits(kind,f,V,C){const a=atlas[kind],isFail=kind==='fail';letterBounds=null;clear(L);
  const put=(name,cx,cy,s=1,op=1)=>draw(a[name],L,cx,cy,s,s,op);
  if(!isFail&&C>1&&f>=84){const t=f-84,s=pop(t,CH),op=Math.min(1,(t+1)/2),P=(x,y)=>[576+(x-576)*s,470+(y-470)*s];for(const [n,x,y]of [['ren',457.5,476],['x',533,485]])put(n,...P(x,y),s,op);const cs=String(C).padStart(2,'0'),fit=Math.min(1,2/cs.length);for(let i=0;i<cs.length;i++)put('c'+cs[i],...P(650.5+(i-(cs.length-1)/2)*88*fit,465),s*fit,op);}
  const t=f-(isFail?64:96);if(t<0)return;const u=t/5,s=u<1?1.5-.5*ease(u):1,op=Math.min(1,u*3);const P=(x,y)=>[576+(x-576)*s,780+(y-780)*s];put('total',...P(290.5,613.5),s,op);
  const str=String(V).padStart(5,'0'),nd=String(V).length,n=str.length,fit=Math.min(1,5/n),cell=164*fit,x0=525-(n*cell)/2;
  for(let j=0;j<n;j++){const k=n-1-j,cx=x0+(j+.5)*cell,cy=787.5,lk=k>=nd?-1:156-2*k,locked=isFail||lk<0||f>=lk;let sc=locked&&lk>=0&&!isFail?pop(f-lk,k===0?LAST:MID):1;
   if(locked||f<102){put('d'+(locked?str[j]:'0'),...P(cx,cy),s*sc*fit,op);continue;}
   const count=t=>{const u=Math.max(0,Math.min(1,(t-102)/54));return V*(1-(1-u)**1.7);};const odo=(v,k)=>k===0?v:Math.floor(v/10**k)+Math.max(0,Math.min(1,(v/10**(k-1))%10-9));const q=odo(count(f),k),dq=Math.abs(q-odo(count(f-1),k)),fl=Math.floor(q),fr=q-fl;
   clear(slot);for(let jj=-2;jj<=2;jj++)draw(a['d'+((fl+jj)%10+10)%10],slot,122,slot.h/2+(jj-fr)*PITCH);
   const len=Math.min(dq,1)*PITCH*.62;let input=slot;if(len>3){use(filterP,slotBlur,{im:slot},{stepUV:[0,1/slot.h],sigma:1,box:Math.floor((Math.floor(len)|1)/2)});input=slotBlur;}
   draw(input,L,...P(cx,cy),s*fit,s,op,0,slot.h,len>3?1+1.5*Math.min(1,dq):1);
  }
  put('tama',...P(991,859),s,op);
 }
 function renderRaw(kind,f,V,C,token=null){if(warmupActive&&token!==warmupToken)throw Error('Result startup warmup is active');const first=kind==='confirm'?84:64;if(f<first)return null;f=Math.min(kind==='confirm'?213:149,Math.max(first,f));if(token!==warmupToken)prefetch(kind,f);const key=kind+':'+f+':'+V+':'+C;if(lastKey===key)return canvas;const data=cache.get(kind+':'+f);if(!data)return null;lastKey=key;
  return segment.run('frame-render',()=>{
  let frameBg=bgTex;gl.activeTexture(gl.TEXTURE0);
  if(packed){
   if(data.rgba)frameBg=bgRgba??(bgRgba=tex(W,H));gl.bindTexture(gl.TEXTURE_2D,frameBg.t);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,W,H,data.rgba?gl.RGBA:gl.RGB,gl.HALF_FLOAT,data.bg);
   if(kind==='confirm'){gl.bindFramebuffer(gl.FRAMEBUFFER,postTex.f);gl.clearBufferfv(gl.COLOR,0,data.color);if(data.w&&data.h){gl.bindTexture(gl.TEXTURE_2D,postTex.t);gl.texSubImage2D(gl.TEXTURE_2D,0,data.x,data.y,data.w,data.h,gl.RGBA,gl.HALF_FLOAT,data.post);}}
  }else for(const [t,offset]of [[bgTex,0],[postTex,W*H*4]]){gl.bindTexture(gl.TEXTURE_2D,t.t);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,W,H,gl.RGBA,gl.HALF_FLOAT,data.subarray(offset,offset+W*H*4));}
  const textKey=kind+':'+V+':'+C+':'+((kind==='fail'&&f>=69||kind==='confirm'&&f>=162)?'settled':f);if(textKey!==lastTextKey){digits(kind,f,V,C);blur(L,tmp,shadow,14);blur(L,tmp,glow,kind==='fail'?24:22);lastTextKey=textKey;}const tl=f-156,spin=f>=102&&f<156?.6+.6*(f-102)/54:0,gain=.32+.12*spin+(tl>=0?1.4*Math.exp(-tl*.14):0);
  use(composeP,image,{bg:frameBg,letters:L,shadow,glow,post:postTex},{gain,f,isFail:kind==='fail'?1:0,nd:String(V).length});
  let shift=[0,0],zoom=1;if(kind==='confirm'){const tc=f-84;let sh=tc>=0&&tc<10?14*(1-tc/10):0;if(tl>=0&&tl<14){sh=Math.max(sh,40*(1-tl/16));zoom=1+.1*Math.exp(-tl*.42);}if(f>=108&&f<156)sh=Math.max(sh,2+3*((f-102)/54)**2);if(f>=147&&f<156)zoom=1+.03*ease((f-147)/9);shift=[sh*Math.sin(f*2.3),sh*Math.cos(f*3.1)];}else{const tt=f-64;if(tt>=0&&tt<12)shift=[0,12*Math.exp(-tt*.4)*Math.cos(tt*2.2)];}
  use(warpP,warped,{im:image},{shift,zoom});
  const t0=kind==='confirm'?90:78;if(f>=t0){const im=kind==='confirm'?happy:sad;let hop=0;if(kind==='confirm'&&f>=156){const ph=(f-156)%20;hop=ph<15?30*Math.sin(ph/15*Math.PI):0;}const enter=(1-ease((f-t0)/(kind==='confirm'?8:10)))*300;gl.bindTexture(gl.TEXTURE_2D,im.t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);draw(im,warped,120,1250-im.h*2-hop+enter,4,4,1,1,0,1,kind==='fail'?.8:1);}
  use(hiP,hi,{im:warped});
  if(kind==='fail'&&failBloom){use(reduceP,hi2,{im:hi});use(reduceP,hi4,{im:hi2});blur(hi2,tmp2,b102,5);blur(hi4,tmp4,b364,9);use(finalP,null,{im:warped,b10:b102,b36:b364});}
  else{blur(hi,tmp,b10,10);blur(hi,tmp,b36,36);use(finalP,null,{im:warped,b10,b36});}canvas.resultRevision=(canvas.resultRevision??0)+1;return canvas;
  });
 }
 const render=(...args)=>renderRaw(...args);
 // Startup-only: seeds are real decoded head buffers, used solely for hidden
 // shader/texture warm draws. No timeline, extra fetch, GPU target or frame copy.
 function warmup(){
  if(disposed)return Promise.reject(Error('Result compositor is disposed'));
  if(lastKey!==null||lastTextKey!==null)return Promise.reject(Error('Result warmup requires unused startup targets'));
  if(warmupPromise)return warmupPromise;
  const initialCache=new Map(cache),seeds={confirm:cache.get('confirm:84'),fail:cache.get('fail:64')};
  if(!seeds.confirm||!seeds.fail)return Promise.reject(Error('Result warmup head buffers not ready'));
  if(packed&&(seeds.confirm.rgba||seeds.fail.rgba)&&!bgRgba)return Promise.reject(Error('Result warmup would allocate lazy RGBA target'));
  const zeros=new Uint16Array(W*H*4),copy=v=>ArrayBuffer.isView(v)||Array.isArray(v)?Array.from(v):v;
  const heads={lastKey,lastTextKey,letterBounds},revision=canvas.resultRevision,hadRevision=Object.hasOwn(canvas,'resultRevision');
  const filters=[],uniforms=[];let restored=false;
  function restoreOwn(){
   if(restored)return;restored=true;cache.clear();for(const [k,v]of initialCache)cache.set(k,v);
   lastKey=heads.lastKey;lastTextKey=heads.lastTextKey;letterBounds=heads.letterBounds;
   if(hadRevision)canvas.resultRevision=revision;else delete canvas.resultRevision;
   if(disposed)return;
   gl.disable(gl.SCISSOR_TEST);gl.colorMask(true,true,true,true);
   for(const out of [L,tmp,shadow,glow,image,warped,hi,b10,b36,slot,slotBlur,postTex,...bloomTargets])clear(out);
   // Old alpha:false default buffer was opaque. Never clear the main default FBO.
   gl.bindFramebuffer(gl.FRAMEBUFFER,output.framebuffer);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);
   gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,bgTex.t);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,W,H,packed?gl.RGB:gl.RGBA,gl.HALF_FLOAT,packed?zeros.subarray(0,W*H*3):zeros);
   for(const [im,filter]of filters){gl.bindTexture(gl.TEXTURE_2D,im.t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);}
   for(const u of uniforms){gl.useProgram(u.p);if(u.type===gl.SAMPLER_2D)gl.uniform1i(u.l,u.value);else if(u.type===gl.FLOAT)gl.uniform1f(u.l,u.value);else{const n=u.type===gl.FLOAT_VEC2?2:u.type===gl.FLOAT_VEC3?3:4;gl[`uniform${n}fv`](u.l,u.value);}}
  }
  warmupActive=true;
  warmupPromise=(async()=>{let fence=null;try{
   segment.run('warm-draw-and-restore',()=>{
    for(const im of [happy,sad]){gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,im.t);filters.push([im,gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER)]);}
    for(const p of programs)for(let i=0,n=gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS);i<n;i++){const info=gl.getActiveUniform(p,i),l=gl.getUniformLocation(p,info.name);uniforms.push({p,l,type:info.type,value:copy(gl.getUniform(p,l))});}
    for(const [kind,f]of [['confirm',97],['confirm',120],['confirm',156],['fail',80]]){cache.set(kind+':'+f,seeds[kind]);renderRaw(kind,f,12345,12,warmupToken);}
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,postTex.t);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,W,H,gl.RGBA,gl.HALF_FLOAT,zeros);
    restoreOwn();gl.finish();fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);if(!fence)throw Error('Result warmup fence unavailable');gl.flush();
   });
   // Fence polling has no binding/raster state; no lease spans any await.
   const at=performance.now();for(;;){if(disposed)throw Error('Result warmup disposed');const status=gl.clientWaitSync(fence,0,0);if(status===gl.ALREADY_SIGNALED||status===gl.CONDITION_SATISFIED)break;if(status===gl.WAIT_FAILED||performance.now()-at>15000)throw Error('Result warmup fence failed');await new Promise(resolve=>setTimeout(resolve,1));}
   return {frames:4,extraTextures:0,workBufferBytes:zeros.byteLength,output:'Three-managed native RGBA8',awaitLeaseHeld:false};
  }finally{if(!restored)segment.run('warm-error-restore',restoreOwn);if(fence)gl.deleteSync(fence);warmupActive=false;}})();
  warmupPromise.catch(()=>{});return warmupPromise;
 }

 // Decode ahead during the original MP4 opening. Never display baked placeholder values.
 await Promise.all([fetchFrame('confirm',84),fetchFrame('fail',64)]);
 if(config.startup_warmup)await warmup();
 return {canvas,surface,texture:output.texture,errors,prefetch,warmup,schedulerDiagnostics:()=>scheduler.diagnostics(),segmentDiagnostics:()=>segment.diagnostics(),readPixels:()=>output.readPixels(),ready:(kind,f)=>cache.has(kind+':'+f),prepare:fetchFrame,render,dispose(){if(disposed)return;disposed=true;scheduler.dispose();worker?.terminate();worker=null;for(const p of workerPending.values())p.resolve(null);workerPending.clear();segment.run('dispose-owned-GL',()=>{for(const t of textures)gl.deleteTexture(t);for(const f of fbos)gl.deleteFramebuffer(f);for(const p of programs)gl.deleteProgram(p);gl.deleteBuffer(buffer);gl.deleteVertexArray(vao);});locations.clear();cache.clear();output.dispose();}};
 }catch(error){disposed=true;scheduler?.dispose();worker?.terminate();for(const p of workerPending.values())p.resolve(null);workerPending.clear();segment.run('failed-factory-cleanup',()=>{for(const t of textures)gl.deleteTexture(t);for(const f of fbos)gl.deleteFramebuffer(f);for(const p of programs)gl.deleteProgram(p);if(buffer)gl.deleteBuffer(buffer);if(vao)gl.deleteVertexArray(vao);});output.dispose();throw error;}
}

