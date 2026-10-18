// Lossless native half-float mask packing. Unsupported assets keep their shader.
import * as T from '../web/vendor/three/three.module.js';
const HALF_INDEX=[0,0x3c00,0x4000,0x4200,0x4400,0x4500,0x4600,0x4700];
export function packEnvironmentMasks(a,b,width,height){
 const n=width*height;
 if(!(a instanceof Uint16Array)||!(b instanceof Uint16Array)||a.length!==n*4||b.length!==n*4)return null;
 const values=new Uint16Array(n*2);let constant=-1;
 for(let p=0;p<n;p++){
  let index=-1,weight=0;
  for(let k=0;k<8;k++){
   const bits=(k<4?a:b)[p*4+(k&3)];
   if((bits&0x7c00)===0x7c00||bits===0x8000)return null;
   if(bits&0x7fff){if(index>=0)return null;index=k;weight=bits;}
  }
  if(index>=0){if(constant===-1)constant=index;else if(constant!==index)constant=-2;}
  values[p*2]=weight;values[p*2+1]=HALF_INDEX[Math.max(0,index)];
 }
 if(constant>=-1){const data=new Uint16Array(n);for(let p=0;p<n;p++)data[p]=values[p*2];return {data,constant:Math.max(0,constant),channels:1};}
 return {data:values,constant:null,channels:2};
}
export function installCompactEnvironmentMasks(hr){
 const cache=new Map(),textures=[],materials=new Set();
 for(const scene of [hr.sBack,hr.sFront])for(const mesh of scene.children)if(mesh.material)materials.add(mesh.material);
 const stats=hr.stats.compactEnvironmentMasks={pairs:0,materials:0,fallbacks:0,sourceBytes:0,packedBytes:0};
 const original='vec4 m0 = texelFetch(uM0, q, 0), m1 = texelFetch(uM1, q, 0);\n        float wa = dot(m0, uEaLo) + dot(m1, uEaHi);\n        float wb = dot(m0, uEbLo) + dot(m1, uEbHi);';
 for(const m of materials){
  const a=m.uniforms?.uM0?.value,b=m.uniforms?.uM1?.value;if(!a||!b)continue;
  if(!m.fragmentShader.includes(original)||!m.fragmentShader.includes('void main() {')){stats.fallbacks++;continue;}
  let byB=cache.get(a);if(!byB){byB=new Map();cache.set(a,byB);}
  let packed=byB.get(b);
  if(packed===undefined){
   const ai=a.image,bi=b.image;
   const supported=a.type===T.HalfFloatType&&b.type===T.HalfFloatType&&a.format===T.RGBAFormat&&b.format===T.RGBAFormat&&ai.width===bi.width&&ai.height===bi.height&&a.minFilter===T.NearestFilter&&a.magFilter===T.NearestFilter&&b.minFilter===T.NearestFilter&&b.magFilter===T.NearestFilter;
   packed=supported?packEnvironmentMasks(ai.data,bi.data,ai.width,ai.height):null;
   if(packed){
    const tex=new T.DataTexture(packed.data,ai.width,ai.height,packed.channels===1?T.RedFormat:T.RGFormat,T.HalfFloatType);
    tex.minFilter=tex.magFilter=T.NearestFilter;tex.generateMipmaps=false;tex.unpackAlignment=1;tex.needsUpdate=true;
    packed.texture=tex;textures.push(tex);stats.pairs++;stats.sourceBytes+=ai.data.byteLength+bi.data.byteLength;stats.packedBytes+=packed.data.byteLength;
   }
   byB.set(b,packed);
  }
  if(!packed){stats.fallbacks++;continue;}
  const index=packed.channels===1?String(packed.constant):'int(r2Mask.g)';
  const replacement=`vec2 r2Mask=texelFetch(uR2Mask,q,0).rg; int r2Zone=${index};\n        float wa=r2Mask.r*(r2Zone<4?uEaLo[r2Zone]:uEaHi[r2Zone-4]);\n        float wb=r2Mask.r*(r2Zone<4?uEbLo[r2Zone]:uEbHi[r2Zone-4]);`;
  m.fragmentShader=m.fragmentShader.replace('void main() {','uniform highp sampler2D uR2Mask;\nvoid main() {').replace(original,replacement);
  m.uniforms.uR2Mask={value:packed.texture};m.needsUpdate=true;stats.materials++;
 }
 const dispose=hr.dispose.bind(hr);hr.dispose=()=>{for(const texture of textures)texture.dispose();dispose();};
}
