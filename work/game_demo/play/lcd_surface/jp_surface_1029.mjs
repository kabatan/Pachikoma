import {createJpDigits} from './jp_digits.mjs';
// First JP only. Existing continuation screens retain their original owner.
export function jpEffectSeconds(man, payout) {
  const names = ['jp_land_d4', 'jp_rush', 'jp_bridge', man.roulette[String(payout)], `reward_${payout}`];
  return names.reduce((n,k) => n + man.scenes[k].frames, 0) / man.fps;
}
export class JpTimeline {
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
    if (id==='jp_heat' && !p.chain) {this.heat=Math.max(this.heat,p.tier??0);if(this.name.startsWith('fly_t'))this.pending=`fly_t${this.heat}_d${this.d}`;return true;}
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
    if(this.pending && (crossed||f===s.frames-1)) {const n=this.pending;this.pending=null;this.start(n);return;}
    if(f===s.frames-1 && this.time>=(s.frames-.1)/this.man.fps) {
      let n=s.next;
      if(n==='@roulette')n=this.man.roulette[String(this.payout)];
      if(n==='@reward')n=`reward_${this.payout}`;
      if(this.name.startsWith('fly_in'))n=`fly_t${this.heat}_d${this.d}`;
      if(n){this.start(n);return;}
      if(s.loop){this.time=(s.loop_from??0)/this.man.fps;this.lastF=(s.loop_from??0)-1;return;}
      if(this.name.startsWith('tame_')) {this.lastF=f;return;}
      this.stop();return;
    }
    this.lastF=f;
  }
  where(){if(!this.active)return null;return {name:this.name,f:Math.max(0,this.lastF),time:this.time,serial:this.serial,dim:this.dim,delay:this.delay,flash:Math.max(0,1-(this.clock-this.flashAt)/.1),flashColor:this.flash,result:this.result,earnings:this.earnings};}
}
export async function createJpSurface({manifestUrl,onCue=()=>{},log=()=>{}}) {
  const res=await fetch(manifestUrl);if(!res.ok)throw new Error('JP manifest HTTP '+res.status);
  const man=await res.json(),base=new URL('.',manifestUrl);
  const lightRes=await fetch(new URL(man.lights,base));if(!lightRes.ok)throw new Error('JP lights HTTP '+lightRes.status);
  const lights=await lightRes.json();const digits=man.fail_slots?await createJpDigits(base,man.fail_slots):null;
  const slots=Array.from({length:3},()=>{const v=document.createElement('video');v.muted=true;v.playsInline=true;v.preload='auto';return{v,name:null,ready:false,promise:null};});
  const model=new JpTimeline(man,onCue);let manual=false,current=null,serial=-1,errors=[],hole=null,visible=null,previous=null,fade=1;
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
  return {man,model,get active(){return model.active&&model.delay<=0;},get claimed(){return model.active;},
    onEvent(id,p){const sustaining=model.active&&model.payout>0;const handled=model.onEvent(id,p);if(id==='fail')digits?.prepare(p.jackpotEarnings??0);if(id==='lamp6'&&handled&&!sustaining){reserve(`fly_in_d${model.d}`);}sync();return handled&&(id!=='lamp6'||sustaining);},
    setManual(on){manual=!!on;for(const s of slots)s.v.pause();},
    async prepare(dt){sync();if(!manual||!current||model.delay>0)return;await current.promise;if(!current.ready)return;const t=Math.min(model.time+dt,(man.scenes[model.name].frames-.1)/man.fps);if(Math.abs(current.v.currentTime-t)<1e-5)return;await new Promise(resolve=>{const done=()=>{clearTimeout(timer);current?.v.removeEventListener('seeked',done);resolve();};const timer=setTimeout(done,2000);current.v.addEventListener('seeked',done,{once:true});current.v.currentTime=t;});},
    frame(dt){sync();const oldTime=model.time;model.update(current?.ready||model.delay>0?dt:0,manual||model.delay>0?null:current?.ready?current.v.currentTime:model.time);if(current&&model.active&&model.serial===serial&&model.time<oldTime){current.v.currentTime=model.time;if(!manual)current.v.play().catch(()=>{});}sync();if(previous){fade=Math.min(1,fade+Math.min(dt,1/30)/.12);if(fade>=1){previous.v.pause();record('end',{name:previous.name,reason:'crossfade',time:previous.v.currentTime});previous=null;}}return visible?.ready?visible.v:null;},
    get transition(){return previous?{video:previous.v,alpha:1-fade}:null;},get lifecycle(){return lifecycle;},
    where:()=>model.where(),drawDigits(ctx){const w=model.where();if(w)digits?.draw(ctx,w);},
    applyLights(F){const w=model.where();if(!w||model.delay>0)return false;const rows=lights[w.name];if(rows?.length)F.m3={...rows[Math.min(rows.length-1,w.f)],hole:{...rows[Math.min(rows.length-1,w.f)].hole,...hole}};
      if(F.m3)F.m3.jp1029=true;
      if(model.payout>0&&F.m3){if(F.seg)F.seg.meter=[0,0,0,0,0];F.m3.meterLimit=model.revealedAt==null?(model.priorRank??0):(model.priorRank??0)+Math.ceil((model.clock-model.revealedAt)/.15);}
      if(w.name.startsWith('fail')&&w.result?.near_miss&&w.f<12&&F.m3)F.m3.hole={mode:'near_miss',cup:w.result.target,rgb:[.45,.35,.6],gain:Math.sin(Math.PI*w.f/12)};return true;},
    diagnostics(){return slots.map(s=>({name:s.name,ready:s.ready,paused:s.v.paused,dimensions:[s.v.videoWidth,s.v.videoHeight],time:s.v.currentTime,video:(()=>{const q=s.v.getVideoPlaybackQuality?.();return q?{totalVideoFrames:q.totalVideoFrames,droppedVideoFrames:q.droppedVideoFrames}:null;})()}));},get errors(){return errors;},
    dispose(){digits?.dispose();model.stop('dispose');for(const s of slots){s.cancel?.();s.v.pause();s.v.removeAttribute('src');s.v.load();}},
  };
}
