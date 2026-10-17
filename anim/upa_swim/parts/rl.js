// ================= 重複ルーレット(通常画面 → 異変 → 盤 → 結果 → 通常画面) =================
// 盤の部品・文字・連番は work/roulette_lcd/assets の事前描画(Blender等)を使う。無い部品は仮の絵で補う。
const RL={ascs:[],discOn:false,discOut:99,retAt:99,endAt:99,t0dup:null,titleOutT:undefined,shatT:null,zoomK:0,on:false,t:0,cfg:null,done:0,sat:null,shk:0,pun:0,pulse:0,nsScale:1,vig:0,flashA:0,spot:0,upaOn:false,bubbles:[],ev:[],lampOn:[],lit:0};
const RLC={cx:W/2,cy:H/2,Rf:440};          // 盤の中心と、面の半径(px)
// 針: 最初は一気に最高速、そこから連続的に減速し、最後の約2.7秒は「ため」(ゆっくり1目盛りずつ)
const RLT={ramp0:1.25,ramp1:1.5,dec0:3.3,W0:1700,Wc:280,T:6.0,spinRamp:0.25};
const RL_CASES={
  c1:{id:'c1',n:3,result:'m1',label:'1〜3灯 −1灯',probs:[['m1',.90],['m2',.08],['m3',.02]],frac:.8},
  c2:{id:'c2',n:4,result:'m2',label:'4灯 −2灯',probs:[['m1',.75],['all',.03],['m3',.07],['m2',.15]],frac:.55},
  c3:{id:'c3',n:5,result:'all',label:'5灯 全消灯',probs:[['m1',.50],['all',.15],['m3',.10],['m2',.25]],frac:.5},
};
const RL_TIER={m1:{face:'rl_face_1.png',txt:'−1',c0:'#3a0a12',c1:'#6a1020',ink:'#f3ecdf'},m2:{face:'rl_face_2.png',txt:'−2',c0:'#7a0a1c',c1:'#d0102a',ink:'#fff4e8'},
  m3:{face:'rl_face_3.png',txt:'−3',c0:'#a01808',c1:'#ff4a28',ink:'#fff'},all:{face:'rl_face_4.png',txt:'全消灯',c0:'#050203',c1:'#1a0508',ink:'#f3ecdf'}};
