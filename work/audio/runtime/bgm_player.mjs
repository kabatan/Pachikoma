// 完成mixをmanifestから読み、AudioContextの時計で切替える。ゲーム進行は操作しない。
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export class BgmPlayer {
  constructor(context,output,{enabled=false,volume=.65,manifestUrl=new URL('../bgm/manifest.json',import.meta.url),onError=console.error,onPlaying=()=>{}}={}) {
    this.ctx=context;this.manifestUrl=new URL(manifestUrl,import.meta.url);this.onError=onError;
    this.onPlaying=onPlaying;this.muted=false;this.successPlan=null;this.pendingBank=null;this.earlyWin=null;
    this.enabled=enabled;this.volume=clamp(Number(volume)||0,0,1);this.mode='silent';this.baseTarget='normal';
    this.lit=0;this.declared=false;this.inFlight=false;this.epoch=0;this.nodes=[];this.log=[];
    this.returnPlan=null;this.jpPlan=null;this.terminal=null;this.buffers=new Map();this.manifest=null;
    this.generation=0;this.disposed=false;this.error=null;
    this.userGain=context.createGain();this.userGain.gain.value=enabled?this.volume:0;
    // SFX/声のduckはAudioEngine.bgmInputの一か所だけで処理する。
    this.userGain.connect(output);
    this.ready=this.reload();
  }
  _log(type,data={}) {this.log.push({type,t:this.ctx.currentTime,...data});if(this.log.length>256)this.log.shift();}
  _hold(param,t) {param.cancelAndHoldAtTime(t);}
  _ramp(param,value,at,seconds=.2) {this._hold(param,this.ctx.currentTime);param.setValueAtTime(param.value,at);param.linearRampToValueAtTime(value,at+seconds);}
  get barSeconds() {return this.manifest.clock.bar_samples/this.manifest.sample_rate;}
  get beatSeconds() {return this.manifest.clock.beat_samples/this.manifest.sample_rate;}
  get loopSeconds() {return this.manifest.clock.loop_samples/this.manifest.sample_rate;}
  positionAt(t=this.ctx.currentTime) {
    if(!this.manifest)return 0;
    const epoch=this.returnPlan&&t>=this.returnPlan.at?this.returnPlan.epoch:this.epoch;
    return ((t-epoch)%this.loopSeconds+this.loopSeconds)%this.loopSeconds;
  }
  async reload(url=this.manifestUrl) {
    const generation=++this.generation,candidate=new URL(url,this.manifestUrl);
    try {
      const response=await fetch(candidate,{cache:'no-store'});if(!response.ok)throw new Error(`BGM manifest HTTP ${response.status}`);
      const manifest=await response.json();this._validate(manifest);
      const names=(this.enabled||this.buffers.size>0?['normal','pink','focus','success','success_short','jp_intro','jp_body_loop','jp_outro','attract','tutorial','result']:[]).filter(n=>manifest.files[n]);
      const buffers=new Map();
      // 共有メモリを押し上げないよう3本ずつデコード。旧バンクは成功時だけ交換する。
      for(let i=0;i<names.length;i+=3)await Promise.all(names.slice(i,i+3).map(async name=>{
        const f=manifest.files[name],path=f.file_ogg??f.file_wav;
        if(typeof path!=='string')throw new Error(`BGM ${name}: file path missing`);
        const r=await fetch(new URL(path,candidate),{cache:'no-store'});if(!r.ok)throw new Error(`BGM ${name} HTTP ${r.status}`);
        const b=await this.ctx.decodeAudioData(await r.arrayBuffer());
        const expected=Math.round(f.samples/manifest.sample_rate*this.ctx.sampleRate);
        if(b.numberOfChannels!==2||Math.abs(b.length-expected)>2)throw new Error(`BGM ${name}: decoded length/channels differ from manifest`);
        if(f.kind==='loop'&&!(f.loop_start>=0&&f.loop_end>f.loop_start&&f.loop_end<=f.samples))throw new Error(`BGM ${name}: invalid loop points`);
        buffers.set(name,b);
      }));
      if(generation!==this.generation||this.disposed)return this;
      // 独立曲の途中では旧バンクを完走。音楽の復帰点で新バンクへ交換。
      const bank={manifest,buffers,url:candidate};this.error=null;this.pendingBank=null;
      if(this.returnPlan&&this.manifest){this.pendingBank=bank;this._log('reload-deferred',{until:this.returnPlan.at});}
      else this._install(bank);
      this._log('reload',{project:manifest.project,decodedBytes:[...buffers.values()].reduce((s,b)=>s+b.length*b.numberOfChannels*4,0)});
      return this;
    } catch(error) {
      if(generation===this.generation&&!this.disposed){this.error=String(error);this._log('load-error',{message:this.error});this.onError(error);}
      throw error;
    }
  }
  _install({manifest,buffers,url}) {
    const phase=this.manifest?this.positionAt()/this.loopSeconds:0;
    this._clearNodes();this.manifest=manifest;this.buffers=buffers;this.manifestUrl=url;
    this.epoch=this.ctx.currentTime-phase*this.loopSeconds;
    if(this.earlyWin){const {event,win,at}=this.earlyWin;this.earlyWin=null;if(this.ctx.currentTime<at+(win?.duration??0)){if(event.id==='jp')this._jp(win,at);else this._success(event.id==='success_small',win,at);}}
    if(this.enabled)this._resume();
  }
  _validate(m) {
    const integer=n=>Number.isSafeInteger(n)&&n>0;
    if(!integer(m.sample_rate)||!integer(m.clock?.loop_samples)||!integer(m.clock?.bar_samples)||!integer(m.clock?.beat_samples)||m.clock.bar_samples%m.clock.beat_samples)throw new Error('BGM clock invalid');
    for(const name of ['normal','pink','focus']) {
      const f=m.files?.[name];if(!f||f.kind!=='loop'||f.loop_end-f.loop_start!==m.clock.loop_samples||f.samples<f.loop_end)throw new Error(`BGM ${name}: common clock required`);
    }
    const bars=m.files.success?.reentry_bars_in_normal??m.reentry_bars_after_success;
    if(!Array.isArray(bars)||!bars.length||bars.some(b=>!Number.isSafeInteger(b)||b<0||b*m.clock.bar_samples>=m.clock.loop_samples))throw new Error('BGM reentry bars invalid');
    for(const name of ['success','success_short','jp_intro','jp_body_loop','jp_outro'])if(!m.files[name])throw new Error(`BGM ${name} missing`);
    if(m.clock.loop_samples%m.clock.bar_samples||m.clock.loop_bars!==m.clock.loop_samples/m.clock.bar_samples)throw new Error('BGM loop bars invalid');
    for(const [name,f] of Object.entries(m.files)){
      if(!integer(f.samples)||typeof(f.file_ogg??f.file_wav)!=='string')throw new Error(`BGM ${name}: samples/path required`);
      if(!['loop','oneshot'].includes(f.kind))throw new Error(`BGM ${name}: kind invalid`);
      if(f.kind==='loop'&&(!Number.isSafeInteger(f.loop_start)||f.loop_start<0||!integer(f.loop_end)||f.loop_end>f.samples||f.loop_end<=f.loop_start))throw new Error(`BGM ${name}: loop points invalid`);
      if(f.reentry_bars_in_normal&&(!Array.isArray(f.reentry_bars_in_normal)||!f.reentry_bars_in_normal.length||f.reentry_bars_in_normal.some(b=>!Number.isSafeInteger(b)||b<0||b>=m.clock.loop_bars)))throw new Error(`BGM ${name}: reentry bars invalid`);
      if(['success','success_short','jp_intro','jp_body_loop','jp_outro'].includes(name)){
        if(!integer(f.bars)||!Number.isFinite(f.preroll_s??0)||(f.preroll_s??0)<0)throw new Error(`BGM ${name}: musical duration invalid`);
        const body=f.body_s??f.bars*m.clock.bar_samples/m.sample_rate;
        if(!Number.isFinite(body)||body<=0||Math.abs(body-f.bars*m.clock.bar_samples/m.sample_rate)>2/m.sample_rate||(body+(f.preroll_s??0))>f.samples/m.sample_rate+2/m.sample_rate)throw new Error(`BGM ${name}: body exceeds file or differs from clock`);
      }
    }
    const body=m.files.jp_body_loop;if(body.loop_end-body.loop_start!==body.bars*m.clock.bar_samples)throw new Error('BGM JP loop clock invalid');
  }
  async setEnabled(value) {
    this.enabled=!!value;this._ramp(this.userGain.gain,this.enabled&&!this.muted?this.volume:0,this.ctx.currentTime,.03);
    if(!this.enabled){this._clearNodes();this.onPlaying(false);return this;}
    if(!this.manifest||!this.buffers.size){
      this.ready=this.reload();try{await this.ready;}catch(error){if(!this.buffers.size){this.enabled=false;this.setVolume(this.volume);}throw error;}
    } else this._resume();
    return this;
  }
  setVolume(value) {this.volume=clamp(Number(value)||0,0,1);this._ramp(this.userGain.gain,this.enabled&&!this.muted?this.volume:0,this.ctx.currentTime,.025);}
  setMuted(value) {this.muted=!!value;this.setVolume(this.volume);this._playing();}
  _playing() {const now=this.ctx.currentTime;this.onPlaying(this.enabled&&!this.muted&&this.volume>0&&this.nodes.some(n=>n.at<=now&&n.end>now));}
  _clearNodes(group=null) {
    const now=this.ctx.currentTime;
    for(const n of [...this.nodes])if(!group||n.group===group){
      this._hold(n.gain.gain,now);n.gain.gain.linearRampToValueAtTime(0,now+.015);n.src.stop(now+.016);n.cancelled=true;
    }
    this.nodes=this.nodes.filter(n=>!n.cancelled);
  }
  _source(name,at,{offset=0,loop=false,group='independent',level=1}={}) {
    if(!this.enabled||!this.buffers.has(name))return null;
    const f=this.manifest.files[name],src=this.ctx.createBufferSource(),gain=this.ctx.createGain();
    src.buffer=this.buffers.get(name);src.loop=loop;gain.gain.value=level;gain.gain.setValueAtTime(level,at);
    if(loop){src.loopStart=f.loop_start/this.manifest.sample_rate;src.loopEnd=f.loop_end/this.manifest.sample_rate;}
    src.connect(gain).connect(this.userGain);const n={name,src,gain,at,offset,group,end:loop?Infinity:at+src.buffer.duration-offset};
    this.nodes.push(n);src.onended=()=>{src.disconnect();gain.disconnect();this.nodes=this.nodes.filter(x=>x!==n);};src.start(at,offset);
    this._log('source',{name,at,offset,loop,group});return n;
  }
  _startBase(at,offset,target) {
    this._clearNodes('base');
    for(const name of ['normal','pink','focus']){
      const start=this.manifest.files[name].loop_start/this.manifest.sample_rate;
      const n=this._source(name,at,{offset:start+offset,loop:true,group:'base',level:0});
      if(n)n.gain.gain.linearRampToValueAtTime(name===target?1:0,at+.15);
    }
  }
  _baseTarget(target,{immediate=false,fade=immediate?.15:.2}={}) {
    this.baseTarget=target;
    if(!this.enabled||!this.manifest)return;
    if(!this.nodes.some(n=>n.group==='base'))this._startBase(this.ctx.currentTime+.002,this.positionAt(this.ctx.currentTime+.002),target);
    const now=this.ctx.currentTime,at=immediate?now:now+((this.beatSeconds-this.positionAt()%this.beatSeconds)%this.beatSeconds);
    for(const n of this.nodes.filter(n=>n.group==='base'))this._ramp(n.gain.gain,n.name===target?1:0,Math.max(at,n.at),fade);
    this._log('base-switch',{target,at,position:this.positionAt(at),fade});
  }
  _fadeBase(at=this.ctx.currentTime) {
    for(const n of this.nodes.filter(n=>n.group==='base')){this._hold(n.gain.gain,this.ctx.currentTime);n.gain.gain.linearRampToValueAtTime(0,at+.15);n.src.stop(at+.151);n.end=at+.151;}
  }
  _safeBar(at,file='success') {
    const bars=this.manifest.files[file]?.reentry_bars_in_normal??this.manifest.reentry_bars_after_success??this.manifest.files.success.reentry_bars_in_normal;
    const current=this.positionAt(at)/this.barSeconds,total=this.loopSeconds/this.barSeconds;
    return [...bars].sort((a,b)=>(a-current+total)%total-(b-current+total)%total)[0];
  }
  _planReturn(at,file='success') {
    const bar=this._safeBar(at,file),offset=bar*this.barSeconds;
    this.returnPlan={at,bar,offset,epoch:at-offset};
    if(!this.terminal)this._startBase(at,offset,this.baseTarget);
    this._log('return-planned',{at,bar,offset,file});
  }
  _success(short,win,eventAt=this.ctx.currentTime) {
    if(!this.manifest){this.earlyWin={event:{id:short?'success_small':'success_big'},win,at:eventAt};return;}
    this.returnPlan=null;this._clearNodes('independent');this._fadeBase();this.mode='success';this.inFlight=false;this.declared=false;
    const name=short?'success_short':'success',f=this.manifest.files[name],at=(win?.startAt??eventAt+.002)+(win?.duration??(short?1.4:3.4));
    this.successPlan={name,at};
    this._source(name,at);
    this._planReturn(at+(f.preroll_s??0)+(f.body_s??f.bars*this.barSeconds),name);
    this._log('success',{name,at});
  }
  _jp(win,eventAt=this.ctx.currentTime) {
    if(!this.manifest){this.earlyWin={event:{id:'jp'},win,at:eventAt};return;}
    if(this.jpPlan)return;
    this._clearNodes();this.mode='jp_intro';this.returnPlan=null;this.inFlight=false;this.declared=false;
    const duration=win?.duration,at=(win?.startAt??eventAt+.002)+(win?.announcementEnd??2.8),files=this.manifest.files;
    const bodyAt=at+(files.jp_intro.preroll_s??0)+(files.jp_intro.body_s??files.jp_intro.bars*this.barSeconds);
    const outroLength=(files.jp_outro.preroll_s??0)+(files.jp_outro.body_s??files.jp_outro.bars*this.barSeconds);
    const bodyBars=Number.isFinite(duration)&&duration>0?Math.max(1,Math.floor((duration-(win?.announcementEnd??2.8)-(bodyAt-at)-outroLength)/this.barSeconds)):files.jp_body_loop.bars;
    const outroAt=bodyAt+bodyBars*this.barSeconds,returnAt=outroAt+outroLength;
    this.jpPlan={at,bodyAt,outroAt,returnAt,bodyBars};
    this._source('jp_intro',at);const body=this._source('jp_body_loop',bodyAt,{loop:true});
    if(body){body.gain.gain.setValueAtTime(1,outroAt);body.gain.gain.linearRampToValueAtTime(0,outroAt+.15);body.src.stop(outroAt+.151);body.end=outroAt+.151;}
    this._source('jp_outro',outroAt);this._planReturn(returnAt);
    this._log('jp-planned',{...this.jpPlan,requestedDuration:duration??null});
  }
  _terminal(name,{preserveTail=false}={}) {
    if(preserveTail)this._clearNodes('base');else this._clearNodes();this.returnPlan=null;this.jpPlan=null;this.terminal=null;this.mode=name;this.inFlight=false;this.declared=false;
    if(this.manifest?.files[name])this._source(name,this.ctx.currentTime+.002,{loop:this.manifest.files[name].kind==='loop'});
    this._log('terminal',{name,fallback:this.manifest?.files[name]?null:'silence'});
  }
  _resume() {
    if(!this.manifest||!this.enabled||this.disposed)return;
    this.tick();this._clearNodes();
    // ミュート中も時計と予定を進める。再開時は途中位置から復帰する。
    const now=this.ctx.currentTime+.002;
    if(this.jpPlan){
      const p=this.jpPlan;
      for(const [name,start,end,loop] of [['jp_intro',p.at,p.bodyAt,false],['jp_body_loop',p.bodyAt,p.outroAt,true],['jp_outro',p.outroAt,p.returnAt,false]]) {
        if(now>=end+(loop?0:(this.manifest.files[name].tail_s??0)))continue;
        const at=Math.max(now,start),offset=now>start?(loop?this.manifest.files[name].loop_start/this.manifest.sample_rate+(now-start)%(end>start?(this.manifest.files[name].loop_end-this.manifest.files[name].loop_start)/this.manifest.sample_rate:1):now-start):0,n=this._source(name,at,{offset,loop});
        if(n&&loop){n.gain.gain.setValueAtTime(1,end);n.gain.gain.linearRampToValueAtTime(0,end+.15);n.src.stop(end+.151);}
      }
      if(this.returnPlan&&!this.terminal)this._startBase(this.returnPlan.at,this.returnPlan.offset,this.baseTarget);
    } else if(this.mode==='success'&&this.returnPlan) {
      const p=this.successPlan;if(p&&now<p.at+this.buffers.get(p.name).duration)this._source(p.name,Math.max(now,p.at),{offset:Math.max(0,now-p.at)});
      if(!this.terminal)this._startBase(this.returnPlan.at,this.returnPlan.offset,this.baseTarget);
    } else if(['normal','pink','focus'].includes(this.mode)||this.mode==='tutorial'&&!this.manifest.files.tutorial)this._startBase(now,this.positionAt(now),this.baseTarget);
    else if(this.manifest.files[this.mode])this._source(this.mode,now,{loop:this.manifest.files[this.mode].kind==='loop'});
  }
  tick() {
    const now=this.ctx.currentTime;
    if(this.jpPlan){const p=this.jpPlan;this.mode=now>=p.outroAt?'jp_outro':now>=p.bodyAt?'jp_body':'jp_intro';}
    if(this.returnPlan&&now>=this.returnPlan.at){
      const p=this.returnPlan;this.epoch=p.epoch;this.returnPlan=null;this.jpPlan=null;this.successPlan=null;
      if(this.terminal){const terminal=this.terminal;this._terminal(terminal,{preserveTail:true});}
      else {this.mode=this.baseTarget;this._log('returned',{bar:p.bar,at:p.at,position:p.offset});}
    }
    if(this.pendingBank&&!this.returnPlan){const bank=this.pendingBank;this.pendingBank=null;this._install(bank);}
    this._playing();
  }
  handleEvent(e,win=null) {
    this.tick();
    if(e.state?.phase==='Fault'||e.id==='fault'){this.stop();return;}
    if(Number.isFinite(e.state?.lit))this.lit=e.state.lit;
    else if(/^lamp[456]$/.test(e.id))this.lit=Number(e.id.at(-1));
    else if(e.id==='lamp123')this.lit=e.data?.n??1;
    const target=this.lit>=4?'pink':'normal';
    if(['attract','title'].includes(e.id)){this.stop();this._terminal('attract');return;}
    if(e.id==='add100'&&this.mode!=='silent'&&this.mode!=='attract')return;
    if(['start','ticket','add100'].includes(e.id)){
      this.stop();this.mode=target;this.baseTarget=target;if(e.id==='ticket')this.epoch=this.ctx.currentTime;this._baseTarget(target,{immediate:true});return;
    }
    if(e.id==='jp'){this.baseTarget=target;this._jp(win);return;}
    if(['timeup','finish_count','result'].includes(e.id)){
      const terminal=e.id==='timeup'?'silent':'result';
      if(this.returnPlan||this.inFlight){this.terminal=terminal;this._clearNodes('base');}
      else this._terminal(terminal);return;
    }
    if(this.jpPlan)return;
    if(['success_small','success_big'].includes(e.id)){this.baseTarget=target;this._success(e.id==='success_small',win);return;}
    if(this.returnPlan){
      // 復帰予定時刻は変えず、灯数更新だけ反映する。
      this.baseTarget=target;
      for(const n of this.nodes.filter(n=>n.group==='base'))this._ramp(n.gain.gain,n.name===target?1:0,this.returnPlan.at,.15);
      return;
    }
    if(['challenge_declare','challenge_wait','challenge_flight'].includes(e.id)){
      this.declared=true;if(e.id==='challenge_flight')this.inFlight=true;
      this.mode='focus';this._baseTarget('focus',{immediate:true});return;
    }
    if(e.id==='fail'||e.id==='challenge_cancel'){
      this.inFlight=false;this.declared=false;
      if(this.terminal){const terminal=this.terminal;this._terminal(terminal);return;}
      this.mode=target;this._baseTarget(target,{immediate:e.id==='fail',fade:e.id==='fail'?.4:undefined});return;
    }
    if(e.id==='howto'){if(this.manifest?.files.tutorial)this._terminal('tutorial');else{this.mode='tutorial';this._baseTarget('normal',{immediate:true});}return;}
    if(['ambient','lamp123','lamp4','lamp5','lamp6','ascend'].includes(e.id)){
      if(this.inFlight||this.declared)return;
      this.mode=target;this._baseTarget(target);
    }
  }
  stop() {this._clearNodes();this.onPlaying(false);this.returnPlan=null;this.jpPlan=null;this.successPlan=null;this.earlyWin=null;this.terminal=null;this.mode='silent';this.inFlight=false;this.declared=false;}
  snapshot() {return {enabled:this.enabled,muted:this.muted,volume:this.volume,project:this.manifest?.project,pendingReload:!!this.pendingBank,mode:this.mode,baseTarget:this.baseTarget,position:this.positionAt(),returnPlan:this.returnPlan,jpPlan:this.jpPlan,error:this.error,sources:this.nodes.length};}
  dispose() {this.stop();this.disposed=true;this.generation++;this.userGain.disconnect();this.buffers.clear();this.pendingBank=null;this.earlyWin=null;}
}
