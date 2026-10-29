// Cache the same linear environment expression separately from dynamic ball/wash
// lights. A common intensity factor reuses the same normalized basis.
import * as T from '../web/vendor/three/three.module.js';
const EA=['uEaLo','uEaHi','uEbLo','uEbHi'],TEX=['uA','uB','uM0','uM1','uR2Detail'];
// Uniform objects are supplied explicitly below. Avoid cloning render textures
// and the full light arrays only to immediately replace those unused copies.
const cloneShader=m=>new T.ShaderMaterial().copy({...m,uniforms:{}});
export function installEnvironmentBasis(hr){
 if(!hr.gl.getExtension('EXT_color_buffer_float'))return;
 const r=hr.renderer,records=[],stats=hr.stats.environmentBasis={baked:0,reused:0,dynamic:0,reflections:0};
 const rt=()=>new T.WebGLRenderTarget(1440,2560,{type:T.FloatType,format:T.RGBAFormat,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:false});
 for(const scene of [hr.sBack,hr.sFront])for(const mesh of scene.children)if(mesh.material?.uniforms?.uEaLo&&mesh.material.uniforms.uA){
  records.push({mesh,source:mesh.material,baseRT:rt(),reflectRT:null,values:[],textures:[],versions:[],valid:false,reflectValid:false,stable:0,sourceVersion:-1});
 }
 function rebuild(a){
  const m=a.source,fs=m.fragmentShader,col='vec3 col = wa * a.rgb + wb * b.rgb;',reflect=fs.match(/vec3 refl = max\(a\.rgb \+ b\.rgb, vec3\(([0-9.eE+-]+)\)\);/);
  const supported=Object.keys(m.uniforms).every(k=>EA.includes(k)||TEX.includes(k)||k.startsWith('uBL'));
  if(!supported||m.uniforms.uBLn&&(!fs.includes(col)||!reflect)){a.disabled=true;return;}
  a.disabled=false;a.sourceVersion=m.version;a.sourceShader=fs;
  a.baseMat?.dispose();a.dynamicMat?.dispose();a.reflectMat?.dispose();
  const baseUniforms={...m.uniforms};for(const key of EA)baseUniforms[key]={value:m.uniforms[key].value.clone()};
  a.baseMat=cloneShader(m);a.baseMat.uniforms=baseUniforms;a.baseMat.blending=T.NoBlending;
  a.baseMat.fragmentShader=fs.replace(/if\s*\(uBLn\s*>\s*0\)/g,'if(false)');
  a.baseScene=new T.Scene();const bm=new T.Mesh(a.mesh.geometry,a.baseMat);bm.frustumCulled=false;a.baseScene.add(bm);
  a.dynamicMat=cloneShader(m);a.dynamicMat.uniforms={...m.uniforms,uCachedBase:{value:a.baseRT.texture},uBaseScale:{value:1}};
  if(reflect){
   a.reflectRT??=rt();a.dynamicMat.uniforms.uCachedReflect={value:a.reflectRT.texture};
   a.reflectMat=cloneShader(m);a.reflectMat.uniforms=m.uniforms;a.reflectMat.blending=T.NoBlending;
   a.reflectMat.fragmentShader=fs.slice(0,fs.indexOf(col))+reflect[0]+'\ngl_FragColor=vec4(refl,0.0);\n}';
   a.reflectScene=new T.Scene();const rm=new T.Mesh(a.mesh.geometry,a.reflectMat);rm.frustumCulled=false;a.reflectScene.add(rm);
   a.dynamicMat.fragmentShader='uniform highp sampler2D uCachedBase,uCachedReflect;uniform float uBaseScale;\n'+fs.replace(col,'vec3 col = texelFetch(uCachedBase,p,0).rgb * uBaseScale;').replace(reflect[0],'vec3 refl = texelFetch(uCachedReflect,p,0).rgb;');
  }else{
   a.dynamicMat.fragmentShader='uniform highp sampler2D uCachedBase;uniform float uBaseScale;void main(){gl_FragColor=texelFetch(uCachedBase,ivec2(gl_FragCoord.xy),0)*vec4(vec3(uBaseScale),1.0);}';
  }
  a.valid=false;a.reflectValid=false;a.stable=0;a.values=[];a.textures=[];a.versions=[];
 }
 function bake(target,scene){
  const previous=r.getRenderTarget(),vp=new T.Vector4(),sc=new T.Vector4(),test=r.getScissorTest();r.getViewport(vp);r.getScissor(sc);
  try{r.setRenderTarget(target);r.setViewport(0,0,1440,2560);r.setScissorTest(false);r.render(scene,hr.fsCam);}
  finally{r.setRenderTarget(previous);r.setViewport(vp);r.setScissor(sc);r.setScissorTest(test);}
 }
 const update=hr._updateEnvUniforms.bind(hr);
 hr._updateEnvUniforms=()=>{
  update();
  for(const a of records){
   if(a.sourceVersion!==a.source.version||a.sourceShader!==a.source.fragmentShader)rebuild(a);
   if(a.disabled){a.mesh.material=a.source;continue;}
   const u=a.source.uniforms,values=[];let scale=0;
   for(const key of EA)for(const c of ['x','y','z','w']){const value=Math.fround(u[key].value[c]);values.push(value);scale=Math.max(scale,Math.abs(value));}
   let changed=false,textureChanged=false,k=0;
   for(const key of TEX){const t=u[key]?.value;if(!t)continue;if(a.textures[k]!==t||a.versions[k]!==t.version){a.textures[k]=t;a.versions[k]=t.version;textureChanged=true;}k++;}
   if(textureChanged){a.valid=false;a.reflectValid=false;changed=true;}
   if(scale>0){
    for(let i=0;i<values.length;i++){values[i]=Math.fround(values[i]/scale);if(values[i]!==a.values[i])changed=true;}
    if(changed){a.values=values;a.valid=false;a.stable=0;}else a.stable++;
   }
   a.dynamicMat.uniforms.uBaseScale.value=scale;
   if(!a.valid&&scale>0&&a.stable>=2){
    let i=0;for(const key of EA){a.baseMat.uniforms[key].value.fromArray(a.values,i);i+=4;}
    bake(a.baseRT,a.baseScene);a.valid=true;stats.baked++;
   }
   if(a.valid){
    if(a.reflectRT&&!a.reflectValid){bake(a.reflectRT,a.reflectScene);a.reflectValid=true;stats.reflections++;}
    a.mesh.material=a.dynamicMat;stats.reused++;
   }else{a.mesh.material=a.source;stats.dynamic++;}
  }
 };
 const restore=()=>{for(const a of records){a.valid=false;a.reflectValid=false;a.stable=0;}};r.domElement.addEventListener('webglcontextrestored',restore);
 const dispose=hr.dispose.bind(hr);hr.dispose=()=>{r.domElement.removeEventListener('webglcontextrestored',restore);for(const a of records){a.mesh.material=a.source;a.baseRT.dispose();a.reflectRT?.dispose();a.baseMat?.dispose();a.dynamicMat?.dispose();a.reflectMat?.dispose();}dispose();};
}
