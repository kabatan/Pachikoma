// ================= 演出エンジン(PixiJS / WebGL) =================
// 文字・背景・光・粒は事前に作り込んだ絵(fx/*.png|jpg)を、加算合成とブルームで重ねる。
// 閲覧環境は eval を禁止しているため、シェーダ用の関数生成を eval なしの版に差し替える
try{if(PIXI.unsafeEval&&PIXI.unsafeEval.install)PIXI.unsafeEval.install(PIXI)}catch(e){}
const BM=PIXI.BLEND_MODES;
const lerp=(a,b,u)=>a+(b-a)*u;
const easeOut=x=>1-Math.pow(1-clamp(x,0,1),3);
const easeOutBack=x=>{x=clamp(x,0,1);const c1=1.70158,c3=c1+1;return 1+c3*Math.pow(x-1,3)+c1*Math.pow(x-1,2)};
const easeIn=x=>{x=clamp(x,0,1);return x*x};
const ASSET='fx/';
const IMG=['bg_night.jpg','bg_sakura.jpg','bg_gold.jpg','rays_soft.png','mist_tile.png','glow_soft.png','bokeh_disc.png',
  'flare_ring.png','flare_hex.png','flare_streak.png','glint_1.png','glint_2.png','glint_3.png','spark.png','ember.png',
  'petal_1.png','petal_2.png','petal_3.png','petal_4.png','petal_5.png','petal_6.png','petal_blur_1.png','petal_blur_2.png',
  'bg_night_sakura.jpg','flower_1.png','flower_2.png','flower_3.png','flower_4.png','flower_blur_1.png','flower_blur_2.png','bud_1.png','bud_2.png',
  'branch_tl.png','branch_tr.png','branch_bl.png','branch_br.png','ribbon_1.png','ribbon_2.png','ribbon_3.png',
  'petal_stream_1.png','petal_stream_2.png','petal_stream_3.png','corner_gold_tl.png','corner_gold_tr.png','edge_gold_h.png',
  'crest_sakura.png','crest_glow.png','petal_mini_1.png','petal_mini_2.png','petal_mini_3.png','petal_mini_4.png','sparkle_sakura.png',
  'plate_A.png','plate_S.png','plate_B5.png','plate_B6.png'];
for(let n=1;n<=6;n++)for(const k of ['digit','unit','glow','sil'])IMG.push(`logo_N${n}_${k}.png`);
IMG.push('petal_mini_1.png');
const A={},LAYOUT={};
const RLIMG_EXTRA=[];
const has=n=>!!A[n];

// ---- 階層ごとの設計 ----
// A: 1〜3灯(夜・紺+金・同格) S: 4灯(断絶・桜) B5: 5灯(桜+金縁) B6: 6灯(金の豪華版)
const TIER={
  A:{key:'A',dur:2.4,bgT:0xffffff,bg:'bg_night',plate:'plate_A',ls:0.88,shake:7,punch:0.025,hit:0,flash:0.25,bloom:0.75,
     rays:{tint:0xa8c8ff,a:0.42,spin:0.04},mist:[{tint:0x2c58d8,a:0.60,sc:2.2,v:[30,6]},{tint:0x6f8fff,a:0.32,sc:1.3,v:[-55,10]}],
     lanterns:0,bokeh:{rate:16,tints:[0xffd890,0xaac4ff]},glints:{rate:12,tint:0xcfe2ff},fw:{n:3,tints:[0x9bbcff,0xffe0a0]},ptint:0xd6dcff,stream:0.25,sk:0,dec:{bs:0.8,ba:0.75,btint:0x9aa6d8,gold:false,crest:true,crestSc:2.2,ca:0.4},
     edge:0,orbit:0,petals:16,embers:0,sparks:0,vig:0.55,ring:0xffeab0,caption:''},
  S:{key:'S',dur:3.8,bgT:0x8e8690,bg:'bg_sakura',plate:'plate_S',ls:1.04,shake:30,punch:0.075,hit:0.09,flash:0.7,bloom:0.7,
     rays:{tint:0xffd6ea,a:0.55,spin:0.08},mist:[{tint:0xff4f98,a:0.22,sc:2.0,v:[40,-8]},{tint:0xffa0c8,a:0.10,sc:1.2,v:[-70,12]}],
     lanterns:0,bokeh:{rate:22,tints:[0xffb8d4,0xffffff]},glints:{rate:26,tint:0xffffff},fw:{n:0,tints:[]},sk:1,stream:0.7,dec:{bs:1.0,ba:1,btint:0xffffff,gold:true,crest:true,crestSc:2.8,ca:0.6},
     edge:12,orbit:0,petals:110,embers:0,sparks:0,vig:0.38,ring:0xffd0e6,caption:'満開！'},
  B5:{key:'B5',dur:3.1,bgT:0x8e8690,bg:'bg_sakura',plate:'plate_B5',ls:0.98,shake:16,punch:0.045,hit:0.06,flash:0.55,bloom:0.55,
     rays:{tint:0xffcfe4,a:0.48,spin:0.07},mist:[{tint:0xff3f8c,a:0.22,sc:2.0,v:[35,-8]},{tint:0xff98c0,a:0.10,sc:1.2,v:[-65,12]}],
     lanterns:0,bokeh:{rate:20,tints:[0xffb0d0,0xffffff]},glints:{rate:20,tint:0xffffff},fw:{n:0,tints:[]},sk:1,stream:0.55,dec:{bs:1.0,ba:1,btint:0xffffff,gold:true,crest:true,crestSc:2.6,ca:0.6},
     edge:60,orbit:0,petals:80,embers:0,sparks:0,vig:0.42,ring:0xffc8e0,caption:'桜吹雪！'},
  B6:{key:'B6',dur:3.4,bgT:0x908878,bg:'bg_gold',plate:'plate_B6',ls:1.0,shake:20,punch:0.055,hit:0.07,flash:0.6,bloom:0.7,
     rays:{tint:0xfff0b0,a:0.55,spin:0.09},mist:[{tint:0xff9810,a:0.22,sc:2.0,v:[40,-8]},{tint:0xffd070,a:0.10,sc:1.2,v:[-70,12]}],
     lanterns:0,bokeh:{rate:20,tints:[0xffe090,0xffffff]},glints:{rate:20,tint:0xfff4c0},fw:{n:0,tints:[]},sk:0,stream:0.35,dec:{bs:1.0,ba:1,btint:0xffe8b8,gold:true,crest:true,crestSc:2.8,ca:0.6},
     edge:70,orbit:1,petals:10,embers:110,sparks:150,vig:0.45,ring:0xffe69a,caption:'次の一球で最終勝負！'},
};
const tierOf=N=>N<=3?TIER.A:N===4?TIER.S:N===5?TIER.B5:TIER.B6;
const FX={on:false,t:0,N:0,T:TIER.A,land:-1,flash:0,shake:0,punch:0,dur:2.4,fx:0,fy:0,edges:[]};
let HIT=0,dayV=0,dayT=0,clock=0,pulse=0,lit=1;

