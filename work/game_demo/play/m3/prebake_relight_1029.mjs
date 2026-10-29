import * as THREE from '../../web/vendor/three/three.module.js';
import {loadCompactProbe} from './prebake_probe_1029.mjs';

const W=1440,H=2560,S=4;
const VS='void main(){gl_Position=vec4(position.xy,0.,1.);}';
const replace=(s,a,b)=>{if(!s.includes(a))throw Error('Prebake source changed: '+a.slice(0,60));return s.replace(a,b);};
const region=(s,a,b,v)=>{const start=s.indexOf(a),end=s.indexOf(b,start);if(start<0||end<0)throw Error('Prebake region changed');return s.slice(0,start)+v+s.slice(end);};
function watch(uniforms,names) {
  const previous=[];let valid=false,index=0,changed=false;
  const put=v=>{if(previous[index]!==v){previous[index]=v;changed=true;}index++;};
  const add=v=>{if(typeof v==='number'||typeof v==='boolean')put(v);else if(v?.isTexture){put(v.id);put(v.version);}else if(Array.isArray(v)||ArrayBuffer.isView(v)){for(const x of v)add(x);}else if(v?.isVector2){put(v.x);put(v.y);}else if(v?.isVector3){put(v.x);put(v.y);put(v.z);}else if(v?.isVector4){put(v.x);put(v.y);put(v.z);put(v.w);}};
  return {invalidate(){valid=false;},changed(){index=0;changed=!valid;for(const n of names)add(uniforms[n]?.value);if(previous.length!==index){previous.length=index;changed=true;}valid=true;return changed;}};
}

