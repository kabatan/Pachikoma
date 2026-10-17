import assert from 'node:assert/strict';
import { SessionLog } from './session_log.mjs';
const oldFetch=globalThis.fetch, oldStorage=globalThis.localStorage, storage=new Map();
globalThis.localStorage={getItem:(k)=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
try {
  let active=0,maximum=0; const rows=[];
  globalThis.fetch=async (_url,opts)=>{
    active++; maximum=Math.max(maximum,active); rows.push(JSON.parse(opts.body).detail.n);
    assert(!opts.keepalive);
    return {ok:true,text:async()=>{await new Promise((r)=>setTimeout(r,1));active--;return '';}};
  };
  const a=new SessionLog(); for(let n=0;n<20;n++) a.write('physics',{n});
  await a.flush(); assert.equal(maximum,1); assert.deepEqual(rows,Array.from({length:20},(_,i)=>i));
  assert.deepEqual(a.stats,{httpWrites:20,httpFailures:0,localWrites:0,pending:0});
  let calls=0; globalThis.fetch=async()=>{calls++;return {ok:false,status:500};};
  const b=new SessionLog(); for(let n=0;n<3;n++) b.write('physics',{n}); await b.flush();
  assert.equal(calls,1); assert.equal(b.stats.httpFailures,1); assert.equal(b.stats.localWrites,3); assert.equal(b.stats.pending,0);
  assert.equal(JSON.parse(storage.get('medal-session-log')).length,3);
  assert.deepEqual(JSON.parse(storage.get('medal-session-log')).map((r)=>r.detail.n),[0,1,2]);
  const c=new SessionLog({sink:()=>{}}); for(let n=0;n<2005;n++) c.write('physics',{n});
  assert.equal(c.lines.length,2000); assert.equal(c.lines[0].detail.n,5);
  console.log(JSON.stringify({ordered_http_rows:20,max_concurrent:maximum,fallback_rows:3,memory_limit:2000}));
} finally {globalThis.fetch=oldFetch;globalThis.localStorage=oldStorage;}