// ---- Pixi 本体 ----
// 小さい画面(スマホ)では内部解像度を半分にして軽くする。表示は同じ大きさ
const RESPARAM=Number(LCDPARAMS.get('res'));
const RES=[0.5,1].includes(RESPARAM)?RESPARAM:
  (((window.matchMedia&&matchMedia('(pointer:coarse)').matches)||Math.min(screen.width,screen.height)<700)?0.5:1);
function showError(msg){
  const st=document.getElementById('stage');
  st.innerHTML='<div style="padding:16px;color:#ffd0d0;font:14px/1.6 system-ui,sans-serif">表示できませんでした: '+String(msg).replace(/[<>&]/g,'')+'</div>';
}
let app;
try{
  app=new PIXI.Application({width:W,height:H,antialias:false,backgroundColor:0x050a1e,resolution:RES,autoDensity:false,
    powerPreference:'high-performance',preserveDrawingBuffer:true});
}catch(e){showError('WebGLを開始できません ('+(e&&e.message||e)+')');throw e}
document.getElementById('stage').appendChild(app.view);
app.ticker.stop();
const R=app.renderer;
const world=new PIXI.Container();
world.pivot.set(W/2,H/2);
const mk=(parent,o)=>{const c=new PIXI.Container();Object.assign(c,o||{});parent.addChild(c);return c};
const Lbase=mk(world),Lbg=mk(world),Lmist=mk(world),Lrays=mk(world),Lback=mk(world),Lcrest=mk(world),Lbr=mk(world),Lupa=mk(world),Lfront=mk(world),Lrib=mk(world),Lframe=mk(world),
  Lplate=mk(world),Llogo=mk(world),Lflare=mk(world),Lflash=mk(world),Lvig=mk(world),Lhud=mk(world);
function S(name,o){
  o=o||{};const s=new PIXI.Sprite(A[name]||PIXI.Texture.EMPTY);s.anchor.set(o.ax??0.5,o.ay??0.5);
  if(o.add)s.blendMode=BM.ADD;if(o.tint!=null)s.tint=o.tint;s.alpha=o.alpha??1;s.position.set(o.x||0,o.y||0);
  if(o.sc!=null)s.scale.set(o.sc);if(o.parent)o.parent.addChild(s);return s;
}
// 水(通常時の背景): 縦のグラデーション+ゆるい光
function waterTex(){
  const c=document.createElement('canvas');c.width=16;c.height=256;const g=c.getContext('2d');
  const gr=g.createLinearGradient(0,0,0,256);gr.addColorStop(0,'#59b0f0');gr.addColorStop(0.45,'#2f7fd0');gr.addColorStop(1,'#1b4f98');
  g.fillStyle=gr;g.fillRect(0,0,16,256);return PIXI.Texture.from(c);
}
// ビネット(周辺の減光): 滑らかな放射グラデーション
function vigTex(){
  const c=document.createElement('canvas');c.width=512;c.height=288;const g=c.getContext('2d');
  const gr=g.createRadialGradient(256,144,60,256,144,330);gr.addColorStop(0,'rgba(0,0,0,0)');gr.addColorStop(0.55,'rgba(0,0,0,0.18)');gr.addColorStop(1,'rgba(0,0,0,0.95)');
  g.fillStyle=gr;g.fillRect(0,0,512,288);return PIXI.Texture.from(c);
}
// ---- 通常画面の背景: work/lcd_normal の NormalScreen(three.js)をそのまま動かし、その画を背景に貼る ----
let NSC=null,nsCanvas=null,nsSpr=null,nsOK=false,nsReady=Promise.resolve();
function nsStart(){
  try{
    if(!window.NSLIB)return;
    nsCanvas=document.createElement('canvas');
    NSC=new NSLIB.NormalScreen({canvas:nsCanvas,manifestUrl:'https://ns.local/m/manifest.json',upaEnabled:false});
    nsReady=NSC.init().then(()=>{
      const tex=PIXI.Texture.from(nsCanvas);
      nsSpr=new PIXI.Sprite(tex);nsSpr.anchor.set(0.5);
      const s=Math.max((W+2*PAD)/nsCanvas.width,(H+2*PAD)/nsCanvas.height);
      nsSpr.scale.set(s);nsSpr.position.set(W/2,H/2);
      Lbase.addChildAt(nsSpr,1);nsOK=true;
    }).catch(e=>{console.warn('normal screen failed',e);NSC=null});
  }catch(e){console.warn('normal screen failed',e);NSC=null}
}
function nsTick(dt){
  if(!nsOK||!NSC)return;
  NSC.update(dt);NSC.render();nsSpr.texture.baseTexture.update();
}
let baseW,baseDay,bgs={},mists=[],rays1,rays2,rays3,vig,dimS,flashS,upaSpr,upaTex;
const PAD=100;
function buildScene(){
  baseW=new PIXI.Sprite(waterTex());baseW.position.set(-PAD,-PAD);baseW.width=W+2*PAD;baseW.height=H+2*PAD;Lbase.addChild(baseW);
  nsStart();
  baseDay=S('bg_sakura',{ax:0,ay:0,x:-PAD,y:-PAD,alpha:0});baseDay.width=W+2*PAD;baseDay.height=H+2*PAD;Lbase.addChild(baseDay);
  for(const k of ['bg_night','bg_night_sakura','bg_sakura','bg_gold']){
    const s=S(k,{ax:0,ay:0,x:-PAD,y:-PAD,alpha:0});s.width=W+2*PAD;s.height=H+2*PAD;Lbg.addChild(s);bgs[k]=s;
  }
  for(let i=0;i<2;i++){
    const m=new PIXI.TilingSprite(A['mist_tile.png']||PIXI.Texture.WHITE,W+2*PAD,H+2*PAD);m.position.set(-PAD,-PAD);
    m.blendMode=BM.ADD;m.alpha=0;Lmist.addChild(m);mists.push(m);
  }
  rays1=S('rays_soft',{add:true,alpha:0});rays2=S('rays_soft',{add:true,alpha:0});rays3=S('rays_soft',{add:true,alpha:0});Lrays.addChild(rays1,rays2,rays3);
  const ut=PIXI.BaseTexture.from(buf,{scaleMode:PIXI.SCALE_MODES.NEAREST});upaTex=new PIXI.Texture(ut);
  upaSpr=new PIXI.Sprite(upaTex);Lupa.addChild(upaSpr);
  vig=new PIXI.Sprite(vigTex());vig.position.set(-PAD,-PAD);vig.width=W+2*PAD;vig.height=H+2*PAD;vig.alpha=0;Lvig.addChild(vig);
  dimS=new PIXI.Sprite(PIXI.Texture.WHITE);dimS.tint=0x000010;dimS.position.set(-PAD,-PAD);dimS.width=W+2*PAD;dimS.height=H+2*PAD;dimS.alpha=0;Lvig.addChild(dimS);
  flashS=new PIXI.Sprite(PIXI.Texture.WHITE);flashS.position.set(-PAD,-PAD);flashS.width=W+2*PAD;flashS.height=H+2*PAD;flashS.blendMode=BM.ADD;flashS.alpha=0;Lflash.addChild(flashS);
}
window.onBufRemade=()=>{
  if(!upaSpr)return;
  const ut=PIXI.BaseTexture.from(buf,{scaleMode:PIXI.SCALE_MODES.NEAREST});
  upaSpr.texture=new PIXI.Texture(ut);
};
// ブルーム: 明るい所だけを縮小→ぼかして加算で戻す
const RTO=(w,h)=>PIXI.RenderTexture.create({width:w,height:h,resolution:RES});
const sceneRT=RTO(W,H);
const bl1=RTO(W/4,H/4),bl1b=RTO(W/4,H/4);
const bl2=RTO(W/10,H/10),bl2b=RTO(W/10,H/10);
for(const t of [sceneRT,bl1,bl1b,bl2,bl2b])t.baseTexture.scaleMode=PIXI.SCALE_MODES.LINEAR;
const thFilter=new PIXI.Filter(undefined,`
varying vec2 vTextureCoord;uniform sampler2D uSampler;uniform float th;
void main(){vec4 c=texture2D(uSampler,vTextureCoord);float l=max(c.r,max(c.g,c.b));float k=smoothstep(th,th+0.45,l);gl_FragColor=vec4(c.rgb*k,1.0);}`,{th:0.72});
const blurA=new PIXI.BlurFilter(5,4),blurB=new PIXI.BlurFilter(7,4);
const sceneSpr=new PIXI.Sprite(sceneRT);
const srcSpr=new PIXI.Sprite(sceneRT);srcSpr.scale.set(0.25);srcSpr.filters=[thFilter];
const b1src=new PIXI.Sprite(bl1);b1src.filters=[blurA];
const b2src=new PIXI.Sprite(bl1);b2src.scale.set(0.4);
const b2src2=new PIXI.Sprite(bl2);b2src2.filters=[blurB];
const bloomA=new PIXI.Sprite(bl1b);bloomA.scale.set(4);bloomA.blendMode=BM.ADD;
const bloomB=new PIXI.Sprite(bl2b);bloomB.scale.set(10);bloomB.blendMode=BM.ADD;
const rootC=new PIXI.Container();rootC.addChild(sceneSpr,bloomA,bloomB);
let bloomK=0.7;
const BLOOMOFF=[Lbase,Lbg,Lmist,Lrays,Lback,Lcrest,Lbr,Lupa];   // ウパより奥の層は光らせない(白い花・光がウパに被って霞むため)
function renderAll(){
  for(const l of BLOOMOFF)l.visible=false;   // 背景とウパは光らせない(白く飛ぶため)
  R.render(world,{renderTexture:sceneRT,clear:true});
  R.render(srcSpr,{renderTexture:bl1,clear:true});
  R.render(b1src,{renderTexture:bl1b,clear:true});
  R.render(b2src,{renderTexture:bl2,clear:true});
  R.render(b2src2,{renderTexture:bl2b,clear:true});
  bloomA.alpha=0.9*bloomK;bloomB.alpha=0.9*bloomK;
  for(const l of BLOOMOFF)l.visible=true;R.render(world,{renderTexture:sceneRT,clear:true});
  R.render(rootC);
}

