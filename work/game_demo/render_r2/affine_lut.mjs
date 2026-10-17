// The same tetrahedral interpolant as the reference LUT, stored as its affine
// coefficients. No grid reduction, trilinear substitution or colour grading.
import * as THREE from '../web/vendor/three/three.module.js';
export function affineLutData(raw,n){
  const size=n-1,data=new Float32Array(size*size*size*18*4);
  const values=raw instanceof Uint16Array?Float32Array.from(raw,THREE.DataUtils.fromHalfFloat):raw;
  const permutations=[[0,1,2],[0,2,1],[2,0,1],[1,0,2],[1,2,0],[2,1,0]];
  for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const base=x+n*(y+n*z),end=base+1+n+n*n;
    for(let t=0;t<6;t++){
      const [hi,mid,lo]=permutations[t],stride=[1,n,n*n],v1=base+stride[hi],v2=v1+stride[mid];
      for(let row=0;row<3;row++){
        const i=(((z*18+t*3+row)*size+y)*size+x)*4;
        data[i+hi]=values[v1*4+row]-values[base*4+row];
        data[i+mid]=values[v2*4+row]-values[v1*4+row];
        data[i+lo]=values[end*4+row]-values[v2*4+row];
        data[i+3]=values[base*4+row];
      }
    }
  }
  return {data,width:size,height:size,depth:size*18};
}
export function installAffineLut(hr){
  const n=hr.lut.size,stats=hr.stats.affineLut={enabled:false,sameTetrahedra:true};
  if((n-1)*18>hr.gl.getParameter(hr.gl.MAX_3D_TEXTURE_SIZE))return;
  const m=hr.finalMat,a=m.fragmentShader.indexOf('  vec3 c000 = lutFetch('),b=m.fragmentShader.indexOf('  return lutPost(r);',a);
  if(a<0||b<0)throw new Error('Affine LUT shader contract changed');
  const {data,width,height,depth}=affineLutData(hr.lut.texture.image.data,n),texture=new THREE.Data3DTexture(data,width,height,depth);
  texture.format=THREE.RGBAFormat;texture.type=THREE.FloatType;texture.minFilter=texture.magFilter=THREE.NearestFilter;
  texture.wrapS=texture.wrapT=texture.wrapR=THREE.ClampToEdgeWrapping;texture.generateMipmaps=false;texture.unpackAlignment=1;texture.needsUpdate=true;
  m.uniforms.uAffineLut={value:texture};
  m.fragmentShader=m.fragmentShader.slice(0,a)+`
  bool xy=f.x>=f.y,xz=f.x>=f.z,yz=f.y>=f.z;
  int tetra=xy?(yz?0:(xz?1:2)):(xz?3:(yz?4:5));
  ivec3 q=ivec3(i0.x,i0.y,i0.z*18+tetra*3);
  vec4 p4=vec4(f,1.0);
  vec3 r=vec3(dot(texelFetch(uAffineLut,q,0),p4),dot(texelFetch(uAffineLut,q+ivec3(0,0,1),0),p4),dot(texelFetch(uAffineLut,q+ivec3(0,0,2),0),p4));
`+m.fragmentShader.slice(b);
  m.fragmentShader='uniform highp sampler3D uAffineLut;\n'+m.fragmentShader;m.needsUpdate=true;
  Object.assign(stats,{enabled:true,bytes:data.byteLength,fetches:3});
  const dispose=hr.dispose.bind(hr);hr.dispose=()=>{texture.dispose();dispose();};
}
