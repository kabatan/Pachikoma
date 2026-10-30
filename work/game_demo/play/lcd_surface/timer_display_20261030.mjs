// 10/30 Blender-glyph HUD (replaces timer_display_20261029). Shared production HUD. Values are read directly from the rule state, never counted here.
import * as THREE from '../../web/vendor/three/three.module.js';
import { layerTexture } from './lcd_split_1030.mjs';
const PX=34,PY=28,SPRITE_LIMIT=104;
// 10/30 pair style: the seconds HUD mirrors the lit-count badge (top-left "N灯") — same baked glyph family, same scale (0.38 px per glyph unit), same height, mirrored margins. ?timerhud=0 restores the previous HUD.
const TIMEUP_SKIP=!(typeof location!=='undefined'&&(new URLSearchParams(location.search).get('timeupskip')==='0'||new URLSearchParams(location.search).get('hudhandoff')==='0'));
const TIMER_SPLIT=!(typeof location!=='undefined'&&new URLSearchParams(location.search).get('timersplit')==='0');   // 時計を液晶 canvas に描かず小さい層で重ねる(保存・復元の drawImage 読み戻しを無くす)。?timersplit=0 で従来
const SPLIT_PHASES=new Set(['Ready','Flight','Effect','Fault','Meter','Roulette']);   // 時計の上に重ね描きする外側の層(選択・時間切れ・スタッフ)が出ない局面だけ
const PAIR=!(typeof location!=='undefined'&&new URLSearchParams(location.search).get('timerhud')==='0');
// HUD region in panel-canvas px (1240x1510). The GPU compositors hard-code the same rectangle (vec2(690.,130.)/vec2(496.,410.)); change both together.
const HUD={x:690,y:130,w:496,h:410};
const PAIR_ROW={cy:140,offerCy:322,offerScale:.62};   // main row centre y / offer row centre y (region px)
const VISIBLE=new Set(['Ready','Flight','Effect','ChainChoice','Continue','StaffWait','Fault','Meter','Roulette']);   // Meter/Roulette: H の局面(時計は止めない)。G では現れない
export function timerValues(s){
  if(!VISIBLE.has(s.phase)||s.howto||!Number.isFinite(s.secondsLeft))return null;
  const seconds=Math.max(0,s.secondsLeft),offer=s.phase==='Continue'&&Number.isFinite(s.offerLeft)?Math.max(0,s.offerLeft):null;
  return {seconds:Math.max(0,Math.ceil(seconds-1e-9)),offer:offer===null?null:Math.max(0,Math.ceil(offer-1e-9)),warning:seconds<=10,
    // Fractional rule time drives only the warning's brightness; a stopped clock stays still.
    pulse:.5+.5*Math.cos(2*Math.PI*seconds),offerPulse:offer===null?0:.5+.5*Math.cos(2*Math.PI*offer)};
}

