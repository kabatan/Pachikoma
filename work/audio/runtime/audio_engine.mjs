import { BgmPlayer } from './bgm_player.mjs';
import { EVENTS, CUES, GROUP_CAPS, GLOBAL_CAP } from './catalog.mjs';
import { modalSamples } from './modal_core.mjs';
import { payoutSamples } from './physical_grains.mjs';
import { winPlan, createWinSound } from './win_sound.mjs';
import { VOICE_FILES, voiceForEvent } from './voice_catalog.mjs';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export class AudioEngine {
  constructor({ context=null, base=new URL('../sfx/',import.meta.url), master=.45, autoTick=true, voiceProvider='amitaro',legacy=false,modalSynth=modalSamples,jpPrewarmEvents=[],bgmEnabled=false,bgmVolume=.65,bgmManifest,onBgmError=console.error,getPhase=()=>null }={}) {
    const AC=globalThis.AudioContext||globalThis.webkitAudioContext;
    this.ctx=context||new AC({sampleRate:48000,latencyHint:'interactive'}); this.base=base;this.getPhase=getPhase;this.legacy=legacy;this.modalSynth=modalSynth;this.jpPrewarmEvents=jpPrewarmEvents.map(event=>({...event}));
    this.buffers=new Map(); this.voices=[]; this.last=new Map(); this.pending=new Map(); this.cache=new Map();
    this.duckTargets=new WeakMap();this.automationStats={scheduled:0,skipped:0};
    this.winCache=new Map();this.winLog=[];this.winTiming=null;this.bgmPlaying=false;this.sequence=0; this.stats={played:0,dropped:0,merged:0,maxVoices:0,unknown:0};
    this.voiceBuffers=new Map();this.voiceProvider=Object.hasOwn(VOICE_FILES,voiceProvider)?voiceProvider:'off';
    this.voicePending=null;this.voiceLastStart=-Infinity;this.voiceLog=[];this.voiceStats={played:0,suppressed:0,replaced:0};this.payoutPending=0;this.lastPayout=-Infinity;this.payoutSequence=0;this.payoutCache=new Map();
    this.physicalTokens=4;this.physicalTokenAt=this.ctx.currentTime;
    this.sfx=this.ctx.createGain(); this.physical=this.ctx.createGain(); this.bgmInput=this.ctx.createGain();
    this.voice=this.ctx.createGain();this.win=this.ctx.createGain();
    this.mix=this.ctx.createGain(); this.sfx.connect(this.mix); this.physicalHP=this.ctx.createBiquadFilter();this.physicalHP.type='highpass';this.physicalHP.frequency.value=3000;this.physicalHP.Q.value=.5;this.physical.connect(this.physicalHP).connect(this.mix); this.bgmInput.connect(this.mix);
    this.voice.connect(this.mix);this.win.connect(this.mix);
    this.hp=this.ctx.createBiquadFilter(); this.hp.type='highpass'; this.hp.frequency.value=40; this.hp.Q.value=.5;
    this.lp=this.ctx.createBiquadFilter(); this.lp.type='lowpass'; this.lp.frequency.value=14000; this.lp.Q.value=.5;
    this.comp=this.ctx.createDynamicsCompressor(); Object.assign(this.comp.threshold,{value:-12});
    this.comp.knee.value=8; this.comp.ratio.value=8; this.comp.attack.value=.003; this.comp.release.value=.15;
    this.master=this.ctx.createGain(); this.master.gain.value=clamp(master,0,1);
    this.ceiling=this.ctx.createWaveShaper(); this.ceiling.curve=Float32Array.from({length:8193},(_,i)=>.80*Math.tanh(2*(i/4096-1))); this.ceiling.oversample='4x';
    this.analyser=this.ctx.createAnalyser(); this.analyser.fftSize=2048;
    this.mix.connect(this.hp).connect(this.lp).connect(this.comp).connect(this.master).connect(this.ceiling).connect(this.analyser).connect(this.ctx.destination);
    this.bgm=new BgmPlayer(this.ctx,this.bgmInput,{enabled:bgmEnabled,volume:bgmVolume,manifestUrl:bgmManifest,onError:onBgmError,onPlaying:value=>this.setBgmPlaying(value)});
    // BGM読込失敗はSE/声のreadyを妨げない。再読込APIはエラーを呼出元へ返す。
    this.bgm.ready.catch(()=>{});
    this.ready=this.load();
    if(autoTick) this.timer=setInterval(()=>this.flush(),20);
    if(new URLSearchParams(globalThis.location?.search??'').get('audiotrace')==='1')this._installTrace();
  }
  // ?audiotrace=1: 発火の記録(QA用)。window.__audioTrace に最新 4000 件。event=受けた合図と結果、play=engine._play の受理/打ち切り(group/priority/長さ)、out=出力レベル(0.1秒ごとのピーク)。音は変えない。
  _installTrace() {
    const log=this.trace=[],ctx=this.ctx,push=r=>{log.push({t:+ctx.currentTime.toFixed(3),...r});if(log.length>4000)log.splice(0,1000);};
    const h0=this.handleEvent.bind(this),p0=this._play.bind(this);
    this.handleEvent=e=>{const s0={...this.stats},r=h0(e);push({k:'event',id:e.id,ok:r,merged:this.stats.merged-s0.merged,unknown:this.stats.unknown-s0.unknown});return r;};
    this._play=(buffer,spec,o)=>{const d0=this.stats.dropped,ok=p0(buffer,spec,o);push({k:'play',g:spec.group,pr:spec.priority,ok,nobuf:!buffer,dur:buffer?+buffer.duration.toFixed(2):null});return ok;};
    const buf=new Float32Array(this.analyser.fftSize);let pk=0;
    this.traceTimer=setInterval(()=>{this.analyser.getFloatTimeDomainData(buf);for(const x of buf)pk=Math.max(pk,Math.abs(x));},20);
    this.traceTimer2=setInterval(()=>{push({k:'out',pk:+pk.toFixed(4),st:ctx.state});pk=0;},100);
    globalThis.__audioTrace=log;
  }
  async load() {
    await Promise.all(CUES.filter(name=>!this.legacy||(name!=='payout'&&!name.startsWith('win_'))).map(async name=>{
      const r=await fetch(new URL(name+'.wav',this.base)); if(!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
      this.buffers.set(name,await this.ctx.decodeAudioData(await r.arrayBuffer()));
    }));
    if(this.voiceProvider!=='off')await Promise.all(Object.keys(VOICE_FILES).map(p=>this._loadVoice(p)));   // 声オフなら声素材を読まない(公開版は声素材を同梱しない)。後から声を有効にしたときは setVoiceProvider が読む
    const timing=await fetch(new URL('./win_timing.json',import.meta.url));if(!timing.ok)throw new Error('win timing HTTP '+timing.status);this.winTiming=await timing.json();
    if(!this.legacy)this._primeEventBuffers();
    return this;
  }
  _primeEventBuffers() {
    const cacheWin=event=>{
      const plan=winPlan(event,this.winTiming);if(!plan)return;
      const key=plan.id+':'+plan.duration;
      if(!this.winCache.has(key))this.winCache.set(key,createWinSound(this.ctx,this.buffers,this.winTiming,plan));
    };
    cacheWin({id:'success_small'}); cacheWin({id:'success_big'}); cacheWin({id:'jp'});
    for(const duration of this.winTiming.jp_variants_s??[])cacheWin({id:'jp',data:{duration}});
    let additionalWinBytes=0;
    for(const data of this.jpPrewarmEvents){
      try{
        const event={id:'jp',data},plan=winPlan(event,this.winTiming);
        if(!plan||this.winCache.has(plan.id+':'+plan.duration)||this.winCache.size>=12)continue;
        const bytes=Math.round(plan.duration*this.ctx.sampleRate)*2*4;
        if(additionalWinBytes+bytes>16*1024*1024)continue;
        cacheWin(event);additionalWinBytes+=bytes;
      }catch{break;}
    }
    for(let n=1;n<=8;n++) {
      const samples=payoutSamples(n,this.ctx.sampleRate),buffer=this.ctx.createBuffer(2,samples[0].length,this.ctx.sampleRate);
      buffer.copyToChannel(samples[0],0);buffer.copyToChannel(samples[1],1);this.payoutCache.set(n,buffer);
    }
  }
  async unlock() { await this.ctx.resume(); await this.ready; }
  setMaster(value) { this.master.gain.setTargetAtTime(clamp(Number(value)||0,0,1),this.ctx.currentTime,.025); }
  setBgmEnabled(value) {return this.bgm.setEnabled(value);}
  setBgmVolume(value) {this.bgm.setVolume(value);}
  setBgmMuted(value) {this.bgm.setMuted(value);}
  reloadBgmManifest(url) {return this.bgm.reload(url);}
  setBgmPlaying(value) {const next=!!value;if(next===this.bgmPlaying)return;this.bgmPlaying=next;this._duck();}
  _retire(v,now=this.ctx.currentTime) {
    if(v.retired) return; v.retired=true;
    const end=now+.008; v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(v.level,now); v.gain.gain.linearRampToValueAtTime(0,end);
    v.src.stop(Math.max(end,v.start+.001)); v.end=Math.max(end,v.start+.001);
  }
  stopGroup(group) { const now=this.ctx.currentTime; this.voices.filter(v=>v.group===group).forEach(v=>this._retire(v,now)); }
  stopAll() { this.bgm?.stop();this.pending.clear();this.voicePending=null;this.payoutPending=0; this.voices.forEach(v=>this._retire(v)); this.last.clear(); }
  setVoiceProvider(provider) {
    if(provider!=='off'&&!Object.hasOwn(VOICE_FILES,provider))throw new Error('unknown voice provider');
    this.voicePending=null;this.stopGroup('voice');this.voiceProvider=provider;
    return this._loadVoice(provider).catch(e=>console.error('[r2-audio] voice',e));   // 切替先を初回だけ読む
  }
  async _loadVoice(provider) {
    await Promise.all(Object.entries(VOICE_FILES[provider]??{}).filter(([key])=>!this.voiceBuffers.has(provider+':'+key)).map(async([key,file])=>{
      const r=await fetch(new URL('../voice/'+file,import.meta.url));if(!r.ok)throw new Error(`voice ${file}: HTTP ${r.status}`);
      this.voiceBuffers.set(provider+':'+key,await this.ctx.decodeAudioData(await r.arrayBuffer()));
    }));
  }
  requestVoice({key,priority=2,delay=.3,eventId='manual'}) {
    const now=this.ctx.currentTime,due=now+Math.max(0,Math.min(3,delay));
    if(this.voiceProvider==='off'||due<this.voiceLastStart+12||this.voices.some(v=>v.group==='voice'&&!v.retired&&v.end>now)) {this.voiceStats.suppressed++;return false;}
    if(this.voicePending) {
      if(this.voicePending.priority>=priority){this.voiceStats.suppressed++;return false;}
      this.voiceStats.replaced++;
    }
    this.voicePending={key,priority,due,eventId,expires:due+.5};return true;
  }
  _voiceTick() {
    const v=this.voicePending,now=this.ctx.currentTime;if(!v||now<v.due)return;
    this.voicePending=null;
    if(now>v.expires||now<this.voiceLastStart+12){this.voiceStats.suppressed++;return;}
    const accepted=this._play(this.voiceBuffers.get(this.voiceProvider+':'+v.key),{group:'voice',priority:v.priority,max:1,gain:.8});
    if(accepted){this.voiceLastStart=this.voices.at(-1).start;this.voiceStats.played++;this.voiceLog.push({t:this.voiceLastStart,key:v.key,provider:this.voiceProvider,eventId:v.eventId});if(this.voiceLog.length>64)this.voiceLog.shift();}
    else this.voiceStats.suppressed++;
  }
  _play(buffer,spec,{rate=1,pan=0,gain=1}={}) {
    if(!buffer) {this.stats.dropped++;return false;}
    const now=this.ctx.currentTime; this.voices=this.voices.filter(v=>v.end>now);
    const live=this.voices.filter(v=>!v.retired);
    const same=live.filter(v=>v.group===spec.group), cap=GROUP_CAPS[spec.group]??spec.max;
    let start=now+.002;
    const victims=[];
    if(same.length>=cap) {
      const eligible=same.filter(v=>v.priority<=spec.priority).sort((a,b)=>a.priority-b.priority||a.start-b.start);
      if(!eligible.length) {this.stats.dropped++;return false;}
      victims.push(eligible[0]);
    }
    if(live.length-victims.length>=GLOBAL_CAP) {
      const lower=live.filter(v=>!victims.includes(v)&&v.priority<spec.priority).sort((a,b)=>a.priority-b.priority||a.start-b.start);
      if(!lower.length) {this.stats.dropped++;return false;}
      victims.push(lower[0]);
    }
    for(const v of victims) {this._retire(v,now);start=Math.max(start,v.end+.002);}
    // 以前のフェード尾も含めた枠。連打で予約音を何度も奪って発音数を膨らませない。
    while(this.voices.filter(v=>v.start<=start&&v.end>start).length>=GLOBAL_CAP) {
      start=Math.min(...this.voices.filter(v=>v.end>start).map(v=>v.end))+.002;
      if(start-now>.03) {this.stats.dropped++;return false;}
    }
    const src=this.ctx.createBufferSource(), volume=this.ctx.createGain(), panner=this.ctx.createStereoPanner();
    const level=spec.gain*gain; src.buffer=buffer; src.playbackRate.value=rate; src.loop=!!spec.loop; panner.pan.value=clamp(pan,-.75,.75);
    volume.gain.setValueAtTime(0,start); volume.gain.linearRampToValueAtTime(level,start+.004);
    const end=spec.loop?Infinity:start+buffer.duration/rate;
    if(!spec.loop) {volume.gain.setValueAtTime(level,Math.max(start+.004,end-.012));volume.gain.linearRampToValueAtTime(0,end);}
    src.connect(volume).connect(panner).connect((spec.group==='physical'||spec.group==='payout')?this.physical:spec.group==='voice'?this.voice:spec.winPlan?this.win:this.sfx);
    const v={src,gain:volume,level,start,end,group:spec.group,priority:spec.priority,winPlan:spec.winPlan??null,retired:false};
    src.onended=()=>{src.disconnect();volume.disconnect();panner.disconnect();this.voices=this.voices.filter(x=>x!==v);};
    this.voices.push(v); src.start(start);
    this.stats.played++; this.stats.maxVoices=Math.max(this.stats.maxVoices,this.voices.filter(v=>v.start<=start&&v.end>start).length);
    this._duck(); return true;
  }
  // 20msごとの同値予約を蓄積しない。状態が変わる時だけ、現在値から新しい目標へ。
  _duckTarget(param,value,now,timeConstant,linear=false) {
    if(this.duckTargets.get(param)===value){this.automationStats.skipped++;return;}
    this.duckTargets.set(param,value);this.automationStats.scheduled++;
    param.cancelAndHoldAtTime(now);
    if(linear)param.linearRampToValueAtTime(value,now+.004);
    else param.setTargetAtTime(value,now,timeConstant);
  }
  _duck() {
    const now=this.ctx.currentTime, p=Math.max(0,...this.voices.filter(v=>!v.retired&&v.end>now).map(v=>v.priority));
    const speaking=this.voices.some(v=>v.group==='voice'&&!v.retired&&v.end>now);
    const winner=this.voices.find(v=>v.winPlan&&!v.retired&&v.end>now),jp=winner?.winPlan.id==='jp';
    const elapsed=winner?now-winner.start:0,numberHit=jp&&elapsed>=winner.winPlan.payoutAt&&elapsed<winner.winPlan.payoutAt+.45;
    const handoff=jp&&this.bgmPlaying&&elapsed>winner.winPlan.announcementEnd&&!numberHit;
    this._duckTarget(this.win.gain,(speaking?.6:1)*(handoff?.32:1),now,.012);
    this._duckTarget(this.sfx.gain,(speaking?.6:1)*(winner?(jp?.20:.35):1),now,.012);
    const physical=winner?(jp?.18:.25):p>=4?.55:.65;
    this._duckTarget(this.physical.gain,speaking?Math.min(.4,physical):physical,now,.018);
    let bgm=this.voices.some(v=>!v.retired&&(v.group==='roulette'||v.group==='lamp'&&v.priority>=4))?10**(-5/20):1;
    if(winner){const plan=winner.winPlan;bgm=jp?(elapsed<=plan.impactAt+.12?0:elapsed<plan.announcementEnd?.18:numberHit?.28:1):(.28);}
    this._duckTarget(this.bgmInput.gain,bgm*(speaking?.22:1),now,.018,bgm===0);
  }
  handleEvent(e) {
    if(e.state?.phase==='Fault'||e.id==='fault'){this.stopAll();return false;}
    const isWin=!this.legacy&&['success_small','success_big','jp'].includes(e.id);
    if(e.id==='attract')this.stopAll();
    if(!isWin)this.bgm.handleEvent(e);
    if(!Object.hasOwn(EVENTS,e.id)) {this.stats.unknown++;return false;}
    if(e.id==='attract') return false;
    if(['challenge_flight','roulette','fail','timeup'].includes(e.id))this.voicePending=null;
    const speech=voiceForEvent(e);if(speech)this.requestVoice({...speech,eventId:e.id});
    if(['ascend','success_small','success_big','fail','jp','timeup','finish_count','result'].includes(e.id)) this.stopGroup('roulette');
    if(['challenge_cancel','success_small','success_big','fail','jp','timeup','finish_count','result'].includes(e.id)) this.stopGroup('focus');
    if(e.id==='result') this.stopGroup('counter');
    let spec=EVENTS[e.id]; if(!spec) return false;
    if(e.id==='lamp123') spec={...spec,cue:'lamp'+clamp(e.state?.lit||e.data?.n||1,1,3)};
    if(e.id==='roulette'&&this.voices.some(v=>v.group==='roulette'&&!v.retired)) {this.stats.merged++;return false;}
    const now=this.ctx.currentTime, key=spec.group+':'+spec.cue;
    if(now-(this.last.get(key)??-99)<spec.cooldown) {this.stats.merged++;return false;}
    this.last.set(key,now);
    let buffer=this.buffers.get(spec.cue);
    if(!this.legacy&&['success_small','success_big','jp'].includes(e.id)){
      const plan=winPlan(e,this.winTiming),key=plan.id+':'+plan.duration;
      if(!this.winCache.has(key)){if(this.winCache.size>=12)this.winCache.delete(this.winCache.keys().next().value);this.winCache.set(key,createWinSound(this.ctx,this.buffers,this.winTiming,plan));}
      buffer=this.winCache.get(key);spec={...spec,winPlan:plan};
    }
    const accepted=this._play(buffer,spec,{rate:e.id==='dup_protect'?[1,2,.5][this.sequence++%3]:1});
    if(accepted&&spec.winPlan){this.bgm.handleEvent(e,{...spec.winPlan,startAt:this.voices.at(-1).start});this.winLog.push({t:this.voices.at(-1).start,...spec.winPlan});if(this.winLog.length>32)this.winLog.shift();}
    return accepted;
  }
  contact(c) {
    if(!Number.isFinite(c.speed)||!Number.isFinite(c.impulse)||c.speed<.045||c.impulse<.000025) return false;
    const key=c.region+':'+c.material+':'+Math.round(clamp(c.x||0,-.2,.2)*10);
    const old=this.pending.get(key);
    if(old) {old.impulse=Math.min(.05,old.impulse+c.impulse);old.speed=Math.max(old.speed,c.speed);old.count++;this.stats.merged++;}
    else this.pending.set(key,{...c,count:1});
    return true;
  }
  payout(count=1) { if(!this.legacy&&Number.isFinite(count)&&count>0)this.payoutPending=Math.min(100,this.payoutPending+count); }
  _modal(c) {
    const quant={...c,speed:Math.round(clamp(c.speed,.05,5)*10)/10,impulse:Math.round(clamp(c.impulse,0,.05)*2000)/2000,variant:(c.variant??0)%7};
    const key=[quant.material,quant.speed,quant.impulse,quant.variant].join(':');
    if(!this.cache.has(key)) {
      const s=this.modalSynth(quant,this.ctx.sampleRate), b=this.ctx.createBuffer(1,s.length,this.ctx.sampleRate); b.copyToChannel(s,0);
      if(this.cache.size>=96) this.cache.delete(this.cache.keys().next().value); this.cache.set(key,b);
    }
    return this.cache.get(key);
  }
  flush() {
    if(this.getPhase()==='Fault'){this.stopAll();return;}
    this.bgm.tick();this._voiceTick();
    const now=this.ctx.currentTime;
    if(this.payoutPending&&now-this.lastPayout>=.12){
      const count=this.payoutPending;this.payoutPending=0;this.lastPayout=now;
      const n=Math.max(1,Math.min(8,Math.round(count)));
      if(!this.payoutCache.has(n)) {
        const s=payoutSamples(n,this.ctx.sampleRate),b=this.ctx.createBuffer(2,s[0].length,this.ctx.sampleRate);
        s.forEach((v,k)=>b.copyToChannel(v,k));this.payoutCache.set(n,b);
      }
      this._play(this.payoutCache.get(n),{group:'payout',priority:2,max:2,gain:.25});
    }
    // 最大8種類の接触群/20ms、強い衝突を優先。数の増加は強さに圧縮して反映。
    const contacts=[...this.pending.values()].sort((a,b)=>b.impulse-a.impulse);this.pending.clear();
    // Smooth 68/s refill + 4 burst tokens: <=72 starts in any one-second window.
    this.physicalTokens=Math.min(4,this.physicalTokens+Math.max(0,now-this.physicalTokenAt)*68);
    this.physicalTokenAt=now;
    const available=Math.min(8,Math.floor(this.physicalTokens));
    for(const c of contacts.slice(0,available)) {
      if(this._play(this._modal(c),{group:'physical',priority:c.material==='brass'?2:1,max:8,gain:this.legacy?.55:.75},{pan:(c.x||0)*3,gain:1/Math.sqrt(Math.max(1,contacts.length/3))}))this.physicalTokens-=1;
    }
    this.stats.dropped+=Math.max(0,contacts.length-available); this._duck();
  }
  dispose() { clearInterval(this.timer); clearInterval(this.traceTimer); clearInterval(this.traceTimer2); this.stopAll();this.bgm.dispose(); this.analyser.disconnect(); this.ctx.close?.(); }
}
