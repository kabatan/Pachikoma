// Isolated prototype: disjoint native sum tiles share one half-float target.
// Each tile keeps the original ordered source layers and blend operations.
import * as T from '../web/vendor/three/three.module.js';
import {packSumTiles,installSumAtlas} from './sum_atlas.mjs';
const put4=(a,o,x,y,z,w)=>{a[o]=x;a[o+1]=y;a[o+2]=z;a[o+3]=w;};
function makeFilterRamp(){
 const one=0x3c00,t=new T.DataTexture(new Uint16Array([0,0,0,one,one,0,0,one,0,one,0,one,one,one,0,one]),2,2,T.RGBAFormat,T.HalfFloatType);
 t.minFilter=t.magFilter=T.LinearFilter;t.needsUpdate=true;return t;
}
// Determine the actual half-float sampler's coefficient grid and idempotence.
// Unsupported precision keeps the existing per-bank renderer, without a
// lower-quality sampling approximation or vendor-specific assumptions.
function verifyFilterGrid(hr,ramp,width,height){
 if(!hr.gl.getExtension('EXT_color_buffer_float'))return false;
 const r=hr.renderer,scale=2**(24-Math.ceil(Math.log2(Math.max(width,height)))),target=new T.WebGLRenderTarget(256,1,{type:T.FloatType,format:T.RGBAFormat,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:false});
 const geo=new T.BufferGeometry();geo.setAttribute('position',new T.BufferAttribute(new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),3));
 const mat=new T.ShaderMaterial({vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:'uniform highp sampler2D uFilterRamp;void main(){float x=gl_FragCoord.x;vec2 f=vec2((x+0.37)/257.0,(x*0.37+0.11)/257.0);vec2 a=texture(uFilterRamp,(f+0.5)*0.5).rg;vec2 b=texture(uFilterRamp,(a+0.5)*0.5).rg;gl_FragColor=vec4(a,b);}',uniforms:{uFilterRamp:{value:ramp}},depthTest:false,depthWrite:false,blending:T.NoBlending});
 const scene=new T.Scene(),mesh=new T.Mesh(geo,mat);mesh.frustumCulled=false;scene.add(mesh);
 const old=r.getRenderTarget(),vp=new T.Vector4(),sc=new T.Vector4(),st=r.getScissorTest(),pixels=new Float32Array(256*4);r.getViewport(vp);r.getScissor(sc);
 try{r.setRenderTarget(target);r.setViewport(0,0,256,1);r.setScissorTest(false);r.render(scene,hr.fsCam);r.readRenderTargetPixels(target,0,0,256,1,pixels);}
 finally{r.setRenderTarget(old);r.setViewport(vp);r.setScissor(sc);r.setScissorTest(st);target.dispose();geo.dispose();mat.dispose();}
 let maxR=0,maxG=0;
 for(let i=0;i<256;i++){
  const a=pixels[i*4],b=pixels[i*4+1];maxR=Math.max(maxR,a);maxG=Math.max(maxG,b);
  if(!Number.isFinite(a)||!Number.isFinite(b)||!Number.isInteger(a*scale)||!Number.isInteger(b*scale)||a!==pixels[i*4+2]||b!==pixels[i*4+3])return false;
 }
 return maxR>0.8&&maxG>0.2;
}
export function installGlobalSumAtlas(hr){
 const r=hr.renderer,records=[],items=[];
 for(const side of ['back','front'])for(const b of hr.layerBuckets[side]){
  const mappings=b.mappings.filter(m=>m.sumLayer>=0);if(!mappings.length)continue;
  const start=items.length;items.push(...mappings.map(m=>m.entry.resolution));records.push({b,mappings,start});
 }
 const maxSources=hr.gl.getParameter(hr.gl.MAX_TEXTURE_IMAGE_UNITS),pack=packSumTiles(items,hr.gl.getParameter(hr.gl.MAX_TEXTURE_SIZE));
 for(const a of records)a.oldPack=packSumTiles(a.mappings.map(m=>m.entry.resolution),hr.gl.getParameter(hr.gl.MAX_TEXTURE_SIZE));
 if(!records.length||records.length>maxSources||!pack||records.some(a=>!a.oldPack)){installSumAtlas(hr);hr.stats.sumAtlas.unified=false;return;}
 const ramp=makeFilterRamp();
 if(!verifyFilterGrid(hr,ramp,pack.width,pack.height)){ramp.dispose();installSumAtlas(hr);hr.stats.sumAtlas.unified=false;hr.stats.sumAtlas.filterGridRejected=true;return;}
 const stats=hr.stats.sumAtlas={unified:true,filterGridVerified:true,banks:records.length,draws:0,clears:0,pixels:0,width:pack.width,height:pack.height};
 const target=new T.WebGLRenderTarget(pack.width,pack.height,{type:T.HalfFloatType,format:T.RGBAFormat,minFilter:T.LinearFilter,magFilter:T.LinearFilter,depthBuffer:false});
 const tables=[];
 for(const a of records){
  const {b,mappings,start}=a,offsets=new Float32Array(Math.max(1,b.sumRT.depth||mappings.length)*4);
  mappings.forEach((m,i)=>offsets.set([...pack.tiles[start+i].slice(0,2),...a.oldPack.tiles[i].slice(0,2)],m.sumLayer*4));
  const table=new T.DataTexture(offsets,offsets.length/4,1,T.RGBAFormat,T.FloatType);table.minFilter=table.magFilter=T.NearestFilter;table.needsUpdate=true;tables.push(table);
  for(const scene of [hr.sBack,hr.sFront])for(const mesh of scene.children)if(mesh.geometry===b.geo){
   const mat=mesh.material;
   if(!mat.fragmentShader.includes('texture(uSum, vec3(p / uSumSize, vTile.x))')||!mat.vertexShader.includes('vTile = aTile.xy;'))throw new Error('Global sum shader contract changed');
   const sample='vec4 r2SumSample(vec2 p){vec2 old=p+vOldTile;vec2 w=texture(uSumFilterRamp,(fract(old-0.5)+0.5)*0.5).rg;vec2 at=floor(old-0.5)-vOldTile+vTile+0.5+w;return texture(uSum,at/uSumSize);}\n';
   mat.fragmentShader='uniform highp sampler2D uSumFilterRamp;flat varying vec2 vOldTile;\n'+mat.fragmentShader.replace('sampler2DArray uSum','sampler2D uSum').replace('texture(uSum, vec3(p / uSumSize, vTile.x))','r2SumSample(p)').replace('void main() {',sample+'void main() {');
   mat.vertexShader='uniform highp sampler2D uSumOffsets;flat varying vec2 vOldTile;\n'+mat.vertexShader.replace('vTile = aTile.xy;','vec4 offsets=texelFetch(uSumOffsets,ivec2(int(aTile.x),0),0);vTile=offsets.xy;vOldTile=offsets.zw;');
   mat.uniforms.uSum.value=target.texture;mat.uniforms.uSumSize.value.set(pack.width,pack.height);mat.uniforms.uSumOffsets={value:table};mat.uniforms.uSumFilterRamp={value:ramp};mat.needsUpdate=true;
  }
 }
 const geo=new T.InstancedBufferGeometry();geo.setIndex(records[0].b.sumGeo.index);geo.setAttribute('position',records[0].b.sumGeo.attributes.position);
 const capacity=records.reduce((n,a)=>n+a.b.n,0);
 for(const key of ['aRect','aTex','aW']){const attr=new T.InstancedBufferAttribute(new Float32Array(capacity*4),4);attr.setUsage(T.DynamicDrawUsage);geo.setAttribute(key,attr);}
 const uniforms={};records.forEach((a,i)=>uniforms['uTex'+i]=a.b.sumMat.uniforms.uTex);
 const declarations=records.map((_,i)=>'uniform highp sampler2DArray uTex'+i+';').join('\n');
 const fetches=records.map((_,i)=>(i?'else ':'')+`if(vTex.y==${i}.0)t=texelFetch(uTex${i},ivec3(p,int(vTex.x)),0).rgb;`).join('\n');
 const mat=new T.ShaderMaterial({vertexShader:`attribute vec4 aRect,aTex,aW;flat varying vec4 vRect,vTex;flat varying vec3 vW;void main(){vec2 p=aRect.xy+position.xy*aRect.zw;gl_Position=vec4(p/vec2(${pack.width}.0,${pack.height}.0)*2.-1.,0.,1.);vRect=aRect;vTex=aTex;vW=aW.rgb;}`,
  fragmentShader:declarations+'\nflat varying vec4 vRect,vTex;flat varying vec3 vW;void main(){ivec2 p=ivec2(gl_FragCoord.xy)-ivec2(vRect.xy);vec3 t=vec3(0.0);'+fetches+'gl_FragColor=vec4(t*vW,0.0);}',
  uniforms,depthTest:false,depthWrite:false,side:T.DoubleSide,blending:T.CustomBlending,blendEquation:T.AddEquation,blendSrc:T.OneFactor,blendDst:T.OneFactor,blendSrcAlpha:T.OneFactor,blendDstAlpha:T.OneFactor});
 const scene=new T.Scene(),mesh=new T.Mesh(geo,mat);mesh.frustumCulled=false;scene.add(mesh);
 const update=hr._updateLayers.bind(hr);
 hr._updateLayers=()=>{
  update();if(!hr._sumDirty)return;
  const dirty=[];let n=0;
  records.forEach((a,bank)=>{
   for(let k=0;k<a.mappings.length;k++){
    const m=a.mappings[k];if(!m.sumActive||!(m.dirty||hr._layerDiagnostics?.uncachedSums))continue;
    const tile=pack.tiles[a.start+k];dirty.push({m,tile});
    for(const i of m.indices){const rec=a.b.records[i];if(!rec.active)continue;const o=n++*4;
     geo.attributes.aRect.array.set(tile,o);put4(geo.attributes.aTex.array,o,i,bank,0,0);put4(geo.attributes.aW.array,o,rec.w0,rec.w1,rec.w2,0);
    }
   }
  });
  if(!n)return;
  const old=r.getRenderTarget(),vp=new T.Vector4(),sc=new T.Vector4(),st=r.getScissorTest(),color=new T.Color(),alpha=r.getClearAlpha();r.getViewport(vp);r.getScissor(sc);r.getClearColor(color);
  try{
   r.setRenderTarget(target);r.setViewport(0,0,pack.width,pack.height);r.setScissorTest(true);r.setClearColor(0,0);
   for(const {tile}of dirty){r.setScissor(...tile);r.clear(true,false,false);stats.clears++;stats.pixels+=tile[2]*tile[3];}
   r.setScissorTest(false);geo.instanceCount=n;
   for(const attr of Object.values(geo.attributes))if(attr.isInstancedBufferAttribute){attr.clearUpdateRanges();attr.addUpdateRange(0,n*4);attr.needsUpdate=true;}
   r.render(scene,hr.fsCam);stats.draws++;for(const {m}of dirty)m.dirty=false;
  }finally{r.setRenderTarget(old);r.setViewport(vp);r.setScissor(sc);r.setScissorTest(st);r.setClearColor(color,alpha);}
 };
 const dispose=hr.dispose.bind(hr);hr.dispose=()=>{target.dispose();ramp.dispose();for(const table of tables)table.dispose();geo.dispose();mat.dispose();dispose();};
}
