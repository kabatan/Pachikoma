import {warmPausedVideo,withRestored2D} from './startup_warm.mjs';
// Pure replay of the draw instructions collected by the unchanged player tick.
// Snapshot capture/render must never advance queue, clock, media or fade.
export function drawClipSnapshot(snapshot,ctx,w,h) {
  for(const layer of snapshot.layers){ctx.globalAlpha=layer.alpha;ctx.drawImage(layer.video,0,0,w,h);ctx.globalAlpha=1;}
}
// A bounded decoder pool. Requests are retained in order; the old clip keeps
// moving until the next first frame is decoded, then both move through a fade.
export function createClipPlayer({base, files, onError, record = () => {}}) {
  const pool = [], queue = [], fadeSeconds = .12;
  // 11/1 最適化：使い終わって止まった映像は、次に使われる前に先頭へ巻き戻しておく（始める時の seek で再生が約0.2秒遅れ、頭で落ちていた）。?jpprime=0 で従来
  const PRIME = new URLSearchParams(globalThis.location?.search??'').get('jpprime')!=='0';
  // 11/1 最適化：クロスフェード（0.12秒）の間、出ていく側の映像を止めて最後のコマを保持し、デコードを 1 本に（?fadefreeze=0 で従来＝2 本同時に流す）。入る側が最初のコマを出すまでは出ていく側は動き続ける
  const FREEZE = new URLSearchParams(globalThis.location?.search??'').get('fadefreeze')!=='0';let frozenCur=null;
  // 11/1 不具合修正：8秒で読めなかった映像(s.failed)が同じ名前のまま二度と読み直されず、その演出が以後出ない／再生中の decode error で止まったまま。新しい要求(request/prefetch/setIdle)で失敗した要素を最大2回まで読み直し、current/incoming が error になったら src を読み直す（最大3回）。?cliprecover=0 で従来
  // 11/1 起動修正：遅い回線で idle0 が8秒以内に loadeddata に届かず「idle0 unavailable」で起動失敗／他の映像も諦めて以後出ない。読み込み中(error でなく networkState=LOADING)なら8秒を延ばす（待機映像は最大10回=約90秒、他は2回）。?clipwait=0 で従来
  const CLIPWAIT = new URLSearchParams(globalThis.location?.search??'').get('clipwait')!=='0';
  const RECOVER = new URLSearchParams(globalThis.location?.search??'').get('cliprecover')!=='0';
  let current = null, incoming = null, idleName = 'idle0', fade = 0, manual = false, seq = 0, clock = 0, generation = 0;
  const emit = (kind, data) => record({kind, at: clock, wall: performance.now(), ...data});
  function make() {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto';
    const s = {v, name:null, ready:false, time:0, promise:null, cancel:null, used:0}; pool.push(s);
    v.addEventListener('error', () => {if (s.ready) s.errored = true;});
    v.addEventListener('playing', () => {setTimeout(() => {if (!v.error && !v.paused) s.revives = 0;}, 4000);});
    return s;
  }
  function load(name, avoidCurrent = false, retryFailed = false) {
    let s = pool.find(x => x.name === name && (!avoidCurrent || x !== current));
    const again = RECOVER && retryFailed && !!s && s.failed === true && (s.retries ?? 0) < 2 && s !== current && s !== incoming;
    if (s && !again) {s.used = ++seq; return s;}
    if (!again) s = pool.length < 6 ? make() : pool.filter(x => x !== current && x !== incoming && x.name !== queue[0]?.name && x.name !== idleName).sort((a,b)=>a.used-b.used)[0];
    if (!s) return null;
    s.retries = again ? (s.retries ?? 0) + 1 : 0; s.errored = false; s.reviving = false; s.revives = 0;
    s.cancel?.(); s.v.pause(); s.name = name; s.generation = ++generation; s.ready = false; s.time = 0; s.used = ++seq;
    const started = performance.now(); emit('load', {name});
    s.promise = new Promise(resolve => {
      let timer;
      const cleanup = () => {clearTimeout(timer);s.v.removeEventListener('loadeddata',done);s.v.removeEventListener('error',bad);s.cancel=null;};
      const done = () => {cleanup();s.ready=s.v.readyState>=2;emit('decoded',{name,ms:performance.now()-started});resolve();};
      const bad = () => {cleanup();s.failed=true;onError(`${name}: video load failed`);resolve();};
      s.cancel=()=>{cleanup();resolve();};s.failed=false;
      let waits=0;const arm=()=>{timer=setTimeout(()=>{if(CLIPWAIT&&waits<(name.startsWith('idle')?10:2)&&!s.v.error&&s.v.networkState===2){waits++;arm();return;}bad();},8000);};arm();s.v.addEventListener('loadeddata',done,{once:true});s.v.addEventListener('error',bad,{once:true});
      s.v.src=new URL(files[name],base).href;s.v.loop=name.startsWith('idle');s.v.load();
    });return s;
  }
  function run(s) {if(s && !manual && s.ready && s.v.paused && !s.v.ended && !(s===frozenCur))s.v.play().catch(()=>{});}
  function start(s, request) {
    incoming=s;incoming.time=0;if(!(PRIME&&incoming.v.currentTime<=.001))incoming.v.currentTime=0;fade=0;   // 11/1 先頭にある映像は seek し直さない（?jpprime=0 で従来）
    run(incoming);emit('start',{name:s.name,waitMs:request?(performance.now()-request.wall):0,queue:queue.length});
  }
  function revive(s) {   // 再生中に decode error で止まった映像の src を読み直す
    s.errored=false;s.reviving=true;s.revives=(s.revives??0)+1;s.ready=false;const src=s.v.currentSrc||s.v.src;emit('revive',{name:s.name,n:s.revives});
    const ok=()=>{s.v.removeEventListener('loadeddata',ok);if(!s.reviving)return;s.reviving=false;s.ready=s.v.readyState>=2;try{s.v.currentTime=0;}catch{}};
    s.v.addEventListener('loadeddata',ok,{once:true});
    try{s.v.removeAttribute('src');s.v.load();s.v.src=src;s.v.load();}catch{s.reviving=false;}
  }
  function end(s,reason) {if(!s)return;s.v.pause();emit('end',{name:s.name,time:s.time,mediaTime:s.v.currentTime,reason});}
  return {
    async init() {current=load(idleName);await current.promise;if(!current.ready)throw Error('idle0 unavailable');run(current);},
    request(name) {if(!files[name])return;const r={name,wall:performance.now()};queue.push(r);emit('request',{name,queue:queue.length});load(queue[0].name,true,true);},
    setIdle(name) {if(files[name]&&idleName!==name){idleName=name;load(name,false,true);}},
    prefetch(names) {for(const n of names)if(files[n])load(n,false,true);},
    async warm(ctx,w,h) {
      if(clock!==0||queue.length||incoming)throw Error('normal warm is boot-only');
      const existing=pool.filter(s=>s!==current); // Never interrupt the running idle phase.
      for(const s of existing)await s.promise;
      return withRestored2D(ctx,async()=>{
        const results=[];
        for(const s of existing)results.push({name:s.name,...await warmPausedVideo(s.v,v=>ctx.drawImage(v,0,0,w,h))});
        return results;
      });
    },
    frame(dt,ctx,w,h,hidden=false) {   // hidden: 画面が別の面(待機・説明)に完全に覆われている間は再生中の映像を止める。覆いが外れれば run() が再開する(?attractpause=0 で止めない)
      const snapshot={owner:'normal',generation:0,serial:0,manual,layers:[]};
      const draw=(s,alpha)=>{const layer={video:s.v,name:s.name,generation:s.generation,alpha,time:s.v.currentTime,drawable:true};snapshot.layers.push(layer);if(ctx){ctx.globalAlpha=alpha;ctx.drawImage(s.v,0,0,w,h);ctx.globalAlpha=1;}};
      clock+=dt;
      if(RECOVER&&!manual)for(const s of [current,incoming])if(s&&s.errored&&!s.reviving&&(s.revives??0)<3)revive(s);
      const ended=current && (manual?current.time>=current.v.duration:current.v.ended);
      if(!incoming) {
        const req=queue[0], target=req?.name ?? ((!current || ended || current.name.startsWith('idle')) && current?.name!==idleName?idleName:null);
        if(target){const s=load(target,!!req);if(s?.ready && s!==current){if(req)queue.shift();start(s,req);}else if(s?.failed){if(req)queue.shift();emit('error',{name:target});}}
      }
      if(hidden&&!manual){for(const s of [current,incoming])if(s&&!s.v.paused)s.v.pause();}else{run(current);run(incoming);}
      if(PRIME&&!manual)for(const s of pool)if(s.ready&&s.name!==null&&s!==current&&s!==incoming&&(s.v.paused||s.v.ended)&&!s.v.seeking&&s.v.currentTime>.001){try{s.v.currentTime=0;}catch{}}
      if(current?.ready && current.v.readyState>=2)draw(current,1);
      if(incoming?.ready && !incoming.v.seeking && incoming.v.readyState>=2){
        // The decoder owns realtime. Do not skip a new clip's opening on a slow frame.
        if(FREEZE&&!manual&&current&&frozenCur!==current){try{current.v.pause();}catch{}frozenCur=current;}
        fade+=Math.min(dt,1/30);draw(incoming,Math.min(1,fade/fadeSeconds));
        if(fade>=fadeSeconds){frozenCur=null;end(current,ended?'ended':'crossfade');current=incoming;incoming=null;emit('transition',{name:current.name,seconds:fade});if(queue[0])load(queue[0].name,true);}
      }
      if(manual){if(current)current.time+=dt;if(incoming)incoming.time+=dt;}
      return snapshot;
    },
    get name(){return current?.name;},get time(){return manual?current?.time??0:current?.v.currentTime??0;},get shot(){return current && !current.name.startsWith('idle');},
    get pending(){return queue.length;},
    setManual(on){manual=!!on;for(const s of pool)s.v.pause();},
    async prepare(dt){if(!manual)return;await Promise.all([current,incoming].filter(Boolean).map(async s=>{await s.promise;if(!s.ready || !(s.v.duration>0))return;const t=s.v.loop?(s.time+dt)%s.v.duration:Math.min(s.time+dt,s.v.duration-.003);if(Math.abs(s.v.currentTime-t)<.0001)return;await new Promise(resolve=>{const done=()=>{clearTimeout(timer);s.v.removeEventListener('seeked',done);resolve();};const timer=setTimeout(done,2000);s.v.addEventListener('seeked',done,{once:true});s.v.currentTime=t;});}));},
    pause(){for(const s of pool)s.v.pause();},
    suspend(){
      for(const r of queue)emit('cancel',{name:r.name,reason:'superseded-by-jp-before-start',waitMs:performance.now()-r.wall});
      queue.length=0;end(current,'crossfade-to-jp');end(incoming,'crossfade-to-jp');
      frozenCur=null;current=incoming=null;for(const s of pool)s.v.pause();
    },
    diagnostics(){return pool.map(s=>({name:s.name,ready:s.ready,time:s.v.currentTime,quality:s.v.getVideoPlaybackQuality?.()}));},
    dispose(){for(const s of pool){s.cancel?.();s.v.pause();s.v.removeAttribute('src');s.v.load();}},
  };
}
