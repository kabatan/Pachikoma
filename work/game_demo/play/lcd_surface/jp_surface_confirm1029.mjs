import {warmPausedVideo,withRestored2D} from './startup_warm.mjs';
import {createChainOffer} from './chain_connect_20261029.mjs';
import {createResultCompositor} from './result_compositor_confirm1029.mjs';
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
// 継続成功の通し: 着地(chain_jp_land) -> 継続成功v4 -> 配当(reward)。ゲーム側の演出時間をこの長さに合わせ、通し中に選択へ移らせない。
export function chainEffectSeconds(man, payout) {
  const land=man.scenes.chain_jp_land_d4,ok=man.scenes.chain_success,reward=man.scenes[`reward_${payout}`];
  if(!land||!ok||!reward||ok.next!=='@reward')return null;
  return land.frames/man.fps+(ok.duration??ok.frames/man.fps)+reward.frames/man.fps;
}
class OriginalJpTimeline {
  constructor(man, cue = () => {}) { this.man=man; this.cue=cue; this.active=false; this.clock=0; this.serial=0; }
  start(name) {
    if (!this.man.scenes[name]) { this.stop('missing:'+name); return; }
    this.name=name;this.time=0;this.lastF=-1;this.serial++;this.active=true;
  }
  // 10/31 TOTAL の桁：持ち玉で賞が決まる規則（PrizeBasis:'wallet'）では、選択画面・表示器と同じ数（持ち玉＋未確定の積み増し＝game.prizeScore）にそろえる。G は従来のまま
  walletScore(fallback){const st=this.getState?.()??{};return st.rules?.PrizeBasis==='wallet'&&Number.isFinite(st.balls)?Math.max(0,Math.round(st.balls+(st.chain?.pendingAward??0))):fallback;}
  stop(reason='end') { this.active=false;this.name=null;this.pending=null;this.cue({kind:'end',reason}); }
  onEvent(id,p={}) {
    if (id==='lamp6') {
      if(this.active&&this.payout>0)return true; // The next cycle must not restart an unfinished payout film.
      const pockets=p.after??p.pockets??[];const d=[1,2,3,4,5,6,7].find(x=>!pockets.includes(x));
      if (!this.man.digits.includes(d)) return false;
      this.d=d;this.payout=0;this.heat=0;this.flight=false;this.dim=false;this.delay=1;this.start('jp_intro');return true;
    }
    if (id==='fail' && (this.active || p.chain)) {
      this.payout=0;this.result={...p};this.d??=p.unlit?.[0]??4;this.earnings=(p.jackpotEarnings??0)>0?this.walletScore(p.jackpotEarnings):0;this.delay=0;this.flash='miss';this.flashAt=this.clock;
      this.dim=false;this.flashAt=-Infinity;this.start((p.jackpotEarnings??0)>0?'fail_chain':'fail_first');return true;
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
    // 導入・チャンス題字(jp_intro_*, jp_chance_*)は最後まで見せる。玉の発射・熱さの通知が早く来ても、狙いの場面へ着くまで飛ばさない(10/29 監督指摘: 連打で倍速になる)。
    const protectedIntro=/^jp_(intro|chance)/.test(this.name);
    if(this.pending && !held && !protectedIntro && (crossed||f===s.frames-1)) {const n=this.pending;this.pending=null;this.start(n);return;}
    if(f===s.frames-1 && this.time>=(s.frames-.1)/this.man.fps) {
      let n=s.next;
      if(n==='@roulette')n=this.man.roulette[String(this.payout)];
      if(n==='@reward')n=`reward_${this.payout}`;
      if(n==='@intro')n=this.introVariant??'jp_intro_dopamine';
      if(this.name.startsWith('fly_in'))n=`fly_t${this.heat}_d${this.d}`;
      if(n){this.start(n);return;}
      if(s.loop){this.time=(s.loop_from??0)/this.man.fps;this.lastF=(s.loop_from??0)-1;return;}
      if(this.name.startsWith('tame_')||this.name.startsWith('chain_tame_')) {this.lastF=f;return;}
      if(this.payout>0&&(this.name.startsWith('reward_')||this.name.startsWith('chain_jp_land_'))&&this.getState?.().chain?.choicePending){this.payout=0;this.start('chain_offer');return;}
      this.stop();return;
    }
    this.lastF=f;
  }
  where(){if(!this.active)return null;return {name:this.name,f:Math.max(0,this.lastF),time:this.time,serial:this.serial,dim:this.dim,delay:this.delay,flash:Math.max(0,1-(this.clock-this.flashAt)/.1),flashColor:this.flash,result:this.result,earnings:this.earnings};}
}
export class JpTimeline extends OriginalJpTimeline {
  constructor(man,cue=()=>{},getState=()=>({}),table=man.directionTable??{defaults:{},rules:[]},random=Math.random) {
    man.scenes.chain_offer??={frames:48,offer:true,layered:true};
    super(man,cue);this.getState=getState;this.table=table;this.chainStage=0;this.selections=[];this.random=random;
  }
  start(name) {
    if(name==='jp_intro'&&this.man.intro_variants?.length) {
      const names=this.man.intro_variants;
      this.introVariant=names[Math.floor(this.random()*names.length)];
      // 10/29 最新の流れ: 紫の雷(黒の上) → 黒の背景+文字 → JPチャンス。雷が先。manifest.intro_order が無ければ従来(文字 → 雷)。
      name=this.man.intro_order==='lightning_first'&&this.man.scenes.jp_intro_lightning?'jp_intro_lightning':this.introVariant;
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
    if(this.name==='chain_offer'&&['timeup','finish_count','result','ticket','attract','challenge_cancel'].includes(id)){this.stop(id);return false;}
    if(this.active&&this.name==='chain_confirm'&&['lamp6','chain_continue','challenge_wait','challenge_flight','jp_heat','jp_mouth','jp','fail','chain_stop'].includes(id)){
      this.queuedAfterResult??=[];this.queuedAfterResult.push([id,{...p}]);return true;
    }
    if(id==='chain_stop'&&this.man.scenes.chain_confirm){
      this.queuedChainEvents=[];
      if(this.active&&this.payout>0){this.queuedResult={...p};return true;}
      this.payout=0;this.result={...p};this.earnings=this.walletScore(Math.max(0,Math.round(p.total??((p.base??0)+(p.banked??0)))));
      this.resultChain=Math.max(1,Math.round(p.chain??0)+1);this.delay=0;this.dim=false;this.pending=null;this.flashAt=-Infinity;
      this.start('chain_confirm');return true;
    }
    if(this.name==='chain_confirm'&&this.active&&id==='chain_choice')return false;
    if(['ticket','attract','challenge_cancel'].includes(id)){this.queuedResult=null;this.queuedAfterResult=[];}
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
      this.chainMode=true;this.d=targetDigit({pockets:this.getState().pockets??p.pockets,d:p.d},this.getState(),this.d);
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
    if(!this.active&&this.queuedAfterResult?.length){const events=this.queuedAfterResult;this.queuedAfterResult=[];for(const [id,p]of events)this.onEvent(id,p);}
    if(!this.active&&this.queuedResult){const p=this.queuedResult;this.queuedResult=null;this.onEvent('chain_stop',p);}
    if(!this.active&&this.queuedChainEvents?.length){const events=this.queuedChainEvents;this.queuedChainEvents=[];for(const [id,p] of events)this.onEvent(id,p);}
  }
  where(){const w=super.where();return w?{...w,d:this.d,heat:this.heat,isChain:!!this.chainMode,chainStage:this.chainStage,cutin:this.cutin,clock:this.clock,introVariant:this.introVariant}:null;}
}
export async function createJpSurface({manifestUrl,onCue=()=>{},log=()=>{},getState=()=>({}),palaceImageFactory=null,resultImageFactory=null,onResultBeforeReuse=()=>{}}) {
  const res=await fetch(manifestUrl);if(!res.ok)throw new Error('JP manifest HTTP '+res.status);
  const man=await res.json(),base=new URL('.',manifestUrl);if(!man.background_layer)return createLegacyJpSurface({manifestUrl,onCue,log});
  const lightRes=await fetch(new URL(man.lights,base));if(!lightRes.ok)throw new Error('JP lights HTTP '+lightRes.status);
  const lights=await lightRes.json();const cmeta=man.center?await(await fetch(new URL(man.center.meta,base))).json():null;const center=cmeta?createCenterReel(cmeta):null;const palace=await createSharedPalace({base,imageFactory:palaceImageFactory,config:man.background_layer,onError:e=>console.error('[palace]',e),center:cmeta?{F:man.center.F,T:man.center.T,meta:cmeta}:null});const digits=man.fail_slots?await createJpDigits(base,man.fail_slots):null;
  const slots=Array.from({length:3},()=>{const v=document.createElement('video');v.muted=true;v.playsInline=true;v.preload='auto';return{v,name:null,ready:false,promise:null};});
  // 継続成功v4は専用スロットに常駐(起動時に読み込み済み)。再生中の遅延読み込みと追い出しを避ける。
  const pinned=man.scenes.chain_success?.pinned?{v:Object.assign(document.createElement('video'),{muted:true,playsInline:true,preload:'auto'}),name:null,ready:false,promise:null,pinned:true}:null;
  if(pinned)slots.push(pinned);
  // 継続告知 v09（10/30）の映像も専用スロットに常駐（manifest の pinned。起動時に読み込み・復号）。?chainannounce=old では読まない
  const extraPinnedNames=new URLSearchParams(typeof location==='undefined'?'':location.search).get('chainannounce')==='old'?[]:Object.keys(man.scenes).filter(k=>/^chain_announce_/.test(k)&&man.scenes[k].pinned);
  const extraPinned=extraPinnedNames.map(name=>({v:Object.assign(document.createElement('video'),{muted:true,playsInline:true,preload:'auto'}),name:null,ready:false,promise:null,pinned:true,pinName:name}));
  slots.push(...extraPinned);
  man.directionTable=await (await fetch(new URL(man.direction,base))).json();
  const offer=await createChainOffer();
  const resultFactory={requested:!!resultImageFactory,mode:'native',failures:[]};let compositor=null;
  if(man.result_compositor){
    if(resultImageFactory)try{compositor=await resultImageFactory({base,config:man.result_compositor});if(!compositor?.render||!compositor?.ready||!compositor?.prepare)throw Error('Invalid result image factory API');resultFactory.mode='injected';}
    catch(error){resultFactory.mode='native-factory-fallback';resultFactory.failures.push(String(error?.message??error));try{compositor?.dispose?.();}catch(cleanup){resultFactory.failures.push('dispose: '+String(cleanup?.message??cleanup));}compositor=null;console.warn('[result-injection] original image path fallback',error);}
    if(!compositor)compositor=await createResultCompositor(base,man.result_compositor);
  }
  const idleUpdates=!!palace.imageBackend&&new URLSearchParams(location.search).get('palaceidle')!=='0';
  const model=new JpTimeline(man,onCue,getState);let manual=false,current=null,serial=-1,errors=[],hole=null,visible=null,previous=null,fade=1,blockedResult=null;
  let blockedFor=0,wdSerial=-1,wdT=0;
  // 場面が終わらないまま居座る不具合の保険(10/29 監督指摘: 失敗後の灰色＋閉じた扉が残る)。待つ場面(狙い・飛行・ため・ループ・継続の選択)以外が、長さ+4秒を過ぎても進まなければ打ち切って通常に戻す。
  const WAITS=/^(tame_|fly_|jp_aim|chain_jp_aim|chain_fly|chain_tame|chain_offer)/;
  const stuckWatch=dt=>{
    const sc=man.scenes[model.name];
    if(!model.active||model.delay>0||!sc||sc.loop||sc.offer||WAITS.test(model.name)){wdSerial=-1;wdT=0;return;}
    if(wdSerial!==model.serial){wdSerial=model.serial;wdT=0;}
    if(JPREADY&&current&&!current.ready)return;   // 10/30 jpready: 次の映像を読み込み中は看守の時計を進めない（実時間で未準備のまま stop→通常背景に落ちるのを防ぐ）。?jpready=0で戻す
    // 10/30 roulettewd: ルールHのルーレットは押されるまで回転をループする(最長 約15秒)。映像が実際に進んでいる間は看守の時計を進めない（8.9秒で打ち切って待機に落ち、配当の映像が出なかった）。?roulettewd=0で戻す
    if(ROULETTEWD&&ROULETTE.test(model.name)&&current?.v&&!current.v.paused){const ct=current.v.currentTime;if(ct!==wdCT){wdCT=ct;wdT=0;return;}}
    wdT+=Math.min(dt,.1);
    if(wdT>sc.frames/man.fps+4){record('watchdog',{name:model.name,wdT});model.stop('watchdog');}
  };
  const ROULETTEWD=new URLSearchParams(typeof location==='undefined'?'':location.search).get('roulettewd')!=='0',ROULETTE=/^roulette_\d+$/;let wdCT=-1;
  const JPREADY=new URLSearchParams(typeof location==='undefined'?'':location.search).get('jpready')!=='0';
  const lifecycle=[];const record=(kind,data={})=>{lifecycle.push({kind,wall:performance.now(),...data});if(lifecycle.length>1000)lifecycle.shift();};
  let startupWarmPromise=null;
  const load=(slot,name,recordLoad=true)=>{
    if(!name||!man.scenes[name])return Promise.resolve();
    if(slot.name===name)return slot.promise??Promise.resolve();
    slot.cancel?.();slot.v.pause();slot.name=name;slot.generation=(slot.generation??0)+1;slot.ready=false;
    const at=performance.now(),report=recordLoad?record:()=>{};report('load',{name});
    slot.promise=new Promise(resolve=>{
      const cleanup=()=>{clearTimeout(timer);slot.v.removeEventListener('loadeddata',done);slot.v.removeEventListener('error',bad);slot.cancel=null;};
      const done=()=>{cleanup();slot.ready=slot.v.readyState>=2;report('decoded',{name,ms:performance.now()-at});resolve();};
      const bad=()=>{cleanup();if(recordLoad){errors.push(name+':video');report('error',{name});}resolve();if(recordLoad&&model.active&&model.name===name)model.stop('video_error');};
      const timer=setTimeout(bad,8000);slot.cancel=()=>{cleanup();resolve();};slot.v.addEventListener('loadeddata',done,{once:true});slot.v.addEventListener('error',bad,{once:true});
      slot.v.src=new URL(man.scenes[name].file,base).href;slot.v.load();
    });return slot.promise;
  };
  // 10/31 CPU軽量化：初回JPの導入(雷)と「扉の寄り」の最初で映像の読み込み・復号待ち(0.5〜2.7秒、黒く見えて時計は進む)が出ていた。
  //   雷・開き・チャンスの映像を、封印の差し替えが済んだ後の空き時間に専用スロットへ読み込んで復号しておき、同じファイルの場面名が来たら(巻き戻して)使い回す。?jppin=0 で従来
  const filePinned=[];const PIN_ON=new URLSearchParams(typeof location==='undefined'?'':location.search).get('jppin')!=='0';
  async function pinScenes(names){
    if(!PIN_ON)return [];const out=[];
    for(const n of names){const sc=man.scenes[n];if(!sc?.file||filePinned.some(x=>x.pinFile===sc.file))continue;
      const slot={v:Object.assign(document.createElement('video'),{muted:true,playsInline:true,preload:'auto'}),name:null,ready:false,promise:null,pinned:true,pinFile:sc.file};
      slots.push(slot);filePinned.push(slot);await load(slot,n,false);
      if(!slot.ready){slot.pinned=false;slot.name=null;slot.promise=null;slots.splice(slots.indexOf(slot),1);filePinned.splice(filePinned.indexOf(slot),1);out.push({name:n,ok:false});}else out.push({name:n,ok:true});}
    return out;
  }
  const reserve=(name)=>{let slot=slots.find(s=>s.name===name);
    if(!slot&&filePinned.length){const f=man.scenes[name]?.file;const fp=f&&filePinned.find(x=>x.pinFile===f&&x.ready&&x!==current&&x!==visible&&x!==previous);if(fp){fp.name=name;fp.generation=(fp.generation??0)+1;slot=fp;}}
    if(!slot){slot=slots.find(s=>!s.pinned&&s!==current&&s!==visible&&s!==previous&&s.name===null)??slots.find(s=>!s.pinned&&s!==current&&s!==visible&&s!==previous);if(slot)load(slot,name);}return slot;};
  if(pinned){await load(pinned,'chain_success',false);if(!pinned.ready){errors.push('chain_success:startup');pinned.pinned=false;pinned.name=null;pinned.promise=null;}}
  for(const slot of extraPinned){await load(slot,slot.pinName,false);if(!slot.ready){errors.push(slot.pinName+':startup');slot.pinned=false;slot.name=null;slot.promise=null;}}
  const chainTarget=()=>{const s=getState(),n=s.chain?.nextLamps??1;return targetDigit({pockets:(s.rules?.JackpotChainLaneOrder??[1,2,3,4,5,6,7]).slice(0,n)},s,1);};
  const sResult=()=>man.scenes[model.name]?.result_kind;
  function sync(){
    // 常駐の継続成功v4は、使われていない間に先頭へ巻き戻し、次回の最初のコマに前回の末尾を出さない。
    if(pinned?.pinned&&pinned.ready&&pinned!==current&&pinned!==visible&&pinned!==previous&&!pinned.v.seeking&&pinned.v.currentTime>.001){pinned.v.pause();pinned.v.currentTime=0;}
    for(const x of extraPinned)if(x.pinned&&x.ready&&x!==current&&x!==visible&&x!==previous&&!x.v.seeking&&x.v.currentTime>.001){x.v.pause();x.v.currentTime=0;}
    if(!model.active){for(const s of slots)if(!s.v.paused)s.v.pause();return;}
    if(man.scenes[model.name]?.offer){if(serial!==model.serial){serial=model.serial;offer.begin(man.scenes[visible?.name]?.layered?palace.canvas:visible?.v);for(const s of slots)s.v.pause();current=null;previous=null;const d=chainTarget();reserve(`chain_jp_aim_d${d}`);reserve(`chain_fly_in_d${d}`);record('start',{name:model.name});log(model.name);}return;}
    if(serial!==model.serial){current=reserve(model.name);if(!current)return;serial=model.serial;hole=null;if(current.ready)current.v.currentTime=0;record('request',{name:model.name});log(model.name);if(sResult())compositor?.prefetch(sResult(),sResult()==='confirm'?84:64);}
    const s=man.scenes[model.name];
    if(current?.ready&&model.delay<=0){
      if(visible!==current){previous=visible;visible=current;fade=previous?0:1;record('start',{name:current.name});}
      // A result image wait owns this pause until ready; do not repeatedly restart the decoder.
      if(!manual&&current!==blockedResult&&current.v.paused&&!current.v.ended)current.v.play().catch(()=>{});
    }
    const next=model.pending??(model.name.startsWith('fly_t')?`fly_t${Math.min(3,model.heat+1)}_d${model.d}`:s.next==='@roulette'?man.roulette[String(model.payout)]:s.next==='@reward'?`reward_${model.payout}`:(s.next==='@intro'&&JPREADY?(model.introVariant??'jp_intro_dopamine'):s.next));
    if(next)reserve(next);
    else if(model.name.startsWith('reward_'))reserve(`chain_jp_aim_d${chainTarget()}`);
  }
  const cue=model.cue;model.cue=c=>{if(c.kind==='hole')hole=c;return cue(c);};
  const stop=model.stop.bind(model);model.stop=reason=>{
    const failed=man.scenes[model.name]?.result_kind==='fail';
    record('end',{name:model.name,reason:reason??'end',time:model.time});
    const r=stop(reason);if(idleUpdates)palace.hidden();
    // 失敗の映像の最後のコマ(灰色＋閉じた扉)を次の映像の読み込み中に出し直さない
    if(failed){visible=null;previous=null;current=null;serial=-1;blockedResult=null;blockedFor=0;fade=1;}
    return r;
  };
  // 勝負球(JPチャレンジの玉)の発射を待たせる間: 最初のJPの導入・チャンス題字(狙いの場面へ着くまで)と、配当の演出の最中。
  // この間に押された発射は規則側で保持され、解けた瞬間に出る。押しっぱなし・連打でも、導入が飛ばされたり、配当中に次のJPの結果が割り込んだりしない。
  let gateSince=null;
  const blocksChallengeLaunch=()=>{
    const hold=model.active&&!model.chainMode&&(model.payout>0||/^jp_(intro|chance)/.test(model.name??''));
    if(!hold){gateSince=null;return false;}
    gateSince??=model.clock;if(model.clock-gateSince>12)return false;   // 万一の保険: 12秒で必ず解く(導入〜狙いの場面までは約8.3秒。10/29 30秒→12秒)
    return true;
  };
  return {man,model,reserve,pinScenes,get center(){return center;},get active(){return model.active&&model.delay<=0;},get claimed(){return model.active;},get blocksChallengeLaunch(){return blocksChallengeLaunch();},
    warmResults:async()=>{const result=await(compositor?.warmup?.()??{skipped:true,reason:'no-result-compositor'});const boundary=compositor?.warmBoundary?.();return boundary?{...result,boundary}:result;},
    prepareResultFrame:(kind,frame)=>compositor?.prepare(kind,frame)??Promise.resolve(null),
    resultFrameReady:(kind,frame)=>!!compositor?.ready(kind,frame),
    resultDiagnostics:()=>({factory:{...resultFactory,failures:[...resultFactory.failures]},image:compositor?.diagnostics?.()??{kind:'result_compositor_native',scheduler:compositor?.schedulerDiagnostics?.()}}),
    warmStartupRush(ctx,w=1152,h=1268,{afterDraw=()=>{}}={}){
      if(model.active||model.clock!==0||model.serial!==0||current||visible||previous||serial!==-1)throw Error('JP rush warm is boot-only');
      if(startupWarmPromise)return startupWarmPromise;
      const scene=man.scenes.jp_rush;
      if(!scene||scene.layered||scene.offer||scene.result_kind)return Promise.resolve({skipped:true,reason:'not-plain-jp-rush'});
      const slot=slots.find(s=>s.name==='jp_rush')??slots.find(s=>s.name===null);
      if(!slot)return Promise.resolve({skipped:true,reason:'no-empty-slot'});
      startupWarmPromise=(async()=>{
        await load(slot,'jp_rush',false);
        if(!slot.ready)throw Error('JP rush warm video unavailable');
        const result=await withRestored2D(ctx,()=>warmPausedVideo(slot.v,async v=>{
          ctx.drawImage(v,0,0,w,h);await afterDraw(v);
        }));
        // Retain this existing slot/name/ready/promise for ordinary reserve().
        return {name:'jp_rush',...result};
      })().catch(e=>{
        // A failed startup attempt must not poison reserve() with a false-ready cache hit.
        slot.v.pause();slot.name=null;slot.ready=false;slot.promise=null;throw e;
      });
      return startupWarmPromise;
    },
    async warmStartupChain(ctx,w=1152,h=1268,{afterDraw=()=>{}}={}){
      if(model.active||model.clock!==0||model.serial!==0||current||visible||previous||serial!==-1)throw Error('chain warm is boot-only');
      const result=[],one=(slot,name)=>withRestored2D(ctx,()=>warmPausedVideo(slot.v,async v=>{ctx.drawImage(v,0,0,w,h);await afterDraw(v);})).then(r=>({name,...r}));
      if(pinned?.pinned&&pinned.ready)result.push(await one(pinned,'chain_success'));
      for(const x of extraPinned)if(x.pinned&&x.ready)result.push(await one(x,x.pinName));   // 継続告知 v09
      // 配当(reward)は起動時に一度ずつ読み込み・復号し、再生中に初めて触れないようにする。
      for(const name of Object.keys(man.scenes).filter(k=>/^(reward_\d+|tutorial_jp_(n\d|fin))$/.test(k))){   // JPチャンスのチュートリアル(10/30)の映像も起動時に一度復号しておく
        const slot=slots.find(s=>!s.pinned&&s.name===null);if(!slot){result.push({name,skipped:true,reason:'no-empty-slot'});continue;}
        try{await load(slot,name,false);result.push(slot.ready?await one(slot,name):{name,skipped:true,reason:'not-ready'});}
        catch(e){result.push({name,skipped:true,reason:e.message});}
        finally{slot.cancel?.();slot.v.pause();slot.v.removeAttribute('src');slot.v.load();slot.name=null;slot.ready=false;slot.promise=null;}
      }
      return result;
    },
    onEvent(id,p){
      if(center&&id==='jp_mouth'&&p.phase==='cup'){center.settle(p.cup,!!p.unlit);return true;}   // 入った穴で止め直すだけ(場面は動かさない)
      const sustaining=model.active&&model.payout>0;const handled=model.onEvent(id,p);
      if(center){
        if(id==='lamp6'||id==='chain_continue'||id==='challenge_wait'&&p.chain){center.begin();center.aim(model.d);}
        else if(id==='challenge_flight')center.aim(model.d);
        else if(id==='jp_heat'&&p.probs)center.probs(p.probs);
        else if(id==='jp_mouth')center.settle(p.cup??model.d,!!p.unlit);
      }if(id==='fail')digits?.prepare(model.earnings??p.jackpotEarnings??0);if(id==='lamp6'&&handled&&!sustaining){reserve(`fly_in_d${model.d}`);}sync();return handled&&(id!=='lamp6'||sustaining);},
    setManual(on){manual=!!on;palace.setManual(on);for(const s of slots)s.v.pause();},
    async prepare(dt){await palace.prepare(dt);sync();if(!manual||!current||model.delay>0||man.scenes[model.name]?.offer)return;await current.promise;if(!current.ready)return;const t=Math.min(model.time+dt,(man.scenes[model.name].frames-.1)/man.fps);if(Math.abs(current.v.currentTime-t)<1e-5)return;await new Promise(resolve=>{const done=()=>{clearTimeout(timer);current?.v.removeEventListener('seeked',done);resolve();};const timer=setTimeout(done,2000);current.v.addEventListener('seeked',done,{once:true});current.v.currentTime=t;});},
    frame(dt){palace.advance(dt);sync();if(man.scenes[model.name]?.offer){const waiting=getState().phase!=='ChainChoice';const v=offer.frame(palace.video,model.time,waiting);model.update(waiting?0:dt);sync();return v;}stuckWatch(dt);const kind=sResult();if(!kind)blockedFor=0;if(kind&&compositor){const first=kind==='confirm'?84:64;const f=Math.min(man.scenes[model.name].frames-1,Math.floor((current?.v.currentTime??model.time)*man.fps+1e-6));compositor.prefetch(kind,Math.max(first,f));if(f>=first&&!compositor.ready(kind,f)&&(blockedFor+=dt)<1.5){blockedResult=current;if(current&&!current.v.paused)current.v.pause();return visible?.ready&&Math.floor((visible.v.currentTime??0)*man.fps)<first?visible.v:compositor.canvas;}}
      blockedFor=compositor&&kind&&!compositor.ready(kind,Math.max(0,Math.floor((current?.v.currentTime??model.time)*man.fps)))?blockedFor:0;if(blockedResult){blockedResult=null;if(model.active&&!manual&&current?.ready&&model.delay<=0&&current.v.paused&&!current.v.ended)current.v.play().catch(()=>{});}
      {const sk=man.scenes[model.name]?.skip;if(sk&&model.active&&model.delay<=0&&model.serial===serial){const live=!manual&&current?.ready,cf=(live?current.v.currentTime:model.time)*man.fps;for(const [a,b] of sk)if(cf>=a-.01&&cf<b-.01){if(live)current.v.currentTime=(b+.25)/man.fps;else model.time=b/man.fps;break;}}}   // 10/30 演出の短縮: 場面に skip:[[始め,終わり]]（fx_trim_1030.mjs が入れたときだけ。?fxtrim=0 で無し）のコマを飛ばす
      const oldTime=model.time;model.update(current?.ready||model.delay>0?dt:0,manual||model.delay>0?null:current?.ready?current.v.currentTime:model.time);if(current&&model.active&&model.serial===serial&&model.time<oldTime){current.v.currentTime=model.time;if(!manual)current.v.play().catch(()=>{});}sync();if(previous){fade=Math.min(1,fade+Math.min(dt,1/30)/.12);if(fade>=1){previous.v.pause();record('end',{name:previous.name,reason:'crossfade',time:previous.v.currentTime});previous=null;}}if(model.active&&visible?.ready&&man.scenes[visible.name]?.layered){const prior=previous&&man.scenes[previous.name]?.layered?previous.v:null;const vs=man.scenes[visible.name],lf=visible.name===model.name?model.lastF:Math.floor(visible.v.currentTime*man.fps);return palace.render(visible.v,prior,1-fade,visible.name,lf,center&&vs.center?center.stateFor(vs.source_frames[Math.max(0,Math.min(vs.frames-1,lf))],vs,dt):null,!!vs.black_bg);}palace.hidden();if(sResult()&&compositor){const f=Math.min(man.scenes[model.name].frames-1,Math.floor((visible?.v.currentTime??model.time)*man.fps+1e-6));const boundaryOwner={generation:model.serial,serial:model.serial,dim:!!model.where()?.dim};onResultBeforeReuse(boundaryOwner);compositor.setBoundaryOwner?.(boundaryOwner);const result=compositor.render(sResult(),f,Math.max(0,Math.round(model.earnings??0)),model.resultChain??1);if(result){result.readyState=4;return result;}}return visible?.ready?visible.v:null;},
    // Read-only image contract: frame(dt) above is the sole timeline/video owner.
    // Use the actual return/visible source, not a requested scene or pending slot.
    plainVideoSnapshot(video){
      const scene=man.scenes[model.name],shown=man.scenes[visible?.name],old=man.scenes[previous?.name];
      if(!model.active||model.delay>0||!scene||scene.layered||scene.offer||sResult()||digits||model.where()?.dim||!visible?.ready||video!==visible.v||shown?.layered||shown?.offer||shown?.result_kind||previous&&(old?.layered||old?.offer||old?.result_kind))return null;
      const layer=(s,alpha)=>({video:s.v,name:s.name,generation:s.generation??0,alpha,time:s.v.currentTime,drawable:s.v.readyState>=2});
      const layers=[layer(visible,1)];if(previous?.v.readyState>=2)layers.push(layer(previous,1-fade));
      return {owner:'jp-plain',generation:model.serial,serial:model.serial,manual,layers};
    },
    // The returned image, rather than the requested scene, decides the image path.
    // This contract never materializes palace.canvas or advances a media clock.
    palaceBoundarySnapshot(video){
      const scene=man.scenes[model.name],old=man.scenes[previous?.name],w=model.where();
      if(!palace.imageBackend?.boundaryAvailable||!model.active||!scene||scene.layered||scene.offer||digits)return null;
      if(video?.gpuPalaceImage===palace.imageBackend)return {kind:'palace',dim:!!w?.dim,flash:w?.flash,flashColor:w?.flashColor};
      // The injected rawCanvas has no video readyState, so the existing CPU
      // path omits its inner overlay. Keep that displayed result unchanged.
      if(video===visible?.v&&visible?.ready&&video.videoWidth===1152&&video.videoHeight===1268&&(sResult()||previous?.ready&&old?.layered))return {kind:'video',video,manual,innerAlpha:0,dim:!!w?.dim,flash:w?.flash,flashColor:w?.flashColor};
      return null;
    },
    get layered(){return !!man.scenes[model.name]?.layered;},get palace(){return palace;},
    // Light script follows the decoded image actually being presented, even while the next clip loads.
    get lightingCurrent(){return model.active&&model.delay<=0&&visible?.ready?{name:visible.name,time:visible.v.currentTime}:null;},
    get transition(){if(man.scenes[model.name]?.layered||sResult())return null;return previous?{video:man.scenes[previous.name]?.layered?palace.canvas:previous.v,alpha:1-fade}:null;},get lifecycle(){return lifecycle;},
    where:()=>model.where(),drawDigits(ctx){const w=model.where();if(w&&!sResult())digits?.draw(ctx,w);},
    applyLights(F){const w=model.where();if(!w||model.delay>0)return false;const rows=lights[man.scenes[w.name]?.lights_key??w.name],lf=w.f+(man.scenes[w.name]?.lights_from??0);if(rows?.length)F.m3={...rows[Math.min(rows.length-1,lf)],hole:{...rows[Math.min(rows.length-1,lf)].hole,...hole}};
      if(F.m3){F.m3.jp1029=true;F.m3.hole={...F.m3.hole,cup:model.d};}
      if(model.payout>0&&F.m3){if(F.seg)F.seg.meter=[0,0,0,0,0];F.m3.meterLimit=model.revealedAt==null?(model.priorRank??0):(model.priorRank??0)+Math.ceil((model.clock-model.revealedAt)/.15);}
      if(w.name.startsWith('fail')&&w.result?.near_miss&&w.f<12&&F.m3)F.m3.hole={mode:'near_miss',cup:w.result.target,rgb:[.45,.35,.6],gain:Math.sin(Math.PI*w.f/12)};return true;},
    diagnostics(){return [palace.diagnostics(),...slots.map(s=>({name:s.name,ready:s.ready,paused:s.v.paused,dimensions:[s.v.videoWidth,s.v.videoHeight],time:s.v.currentTime,video:(()=>{const q=s.v.getVideoPlaybackQuality?.();return q?{totalVideoFrames:q.totalVideoFrames,droppedVideoFrames:q.droppedVideoFrames}:null;})()}))];},get errors(){return errors.concat(compositor?.errors??[]);},
    dispose(){palace.dispose();compositor?.dispose();digits?.dispose();model.stop('dispose');for(const s of slots){s.cancel?.();s.v.pause();s.v.removeAttribute('src');s.v.load();}},
  };
}