export function attachTimerDisplay(lcd,{getState,hudCache=new URLSearchParams(globalThis.location?.search??'').get('hudcache')!=='0'}){
  if(!lcd?.production||lcd.timerDisplay)return lcd;
  const ctx=lcd.canvas.getContext('2d'),sprites=new Map();
  const rects=PAIR?[{x:HUD.x-PX,y:HUD.y-PY,w:HUD.w,h:HUD.h}]:[{x:832,y:128,w:304,h:150},{x:832,y:286,w:304,h:150}];
  const saved=rects.map(r=>{const c=document.createElement('canvas');c.width=r.w;c.height=r.h;return {canvas:c,ctx:c.getContext('2d',{alpha:false}),dirty:false};});
  const gpuHud=document.createElement('canvas');gpuHud.width=HUD.w;gpuHud.height=HUD.h;const gpuHudCtx=gpuHud.getContext('2d');
  let shown=null,uploadKey=null,revision=0,frameRevision,hudKey=null,hudRevision=0;
  const hudStats={paints:0,reuses:0};
  const sourceRevision=Object.getOwnPropertyDescriptor(lcd,'uploadRevision')?.get;
  const updateRevision=()=>{
    const base=sourceRevision?.call(lcd);
    if(!Number.isSafeInteger(base)||base<0){frameRevision=undefined;uploadKey=null;return;}
    const key=sp.on?JSON.stringify([base,'split']):JSON.stringify([base,shown?.seconds,shown?.offer,shown?.warning,shown?.warning?Math.round(shown.pulse*40):null,shown?.offer<=10?Math.round(shown?.offerPulse*40):null,ready]);
    if(key!==uploadKey){uploadKey=key;revision++;}frameRevision=revision;
  };
  // 10/30 version: glyphs are Blender-baked 3D parts (timer_assets_20261030/glyphs), composed per second.
  const A=new URL('./timer_assets_20261030/glyphs/',import.meta.url).href;
  const names=[...'0123456789'].map(d=>'d'+d).concat(['zan','add','byo']),imgs={};
  // Pair style: one baked "N秒" image per value (n0..n99 normal, w0..w10 warning) + the small 追加 label, decoded at startup.
  const P=new URL('./timer_assets_20261030pair/',import.meta.url).href,pairNames=[...Array(100).keys()].map(i=>'n'+i).concat([...Array(11).keys()].map(i=>'w'+i),['tsuika_n','tsuika_w']);
  const load=(dir,key,file)=>new Promise(res=>{const im=new Image();im.onload=()=>{imgs[key]=im;im.decode?.().then(res,res)??res();};im.onerror=()=>res();im.src=dir+file;});
  const loaded=(PAIR?Promise.all(pairNames.map(n=>load(P,n,n+'.png')))
    :Promise.all(names.flatMap(n=>['n','w'].map(v=>load(A,n+'_'+v,`${n}_${v}.png`))))).then(()=>{ready=PAIR?pairNames.every(n=>imgs[n]):names.every(n=>imgs[n+'_n']&&imgs[n+'_w']);});
  let ready=false;
  const sprite=(label,n,warning)=>{
    if(!ready)return null;
    if(PAIR){const w=warning?'w':'n',k=Math.max(0,Math.min(99,n));return {img:imgs[(warning&&k<=10?'w':'n')+k],lab:label==='追加受付'?imgs['tsuika_'+w]:null,offer:label==='追加受付'};}
    const key=`${label}:${n}:${warning}`;if(sprites.has(key))return sprites.get(key);
    const v=warning?'w':'n',c=document.createElement('canvas');c.width=304;c.height=150;const x=c.getContext('2d');
    // soft dark halo behind the glyphs (no hard shape)
    x.save();x.translate(150,88);x.scale(1,.5);
    const g=x.createRadialGradient(0,0,0,0,0,128);for(const [t,al] of [[0,.55],[.3,.46],[.55,.3],[.78,.12],[1,0]])g.addColorStop(t,`rgba(8,4,24,${al})`);
    x.fillStyle=g;x.fillRect(-128,-128,256,256);x.restore();
    const L=imgs[(label==='追加受付'?'add':'zan')+'_'+v];x.drawImage(L,6-154*.58,3-75*.58,L.width*.58,L.height*.58);
    const s=String(Math.max(0,Math.min(99,n))).padStart(2,'0'),H=114,W=202*H/269;
    for(let i=0;i<2;i++){const im=imgs['d'+s[i]+'_'+v];x.drawImage(im,54+i*(W-6),34,W,H);}
    const B=imgs['byo_'+v];x.drawImage(B,54+2*(W-6)+8-77*.38,70-83*.38,B.width*.38,B.height*.38);
    sprites.set(key,c);if(sprites.size>SPRITE_LIMIT)sprites.delete(sprites.keys().next().value);return c;
  };
  // Draw with live pulse: warning sprites throb in scale, shake and a soft red bloom behind them.
  // Pair style: right-aligned like the badge is left-aligned (the glyph's right edge sits where the badge's left edge sits, mirrored); the 追加 row is the same glyphs scaled down.
  const putPair=(t,spr,x,y,warning,pulse)=>{
    const S=spr.offer?PAIR_ROW.offerScale:1,w=spr.img.width*S,h=spr.img.height*S,cx=x+HUD.w-w/2,cy=y+(spr.offer?PAIR_ROW.offerCy:PAIR_ROW.cy);
    t.save();
    if(warning){
      t.save();t.translate(cx,cy);t.scale(1,.5);
      const bl=t.createRadialGradient(0,0,0,0,0,w*.5);bl.addColorStop(0,`rgba(255,60,30,${.12+.5*pulse})`);bl.addColorStop(.5,`rgba(255,50,25,${.06+.25*pulse})`);bl.addColorStop(1,'rgba(255,40,20,0)');
      t.fillStyle=bl;t.fillRect(-w*.5,-w*.5,w,w);t.restore();
      const sc=1+.045*pulse;t.translate(cx+Math.round(Math.sin(pulse*37)*2.5),cy+Math.round(Math.cos(pulse*29)*1.5));t.scale(sc,sc);t.translate(-cx,-cy);
    }
    t.drawImage(spr.img,cx-w/2,cy-h/2,w,h);
    if(spr.lab){const lw=spr.lab.width*S*.8,lh=spr.lab.height*S*.8;t.drawImage(spr.lab,cx-w/2-lw*.5,cy-h/2-lh*.12,lw,lh);}
    t.restore();
  };
  const put=(t,spr,x,y,warning,pulse)=>{
    if(!spr)return;
    if(PAIR)return putPair(t,spr,x,y,warning,pulse);
    if(!warning){t.drawImage(spr,x,y);return;}
    t.save();
    t.save();t.translate(x+150,y+86);t.scale(1,.5);
    const bl=t.createRadialGradient(0,0,0,0,0,138);bl.addColorStop(0,`rgba(255,60,30,${.12+.5*pulse})`);bl.addColorStop(.5,`rgba(255,50,25,${.06+.25*pulse})`);bl.addColorStop(1,'rgba(255,40,20,0)');
    t.fillStyle=bl;t.fillRect(-138,-138,276,276);t.restore();
    const sc=1+.045*pulse,sx=Math.round(Math.sin(pulse*37)*2.5),sy=Math.round(Math.cos(pulse*29)*1.5);
    t.translate(x+150+sx,y+84+sy);t.scale(sc,sc);t.drawImage(spr,-150,-84);
    t.restore();
  };
  // Startup only: retain all default 72..0 + 30..0 variants within a small fixed budget.
  const prewarm=async({secondsMax,offerMax}={})=>{
    await loaded;
    if(!Number.isSafeInteger(secondsMax)||secondsMax<0||!Number.isSafeInteger(offerMax)||offerMax<0||secondsMax+offerMax+2>SPRITE_LIMIT)return {warmed:0,skipped:'outside-budget'};
    if(sprites.size)return {warmed:0,skipped:'cache-in-use'};
    if(PAIR)return {warmed:Object.keys(imgs).length,rgbaBytes:Object.values(imgs).reduce((a,im)=>a+im.width*im.height*4,0)};   // images are decoded in `loaded`; nothing is composed per second
    for(let n=secondsMax;n>=0;n--)sprite('残り時間',n,n<=10);
    for(let n=offerMax;n>=0;n--)sprite('追加受付',n,n<=10);
    return {warmed:sprites.size,rgbaBytes:sprites.size*304*150*4};
  };
  const clear=()=>{
    lcd.gpuPanelSource?.backend.setHudCanvas(null);
    for(let i=0;i<rects.length;i++){const r=rects[i],s=saved[i];if(s.dirty){ctx.drawImage(s.canvas,PX+r.x,PY+r.y);s.dirty=false;}}
  };
  const paint=(i,label,n,warning,pulse)=>{
    const r=rects[PAIR?0:i],s=saved[PAIR?0:i];   // pair style keeps one saved region for both rows
    if(!PAIR||!s.dirty){s.ctx.drawImage(lcd.canvas,PX+r.x,PY+r.y,r.w,r.h,0,0,r.w,r.h);s.dirty=true;}
    put(ctx,sprite(label,n,warning),PX+r.x,PY+r.y,warning,pulse);
  };
  const paintGpu=(i,label,n,warning,pulse)=>put(gpuHudCtx,sprite(label,n,warning),PAIR?0:866-HUD.x,PAIR?0:156-HUD.y+i*158,warning,pulse);
  const sp={on:false,tex:null,hudRev:-1};
  const splitLayer=()=>{
    if(!sp.on||!shown)return null;
    sp.tex??=layerTexture(THREE,gpuHud);
    if(sp.hudRev!==hudRevision||!hudCache){sp.tex.needsUpdate=true;sp.hudRev=hudRevision;}
    return {tex:sp.tex,w:HUD.w,h:HUD.h,ax:0,ay:0,x:HUD.x,y:HUD.y,rot:0,sc:1,alpha:1,add:false};
  };
  lcd.timerSplit={layer:splitLayer};
  const base={frame:lcd.frame.bind(lcd),onEvent:lcd.onEvent.bind(lcd),dispose:lcd.dispose.bind(lcd)};
  lcd.frame=(dt,F)=>{
    clear();sp.on=false;base.frame(dt,F);shown=timerValues(getState());
    if(lcd.gpuPanelSource){
      // Warning motion uses the exact pulse, without rounding. Ordinary timer
      // pixels depend only on the displayed integer and the loaded glyph set.
      const nextKey=JSON.stringify([ready,shown?.seconds,shown?.offer,shown?.warning,shown?.warning?shown.pulse:null,shown?.offer!==null&&shown?.offer<=10?shown.offerPulse:null]);
      if(!hudCache||nextKey!==hudKey){
        gpuHudCtx.clearRect(0,0,HUD.w,HUD.h);
        if(shown){paintGpu(0,'残り時間',shown.seconds,shown.warning,shown.pulse);if(shown.offer!==null)paintGpu(1,'追加受付',shown.offer,shown.offer<=10,shown.offerPulse);}
        hudKey=nextKey;hudRevision++;hudStats.paints++;
      }else hudStats.reuses++;
      lcd.gpuPanelSource.backend.setHudCanvas(shown?gpuHud:null,hudCache?hudRevision:undefined);
    }else if(TIMER_SPLIT&&shown&&ready&&PAIR&&!lcd.splitBroken&&SPLIT_PHASES.has(getState().phase)&&!lcd.timeupSurface?.active&&!lcd.choiceV20?.active&&!lcd.choiceV20?.holding&&!lcd.displayRecoveryActive&&!globalThis.__timerSplitOff){
      sp.on=true;   // 時計は小さい canvas(gpuHud)へ。液晶 canvas には描かない→保存・復元の読み戻しなし。play_fx が層として重ねる
      const nextKey=JSON.stringify([ready,shown.seconds,shown.offer,shown.warning,shown.warning?shown.pulse:null,shown.offer!==null&&shown.offer<=10?shown.offerPulse:null]);
      if(!hudCache||nextKey!==hudKey){
        gpuHudCtx.clearRect(0,0,HUD.w,HUD.h);
        paintGpu(0,'残り時間',shown.seconds,shown.warning,shown.pulse);if(shown.offer!==null)paintGpu(1,'追加受付',shown.offer,shown.offer<=10,shown.offerPulse);
        hudKey=nextKey;hudRevision++;hudStats.paints++;
      }else hudStats.reuses++;
    }else if(shown&&!(TIMEUP_SKIP&&lcd.timeupSurface?.active)){   // 時間切れ画面は全面を上書きするので、その下に時計を描いて保存・復元するのは無駄(?timeupskip=0 で従来)
      paint(0,'残り時間',shown.seconds,shown.warning,shown.pulse);
      if(shown.offer!==null)paint(1,'追加受付',shown.offer,shown.offer<=10,shown.offerPulse);
    }
    updateRevision();
  };
  // Scene bridges and the choice's interrupted blends must capture a clean image.
  lcd.onEvent=(...args)=>{clear();frameRevision=undefined;return base.onEvent(...args);};
  if(sourceRevision)Object.defineProperty(lcd,'uploadRevision',{configurable:true,enumerable:true,get:()=>frameRevision});
  lcd.timerDisplay={clear,prewarm,hudDiagnostics:()=>({...hudStats,enabled:!!hudCache,revision:hudRevision}),get shown(){return shown;},position:rects};
  lcd.dispose=()=>{clear();sprites.clear();base.dispose();};
  return lcd;
}
