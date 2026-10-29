// Approved F1: native D/MSAA unchanged; retain legacy rtC allocation/fallback.
import * as THREE from '../vendor/three/three.module.js';
// Generated from frozen ball_light with owned BL44/earlyClip. CPU objects only.
const KNOWN_FRONT_SHADER="\n      uniform highp sampler2D uA, uB, uM0, uM1;\n      uniform vec4 uEaLo, uEaHi, uEbLo, uEbHi;\n      uniform int uBLn; uniform vec4 uBLp[44]; uniform vec4 uBLc[44]; uniform vec4 uBLr; uniform vec2 uBLk; uniform vec4 uBLi; uniform float uBLis;\nuniform int uBLEarlySafe;\nvoid main() {\n        ivec2 p = ivec2(gl_FragCoord.xy);\n        ivec2 q = ivec2(p.x, 2559 - p.y);               // 素材は行0=画像の上\n        vec4 m0 = texelFetch(uM0, q, 0), m1 = texelFetch(uM1, q, 0);\n        float wa = dot(m0, uEaLo) + dot(m1, uEaHi);\n        float wb = dot(m0, uEbLo) + dot(m1, uEbHi);\n        vec4 a = texelFetch(uA, q, 0), b = texelFetch(uB, q, 0);\n        \n        vec3 col = wa * a.rgb + wb * b.rgb;\n        if (uBLn > 0) {\n          vec2 pp = vec2(float(p.x) + 0.5, float(2560 - 1 - p.y) + 0.5);\n          vec3 refl = max(a.rgb + b.rgb, vec3(0.0200));\n          vec3 acc = vec3(0.0);\n          float blEarlyClip = 1.0;\n          if (uBLEarlySafe != 0 && uBLi.z > uBLi.x) { vec2 ilo = smoothstep(uBLi.xy - uBLis, uBLi.xy + uBLis, pp), ihi = 1.0 - smoothstep(uBLi.zw - uBLis, uBLi.zw + uBLis, pp); blEarlyClip = ilo.x * ilo.y * ihi.x * ihi.y; }\n          if (uBLEarlySafe == 0 || blEarlyClip != 0.0) {\n          vec2 mlo = smoothstep(uBLr.xy - uBLk.y, uBLr.xy + uBLk.y, pp), mhi = 1.0 - smoothstep(uBLr.zw - uBLk.y, uBLr.zw + uBLk.y, pp);\n          float mk = mix(1.0, uBLk.x, mlo.x * mlo.y * mhi.x * mhi.y);   // 液晶の面は盤の洗いを弱める(液晶の絵の色を染めない)\n          for (int i = 0; i < 44; i++) { if (i >= uBLn) break; vec2 d = pp - uBLp[i].xy; float g = exp(-dot(d, d) / (uBLp[i].z * uBLp[i].z)); acc += uBLc[i].rgb * g * mix(mk, 1.0, uBLp[i].w); }   // w=1: 玉の光は液晶の面でも弱めない(液晶の上端の玉が黒く沈まない)\n          }\n          if (uBLEarlySafe != 0) { if (uBLi.z > uBLi.x) acc *= blEarlyClip; } else { if (uBLi.z > uBLi.x) { vec2 ilo = smoothstep(uBLi.xy - uBLis, uBLi.xy + uBLis, pp), ihi = 1.0 - smoothstep(uBLi.zw - uBLis, uBLi.zw + uBLis, pp); acc *= ilo.x * ilo.y * ihi.x * ihi.y; } }   // 盤の洗いは囲い(ガラス窓)の内側だけ。外の枠・花びらの周りは照らさない\n          col += acc * refl;\n        }\n        gl_FragColor = vec4(col, 0.0);\n      }";
const KNOWN_COMPOSE_SHADER="\n        uniform highp sampler2D uD, uTau;\n        void main() {\n          ivec2 p = ivec2(gl_FragCoord.xy);\n          vec4 d = texelFetch(uD, p, 0);                // a = 玉が静的な前景より手前にいる割合（MSAA 解決後）\n          vec3 tau = texelFetch(uTau, ivec2(p.x, 2559 - p.y), 0).rgb;\n          gl_FragColor = vec4(mix(tau, vec3(1.0), d.a) * d.rgb, 1.0 - d.a);   // C = (1-a)·F + mix(τ,1,a)·D 。F は後から × alpha(=1-a) で加算\n        }";
const W=1440,H=2560;
const CC='vec4 cc = uView == 1 ? texelFetch(uD, p, 0) : texelFetch(uC, p, 0);';
const FRONT_P='        ivec2 p = ivec2(gl_FragCoord.xy);';
const hooks=m=>m.onBeforeRender===THREE.Material.prototype.onBeforeRender&&m.onBeforeCompile===THREE.Material.prototype.onBeforeCompile&&m.customProgramCacheKey===THREE.Material.prototype.customProgramCacheKey;
const ordinary=m=>m?.isShaderMaterial&&m.precision===null&&m.glslVersion===null&&Object.keys(m.defines).length===0&&Object.values(m.extensions).every(v=>v===false)&&m.uniformsGroups.length===0&&hooks(m);
const drawState=m=>JSON.stringify(['depthTest','depthWrite','depthFunc','blending','blendEquation','blendSrc','blendDst','blendEquationAlpha','blendSrcAlpha','blendDstAlpha','transparent','side','colorWrite','stencilWrite','polygonOffset','alphaToCoverage','premultipliedAlpha','dithering','toneMapped'].map(k=>m[k]));
const scene=s=>s?.isScene&&s.visible===true&&s.background===null&&s.environment===null&&s.fog===null&&s.overrideMaterial===null;

