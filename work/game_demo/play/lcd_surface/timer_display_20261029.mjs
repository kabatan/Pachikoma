// Shared production HUD. Values are read directly from the rule state, never counted here.
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
    const key=JSON.stringify([base,shown?.seconds,shown?.offer,shown?.warning,shown?.warning?shown.pulse:null,shown?.offer<=10?shown?.offerPulse:null]);
    if(key!==uploadKey){uploadKey=key;revision++;}frameRevision=revision;
  };
  const sprite=(label,n,warning)=>{
    const key=`${label}:${n}:${warning}`;if(sprites.has(key))return sprites.get(key);
    const c=document.createElement('canvas');c.width=304;c.height=150;const x=c.getContext('2d');
    x.fillStyle='#11102aeF';x.strokeStyle=warning?'#ff785e':'#d9ac57';x.lineWidth=3;
    x.beginPath();x.roundRect(8,8,288,134,16);x.fill();x.stroke();
    x.strokeStyle=warning?'#ffbba3':'#fff0b3';x.lineWidth=1;
    x.beginPath();x.moveTo(26,14);x.lineTo(278,14);x.stroke();
    x.font='24px Dela1026';x.textAlign='center';x.textBaseline='middle';
    x.fillStyle='#fff3cc';x.fillText(label,152,35);
    x.font='96px Dela1026';x.lineJoin='round';
    const number=String(n),max=218,width=x.measureText(number).width;
    x.save();x.translate(143,91);if(width>max)x.scale(max/width,1);
    x.strokeStyle='#03030e';x.lineWidth=14;x.strokeText(number,0,0);
    x.strokeStyle=warning?'#fc5f42':'#df9e34';x.lineWidth=9;x.strokeText(number,0,0);
    x.strokeStyle=warning?'#6a0825':'#503023';x.lineWidth=3;x.strokeText(number,0,0);
    const fill=x.createLinearGradient(0,-42,0,43);
    for(const [t,col] of warning?[[0,'#fff5d6'],[.35,'#ffb490'],[.51,'#f3463b'],[1,'#ff5938']]:[[0,'#ffffff'],[.42,'#fff9d8'],[.50,'#f0bc58'],[1,'#ffe8a5']])fill.addColorStop(t,col);
    x.fillStyle=fill;x.fillText(number,0,0);x.restore();
    x.font='23px Dela1026';x.fillStyle=warning?'#ffab94':'#ffe6a6';x.fillText('秒',268,112);
    sprites.set(key,c);if(sprites.size>SPRITE_LIMIT)sprites.delete(sprites.keys().next().value);return c;
  };
  // Startup only: retain all default 72..0 + 30..0 variants within a small fixed budget.
  // Out-of-budget/custom values keep the same lazy sprite path during play.
  const prewarm=({secondsMax,offerMax}={})=>{
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
    ctx.drawImage(sprite(label,n,warning),PX+r.x,PY+r.y);
    if(warning){ctx.save();ctx.strokeStyle=`rgba(255,70,45,${.25+.7*pulse})`;ctx.lineWidth=3;ctx.beginPath();ctx.roundRect(PX+r.x+8,PY+r.y+8,288,134,16);ctx.stroke();ctx.restore();}
  };
  const paintGpu=(i,label,n,warning,pulse)=>{const y=i*158;gpuHudCtx.drawImage(sprite(label,n,warning),0,y);if(warning){gpuHudCtx.save();gpuHudCtx.strokeStyle=`rgba(255,70,45,${.25+.7*pulse})`;gpuHudCtx.lineWidth=3;gpuHudCtx.beginPath();gpuHudCtx.roundRect(8,y+8,288,134,16);gpuHudCtx.stroke();gpuHudCtx.restore();}};
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
