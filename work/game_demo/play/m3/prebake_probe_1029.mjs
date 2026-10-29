import * as THREE from '../../web/vendor/three/three.module.js';
export async function loadCompactProbe(hr,url=new URL('./prebake_probe16_1029/manifest.json',import.meta.url)){
 const response=await fetch(url);if(!response.ok)throw Error('Compact probe manifest HTTP '+response.status);
 const d=await response.json(),p=hr.probes;
 if(p.nBases!==d.layers||d.texel_format!=='rgb9e5')throw Error('Compact probe dimensions');
 for(let i=0;i<d.source_ids.length;i++)if(p.sourceIndex.get(d.source_ids[i])!==d.source_layers[i])throw Error('Compact probe source mapping');
 const file=await fetch(new URL(d.file,url));if(!file.ok)throw Error('Compact probe data HTTP '+file.status);
 const data=await new Response(file.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 if(data.byteLength!==d.bytes)throw Error('Compact probe size');
 const basis=new THREE.DataArrayTexture(new Uint32Array(data),d.width,d.height,d.layers);
 basis.type=THREE.UnsignedInt5999Type;basis.format=THREE.RGBFormat;basis.internalFormat='RGB9_E5';basis.colorSpace=THREE.NoColorSpace;
 basis.minFilter=basis.magFilter=THREE.NearestFilter;basis.generateMipmaps=false;basis.needsUpdate=true;
 const atlas=new THREE.WebGLRenderTarget(d.width,d.height,{type:THREE.HalfFloatType,format:THREE.RGBAFormat,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:false});
 const mat=new THREE.ShaderMaterial({vertexShader:p.composeMat.vertexShader,fragmentShader:p.composeMat.fragmentShader,uniforms:{uBases:{value:basis},uW:{value:p.wTex},uN:{value:0}},depthTest:false,depthWrite:false,blending:THREE.NoBlending});
 const scene=new THREE.Scene(),mesh=new THREE.Mesh(hr._tri,mat);mesh.frustumCulled=false;scene.add(mesh);
 return {atlas,bytes:d.bytes,sourceBytes:p.bases.texture.image.data.byteLength,faceSize:d.face_size,tileSize:d.tile_size,
  compose(frame){
   const w=p.wData;let k=0;
   const add=(a,b,c,layer)=>{const o=k++*4;w[o]=a;w[o+1]=b;w[o+2]=c;w[o+3]=layer;};
   for(let i=0;i<8;i++){const a=frame.ea?.[i]??0,b=frame.eb?.[i]??0;if(a>1e-6)add(a,a,a,2*i);if(b>1e-6)add(b,b,b,2*i+1);}
   for(const [id,layer]of p.sourceIndex){const q=frame.q?.[id],v=q?.rgb??q;if(v&&v[0]+v[1]+v[2]>=1e-6)add(v[0],v[1],v[2],layer);}
   p.wTex.needsUpdate=true;mat.uniforms.uN.value=k;p.nActive=k;
   hr.renderer.setRenderTarget(atlas);hr.renderer.setViewport(0,0,d.width,d.height);hr.renderer.render(scene,p.cam);return k;
  },dispose(){basis.dispose();atlas.dispose();mat.dispose();}};
}
