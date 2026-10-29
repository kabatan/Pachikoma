// 10/30 Blender-glyph HUD (replaces timer_display_20261029). Shared production HUD. Values are read directly from the rule state, never counted here.
const PX=34,PY=28,SPRITE_LIMIT=104;
const VISIBLE=new Set(['Ready','Flight','Effect','ChainChoice','Continue','StaffWait','Fault','Meter','Roulette']);   // Meter/Roulette: H の局面(時計は止めない)。G では現れない
export function timerValues(s){
  if(!VISIBLE.has(s.phase)||s.howto||!Number.isFinite(s.secondsLeft))return null;
  const seconds=Math.max(0,s.secondsLeft),offer=s.phase==='Continue'&&Number.isFinite(s.offerLeft)?Math.max(0,s.offerLeft):null;
  return {seconds:Math.max(0,Math.ceil(seconds-1e-9)),offer:offer===null?null:Math.max(0,Math.ceil(offer-1e-9)),warning:seconds<=10,
    // Fractional rule time drives only the warning's brightness; a stopped clock stays still.
    pulse:.5+.5*Math.cos(2*Math.PI*seconds),offerPulse:offer===null?0:.5+.5*Math.cos(2*Math.PI*offer)};
}

export function attachTimerDisplay(lcd,{getState}){
  if(!lcd?.production||lcd.timerDisplay)return lcd;
  const ctx=lcd.canvas.getContext('2d'),sprites=new Map();
  const rects=[{x:832,y:128,w:304,h:150},{x:832,y:286,w:304,h:150}];
  const saved=rects.map(r=>{const c=document.createElement('canvas');c.width=r.w;c.height=r.h;return {canvas:c,ctx:c.getContext('2d',{alpha:false}),dirty:false};});
  const gpuHud=document.createElement('canvas');gpuHud.width=304;gpuHud.height=308;const gpuHudCtx=gpuHud.getContext('2d');
  let shown=null,uploadKey=null,revision=0,frameRevision;
  const sourceRevision=Object.getOwnPropertyDescriptor(lcd,'uploadRevision')?.get;
  const updateRevision=()=>{
    const base=sourceRevision?.call(lcd);
    if(!Number.isSafeInteger(base)||base<0){frameRevision=undefined;uploadKey=null;return;}
    const key=JSON.stringify([base,shown?.seconds,shown?.offer,shown?.warning,shown?.warning?Math.round(shown.pulse*40):null,shown?.offer<=10?Math.round(shown?.offerPulse*40):null,ready]);
    if(key!==uploadKey){uploadKey=key;revision++;}frameRevision=revision;
  };
  // 10/30 version: glyphs are Blender-baked 3D parts (timer_assets_20261030/glyphs), composed per second.
  const A=new URL('./timer_assets_20261030/glyphs/',import.meta.url).href;
  const names=[...'0123456789'].map(d=>'d'+d).concat(['zan','add','byo']),imgs={};
  const loaded=Promise.all(names.flatMap(n=>['n','w'].map(v=>new Promise(res=>{const im=new Image();im.onload=()=>{imgs[n+'_'+v]=im;res();};im.onerror=()=>res();im.src=`${A}${n}_${v}.png`;})))).then(()=>{ready=names.every(n=>imgs[n+'_n']&&imgs[n+'_w']);});
  let ready=false;
  const sprite=(label,n,warning)=>{
    if(!ready)return null;
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
  const put=(t,spr,x,y,warning,pulse)=>{
    if(!spr)return;
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
    for(let n=secondsMax;n>=0;n--)sprite('残り時間',n,n<=10);
    for(let n=offerMax;n>=0;n--)sprite('追加受付',n,n<=10);
    return {warmed:sprites.size,rgbaBytes:sprites.size*304*150*4};
  };
  const clear=()=>{
    lcd.gpuPanelSource?.backend.setHudCanvas(null);
    for(let i=0;i<rects.length;i++){const r=rects[i],s=saved[i];if(s.dirty){ctx.drawImage(s.canvas,PX+r.x,PY+r.y);s.dirty=false;}}
  };
  const paint=(i,label,n,warning,pulse)=>{
    const r=rects[i],s=saved[i];s.ctx.drawImage(lcd.canvas,PX+r.x,PY+r.y,r.w,r.h,0,0,r.w,r.h);s.dirty=true;
    put(ctx,sprite(label,n,warning),PX+r.x,PY+r.y,warning,pulse);
  };
  const paintGpu=(i,label,n,warning,pulse)=>put(gpuHudCtx,sprite(label,n,warning),0,i*158,warning,pulse);
  const base={frame:lcd.frame.bind(lcd),onEvent:lcd.onEvent.bind(lcd),dispose:lcd.dispose.bind(lcd)};
  lcd.frame=(dt,F)=>{
    clear();base.frame(dt,F);shown=timerValues(getState());
    if(lcd.gpuPanelSource){
      gpuHudCtx.clearRect(0,0,304,308);
      if(shown){paintGpu(0,'残り時間',shown.seconds,shown.warning,shown.pulse);if(shown.offer!==null)paintGpu(1,'追加受付',shown.offer,shown.offer<=10,shown.offerPulse);}
      lcd.gpuPanelSource.backend.setHudCanvas(shown?gpuHud:null);
    }else if(shown){
      paint(0,'残り時間',shown.seconds,shown.warning,shown.pulse);
      if(shown.offer!==null)paint(1,'追加受付',shown.offer,shown.offer<=10,shown.offerPulse);
    }
    updateRevision();
  };
  // Scene bridges and the choice's interrupted blends must capture a clean image.
  lcd.onEvent=(...args)=>{clear();frameRevision=undefined;return base.onEvent(...args);};
  if(sourceRevision)Object.defineProperty(lcd,'uploadRevision',{configurable:true,enumerable:true,get:()=>frameRevision});
  lcd.timerDisplay={clear,prewarm,get shown(){return shown;},position:rects};
  lcd.dispose=()=>{clear();sprites.clear();base.dispose();};
  return lcd;
}