// ---- 粒(スプライトのプール) ----
const PARTS=[];
function addP(layer,name,o){
  const s=new PIXI.Sprite(A[name]||PIXI.Texture.EMPTY);s.anchor.set(0.5);
  if(o.add)s.blendMode=BM.ADD;if(o.tint!=null)s.tint=o.tint;layer.addChild(s);
  const p=Object.assign({s,t:0,life:1,x:0,y:0,vx:0,vy:0,ax:0,ay:0,drag:0,rot:0,vr:0,sc0:1,sc1:1,a:1,fin:0.12,fout:0.4,fl:0,fv:0,sway:0,sf:2,ph:0,stretch:0,tw:0},o);
  s.position.set(p.x,p.y);s.alpha=0;PARTS.push(p);return p;
}
// ---- 連番(フリップブック)再生。シートはFB_MANIFESTに登録(寸法・コマ数・fps) ----
const FBM=(typeof FB_MANIFEST!=='undefined')?FB_MANIFEST:{},FBF={};
const fbHas=n=>!!(FBM[n]&&A[FBM[n].file]);
function fbFrames(n){
  if(FBF[n])return FBF[n];const m=FBM[n],base=A[m.file].baseTexture,out=[];
  for(let i=0;i<m.frames;i++)out.push(new PIXI.Texture(base,new PIXI.Rectangle((i%m.cols)*m.fw,Math.floor(i/m.cols)*m.fh,m.fw,m.fh)));
  return FBF[n]=out;
}
// size=画面上の幅(px)。delay秒後に再生。loop=trueなら life秒の間ループ
function addFB(layer,n,o){
  if(!fbHas(n))return null;
  const m=FBM[n],fr=fbFrames(n),sc=(o.size||m.fw)/m.fw,fps=o.fps||m.fps||24;
  const s=new PIXI.Sprite(fr[0]);s.anchor.set(0.5);if(o.add!==false)s.blendMode=BM.ADD;if(o.tint!=null)s.tint=o.tint;layer.addChild(s);
  const dur=o.life||m.frames/fps,p={s,t:0,life:dur+(o.delay||0),x:o.x||0,y:o.y||0,vx:0,vy:0,ax:0,ay:0,drag:0,rot:o.rot||0,vr:o.vr||0,sc0:sc,sc1:sc,a:o.a??1,fin:1e-6,fout:1e-6,fl:0,fv:0,sway:0,sf:0,ph:0,stretch:0,tw:0,
    fb:{fr,fps,delay:o.delay||0,loop:!!o.loop,n:m.frames,fx:o.fx||1,fy:o.fy||1,fade:o.fade||0}};
  s.position.set(p.x,p.y);s.alpha=0;PARTS.push(p);return p;
}
function updParts(dt){
  for(let i=PARTS.length-1;i>=0;i--){
    const p=PARTS[i];p.t+=dt;const u=p.t/p.life;
    if(u>=1||p.x<-500||p.x>W+500||p.y>H+500||p.y<-700){p.s.destroy();PARTS.splice(i,1);continue}
    if(p.fb){const f=p.fb,tt=p.t-f.delay,sp=p.s;
      if(tt<0){sp.alpha=0;continue}
      const k=Math.floor(tt*f.fps),i=f.loop?k%f.n:Math.min(f.n-1,k);sp.texture=f.fr[i];
      p.rot+=p.vr*dt;sp.rotation=p.rot;sp.position.set(p.x,p.y);sp.scale.set(p.sc0*f.fx,p.sc0*f.fy);
      sp.alpha=p.a*(f.fade?Math.min(1,tt/f.fade)*Math.min(1,(p.life-p.t)/f.fade):1);continue}
    p.vx+=p.ax*dt;p.vy+=p.ay*dt;
    if(p.drag){const k=Math.max(0,1-p.drag*dt);p.vx*=k;p.vy*=k}
    p.x+=(p.vx+(p.sway?Math.sin(p.t*p.sf+p.ph)*p.sway:0))*dt;p.y+=p.vy*dt;
    p.rot+=p.vr*dt;p.fl+=p.fv*dt;
    const sc=lerp(p.sc0,p.sc1,u),s=p.s;
    s.position.set(p.x,p.y);
    if(p.stretch){s.rotation=Math.atan2(p.vy,p.vx);s.scale.set(sc*(0.6+Math.min(2.5,Math.hypot(p.vx,p.vy)/p.stretch)),sc*0.7)}
    else{s.rotation=p.rot;s.scale.set(sc*(p.flipX?-1:1)*(p.fv?Math.cos(p.fl):1),sc*(p.fv?(0.75+0.25*Math.abs(Math.sin(p.fl*0.7+p.ph))):1))}
    let a=p.a*Math.min(1,u/p.fin)*Math.min(1,(1-u)/p.fout);
    if(p.tw)a*=0.65+0.35*Math.sin(p.t*p.tw+p.ph);
    s.alpha=a;
  }
}
// 粒の種類
const PET=['petal_1.png','petal_2.png','petal_3.png','petal_4.png','petal_5.png','petal_6.png'];
const pick=a=>a[(Math.random()*a.length)|0];
const FLO=['flower_1.png','flower_2.png','flower_3.png','flower_4.png'],MINI=['petal_mini_1.png','petal_mini_2.png','petal_mini_3.png','petal_mini_4.png'];
function petal(x,y,vx,vy,z,front){
  const r=Math.random(),tint=FX.T.ptint??0xffffff;
  if(r<0.16&&has('flower_1.png')){ // 花ごと舞う
    const sz=rnd(0.32,0.62)*z;
    addP(front?Lfront:Lback,pick(FLO),{x,y,vx,vy,tint,ay:140*z,drag:0.5,sway:50*z,sf:rnd(1.4,2.6),ph:rnd(0,6.3),rot:rnd(0,6.3),vr:rnd(-1.6,1.6),fv:rnd(1.2,3),fl:rnd(0,6.3),
      sc0:sz,sc1:sz*0.95,life:rnd(3.4,6),a:1,fin:0.05,fout:0.25});return;
  }
  const small=r>0.8&&has('petal_mini_1.png');
  const sz=(small?rnd(0.9,1.8):rnd(0.55,1.0))*z;
  addP(front?Lfront:Lback,small?pick(MINI):pick(PET),{x,y,vx,vy,tint,ay:150*z,drag:0.55,sway:60*z,sf:rnd(1.6,3),ph:rnd(0,6.3),rot:rnd(0,6.3),vr:rnd(-2.5,2.5),fv:rnd(2.5,6),fl:rnd(0,6.3),
    sc0:sz*1.0,sc1:sz*0.95,life:rnd(3,5.5),a:0.95,fin:0.05,fout:0.25});
}
function petalBlur(x,y){
  const sz=rnd(1.5,2.6),fl=has('flower_blur_1.png')&&Math.random()<0.4;
  addP(Lfront,fl?pick(['flower_blur_1.png','flower_blur_2.png']):pick(['petal_blur_1.png','petal_blur_2.png']),{x,y,tint:FX.T.ptint??0xffffff,vx:rnd(-90,90),vy:rnd(120,260),sway:90,sf:rnd(1,2),ph:rnd(0,6.3),rot:rnd(0,6.3),vr:rnd(-1,1),
    sc0:sz*(fl?1.2:1),sc1:sz*(fl?1.2:1),life:rnd(3,5),a:0.55,fin:0.15,fout:0.3});
}
function glint(x,y,r,tint,life){
  const tw=Math.random()<0.7?fbPick('twinkle',3):null;
  if(tw){addFB(Lfront,tw,{x,y,size:r*2.2,tint,rot:rnd(-0.2,0.2),fps:(life?12/life:rnd(14,24)),a:0.95});return}
  const sk=has('sparkle_sakura.png')&&FX.T.sk&&Math.random()<0.45;
  addP(Lfront,sk?'sparkle_sakura.png':pick(['glint_1.png','glint_2.png','glint_3.png']),{x,y,add:true,tint,rot:rnd(-0.3,0.3),vr:rnd(-0.5,0.5),sc0:r/128*0.4*(sk?1.3:1),sc1:r/128*(sk?1.3:1),life:life||rnd(0.5,1.0),a:1,fin:0.25,fout:0.6});
}
function bokeh(x,y,tint,z){
  const r=rnd(22,70)*z;
  addP(Lback,'bokeh_disc.png',{x,y,add:true,tint,vx:rnd(-20,20),vy:-rnd(20,90)*z,sc0:r/96,sc1:r/96*1.1,life:rnd(1.8,3.2),a:rnd(0.25,0.55),fin:0.3,fout:0.4});
}
function spark(x,y,v,tint,gy){
  const a=rnd(0,6.283),sp=v*rnd(0.3,1);
  addP(Lfront,'spark.png',{x,y,add:true,tint,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-200,ay:gy??900,drag:0.8,stretch:900,sc0:rnd(1.4,2.6),sc1:0.4,life:rnd(0.6,1.4),a:1,fin:0.02,fout:0.7});
}
function ember(){
  const z=rnd(0.5,1.5);
  addP(Lfront,'ember.png',{x:rnd(-0.02,1.02)*W,y:H+30,add:true,vx:rnd(-50,50),vy:-rnd(260,700)*z,sway:70,sf:rnd(2,4),ph:rnd(0,6.3),sc0:rnd(0.5,1.2)*z,sc1:0.15,life:rnd(1.6,3.2),a:1,fin:0.05,fout:0.5});
}
function burst(x,y,tint,n,v){ // 花火
  addP(Lback,'glow_soft.png',{x,y,add:true,tint,sc0:0.5,sc1:6,life:0.9,a:0.9,fin:0.05,fout:0.8});
  for(let i=0;i<n;i++){const a=i/n*6.283+rnd(-0.05,0.05),sp=v*rnd(0.7,1);
    addP(Lback,'spark.png',{x,y,add:true,tint,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,ay:260,drag:1.4,stretch:700,sc0:rnd(2.2,3.4),sc1:0.5,life:rnd(1.2,1.9),a:1,fin:0.02,fout:0.7});}
  for(let i=0;i<n/2;i++){const a=rnd(0,6.283),sp=v*rnd(0.1,0.6);
    addP(Lback,'glow_soft.png',{x,y,add:true,tint:0xffffff,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,ay:200,drag:1.2,sc0:0.3,sc1:0.08,life:rnd(0.8,1.5),a:0.9,fin:0.02,fout:0.8});}
}

