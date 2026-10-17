// The same ball-light accumulator is evaluated by both environment surfaces.
// Keep its original loop/order, store float32 once, and reuse identical inputs.
import * as T from '../web/vendor/three/three.module.js';
function blockEnd(source,start){let level=0;for(let i=source.indexOf('{',start);i<source.length;i++){if(source[i]==='{')level++;if(source[i]==='}'){level--;if(level===0)return i+1;}}return -1;}
export function installSharedLightField(hr){
 const r=hr.renderer,update=hr._updateEnvUniforms.bind(hr),mats=[hr.envBack,hr.envFront],patched=new Set();
 const stats=hr.stats.sharedLightField={enabled:false,draws:0,reused:0,empty:0,fallbacks:0};
 if(!hr.gl.getExtension('EXT_color_buffer_float'))return;
 let target,scene,material,previous,previousLength=-1,valid=false;
 const scalar=['uBLn','uBLis'],vectors=['uBLr','uBLk','uBLi'],arrays=['uBLp','uBLc'];
 function setup(){
  if(!mats.every(m=>[...scalar,...vectors,...arrays].every(key=>m.uniforms[key])))return false;
  const source=mats[0],fs=source.fragmentShader,start=fs.indexOf('if (uBLn > 0)'),end=blockEnd(fs,start);
  if(!source.uniforms.uBLn||start<0||end<=start)return false;
  const block=fs.slice(start,end),reflection=block.match(/vec3 refl = max\(a\.rgb \+ b\.rgb, vec3\(([0-9.eE+-]+)\)\);/);
  if(!reflection||!block.includes('col += acc * refl;'))return false;
  const header=fs.slice(0,fs.indexOf('void main()'));
  const fieldBlock=block.replace(reflection[0],'').replace('col += acc * refl;','gl_FragColor = vec4(acc, 0.0);');
  target=new T.WebGLRenderTarget(1440,2560,{type:T.FloatType,format:T.RGBAFormat,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:false});
  material=new T.ShaderMaterial({vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:header+'\nvoid main(){ivec2 p=ivec2(gl_FragCoord.xy);'+fieldBlock+'else{gl_FragColor=vec4(0.0);}}',uniforms:source.uniforms,depthTest:false,depthWrite:false,blending:T.NoBlending});
  scene=new T.Scene();scene.add(hr._mk(material,0));previous=new Float32Array(source.uniforms.uBLp.value.length*8+16);
  for(const m of mats){
   const s=m.fragmentShader,a=s.indexOf('if (uBLn > 0)'),b=blockEnd(s,a);if(a<0||b<=a)continue;
   const original=s.slice(a,b),refl=original.match(/vec3 refl = max\(a\.rgb \+ b\.rgb, vec3\(([0-9.eE+-]+)\)\);/);if(!refl)continue;
   m.uniforms.uBLField={value:target.texture};m.uniforms.uBLFieldOn={value:0};
   const replacement='if(uBLFieldOn==1){if(uBLn>0){'+refl[0]+'col += texelFetch(uBLField,p,0).rgb * refl;}}else{'+original+'}';
   m.fragmentShader='uniform highp sampler2D uBLField;uniform int uBLFieldOn;\n'+s.slice(0,a)+replacement+s.slice(b);m.needsUpdate=true;patched.add(m);
  }
  stats.enabled=patched.size===2;return true;
 }
 function signature(u,put){
  for(const key of scalar)put(u[key].value);
  for(const key of vectors){const v=u[key].value;put(v.x);put(v.y);if('z'in v)put(v.z);if('w'in v)put(v.w);}
  for(let i=0;i<u.uBLn.value;i++)for(const key of arrays){const v=u[key].value[i];put(v.x);put(v.y);put(v.z);put(v.w);}
 }
 function matches(a,b){
  let at=0,same=true;signature(b,value=>{if(previous[at++]!==Math.fround(value))same=false;});return same&&at===previousLength;
 }
 hr._updateEnvUniforms=()=>{
  if(!target&&!setup()){update();return;}
  const u=mats[0].uniforms;let k=0,changed=!valid;
  signature(u,value=>{const v=Math.fround(value);if(previous[k]!==v)changed=true;previous[k++]=v;});changed||=k!==previousLength;previousLength=k;
  if(u.uBLn.value>0){
   if(changed){
    const old=r.getRenderTarget(),vp=new T.Vector4(),sc=new T.Vector4(),st=r.getScissorTest();r.getViewport(vp);r.getScissor(sc);
    try{r.setRenderTarget(target);r.setViewport(0,0,1440,2560);r.setScissorTest(false);r.render(scene,hr.fsCam);valid=true;stats.draws++;}
    finally{r.setRenderTarget(old);r.setViewport(vp);r.setScissor(sc);r.setScissorTest(st);}
   }else stats.reused++;
  }else stats.empty++;
  for(const m of mats)if(patched.has(m)){const use=valid&&matches(u,m.uniforms);m.uniforms.uBLFieldOn.value=use?1:0;if(!use&&m.uniforms.uBLn.value>0)stats.fallbacks++;}
  update();
 };
 const restore=()=>{valid=false;previousLength=-1;};r.domElement.addEventListener('webglcontextrestored',restore);
 const dispose=hr.dispose.bind(hr);hr.dispose=()=>{r.domElement.removeEventListener('webglcontextrestored',restore);target?.dispose();material?.dispose();dispose();};
}
