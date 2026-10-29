// Approved 08490fad attract/title loop. The rule state still owns start/howto.
const W=1152,H=1268,PX=34,PY=28;
export async function attachAttractSurface(lcd,{getState,manifestUrl=new URL('../../../effects/attract/prod/manifest.json',import.meta.url)}={}) {
  if(!lcd?.production||lcd.attractSurface)return lcd;
  const response=await fetch(manifestUrl);if(!response.ok)throw Error(`attract manifest: HTTP ${response.status}`);
  const man=await response.json(),base=new URL('.',manifestUrl),v=document.createElement('video');
  const ctx=lcd.canvas.getContext('2d'),errors=[];
  v.muted=true;v.playsInline=true;v.loop=true;v.preload='auto';
  const error=()=>{const message=`attract video: ${v.error?.message??'unavailable'}`;errors.push(message);console.error(message);};
  v.addEventListener('error',error);
  await new Promise((resolve,reject)=>{
    const done=()=>{clearTimeout(timer);v.removeEventListener('loadeddata',done);v.removeEventListener('error',bad);resolve();};
    const bad=()=>{clearTimeout(timer);v.removeEventListener('loadeddata',done);v.removeEventListener('error',bad);reject(Error('attract video unavailable'));};
    const timer=setTimeout(bad,20000);v.addEventListener('loadeddata',done,{once:true});v.addEventListener('error',bad,{once:true});
    v.src=new URL(man.file,base).href;v.load();
  });
  let active=false,manual=false,time=0,disposed=false;
  const wanted=()=>{const s=getState();return s.phase==='Attract'&&!s.howto;};
  const original={frame:lcd.frame.bind(lcd),onEvent:lcd.onEvent.bind(lcd),prepare:lcd.prepare.bind(lcd),setManual:lcd.setManual.bind(lcd),applyLights:lcd.applyLights.bind(lcd),dispose:lcd.dispose.bind(lcd)};
  const revision=Object.getOwnPropertyDescriptor(lcd,'uploadRevision')?.get;
  const sync=()=>{const next=wanted();if(next!==active){active=next;if(active){time=0;v.currentTime=0;}else v.pause();}if(active&&!manual&&v.paused)v.play().catch(()=>{});};
  lcd.frame=(dt,F)=>{
    sync();original.frame(dt,F);if(!active)return;
    ctx.fillStyle='#000';ctx.fillRect(0,0,lcd.canvas.width,lcd.canvas.height);
    if(v.readyState>=2)ctx.drawImage(v,PX,PY,W,H);
    if(manual)time=(time+dt)%man.duration;
  };
  lcd.onEvent=(id,...args)=>{if(id==='attract'){time=0;v.currentTime=0;}const result=original.onEvent(id,...args);sync();return result;};
  lcd.setManual=on=>{manual=!!on;v.pause();original.setManual(on);sync();};
  lcd.prepare=async dt=>{
    sync();if(!active){await original.prepare(dt);return;}
    if(!manual)return;const t=(time+dt)%man.duration;
    if(Math.abs(v.currentTime-t)<.0001)return;
    await new Promise(resolve=>{const done=()=>{clearTimeout(timer);v.removeEventListener('seeked',done);resolve();};const timer=setTimeout(done,2000);v.addEventListener('seeked',done,{once:true});v.currentTime=t;});
  };
  // Preserve the existing cabinet lighting path; only replace the LCD pixels.
  lcd.applyLights=F=>original.applyLights(F);
  if(revision)Object.defineProperty(lcd,'uploadRevision',{configurable:true,enumerable:true,get:()=>active?undefined:revision.call(lcd)});
  lcd.attractSurface={video:v,manifest:man,errors,get active(){return active;},get time(){return manual?time:v.currentTime;}};
  lcd.dispose=()=>{if(disposed)return;disposed=true;v.pause();v.removeEventListener('error',error);v.removeAttribute('src');v.load();original.dispose();};
  sync();return lcd;
}
