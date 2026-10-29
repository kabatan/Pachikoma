// Comparison only: production palace shader/upload/center path with caller-owned
// paused background. No live timeline, new video, event dispatch, audit or warm.
import {PALACE_FRAGMENT} from './palace_gpu_shader_1029.mjs';
export function createContinuousRyuguBg({background,centerImages}){
 const canvas=document.createElement('canvas');canvas.width=1152;canvas.height=1268;canvas.readyState=4;
 const gl=canvas.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});
 if(!gl)throw Error('Baseline WebGL1 unavailable');
 const stats={draws:0,videoUploads:0,videoUploadSkips:0,contextsCreated:1};
 const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
 const program=gl.createProgram(),vs=shader(gl.VERTEX_SHADER,'attribute vec2 p;varying vec2 vPalaceUv;void main(){vPalaceUv=(p+1.)*.5;gl_Position=vec4(p,0.,1.);}'),fs=shader(gl.FRAGMENT_SHADER,PALACE_FRAGMENT);
 gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
 const names=['bg','fg','old','cF','cT','mixOld','bgOn','cOn','cDst','cScale','cGain','cCell','cSmear','cAtlas','cSize','cResid'];
 const locations=Object.fromEntries(names.map(n=>[n,gl.getUniformLocation(program,n)])),U=n=>locations[n];
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
 const at=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,2,gl.FLOAT,false,0,0);
 const textures=['bg','fg','old','cF','cT'].map((name,i)=>{gl.activeTexture(gl.TEXTURE0+i);const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);for(const k of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,k,gl.CLAMP_TO_EDGE);for(const k of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,k,gl.LINEAR);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,1,1,0,gl.RGB,gl.UNSIGNED_BYTE,new Uint8Array(3));gl.uniform1i(U(name),i);return t;});
 if(centerImages){for(const [i,image] of [[3,centerImages.F],[4,centerImages.T]]){gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,textures[i]);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);}gl.uniform2f(U('cAtlas'),centerImages.F.width,centerImages.F.height);gl.uniform2f(U('cSize'),...centerImages.meta.cell);}
 const uploaded=[];
 const upload=(i,v)=>{const key=v.currentTime;if(uploaded[i]?.v===v&&uploaded[i]?.key===key){stats.videoUploadSkips++;return;}uploaded[i]={v,key};stats.videoUploads++;gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,textures[i]);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,v);};
 const setCenter=c=>{if(!centerImages||!c){gl.uniform1f(U('cOn'),0);return;}const atlas=centerImages.meta,[w,h]=atlas.cell,cols=atlas.cols,cellXY=i=>[(i%cols)*w,Math.floor(i/cols)*h];const a=cellXY(c.cell),b=cellXY(c.cell+atlas.steps*7);gl.uniform1f(U('cOn'),1);gl.uniform2f(U('cDst'),c.x,c.y);gl.uniform1f(U('cScale'),c.scale);gl.uniform1f(U('cGain'),c.gain);gl.uniform4f(U('cCell'),a[0],a[1],b[0],b[1]);gl.uniform1f(U('cSmear'),c.smear);gl.uniform1f(U('cResid'),c.resid);};
 let disposed=false;
 return {canvas,gl,
  render({current,previous=null,mixOld=0,center=null,blackBg=false}){if(disposed)throw Error('Baseline disposed');gl.uniform1f(U('bgOn'),blackBg?0:1);setCenter(center);upload(0,background);upload(1,current);if(previous)upload(2,previous);gl.uniform1f(U('mixOld'),previous?mixOld:0);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);stats.draws++;return canvas;},
  diagnostics(){return {...stats};},
  dispose(){if(disposed)return;disposed=true;for(const t of textures)gl.deleteTexture(t);gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();}
 };
}