const LANTERNS=[];
function updLanterns(){}
// ---- 文字ロゴ(段階的に出す) ----
const LG={on:false,t:0,N:0,plate:null,digit:null,unit:null,glow:null,sil:null,shine:null,shineMask:null,cont:null,mask:null,sc:1,cx:W/2,cy:H*0.3,cap:null};
function layoutOf(N){
  const L=LAYOUT[N];
  if(L)return L;
  return {cw:2000,ch:1100,digit:{cx:640,cy:560},unit:{cx:1280,cy:640}};
}
function logoBuild(N,T){
  logoClear();
  const L=layoutOf(N),sc=T.ls;LG.N=N;LG.sc=sc;LG.cx=W/2;LG.cy=H*0.40;LG.on=true;LG.t=0;
  const cont=new PIXI.Container();cont.position.set(LG.cx,LG.cy);Llogo.addChild(cont);LG.cont=cont;
  const plate=S(T.plate,{x:LG.cx,y:LG.cy+20*sc,sc});Lplate.addChild(plate);LG.plate=plate;
  const pm=new PIXI.Graphics();Lplate.addChild(pm);plate.mask=pm;LG.mask=pm;
  const glow=S(`logo_N${N}_glow.png`,{add:true,alpha:0,sc});cont.addChild(glow);LG.glow=glow;
  const dg=new PIXI.Container(),ug=new PIXI.Container();cont.addChild(dg,ug);
  // 数字と灯は、それぞれの中心を支点にして独立に動かす(座標は文字キャンバス中心基準)
  const dc=L.digit,uc=L.unit,ox=L.cw/2,oy=L.ch/2;
  const ds=S(`logo_N${N}_digit.png`,{x:0,y:0});ds.position.set(-(dc.cx-ox)*0,0);
  ds.anchor.set(dc.cx/L.cw,dc.cy/L.ch);dg.position.set((dc.cx-ox)*sc,(dc.cy-oy)*sc);dg.addChild(ds);ds.scale.set(sc);
  const us=S(`logo_N${N}_unit.png`,{x:0,y:0});us.anchor.set(uc.cx/L.cw,uc.cy/L.ch);ug.position.set((uc.cx-ox)*sc,(uc.cy-oy)*sc);ug.addChild(us);us.scale.set(sc);
  LG.digit=dg;LG.unit=ug;dg.alpha=0;ug.alpha=0;
  const sil=S(`logo_N${N}_sil.png`,{sc});cont.addChild(sil);LG.sil=sil;sil.alpha=0.001;
  const sh=new PIXI.Container();cont.addChild(sh);sh.mask=sil;LG.shine=sh;
  const band=S('flare_streak.png',{add:true,alpha:0});band.rotation=Math.PI/2+0.35;band.scale.set(sc*1.6,sc*1.0);sh.addChild(band);LG.band=band;
  LG.edges=logoEdges(N,L,sc);
}
function logoClear(){
  for(const k of ['plate','cont','mask']){if(LG[k]){LG[k].destroy({children:true});LG[k]=null}}
  LG.on=false;
}
// 文字の輪郭の点(縁のきらめきを出す位置)。シルエット画像から取る
const edgeCache={};
function logoEdges(N,L,sc){
  const im=A[`logo_N${N}_sil.png`];if(!im||!im.baseTexture||!im.baseTexture.resource||!im.baseTexture.resource.source)return[];
  if(edgeCache[N])return edgeCache[N].map(e=>[(e[0]-L.cw/2)*sc,(e[1]-L.ch/2)*sc]);
  const src=im.baseTexture.resource.source,st=8,w=Math.ceil(src.width/st),h=Math.ceil(src.height/st);
  const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.drawImage(src,0,0,w,h);
  const d=g.getImageData(0,0,w,h).data,out=[];
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    if(d[(y*w+x)*4+3]>150&&(d[(y*w+x-1)*4+3]<60||d[(y*w+x+1)*4+3]<60||d[((y-1)*w+x)*4+3]<60||d[((y+1)*w+x)*4+3]<60))out.push([x*st,y*st]);
  }
  edgeCache[N]=out;return out.map(e=>[(e[0]-L.cw/2)*sc,(e[1]-L.ch/2)*sc]);
}
// 戻ってくる灯数に合わせた演出時間の進行。tl=着地からの時間
function logoUpdate(dt,tl,T){
  if(!LG.on)return;
  const sc=LG.sc,exit=clamp((tl-(FX.dur-0.15))/0.4,0,1);
  const td=tl-0.10,tu=tl-0.34;                 // 数字が先、少し遅れて「灯」
  const ad=clamp(td/0.05,0,1),au=clamp(tu/0.05,0,1);
  const dsc=td<0?3.4:lerp(3.4,1,easeOutBack(td/0.30));
  const usc=tu<0?2.6:lerp(2.6,1,easeOutBack(tu/0.30));
  LG.digit.alpha=ad*(1-exit);LG.digit.scale.set(dsc*(1+exit*0.12));
  LG.unit.alpha=au*(1-exit);LG.unit.scale.set(usc*(1+exit*0.12));
  const wob=Math.sin(Math.max(0,tl-0.5)*1.4)*0.012;LG.cont.rotation=wob;LG.plate.rotation=wob*0.5;
  // 帯: 左右にひらく
  const pw=easeOut((tl-0.02)/0.28);
  const L=layoutOf(LG.N);
  const pbw=A[T.plate+'.png']?A[T.plate+'.png'].width*sc:2400*sc,pbh=A[T.plate+'.png']?A[T.plate+'.png'].height*sc:420*sc;
  LG.mask.clear().beginFill(0xffffff).drawRect(LG.cx-pbw/2*pw,LG.cy-pbh,pbw*pw,pbh*2).endFill();
  LG.plate.alpha=(1-exit)*clamp(tl/0.08,0,1);
  // 外光: 灯が出るところで強く光ってから落ち着く
  const gp=tl<0.3?0:(1.0+1.2*Math.exp(-(tl-0.3)*3.2))*(0.85+0.15*Math.sin(tl*7));
  LG.glow.alpha=clamp(gp,0,2)*(1-exit);LG.glow.scale.set(sc*(1+0.04*Math.sin(tl*5)));
  // 光の走査(文字の形の中だけを光の帯が横切る)
  const per=T.key==='A'?99:1.5,ts=((tl-0.75)%per+per)%per,run=tl>=0.75&&(per>10?tl<1.5:true);
  const sp=clamp(ts/0.7,0,1);
  LG.band.alpha=run&&ts<0.7?0.95*Math.sin(Math.PI*sp):0;
  LG.band.position.set(lerp(-1100,1100,sp)*sc,0);
  LG.cont.alpha=1;
  if(exit>=1){logoClear()}
}

