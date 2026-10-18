// Candidate only: native-resolution half-float sum tiles, ordered as before.
import * as T from '../web/vendor/three/three.module.js';
const pow2=n=>2**Math.ceil(Math.log2(Math.max(1,n)));
function put4(a,o,x,y,z,w){a[o]=x;a[o+1]=y;a[o+2]=z;a[o+3]=w;}
export function packSumTiles(items,limit){
 if(!items.length)return {width:1,height:1,tiles:[]};
 const order=items.map((e,i)=>({i,w:e[0],h:e[1]})).sort((a,b)=>b.h-a.h||a.i-b.i);
 let width=pow2(Math.max(...items.map(e=>e[0]),Math.ceil(Math.sqrt(items.reduce((s,e)=>s+e[0]*e[1],0)))));
 for(;width<=limit;width*=2){
  const tiles=[];let x=0,y=0,row=0;
  for(const e of order){if(x+e.w>width){x=0;y+=row;row=0;}tiles[e.i]=[x,y,e.w,e.h];x+=e.w;row=Math.max(row,e.h);}
  const height=pow2(y+row);if(height<=limit)return {width,height,tiles};
 }
 return null;
}
export function installSumAtlas(hr){
 const r=hr.renderer,records=[],limit=hr.gl.getParameter(hr.gl.MAX_TEXTURE_SIZE);
 const stats=hr.stats.sumAtlas={banks:0,draws:0,clears:0,pixels:0};
 for(const side of ['back','front'])for(const b of hr.layerBuckets[side]){
  const mappings=b.mappings.filter(m=>m.sumLayer>=0);if(!mappings.length)continue;
  const pack=packSumTiles(mappings.map(m=>m.entry.resolution),limit);if(!pack)continue;
  const target=new T.WebGLRenderTarget(pack.width,pack.height,{type:T.HalfFloatType,format:T.RGBAFormat,minFilter:T.LinearFilter,magFilter:T.LinearFilter,depthBuffer:false});
  const offsets=new Float32Array(Math.max(1,b.sumRT.depth||mappings.length)*4);
  mappings.forEach((m,i)=>offsets.set(pack.tiles[i].slice(0,2),m.sumLayer*4));
  const table=new T.DataTexture(offsets,offsets.length/4,1,T.RGBAFormat,T.FloatType);table.minFilter=table.magFilter=T.NearestFilter;table.needsUpdate=true;
  for(const scene of [hr.sBack,hr.sFront])for(const mesh of scene.children)if(mesh.geometry===b.geo){
   const mat=mesh.material;
   if(!mat.fragmentShader.includes('texture(uSum, vec3(p / uSumSize, vTile.x))')||!mat.vertexShader.includes('vTile = aTile.xy;'))throw new Error('Sum atlas shader contract changed');
   mat.fragmentShader=mat.fragmentShader.replace('sampler2DArray uSum','sampler2D uSum').replace('texture(uSum, vec3(p / uSumSize, vTile.x))','texture(uSum, (p + vTile.xy) / uSumSize)');
   mat.vertexShader='uniform highp sampler2D uSumOffsets;\n'+mat.vertexShader.replace('vTile = aTile.xy;','vTile = texelFetch(uSumOffsets,ivec2(int(aTile.x),0),0).xy;');
   mat.uniforms.uSum.value=target.texture;mat.uniforms.uSumSize.value.set(pack.width,pack.height);mat.uniforms.uSumOffsets={value:table};mat.needsUpdate=true;
  }
  const geo=new T.InstancedBufferGeometry();geo.setIndex(b.sumGeo.index);geo.setAttribute('position',b.sumGeo.attributes.position);
  for(const key of ['aRect','aTex','aW']){const attr=new T.InstancedBufferAttribute(new Float32Array(b.n*4),4);attr.setUsage(T.DynamicDrawUsage);geo.setAttribute(key,attr);}
  const mat=new T.ShaderMaterial({vertexShader:`attribute vec4 aRect,aTex,aW;flat varying vec4 vRect,vTex;flat varying vec3 vW;void main(){vec2 p=aRect.xy+position.xy*aRect.zw;gl_Position=vec4(p/vec2(${pack.width}.0,${pack.height}.0)*2.-1.,0.,1.);vRect=aRect;vTex=aTex;vW=aW.rgb;}`,
   fragmentShader:'uniform highp sampler2DArray uTex;flat varying vec4 vRect,vTex;flat varying vec3 vW;void main(){ivec2 p=ivec2(gl_FragCoord.xy)-ivec2(vRect.xy);gl_FragColor=vec4(texelFetch(uTex,ivec3(p,int(vTex.x)),0).rgb*vW,0.);}',
   uniforms:{uTex:b.sumMat.uniforms.uTex},depthTest:false,depthWrite:false,side:T.DoubleSide,blending:T.CustomBlending,blendEquation:T.AddEquation,blendSrc:T.OneFactor,blendDst:T.OneFactor,blendSrcAlpha:T.OneFactor,blendDstAlpha:T.OneFactor});
  const scene=new T.Scene(),mesh=new T.Mesh(geo,mat);mesh.frustumCulled=false;scene.add(mesh);
  records.push({b,mappings,pack,target,table,geo,mat,scene});stats.banks++;
 }
 const update=hr._updateLayers.bind(hr);
 hr._updateLayers=()=>{
  update();if(!hr._sumDirty||!records.length)return;
  const old=r.getRenderTarget(),vp=new T.Vector4(),sc=new T.Vector4(),st=r.getScissorTest(),color=new T.Color(),alpha=r.getClearAlpha();r.getViewport(vp);r.getScissor(sc);r.getClearColor(color);
  try{
   for(const a of records){
    const dirty=[];let n=0;
    for(let k=0;k<a.mappings.length;k++){
     const m=a.mappings[k];if(!m.sumActive||!(m.dirty||hr._layerDiagnostics?.uncachedSums))continue;
     dirty.push(m);const tile=a.pack.tiles[k];
     for(const i of m.indices){const rec=a.b.records[i];if(!rec.active)continue;const o=n++*4;
      a.geo.attributes.aRect.array.set(tile,o);put4(a.geo.attributes.aTex.array,o,i,0,0,0);put4(a.geo.attributes.aW.array,o,rec.w0,rec.w1,rec.w2,0);
     }
    }
    if(!n)continue;
    r.setRenderTarget(a.target);r.setViewport(0,0,a.pack.width,a.pack.height);r.setScissorTest(true);r.setClearColor(0,0);
    for(let k=0;k<a.mappings.length;k++)if(dirty.includes(a.mappings[k])){r.setScissor(...a.pack.tiles[k]);r.clear(true,false,false);stats.clears++;stats.pixels+=a.pack.tiles[k][2]*a.pack.tiles[k][3];}
    r.setScissorTest(false);a.geo.instanceCount=n;for(const attr of Object.values(a.geo.attributes))if(attr.isInstancedBufferAttribute){attr.clearUpdateRanges();attr.addUpdateRange(0,n*4);attr.needsUpdate=true;}
    r.render(a.scene,hr.fsCam);stats.draws++;for(const m of dirty)m.dirty=false;
   }
  }finally{r.setRenderTarget(old);r.setViewport(vp);r.setScissor(sc);r.setScissorTest(st);r.setClearColor(color,alpha);}
  // Unsupported banks retain their original path. Completed atlas mappings are
  // clean, so the original sum loop will only visit those fallback banks.
 };
 const dispose=hr.dispose.bind(hr);hr.dispose=()=>{for(const a of records){a.target.dispose();a.table.dispose();a.geo.dispose();a.mat.dispose();}dispose();};
}
