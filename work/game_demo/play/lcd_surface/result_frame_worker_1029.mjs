// Optional result-frame decoder candidate. Parent owns Worker lifetime/termination.
// prepare: {type:'prepare', id, basesUrl, kind:'fail'|'confirm', frame, keyframes?}
// ready:   {type:'ready', id, kind, frame, buffer, stats}; buffer is complete RCP1.
// keyframes defaults to 64,72,...144; extra keys are also discovered in packets.
const FIRST=64,LAST=149,INTERVAL=8,MAX_CACHE=8,MAX_CACHE_BYTES=16*1024*1024;
const compressed=new Map(),fetching=new Map();let compressedBytes=0,last=null,queue=Promise.resolve();
const magic=(buffer,name)=>{const bytes=new Uint8Array(buffer,0,Math.min(4,buffer.byteLength));return bytes.length===4&&bytes.every((v,i)=>v===name.charCodeAt(i));};
function validateRcp(buffer){
 if(!magic(buffer,'RCP1')||buffer.byteLength<40)throw Error('Invalid RCP1 frame');
 const h=new DataView(buffer),version=h.getUint16(4,true),header=h.getUint16(6,true),w=h.getUint16(8,true),height=h.getUint16(10,true),x=h.getUint16(12,true),y=h.getUint16(14,true),rw=h.getUint16(16,true),rh=h.getUint16(18,true),count=h.getUint32(28,true),flags=h.getUint16(32,true);
 if(version!==1||header!==40||w!==1152||height!==1268||flags&~1||count!==w*height*(flags&1?4:3)||x+rw>w||y+rh>height||buffer.byteLength!==header+count*2+rw*rh*8)throw Error('Invalid RCP1 frame dimensions');
}
async function packet(url,stats){
 let bytes=compressed.get(url);
 if(bytes){compressed.delete(url);compressed.set(url,bytes);stats.cacheHits++;}
 else{
  let job=fetching.get(url);
  if(job)stats.sharedFetches=(stats.sharedFetches??0)+1;
  else{
   job=(async()=>{const r=await fetch(url);if(!r.ok)throw Error('Result frame HTTP '+r.status+' '+url);
    const loaded=await r.arrayBuffer();stats.fetched++;stats.fetchedBytes+=loaded.byteLength;
    if(loaded.byteLength<=MAX_CACHE_BYTES){compressed.set(url,loaded);compressedBytes+=loaded.byteLength;while(compressed.size>MAX_CACHE||compressedBytes>MAX_CACHE_BYTES){const key=compressed.keys().next().value;compressedBytes-=compressed.get(key).byteLength;compressed.delete(key);}}return loaded;})();
   fetching.set(url,job);job.finally(()=>fetching.delete(url)).catch(()=>{});
  }
  bytes=await job;
 }
 const stream=new Response(bytes).body.pipeThrough(new DecompressionStream('deflate'));
 const raw=await new Response(stream).arrayBuffer();stats.inflated++;return raw;
}
async function prepare(request){
 const {id,basesUrl,kind='fail',frame}=request;
 if(kind!=='fail'||!Number.isInteger(frame)||frame<FIRST||frame>LAST)throw Error('Worker supports fail frames 64..149');
 const base=new URL(basesUrl);if(!base.pathname.endsWith('/'))base.pathname+='/';
 const keys=request.keyframes??Array.from({length:Math.floor((LAST-FIRST)/INTERVAL)+1},(_,i)=>FIRST+i*INTERVAL);
 if(!Array.isArray(keys)||!keys.includes(FIRST)||keys.some(k=>!Number.isInteger(k)||k<FIRST||k>LAST))throw Error('Invalid result keyframes');
 const key=Math.max(...keys.filter(k=>k<=frame));if(frame-key>=INTERVAL)throw Error('Result delta chain exceeds seven frames');
 const scope=base.href+'|'+kind,stats={fetched:0,fetchedBytes:0,cacheHits:0,inflated:0,deltas:0,keys:0};
 if(!last||last.scope!==scope||last.frame>frame||last.frame<key)last=null;
 let start=last?last.frame+1:key;
 for(let f=start;f<=frame;f++){
  const url=new URL(`${kind}/${String(f).padStart(3,'0')}.bin`,base).href,raw=await packet(url,stats);
  if(magic(raw,'RCP1')){validateRcp(raw);last={scope,frame:f,buffer:raw};stats.keys++;}
  else if(magic(raw,'RCD1')){
   if(raw.byteLength<8)throw Error('Truncated RCD1 frame');const h=new DataView(raw),previous=h.getUint16(4,true);
   if(h.getUint16(6,true)!==0||previous!==f-1||!last||last.frame!==previous||raw.byteLength!==last.buffer.byteLength+8||last.buffer.byteLength%4)throw Error('Invalid RCD1 dependency');
   const out=new Uint32Array(last.buffer),delta=new Uint32Array(raw,8);for(let i=0;i<out.length;i++)out[i]^=delta[i];
   validateRcp(last.buffer);last.frame=f;stats.deltas++;
  }else throw Error('Unknown result frame packet');
 }
 if(!last||last.frame!==frame)throw Error('Result frame unavailable');
 // Keep one private predecessor. Only the outbound copy leaves this Worker.
 const buffer=last.buffer.slice(0);stats.compressedCacheEntries=compressed.size;stats.compressedCacheBytes=compressedBytes;
 self.postMessage({type:'ready',id,kind,frame,buffer,stats},[buffer]);
}
function restoreShuffledConfirm(raw){
 if(!magic(raw,'RCS1'))return raw;
 if(raw.byteLength<40)throw Error('Truncated RCS1 frame');
 const h=new DataView(raw),count=h.getUint32(28,true),flags=h.getUint16(32,true),channels=flags&1?4:3;
 if(h.getUint16(4,true)!==1||h.getUint16(6,true)!==40||flags>1||count!==1152*1268*channels||raw.byteLength<40+count*2||(raw.byteLength-40-count*2)%8)throw Error('Invalid RCS1 frame layout');
 const buffer=new ArrayBuffer(raw.byteLength),src=new Uint8Array(raw),dst=new Uint8Array(buffer);dst.set(src.subarray(0,40));dst.set([82,67,80,49]);
 const sections=[{at:40,pixels:count/channels,channels},{at:40+count*2,pixels:(raw.byteLength-40-count*2)/8,channels:4}];
 for(const s of sections){
  const out=new Uint16Array(buffer,s.at,s.pixels*s.channels),n=s.pixels,p=s.at;
  if(s.channels===3){for(let i=0;i<n;i++){const j=i*3;out[j]=src[p+i]|src[p+n+i]<<8;out[j+1]=src[p+2*n+i]|src[p+3*n+i]<<8;out[j+2]=src[p+4*n+i]|src[p+5*n+i]<<8;}}
  else{for(let i=0;i<n;i++){const j=i*4;out[j]=src[p+i]|src[p+n+i]<<8;out[j+1]=src[p+2*n+i]|src[p+3*n+i]<<8;out[j+2]=src[p+4*n+i]|src[p+5*n+i]<<8;out[j+3]=src[p+6*n+i]|src[p+7*n+i]<<8;}}
 }
 return buffer;
}
// Confirm has independent frames: consume HTTP bytes directly, without a
// compressed-buffer cache. Keep only an in-flight result for duplicate callers.
const confirmStreams=new Map();
async function streamConfirm(url,stats){
 let job=confirmStreams.get(url);
 if(job){job.waiters++;stats.sharedConfirm=1;}
 else{
  job={waiters:1,promise:null};
  job.promise=(async()=>{
   const r=await fetch(url);if(!r.ok)throw Error('Result frame HTTP '+r.status+' '+url);if(!r.body)throw Error('Result frame body unavailable');
   stats.fetched++;stats.fetchedBytes=Number(r.headers.get('content-length'))||0;
   const raw=await new Response(r.body.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();stats.inflated++;return raw;
  })();
  confirmStreams.set(url,job);job.promise.finally(()=>{if(confirmStreams.get(url)===job)confirmStreams.delete(url);}).catch(()=>{});
 }
 const raw=await job.promise;return {raw,shared:job.waiters>1};
}
async function prepareConfirm({id,basesUrl,frame}){
 if(!Number.isInteger(frame)||frame<84||frame>213)throw Error('Worker supports confirm frames 84..213');
 const base=new URL(basesUrl);if(!base.pathname.endsWith('/'))base.pathname+='/';
 const stats={fetched:0,fetchedBytes:0,cacheHits:0,inflated:0,deltas:0,keys:0};
 const {raw,shared}=await streamConfirm(new URL(`confirm/${String(frame).padStart(3,'0')}.bin`,base).href,stats);
 let buffer=restoreShuffledConfirm(raw);stats.unshuffled=buffer!==raw;
 if(buffer===raw&&shared)buffer=raw.slice(0);
 validateRcp(buffer);stats.keys=1;stats.compressedCacheEntries=compressed.size;stats.compressedCacheBytes=compressedBytes;
 // Independent lookahead requests are capped by the caller. No fail queue or copy.
 self.postMessage({type:'ready',id,kind:'confirm',frame,buffer,stats},[buffer]);
}
self.addEventListener('message',({data})=>{
 if(data?.type!=='prepare')return;
 if(data.kind==='confirm'){prepareConfirm(data).catch(error=>self.postMessage({type:'error',id:data.id,message:String(error?.message??error)}));return;}
 queue=queue.then(()=>prepare(data)).catch(error=>{last=null;self.postMessage({type:'error',id:data.id,message:String(error?.message??error)});});
});