export function makeFrontFusionSource(finalShader,frontShader){
 if(frontShader!==KNOWN_FRONT_SHADER)throw Error('Unrecognized BL44/earlyClip front shader');
 if(finalShader.split(CC).length!==2||finalShader.split('void main() {').length!==2)throw Error('Unrecognized M3 final shader');
 const front=frontShader.replace('void main() {','vec3 evalOwnedFront(ivec2 p) {').replace(FRONT_P,'').replace('gl_FragColor = vec4(col, 0.0);','return col;');
 if(front.includes('gl_FragColor')||front.includes('gl_FragCoord'))throw Error('Front shader transform incomplete');
 const load=`
uniform highp sampler2D uFrontTau;
vec4 loadFusedFrontC(ivec2 p) {
  vec4 d = texelFetch(uD, p, 0);
  vec3 tau = texelFetch(uFrontTau, ivec2(p.x, 2559 - p.y), 0).rgb;
  vec3 c0 = mix(tau, vec3(1.0), d.a) * d.rgb;
  float a = 1.0 - d.a;
  vec3 f = evalOwnedFront(p);
  return vec4(c0 + a * f, a);
}
`;
 return finalShader.replace('void main() {',front+'\n'+load+'\nvoid main() {').replace(CC,'vec4 cc = uView == 1 ? texelFetch(uD, p, 0) : loadFusedFrontC(p);');
}

