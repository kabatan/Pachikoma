// One palace decoder/clock shared by first-JP and continuation foregrounds.
// Scene changes and foreground loop seeks never seek/reload this video.
export async function createSharedPalace({base,config,onError=()=>{}}){
 const video=document.createElement('video');video.muted=true;video.playsInline=true;video.loop=true;video.preload='auto';
 const errors=[],events=[],audit=[];let clock=0,loops=0,lastAudit=-1,manual=false,presentedTime=0,lastPresented=0,visible=false,segment=0;
 const presented=(wall,m)=>{if(!manual&&m.mediaTime<lastPresented-.2)loops++;lastPresented=m.mediaTime;presentedTime=m.mediaTime;video.requestVideoFrameCallback(presented);};video.requestVideoFrameCallback(presented);
 for(const kind of ['waiting','stalled','error','playing','ended'])video.addEventListener(kind,()=>{events.push({kind,wall:performance.now(),time:video.currentTime});if(kind==='error'){errors.push('palace video');onError('palace video');}});
 const ready=new Promise((resolve,reject)=>{video.addEventListener('loadeddata',resolve,{once:true});video.addEventListener('error',()=>reject(Error('palace decode')),{once:true});});
 video.src=new URL(config.file,base).href;video.load();await ready;
 const cameras=await(await fetch(new URL(config.camera,base))).json();
 const canvas=document.createElement('canvas');canvas.width=1152;canvas.height=1268;canvas.readyState=4;
 const gl=canvas.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});if(!gl)throw Error('palace compositor WebGL unavailable');
 const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
 const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec2 p;varying vec2 uv;void main(){uv=(p+1.)*.5;gl_Position=vec4(p,0.,1.);}'));
 gl.attachShader(program,shader(gl.FRAGMENT_SHADER,`precision highp float;varying vec2 uv;uniform sampler2D bg;uniform sampler2D fg;uniform sampler2D old;uniform float mixOld;
 vec3 linear(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
 vec3 srgb(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),c));}
 void main(){vec2 c=vec2(uv.x*.5,uv.y),m=vec2(.5+uv.x*.5,uv.y);vec3 a=linear(texture2D(fg,c).rgb),t=texture2D(fg,m).rgb;
 if(mixOld>0.){a=mix(a,linear(texture2D(old,c).rgb),mixOld);t=mix(t,texture2D(old,m).rgb,mixOld);}
 gl_FragColor=vec4(clamp(srgb(a+t*linear(texture2D(bg,uv).rgb)),0.,1.),1.);}`));
 gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
 const at=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,2,gl.FLOAT,false,0,0);
 const textures=['bg','fg','old'].map((name,i)=>{gl.activeTexture(gl.TEXTURE0+i);const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);for(const k of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,k,gl.CLAMP_TO_EDGE);for(const k of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,k,gl.LINEAR);gl.uniform1i(gl.getUniformLocation(program,name),i);return t;});
 const upload=(i,v)=>{gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,textures[i]);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,v);};
 const thumbnail=document.createElement('canvas');thumbnail.width=144;thumbnail.height=158;const probe=thumbnail.getContext('2d',{willReadFrequently:true});
 const enabled=new URLSearchParams(location.search).has('jpaudit');
 const sample=(scene,foregroundFrame)=>{
  const f=Math.min(359,Math.round(presentedTime*30)),key=segment*1000000+loops*360+f;if(key===lastAudit)return;lastAudit=key;
  if(!enabled)return;
  probe.drawImage(video,0,0,144,158);const data=probe.getImageData(0,0,144,158).data;let sum=0;for(let i=0;i<data.length;i+=4)sum+=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];
  audit.push({wall:performance.now(),scene,foregroundFrame,clock,mediaTime:presentedTime,decoderTime:video.currentTime,loop:loops,segment,f,camera:cameras[f],luminance:sum/(144*158),thumbnail:thumbnail.toDataURL('image/jpeg',.85)});
 };
 return {canvas,video,audit,events,errors,
  advance(dt){clock+=dt;if(!manual&&video.paused)video.play().catch(e=>{onError(e.message);});},
  hidden(){visible=false;},
  render(current,previous,alpha,scene,frame){if(!visible){segment++;visible=true;}upload(0,video);upload(1,current);upload(2,previous??current);gl.uniform1f(gl.getUniformLocation(program,'mixOld'),previous?alpha:0);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);sample(scene,frame);return canvas;},
  setManual(on){manual=!!on;if(manual)video.pause();},
  async prepare(dt){if(!manual)return;const target=(clock+dt)%12;if(Math.abs(video.currentTime-target)<1e-4)return;await new Promise(resolve=>{video.addEventListener('seeked',resolve,{once:true});video.currentTime=target;});},
  diagnostics(){return {kind:'continuous_palace',time:video.currentTime,clock,loops,visible,segment,ready:video.readyState,src:video.currentSrc,errors:[...errors]};},
  dispose(){video.pause();video.removeAttribute('src');video.load();for(const t of textures)gl.deleteTexture(t);gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();},
 };
}