// ---- 装飾(四隅の花枝・金の飾り・桜の紋) ----
const DEC={items:[],crest:null,crestGlow:null};
function decorClear(){for(const o of DEC.items)o.s.destroy();DEC.items.length=0;if(DEC.crest){DEC.crest.destroy();DEC.crest=null}if(DEC.crestGlow){DEC.crestGlow.destroy();DEC.crestGlow=null}}
function decorBuild(T){
  decorClear();
  const D=T.dec;if(!D)return;
  const corners=[['tl',0,0,1,1],['tr',W,0,-1,1],['bl',0,H,1,-1],['br',W,H,-1,-1]];
  for(const [id,x,y,fx,fy] of corners){
    const nm='branch_'+id;
    if(has(nm)){const s=S(nm,{ax:fx>0?0:1,ay:fy>0?0:1,x,y,alpha:0,tint:D.btint});s.scale.set(D.bs);Lbr.addChild(s);DEC.items.push({s,x,y,fx,fy,type:'branch',base:D.ba,ph:rnd(0,6.3),sc:D.bs})}
  }
  if(D.gold){
    for(const [x,y,fx,fy] of [[0,0,1,1],[W,0,-1,1],[0,H,1,-1],[W,H,-1,-1]]){
      const nm=fx>0?'corner_gold_tl.png':'corner_gold_tr.png';
      const key=nm.replace('.png','');
      if(!has(nm))continue;
      const s=S(key,{ax:fx>0?0:1,ay:fy>0?0:1,x,y,alpha:0});s.scale.set(1);if(fy<0)s.scale.y=-1;Lframe.addChild(s);DEC.items.push({s,x,y,fx,fy,type:'gold',base:1,ph:0,sc:1});
    }
    if(has('edge_gold_h.png'))for(const [y,fy] of [[0,1],[H,-1]])for(let k=0;k<2;k++){
      const s=S('edge_gold_h',{ax:0,ay:fy>0?0:1,x:k*1280,y,alpha:0});s.scale.set(1,fy<0?-1:1);Lframe.addChild(s);DEC.items.push({s,x:k*1280,y,fx:1,fy,type:'edge',base:1,ph:0,sc:1});
    }
  }
  if(D.crest&&has('crest_sakura.png')){
    const c=S('crest_sakura',{x:W/2,y:H*0.40,alpha:0});Lcrest.addChild(c);DEC.crest=c;
    if(has('crest_glow.png')){const g=S('crest_glow',{add:true,x:W/2,y:H*0.40,alpha:0});Lcrest.addChildAt(g,0);DEC.crestGlow=g}
  }
}
function decorUpdate(e,tl,rdt){
  const T=FX.T,t=clock;
  for(const o of DEC.items){
    const s=o.s;
    if(o.type==='branch'){
      const slide=(1-easeOut(FX.t/0.9));
      s.position.set(o.x-o.fx*160*slide,o.y-o.fy*100*slide);
      s.rotation=Math.sin(t*0.7+o.ph)*0.012*o.fx*o.fy;s.scale.set(o.sc*(1+0.012*Math.sin(t*0.9+o.ph)));
      s.alpha=o.base*e;
    }else s.alpha=Math.min(1,e*1.5)*easeOut(FX.t/0.5);
  }
  if(DEC.crest){
    const D=T.dec,a=clamp((tl-0.0)/0.35,0,1)*e;
    const sc=D.crestSc*(0.7+0.3*easeOutBack(tl/0.5));
    DEC.crest.position.set(W/2,LG.cy);DEC.crest.rotation=t*0.12;DEC.crest.scale.set(sc);DEC.crest.alpha=a*D.ca;
    if(DEC.crestGlow){DEC.crestGlow.position.set(W/2,LG.cy);DEC.crestGlow.rotation=-t*0.1;DEC.crestGlow.scale.set(sc*1.5);DEC.crestGlow.alpha=a*(0.7+0.3*Math.sin(t*3))}
  }
}
// ---- 流れ ----
function fxStart(N){
  const T=tierOf(N);
  Object.assign(FX,{on:true,t:0,N,T,land:-1,dur:T.dur,flash:0,shake:0,punch:0});
  if(N>=4)dayT=1;
  logoBuild(N,T);decorBuild(T);
  FX.liveAcc={};
  if(!T.lanterns)for(const o of LANTERNS)if(o.kill==null)o.kill=o.t;
  bloomK=T.bloom;
}
const fbPick=(base,max)=>{const a=[];for(let i=1;i<=max;i++)if(fbHas(base+'_'+i))a.push(base+'_'+i);return a.length?pick(a):null};
function ringFx(x,y,tint,big,flat){
  const sh=fbPick('shock',2);
  if(sh){addFB(Lflare,sh,{x,y,size:(big?3600:2200)*(flat?0.8:1),tint,rot:rnd(0,6.28),a:big?1:0.8,fx:flat?1:1,fy:flat?0.7:1});return}
  addP(Lflare,'flare_ring.png',{x,y,add:true,tint,sc0:flat?0.4:0.2,sc1:flat?(big?5.5:3.5):(big?7:4),life:flat?0.75:0.9,a:big?1:0.8,fin:0.02,fout:0.8});
}
function petalStream(i){
  if(!has('petal_stream_1.png'))return;
  const dir=Math.random()<0.5?1:-1,k=1+((Math.random()*3)|0),front=Math.random()<0.5;
  addP(front?Lfront:Lback,'petal_stream_'+k,{x:dir>0?-700:W+700,y:rnd(0.2,0.85)*H,vx:dir*rnd(1000,1500),vy:rnd(-120,60),rot:dir>0?rnd(-0.25,0.1):rnd(-0.1,0.25),tint:FX.T.ptint??0xffffff,
    sc0:rnd(1.5,2.3),sc1:rnd(1.6,2.4),life:rnd(2.2,3.2),a:0.95,fin:0.1,fout:0.3,flipX:dir<0});
}
function onImpact(u,imp,first){
  const T=FX.T,hh=SH*P.sz*u.zoom,k=Math.min(1,imp/3200),gx=u.x,gy=u.show.yf;
  ringFx(gx,gy-hh*0.05,T.ring,first,true);
  FX.shake=Math.max(FX.shake,first?1:0.35*k);FX.punch=Math.max(FX.punch,first?1:0.3*k);
  if(!first||FX.land>=0)return;
  FX.land=FX.t;FX.fx=gx;FX.fy=gy;HIT=T.hit;FX.flash=T.flash;
  ringFx(gx,gy-hh*0.4,T.ring,true,false);
  const wx=gx,wy=gy-hh*0.4,bt=T.key==='A'?0xbcd2ff:T.key==='B6'?0xfff0b8:0xffd6ea;
  const ib=fbPick('impact',3);
  // 着地の光は足し算で重なるので、白く飛ばない強さに抑える(監督 10/17: 4灯・大成功・JPの瞬間に囲いの内側が白く飛ぶ)
  if(ib){addFB(Lflare,ib,{x:wx,y:wy,size:1900,tint:bt,rot:rnd(0,6.28),a:0.3});addFB(Lflare,fbPick('impact',3),{x:wx,y:wy,size:3000,tint:bt,rot:rnd(0,6.28),delay:0.04,a:0.14})}
  const pl=fbPick('pillar',2);if(pl)addFB(Lflare,pl,{x:wx,y:wy,size:3000,tint:bt,a:0.5});
  const pu=null;if(pu)addFB(Lfront,pu,{x:wx,y:wy-200,size:2600,tint:T.ptint??0xffffff,rot:0});
  const db=fbPick('digitburst',3);
  if(db){addFB(Lflare,db,{x:W/2,y:LG.cy,size:2700,tint:bt,delay:0.10,a:0.2});addFB(Lflare,fbPick('digitburst',3),{x:W/2+LG.sc*560,y:LG.cy,size:2000,tint:bt,delay:0.34,a:0.22})}
  const sp=fbPick('speed',2);if(sp)addFB(Lrays,sp,{x:W/2,y:H/2,size:W*1.15,loop:true,life:T.dur+0.6,tint:bt,a:0.55,fade:0.3,delay:0.05,fps:30});
  // レンズフレア: 着地点から画面中央を通る線上に、光のゴーストを並べる
  const cx=W/2,cy=H*0.4,tint=T.key==='A'?0xbcd2ff:T.key==='B6'?0xfff0b8:0xffd6ea;
  for(const [f,sc,a] of [[-0.35,0.9,0.5],[0.35,1.3,0.5],[0.75,0.7,0.6],[1.25,1.1,0.4],[1.7,0.6,0.5]]){
    addP(Lflare,'flare_hex.png',{x:lerp(gx,cx,f),y:lerp(gy-hh*0.4,cy,f),add:true,tint,rot:rnd(0,1),sc0:sc*1.3,sc1:sc,life:0.9,a,fin:0.05,fout:0.75});
  }
  addP(Lflare,'flare_streak.png',{x:gx,y:gy-hh*0.4,add:true,tint:bt,sc0:0.4,sc1:3.2,life:0.7,a:0.3,fin:0.03,fout:0.8});
  addP(Lflare,'glow_soft.png',{x:gx,y:gy-hh*0.4,add:true,tint,sc0:1.0,sc1:6,life:0.6,a:0.2,fin:0.03,fout:0.85});
  for(let i=0;i<T.glints.rate+10;i++)glint(rnd(0.05,0.95)*W,rnd(0.05,0.95)*H,rnd(60,150),T.glints.tint);
  if(T.petals)for(let i=0;i<T.petals*1.2;i++){const a=rnd(0,6.283),v=rnd(600,2400);petal(gx,gy-hh*0.4,Math.cos(a)*v,Math.sin(a)*v*0.7-500,rnd(0.8,1.7),Math.random()<0.5)}
  if(T.sparks)for(let i=0;i<T.sparks;i++)spark(gx,gy-hh*0.3,2600,Math.random()<0.5?0xffd878:0xfff6dc);
  FX.rayPulse=1;
  if(has('ribbon_1.png'))for(let i=0;i<3;i++)addP(Lrib,'ribbon_'+(1+i),{x:W/2+rnd(-200,200),y:LG.cy+rnd(-120,120),add:true,tint:i%2?T.ring:0xffffff,rot:rnd(0,6.28),vr:rnd(0.5,1.2)*(i%2?1:-1),sc0:0.8,sc1:2.4,life:1.8,a:0.85,fin:0.08,fout:0.6});
  for(let i=0;i<3;i++)petalStream(i);
  const sx=W/2,sy=LG.cy;
  for(let i=0;i<(T.key==='A'?34:70);i++){const a=rnd(0,6.283),v=rnd(2600,5600),r0=rnd(300,620);
    addP(Lflare,'flare_streak.png',{x:sx+Math.cos(a)*r0,y:sy+Math.sin(a)*r0*0.7,add:true,tint:i%3?T.ring:0xffffff,vx:Math.cos(a)*v,vy:Math.sin(a)*v*0.7,stretch:99999,sc0:rnd(0.25,0.55),sc1:0.1,life:rnd(0.35,0.65),a:0.9,fin:0.05,fout:0.7});}
}
const rate=(acc,key,r,dt)=>{acc[key]=(acc[key]||0)+r*dt;const n=Math.floor(acc[key]);acc[key]-=n;return n};
let envV=0,spinT=0;
function fxUpdate(dt,rdt){
  dayV+=(dayT-dayV)*Math.min(1,rdt*2.2);
  FX.flash=Math.max(0,FX.flash-rdt*3.0);FX.shake=Math.max(0,FX.shake-rdt*2.6);FX.punch=Math.max(0,FX.punch-rdt*3.4);
  if(FX.rayPulse)FX.rayPulse=Math.max(0,FX.rayPulse-rdt*1.6);
  const T=FX.T;let tl=-1;
  if(FX.on){
    FX.t+=dt;tl=FX.land<0?-1:FX.t-FX.land;
    const inn=easeOut(FX.t/0.5),out=tl>=0?1-smooth((tl-(FX.dur-0.2))/1.0):1;
    // 4灯は着地までをほぼ暗転で溜める。それ以外は最初から背景が入る
    const pre=T.key==='S'&&tl<0?0:1;
    envV+=((inn*out*pre)-envV)*Math.min(1,rdt*8);
    const live=(T.key==='S'?tl>=0:FX.t>0.2)&&(tl<0||tl<FX.dur-0.1);
    const acc=FX.liveAcc;
    if(live){
      const cx=W/2,cy=LG.cy;
      for(let n=rate(acc,'bk',T.bokeh.rate,dt);n>0;n--)bokeh(rnd(-0.02,1.02)*W,rnd(0.1,1.05)*H,pick(T.bokeh.tints),rnd(0.5,1.7));
      for(let n=rate(acc,'gl',T.glints.rate,dt);n>0;n--)glint(rnd(0.02,0.98)*W,rnd(0.03,0.97)*H,rnd(50,130),T.glints.tint);
      if(T.edge&&LG.edges&&LG.edges.length)for(let n=rate(acc,'ed',T.edge,dt);n>0;n--){const e=pick(LG.edges);glint(cx+e[0],cy+e[1],rnd(40,100),T.key==='B6'?0xfff4c0:0xffffff,rnd(0.4,0.8))}
      if(T.petals)for(let n=rate(acc,'pt',T.petals*0.8,dt);n>0;n--){
        if(Math.random()<0.18)petalBlur(rnd(-0.1,1.1)*W,-120);
        else petal(rnd(-0.1,1.1)*W,-80,rnd(-120,120),rnd(140,360),rnd(0.8,1.7),Math.random()<0.35);
      }
      for(let n=rate(acc,'ps',T.stream||0.3,dt);n>0;n--)petalStream(0);
      if(T.embers)for(let n=rate(acc,'em',T.embers,dt);n>0;n--)ember();
      if(T.fw.n&&tl>=0.15)for(let n=rate(acc,'fw',T.fw.n*0.8,dt);n>0;n--)burst(rnd(0.12,0.88)*W,rnd(0.12,0.62)*H,pick(T.fw.tints),44,rnd(520,820));
      if(T.orbit&&tl>0.4){
        const a=tl*3.4,rx=LG.sc*820,ry=LG.sc*230;
        glint(cx+Math.cos(a)*rx,cy+Math.sin(a)*ry,rnd(110,150),0xfff6d0,0.35);
        glint(cx+Math.cos(a+Math.PI)*rx,cy+Math.sin(a+Math.PI)*ry,rnd(110,150),0xfff6d0,0.35);
        addP(Lflare,'glow_soft.png',{x:cx+Math.cos(a)*rx,y:cy+Math.sin(a)*ry,add:true,tint:0xffe08c,sc0:0.7,sc1:0.2,life:0.5,a:0.8,fin:0.05,fout:0.9});
      }
    }
    if(LG.on&&tl>=0)logoUpdate(dt,tl,T);
    if(tl>FX.dur+0.9&&!PARTS.length)FX.on=false;
  }else envV+=(0-envV)*Math.min(1,rdt*6);
  updParts(dt);updLanterns(dt,Math.max(envV,0.0001)>0.01?Math.max(0.15,envV):0);
  pulse+=rdt;
  // ---- 背景層の合成 ----
  const e=envV,cur=FX.T;
  const bgk=(cur.bg==='bg_night'&&has('bg_night_sakura'))?'bg_night_sakura':cur.bg;
  for(const k in bgs){bgs[k].alpha=(FX.on||e>0.01)&&k===bgk?e:0;bgs[k].tint=cur.bgT}
  // 切り替え中に前のtierの背景が残らないよう、非表示のものは即0
  baseDay.alpha=0.5*dayV;baseDay.tint=0xb0a8b0;
  const cl=clock;
  mists.forEach((m,i)=>{const c=cur.mist[i];m.tint=c.tint;m.alpha=c.a*e;m.tileScale.set(c.sc);m.tilePosition.x+=c.v[0]*rdt;m.tilePosition.y+=c.v[1]*rdt;});
  spinT+=rdt;
  const rc=cur.rays,lx=W/2,ly=H*0.40,rp=FX.rayPulse||0;
  const rsc=2.1+0.5*rp;
  rays1.position.set(lx,ly);rays2.position.set(lx,ly);rays3.position.set(lx,ly);rays1.tint=rc.tint;rays2.tint=rc.tint;rays3.tint=0xffffff;
  rays1.rotation=spinT*rc.spin;rays2.rotation=-spinT*rc.spin*0.7+0.4;
  rays1.scale.set(rsc);rays2.scale.set(rsc*0.8);rays3.scale.set(rsc*1.35);rays3.rotation=spinT*rc.spin*1.7+1.1;rays3.alpha=Math.min(1,rc.a*0.35*e*(1+1.2*rp));
  rays1.alpha=Math.min(1,rc.a*e*(1+0.9*rp));rays2.alpha=Math.min(1,rc.a*0.55*e*(1+0.9*rp));
  vig.alpha=cur.vig*Math.max(e,0.0)*1.0+(FX.on?0:0);
  dimS.alpha=FX.on&&cur.key==='S'&&tl<0?0.72*Math.min(1,FX.t/0.5):0;
  flashS.tint=cur.key==='A'?0x9ec0ff:cur.key==='B6'?0xffe9a0:0xffd0e6;
  flashS.alpha=Math.min(0.4,FX.flash*(cur.key==='A'?0.5:0.9));
  decorUpdate(e,tl,rdt);
  // カメラ
  const sk=FX.shake*FX.shake*cur.shake+RL.shk,z=1+FX.punch*cur.punch+RL.pun+RL.zoomK;
  world.position.set(W/2+rnd(-sk,sk),H/2+rnd(-sk,sk));world.scale.set(z);
}