const RL_TITLE={dup:'おなじ あな',m1:'−1灯',m2:'−2灯',m3:'−3灯',all:'全消灯'};
const rlSm=u=>{u=clamp(u,0,1);return u*u*(3-2*u)};
function kf(t,pts){ // [[t,v],...] をなめらかにつなぐ
  if(t<=pts[0][0])return pts[0][1];
  for(let i=1;i<pts.length;i++)if(t<=pts[i][0]){const a=pts[i-1],b=pts[i];return a[1]+(b[1]-a[1])*rlSm((t-a[0])/(b[0]-a[0]))}
  return pts[pts.length-1][1];
}
// ---- 仮の絵(本番の素材が無いときだけ使う) ----
const RLSTUB={};
function cvs(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c}
function RT(name){
  if(A[name])return A[name];
  if(RLSTUB[name])return RLSTUB[name];
  let c;
  const R=(a)=>a*Math.PI/180;
  if(name==='rl_rim.png'){c=cvs(1024,1024);const g=c.getContext('2d');
    const gr=g.createRadialGradient(512,512,410,512,512,512);gr.addColorStop(0,'#2a1519');gr.addColorStop(.5,'#0e0709');gr.addColorStop(1,'#050203');
    g.fillStyle=gr;g.beginPath();g.arc(512,512,512,0,7);g.arc(512,512,410,0,7,true);g.fill();
    g.strokeStyle='#b3001b';g.lineWidth=5;g.beginPath();g.arc(512,512,418,0,7);g.stroke();
    for(let i=0;i<50;i++){const a=R(i*7.2-90),l=i%5?14:26;g.strokeStyle='rgba(220,200,195,.7)';g.lineWidth=i%5?2:4;g.beginPath();g.moveTo(512+Math.cos(a)*492,512+Math.sin(a)*492);g.lineTo(512+Math.cos(a)*(492-l),512+Math.sin(a)*(492-l));g.stroke()}}
  else if(/^rl_face_\d/.test(name)){const k=+name.match(/\d/)[0];c=cvs(512,512);const g=c.getContext('2d');
    const col=[['#2a070e','#6a1020'],['#6a0818','#d0102a'],['#901408','#ff4a28'],['#030102','#16070b']][k-1];
    const gr=g.createRadialGradient(256,256,20,256,256,256);gr.addColorStop(0,col[0]);gr.addColorStop(1,col[1]);g.fillStyle=gr;g.fillRect(0,0,512,512)}
  else if(name==='rl_dome.png'){c=cvs(1024,1024);const g=c.getContext('2d');g.fillStyle='#000';g.fillRect(0,0,1024,1024);
    const gr=g.createRadialGradient(360,300,0,360,300,360);gr.addColorStop(0,'rgba(255,255,255,.35)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(0,0,1024,1024)}
  else if(name==='rl_hub.png'){c=cvs(256,256);const g=c.getContext('2d');const gr=g.createRadialGradient(100,100,5,128,128,120);gr.addColorStop(0,'#8a7a78');gr.addColorStop(1,'#120a0c');g.fillStyle=gr;g.beginPath();g.arc(128,128,120,0,7);g.fill();g.fillStyle='#b3001b';g.beginPath();g.arc(128,128,26,0,7);g.fill()}
  else if(name==='rl_needle.png'){c=cvs(512,1024);const g=c.getContext('2d');const gr=g.createLinearGradient(0,512,0,60);gr.addColorStop(0,'#8a7a78');gr.addColorStop(1,'#ffffff');g.fillStyle=gr;g.beginPath();g.moveTo(236,512);g.lineTo(254,60);g.lineTo(258,60);g.lineTo(276,512);g.fill();g.fillStyle='#b3001b';g.fillRect(254,100,4,400)}
  else if(name==='rl_needle_glow.png'){c=cvs(512,1024);const g=c.getContext('2d');g.fillStyle='#000';g.fillRect(0,0,512,1024);const gr=g.createRadialGradient(256,64,0,256,64,110);gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(.2,'rgba(255,90,60,.8)');gr.addColorStop(1,'rgba(255,30,20,0)');g.fillStyle=gr;g.fillRect(0,0,512,300)}
  else if(name==='rl_divider.png'){c=cvs(32,512);const g=c.getContext('2d');const gr=g.createLinearGradient(0,0,32,0);gr.addColorStop(0,'rgba(120,110,110,.6)');gr.addColorStop(.5,'rgba(255,245,240,.95)');gr.addColorStop(1,'rgba(120,110,110,.6)');g.fillStyle=gr;g.fillRect(0,0,32,512)}
  else if(name==='rl_shadow.png'){c=cvs(512,512);const g=c.getContext('2d');const gr=g.createRadialGradient(256,256,150,256,256,256);gr.addColorStop(0,'rgba(0,0,0,.85)');gr.addColorStop(.7,'rgba(40,0,6,.5)');gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(0,0,512,512)}
  else if(name==='rl_lamp_off.png'||name==='rl_lamp_on.png'){c=cvs(128,128);const g=c.getContext('2d');g.translate(64,64);const on=name==='rl_lamp_on.png';
    if(on){g.fillStyle='#000';g.fillRect(-64,-64,128,128)}
    for(let i=0;i<5;i++){g.save();g.rotate(R(i*72));g.beginPath();g.moveTo(0,0);g.bezierCurveTo(-22,-18,-20,-50,0,-56);g.bezierCurveTo(20,-50,22,-18,0,0);g.fillStyle=on?'rgba(255,90,70,.95)':'#1a0a0d';g.fill();g.restore()}
    if(on){const gr=g.createRadialGradient(0,0,0,0,0,30);gr.addColorStop(0,'rgba(255,255,255,.95)');gr.addColorStop(1,'rgba(255,60,40,0)');g.fillStyle=gr;g.fillRect(-64,-64,128,128)}}
  else if(name==='rl_arc_trail.png'){c=cvs(1024,1024);const g=c.getContext('2d');g.fillStyle='#000';g.fillRect(0,0,1024,1024);
    const cg=g.createConicGradient(R(-90-160),512,512);cg.addColorStop(0,'rgba(255,40,30,0)');cg.addColorStop(160/360,'rgba(255,200,180,.9)');cg.addColorStop(160.01/360,'rgba(0,0,0,0)');cg.addColorStop(1,'rgba(0,0,0,0)');
    g.fillStyle=cg;g.beginPath();g.arc(512,512,500,0,7);g.arc(512,512,280,0,7,true);g.fill()}
  else if(/^rl_t_(\w+)_(face|glow|shadow)\.png$/.test(name)){const m=name.match(/^rl_t_(\w+)_(face|glow|shadow)\.png$/),txt=RL_TITLE[m[1]]||'?',kind=m[2];
    c=cvs(900,320);const g=c.getContext('2d');const RLF='"Noto Sans CJK JP","Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif';g.font='900 250px '+RLF;{const mw=g.measureText(txt).width;if(mw>840)g.font='900 '+Math.floor(250*840/mw)+'px '+RLF}g.textAlign='center';g.textBaseline='middle';
    if(kind==='glow'){g.fillStyle='#000';g.fillRect(0,0,900,320);g.shadowColor='rgba(255,40,30,1)';g.shadowBlur=50;g.fillStyle='rgba(255,60,40,.8)';g.fillText(txt,450,165)}
    else if(kind==='shadow'){g.shadowColor='rgba(0,0,0,.9)';g.shadowBlur=30;g.fillStyle='rgba(0,0,0,.9)';g.fillText(txt,462,180)}
    else{const dark=m[1]==='all';const gr=g.createLinearGradient(0,40,0,290);if(dark){gr.addColorStop(0,'#e8e0d8');gr.addColorStop(.5,'#2a2a2e');gr.addColorStop(1,'#050505')}else{gr.addColorStop(0,'#fff0e8');gr.addColorStop(.45,'#e01830');gr.addColorStop(1,'#5a0010')}
      g.lineWidth=14;g.strokeStyle=dark?'#c8c0c0':'#fff4ec';g.lineJoin='round';g.strokeText(txt,450,165);g.fillStyle=gr;g.fillText(txt,450,165)}}
  else if(name==='rl_bubble.png'){c=cvs(128,128);const g=c.getContext('2d');const gr=g.createRadialGradient(64,64,30,64,64,62);gr.addColorStop(0,'rgba(190,230,255,0)');gr.addColorStop(.85,'rgba(190,230,255,.25)');gr.addColorStop(1,'rgba(255,255,255,.9)');g.fillStyle=gr;g.beginPath();g.arc(64,64,62,0,7);g.fill();g.fillStyle='rgba(255,255,255,.9)';g.beginPath();g.ellipse(44,40,10,6,-.6,0,7);g.fill()}
  else{c=cvs(4,4)}
  const t=PIXI.Texture.from(c);RLSTUB[name]=t;return t;
}
const RLIMG=['rl_rim.png','rl_dome.png','rl_hub.png','rl_needle.png','rl_needle_glow.png','rl_divider.png','rl_shadow.png','rl_lamp_off.png','rl_lamp_on.png','rl_arc_trail.png','rl_face_1.png','rl_face_2.png','rl_face_3.png','rl_face_4.png'];
for(const k of ['dup','m1','m2','m3','all'])for(const q of ['face','glow','shadow'])RLIMG.push(`rl_t_${k}_${q}.png`);
// ---- 場面 ----
// 盤・文字・砕ける画面・火の粉は 3D層(rl3d.mjs: three.js)が描く。ここは演出の時間割と、PixiJS側の画づくり(暗転・赤・ウパ・連番の光)。
let Lgrade,LgradeUp,Lrl,Lrlfx,rlBlack,rlRed,rlVig,rlVigB,rlFlash,rlSat;
let R3=null,r3cv=null,r3Spr=null,r3Tex=null,ascSpr=null,ascTex=null,ascCtx=null,ascData=null,ascBack=null,ascFront=null;
const R_=d=>d*Math.PI/180;
function rlBuild(){
  const ins=(c,before)=>{world.addChildAt(c,world.getChildIndex(before))};
  Lgrade=new PIXI.Container();ins(Lgrade,Lupa);
  LgradeUp=new PIXI.Container();ins(LgradeUp,Lfront);
  Lrl=new PIXI.Container();ins(Lrl,Lvig);Lrlfx=new PIXI.Container();ins(Lrlfx,Lvig);
  const wh=(c,tint,add,a)=>{const s=new PIXI.Sprite(PIXI.Texture.WHITE);s.tint=tint;s.position.set(-PAD,-PAD);s.width=W+2*PAD;s.height=H+2*PAD;s.alpha=a||0;if(add)s.blendMode=BM.ADD;c.addChild(s);return s};
  rlBlack=wh(Lgrade,0x000008,false,0);
  rlRed=wh(Lgrade,0x7a0a18,false,0);rlRed.blendMode=BM.MULTIPLY;
  rlVigB=new PIXI.Sprite(vigTex());rlVigB.position.set(-PAD,-PAD);rlVigB.width=W+2*PAD;rlVigB.height=H+2*PAD;rlVigB.alpha=0;LgradeUp.addChild(rlVigB);
  rlVig=new PIXI.Sprite(vigTex());rlVig.position.set(-PAD,-PAD);rlVig.width=W+2*PAD;rlVig.height=H+2*PAD;rlVig.tint=0xff1020;rlVig.blendMode=BM.ADD;rlVig.alpha=0;LgradeUp.addChild(rlVig);
  rlFlash=wh(Lrlfx,0xff7050,true,0);
  rlSat=new PIXI.ColorMatrixFilter();
  // 昇天するウパだけ別のバッファに描く(赤い暗転の色をかぶせないため)
  ascCtx=null;
  rl3Init();
}
function rl3Init(){
  if(R3||!window.NSLIB||!NSLIB.RL3D)return;
  try{
    r3cv=document.createElement('canvas');
    const k=RES>=1?0.667:0.5;
    const tex={};for(const n of RLIMG){const t=A[n];if(t&&t.baseTexture&&t.baseTexture.resource)tex[n]=t.baseTexture.resource.source}
    R3=new NSLIB.RL3D({canvas:r3cv,width:Math.round((W+2*PAD)*k),height:Math.round((H+2*PAD)*k),tex,worldW:W+2*PAD,worldH:H+2*PAD});
    r3Tex=PIXI.Texture.from(r3cv);r3Spr=new PIXI.Sprite(r3Tex);r3Spr.position.set(-PAD,-PAD);r3Spr.width=W+2*PAD;r3Spr.height=H+2*PAD;r3Spr.visible=false;Lrl.addChild(r3Spr);
  }catch(e){console.warn('rl3d failed',e);R3=null}
}
function rlAscInit(){
  if(!bdata||(ascCtx&&ascCtx.canvas.width===LW&&ascCtx.canvas.height===LH))return;
  if(ascSpr){ascSpr.destroy();ascSpr=null}
  const c=document.createElement('canvas');c.width=LW;c.height=LH;ascCtx=c.getContext('2d');ascData=ascCtx.createImageData(LW,LH);
  ascTex=new PIXI.Texture(PIXI.BaseTexture.from(c,{scaleMode:PIXI.SCALE_MODES.NEAREST}));ascSpr=new PIXI.Sprite(ascTex);ascSpr.visible=false;
  if(!ascBack){ascBack=new PIXI.Graphics();ascFront=new PIXI.Graphics()}
  Lupa.addChild(ascBack);Lupa.addChild(ascSpr);Lupa.addChild(ascFront);
}
// ---- 札の配置 ----
function rlLayout(cfg){
  const segs=[];let a=270-cfg.probs[0][1]*360/2;
  for(const [k,p] of cfg.probs){const w=p*360;segs.push({k,a0:a,a1:a+w,w,mid:a+w/2});a+=w}
  return segs;
}
function rlLabelCanvas(T){
  const lc=cvs(512,200),g=lc.getContext('2d');g.font='900 150px "Noto Sans CJK JP","Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif';g.textAlign='center';g.textBaseline='middle';
  g.lineJoin='round';g.lineWidth=16;g.strokeStyle='rgba(0,0,0,.65)';g.strokeText(T.txt,256,104);
  const gr=g.createLinearGradient(0,30,0,170);gr.addColorStop(0,'#ffffff');gr.addColorStop(1,T.ink);g.fillStyle=gr;g.fillText(T.txt,256,104);
  return lc;
}
function rlSetup(cfg){
  const segs=rlLayout(cfg);RL.segs=segs;
  const Rf=RLC.Rf,labels={},tiers={};
  for(const s of segs){
    const T=RL_TIER[s.k];tiers[s.k]=T.face;if(!labels[s.k])labels[s.k]=rlLabelCanvas(T);
    const arc=R_(s.w)*Rf*0.62;s.inside=arc>110;
    s.labScale=(s.inside?(s.k==='all'?0.45:0.62):0.42)*Rf/440;
    if(s.inside&&s.w>120)s.labScale=0.9*Rf/440;
  }
  if(R3)R3.buildDisc(segs,labels,tiers,Rf);
  RL.target=(()=>{const s=segs.find(x=>x.k===cfg.result);return s.a0+s.w*cfg.frac})();
  // 針の回転(目標の角度で止まる)。残りの距離から逆算する
  const N=Math.round(RLT.T*2000);RL.cum=new Float64Array(N+1);
  for(let i=1;i<=N;i++)RL.cum[i]=RL.cum[i-1]+rlOmega((i-.5)/2000)/2000;
}
function rlOmega(t){
  const T=RLT;
  if(t<T.ramp0)return 0;
  if(t<T.ramp1)return T.W0*rlSm((t-T.ramp0)/(T.ramp1-T.ramp0));
  if(t<T.dec0)return T.W0*Math.pow(T.Wc/T.W0,(t-T.ramp1)/(T.dec0-T.ramp1));   // 速い→中速へ、指数的に落ちる
  if(t<T.T){const u=(t-T.dec0)/(T.T-T.dec0);return T.Wc*Math.pow(1-u,2.3)}      // ため: 最後がとても長く遅い
  return 0;
}
function rlTheta(t){
  const T=RLT,N=RL.cum.length-1,at=x=>RL.cum[Math.min(N,Math.max(0,Math.round(x*2000)))];
  const tt=Math.min(t,T.T);let th=RL.target-(at(T.T)-at(tt));
  if(t>T.T){const u=t-T.T;th+=1.1*Math.exp(-u*14)*Math.sin(u*70)}
  return th;
}
// 結果ごとに昇天するウパの数 = 消える灯の数
function rlAscCount(cfg){const n=cfg.n;if(cfg.result==='all')return n;return Math.min(n,{m1:1,m2:2,m3:3}[cfg.result]||1)}
// ---- 開始 ----
function rlStart(id){
  if(RL.on)return;
  const cfg=typeof id==='object'?id:RL_CASES[id];if(!cfg||!SPR)return;
  rl3Init();rlAscInit();
  RL.on=true;RL.t=-0.8;RL.cfg=cfg;RL.done=0;RL.ev=[];RL.bubbles.forEach(b=>b.s.destroy());RL.bubbles=[];
  RL.nAsc=rlAscCount(cfg);RL.ascT0=RLT.T+1.5;RL.allAsc=RL.nAsc>=cfg.n&&cfg.n>=2;RL.ascGap=RL.allAsc?0.09:0.38;   // 灯が全部消える時は、全員がほぼ同時に昇天する(ディレクター 10/17)
  RL.retAt=RL.ascT0+(RL.nAsc-1)*RL.ascGap+2.45;      // 昇天が終わったら通常画面へ
  RL.endAt=RL.retAt+2.0;
  RL.discOn=false;RL.discOut=99;RL.shatT=null;RL.litSave=lit;lit=cfg.n;RL.ascs=[];RL.sparks=0;
  RL.upaRelease=false;RL.retT=0;RL.resT=0;RL.stopT=0;RL.t0dup=null;RL.titleOutT=undefined;
  rlSetup(cfg);
  setCount(cfg.n);
  for(const u of upas){u.show=null;u.zoom=1;u.asc=null;u.white=0;u.mono=0;u.alp=1;u.rel=0}
  RL.upaT=0;RL.prevIdx=null;
  if(R3){R3.clearParticles();R3.clearShards();for(const id2 in R3.titles)R3.titles[id2].g.visible=false;r3Spr.visible=true}
  Lbase.filters=[rlSat];
  const tt=RLT.T;
  RL.trig=[
    [-0.80,()=>{RL.pulse=0.5;RL.shk=5;RL.ev.push({t:RL.t,beat:1})}],
    [-0.42,()=>{RL.pulse=0.8;RL.shk=9;RL.ev.push({t:RL.t,beat:2})}],
    [-0.14,()=>{RL.pulse=1;RL.shk=14;RL.ev.push({t:RL.t,beat:3})}],
    [0.00,()=>{rlShatter()}],
    [0.50,()=>{RL.shk=16;RL.pun=0.05;rlFlashAdd(0.25);RL.t0dup=RL.t;if(R3)R3.burst(0,60,100,80,{speed:2200,life:1.2,size:36,zk:0.6});rlFX('impact_2',{size:2600,tint:0xff5040,a:.6});rlFX('speed_1',{x:0,y:0,size:W*1.3,tint:0xff3030,a:.5,loop:true,life:1.0,fade:.35})}],
    [0.62,()=>{RL.pulse=1;rlFX('shock_2',{size:1800,tint:0xff2030,a:.35})}],
    [0.92,()=>{RL.pulse=1;rlFX('shock_2',{size:1800,tint:0xff2030,a:.35})}],
    [1.10,()=>{rlDiscIn()}],
    [1.22,()=>{rlFX('sweep_1',{x:0,y:-40,size:2600,tint:0xff6a5a,a:.6})}],
    [1.75,()=>{rlFX('speed_1',{x:0,y:0,size:W*1.5,tint:0xff2a2a,a:.25,loop:true,life:1.1,fade:.4})}],
    [2.05,()=>{rlFX('crack_1',{size:2600,tint:0xff6a5a,a:.25})}],
    [tt-0.3,()=>{RL.shk=Math.max(RL.shk,6);RL.pulse=0.6}],
    [3.7,()=>{rlFX('crack_2',{size:2800,tint:0xff6a5a,a:.3});RL.shk=Math.max(RL.shk,8)}],
    [tt-0.9,()=>{rlFX('crack_1',{size:3000,tint:0xffb0a0,a:.4});RL.shk=Math.max(RL.shk,12);RL.pulse=1}],
    [tt,()=>{rlStop()}],
    [tt+0.12,()=>{rlResultIn()}],
    [RL.ascT0-0.35,()=>{RL.discOut=RL.t;rlTitleExit()}],
    [RL.retAt,()=>{rlReturn()}],
  ];
  for(let j=0;j<RL.nAsc;j++){const idx=cfg.n-1-j;RL.trig.push([RL.ascT0+j*RL.ascGap,()=>rlAscStart(idx,j)])}
  RL.fired=RL.trig.map(()=>false);
}
function rlFX(n,o){ // 連番の光(画面中心基準・Lrlfx)
  const nm=fbHas(n)?n:n.replace(/_\d+$/,'_1');
  return addFB(Lrlfx,nm,Object.assign({},o,{x:W/2+(o.x||0),y:H/2+(o.y||0)}));
}
function rlFlashAdd(a){RL.flashA=Math.max(RL.flashA,a)}
// 直前の画面をスナップして、ガラスのように砕いて手前へ飛ばす
function rlShatter(){
  RL.pulse=1;RL.shk=22;RL.pun=0.05;HIT=Math.max(HIT,0.05);rlFlashAdd(0.35);
  rlFX('shock_1',{size:3200,tint:0xff3040,a:.8});rlFX('impact_1',{size:2200,tint:0xff4a3a,a:.5});rlFX('crack_1',{size:2800,tint:0xffe0d8,a:.9});
  if(R3){
    try{const cv=document.createElement('canvas');cv.width=app.view.width;cv.height=app.view.height;cv.getContext('2d').drawImage(app.view,0,0);R3.shatter(cv,0,0);RL.shatT=RL.t}catch(e){console.warn('shatter',e)}
    R3.burst(0,0,100,100,{speed:2600,life:1.5,size:36,zk:0.6});
  }
}
function rlDiscIn(){RL.discOn=true;RL.discT=RL.t;rlFlashAdd(.2);if(R3)R3.burst(0,0,-300,70,{speed:1500,life:1.3,size:50,zk:0.6})}
function rlStop(){
  RL.shk=30;RL.pun=0.085;HIT=Math.max(HIT,0.12);RL.stopT=RL.t;RL.flashA=Math.max(RL.flashA,.12);
  if(R3){const th=rlTheta(RLT.T)*Math.PI/180,r=RLC.Rf*1.0;R3.burst(Math.sin(th)*r,Math.cos(th)*r,40,90,{speed:1800,life:1.0,size:45,zk:0.5})}
}
function rlResultIn(){
  const q=RL.cfg.result;RL.resT=RL.t;
  RL.shk=26;RL.pun=0.07;
  const dark=q==='all',tint=dark?0xff2a2a:0xff5a4a;
  rlFX('impact_1',{size:2800,tint:0xff7a60,a:.28});rlFX('impact_3',{size:3200,tint,a:.4,delay:.04});
  rlFX('shock_1',{size:3400,tint,a:.7});rlFX('shock_2',{size:2600,tint:0xff8070,a:.35,delay:.07});
  rlFX('crack_2',{size:2800,tint:0xffc4b4,a:.55});rlFX('ember_1',{size:2400,tint:0xffa070,a:.9});
  rlFX('sweep_1',{y:0,size:3000,tint:0xffb0a0,a:.35});
  rlFX('pillar_1',{size:3000,tint,a:.4});
  if(R3)R3.burst(0,0,150,80,{speed:2000,life:1.5,size:28,zk:0.5});
}
function rlTitleExit(){RL.titleOutT=RL.t}
// ---- 昇天 ----
// にゃんこ大戦争と同じ作り: やられると白く光り、白黒の「天使の姿」(輪っかと小さな羽)になって、ゆっくり真上へ昇っていく。
function rlAscStart(idx,j){
  const u=upas[idx];if(!u)return;
  const a={u,idx,j,t0:RL.t,x0:u.x,y0:u.y,lamp:false,done:false,sp:0,tAcc:0};
  RL.ascs.push(a);u.asc=a;
  a.glow=S('glow_soft.png',{add:true,tint:0xfff2d8,alpha:0});Lrlfx.addChild(a.glow);
  rlFlashAdd(RL.allAsc?0.06:0.14);
  if(RL.allAsc&&j===0){rlFlashAdd(0.35);rlFX('shock_1',{size:3800,tint:0xfff0d0,a:.85});rlFX('shock_2',{size:3000,tint:0xffffff,a:.5,delay:.08});rlFX('pillar_1',{size:3000,tint:0xffe9a0,a:.7})}
  addFB(Lrlfx,fbHas('shock_1')?'shock_1':'impact_1',{x:u.x,y:u.y,size:900,tint:0xfff0d8,a:.45});
  for(let i=0;i<10;i++)addP(Lrlfx,'glint_'+(1+i%3),{add:true,tint:0xfff4d8,x:u.x,y:u.y,vx:rnd(-600,600),vy:rnd(-600,600),drag:2.4,sc0:rnd(0.5,1.0),sc1:0.1,life:rnd(0.4,0.8),a:0.9,fin:0.02,fout:0.5,rot:rnd(0,6.28),vr:rnd(-4,4)});
}
// 羽: 根元(0,0)から外へ。sg=-1/+1 で左右
function rlWing(g,ox,oy,sg,bw,ang,a){
  const P=[[0,0],[0.30,-0.22,0.78,-0.34,0.92,-0.10],[0.95,-0.02,0.84,0.04,0.80,0.08],[0.74,0.02,0.64,0.14,0.58,0.15],[0.54,0.10,0.44,0.20,0.36,0.20],[0.30,0.16,0.12,0.20,0,0.10]];
  const c=Math.cos(ang*sg),s=Math.sin(ang*sg);
  const T=(x,y)=>[ox+sg*(x*c-y*s*sg)*bw*1.0,oy+(x*s*sg+y*c)*bw*1.0];
  g.lineStyle(Math.max(3,bw*0.02),0x70707c,a);g.beginFill(0xffffff,a*0.97);
  let p=T(0,0);g.moveTo(p[0],p[1]);
  for(let k=1;k<P.length;k++){const q=P[k],c1=T(q[0],q[1]),c2=T(q[2],q[3]),e=T(q[4],q[5]);g.bezierCurveTo(c1[0],c1[1],c2[0],c2[1],e[0],e[1])}
  g.closePath();g.endFill();
}
function rlAscUpdate(a,dt,t){
  if(a.dead)return;
  const u=a.u,e=t-a.t0,bw=SW*P.sz*0.62,bh=SH*P.sz*0.62;
  let wingA=0,haloA=0;
  if(e<0.35){
    // やられた瞬間: 白く光って一瞬止まる
    const p=clamp(e/0.12);
    u.mono=0;u.white=0.55+0.45*Math.min(1,e/0.06);u.alp=1;
    u.sx=u.sy=0.62*(1+0.2*easeOutBack(p)*(1-0.5*clamp((e-0.22)/0.13)));
    u.x=a.x0+Math.round(Math.sin(e*140)*5);u.y=a.y0+Math.round(Math.cos(e*120)*3);u.tilt=Math.sin(e*60)*0.05;
    u.amp=0.5;u.wph=(e*4)%1;a.y=u.y;
    if(!a.lamp&&e>0.1){a.lamp=true;lit=Math.max(0,lit-1);pulse=0}
  }else{
    const r=e-0.35;
    // 天使の姿(白黒)。ふくらんで落ち着く
    u.mono=1;u.white=Math.max(0,0.32*(1-r/0.5));
    u.sx=u.sy=0.62*(1+0.14*Math.exp(-r*7));
    a.sp=40+230*rlSm(r/1.6);                      // ゆっくり、一定に近い速さで真上へ
    a.y=(a.y===undefined?a.y0:a.y)-a.sp*dt;
    u.y=a.y+Math.sin(r*4.2)*6;u.x=a.x0+Math.sin(r*2.3)*24;
    u.tilt=Math.sin(r*2.3+1)*0.04;u.amp=0.3;u.wph=(r*1.6)%1;
    u.alp=clamp((u.y+bh*0.5+40)/(H*0.22));
    wingA=clamp(r/0.18);haloA=clamp((r-0.06)/0.16);
    // ときどき小さな光
    a.tAcc+=dt*9;
    while(a.tAcc>=1){a.tAcc-=1;addP(Lrlfx,'glint_'+(1+((Math.random()*3)|0)),{add:true,tint:0xfff0d0,x:u.x+rnd(-bw*0.5,bw*0.5),y:u.y+rnd(-bh*0.3,bh*0.5),vx:rnd(-20,20),vy:rnd(30,100),sc0:rnd(0.3,0.6),sc1:0.1,life:rnd(0.6,1.0),a:0.8*u.alp,fin:0.05,fout:0.6,rot:rnd(0,6.28),vr:rnd(-3,3)})}
    if(u.alp<=0.01&&!a.done)a.done=true;
  }
  const al=u.alp;
  // 羽(体の後ろ)と輪っか(頭の上)
  if(wingA>0&&al>0.01){
    const flap=Math.sin((e-0.35)*7)*0.28-0.1,wy=u.y-bh*0.08;
    rlWing(ascBack,u.x-bw*0.22,wy,-1,bw*0.62,flap,al*wingA);rlWing(ascBack,u.x+bw*0.22,wy,1,bw*0.62,flap,al*wingA);
  }
  if(haloA>0&&al>0.01){
    const hy=u.y-bh*0.5-bw*0.075+Math.sin(e*5)*3;
    ascFront.lineStyle(Math.max(5,bw*0.035),0xffe9a0,al*haloA*0.35);ascFront.drawEllipse(u.x,hy,bw*0.2,bw*0.06);
    ascFront.lineStyle(Math.max(3,bw*0.018),0xfffbe8,al*haloA);ascFront.drawEllipse(u.x,hy,bw*0.2,bw*0.06);
  }
  a.glow.position.set(u.x,u.y);a.glow.scale.set(2.6);a.glow.alpha=(0.5*Math.exp(-e*1.6)+0.12)*al;
  if(a.done){if(a.glow){a.glow.destroy();a.glow=null}a.dead=true}
}
function rlReturn(){
  RL.retT=RL.t;
  rlFX('shock_1',{size:3600,tint:0xaee8ff,a:.8});rlFX('shock_2',{size:2800,tint:0xffffff,a:.6,delay:.1});rlFX('sweep_1',{size:3000,tint:0xbfeaff,a:.8});
  rlFlashAdd(.35);
  // 泡と花びらが吹き上がる
  for(let i=0;i<110;i++){
    const s=new PIXI.Sprite(RT(Math.random()<.8?'rl_bubble.png':'glow_soft.png'));s.anchor.set(0.5);
    const sz=rnd(26,150);s.width=s.height=sz;s.position.set(W/2+rnd(-900,900),H+rnd(40,500));s.alpha=0;
    if(s.texture===A['glow_soft.png']){s.blendMode=BM.ADD;s.tint=0xbfe6ff}
    Lrlfx.addChild(s);RL.bubbles.push({s,vy:-rnd(500,1300)*(sz/150*0.6+0.7),x0:s.x,ph:rnd(0,6),amp:rnd(10,60),t:-rnd(0,.7),sz});
  }
  // 残ったウパを解放
  RL.upaRelease=true;
}
// ---- カメラ(3D層) ----
function rlCamera(t){
  if(!R3)return;
  const T=RLT.T,D0=R3.D0;
  const out=RL.discOut<90?kf(t,[[RL.discOut,0],[RL.discOut+0.8,1]]):0;
  let az=kf(t,[[0.55,0],[1.12,-34],[2.0,10],[3.6,-5],[T,0],[T+0.6,5],[T+1.6,-3]]);
  let el=kf(t,[[0.55,0],[1.12,46],[2.0,15],[3.6,8],[T,2],[T+0.6,3],[T+1.6,0]]);
  let dist=D0*kf(t,[[0.55,1],[1.12,1.3],[2.0,1.0],[3.6,1.0],[T,0.86],[T+0.15,0.92],[T+0.8,0.99],[T+1.6,1.0]]);
  if(t<T)az+=4*Math.sin(t*0.9);
  const roll=1.6*Math.sin(t*0.7)*kf(t,[[0.6,0],[1.2,1],[T,1],[T+0.1,0]])-3*RL.pulse*(t<T?1:0);
  // 針先へ寄る
  const th=rlTheta(Math.min(t,T))*Math.PI/180,pk=kf(t,[[T-2.4,0],[T,0.22],[T+0.5,0]]),rf=RLC.Rf;
  R3.setCam({az,el,dist:dist*(1+0.06*Math.exp(-Math.max(0,t-T)*7)*(t>=T?1:0)),roll,fov:30+3*RL.pulse,tx:Math.sin(th)*rf*pk,ty:Math.cos(th)*rf*pk,tz:0});
}
// ---- 文字(3D) ----
function rlTitle3(id,T0,o,t){
  if(!R3||T0===undefined||T0===null)return;
  const e=t-T0;
  if(e<0){R3.setTitle(id,{vis:false});return}
  const u=clamp(e/o.slam),z0=o.z0,zIn=z0*(1-u*u);
  let z=u<1?zIn:-70*Math.exp(-(e-o.slam)*8)*Math.sin((e-o.slam)*26);
  let ry=o.ry*(1-u)+4*Math.sin(e*2.3+o.ph),rx=o.rx*(1-u)+2*Math.cos(e*1.7),rz=o.rz*(1-u);
  let x=o.x0,y=o.y0,s=o.s0;
  if(o.moveAt!==undefined&&t>=o.moveAt){const m=rlSm((t-o.moveAt)/o.moveDur);y=lerp(o.y0,o.y1,m);s=lerp(o.s0,o.s1,m)}
  let a=clamp(e/0.05);
  if(o.outAt!==undefined&&t>=o.outAt){const f=clamp((t-o.outAt)/0.5);a*=1-f;z+=1100*f*f;s*=1+0.1*f}
  const jit=Math.exp(-e*7)*18;
  R3.setTitle(id,{vis:a>0.002,x:x+rnd(-jit,jit),y:y+rnd(-jit,jit),z,s,rx,ry,rz,alpha:a,glow:(0.7+0.3*Math.sin(t*14))*(e<0.3?1.5:1),shine:clamp((e-o.shine)/0.8)*1.7-0.3});
}
// 毎フレーム
function rlUpdate(dt,rdt){
  if(!RL.on)return;
  RL.t+=rdt;const t=RL.t,C=RL;
  for(let i=0;i<RL.trig.length;i++)if(!RL.fired[i]&&t>=RL.trig[i][0]){RL.fired[i]=true;RL.trig[i][1]()}
  const R0=RL.retAt;
  // 背景の暗さ・赤み・彩度(割れた瞬間にはもう暗い赤。破片が散ると奥に見える)
  const dim=kf(t,[[0,0.55],[0.25,0.8],[1.0,0.82],[3.6,0.80],[RLT.T,0.86],[R0-0.2,0.8],[R0+0.3,0.66],[R0+1.9,0]]);
  const red=kf(t,[[0,0.6],[0.3,0.95],[1.1,1],[RLT.T,1],[R0-0.2,0.9],[R0+0.3,0.6],[R0+1.9,0]]);
  const sat=kf(t,[[0,0.4],[0.5,0.3],[RLT.T,0.25],[R0+0.3,0.35],[R0+1.9,1]]);
  rlBlack.alpha=dim;rlRed.alpha=red;rlSat.reset();rlSat.saturate(sat-1,false);
  RL.nsScale=kf(t,[[-0.8,1],[-0.3,0.4],[0,0.12],[R0+0.3,0.12],[R0+1.9,1]]);
  // 心臓の拍・縁の赤
  RL.pulse*=Math.exp(-rdt*5);
  const spin=rlOmega(Math.min(t,RLT.T))/RLT.W0;
  rlVigB.alpha=kf(t,[[0,0.5],[0.5,0.6],[1.1,0.75],[RLT.T,0.9],[R0+0.3,0.5],[R0+1.9,0]]);
  rlVig.alpha=Math.min(1,0.20*kf(t,[[0,0],[0.4,1],[R0+0.3,1],[R0+1.9,0]])+0.55*RL.pulse+0.22*spin*(0.7+0.3*Math.sin(t*25)));
  if(t<0){const e=1-clamp(-t/0.8);rlVig.alpha=Math.min(1,0.7*e+0.7*RL.pulse);rlVigB.alpha=0.8*e;rlBlack.alpha=0.5*e;rlRed.alpha=0.55*e;rlSat.reset();rlSat.saturate(-0.6*e,false)}
  RL.flashA*=Math.exp(-rdt*9);rlFlash.alpha=Math.min(0.22,RL.flashA);
  upaSpr.tint=lerpTint(0xffffff,0xa86060,red*0.85);
  RL.zoomK=kf(t,[[RLT.T-1.3,0],[RLT.T,0.05]])*(t<RLT.T?1:Math.exp(-(t-RLT.T)*10));
  RL.shk*=Math.exp(-rdt*7);RL.pun*=Math.exp(-rdt*6);
  bloomK=0.7+0.5*kf(t,[[0.5,0],[1.4,1],[R0+0.3,1],[R0+1.9,0]]);
  // 3D層
  if(R3){
    rlCamera(t);
    if(RL.shatT!==null)R3.updateShards(t-RL.shatT);
    if(RL.discOn){
      const u=clamp((t-RL.discT)/1.0),ez=1-Math.pow(1-u,3);
      const out=RL.discOut<90?kf(t,[[RL.discOut,0],[RL.discOut+0.8,1]]):0;
      const th=rlTheta(t),om=rlOmega(Math.min(t,RLT.T));
      R3.setDisc({vis:out<1,x:0,y:0,z:-3800*(1-ez)-1600*out,s:1,rz:540*(1-ez),rx:-30*(1-ez),alpha:clamp(u*2.5)*(1-out)});
      R3.setNeedle(th,0.5+0.5*clamp(om/300)+(t>=RLT.T?0.8*Math.exp(-(t-RLT.T)*4):0),clamp(om/500)*0.95*clamp((t-RL.discT-0.3)/0.3));
      // 目盛り通過のイベント
      const idx=Math.floor(th/7.2);if(RL.prevIdx!==null&&idx!==RL.prevIdx&&t<=RLT.T+0.001)RL.ev.push({t,om});RL.prevIdx=idx;
      // 外周のランプ: 針の通った後ろを赤く光らせる
      for(let i=0;i<R3.NL;i++){
        const a=i*360/R3.NL;let d=((th-a)%360+360)%360;
        const trailLen=Math.max(6,om*0.05);let lv=Math.exp(-d/(trailLen*.55+3));
        const sweepIn=clamp((t-RL.discT-i*0.012)/0.15);
        let v=(0.10+lv*0.95)*sweepIn;
        if(t<RLT.ramp0+0.1)v=Math.max(v,0.18*sweepIn+0.5*Math.exp(-Math.abs(t-RL.discT-i*0.012)*7));
        const dimk=1-0.8*kf(t,[[RLT.T-1.2,0],[RLT.T-0.15,1]])*(t<RLT.T+0.1?1:0);
        let a2=v*(t>=RLT.T?(0.3+0.7*Math.exp(-(t-RLT.T)*1.2)):dimk);
        if(t>=RLT.T){const dd=Math.abs(((th-a+540)%360)-180);const near=Math.exp(-Math.pow((180-dd)/14,2));a2=Math.max(a2*0.4,near)}
        R3.setLamp(i,clamp(a2));
      }
      // 結果の札を光らせ、ほかを暗く
      const sp=kf(t,[[RLT.T-1.3,0],[RLT.T-0.35,1]])*(t<RLT.T?1:0);
      RL.segs.forEach((s,i)=>{
        let tint=lerpTint(0xffffff,0x707070,sp*0.7),la=1;
        if(t>=RLT.T){const k=clamp((t-RLT.T-0.12)/0.2),hit=s.k===RL.cfg.result;tint=hit?0xffffff:lerpTint(0xffffff,0x303030,k);la=hit?1:1-0.7*k;if(hit&&k<1)tint=lerpTint(0xffc8c0,0xffffff,k)}
        R3.setSeg(i,tint,la);
      });
      R3.setDome(0.9*(1-0.5*sp));
    }else R3.setDisc({vis:false});
    // 文字
    rlTitle3('dup',RL.t0dup,{slam:0.2,z0:2600,ry:30,rx:-10,rz:6,ph:0,x0:0,y0:H*0.07,s0:0.95,s1:0.30,y1:H*0.40,moveAt:1.05,moveDur:0.3,outAt:1.5,shine:0.25},t);
    for(const q of ['m1','m2','m3','all']){
      const mine=q===RL.cfg.result&&RL.resT>0;
      if(!mine){if(R3.titles[q])R3.titles[q].g.visible=false;continue}
      rlTitle3(q,RL.resT,{slam:0.22,z0:2300,ry:-26,rx:8,rz:-5,ph:1.3,x0:0,y0:30,s0:1.3,shine:0.35,outAt:RL.titleOutT},t);
    }
    // 火の粉(奥行きのある粒)
    if(t>0.15&&t<R0)R3.ambient(rdt,34);
    R3.updateParticles(rdt);
    R3.render();r3Tex.baseTexture.update();
  }
  // 昇天
  if(ascBack){ascBack.clear();ascFront.clear()}
  for(const a of RL.ascs)rlAscUpdate(a,dt,t);
  // 泡
  for(const b of RL.bubbles){
    b.t+=rdt;if(b.t<0)continue;b.s.y+=b.vy*rdt;b.s.x=b.x0+Math.sin(b.t*3+b.ph)*b.amp;
    b.s.alpha=Math.min(1,b.t*5)*(b.s.y<H*0.15?Math.max(0,b.s.y/(H*0.15)):1)*0.9;
  }
  // 終わり
  if(t>=RL.endAt)rlFinish();
}
function lerpTint(a,b,u){const ar=a>>16&255,ag=a>>8&255,ab=a&255,br=b>>16&255,bg=b>>8&255,bb=b&255;return ((ar+(br-ar)*u)<<16)|((ag+(bg-ag)*u)<<8)|(ab+(bb-ab)*u)}
function rlFinish(){
  RL.on=false;Lbase.filters=null;upaSpr.tint=0xffffff;
  rlBlack.alpha=0;rlRed.alpha=0;rlVig.alpha=0;rlVigB.alpha=0;rlFlash.alpha=0;
  if(R3){R3.clearParticles();R3.clearShards();R3.setDisc({vis:false});for(const id2 in R3.titles)R3.titles[id2].g.visible=false;R3.render();r3Tex.baseTexture.update();r3Spr.visible=false}
  if(ascSpr)ascSpr.visible=false;
  if(ascBack){ascBack.clear();ascFront.clear()}
  for(const a of RL.ascs)if(a.glow){a.glow.destroy();a.glow=null}
  // 昇天したウパを取り除き、灯の数と合わせる
  const keep=upas.filter(u=>!u.asc);
  for(const u of upas){u.white=0;u.mono=0;u.alp=1;u.zoom=1;u.rel=0}
  upas.length=0;for(const u of keep)upas.push(u);
  RL.ascs=[];
  RL.bubbles.forEach(b=>b.s.destroy());RL.bubbles=[];RL.nsScale=1;RL.shk=0;RL.pun=0;RL.zoomK=0;bloomK=0.7;
}
// ウパの配置(観客): 盤の左右に並べ、ふるえる。昇天する子は rlAscUpdate が動かす
function rlUpas(dt,scale){
  const n=upas.length,t=RL.t;
  const slots=[[0.13,0.34],[0.13,0.58],[0.13,0.82],[0.87,0.46],[0.87,0.72],[0.87,0.2]];
  const order=[0,3,1,4,2,5];
  const R0=RL.retAt;
  for(let i=0;i<n;i++){
    const u=upas[i],sl=slots[order[i]];
    if(u.asc&&RL.t>=u.asc.t0)continue;
    if(RL.upaRelease){
      if(!u.rel){u.rel=1;u.mode='dash';u.t=0;u.dur=1.1;u.dash=1;const dir=sl[0]<0.5?-1:1;u.tang=u.ang=dir<0?Math.PI+rnd(-0.6,0.6):rnd(-0.6,0.6);u.sp=0}
      u.zoom+=(1-u.zoom)*Math.min(1,dt*3);u.update(dt,scale,Math.sqrt(scale/5));continue;
    }
    const k=1-Math.exp(-dt*2.4);
    const tx=W*sl[0],ty=H*sl[1]+Math.sin(t*1.6+i*1.3)*10;
    u.x+=(tx-u.x)*k;u.y+=(ty-u.y)*k;
    const shiver=kf(t,[[0.0,1],[1.5,0.4],[RLT.T-1.5,0.8],[RLT.T,1.6],[RLT.T+0.55,0.3],[R0-0.5,0.2],[R0,0]]);
    const zs=0.62*Math.min(1,u.zoom+0.0);
    u.sx=u.sy=zs;u.tilt=Math.sin(t*(6+i))*0.03*shiver;u.amp=0.15*shiver;u.wph=(t*1.2+i*0.3)%1;
    u.zoom+=(0.62-u.zoom)*Math.min(1,dt*4);
    if(shiver>0.05){u.x+=Math.round(Math.sin(t*50+i*2)*3*shiver);u.y+=Math.round(Math.cos(t*43+i)*2*shiver)}
  }
}
// ---- ボタン ----
for(const id of ['c1','c2','c3']){const b=document.getElementById('rl_'+id);if(b)b.addEventListener('click',()=>{if(SPR&&!RL.on&&!showing())rlStart(id)})}
window.__rl={start:rlStart,state:()=>RL,cases:RL_CASES,r3:()=>R3};
