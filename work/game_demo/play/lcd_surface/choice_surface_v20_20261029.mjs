import {createCaptureLeaseStore} from './choice_capture_lease_1029.mjs';
import {warmPausedVideo,withRestored2D} from './startup_warm.mjs';
// v20 production choice, independent of the JP/confirm/failure implementations.
// Sources are served verbatim; all three loops share their playback phase.
import {createChoiceCountdown} from './choice_countdown_20261029.mjs';
import {createChoiceTotal} from './total_digits_20261029.mjs';
const W=1152,H=1268,PX=34,PY=28;
const FADE_SECONDS=.24;
const FILES=['neutral','left','right'];
const EXIT=new Set(['attract','title','howto','ticket','start','chain_continue','chain_stop','fail','timeup','finish_count','result','challenge_cancel','challenge_flight','lamp6']);

export async function attachChoiceSurface(lcd,{getState,controller,canvas,onInput,unlock,choiceImageFactory=null}={}) {
  if(!lcd?.production||lcd.choiceV20)return lcd;
  const ctx=lcd.canvas.getContext('2d'),errors=[],events=[];
  let active=false,pending=false,selected='neutral',manual=false,clock=0,lastPhase=null,disposed=false;
  const heldChoice=document.createElement('canvas');heldChoice.width=W;heldChoice.height=H;
  const heldCtx=heldChoice.getContext('2d',{alpha:false});
  let choiceBackend=null,choiceGpu=null,choiceGeneration=0,heldLease=null,entryGpu=null,materializedHeldId=null;const captureStats={gpu:0,stopZero:0,legacy:0,failures:0};
  if(choiceImageFactory){try{choiceBackend=await choiceImageFactory({width:1240,height:1510,visible:{x:PX,y:PY,w:W,h:H}});if(!choiceBackend?.render||!choiceBackend?.setOverlays||!choiceBackend?.compose||!choiceBackend?.materializeTo||!choiceBackend?.captureSource||!choiceBackend?.cloneCompleted||!choiceBackend?.applyStopZero||!choiceBackend?.renderHandoff){choiceBackend?.dispose?.();choiceBackend=null;throw Error('invalid choice GPU API');}}catch(e){errors.push('choice GPU factory: '+e.message);}}
  const leaseStore=choiceBackend?createCaptureLeaseStore({context:choiceBackend.surface.context,copyCompleted:args=>choiceBackend.cloneCompleted(args)}):null;
  const dropHeld=()=>{heldLease?.release();heldLease=null;materializedHeldId=null;countdown?.snapshotGpu(null);};
  const materializeHeld=(reason,mask=false)=>{if(!heldLease)return false;if(materializedHeldId===heldLease.id)return true;const image=heldLease.materialize({reason,readSnapshot:request=>choiceBackend.materializeLease(request)});if(!image)throw Error('Choice legacy snapshot unavailable: '+reason);heldCtx.save();try{heldCtx.setTransform(1,0,0,1,0,0);heldCtx.globalAlpha=1;heldCtx.globalCompositeOperation='copy';heldCtx.filter='none';heldCtx.drawImage(image,0,0);}finally{heldCtx.restore();}if(mask)countdown.snapshot(heldChoice);materializedHeldId=heldLease.id;return true;};
  const baseGpu=Object.getOwnPropertyDescriptor(lcd,'gpuPanelSource')?.get,baseMaterialize=lcd.materializeGpuLcd?.bind(lcd);
  const materializeChoice=(policy='handoff-keep')=>{if(!choiceGpu)return false;const result=choiceGpu.backend.materializeTo({panelCtx:ctx,policy,reason:policy});choiceGpu=null;return !!result;};
  Object.defineProperty(lcd,'gpuPanelSource',{configurable:true,enumerable:true,get:()=>choiceGpu??(active?null:baseGpu?.call(lcd))});
  lcd.materializeGpuLcd=(reason,force)=>choiceGpu?materializeChoice('handoff-keep'):baseMaterialize?.(reason,force);
  const composedPanel=backend=>{const expected=choiceBackend.surface.context,actual=backend.getComposedPanelContext?.()??(backend.diagnostics?.().kind==='video_compositor_injected'?backend.surface?.context:null);if(actual!==expected)throw Error('Choice panel backend is not an injected producer on the main context');backend.setHudCanvas(null);const texture=backend.compose();if(!texture)return lcd.canvas;if(!texture.isTexture||!texture.isRenderTargetTexture)throw Error('Choice producer did not return a composed render-target texture');return {texture,context:actual,width:1240,height:1510,origin:'bottom-left',encoding:'srgb-encoded',alphaMode:'opaque'};};
  const videoLayer=(v,name,alpha=1)=>({video:v,name,alpha,generation:choiceGeneration,time:v.currentTime});
  const gpuOverlays=(dt,override)=>{const count=countdown.renderOverlay(selected,blend,dt,override);choiceBackend.setOverlays({countdownValue:count.value,patch:count.patch,digit:count.digit,total:total.renderOverlay(selected,blend,clock*30)});};
  let hasChoiceFrame=false,handoff=null,presented=null,blend=null,countdown=null,total=null;
  const drawable=v=>v?.readyState>=2&&!v.seeking;
  // One capture only when interrupted by a third state or leaving the choice.
  const capture=(keepDigit=false)=>{
    if(choiceGpu?.backend===choiceBackend){const source=choiceBackend.captureSource(),policy=keepDigit?(source?.zeroOverrideApplied?'handoff-stop-zero':'handoff-keep'):'interrupt-clean',next=leaseStore.capture({source,policy});if(next){const old=heldLease;heldLease=next;old?.release();if(!keepDigit)countdown.snapshotGpu(next);captureStats.gpu++;if(policy==='handoff-stop-zero')captureStats.stopZero++;return true;}captureStats.failures++;}
    captureStats.legacy++;
    if(choiceGpu)materializeChoice(keepDigit?'handoff-keep':'interrupt-clean');
    lcd.materializeGpuLcd?.('choice-capture');
    lcd.timerDisplay?.clear();if(!keepDigit){countdown?.clearDigit();total?.clear();}
    heldCtx.drawImage(lcd.canvas,PX,PY,W,H,0,0,W,H);
    if(!keepDigit)countdown?.snapshot(heldChoice);dropHeld();return false;
  };
  // A claimed JP scene may still return the previous scene or an unpainted canvas.
  // Release the held choice only after this frame actually returned the decoded new scene.
  const jp=lcd.jp,jpFrame=jp?.frame.bind(jp);
  if(jpFrame)jp.frame=(dt)=>{
    const v=jpFrame(dt),w=jp.where();
    if(handoff&&w&&drawable(v)){
      const start=jp.lifecycle?.findLast(e=>e.kind==='start'&&e.name===w.name&&e.wall>=handoff.at);
      // A layered canvas is always "ready"; also wait for its moving background
      // and one decoded foreground frame before handing over the continuation.
      // confirm_v30 itself begins with a near-black two-frame fade-in.
      const next=handoff.event==='chain_stop'
        ?w.name==='chain_confirm'&&w.time>=2/30
        :w.name.startsWith('chain_jp_aim_')&&w.time>=1/30&&drawable(jp.palace?.video);
      if(start&&next)presented=w.name;
    }
    return v;
  };
  const originalCursor=canvas?.style.cursor??'';
  const record=(kind,data={})=>{events.push({kind,at:performance.now(),...data});if(events.length>200)events.shift();};
  const videos={};
  for(const state of FILES){
    const v=document.createElement('video');v.muted=true;v.playsInline=true;v.loop=true;v.preload='auto';
    videos[state]=v;
    await new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);v.removeEventListener('loadeddata',done);v.removeEventListener('error',bad);};
      const done=()=>{cleanup();resolve();};
      const bad=()=>{cleanup();const e=`choice v20 ${state}: video unavailable`;errors.push(e);reject(Error(e));};
      const timer=setTimeout(bad,20000);
      v.addEventListener('loadeddata',done,{once:true});v.addEventListener('error',bad,{once:true});
      v.src=new URL(`../../../effects/jp_teacher/05_choice/r2/stills/v21_nodigit/choice_${state}_v21_nodigit.mp4`,import.meta.url).href;v.load();
    });
  }
  countdown=await createChoiceCountdown(lcd.canvas,()=>controller?.game.choiceLeft);
  // 左の札(確定)の TOTAL と連×N: いま確定した場合の額(確定済みの JP 合計＋積み増し)を実行時に重ねる。映像は桁なしの版。
  total=await createChoiceTotal({ctx,PX,PY,getValues:()=>{const g=controller?.game,c=g?.chainStatus;return g?{total:g.rules?.PrizeBasis==='wallet'?g.prizeScore:(g.jackpotEarnings??0)+(c?.pendingAward??0),chain:(c?.successes??0)+1}:null;}});
  const choose=state=>{
    if(selected===state)return;
    let from=selected,alpha=0;
    if(active&&hasChoiceFrame){
      if(blend?.from===state){
        // Reverse the same pair from the last painted weight, without a snap.
        from=selected;alpha=1-blend.alpha;
      }else if(blend){
        // Three-way interruptions start from the exact image already on screen.
        capture();from=null;
      }
      blend={from,to:state,start:alpha,alpha,elapsed:0};
    }else blend=null;
    selected=state;record('select',{state,from:from??'snapshot',alpha});
  };
  const setActive=on=>{
    if(active===on)return;
    if(on){dropHeld();entryGpu=choiceBackend&&choiceBackend.diagnostics().enabled?baseGpu?.call(lcd):null;if(entryGpu)choiceGpu={...entryGpu,owner:'choice'};else baseMaterialize?.('choice-enter',true);choiceGeneration++;}else {choiceGpu=null;entryGpu=null;if(!handoff)dropHeld();}
    active=on;selected='neutral';blend=null;clock=0;
    if(on){hasChoiceFrame=false;countdown.reset();}
    record(on?'enter':'exit');
    if(canvas)canvas.style.cursor=on?'pointer':originalCursor;
    for(const v of Object.values(videos)){v.pause();if(on){v.currentTime=0;if(!manual)v.play().catch(e=>errors.push(e.message));}}
  };
  const hit=e=>{
    if(!canvas)return null;
    const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return null;
    let x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;
    const display=document.documentElement.dataset.display;
    if(display==='portrait')[x,y]=[y,1-x];
    else if(display==='portrait-flip')[x,y]=[1-y,x];
    x*=1440;y*=2560;
    return x>=144&&x<=1296&&y>=728&&y<=1996?(x<720?'left':'right'):null;
  };
  const move=e=>{if(active)choose(hit(e)??'neutral');};
  const commit=(state,source)=>{
    if(!active||controller?.phase!=='ChainChoice')return false;
    const action=state==='right'?'chainContinue':'chainStop',phase=controller.phase;
    unlock?.();const accepted=controller.dispatch(action);
    onInput?.({source,action,accepted,phase},controller.game);record('commit',{state,action,accepted});return true;
  };
  const down=e=>{if(e.button!==0||!active)return;const state=hit(e);if(state&&commit(state,'pointer')){e.preventDefault();e.stopImmediatePropagation();}};
  const key=e=>{
    if(!active||e.repeat||e.isComposing||e.target?.closest?.('input,textarea,select,[contenteditable]'))return;
    if(e.code==='ArrowLeft'||e.code==='ArrowRight'){choose(e.code==='ArrowLeft'?'left':'right');e.preventDefault();e.stopImmediatePropagation();}
    else if((e.code==='Enter'||e.code==='Space')&&selected!=='neutral'&&commit(selected,'keyboard')){e.preventDefault();e.stopImmediatePropagation();}
  };
  const blur=()=>{if(active)choose('neutral');};
  window.addEventListener('pointermove',move);window.addEventListener('pointerdown',down,true);
  window.addEventListener('keydown',key,true);window.addEventListener('blur',blur);
  const base={frame:lcd.frame.bind(lcd),onEvent:lcd.onEvent.bind(lcd),prepare:lcd.prepare?.bind(lcd),setManual:lcd.setManual.bind(lcd),dispose:lcd.dispose.bind(lcd)};
  lcd.onEvent=(id,p={})=>{
    if(id==='chain_choice'){pending=true;choose('neutral');}
    else if(EXIT.has(id)){
      const leaving=(id==='chain_continue'||id==='chain_stop')&&(active||handoff)&&hasChoiceFrame;
      if(leaving){
        if(active){
          // The rules may move straight to Effect at zero, before another choice frame.
          if(id==='chain_stop'){let gpuZero=false;if(choiceGpu?.backend===choiceBackend){const count=countdown.renderOverlay(selected,blend,0,0);gpuZero=choiceBackend.applyStopZero(count);}if(!gpuZero){materializeChoice('handoff-stop-before-zero');if(blend?.from===null)materializeHeld('stop-zero-legacy-mask',true);countdown.clearDigit();countdown.draw(selected,blend,0,0);}}
          capture(true);
        }
        handoff={event:id,at:performance.now()};
      }
      // The first Ready sync can emit start after either decision (including timeout).
      // That notification does not replace the claimed JP scene.
      else if(!(id==='start'&&handoff)){
        if(handoff)record('handoff-cancel',{event:handoff.event,by:id});
        handoff=null;dropHeld();
      }
      pending=false;setActive(false);
    }
    return base.onEvent(id,p);
  };
  lcd.frame=(dt,F)=>{
    if(disposed)return;
    presented=null;
    if(handoff&&heldLease&&(!choiceBackend.diagnostics().enabled||choiceBackend.diagnostics().failed))throw Error('Mid-handoff GPU disable/failure requires an explicit two-fade fallback; not supported by this prototype');
    const phase=getState?.().phase;
    if(lastPhase==='ChainChoice'&&phase!=='ChainChoice')pending=false;
    lastPhase=phase;
    // While choice owns the surface, don't render the hidden normal scene too.
    if(!(phase==='ChainChoice'||pending)||jp?.claimed)base.frame(dt,F);
    setActive((phase==='ChainChoice'||pending)&&!lcd.jp?.claimed);
    if(!active){
      choiceGpu=null;
      if(handoff){
        if(presented)handoff.reveal=(handoff.reveal??0)+Math.max(0,dt);
        if((handoff.reveal??0)>=.12||!jp?.claimed){record('handoff',{event:handoff.event,scene:presented,heldMs:performance.now()-handoff.at});handoff=null;dropHeld();}
        else{
          if(heldLease){const sourceFrame=baseGpu?.call(lcd),backend=sourceFrame?.backend;let source=lcd.canvas;if(backend){source=composedPanel(backend);}const alpha=presented?1-(handoff.reveal??0)/.12:1;if(choiceBackend.renderHandoff({source,bridge:lcd.choiceGpuBridge,held:heldLease,alpha})){choiceGpu={owner:'choice',backend:choiceBackend,published:false};return;}}
          ctx.globalAlpha=presented?1-(handoff.reveal??0)/.12:1;
          ctx.drawImage(heldChoice,PX,PY,W,H);ctx.globalAlpha=1;
        }
      }
      if(lcd.choiceGpuBridge){const baseFrame=baseGpu?.call(lcd),backend=baseFrame?.backend;let source=lcd.canvas;if(backend){source=composedPanel(backend);}if(choiceBackend?.renderHandoff({source,bridge:lcd.choiceGpuBridge,held:null,alpha:0}))choiceGpu={owner:'choice',backend:choiceBackend,published:false};}else if(!handoff)choiceBackend?.endHandoff();
      return;
    }
    handoff=null;
    clock=(clock+dt)%(176/30);
    const v=videos[selected];
    // A decode/loop seek retains the last surface and pauses the fade clock.
    const from=blend&&(blend.from?videos[blend.from]:heldChoice);
    if(!drawable(v)||(blend&&blend.from&&!drawable(from))){
      if(hasChoiceFrame){if(choiceGpu&&choiceBackend.diagnostics().enabled){gpuOverlays(dt);}else{materializeChoice('interrupt-clean');if(blend?.from===null)materializeHeld('wait-legacy-mask',true);countdown.clearDigit();countdown.draw(selected,blend,dt);total.clear();total.draw(selected,blend,clock*30);}}
      return;
    }
    if(blend){
      blend.elapsed+=Math.max(0,dt);
      const t=Math.min(1,blend.elapsed/FADE_SECONDS);
      blend.alpha=blend.start+(1-blend.start)*(1-(1-t)**3);
      if(t===1)blend=null;
    }
    // Completed interrupt lease is sampled directly; COUNT mask is a separate GPU patch.
    if(choiceBackend&&(!blend||blend.from||heldLease)){
      const layers=blend?[(blend.from?videoLayer(from,blend.from):{surface:heldLease,name:'interrupt-clean',generation:choiceGeneration,alpha:1}),videoLayer(v,selected,blend.alpha)]:[videoLayer(v,selected)];
      const surface=choiceBackend.render({owner:'choice',generation:choiceGeneration,serial:choiceGeneration,manual,layers});
      if(surface){hasChoiceFrame=true;gpuOverlays(dt);choiceGpu={owner:'choice',backend:choiceBackend,published:false};entryGpu=null;if(!blend)dropHeld();return;}
    }
    materializeChoice('handoff-keep');if(blend?.from===null)materializeHeld('choice-legacy-from',true);
    countdown.invalidate();total.invalidate();ctx.fillStyle='#000';ctx.fillRect(0,0,lcd.canvas.width,lcd.canvas.height);
    if(blend){ctx.drawImage(from,PX,PY,W,H);ctx.globalAlpha=blend.alpha;}
    ctx.drawImage(v,PX,PY,W,H);ctx.globalAlpha=1;hasChoiceFrame=true;
    countdown.draw(selected,blend,dt);
    total.draw(selected,blend,clock*30);
  };
  lcd.setManual=on=>{manual=!!on;base.setManual(on);for(const v of Object.values(videos)){v.pause();if(active&&!manual)v.play().catch(()=>{});}};
  lcd.prepare=async dt=>{
    await base.prepare?.(dt);
    if(!manual||!active)return;
    for(const v of Object.values(videos)){
      const t=(clock+dt)%(176/30);if(Math.abs(v.currentTime-t)<1e-5)continue;
      await new Promise(resolve=>{const done=()=>{clearTimeout(timer);v.removeEventListener('seeked',done);resolve();};const timer=setTimeout(done,2000);v.addEventListener('seeked',done,{once:true});v.currentTime=t;});
    }
  };
  lcd.choiceV20={get gpuHoldActive(){return !!(handoff&&heldLease);},captureGpuBridgeLease(){if(!choiceBackend||(!choiceGpu&&!handoff&&!lcd.choiceGpuBridge))return null;return leaseStore.capture({source:choiceBackend.captureSource(),policy:'bridge-clean'});},materializeGpuBridgeFallback(){return !!(choiceGpu?.backend??choiceBackend)?.materializeTo({panelCtx:ctx,policy:'handoff-keep',reason:'normal-bridge-fallback'});},captureDiagnostics(){return {...captureStats,held:heldLease?{id:heldLease.id,live:heldLease.live,policy:heldLease.policy}:null,leases:leaseStore?.diagnostics()};},get imageBackend(){return choiceBackend;},get gpuActive(){return !!choiceGpu;},get active(){return active;},get holding(){return !!handoff;},get selected(){return selected;},get countdown(){return countdown.value;},get time(){return videos[selected].currentTime;},get transition(){return blend?{...blend}:null;},errors,events,
    async warm(){
      if(disposed||active||pending||handoff||clock!==0||hasChoiceFrame)throw Error('choice warm is boot-only');
      if(Object.values(videos).some(v=>!v.paused))throw Error('choice warm requires paused videos');
      return withRestored2D(ctx,async()=>{
        const result=[];
        for(const [state,v] of Object.entries(videos))result.push({state,...await warmPausedVideo(v,v=>ctx.drawImage(v,PX,PY,W,H))});
        if(choiceBackend?.warm)choiceBackend.warm(countdown.createGpuWarmInputs());
        return result;
      });
    },
    diagnostics:()=>Object.fromEntries(Object.entries(videos).map(([s,v])=>[s,{width:v.videoWidth,height:v.videoHeight,time:v.currentTime,paused:v.paused,frames:v.getVideoPlaybackQuality?.()}]))};
  lcd.dispose=()=>{dropHeld();leaseStore?.dispose();choiceBackend?.dispose();choiceGpu=null;disposed=true;setActive(false);countdown.dispose();total.invalidate();if(jpFrame)jp.frame=jpFrame;window.removeEventListener('pointermove',move);window.removeEventListener('pointerdown',down,true);window.removeEventListener('keydown',key,true);window.removeEventListener('blur',blur);for(const v of Object.values(videos)){v.pause();v.removeAttribute('src');v.load();}base.dispose();};
  return lcd;
}
