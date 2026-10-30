import {createBallTargetCrop} from './ball_target_crop_1030.mjs';
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
  // 10/30 環境光の焼きの素材を間引いて持つ（?envdecim=0 で従来）：1/4 解像度の焼きは元の 1440×2560 の素材（A・B・M0・M1）を
  //  縦横 4 画素おきに 1 点だけ読む。読む画素だけを起動時に CPU で 360×640 に写しておき、焼きはそこを読む（同じ画素の同じ値＝画は同一）。
  //  間隔の空いた読みはキャッシュの行をほぼ 1 画素ずつしか使わないので、内蔵GPUで帯域を食っていた。
  const envDecim=new URLSearchParams(globalThis.location?.search??'').get('envdecim')!=='0';
  const decimEnv=src=>{
    const names=['uA','uB','uM0','uM1'];
    const pass=make(`uniform highp sampler2D uA, uB, uM0, uM1;
uniform vec4 uEaLo, uEaHi, uEbLo, uEbHi;
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  vec4 m0 = texelFetch(uM0, q, 0), m1 = texelFetch(uM1, q, 0);
  float wa = dot(m0, uEaLo) + dot(m1, uEaHi);
  float wb = dot(m0, uEbLo) + dot(m1, uEbHi);
  vec4 a = texelFetch(uA, q, 0), b = texelFetch(uB, q, 0);
  gl_FragColor = vec4(wa * a.rgb + wb * b.rgb, 0.0);
}`,{uA:{value:null},uB:{value:null},uM0:{value:null},uM1:{value:null},uEaLo:src.uniforms.uEaLo,uEaHi:src.uniforms.uEaHi,uEbLo:src.uniforms.uEbLo,uEbHi:src.uniforms.uEbHi});
    const made=[],keys=[];
    const copy=t=>{
      const im=t?.image,data=im?.data;
      if(!t?.isDataTexture||t.flipY||im.width!==W||im.height!==H||!data)return null;
      const ch=data.length/(W*H);if(!Number.isInteger(ch)||ch<1||ch>4)return null;
      const w=W/S,h=H/S,out=new data.constructor(w*h*ch);
      // 焼きの画素 (i,j)（下が 0）は元の画素 (4i+2, 2557-4j)（素材の行 0 が上）を読んでいた
      for(let j=0;j<h;j++){const row=(H-3-S*j)*W;for(let i=0;i<w;i++){const si=(row+S*i+2)*ch,di=(j*w+i)*ch;for(let c=0;c<ch;c++)out[di+c]=data[si+c];}}
      const d=new THREE.DataTexture(out,w,h,t.format,t.type);d.internalFormat=t.internalFormat;d.colorSpace=t.colorSpace;
      d.minFilter=d.magFilter=THREE.NearestFilter;d.generateMipmaps=false;d.flipY=false;d.unpackAlignment=1;d.needsUpdate=true;return d;
    };
    let failed=false;
    return {scene:pass.scene,ok(){
      if(failed)return false;
      const cur=names.map(n=>src.uniforms[n].value);
      if(keys.length&&cur.every((t,i)=>t===keys[i].t&&t.version===keys[i].v))return true;
      for(const d of made)d.dispose();made.length=0;keys.length=0;
      for(let i=0;i<4;i++){const d=copy(cur[i]);if(!d){failed=true;return false;}made.push(d);pass.material.uniforms[names[i]].value=d;}
      cur.forEach(t=>keys.push({t,v:t.version}));return true;
    },dispose(){for(const d of made)d.dispose();}};
  };
  const envD=envDecim?new Map([[bakeBack,decimEnv(hr.envBack)],[bakeFront,decimEnv(hr.envFront)]]):null;
  if(envD){owned.push(...envD.values());for(const d of envD.values())d.ok();}   // 起動時に写しておく
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

  // 10/30 応急：合成の倍率を指定できる（?renderscale=1.333 など）。既定 1.333（1080×1920 で合成して 1440×2560 へ）。
  // ?renderscale=1 か ?quality=high で従来の元解像度、?renderlite=1 は従来どおり 2（720×1280、球 MSAA2）。
  const pq=new URLSearchParams(globalThis.location?.search??'');
  // 10/30 段式の画質（?quality=auto|high|medium|low|lower|lowest、既定 auto）。
  //  high＝元解像度・球MSAA4（従来の経路）／medium＝1.333・MSAA4／low＝1.333・MSAA2／lower＝1.6・MSAA2／lowest＝2・MSAA2。
  //  auto は medium から始め、起動直後とプレイ中の fps を見て下の段へだけ移る（上げない）。?renderscale= / ?ballmsaa= を指定するとその値で固定。
  const TIERS=[{name:'high',scale:1,msaa:4},{name:'medium',scale:1.333,msaa:4},{name:'low',scale:1.333,msaa:2},{name:'lower',scale:1.6,msaa:2},{name:'lowest',scale:2,msaa:2}];
  const qName=pq.get('quality')??'auto',msaaQ=pq.get('ballmsaa');
  const tierQ=TIERS.findIndex(t=>t.name===qName);
  const scaleArg=pq.has('renderscale')?Number(pq.get('renderscale')):tierQ>=0?TIERS[tierQ].scale:pq.get('renderlite')==='1'?2:pq.get('renderlite')==='0'?1:TIERS[1].scale;
  const renderScaleQ=Number.isFinite(scaleArg)&&scaleArg>1.001?Math.min(4,scaleArg):1;
  const renderLite=renderScaleQ>1;
  // 10/30 縮小描画の拡大をブラウザの合成に任せる（?litecanvas=0 で従来）：canvas の画素数を描画解像度にし、
  // 最終合成を canvas へ直接描く。CSS の箱は 1440×2560 のままなので、拡大はブラウザの合成（双線形）が行う。
  // 1440×2560 への拡大コピー（全画面 1 pass と RGBA8 の中間 1 枚）が無くなる。
  const liteCanvas=renderLite&&pq.get('litecanvas')!=='0';
  // 10/30 静的な部分の焼き（?staticbake=0 で従来）：得点板の 7 セグ・メーターの和（12 回の読み込み）と、ロゴの文字の判定
  // （7 回の読み込み、枠の光で 2 か所）を、最終合成と同じ画素位置・同じ式で float32 に焼き、最終合成は 1 回の texelFetch で読む。
  // 焼き直すのは 7 セグ・メーターの値か描画解像度が変わったときだけ。
  const staticBake=pq.get('staticbake')!=='0';
  // 10/31 低い段（low・lower・lowest）だけ照明の焼きを 2 フレームに 1 回に（?halfbake=0 で従来）。偶数フレームで環境光（奥・手前）と盤の光、
  //  奇数フレームで枠の焼きと球のプローブ。光の変化は最大 1 フレーム（16.7ms）遅れる。既定の medium 以上は毎フレームのまま。
  //  ?halfbake=1 で常に半分、auto（既定）は low 以下、または medium で fps が足りないとき解像度を下げる前に先に半分にする。
  const halfBakeArg=pq.get('halfbake'),halfBake=halfBakeArg!=='0',halfBakeForce=halfBakeArg==='1';
  // 10/30 F0/F4 の混ぜ（uK4・uGlass）が厳密に 0 か 1 のとき、2 枚読んで混ぜる代わりに片方だけ読む（?k4branch=0 で従来）。
  //  遊技中の約 3 割の時間は 1。条件は uniform なので画素ごとに分岐はばらけない。
  const k4Branch=pq.get('k4branch')!=='0';
  const autoQuality=renderLite&&qName==='auto'&&!pq.has('renderscale')&&!pq.has('renderlite')&&!['0','2','4'].includes(msaaQ);
  // 10/30 表示実寸描画（?dispfit=0 で従来）：球と最終合成を「画面に実際に映る画素数」（上限1440×2560）で描く。
  // 素材と座標は元の1440×2560のまま、表示の画素の中心（=ブラウザが縮小で読む位置）で読むので、映る画は同じ。
  const dispFit=!renderLite&&new URLSearchParams(globalThis.location?.search??'').get('dispfit')!=='0';
  // 10/30 照明の基底を焼く（?framebake=0 で従来）：筐体の 8 区画の重み（uMF の2枚と uK/uKc/uRecolor）を、
  // 区画の値が変わったときだけ 1/4 解像度で「重みの和」の形に焼く。最後の合成は和を補間して元の解像度で割るので、
  // 筐体の輪郭で照明が暗く縁取られない。筐体の絵・輪郭・ロゴは元の解像度のまま。
  const frameBake=pq.get('framebake')!=='0';
  const frameF=frameBake?rt(2*W/S,H/S):null;   // 左半分＝和(S0,S1,S3,S4)、右半分＝色の和。1 回の描画で両方焼く
  const sumK=(v,w)=>`ra.x*${v}[0]${w(0)}+ra.y*${v}[1]${w(1)}+ra.z*${v}[2]${w(2)}+ra.w*${v}[3]${w(3)}+rb.x*${v}[4]${w(4)}+rb.y*${v}[5]${w(5)}+rb.z*${v}[6]${w(6)}+rb.w*${v}[7]${w(7)}`;
  const bakeFrame=frameBake?make(declarations+`
void main(){
 int uPBLayer=gl_FragCoord.x<${W/S}.?0:1;
 vec2 uvA=vec2(mod(gl_FragCoord.x,${W/S}.)*4.,2560.-gl_FragCoord.y*4.)/vec2(1440.,2560.);
 vec4 ra=texture(uMF,vec3(uvA,0.)),rb=texture(uMF,vec3(uvA,1.));ra*=ra;rb*=rb;
 if(uPBLayer==0)gl_FragColor=vec4(ra.x+ra.y+ra.z+ra.w+rb.x+rb.y+rb.z+rb.w,${sumK('uK',()=>'')},${sumK('uRecolor',()=>'')},ra.x+ra.y);
 else gl_FragColor=vec4(${sumK('uK',i=>`*uKc[${i}]`)},0.);
}`,{...U}):null;
  const frameDirty=frameBake?watch(U,['uMF','uK','uKc','uRecolor']):null;
  const staticDirty=staticBake?watch(U,['uSeg','uSegC','uMet','uMA','uMD']):null;
  // Eight-bit sRGB storage, hardware-decoded to linear light once per sample.
  // These fixed F0/F4/B4/W4 bases replace repeated pow conversions over the frame.
  const input=U.uMA.value.image,n=W*H*4,linearBytes=new Uint8Array(n*4);
  [0,1,6,7].forEach((layer,i)=>linearBytes.set(input.data.subarray(layer*n,(layer+1)*n),i*n));
  const linear=new THREE.DataArrayTexture(linearBytes,W,H,4);
  linear.type=THREE.UnsignedByteType;linear.format=THREE.RGBAFormat;linear.colorSpace=THREE.SRGBColorSpace;
  linear.minFilter=linear.magFilter=dispFit||renderLite?THREE.LinearFilter:THREE.NearestFilter;linear.generateMipmaps=false;linear.needsUpdate=true;owned.push(linear);
  // Render the expensive sphere/composite passes at 720x1280, then present to
  // the native canvas. Keep all artwork, layout and occlusion in native coords.
  const renderScale=renderScaleQ;let RW=Math.round(W/renderScale),RH=Math.round(H/renderScale);
  const KFC='vec4(gl_FragCoord.xy*uPBK,gl_FragCoord.zw)';   // 倍率は uniform（段を切り替えてもシェーダを作り直さない）
  const fit={size:[W,H],wanted:[W,H],since:0,resizes:0,legacyRestores:0,canvasFull:true,applied:false};
  const uPBK={value:new THREE.Vector2(W/RW,H/RH)};
  // 10/30 球の軽量化：倍率 1〜2 未満の合成でも球バッファの上の空き行を切り詰め（?ballcrop=0 で従来）、
  // 合成は球バッファを画素そのまま読む（同じ大きさなので補間なし）。?ballmsaa=0|2|4 で球の MSAA を選ぶ（既定は従来どおり）。
  const liteCrop=renderLite;
  const msaaArg=msaaQ;let ballSamples=['0','2','4'].includes(msaaArg)?Number(msaaArg):tierQ>=0?TIERS[tierQ].msaa:renderScale>=2?2:hr.rtMain.samples;
  // 10/30 球バッファの深度は解決しない（?ballzskip=0 で従来）：MSAA の解決で色と一緒に深度も写していたが、
  // 解決後の深度はどこからも読まない。色の解決だけにする（画は同一、帯域が減る）。hr.rtMain（従来経路と共有）には触らない。
  const ballZSkip=pq.get('ballzskip')!=='0';
  let balls=renderLite?new THREE.WebGLRenderTarget(RW,RH,{type:THREE.HalfFloatType,format:THREE.RGBAFormat,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:true,samples:ballSamples,resolveDepthBuffer:!ballZSkip}):hr.rtMain;
  let liteBalls=renderLite?balls:null;
  let ballCrop=createBallTargetCrop(hr,balls);
  let fitBalls=null;   // dispFit のときだけ：映る大きさの MSAA の球バッファ（大きさが変わるたびに作り直し、古いのは捨てる）
  const displayRT=(w,h)=>{const t=new THREE.WebGLRenderTarget(w,h,{type:THREE.UnsignedByteType,format:THREE.RGBAFormat,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:false});return t;};
  let display=renderLite&&!liteCanvas?displayRT(RW,RH):null;
  const present=display?make('uniform sampler2D uImage;void main(){gl_FragColor=texture2D(uImage,gl_FragCoord.xy/vec2(1440.,2560.));}',{uImage:{value:display.texture}}):null;
  const ballMaterial=new hr.ballMat.constructor().copy(Object.create(hr.ballMat,{uniforms:{value:{}}}));ballMaterial.uniforms={...hr.ballMat.uniforms,uAtlas:{value:compact.atlas.texture}};
  ballMaterial.fragmentShader=replace(ballMaterial.fragmentShader,'const float PS = 64.0, PT = 66.0;',`const float PS = ${compact.faceSize}.0, PT = ${compact.tileSize}.0;`);materials.push(ballMaterial);
  // 10/30 玉のプローブ選び（?ballsel=0 で従来）：玉の中心だけで決まる「最寄りプローブの区域と近い 3 点・重み」を、
  // 頂点ごと（1 玉 1500 頂点 × 13 プローブ × 4 周）ではなく CPU で玉ごとに 1 回計算し、インスタンス属性で渡す。式は頂点シェーダと同じ（float32 で計算）。
  const ballSel=pq.get('ballsel')!=='0'&&ballMaterial.vertexShader.includes('vPI = idx; vPW = wt / max(wt.x + wt.y + wt.z, 1e-12);');
  let selPI=null,selPW=null;
  if(ballSel){
    const vs=ballMaterial.vertexShader,a=vs.indexOf('          vec3 c = (modelMatrix * im * vec4(0.0, 0.0, 0.0, 1.0)).xyz;'),bTok='vPI = idx; vPW = wt / max(wt.x + wt.y + wt.z, 1e-12);',b=vs.indexOf(bTok);
    if(a<0||b<a)throw Error('Prebake ballsel: ball vertex shader changed');
    ballMaterial.vertexShader='attribute vec3 aPBPI; attribute vec3 aPBPW;\n'+vs.slice(0,a)+'          vPI = aPBPI; vPW = aPBPW;'+vs.slice(b+bTok.length);
    const n=hr.balls.instanceMatrix.count;
    selPI=new THREE.InstancedBufferAttribute(new Float32Array(n*3).fill(-1),3);selPW=new THREE.InstancedBufferAttribute(new Float32Array(n*3),3);
    selPI.setUsage(THREE.DynamicDrawUsage);selPW.setUsage(THREE.DynamicDrawUsage);
    hr.balls.geometry.setAttribute('aPBPI',selPI);hr.balls.geometry.setAttribute('aPBPW',selPW);
  }
  const f32=Math.fround;
  function ballSelect(){
    const mesh=hr.balls,count=mesh.count,m=mesh.matrixWorld.elements,im=mesh.instanceMatrix.array,P=ballMaterial.uniforms.uPPos.value,Z=ballMaterial.uniforms.uPZone.value,NP=P.length,pi=selPI.array,pw=selPW.array;
    for(let k=0;k<count;k++){
      const o=k*16,tx=im[o+12],ty=im[o+13],tz=im[o+14],tw=im[o+15];
      const cx=f32(m[0]*tx+m[4]*ty+m[8]*tz+m[12]*tw),cy=f32(m[1]*tx+m[5]*ty+m[9]*tz+m[13]*tw),cz=f32(m[2]*tx+m[6]*ty+m[10]*tz+m[14]*tw);
      const dd=i=>{const dx=f32(cx-P[i].x),dy=f32(cy-P[i].y),dz=f32(cz-P[i].z);return f32(f32(f32(dx*dx)+f32(dy*dy))+f32(dz*dz));};
      let best=1e9,bi=0;for(let i=0;i<NP;i++){const d=dd(i);if(d<best){best=d;bi=i;}}
      const zone=Z[bi],idx=[-1,-1,-1],wt=[0,0,0];
      for(let s2=0;s2<3;s2++){let bd=1e9,bj=-1;for(let i=0;i<NP;i++){if(Z[i]!==zone)continue;if(s2>0&&i===idx[0])continue;if(s2>1&&i===idx[1])continue;const d=dd(i);if(d<bd){bd=d;bj=i;}}if(bj>=0){idx[s2]=bj;wt[s2]=f32(1/f32(bd+1e-5));}}
      const sum=Math.max(f32(f32(wt[0]+wt[1])+wt[2]),1e-12);
      for(let c=0;c<3;c++){pi[k*3+c]=idx[c];pw[k*3+c]=f32(wt[c]/sum);}
    }
    if(count){selPI.clearUpdateRanges();selPW.clearUpdateRanges();selPI.addUpdateRange(0,count*3);selPW.addUpdateRange(0,count*3);selPI.needsUpdate=selPW.needsUpdate=true;}
  }
  if(renderLite||dispFit){ballMaterial.fragmentShader='uniform vec2 uPBK;\n'+ballMaterial.fragmentShader.replaceAll('gl_FragCoord','vec4(gl_FragCoord.xy*uPBK,gl_FragCoord.zw)');ballMaterial.uniforms.uPBK=uPBK;}
  const extra={uPBBack:{value:back.texture},uPBFront:{value:front.texture},uPBFields:{value:fields.texture},uPBFrame:{value:linear},uPBFrameL:{value:frameF?.texture??null},uPBTau:hr.composeMat.uniforms.uTau,
    uPBLCD:{value:null},uPBRect:{value:new THREE.Vector4()},uPBPanel:{value:new THREE.Vector4()},uPBGain:{value:1},uPBLCDOn:{value:0}};
  const load=`
uniform sampler2D uPBBack,uPBFront,uPBTau,uPBLCD;
uniform highp sampler2DArray uPBFields,uPBFrame;uniform sampler2D uPBFrameL;
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
vec2 pbFL(float half_){vec2 u=gl_FragCoord.xy/vec2(1440.,2560.);return vec2(clamp(u.x*.5,.5/${2*W/S}.,.5-.5/${2*W/S}.)+half_,u.y);}
`;
  let shader=replace(source,'vec3 frameLit(',load+'\nvec3 frameLit(');
  shader=replace(shader,'vec4 cc = uView == 1 ? texelFetch(uD, p, 0) : texelFetch(uC, p, 0);','vec4 cc = prebakeC(p);');
  // The wash basis contains the physical dot pattern; preserve its native samples.
  shader=region(shader,'      vec4 z0 = dec(texture(uME,','    }\n    // 穴の段：','      zoneL = texture(uPBFields, vec3(gl_FragCoord.xy / vec2(1440.,2560.),1.)).rgb;\n');
  shader=region(shader,'      vec3 gl = vec3(0.0);','      o = Tm(invTm(o) + uGlowK * gl);','      vec3 gl = texture(uPBFields, vec3(gl_FragCoord.xy / vec2(1440.,2560.),2.)).rgb;\n');
  shader=replace(shader,'vec3 l0 = s2l(s0), b4 = s2l(texture(uMA, vec3(uv, 6.0)).rgb), w4 = s2l(texture(uMA, vec3(uv, 7.0)).rgb);','vec3 l0 = texture(uPBFrame,vec3(uv,0.)).rgb, b4 = texture(uPBFrame,vec3(uv,2.)).rgb, w4 = texture(uPBFrame,vec3(uv,3.)).rgb;');
  shader=replace(shader,'vec3 l4 = s2l(f4);','vec3 l4 = texture(uPBFrame,vec3(uvA,1.)).rgb;');
  shader=replace(shader,'vec3 dyed = l2s(mix(s2l(f0.rgb), pattern * hue * kk, 1.0));','vec3 dyed = l2s(pattern * hue * kk);');
  if(frameBake){
    shader=region(shader,'    vec4 ra = texture(uMF, vec3(uvA, 0.0)), rb = texture(uMF, vec3(uvA, 1.0));','    if (f0.a > 0.001) {',
      '    vec4 pf0 = texture(uPBFrameL, pbFL(0.)); vec3 pf1 = texture(uPBFrameL, pbFL(.5)).rgb;\n'+
      '    float wsum = pf0.x + 1e-4; float kk = pf0.y / wsum; vec3 col = pf1 / max(pf0.y, 1e-4); float rc = pf0.z / wsum;\n');
    shader=replace(shader,'lit = mix(lit, dyed, (ra.x + ra.y) / wsum);','lit = mix(lit, dyed, pf0.w / wsum);');
    shader=replace(shader,'frameLit(f0.rgb, f4, kk, col, rc)','frameLitL(texture(uPBFrame,vec3(uvA,0.)).rgb, texture(uPBFrame,vec3(uvA,1.)).rgb, kk, col, rc)');
    shader=replace(shader,'float logoBox(vec2 uv)',`vec3 frameLitL(vec3 l0, vec3 l4, float kk, vec3 col, float rc) {
  vec3 d = l4 - l0, pos = max(d, 0.0), neg = min(d, 0.0);
  float m = max(pos.r, max(pos.g, pos.b));
  return l2s(l0 + min(kk, 1.0) * neg + kk * mix(pos, m * col, rc));
}
float logoBox(vec2 uv)`);
  }
  if(k4Branch){
    const pairs=[['vec3 g = mix(texture(uMA, vec3(uvA, 4.0)).rgb, texture(uMA, vec3(uvA, 5.0)).rgb, uGlass);','vec3 g = pbMix2(uMA, uvA, 4.0, 5.0, uGlass).rgb;'],
      ['vec4 bk = mix(texture(uMC, vec3(us, 2.0)), texture(uMC, vec3(us, 3.0)), uK4);','vec4 bk = pbMix2(uMC, us, 2.0, 3.0, uK4);'],
      ['vec4 bd = mix(texture(uMA, vec3(uvA, 2.0)), texture(uMA, vec3(uvA, 3.0)), uK4);','vec4 bd = pbMix2(uMA, uvA, 2.0, 3.0, uK4);'],
      ['vec4 fo = mix(texture(uMC, vec3(us, 0.0)), texture(uMC, vec3(us, 1.0)), uK4);','vec4 fo = pbMix2(uMC, us, 0.0, 1.0, uK4);'],
      ['vec4 tr = mix(texture(uMT, vec3(ut, 0.0)), texture(uMT, vec3(ut, 1.0)), uK4);','vec4 tr = pbMix2(uMT, ut, 0.0, 1.0, uK4);']];
    for(const [x,y] of pairs)shader=replace(shader,x,y);
    shader=replace(shader,'vec3 frameLit(','vec4 pbMix2(highp sampler2DArray s, vec2 u, float l0, float l1, float k){\n if(k >= 1.0) return texture(s, vec3(u, l1));\n if(k <= 0.0) return texture(s, vec3(u, l0));\n return mix(texture(s, vec3(u, l0)), texture(s, vec3(u, l1)), k);\n}\nvec3 frameLit(');
  }
  let bakeStaticSrc=null;
  if(staticBake){
    const segA='      float sg = 0.0;\n',segB='\n      // 得点表示板の絵は',
          i0=shader.indexOf(segA),i1=shader.indexOf('      for (int j = 0; j < 5; j++) if (uMet[j] > 0.0) add +=',i0);
    if(i0<0||i1<0)throw Error('Prebake static: score source changed');
    const i2=shader.indexOf('\n',i1),segSrc=shader.slice(i0,i2+1);
    if(!/vec3 add = sg \* [0-9.]+ \* uSegC;/.test(segSrc))throw Error('Prebake static: score add changed');
    if(shader.split('logoLetter(uvA)').length!==2||shader.split('logoLetter(uv)').length!==2)throw Error('Prebake static: logo calls changed');
    // 焼きの main：最終合成と同じ px・uvA・ud の式。gl_FragCoord は後で領域の原点を足した FCv に置き換える。
    const bakeMain=`void main() {
  vec2 px = vec2(gl_FragCoord.x, 2560.0 - gl_FragCoord.y);
  vec2 uvA = px / vec2(1440.0, 2560.0);
  vec2 ud = (px - vec2(750.64, 122.41)) / vec2(490.0, 383.0);
  vec3 add = vec3(0.0);
  if (ud.x > 0.0 && ud.y > 0.0 && ud.x < 1.0 && ud.y < 1.0) {
${segSrc.replace(/vec3 add = sg/,'add = sg')}  }
  gl_FragColor = vec4(add, logoLetter(uvA));
}
`;
    bakeStaticSrc=shader.slice(0,shader.indexOf('void main()'))+bakeMain;
    shader=replace(shader,segSrc,'      vec3 add = texelFetch(uPBStatic, ivec2(__RAWFC__.xy) - uPBSo, 0).rgb;\n');
    shader=replace(shader,'logoLetter(uvA)','pbLogo(uvA)');
    shader=replace(shader,'logoLetter(uv)','pbLogo(uv)');
    shader=replace(shader,'vec3 frameLitBW(','uniform highp sampler2D uPBStatic;uniform ivec2 uPBSo;\nfloat pbLogo(vec2 uv){return logoBox(uv)<=0.0?0.0:texelFetch(uPBStatic,ivec2(__RAWFC__.xy)-uPBSo,0).a;}\nvec3 frameLitBW(');
  }
  if(renderLite){
    shader='uniform vec2 uPBK;\n'+replace(shader,'vec4 d=texelFetch(uD,p,0);','ivec2 pd=ivec2(__RAWFC__.xy);vec4 d=pd.y<textureSize(uD,0).y?texelFetch(uD,pd,0):vec4(0.);').replaceAll('gl_FragCoord',KFC).replaceAll('__RAWFC__','gl_FragCoord');
  }
  if(dispFit){
    // 球は映る大きさのバッファをそのまま、τ は元の画素を双線形で（元の大きさでは texelFetch と同じ値）。
    shader=replace(shader,'vec2 uv=(vec2(p)+.5)/vec2(1440.,2560.),','vec2 uv=gl_FragCoord.xy/vec2(1440.,2560.),');
    shader=replace(shader,'vec4 d=texelFetch(uD,p,0);','ivec2 pd=ivec2(__RAWFC__.xy);vec4 d=pd.y<textureSize(uD,0).y?texelFetch(uD,pd,0):vec4(0.);');
    shader=replace(shader,'vec3 tau=texelFetch(uPBTau,ivec2(p.x,2559-p.y),0).rgb;','vec3 tau=pbTau(gl_FragCoord.xy);');
    shader=replace(shader,'vec4 prebakeC(ivec2 p){',`uniform vec2 uPBK;
vec3 pbTau(vec2 fc){
 vec2 t=fc-.5,f=t-floor(t);ivec2 i=ivec2(floor(t)),a=clamp(i,ivec2(0),ivec2(1439,2559)),b=clamp(i+1,ivec2(0),ivec2(1439,2559));
 vec3 s00=texelFetch(uPBTau,ivec2(a.x,2559-a.y),0).rgb,s10=texelFetch(uPBTau,ivec2(b.x,2559-a.y),0).rgb,s01=texelFetch(uPBTau,ivec2(a.x,2559-b.y),0).rgb,s11=texelFetch(uPBTau,ivec2(b.x,2559-b.y),0).rgb;
 return mix(mix(s00,s10,f.x),mix(s01,s11,f.x),f.y);
}
vec4 prebakeC(ivec2 p){`);
    shader=shader.replaceAll('gl_FragCoord','vec4(gl_FragCoord.xy*uPBK,gl_FragCoord.zw)').replaceAll('__RAWFC__','gl_FragCoord');
  }
  else if(ballCrop&&!renderLite)shader=replace(shader,'vec4 d=texelFetch(uD,p,0);','vec4 d=p.y<textureSize(uD,0).y?texelFetch(uD,p,0):vec4(0.);');
  const scaledFC=renderLite||dispFit;
  shader=shader.replaceAll('__RAWFC__','gl_FragCoord');
  const staticUni={uPBStatic:{value:null},uPBSo:{value:new THREE.Vector2()}};
  let bakeStatic=null,staticRT=null,staticKey='';
  if(staticBake){
    // 最終合成と同じ変換（倍率）を当ててから、gl_FragCoord を「焼き先の画素＋領域の原点」FCv に置き換える
    let b=scaledFC?'uniform vec2 uPBK;\n'+bakeStaticSrc.replaceAll('gl_FragCoord',KFC):bakeStaticSrc;
    b='uniform ivec2 uPBSo;\nvec4 FCv;\n'+b.replaceAll('gl_FragCoord','FCv');
    b=replace(b,'void main() {\n','void main() {\n  FCv = vec4(gl_FragCoord.xy + vec2(uPBSo), gl_FragCoord.zw);\n');
    bakeStatic=make(b,{...U,...(scaledFC?{uPBK}:{}),uPBSo:staticUni.uPBSo});
  }
  const final=make(shader,{...U,...extra,uD:{value:balls.texture},...(dispFit||renderLite?{uPBK}:{}),...(staticBake?staticUni:{})});
  // 段の切り替え：合成・球のバッファを作り直す（シェーダはそのまま）。古いバッファは捨てる。
  function setLite(scale,samples){
    if(!renderLite)return;
    const w=Math.round(W/scale),h=Math.round(H/scale);
    if(w===RW&&h===RH&&samples===liteBalls.samples)return;
    ballCrop?.dispose();liteBalls.dispose();display?.dispose();
    RW=w;RH=h;ballSamples=samples;uPBK.value.set(W/RW,H/RH);
    liteBalls=balls=new THREE.WebGLRenderTarget(RW,RH,{type:THREE.HalfFloatType,format:THREE.RGBAFormat,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:true,samples,resolveDepthBuffer:!ballZSkip});
    ballCrop=createBallTargetCrop(hr,balls);api.ballCrop=ballCrop;
    if(present){display=displayRT(RW,RH);present.material.uniforms.uImage.value=display.texture;}
  }
  // 自動の段：起動直後（1.5 秒待って 2.5 秒）と、その後のプレイ中（3 秒ごと）の平均のフレーム間隔を見る。
  // 1 回の大きな引っかかりで段が落ちないよう、1 フレームは 50ms で頭打ち、250ms 超（非表示・読み込み）は数えない。
  const qGuard=pq.get('qualityguard')!=='0';
  const quality={auto:autoQuality,tier:tierQ>=0?TIERS[tierQ].name:autoQuality?'medium':null,index:tierQ>=0?tierQ:autoQuality?1:-1,history:[],last:0,sum:0,cpu:0,n:0,since:0,startedAt:0,cpuBound:0,guard:qGuard,probe:null,locked:false,reverts:0,lightHalf:false};
  const qLimitTest=Number(pq.get('qualitylimit'))||0;   // 確認用：判定のしきい値(ms)を差し替える
  // 10/30 誤判定の見直し（?qualityguard=0 で従来）：
  //  ・CPU 律速の判定を「平均の間隔の 75%」から「間隔としきい値の小さい方の 75%」に。CPU が 18ms で垂直同期により 33ms 間隔に
  //    なる場合（平均 25ms）に、従来は GPU 律速と見て段を下げていた。
  //  ・下げた後の 1 区間でまだしきい値を超え、間隔も下げる前より 7% 以上縮まなければ（30fps に制限された省電力・50Hz の画面・
  //    主スレッドの外の処理など）、下げても速くならないので下げる前の段へ戻し、以後は自動で下げない。
  //    ただし解像度が変わらない段（medium→low は MSAA だけ）で縮まないのは判断できないので、解像度の変わる段まで続けて試す。
  function qualityTick(){
    if(!quality.auto)return;
    const now=performance.now();
    if(!quality.startedAt){quality.startedAt=now;quality.last=now;quality.since=now+1500;return;}
    const dt=now-quality.last;quality.last=now;
    if(now<quality.since||dt>250)return;
    quality.sum+=Math.min(dt,50);quality.cpu+=Math.min(globalThis.window?.__play?.lastTiming?.totalMs??0,50);quality.n++;
    const windowMs=quality.history.length||now-quality.startedAt>6000?3000:2500;
    if(quality.sum<windowMs)return;
    const mean=quality.sum/quality.n,cpu=quality.cpu/quality.n;quality.sum=0;quality.cpu=0;quality.n=0;
    const limit=qLimitTest||(now-quality.startedAt<8000?18.5:20);   // 起動直後は 54fps 未満、その後は 50fps 未満で一段下げる
    // 遅れの主因が主スレッドの処理（物理・液晶の CPU）なら、画質を下げても速くならないので下げない
    if(quality.guard&&quality.probe){
      const pr=quality.probe;
      if(mean>limit&&mean>pr.meanMs*.93){
        if(TIERS[quality.index].scale===TIERS[pr.from].scale&&quality.index<TIERS.length-1){   // まだ解像度が同じ：次の段も試す
          const t=TIERS[++quality.index];setLite(t.scale,t.msaa);quality.tier=t.name;
          quality.history.push({at:Math.round(now),meanMs:+mean.toFixed(2),cpuMs:+cpu.toFixed(2),to:t.name,probe:true});quality.since=now+700;return;
        }
        quality.probe=null;quality.index=pr.from;const t=TIERS[pr.from];setLite(t.scale,t.msaa);quality.tier=t.name;quality.locked=true;quality.reverts++;
        quality.history.push({at:Math.round(now),meanMs:+mean.toFixed(2),cpuMs:+cpu.toFixed(2),to:t.name,revert:true});quality.since=now+700;return;
      }
      quality.probe=null;
    }
    if(quality.guard&&quality.locked)return;
    if(mean>limit&&cpu>.75*(quality.guard?Math.min(mean,limit):mean)){quality.cpuBound++;return;}
    if(mean>limit&&halfBake&&!halfBakeForce&&!quality.lightHalf&&quality.index<2){   // 解像度を下げる前に、まず照明の焼きを半分の頻度に（画は等倍のまま、光の変化が最大 1 フレーム遅れるだけ）
      quality.lightHalf=true;quality.history.push({at:Math.round(now),meanMs:+mean.toFixed(2),cpuMs:+cpu.toFixed(2),to:'halfbake'});quality.since=now+700;return;
    }
    if(mean>limit&&quality.index<TIERS.length-1){
      const t=TIERS[++quality.index];setLite(t.scale,t.msaa);quality.tier=t.name;
      quality.history.push({at:Math.round(now),meanMs:+mean.toFixed(2),cpuMs:+cpu.toFixed(2),to:t.name});quality.since=now+700;
      if(quality.guard)quality.probe={from:quality.index-1,meanMs:mean};
    }
  }
  // 映る大きさ：canvas の CSS の箱（回転前の大きさ）× devicePixelRatio、1440×2560 が上限。大きさが 0.2 秒落ち着いてから切り替える。
  function wantedSize(){
    const c=r.domElement,dpr=globalThis.devicePixelRatio||1,cw=c.clientWidth,ch=c.clientHeight;
    if(!(cw>0&&ch>0))return fit.size;
    return [Math.max(64,Math.min(W,Math.round(cw*dpr))),Math.max(64,Math.min(H,Math.round(ch*dpr)))];
  }
  function setCanvas(w,h){if(r.domElement.width!==w||r.domElement.height!==h)r.setSize(w,h,false);fit.canvasFull=w===W&&h===H;}
  function applyFit(){
    const want=wantedSize(),now=performance.now();
    if(want[0]!==fit.wanted[0]||want[1]!==fit.wanted[1]){fit.wanted=want;fit.since=now;}
    const differs=fit.size[0]!==fit.wanted[0]||fit.size[1]!==fit.wanted[1];
    if(!fit.applied||(differs&&now-fit.since>200)){
      const [w,h]=fit.applied?fit.wanted:want;
      ballCrop?.dispose();fitBalls?.dispose();
      // 元の大きさのときは従来と同じ hr.rtMain をそのまま使う
      fitBalls=w===W&&h===H?null:new THREE.WebGLRenderTarget(w,h,{type:THREE.HalfFloatType,format:THREE.RGBAFormat,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:true,samples:hr.rtMain.samples,resolveDepthBuffer:!ballZSkip});
      const full=fitBalls??hr.rtMain;if(fitBalls)r.initRenderTarget?.(fitBalls);
      ballCrop=createBallTargetCrop(hr,full);balls=full;api.ballCrop=ballCrop;
      fit.size=[w,h];fit.wanted=[w,h];RW=w;RH=h;uPBK.value.set(W/w,H/h);fit.resizes++;fit.applied=true;
    }
    setCanvas(RW,RH);
  }
  function restoreFull(){if((dispFit||liteCanvas)&&!fit.canvasFull){setCanvas(W,H);fit.legacyRestores++;}}
  const legacy=hr.render,dispose=hr.dispose,readLinear=hr.readLinear;
  let enabled=true,disposed=false,probeValid=false;
  const stats={frames:0,fieldUpdates:0,fieldReuses:0,probeUpdates:0,probeReuses:0,legacyFrames:0};
  const fieldNames=[['uWash','uRing','uEs'],['uZone','uZoneGain','uEs'],['uHole','uHoleX']];
  const backDirty=watch(hr.envBack.uniforms,Object.keys(hr.envBack.uniforms)),frontDirty=watch(hr.envFront.uniforms,Object.keys(hr.envFront.uniforms)),fieldDirty=fieldNames.map(names=>watch(U,names));
  const probePrevious=new Float32Array(16+hr.probes.sourceIndex.size*3);
  function probeChanged(){let i=0,dirty=!probeValid;const put=v=>{v=Math.fround(v??0);if(probePrevious[i]!==v){probePrevious[i]=v;dirty=true;}i++;};for(let n=0;n<8;n++){put(hr.frame.ea?.[n]);put(hr.frame.eb?.[n]);}for(const id of hr.probes.sourceIndex.keys()){const q=hr.frame.q?.[id],c=q?.rgb??q;put(c?.[0]);put(c?.[1]);put(c?.[2]);}probeValid=true;return dirty;}
  function invalidate(){frameDirty?.invalidate();staticDirty?.invalidate();backDirty.invalidate();frontDirty.invalidate();for(const d of fieldDirty)d.invalidate();probeValid=false;}
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
      const dz=envD?.get(pass);
      try{r.render(dz?.ok()?dz.scene:pass.scene,hr.fsCam);}finally{r.setScissorTest(false);}
      cropStats.draws++;cropStats.shadedPixels+=target.width*(rect?rect.h:target.height);
    }
    // A fallback may paint outside the proof's region. Re-clear before using
    // that proof again if its original source is restored later.
    if(validProof)fieldInitialized.add(key);else fieldInitialized.delete(key);
  }
  const restored=()=>{fieldInitialized.clear();invalidate();};
  const api={ballCrop,quality,setTier(name){const i=TIERS.findIndex(t=>t.name===name);if(i<1||!renderLite)return false;quality.probe=null;quality.index=i;quality.tier=name;setLite(TIERS[i].scale,TIERS[i].msaa);return true;},setFieldCropEnabled(on){fieldCropEnabled=!!on;invalidate();},setEnabled(on){enabled=!!on;invalidate();},invalidate,stats,diagnostics(){return{enabled,dispFit:dispFit?{...fit,uPBK:[uPBK.value.x,uPBK.value.y],ballTarget:[balls.width,balls.height]}:false,...stats,fieldCrop:{enabled:fieldCropEnabled,...cropStats,rects,backProof:proofCurrent(backProof,bakeBack),frontProof:proofCurrent(frontProof,bakeFront)},fieldResolution:[W/S,H/S],basisFormat:'sRGB8 linear decoded',renderLite,liteCanvas,canvasSize:[r.domElement.width,r.domElement.height],renderScale:+(W/RW).toFixed(3),quality:{...quality,history:[...quality.history]},liteCrop,compositeResolution:[RW,RH],ballResolution:[balls.width,balls.height],ballSamples:balls.samples,ballCrop:ballCrop?.diagnostics()??null,probeBasis:{format:'RGB9E5',faceSize:compact.faceSize,bytes:compact.bytes,originalBytes:compact.sourceBytes},additionalMiB:(n*4+(W/S)*(H/S)*8*5+compact.bytes+compact.atlas.width*compact.atlas.height*8)/1048576};},dispose(){if(disposed)return;disposed=true;hr.render=legacy;hr.dispose=dispose;hr.readLinear=readLinear;restoreFull();ballCrop?.dispose();if(dispFit){if(fitBalls)fitBalls.dispose();}liteBalls?.dispose();display?.dispose();staticRT?.dispose();r.domElement.removeEventListener('webglcontextrestored',restored);for(const o of owned)o.dispose();for(const m of materials)m.dispose();delete hr.prebakeRelight;}};
  hr.prebakeRelight=api;
  hr.render=function(){
    const plate=getPlate();
    if(!enabled||hr.viewMode!==0||U.uM3Off.value!==0||!plate?.mat.uniforms.uPanel){stats.legacyFrames++;restoreFull();return legacy.call(hr);}
    if(dispFit)applyFit();
    qualityTick();
    hr.trayVisualHandle?.update();stats.frames++;
    hr._updateEnvUniforms();
    r.setScissorTest(false);
    const hb=halfBake&&(halfBakeForce||quality.index>=2||quality.lightHalf),hbA=!hb||(stats.frames&1)===0,hbB=!hb||(stats.frames&1)===1;
    if(hb)stats.halfBakeFrames=(stats.halfBakeFrames??0)+1;
    if(hbA){if(backDirty.changed())drawField(back,bakeBack);else stats.fieldReuses++;
    if(frontDirty.changed())drawField(front,bakeFront);else stats.fieldReuses++;}
    if(frameBake&&hbB){if(frameDirty.changed()){r.setRenderTarget(frameF);r.setViewport(0,0,frameF.width,frameF.height);r.render(bakeFrame.scene,hr.fsCam);stats.frameBakes=(stats.frameBakes??0)+1;}else stats.frameReuses=(stats.frameReuses??0)+1;}
    if(staticBake){
      const key=RW+'x'+RH;
      if(key!==staticKey){
        // 得点板とロゴの箱（元の画素で x 121〜1240.64、y 122.41〜515）を、今の描画解像度の画素で 2 画素の余白つきで
        const kx=W/RW,ky=H/RH,x0=Math.max(0,Math.floor(121/kx)-2),x1=Math.min(RW,Math.ceil(1240.64/kx)+2),y0=Math.max(0,Math.floor((H-515)/ky)-2),y1=Math.min(RH,Math.ceil((H-122.41)/ky)+2);
        staticRT?.dispose();staticRT=new THREE.WebGLRenderTarget(x1-x0,y1-y0,{type:THREE.FloatType,format:THREE.RGBAFormat,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:false});
        staticUni.uPBStatic.value=staticRT.texture;staticUni.uPBSo.value.set(x0,y0);staticKey=key;staticDirty.invalidate();
      }
      if(staticDirty.changed()){r.setRenderTarget(staticRT);r.setViewport(0,0,staticRT.width,staticRT.height);r.render(bakeStatic.scene,hr.fsCam);stats.staticBakes=(stats.staticBakes??0)+1;}
    }
    if(hbA)for(let i=1;i<3;i++){if(fieldDirty[i].changed()){bakeFields.material.uniforms.uPBLayer.value=i;drawField(fields,bakeFields,i);}else stats.fieldReuses++;}
    if(hr.balls.count&&hbB){if(probeChanged()){compact.compose(hr.frame);stats.probeUpdates++;}else stats.probeReuses++;}
    extra.uPBLCDOn.value=plate?.mesh.visible?1:0;
    if(plate){extra.uPBLCD.value=plate.mat.uniforms.uT.value;extra.uPBRect.value.copy(plate.mat.uniforms.uRect.value);extra.uPBPanel.value.copy(plate.mat.uniforms.uPanel.value);extra.uPBGain.value=plate.mat.uniforms.uGain.value;}
    balls=ballCrop?.select()??balls;final.material.uniforms.uD.value=balls.texture;
    r.setRenderTarget(balls);r.setViewport(0,0,RW,RH);r.setClearColor(0x000000,0);r.clear(true,true,false);
    if(ballSel&&hr.balls.count)ballSelect();
    const oldBallMaterial=hr.balls.material;hr.balls.material=ballMaterial;
    try{if(hr.balls.count||hr.trayVisual)r.render(hr.sBalls,hr.camera);}finally{hr.balls.material=oldBallMaterial;}
    U.uUseLut.value=hr.lutEnabled?1:0;
    if(liteCanvas){setCanvas(RW,RH);r.setRenderTarget(null);}else r.setRenderTarget(display);
    r.setViewport(0,0,RW,RH);r.render(final.scene,hr.fsCam);
    if(present){r.setRenderTarget(null);r.setViewport(0,0,W,H);r.render(present.scene,hr.fsCam);}
  };
  hr.dispose=function(){api.dispose();return dispose.call(hr);};
  // Debug C/D readbacks materialize the reference HDR path on demand.
  hr.readLinear=function(...args){if(!enabled)return readLinear.apply(hr,args);try{restoreFull();legacy.call(hr);return readLinear.apply(hr,args);}finally{hr.render();}};
  r.domElement.addEventListener('webglcontextrestored',restored);
  return api;
}
