import { EVENTS, CUES, GROUP_CAPS, GLOBAL_CAP } from './catalog.mjs';
import { modalSamples } from './modal_core.mjs';
import { BgmPlayer } from './bgm_player.mjs';
import { VOICE_FILES, voiceForEvent } from './voice_catalog.mjs';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export class AudioEngine {
  constructor({ context=null, base=new URL('../sfx/',import.meta.url), master=.45, autoTick=true, voiceProvider='amitaro',legacy=false,modalSynth=modalSamples, bgmEnabled=false, bgmVolume=.65, bgmManifest=new URL('../bgm/manifest.json',import.meta.url), onBgmError=console.error }={}) {
    const AC=globalThis.AudioContext||globalThis.webkitAudioContext;
    this.ctx=context||new AC({sampleRate:48000,latencyHint:'interactive'}); this.base=base;this.legacy=legacy;this.modalSynth=modalSynth;
    this.buffers=new Map(); this.voices=[]; this.last=new Map(); this.pending=new Map(); this.cache=new Map();
    this.sequence=0; this.stats={played:0,dropped:0,merged:0,maxVoices:0,unknown:0};
    this.voiceBuffers=new Map();this.voiceProvider=Object.hasOwn(VOICE_FILES,voiceProvider)?voiceProvider:'off';
    this.voicePending=null;this.voiceLastStart=-Infinity;this.voiceLog=[];this.voiceStats={played:0,suppressed:0,replaced:0};this.payoutPending=0;this.lastPayout=-Infinity;this.payoutSequence=0;
    this.sfx=this.ctx.createGain(); this.physical=this.ctx.createGain(); this.bgmInput=this.ctx.createGain();
    this.voice=this.ctx.createGain();
    this.mix=this.ctx.createGain(); this.sfx.connect(this.mix); this.physical.connect(this.mix); this.bgmInput.connect(this.mix);
    this.voice.connect(this.mix);
    this.hp=this.ctx.createBiquadFilter(); this.hp.type='highpass'; this.hp.frequency.value=40; this.hp.Q.value=.5;
    this.lp=this.ctx.createBiquadFilter(); this.lp.type='lowpass'; this.lp.frequency.value=14000; this.lp.Q.value=.5;
    this.comp=this.ctx.createDynamicsCompressor(); Object.assign(this.comp.threshold,{value:-12});
    this.comp.knee.value=8; this.comp.ratio.value=8; this.comp.attack.value=.003; this.comp.release.value=.15;
    this.master=this.ctx.createGain(); this.master.gain.value=clamp(master,0,1);
    this.ceiling=this.ctx.createWaveShaper(); this.ceiling.curve=Float32Array.from({length:8193},(_,i)=>.80*Math.tanh(2*(i/4096-1))); this.ceiling.oversample='4x';
    this.analyser=this.ctx.createAnalyser(); this.analyser.fftSize=2048;
    this.mix.connect(this.hp).connect(this.lp).connect(this.comp).connect(this.master).connect(this.ceiling).connect(this.analyser).connect(this.ctx.destination);
    this.bgm=new BgmPlayer(this.ctx,this.bgmInput,{enabled:bgmEnabled,volume:bgmVolume,manifestUrl:bgmManifest,onError:onBgmError});
    this.ready=Promise.all([this.load(),this.bgm.ready.catch(()=>null)]).then(()=>this);
    if(autoTick) this.timer=setInterval(()=>this.flush(),20);
  }
  async load() {
    await Promise.all(CUES.filter(name=>!this.legacy||name!=='payout').map(async name=>{
      const r=await fetch(new URL(name+'.wav',this.base)); if(!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
      this.buffers.set(name,await this.ctx.decodeAudioData(await r.arrayBuffer()));
    }));
    await Promise.all(Object.entries(VOICE_FILES).flatMap(([provider,files])=>Object.entries(files).map(async([key,file])=>{
      const r=await fetch(new URL('../voice/'+file,import.meta.url));if(!r.ok)throw new Error(`voice ${file}: HTTP ${r.status}`);
      this.voiceBuffers.set(provider+':'+key,await this.ctx.decodeAudioData(await r.arrayBuffer()));
    })));
    return this;
  }
  async unlock() { await this.ctx.resume(); await this.ready; }
  setMaster(value) { this.master.gain.setTargetAtTime(clamp(Number(value)||0,0,1),this.ctx.currentTime,.025); }
  setBgmVolume(value) { this.bgm.setVolume(value); }
  setBgmMuted(value) { return this.bgm.setEnabled(!value); }
  reloadBgmManifest(url) { this.bgm.ready=this.bgm.reload(url);return this.bgm.ready; }
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
    src.connect(volume).connect(panner).connect(spec.group==='physical'?this.physical:spec.group==='voice'?this.voice:this.sfx);
    const v={src,gain:volume,level,start,end,group:spec.group,priority:spec.priority,retired:false};
    src.onended=()=>{src.disconnect();volume.disconnect();panner.disconnect();this.voices=this.voices.filter(x=>x!==v);};
    this.voices.push(v); src.start(start);
    this.stats.played++; this.stats.maxVoices=Math.max(this.stats.maxVoices,this.voices.filter(v=>v.start<=start&&v.end>start).length);
    this._duck(); return true;
  }
  _duck() {
    const now=this.ctx.currentTime, p=Math.max(0,...this.voices.filter(v=>!v.retired&&v.end>now).map(v=>v.priority));
    const speaking=this.voices.some(v=>v.group==='voice'&&!v.retired&&v.end>now);
    this.sfx.gain.setTargetAtTime(speaking?.6:1,now,.018);
    this.physical.gain.setTargetAtTime(speaking?.4:p>=6?.32:p>=4?.55:1,now,.018);
    this.bgm.setSpeaking(speaking);
  }
  handleEvent(e) {
    if(!Object.hasOwn(EVENTS,e.id)) {this.stats.unknown++;return false;}
    this.bgm.handleEvent(e);
    if(e.id==='attract') {this.stopAll();return false;}
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
    const accepted=this._play(this.buffers.get(spec.cue),spec,{rate:e.id==='dup_protect'?[1,1.12246,1.25992][this.sequence++%3]:1});
    if(accepted)this.bgm.duckForEvent(e.id);return accepted;
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
    this.bgm.tick();this._voiceTick();
    const now=this.ctx.currentTime;
    if(this.payoutPending&&now-this.lastPayout>=.12){
      const count=this.payoutPending;this.payoutPending=0;this.lastPayout=now;
      this._play(this.buffers.get('payout'),{group:'payout',priority:2,max:2,gain:.25},{rate:[1,1.25,1.5][this.payoutSequence++%3],gain:Math.min(1.3,Math.sqrt(count))});
    }
    // 最大8種類の接触群/20ms、強い衝突を優先。数の増加は強さに圧縮して反映。
    const contacts=[...this.pending.values()].sort((a,b)=>b.impulse-a.impulse);this.pending.clear();
    for(const c of contacts.slice(0,8)) this._play(this._modal(c),{group:'physical',priority:1,max:8,gain:this.legacy?.55:.75},{pan:(c.x||0)*3,gain:1/Math.sqrt(Math.max(1,contacts.length/3))});
    this.stats.dropped+=Math.max(0,contacts.length-8); this._duck();
  }
  dispose() { clearInterval(this.timer); this.stopAll(); this.bgm.dispose();this.analyser.disconnect(); this.ctx.close?.(); }
}