// A fixed-camera compositor. The existing basis images remain the source of truth.
// Broad linear illumination is combined at 1/4 resolution; only spheres/tray enter
// the multisample HDR target. The LCD is sampled directly in the final compositor.
export async function installPrebakeRelight(hr,{m3,getPlate=()=>window.__play?.fxApi?.plate}={}) {
  if(hr.prebakeRelight)return hr.prebakeRelight;
  const r=hr.renderer,U=m3.uniforms,source=hr.finalMat.fragmentShader,geometry=hr._tri;
  const owned=[],materials=[],scenes=[];
  const compact=await loadCompactProbe(hr);owned.push(compact);
  const rt=(w=W/S,h=H/S,layers=0)=>{
    const options={type:THREE.HalfFloatType,format:THREE.RGBAFormat,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:false};
    const t=layers?new THREE.WebGLArrayRenderTarget(w,h,layers,options):new THREE.WebGLRenderTarget(w,h,options);owned.push(t);return t;
  };
  const make=(fragmentShader,uniforms)=>{
    const material=new THREE.ShaderMaterial({vertexShader:VS,fragmentShader,uniforms,depthTest:false,depthWrite:false,blending:THREE.NoBlending});
    const scene=new THREE.Scene(),mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;scene.add(mesh);materials.push(material);scenes.push(scene);return {material,scene};
  };
  const back=rt(),front=rt(),fields=rt(W/S,H/S,3);
  const down=mat=>make(mat.fragmentShader.replaceAll('gl_FragCoord.xy','(gl_FragCoord.xy * 4.0)'),mat.uniforms);
  const bakeBack=down(hr.envBack),bakeFront=down(hr.envFront);
  const e=m3.man.arrays.E,c=m3.man.arrays.C;
  // Keep native sampling coordinates, but rasterize only rows that can be nonzero.
  // The proof is made from the actual uploaded source data once at installation.
  // A changed texture/data/version invalidates it and uses the full field instead.
  const proveZeroPrefix=texture=>{
    const image=texture?.image,data=image?.data;
    if(!texture?.isDataTexture||texture.flipY||image.width!==W||image.height!==H||
      !(data instanceof Uint16Array||data instanceof Float32Array||data instanceof Uint8Array))return null;
    const channels=data.length/(W*H);if(![1,3,4].includes(channels))return null;
    let first=0;while(first<data.length&&data[first]===0)first++;
    return {texture,image,data,version:texture.version,sourceVersion:texture.source.version,row:Math.floor(first/(W*channels))};
  };
  const envProof=pass=>['uA','uB'].map(k=>proveZeroPrefix(pass.material.uniforms[k].value));
  const backProof=envProof(bakeBack),frontProof=envProof(bakeFront);
  const proofCurrent=(proof,pass)=>proof.every((p,i)=>p&&pass.material.uniforms[i?'uB':'uA'].value===p.texture&&p.texture.image===p.image&&p.image.data===p.data&&p.texture.version===p.version&&p.texture.source.version===p.sourceVersion&&!p.texture.flipY);
  const envRows=proof=>{if(!proof.every(Boolean))return H/S;const first=Math.min(...proof.map(p=>p.row));return first===H?0:Math.min(H/S,Math.ceil((H-first)/S)+1);};
  const fieldRect=(top,bottom)=>{const y=Math.max(0,Math.floor((H-bottom)/S)-1),end=Math.min(H/S,Math.ceil((H-top)/S)+1);return {y,h:Math.max(0,end-y)};};
  const rects={back:{y:0,h:envRows(backProof)},front:{y:0,h:envRows(frontProof)},zone:fieldRect(e.y,e.y+e.h),hole:fieldRect(c.y-194,c.y+64)};
  let fieldCropEnabled=new URLSearchParams(globalThis.location?.search??'').get('fieldcrop')!=='0';
  const fieldInitialized=new Set(),cropStats={draws:0,fullPixels:0,shadedPixels:0,initialClears:0,proofFallbacks:0,zeroReuses:0};
  const declarations=source.slice(0,source.indexOf('vec3 frameLit('));
  const bakeFields=make(declarations+`
uniform int uPBLayer;
void main(){
 vec2 px=vec2(gl_FragCoord.x*4.,2560.-gl_FragCoord.y*4.);
 vec2 uvA=px/vec2(1440.,2560.); vec3 light=vec3(0.);
 float ey=(px.y-${e.y}.0)/${e.h}.0;
 if(uPBLayer<2&&ey>0.&&ey<1.){
  vec2 ue=vec2(uvA.x,ey);
  if(uPBLayer==0){
   vec4 w0=texture(uME,vec3(ue,0.)),w1=texture(uME,vec3(ue,1.)),r0=texture(uME,vec3(ue,2.));
   w0=w0*w0*uEs[0];w1=w1*w1*uEs[1];r0=r0*r0*uEs[2];
   light=w0.x*uWash[0]+w0.y*uWash[1]+w0.z*uWash[2]+w0.w*uWash[3]+w1.x*uWash[4]+w1.y*uWash[5]+w1.z*uWash[6]+w1.w*uWash[7]+r0.x*uRing[0]+r0.y*uRing[1]+r0.z*uRing[2]+r0.w*uRing[3];
  }else{
   vec4 a=texture(uME,vec3(ue,3.)),b=texture(uME,vec3(ue,4.));a=a*a*uEs[3];b=b*b*uEs[4];
   light=uZoneGain*(a.x*uZone[0]+a.y*uZone[1]+a.z*uZone[2]+a.w*uZone[3]+b.x*uZone[4]+b.y*uZone[5]+b.z*uZone[6]+b.w*uZone[7]);
  }
 }
 if(uPBLayer==2&&px.y>${c.y}.0-194.&&px.y<${c.y}.0+64.){
  for(int i=0;i<7;i++){
   float cx=.5*(uHoleX[i].x+uHoleX[i].y),hw=.5*(uHoleX[i].y-uHoleX[i].x);
   float dx=max(abs(px.x-cx)-hw*.55,0.),dy=max(${c.y}.0+40.-px.y,0.);
   light+=uHole[i]*exp(-dx*dx/(2.*38.*38.))*exp(-dy/62.);
  }
 }
 gl_FragColor=vec4(light,1.);
}`,{...U,uPBLayer:{value:0}});

  // Eight-bit sRGB storage, hardware-decoded to linear light once per sample.
  // These fixed F0/F4/B4/W4 bases replace repeated pow conversions over the frame.
  const input=U.uMA.value.image,n=W*H*4,linearBytes=new Uint8Array(n*4);
  [0,1,6,7].forEach((layer,i)=>linearBytes.set(input.data.subarray(layer*n,(layer+1)*n),i*n));
  const linear=new THREE.DataArrayTexture(linearBytes,W,H,4);
  linear.type=THREE.UnsignedByteType;linear.format=THREE.RGBAFormat;linear.colorSpace=THREE.SRGBColorSpace;
  linear.minFilter=linear.magFilter=THREE.NearestFilter;linear.generateMipmaps=false;linear.needsUpdate=true;owned.push(linear);
  const balls=hr.rtMain;
  const ballMaterial=new hr.ballMat.constructor().copy(Object.create(hr.ballMat,{uniforms:{value:{}}}));ballMaterial.uniforms={...hr.ballMat.uniforms,uAtlas:{value:compact.atlas.texture}};
  ballMaterial.fragmentShader=replace(ballMaterial.fragmentShader,'const float PS = 64.0, PT = 66.0;',`const float PS = ${compact.faceSize}.0, PT = ${compact.tileSize}.0;`);materials.push(ballMaterial);
  const extra={uPBBack:{value:back.texture},uPBFront:{value:front.texture},uPBFields:{value:fields.texture},uPBFrame:{value:linear},uPBTau:hr.composeMat.uniforms.uTau,
    uPBLCD:{value:null},uPBRect:{value:new THREE.Vector4()},uPBPanel:{value:new THREE.Vector4()},uPBGain:{value:1},uPBLCDOn:{value:0}};
  const load=`
uniform sampler2D uPBBack,uPBFront,uPBTau,uPBLCD;
uniform highp sampler2DArray uPBFields,uPBFrame;
uniform vec4 uPBRect,uPBPanel;uniform float uPBGain;uniform int uPBLCDOn;
vec4 prebakeC(ivec2 p){
 vec2 uv=(vec2(p)+.5)/vec2(1440.,2560.),px=vec2(gl_FragCoord.x,2560.-gl_FragCoord.y);
 vec4 d=texelFetch(uD,p,0);vec3 bg=texture(uPBBack,uv).rgb;
 if(uPBLCDOn==1&&all(greaterThanEqual(px,uPBPanel.xy))&&all(lessThan(px,uPBPanel.zw))){
  vec2 q=clamp((px-uPBRect.xy)/uPBRect.zw,0.,1.);bg+=s2l(texture(uPBLCD,vec2(q.x,1.-q.y)).rgb)*uPBGain;
 }
 vec3 tau=texelFetch(uPBTau,ivec2(p.x,2559-p.y),0).rgb;
 float a=1.-d.a;
 return vec4(mix(tau,vec3(1.),d.a)*(d.rgb+a*bg)+a*texture(uPBFront,uv).rgb,a);
}
`;
  let shader=replace(source,'vec3 frameLit(',load+'\nvec3 frameLit(');
  shader=replace(shader,'vec4 cc = uView == 1 ? texelFetch(uD, p, 0) : texelFetch(uC, p, 0);','vec4 cc = prebakeC(p);');
  // The wash basis contains the physical dot pattern; preserve its native samples.
  shader=region(shader,'      vec4 z0 = dec(texture(uME,','    }\n    // 穴の段：','      zoneL = texture(uPBFields, vec3(gl_FragCoord.xy / vec2(1440.,2560.),1.)).rgb;\n');
  shader=region(shader,'      vec3 gl = vec3(0.0);','      o = Tm(invTm(o) + uGlowK * gl);','      vec3 gl = texture(uPBFields, vec3(gl_FragCoord.xy / vec2(1440.,2560.),2.)).rgb;\n');
  shader=replace(shader,'vec3 l0 = s2l(s0), b4 = s2l(texture(uMA, vec3(uv, 6.0)).rgb), w4 = s2l(texture(uMA, vec3(uv, 7.0)).rgb);','vec3 l0 = texture(uPBFrame,vec3(uv,0.)).rgb, b4 = texture(uPBFrame,vec3(uv,2.)).rgb, w4 = texture(uPBFrame,vec3(uv,3.)).rgb;');
  shader=replace(shader,'vec3 l4 = s2l(f4);','vec3 l4 = texture(uPBFrame,vec3(uvA,1.)).rgb;');
  shader=replace(shader,'vec3 dyed = l2s(mix(s2l(f0.rgb), pattern * hue * kk, 1.0));','vec3 dyed = l2s(pattern * hue * kk);');
  const final=make(shader,{...U,...extra,uD:{value:balls.texture}});
  const legacy=hr.render,dispose=hr.dispose,readLinear=hr.readLinear;
  let enabled=true,disposed=false,probeValid=false;
  const stats={frames:0,fieldUpdates:0,fieldReuses:0,probeUpdates:0,probeReuses:0,legacyFrames:0};
  const fieldNames=[['uWash','uRing','uEs'],['uZone','uZoneGain','uEs'],['uHole','uHoleX']];
  const backDirty=watch(hr.envBack.uniforms,Object.keys(hr.envBack.uniforms)),frontDirty=watch(hr.envFront.uniforms,Object.keys(hr.envFront.uniforms)),fieldDirty=fieldNames.map(names=>watch(U,names));
  const probePrevious=new Float32Array(16+hr.probes.sourceIndex.size*3);
  function probeChanged(){let i=0,dirty=!probeValid;const put=v=>{v=Math.fround(v??0);if(probePrevious[i]!==v){probePrevious[i]=v;dirty=true;}i++;};for(let n=0;n<8;n++){put(hr.frame.ea?.[n]);put(hr.frame.eb?.[n]);}for(const id of hr.probes.sourceIndex.keys()){const q=hr.frame.q?.[id],c=q?.rgb??q;put(c?.[0]);put(c?.[1]);put(c?.[2]);}probeValid=true;return dirty;}
  function invalidate(){backDirty.invalidate();frontDirty.invalidate();for(const d of fieldDirty)d.invalidate();probeValid=false;}
  function drawField(target,pass,layer=0){
    const key=pass===bakeBack?'back':pass===bakeFront?'front':layer===1?'zone':'hole';
    const validProof=key==='back'?proofCurrent(backProof,pass):key==='front'?proofCurrent(frontProof,pass):true;
    const rect=fieldCropEnabled&&validProof?rects[key]:null;
    if(fieldCropEnabled&&!validProof)cropStats.proofFallbacks++;
    stats.fieldUpdates++;cropStats.fullPixels+=target.width*target.height;
    // A fully zero source needs neither another draw nor a framebuffer switch.
    if(rect?.h===0&&fieldInitialized.has(key)){cropStats.zeroReuses++;return;}
    r.setRenderTarget(target,layer);r.setViewport(0,0,target.width,target.height);r.setScissorTest(false);
    if(rect&&!fieldInitialized.has(key)){r.setClearColor(0x000000,pass===bakeFields?1:0);r.clear(true,false,false);cropStats.initialClears++;}
    if(rect?.h!==0){
      if(rect){r.setScissor(0,rect.y,target.width,rect.h);r.setScissorTest(true);}
      try{r.render(pass.scene,hr.fsCam);}finally{r.setScissorTest(false);}
      cropStats.draws++;cropStats.shadedPixels+=target.width*(rect?rect.h:target.height);
    }
    // A fallback may paint outside the proof's region. Re-clear before using
    // that proof again if its original source is restored later.
    if(validProof)fieldInitialized.add(key);else fieldInitialized.delete(key);
  }
  const restored=()=>{fieldInitialized.clear();invalidate();};
  const api={setFieldCropEnabled(on){fieldCropEnabled=!!on;invalidate();},setEnabled(on){enabled=!!on;invalidate();},invalidate,stats,diagnostics(){return{enabled,...stats,fieldCrop:{enabled:fieldCropEnabled,...cropStats,rects,backProof:proofCurrent(backProof,bakeBack),frontProof:proofCurrent(frontProof,bakeFront)},fieldResolution:[W/S,H/S],basisFormat:'sRGB8 linear decoded',ballResolution:[W,H],ballSamples:4,probeBasis:{format:'RGB9E5',faceSize:compact.faceSize,bytes:compact.bytes,originalBytes:compact.sourceBytes},additionalMiB:(n*4+(W/S)*(H/S)*8*5+compact.bytes+compact.atlas.width*compact.atlas.height*8)/1048576};},dispose(){if(disposed)return;disposed=true;hr.render=legacy;hr.dispose=dispose;hr.readLinear=readLinear;r.domElement.removeEventListener('webglcontextrestored',restored);for(const o of owned)o.dispose();for(const m of materials)m.dispose();delete hr.prebakeRelight;}};
  hr.prebakeRelight=api;
  hr.render=function(){
    const plate=getPlate();
    if(!enabled||hr.viewMode!==0||U.uM3Off.value!==0||!plate?.mat.uniforms.uPanel){stats.legacyFrames++;return legacy.call(hr);}
    hr.trayVisualHandle?.update();stats.frames++;
    hr._updateEnvUniforms();
    r.setScissorTest(false);
    if(backDirty.changed())drawField(back,bakeBack);else stats.fieldReuses++;
    if(frontDirty.changed())drawField(front,bakeFront);else stats.fieldReuses++;
    for(let i=1;i<3;i++){if(fieldDirty[i].changed()){bakeFields.material.uniforms.uPBLayer.value=i;drawField(fields,bakeFields,i);}else stats.fieldReuses++;}
    if(hr.balls.count){if(probeChanged()){compact.compose(hr.frame);stats.probeUpdates++;}else stats.probeReuses++;}
    extra.uPBLCDOn.value=plate?.mesh.visible?1:0;
    if(plate){extra.uPBLCD.value=plate.mat.uniforms.uT.value;extra.uPBRect.value.copy(plate.mat.uniforms.uRect.value);extra.uPBPanel.value.copy(plate.mat.uniforms.uPanel.value);extra.uPBGain.value=plate.mat.uniforms.uGain.value;}
    r.setRenderTarget(balls);r.setViewport(0,0,balls.width,balls.height);r.setClearColor(0x000000,0);r.clear(true,true,false);
    const oldBallMaterial=hr.balls.material;hr.balls.material=ballMaterial;
    try{if(hr.balls.count||hr.trayVisual)r.render(hr.sBalls,hr.camera);}finally{hr.balls.material=oldBallMaterial;}
    U.uUseLut.value=hr.lutEnabled?1:0;
    r.setRenderTarget(null);r.setViewport(0,0,W,H);r.render(final.scene,hr.fsCam);
  };
  hr.dispose=function(){api.dispose();return dispose.call(hr);};
  // Debug C/D readbacks materialize the reference HDR path on demand.
  hr.readLinear=function(...args){if(!enabled)return readLinear.apply(hr,args);try{legacy.call(hr);return readLinear.apply(hr,args);}finally{hr.render();}};
  r.domElement.addEventListener('webglcontextrestored',restored);
  return api;
}
