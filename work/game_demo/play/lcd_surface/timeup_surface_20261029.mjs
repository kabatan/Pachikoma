// Approved left_v1 absolute score + v22 right loop, native 1152x1268 / 30fps.
// The rules own the 30s offer and credit/loan; this module owns only LCD pixels.
import * as THREE from '../../web/vendor/three/three.module.js';
import {layerTexture} from './lcd_split_1030.mjs';
import {createTimeupTotal} from './total_digits_20261029.mjs';
// 継続(時間切れの動画)の転送削減(10/30): 動画を VideoTexture で直接 GPU へ、字や板は小さい層で重ねる。?timeupvideo=0 で従来(液晶 canvas を毎回全面転送)
const SPLIT_ON=new URLSearchParams(globalThis.location?.search??'').get('timeupvideo')!=='0';
const SPLIT_CHECK=new URLSearchParams(globalThis.location?.search??'').has('splitcheck');
const SPLIT_SETTLE=1.6;   // 入りの動き(板と字のせり出し・説明の出現)が終わってから切り替える
const W=1152,H=1268,PX=34,PY=28;
export async function attachTimeupSurface(lcd,{controller,canvas,onInput,unlock,manifestUrl=new URL('../../../effects/jp_teacher/09_timeup/prod/final/manifest.json',import.meta.url)}={}){
  if(!lcd?.production||lcd.timeupSurface)return lcd;
  const response=await fetch(manifestUrl);if(!response.ok)throw Error(`timeup manifest: HTTP ${response.status}`);
  const manifest=await response.json(),v=document.createElement('video'),ctx=lcd.canvas.getContext('2d');
  const errors=[],events=[];
  v.muted=true;v.playsInline=true;v.loop=false;v.preload='auto';
  const error=()=>{const msg=`timeup video: ${v.error?.message??'unavailable'}`;errors.push(msg);console.error(msg);};
  v.addEventListener('error',error);
  await new Promise((resolve,reject)=>{
    const clean=()=>{clearTimeout(timer);v.removeEventListener('loadeddata',done);v.removeEventListener('error',bad);};
    const done=()=>{clean();resolve();};const bad=()=>{clean();reject(Error('timeup video unavailable'));};
    const timer=setTimeout(bad,30000);v.addEventListener('loadeddata',done,{once:true});v.addEventListener('error',bad,{once:true});
    v.src=new URL(manifest.file,manifestUrl).href;v.load();
  });
  const first=document.createElement('canvas'),held=document.createElement('canvas');
  for(const c of [first,held]){c.width=W;c.height=H;c.getContext('2d').drawImage(v,0,0,W,H);}
  const heldCtx=held.getContext('2d');
  // 左の札の TOTAL: 映像の流れる桁は、桁なしの板で隠し、いまの JP 合計(確定済み＋積み増し)を重ねる
  const totalOv=await createTimeupTotal({ctx,PX,PY,getValues:()=>{const g=controller.game;return {total:g.rules?.PrizeBasis==='wallet'?g.prizeScore:(g.jackpotEarnings??0)+(g.chainStatus?.pendingAward??0)};}});   // H(wallet)は持ち玉＋積み増し
  let plateIdx=0;
  const staffClear=new Image();staffClear.src=new URL('staff_clock_clear.png',manifestUrl).href;await staffClear.decode();
  // Local runtime override: retain source configs and all other tuning.
  controller.rules.ContinueSeconds=30;controller.game.rules.ContinueSeconds=30;
  let active=false,manual=false,disposed=false,target=0,lastPhase=null,waiting=false;
  const hudHandoff=new URLSearchParams(globalThis.location?.search??'').get('hudhandoff')!=='0';
  const base={frame:lcd.frame.bind(lcd),prepare:lcd.prepare.bind(lcd),setManual:lcd.setManual.bind(lcd),onEvent:lcd.onEvent.bind(lcd),dispose:lcd.dispose.bind(lcd)};
  const revision=Object.getOwnPropertyDescriptor(lcd,'uploadRevision')?.get;
  const record=(kind,data={})=>{events.push({kind,at:performance.now(),...data});if(events.length>200)events.shift();};
  const sync=()=>{
    const g=controller.game;waiting=g.phase==='StaffWait';const next=g.phase==='Continue'||waiting;
    if(!waiting)target=Math.min(manifest.duration-1/manifest.fps,Math.max(0,30-g.offerLeft));
    if(next!==active){active=next;if(active){target=0;plateIdx=0;totalOv.enter();heldCtx.drawImage(first,0,0);v.currentTime=0;record('enter',{offerLeft:g.offerLeft});}else{v.pause();record('exit',{phase:g.phase,secondsLeft:g.secondsLeft,wallet:g.wallet});}}
    if(g.phase!==lastPhase){lastPhase=g.phase;record('phase',{phase:lastPhase,offerLeft:g.offerLeft});}
    if(waiting)v.pause();
    if(active&&!waiting&&!manual&&v.paused)v.play().catch(()=>{});
    if(active&&!waiting&&!manual&&!v.seeking&&Math.abs(v.currentTime-target)>.18)v.currentTime=target;
  };
  const seek=async t=>{
    if(Math.abs(v.currentTime-t)<.0001&&!v.seeking)return;
    await new Promise(resolve=>{
      const done=()=>{clearTimeout(timer);v.removeEventListener('seeked',done);resolve();};
      const timer=setTimeout(done,3000);v.addEventListener('seeked',done,{once:true});v.currentTime=t;
    });
  };
  // ---- 分割描画(継続) ----
  const sp={layers:null,vtex:null,ptex:new Map(),rowTex:null,rowKey:null,enterAt:0,wasSplit:false,fail:false,media:null,framesHooked:false,splitNow:false};
  const hookFrames=()=>{if(sp.framesHooked||!v.requestVideoFrameCallback)return;sp.framesHooked=true;const cb=(t,meta)=>{sp.media=meta.mediaTime;if(!disposed)v.requestVideoFrameCallback(cb);};v.requestVideoFrameCallback(cb);};
  const buildLayers=(dt)=>{
    sp.vtex??=layerTexture(THREE,v);hookFrames();
    if(!SPLIT_CHECK)totalOv.split.tick(dt);   // 検証時は従来の draw が同じ時計を進める
    if(v.readyState>=2&&!v.seeking)plateIdx=Math.round((sp.media!=null?sp.media:v.currentTime)*30);
    const pl=totalOv.split.plate(plateIdx);let pt=sp.ptex.get(pl.k);if(!pt){pt=layerTexture(THREE,pl.img);sp.ptex.set(pl.k,pt);}
    const layers=[{tex:sp.vtex,w:W,h:H,ax:0,ay:0,x:PX,y:PY,rot:0,sc:1,alpha:1,add:false},{tex:pt,w:pl.img.width,h:pl.img.height,ax:0,ay:0,x:pl.x,y:pl.y,rot:0,sc:1,alpha:1,add:false}];
    const row=totalOv.split.row();
    if(row){if(sp.rowKey!==row.key){sp.rowTex?.dispose();sp.rowTex=layerTexture(THREE,row.canvas);sp.rowKey=row.key;}
      layers.push({tex:sp.rowTex,w:row.w,h:row.h,ax:row.w/2,ay:row.h/2,x:row.x,y:row.y,rot:0,sc:row.pop,alpha:row.a,add:false});}
    sp.layers=layers;
  };
  lcd.frame=(dt,F)=>{
    sync();
    if(!active&&sp.wasSplit){   // 継続の画面を出た瞬間: 次の場面の切替が液晶 canvas を写し取っても同じ絵になるよう、最後の絵を一度だけ canvas へ描く
      sp.wasSplit=false;ctx.fillStyle='#000';ctx.fillRect(0,0,lcd.canvas.width,lcd.canvas.height);
      if(v.readyState>=2&&!v.seeking)heldCtx.drawImage(v,0,0,W,H);ctx.drawImage(held,PX,PY,W,H);totalOv.draw(plateIdx,0);
    }
    base.frame(dt,F);if(!active){sp.layers=null;sp.splitNow=false;sp.enterAt=0;return;}
    const nowS=performance.now()/1000;if(!sp.enterAt)sp.enterAt=nowS;
    // Retire the inner HUD background before the full-panel TimeUp overwrite.
    if(hudHandoff)lcd.timerDisplay?.clear();
    const splitOk=SPLIT_ON&&!sp.fail&&!lcd.splitBroken&&!waiting&&!manual&&v.readyState>=2&&nowS-sp.enterAt>=SPLIT_SETTLE;
    if(splitOk){
      try{buildLayers(dt);sp.splitNow=true;}catch(e){sp.fail=true;sp.layers=null;sp.splitNow=false;console.warn('[timeupvideo] 分割描画を止めて従来へ戻します',e);}
    }else{sp.layers=null;sp.splitNow=false;}
    if(sp.splitNow&&!SPLIT_CHECK){sp.wasSplit=true;return;}   // 分割描画中は液晶 canvas を描かない(転送しない)
    if(sp.wasSplit){sp.wasSplit=false;if(v.readyState>=2&&!v.seeking)heldCtx.drawImage(v,0,0,W,H);}   // 従来描画へ戻る瞬間: 直近の動画の絵を held へ
    ctx.fillStyle='#000';ctx.fillRect(0,0,lcd.canvas.width,lcd.canvas.height);
    if(!waiting&&v.readyState>=2&&!v.seeking){heldCtx.drawImage(v,0,0,W,H);plateIdx=Math.round(v.currentTime*30);}
    ctx.drawImage(held,PX,PY,W,H);
    totalOv.draw(plateIdx,dt);
    if(waiting)ctx.drawImage(staffClear,PX+640,PY+990);
    if(SPLIT_CHECK&&sp.splitNow&&sp.layers){/* 検証用: 従来描画も済んだ。plateIdx は従来側の値に揃える */}
  };
  (lcd.splitSources??=[]).push(()=>{if(!(SPLIT_ON&&!sp.fail&&!lcd.splitBroken&&sp.splitNow&&sp.layers))return null;const h=lcd.timeupHelp?.splitLayers?.();return h?[...sp.layers,...h]:sp.layers;});
  lcd.onEvent=(id,...args)=>{const result=base.onEvent(id,...args);sync();return result;};
  lcd.prepare=async dt=>{sync();if(!active){await base.prepare(dt);return;}if(manual&&!waiting)await seek(target);};
  lcd.setManual=on=>{manual=!!on;v.pause();base.setManual(on);sync();};
  if(revision)Object.defineProperty(lcd,'uploadRevision',{configurable:true,enumerable:true,get:()=>active?undefined:revision.call(lcd)});
  // Same cabinet projection as the existing choice surface. Left=終わる/right=続ける.
  const hit=e=>{
    if(!canvas)return null;const r=canvas.getBoundingClientRect();let x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;
    const display=new URLSearchParams(location.search).get('display');
    if(display==='portrait')[x,y]=[y,1-x];else if(display==='portrait-flip')[x,y]=[1-y,x];
    x*=1440;y*=2560;return x>=144&&x<=1296&&y>=728&&y<=1996?(x<720?'finish':'add'):null;
  };
  const down=e=>{
    if(e.button!==0||!active)return;const action=hit(e);if(!action)return;
    if(waiting&&action==='add')return;
    const phase=controller.phase;unlock?.();const accepted=controller.dispatch(action);onInput?.({source:'pointer',action,accepted,phase},controller.game);
    record('input',{action,accepted});e.preventDefault();e.stopImmediatePropagation();
  };
  window.addEventListener('pointerdown',down,true);
  lcd.timeupSurface={video:v,manifest,errors,events,get active(){return active;},get waiting(){return waiting;},get time(){return v.currentTime;},get absoluteFrame(){return Math.floor(Math.min(899,target*30+1e-6));},get splitActive(){return sp.splitNow;},get splitEnterAt(){return sp.enterAt;}};
  lcd.dispose=()=>{if(disposed)return;disposed=true;window.removeEventListener('pointerdown',down,true);v.pause();v.removeEventListener('error',error);v.removeAttribute('src');v.load();base.dispose();};
  sync();return lcd;
}