export function installMainFrontFusion(hr,{expectedFinalShader}={}){
 if(Object.hasOwn(hr,'mainPassFusion'))return null;
 if(hr.renderer.capabilities&&hr.renderer.capabilities.maxTextures<14)return null;
 const legacy=hr.finalMat,front=hr.envFront,compose=hr.composeMat;
 if(!ordinary(legacy)||!ordinary(front)||!ordinary(compose)||legacy.fragmentShader!==expectedFinalShader||front.fragmentShader!==KNOWN_FRONT_SHADER||compose.fragmentShader!==KNOWN_COMPOSE_SHADER)return null;
 if(legacy.depthTest||legacy.depthWrite||legacy.blending!==THREE.NoBlending||legacy.transparent||legacy.side!==THREE.FrontSide||!legacy.colorWrite||legacy.stencilWrite||legacy.polygonOffset||legacy.alphaToCoverage||legacy.premultipliedAlpha||legacy.dithering)return null;
 if(front.depthTest||front.depthWrite||front.transparent||front.blending!==THREE.CustomBlending||front.blendEquation!==THREE.AddEquation||front.blendSrc!==THREE.DstAlphaFactor||front.blendDst!==THREE.OneFactor||front.blendSrcAlpha!==THREE.ZeroFactor||front.blendDstAlpha!==THREE.OneFactor||compose.blending!==THREE.NoBlending||compose.depthTest||compose.depthWrite)return null;
 if(hr.sFinal.children.length!==1||hr.sFront.children.length!==2)return null;
 const finalMesh=hr.sFinal.children[0],frontMesh=hr.sFront.children.find(m=>m.material===front),composeMesh=hr.sFront.children.find(m=>m.material===compose);
 if(composeMesh?.renderOrder!==0||frontMesh?.renderOrder!==1)return null;
 if(!finalMesh?.isMesh||finalMesh.material!==legacy||!frontMesh?.isMesh||!composeMesh?.isMesh)return null;
 const finalUniforms=Object.entries(legacy.uniforms),frontUniforms=Object.entries(front.uniforms),tau=compose.uniforms.uTau;
 if(!tau||frontUniforms.some(([k])=>Object.hasOwn(legacy.uniforms,k))||Object.hasOwn(legacy.uniforms,'uFrontTau'))return null;
 const shader=makeFrontFusionSource(legacy.fragmentShader,front.fragmentShader);
 const fused=new THREE.ShaderMaterial({vertexShader:legacy.vertexShader,fragmentShader:shader,uniforms:{...legacy.uniforms,...front.uniforms,uFrontTau:tau},depthTest:false,depthWrite:false,blending:THREE.NoBlending,toneMapped:legacy.toneMapped});
 fused.name='perf1029.main_front_fusion.F1';
 let enabled=false,disposed=false,revoked=false,needsLegacyC=false,lastActive=false,lastReason='disabled';
 const stats={fusedFrames:0,legacyFrames:0,readMaterializations:0,fallbackReasons:{}};
 const states=[legacy,front,compose].map(drawState);
 const frontSource=front.fragmentShader,frontVertex=front.vertexShader,legacyVertex=legacy.vertexShader,frontMaterialUniforms=front.uniforms,finalMaterialUniforms=legacy.uniforms;
 const invalid=()=>{
  if(disposed)return'disposed';if(revoked)return'context-reset';if(!enabled)return'disabled';
  if(hr.mainPassFusion!==api||hr.finalMat!==legacy||hr.envFront!==front||hr.composeMat!==compose)return'owner-changed';
  if(hr.viewMode!==0||hr.opts.msaa!==4||hr.rtMain.samples!==4||hr.rtMain.width!==W||hr.rtMain.height!==H||hr.rtC.width!==W||hr.rtC.height!==H||hr.rtMain.texture.type!==THREE.HalfFloatType||hr.rtC.texture.type!==THREE.HalfFloatType)return'non-native-or-format';
  if(hr.renderer.domElement.width!==W||hr.renderer.domElement.height!==H)return'non-native-canvas';
  if(!scene(hr.sFront)||!scene(hr.sFinal)||hr.sFinal.children.length!==1||hr.sFinal.children[0]!==finalMesh||hr.sFront.children.length!==2||!hr.sFront.children.includes(frontMesh)||!hr.sFront.children.includes(composeMesh))return'scene-changed';
  if(frontMesh.material!==front||composeMesh.material!==compose||frontMesh.visible!==true||composeMesh.visible!==true||finalMesh.visible!==true||![legacy,fused].includes(finalMesh.material))return'mesh-changed';
  if(!ordinary(front)||!ordinary(legacy)||!ordinary(compose)||front.fragmentShader!==frontSource||front.vertexShader!==frontVertex||compose.fragmentShader!==KNOWN_COMPOSE_SHADER||legacy.fragmentShader!==expectedFinalShader||legacy.vertexShader!==legacyVertex||fused.fragmentShader!==shader)return'shader-changed';
  if([legacy,front,compose].some((m,i)=>drawState(m)!==states[i]))return'material-state-changed';
  if(compose.uniforms.uD.value!==hr.rtMain.texture||legacy.uniforms.uD.value!==hr.rtMain.texture||legacy.uniforms.uC.value!==hr.rtC.texture)return'target-binding-changed';
  if(front.uniforms!==frontMaterialUniforms||legacy.uniforms!==finalMaterialUniforms||compose.uniforms.uTau!==tau)return'uniform-owner-changed';
  for(const [k,u]of finalUniforms)if(legacy.uniforms[k]!==u||fused.uniforms[k]!==u)return'final-uniform-rebound';
  for(const [k,u]of frontUniforms)if(front.uniforms[k]!==u||fused.uniforms[k]!==u)return'front-uniform-rebound';
  if(hr.layerBuckets.front.some(b=>b.geo.instanceCount>0))return'front-layers';
  return null;
 };
 const selectLegacy=()=>{if(finalMesh.material===fused)finalMesh.material=legacy;lastActive=false;};
 const reset=()=>{revoked=true;selectLegacy();lastReason='context-reset';};
 const api={
  setEnabled(on){if(typeof on!=='boolean')throw TypeError('Fusion enabled must be boolean');enabled=on;if(!on)selectLegacy();return enabled;},
  prepareFrame(){
   const reason=invalid();if(reason){selectLegacy();lastReason=reason;stats.legacyFrames++;stats.fallbackReasons[reason]=(stats.fallbackReasons[reason]??0)+1;needsLegacyC=false;return false;}
   finalMesh.material=fused;lastActive=true;lastReason=null;needsLegacyC=true;stats.fusedFrames++;return true;
  },
  materializeForRead(which){
   if(which==='D'||!needsLegacyC||disposed)return;
   const r=hr.renderer;r.setRenderTarget(hr.rtC);r.setViewport(0,0,W,H);r.render(hr.sFront,hr.fsCam);needsLegacyC=false;stats.readMaterializations++;
  },
  diagnostics(){return{available:true,variant:'F1-unrounded-front-in-final',enabled,activeLastFrame:lastActive,lastReason,revoked,rtCRetained:true,native:[W,H],msaa:hr.rtMain.samples,frontLightCount:front.uniforms.uBLn?.value??null,...stats,fallbackReasons:{...stats.fallbackReasons}};},
  dispose(){if(disposed)return;selectLegacy();disposed=true;hr.renderer.domElement.removeEventListener('webglcontextlost',reset);hr.renderer.domElement.removeEventListener('webglcontextrestored',reset);if(hr.mainPassFusion===api)delete hr.mainPassFusion;fused.dispose();}
 };
 Object.defineProperty(hr,'mainPassFusion',{value:api,configurable:true});
 hr.renderer.domElement.addEventListener('webglcontextlost',reset);hr.renderer.domElement.addEventListener('webglcontextrestored',reset);
 return api;
}
