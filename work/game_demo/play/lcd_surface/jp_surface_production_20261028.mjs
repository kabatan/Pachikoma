// v2: 数字・字は焼き込み済みの前面映像(allholes_v2)だけで再生する。実行時の描き足し(overlay)は無し。状況別の字は止めている(direction は空表)。
import {createJpSurface as createLegacyJpSurface} from './jp_surface_1029.mjs';
import {createSharedPalace} from './continuous_ryugu_bg_production_20261028.mjs';
import {createCenterReel} from './jp_center_v2.mjs';
import {chooseDirection,targetDigit} from './jp_direction_allholes_v1.mjs';
import {createJpDigits} from './jp_digits.mjs';
// All seven target holes; the palace decoder remains shared.
export function jpEffectSeconds(man, payout) {
  const names = ['jp_land_d4', 'jp_rush', 'jp_bridge', man.roulette[String(payout)], `reward_${payout}`];
  const selected=chooseDirection(man.directionTable??{defaults:{},rules:[]},'jp',{payout});
  return (names.reduce((n,k) => n + man.scenes[k].frames, 0)+(selected.forceGold?man.gold_frames:0)) / man.fps;
}
class OriginalJpTimeline {
  constructor(man, cue = () => {}) { this.man=man; this.cue=cue; this.active=false; this.clock=0; this.serial=0; }
  start(name) {
    if (!this.man.scenes[name]) { this.stop('missing:'+name); return; }
    this.name=name;this.time=0;this.lastF=-1;this.serial++;this.active=true;
  }
  stop(reason='end') { this.active=false;this.name=null;this.pending=null;this.cue({kind:'end',reason}); }
  onEvent(id,p={}) {
    if (id==='lamp6') {
      if(this.active&&this.payout>0)return true; // The next cycle must not restart an unfinished payout film.
      const pockets=p.after??p.pockets??[];const d=[1,2,3,4,5,6,7].find(x=>!pockets.includes(x));
      if (!this.man.digits.includes(d)) return false;
      this.d=d;this.payout=0;this.heat=0;this.flight=false;this.dim=false;this.delay=1;this.start('jp_intro');return true;
    }
    if (id==='fail' && (this.active || p.chain)) {
      this.payout=0;this.result={...p};this.d??=p.unlit?.[0]??4;this.earnings=p.jackpotEarnings??0;this.delay=0;this.flash='miss';this.flashAt=this.clock;
      this.start(this.earnings>0?'fail_chain':'fail_first');return true;
    }
    if (!this.active) return false;
    // A choice/result from the next round can already be waiting underneath.
    // Keep the current payout/reveal through its natural end.
    if(this.payout>0 && (p.chain || ['chain_choice','chain_continue','chain_stop'].includes(id)))return false;
    if (id==='challenge_flight' && !p.chain) { this.flight=true; this.pending=`${this.name==='jp_aim_d'+this.d?'fly_in':'fly_in_chance'}_d${this.d}`;return true; }
    if (id==='jp_heat' && !p.chain) {this.heat=Math.max(this.heat,Math.min(3,p.tier??0));if(this.name.startsWith('fly_t'))this.pending=`fly_t${this.heat}_d${this.d}`;return true;}
    if (id==='jp_mouth' && !p.chain) {this.delay=0;this.pending=null;this.start(`tame_${p.unlit?'hit':'miss'}_d${this.d}`);return true;}
    if (id==='jp' && !p.chain) {this.payout=p.payout??p.award;this.delay=0;this.pending=null;this.flash='hit';this.flashAt=this.clock;this.priorRank=this.cue({kind:'hold',payout:this.payout})??0;this.revealedAt=null;this.start(`jp_land_d${this.d}`);return true;}
    if (id==='timeup' && this.name===`jp_aim_d${this.d}`) {this.dim=true;return true;}
    if (id==='add100' && this.dim) {this.dim=false;return true;}
    if (['ticket','attract','finish_count','result','challenge_cancel'].includes(id)) {this.stop(id);return false;}
    if (['chain_continue','chain_stop'].includes(id) || p.chain && ['challenge_flight','jp'].includes(id)) {this.stop('continuation');return false;}
    return true;
  }
  update(dt,mediaTime=null) {
    this.clock+=dt;if(!this.active)return;
    if(this.delay>0){this.delay=Math.max(0,this.delay-dt);return;}
    const s=this.man.scenes[this.name];this.time=mediaTime??this.time+dt;
    let f=Math.min(s.frames-1,Math.floor(this.time*this.man.fps+1e-6));
    for(const c of s.cues??[])if(c.f>this.lastF&&c.f<=f){if(c.kind==='reveal')this.revealedAt=this.clock;this.cue({...c,payout:this.payout});}
    const crossed=(s.cut??[]).some(k=>k>this.lastF&&k<=f);
    const held=this.pending&&/fly_t3_/.test(this.pending)&&this.holdUntil>this.clock;   // 「入れ!!」は玉が口に届く予測時刻の少し前に出す
    if(this.pending && !held && (crossed||f===s.frames-1)) {const n=this.pending;this.pending=null;this.start(n);return;}
    if(f===s.frames-1 && this.time>=(s.frames-.1)/this.man.fps) {
      let n=s.next;
      if(n==='@roulette')n=this.man.roulette[String(this.payout)];
      if(n==='@reward')n=`reward_${this.payout}`;
      if(this.name.startsWith('fly_in'))n=`fly_t${this.heat}_d${this.d}`;
      if(n){this.start(n);return;}
      if(s.loop){this.time=(s.loop_from??0)/this.man.fps;this.lastF=(s.loop_from??0)-1;return;}
      if(this.name.startsWith('tame_')||this.name.startsWith('chain_tame_')) {this.lastF=f;return;}
      this.stop();return;
    }
    this.lastF=f;
  }
  where(){if(!this.active)return null;return {name:this.name,f:Math.max(0,this.lastF),time:this.time,serial:this.serial,dim:this.dim,delay:this.delay,flash:Math.max(0,1-(this.clock-this.flashAt)/.1),flashColor:this.flash,result:this.result,earnings:this.earnings};}
}
export class JpTimeline extends OriginalJpTimeline {
  constructor(man,cue=()=>{},getState=()=>({}),table=man.directionTable??{defaults:{},rules:[]},random=Math.random) {
    super(man,cue);this.getState=getState;this.table=table;this.chainStage=0;this.selections=[];this.random=random;
  }
  start(name) {
    if(name==='jp_intro'&&this.man.intro_variants?.length) {
      const names=this.man.intro_variants;
      name=names[Math.floor(this.random()*names.length)];
      this.introVariant=name;
    }
    super.start(name?.replace(/_d[1-7]$/, '_d'+(this.d??4)));
  }
  select(id,p={}) {
    const state=this.getState();
    const context={...state,d:this.d, isChain:!!this.chainMode,chainStage:this.chainStage??0,
      payout:p.payout??(id==='jp'?p.award:undefined)??this.payout??0,
      secondsLeft:p.secondsLeft??state.secondsLeft,balls:p.balls??state.balls,
      heat:Math.max(this.heat??0,p.tier??0)};
    const choice=chooseDirection(this.table,id,context);
    this.heat=Math.max(this.heat??0,choice.minHeat);
    if(choice.matched.length && !['launch'].includes(id)) {
      this.cutin={...choice,at:this.clock+Math.max(0,choice.delay??0),context};
      this.selections.push({event:id,...this.cutin});if(this.selections.length>100)this.selections.shift();
    }
    return choice;
  }
  onEvent(id,p={}) {
    // A fast player can choose/launch the next chain while the final reward
    // frames are still decoding. Retain those events until this film ends.
    if(this.active&&this.payout>0&&(id==='chain_continue'||p.chain&&['challenge_flight','jp_heat','jp_mouth','jp'].includes(id))) {
      this.queuedChainEvents??=[];this.queuedChainEvents.push([id,{...p}]);return false;
    }
    if(['ticket','attract','finish_count','result','challenge_cancel','chain_stop'].includes(id))this.queuedChainEvents=[];
    if(id==='lamp6'&&!(this.active&&this.payout>0)) {
      this.chainMode=false;this.chainStage=0;this.d=targetDigit(p,this.getState(),this.d);
      this.heat=0;this.payout=0;this.cutin=null;
      const handled=super.onEvent(id,p);this.select(id,p);return handled;
    }
    if((id==='chain_continue'||id==='challenge_wait'&&p.chain)&&!(this.active&&this.payout>0)) {
      this.chainMode=true;this.d=targetDigit(p,this.getState(),this.d);
      this.chainStage=p.chainStage??((typeof p.chain==='number'?p.chain:this.getState().chain?.successes??0)+1);
      this.payout=0;this.heat=0;this.dim=false;this.delay=0;this.pending=null;
      this.select('chain_continue',p);this.start(`chain_jp_aim_d${this.d}`);return true;
    }
    if(!this.active)return super.onEvent(id,p);
    // Keep the confirmed payout through its reveal, even when the game has
    // already entered the next choice screen beneath it.
    if(this.payout>0&&['lamp6','chain_continue','chain_choice','challenge_flight','jp_heat','jp_mouth','jp'].includes(id))return false;
    if(id==='challenge_flight') {
      this.d=targetDigit(p,this.getState(),this.d);this.chainStage=p.chainStage??this.chainStage;
      this.select(id,p);
      if(this.chainMode){this.pending=`chain_fly_in_d${this.d}`;return true;}
    }
    if(id==='jp_heat') {
      if(Math.min(3,p.tier??0)>=3&&this.heat<3&&Number.isFinite(p.eta)){this.holdUntil=this.clock+Math.max(0,p.eta-(this.man.t3_lead??.45));this.lastEta=p.eta;}
      this.select(id,p);this.heat=Math.max(this.heat,Math.min(3,Math.max(0,p.tier??0)));
      if(this.chainMode){if(this.name.startsWith('chain_fly_t'))this.pending=`chain_fly_t${this.heat}_d${this.d}`;return true;}
      p={...p,tier:this.heat};
    }
    if(this.chainMode&&id==='jp_mouth') {
      this.pending=null;this.start(`chain_tame_${p.unlit?'hit':'miss'}_d${this.d}`);return true;
    }
    if(id==='jp') {
      this.d=targetDigit({pockets:p.before,d:p.pocket??p.d}, {},this.d);
      const choice=this.select(id,p);this.pending=null;this.delay=0;
      if(this.chainMode){this.payout=p.payout??p.award;this.start(`chain_jp_${choice.forceGold?'gold':'land'}_d${this.d}`);return false;}
      const handled=super.onEvent(id,p);
      if(choice.forceGold)this.start(`jp_gold_d${this.d}`);
      return handled;
    }
    if(['warn10','launch'].includes(id)){this.select(id,p);return false;}
    return super.onEvent(id,p);
  }
  update(dt,mediaTime=null) {
    const before=this.name;super.update(dt,mediaTime);
    if(before?.startsWith('chain_fly_in')&&this.name?.startsWith('chain_fly_t'))this.start(`chain_fly_t${this.heat}_d${this.d}`);
    if(!this.active&&this.queuedChainEvents?.length){const events=this.queuedChainEvents;this.queuedChainEvents=[];for(const [id,p] of events)this.onEvent(id,p);}
  }
  where(){const w=super.where();return w?{...w,d:this.d,heat:this.heat,isChain:!!this.chainMode,chainStage:this.chainStage,cutin:this.cutin,clock:this.clock,introVariant:this.introVariant}:null;}
}
export async function createJpSurface({manifestUrl,onCue=()=>{},log=()=>{},getState=()=>({})}) {
  const res=await fetch(manifestUrl);if(!res.ok)throw new Error('JP manifest HTTP '+res.status);
  const man=await res.json(),base=new URL('.',manifestUrl);if(!man.background_layer)return createLegacyJpSurface({manifestUrl,onCue,log});
  const lightRes=await fetch(new URL(man.lights,base));if(!lightRes.ok)throw new Error('JP lights HTTP '+lightRes.status);
  const lights=await lightRes.json();const cmeta=man.center?await(await fetch(new URL(man.center.meta,base))).json():null;const center=cmeta?createCenterReel(cmeta):null;const palace=await createSharedPalace({base,config:man.background_layer,onError:e=>console.error('[palace]',e),center:cmeta?{F:man.center.F,T:man.center.T,meta:cmeta}:null});const digits=man.fail_slots?await createJpDigits(base,man.fail_slots):null;
  const slots=Array.from({length:3},()=>{const v=document.createElement('video');v.muted=true;v.playsInline=true;v.preload='auto';return{v,name:null,ready:false,promise:null};});
  man.directionTable=await (await fetch(new URL(man.direction,base))).json();
  const model=new JpTimeline(man,onCue,getState);let manual=false,current=null,serial=-1,errors=[],hole=null,visible=null,previous=null,fade=1;
  const lifecycle=[];const record=(kind,data={})=>{lifecycle.push({kind,wall:performance.now(),...data});if(lifecycle.length>1000)lifecycle.shift();};
  const load=(slot,name)=>{
    if(!name||!man.scenes[name])return Promise.resolve();
    if(slot.name===name)return slot.promise??Promise.resolve();
    slot.cancel?.();slot.v.pause();slot.name=name;slot.ready=false;
    const at=performance.now();record('load',{name});
    slot.promise=new Promise(resolve=>{
      const cleanup=()=>{clearTimeout(timer);slot.v.removeEventListener('loadeddata',done);slot.v.removeEventListener('error',bad);slot.cancel=null;};
      const done=()=>{cleanup();slot.ready=slot.v.readyState>=2;record('decoded',{name,ms:performance.now()-at});resolve();};
      const bad=()=>{cleanup();errors.push(name+':video');record('error',{name});resolve();if(model.active&&model.name===name)model.stop('video_error');};
      const timer=setTimeout(bad,8000);slot.cancel=()=>{cleanup();resolve();};slot.v.addEventListener('loadeddata',done,{once:true});slot.v.addEventListener('error',bad,{once:true});
      slot.v.src=new URL(man.scenes[name].file,base).href;slot.v.load();
    });return slot.promise;
  };
  const reserve=(name)=>{let slot=slots.find(s=>s.name===name);if(!slot){slot=slots.find(s=>s!==current&&s!==visible&&s!==previous&&s.name===null)??slots.find(s=>s!==current&&s!==visible&&s!==previous);if(slot)load(slot,name);}return slot;};
  function sync(){
    if(!model.active){for(const s of slots)s.v.pause();return;}
    if(serial!==model.serial){current=reserve(model.name);if(!current)return;serial=model.serial;hole=null;if(current.ready)current.v.currentTime=0;record('request',{name:model.name});log(model.name);}
    const s=man.scenes[model.name];
    if(current?.ready&&model.delay<=0){
      if(visible!==current){previous=visible;visible=current;fade=previous?0:1;record('start',{name:current.name});}
      if(!manual&&current.v.paused&&!current.v.ended)current.v.play().catch(()=>{});
    }
    const next=model.pending??(model.name.startsWith('fly_t')?`fly_t${Math.min(3,model.heat+1)}_d${model.d}`:s.next==='@roulette'?man.roulette[String(model.payout)]:s.next==='@reward'?`reward_${model.payout}`:s.next);
    if(next)reserve(next);
  }
  const cue=model.cue;model.cue=c=>{if(c.kind==='hole')hole=c;return cue(c);};
  const stop=model.stop.bind(model);model.stop=reason=>{record('end',{name:model.name,reason:reason??'end',time:model.time});return stop(reason);};
  return {man,model,get center(){return center;},get active(){return model.active&&model.delay<=0;},get claimed(){return model.active;},
    onEvent(id,p){
      if(center&&id==='jp_mouth'&&p.phase==='cup'){center.settle(p.cup,!!p.unlit);return true;}   // 入った穴で止め直すだけ(場面は動かさない)
      const sustaining=model.active&&model.payout>0;const handled=model.onEvent(id,p);
      if(center){
        if(id==='lamp6'||id==='chain_continue'||id==='challenge_wait'&&p.chain){center.begin();center.aim(model.d);}
        else if(id==='challenge_flight')center.aim(model.d);
        else if(id==='jp_heat'&&p.probs)center.probs(p.probs);
        else if(id==='jp_mouth')center.settle(p.cup??model.d,!!p.unlit);
      }if(id==='fail')digits?.prepare(p.jackpotEarnings??0);if(id==='lamp6'&&handled&&!sustaining){reserve(`fly_in_d${model.d}`);}sync();return handled&&(id!=='lamp6'||sustaining);},
    setManual(on){manual=!!on;palace.setManual(on);for(const s of slots)s.v.pause();},
    async prepare(dt){await palace.prepare(dt);sync();if(!manual||!current||model.delay>0)return;await current.promise;if(!current.ready)return;const t=Math.min(model.time+dt,(man.scenes[model.name].frames-.1)/man.fps);if(Math.abs(current.v.currentTime-t)<1e-5)return;await new Promise(resolve=>{const done=()=>{clearTimeout(timer);current?.v.removeEventListener('seeked',done);resolve();};const timer=setTimeout(done,2000);current.v.addEventListener('seeked',done,{once:true});current.v.currentTime=t;});},
    frame(dt){palace.advance(dt);sync();const oldTime=model.time;model.update(current?.ready||model.delay>0?dt:0,manual||model.delay>0?null:current?.ready?current.v.currentTime:model.time);if(current&&model.active&&model.serial===serial&&model.time<oldTime){current.v.currentTime=model.time;if(!manual)current.v.play().catch(()=>{});}sync();if(previous){fade=Math.min(1,fade+Math.min(dt,1/30)/.12);if(fade>=1){previous.v.pause();record('end',{name:previous.name,reason:'crossfade',time:previous.v.currentTime});previous=null;}}if(model.active&&visible?.ready&&man.scenes[visible.name]?.layered){const prior=previous&&man.scenes[previous.name]?.layered?previous.v:null;const vs=man.scenes[visible.name],lf=visible.name===model.name?model.lastF:Math.floor(visible.v.currentTime*man.fps);return palace.render(visible.v,prior,1-fade,visible.name,lf,center&&vs.center?center.stateFor(vs.source_frames[Math.max(0,Math.min(vs.frames-1,lf))],vs,dt):null);}palace.hidden();return visible?.ready?visible.v:null;},
    get layered(){return !!man.scenes[model.name]?.layered;},get palace(){return palace;},
    get transition(){if(man.scenes[model.name]?.layered)return null;return previous?{video:man.scenes[previous.name]?.layered?palace.canvas:previous.v,alpha:1-fade}:null;},get lifecycle(){return lifecycle;},
    where:()=>model.where(),drawDigits(ctx){const w=model.where();if(w)digits?.draw(ctx,w);},
    applyLights(F){const w=model.where();if(!w||model.delay>0)return false;const rows=lights[man.scenes[w.name]?.lights_key??w.name],lf=w.f+(man.scenes[w.name]?.lights_from??0);if(rows?.length)F.m3={...rows[Math.min(rows.length-1,lf)],hole:{...rows[Math.min(rows.length-1,lf)].hole,...hole}};
      if(F.m3){F.m3.jp1029=true;F.m3.hole={...F.m3.hole,cup:model.d};}
      if(model.payout>0&&F.m3){if(F.seg)F.seg.meter=[0,0,0,0,0];F.m3.meterLimit=model.revealedAt==null?(model.priorRank??0):(model.priorRank??0)+Math.ceil((model.clock-model.revealedAt)/.15);}
      if(w.name.startsWith('fail')&&w.result?.near_miss&&w.f<12&&F.m3)F.m3.hole={mode:'near_miss',cup:w.result.target,rgb:[.45,.35,.6],gain:Math.sin(Math.PI*w.f/12)};return true;},
    diagnostics(){return [palace.diagnostics(),...slots.map(s=>({name:s.name,ready:s.ready,paused:s.v.paused,dimensions:[s.v.videoWidth,s.v.videoHeight],time:s.v.currentTime,video:(()=>{const q=s.v.getVideoPlaybackQuality?.();return q?{totalVideoFrames:q.totalVideoFrames,droppedVideoFrames:q.droppedVideoFrames}:null;})()}))];},get errors(){return errors;},
    dispose(){palace.dispose();digits?.dispose();model.stop('dispose');for(const s of slots){s.cancel?.();s.v.pause();s.v.removeAttribute('src');s.v.load();}},
  };
}
