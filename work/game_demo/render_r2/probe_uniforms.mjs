// The existing Float32 weights are uniform across the entire probe atlas.
// Supply the same bits through a vec4 array instead of fetching a texture for
// every atlas pixel/term. Keep basis fetches, loop order and arithmetic intact.
export function installProbeUniforms(hr){
 const p=hr.probes,mat=p.composeMat,max=hr.gl.getParameter(hr.gl.MAX_FRAGMENT_UNIFORM_VECTORS),capacity=16+p.sourceIndex.size;
 const stats=hr.stats.probeUniforms={enabled:false,capacity,maxVectors:max,draws:0,fallbacks:0};
 if(capacity>max-16||p.wData.length<capacity*4)return;
 const original=mat.fragmentShader,decl='uniform highp sampler2D uW;',fetch='vec4 w = texelFetch(uW, ivec2(k, 0), 0);';
 if(!original.includes(decl)||!original.includes(fetch))return;
 let view=p.wData.subarray(0,capacity*4),disabled=false;
 mat.fragmentShader=original.replace(decl,`uniform vec4 uWeights[${capacity}];`).replace(fetch,'vec4 w = uWeights[k];');
 mat.uniforms.uWeights={value:view};mat.needsUpdate=true;stats.enabled=true;
 const meshes=p.sCompose.children.filter(m=>m.material===mat),hooks=[];
 for(const mesh of meshes){
  const before=mesh.onBeforeRender;
  const wrapper=function(...args){
   before.apply(this,args);if(disabled)return;
   if(mat.uniforms.uN.value>capacity||p.wData.length<capacity*4){
    disabled=true;stats.enabled=false;stats.fallbacks++;mat.fragmentShader=original;mat.needsUpdate=true;return;
   }
   if(view.buffer!==p.wData.buffer||view.byteOffset!==p.wData.byteOffset){view=p.wData.subarray(0,capacity*4);mat.uniforms.uWeights.value=view;}
   mat.uniformsNeedUpdate=true;stats.draws++;
  };
  mesh.onBeforeRender=wrapper;hooks.push({mesh,before,wrapper});
 }
 const dispose=hr.dispose.bind(hr);hr.dispose=()=>{for(const a of hooks)if(a.mesh.onBeforeRender===a.wrapper)a.mesh.onBeforeRender=a.before;dispose();};
}
