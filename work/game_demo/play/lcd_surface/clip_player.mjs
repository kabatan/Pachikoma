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
  let current = null, incoming = null, idleName = 'idle0', fade = 0, manual = false, seq = 0, clock = 0, generation = 0;
  const emit = (kind, data) => record({kind, at: clock, wall: performance.now(), ...data});
  function make() {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto';
    const s = {v, name:null, ready:false, time:0, promise:null, cancel:null, used:0}; pool.push(s); return s;
  }
  function load(name, avoidCurrent = false) {
    let s = pool.find(x => x.name === name && (!avoidCurrent || x !== current));
    if (s) {s.used = ++seq; return s;}
    s = pool.length < 6 ? make() : pool.filter(x => x !== current && x !== incoming && x.name !== queue[0]?.name && x.name !== idleName).sort((a,b)=>a.used-b.used)[0];
    if (!s) return null;
    s.cancel?.(); s.v.pause(); s.name = name; s.generation = ++generation; s.ready = false; s.time = 0; s.used = ++seq;
    const started = performance.now(); emit('load', {name});
    s.promise = new Promise(resolve => {
      let timer;
      const cleanup = () => {clearTimeout(timer);s.v.removeEventListener('loadeddata',done);s.v.removeEventListener('error',bad);s.cancel=null;};
      const done = () => {cleanup();s.ready=s.v.readyState>=2;emit('decoded',{name,ms:performance.now()-started});resolve();};
      const bad = () => {cleanup();s.failed=true;onError(`${name}: video load failed`);resolve();};
      s.cancel=()=>{cleanup();resolve();};s.failed=false;
      timer=setTimeout(bad,8000);s.v.addEventListener('loadeddata',done,{once:true});s.v.addEventListener('error',bad,{once:true});
      s.v.src=new URL(files[name],base).href;s.v.loop=name.startsWith('idle');s.v.load();
    });return s;
  }
  function run(s) {if(s && !manual && s.ready && s.v.paused && !s.v.ended)s.v.play().catch(()=>{});}
  function start(s, request) {
    incoming=s;incoming.time=0;incoming.v.currentTime=0;fade=0;
    run(incoming);emit('start',{name:s.name,waitMs:request?(performance.now()-request.wall):0,queue:queue.length});
  }
  function end(s,reason) {if(!s)return;s.v.pause();emit('end',{name:s.name,time:s.time,mediaTime:s.v.currentTime,reason});}
  return {
    async init() {current=load(idleName);await current.promise;if(!current.ready)throw Error('idle0 unavailable');run(current);},
    request(name) {if(!files[name])return;const r={name,wall:performance.now()};queue.push(r);emit('request',{name,queue:queue.length});load(queue[0].name,true);},
    setIdle(name) {if(files[name]&&idleName!==name){idleName=name;load(name);}},
    prefetch(names) {for(const n of names)if(files[n])load(n);},
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
    frame(dt,ctx,w,h) {
      const snapshot={owner:'normal',generation:0,serial:0,manual,layers:[]};
      const draw=(s,alpha)=>{const layer={video:s.v,name:s.name,generation:s.generation,alpha,time:s.v.currentTime,drawable:true};snapshot.layers.push(layer);if(ctx){ctx.globalAlpha=alpha;ctx.drawImage(s.v,0,0,w,h);ctx.globalAlpha=1;}};
      clock+=dt;
      const ended=current && (manual?current.time>=current.v.duration:current.v.ended);
      if(!incoming) {
        const req=queue[0], target=req?.name ?? ((!current || ended || current.name.startsWith('idle')) && current?.name!==idleName?idleName:null);
        if(target){const s=load(target,!!req);if(s?.ready && s!==current){if(req)queue.shift();start(s,req);}else if(s?.failed){if(req)queue.shift();emit('error',{name:target});}}
      }
      run(current);run(incoming);
      if(current?.ready && current.v.readyState>=2)draw(current,1);
      if(incoming?.ready && !incoming.v.seeking && incoming.v.readyState>=2){
        // The decoder owns realtime. Do not skip a new clip's opening on a slow frame.
        fade+=Math.min(dt,1/30);draw(incoming,Math.min(1,fade/fadeSeconds));
        if(fade>=fadeSeconds){end(current,ended?'ended':'crossfade');current=incoming;incoming=null;emit('transition',{name:current.name,seconds:fade});if(queue[0])load(queue[0].name,true);}
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
      current=incoming=null;for(const s of pool)s.v.pause();
    },
    diagnostics(){return pool.map(s=>({name:s.name,ready:s.ready,time:s.v.currentTime,quality:s.v.getVideoPlaybackQuality?.()}));},
    dispose(){for(const s of pool){s.cancel?.();s.v.pause();s.v.removeAttribute('src');s.v.load();}},
  };
}