// ---- ランプ表示(デモ用) ----
const lampG=new PIXI.Graphics(),lampGlow=[];
function buildLamps(){
  Lhud.addChild(lampG);
  for(let i=0;i<7;i++){const g=S('glow_soft.png',{add:true,tint:0xffe27a,x:84+i*92,y:70,alpha:0});Lhud.addChild(g);lampGlow.push(g)}
}
function drawLamps(){
  lampG.clear();
  for(let i=0;i<7;i++){
    const x=84+i*92,y=70,on=i<lit,r=28,k=(i===lit-1)?1+0.35*Math.max(0,1-pulse/0.8):1;
    lampGlow[i].alpha=on?0.95:0;lampGlow[i].scale.set(r*3.4*k/128*2.0/2);
    lampG.lineStyle(5,on?0xffb020:0x0f2342,1).beginFill(on?0xfff3a0:0x1c3a63,1).drawCircle(x,y,r).endFill();
  }
}

// ---- 実行 ----
function start(){
  makeBuf();setCount(1);buildScene();buildLamps();rlBuild();
  let last=performance.now();
  function step(dt){
    const rdt=dt;clock+=rdt;
    if(HIT>0){HIT-=rdt;dt=0}                 // 着地の一瞬だけ止める(ヒットストップ)
    const scale=P.sz;
    bdata.data.fill(0);
    if(RL.on)rlUpas(dt,scale);else{for(const u of upas)u.update(dt,scale,Math.sqrt(scale/5));separate(dt,scale)}
    const order=upas.slice().sort((a,b)=>(a.y+(a.show?1e5:0))-(b.y+(b.show?1e5:0)));
    for(const u of order)if(!(RL.on&&u.asc&&RL.t>=u.asc.t0))u.draw(scale);
    bctx.putImageData(bdata,0,0);
    if(RL.on&&ascCtx){   // 昇天中の子だけ別のバッファに描く(暗転の色をかぶせない)
      const sv=bdata;bdata=ascData;bdata.data.fill(0);let any=false;
      for(const u of order)if(u.asc&&RL.t>=u.asc.t0&&u.alp>0.003){u.draw(scale);any=true}
      bdata=sv;ascCtx.putImageData(ascData,0,0);ascTex.baseTexture.update();
      ascSpr.visible=any;ascSpr.width=LW*scale;ascSpr.height=LH*scale;
    }
    upaSpr.texture.baseTexture.update();
    upaSpr.width=LW*scale;upaSpr.height=LH*scale;
    rlUpdate(dt,rdt);
    nsTick(rdt*RL.nsScale);
    fxUpdate(dt,rdt);
    lcdTick();
    updateButtons();drawLamps();
    renderAll();
  }
  function frame(now){
    const dt=Math.min(0.05,(now-last)/1000);last=now;
    if(!window.__upa||!window.__upa.manual){
      try{step(dt)}catch(e){showError('描画中にエラー: '+(e&&e.message||e));return}
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__upa={world,P,upas:()=>upas,step,manual:EMBED,FX,PARTS,LG,app,DEC,A,
    shot:()=>app.view.toDataURL('image/jpeg',0.92)};
  lcdStarted();
}
function loadAll(){
  const jobs=IMG.concat(typeof RLIMG!=='undefined'?RLIMG:[]).map(f=>new Promise((res,reject)=>{
    const src=ASSETS[f];if(!src){res();return}
    const im=new Image();im.onload=()=>{const t=PIXI.Texture.from(im);A[f]=t;A[f.replace(/\.(png|jpg)$/,'')]=t;res()};im.onerror=()=>EMBED?reject(new Error('素材を読み込めません: '+f)):res();im.src=src;
  }));
  const fbj=[...new Set(Object.entries(FBM).filter(([k])=>RES>=1||/_1$/.test(k)).map(([,m])=>m.file))]   // スマホは各種類の1番だけ読む(テクスチャのメモリ節約)
   .map(f=>new Promise((res,reject)=>{
    const src=ASSETS[f];if(!src){res();return}
    const im=new Image();im.onload=()=>{A[f]=PIXI.Texture.from(im);res()};im.onerror=()=>EMBED?reject(new Error('素材を読み込めません: '+f)):res();im.src=src;
  }));
  for(let n=1;n<=6;n++)LAYOUT[n]=ASSET_LAYOUT[n];
  return Promise.all(jobs.concat(fbj));
}
