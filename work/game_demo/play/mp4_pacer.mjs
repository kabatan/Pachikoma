import { open } from 'node:fs/promises';
export const MiB=1024*1024;
export const PACING=Object.freeze({streamRate:12*MiB,aggregateRate:24*MiB,initialPerRequest:MiB,initialAggregate:2*MiB,steadyPerStream:512*1024,steadyAggregate:1024*1024,chunk:256*1024,maxReaders:4});
export function createMp4Pacer({audit=false,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,openFile=open}={}) {
  const C=PACING, flows=new Map(),pendingCleanups=new Set(),order=[],events=[],finished=[],limits={events:32768,finished:1024};
  let initial=C.initialAggregate,steady=0,last=now(),timer=null,pumping=false,again=false,cursor=0,nextId=0,openReaders=0,peakReaders=0,dropped=0,droppedEvents=0,droppedReceipts=0,closing=false,closePromise=null;
  const totals={written:0,failedChargedBytes:0,initialDebited:0,steadyDebited:0,completed:0,aborted:0,failed:0,reads:0,writeFalse:0,closeErrors:0,lateErrors:0,lateErrorsAfterComplete:0};
  const record=(kind,f,data={})=>{if(!audit)return;if(events.length===limits.events){dropped++;droppedEvents++;return;}events.push({at:now(),kind,id:f?.id,...data});};
  function refill(t) {
    const add=C.aggregateRate*Math.max(0,t-last)/1000;last=t;
    const toSteady=Math.min(C.steadyAggregate-steady,add);steady+=toSteady;
    initial=Math.min(initial+add-toSteady,C.initialAggregate-steady);
    // One shared refill budget, total<=2MiB. Filling steady may discard old initial credit.
    for(const f of flows.values()){f.credit=Math.min(C.steadyPerStream,f.credit+C.streamRate*Math.max(0,t-f.last)/1000);f.last=t;}
  }
  const bytesWanted=f=>Math.min(C.chunk,f.end-f.position+1);
  function allocation(f,n) {
    const prefix=Math.max(0,Math.min(n,C.initialPerRequest-f.written));
    const fromInitial=Math.min(prefix,Math.floor(initial+1e-7)),fromSteady=n-fromInitial;
    return {fromInitial,fromSteady,allowed:steady+1e-7>=fromSteady&&f.credit+1e-7>=fromSteady};
  }
  function clearWake(){if(timer!==null){clearTimer(timer);timer=null;}}
  function releaseReader(f) {
    if(f.closePromise)return f.closePromise;
    if(!f.handle)return Promise.resolve();
    const handle=f.handle;f.handle=null;
    f.closePromise=Promise.resolve().then(()=>handle.close()).catch(error=>{totals.closeErrors++;f.closeError=error.message;if(f.receipt)f.receipt.closeError=error.message;record('close-error',f,{error:error.message});}).finally(()=>{openReaders--;record('fd-closed',f);pump();});
    return f.closePromise;
  }
  function stopFlow(f,kind,error) {
    if(f.closed)return f.done;
    f.closed=true;f.buffer=null;flows.delete(f.id);const at=order.indexOf(f.id);if(at>=0){order.splice(at,1);if(at<cursor)cursor--;if(cursor>=order.length)cursor=0;}
    f.req.off('aborted',f.onAbort);f.res.off('close',f.onClose);f.res.off('error',f.onError);f.res.off('drain',f.onDrain);f.res.off('finish',f.onFinish);
    f.res.on('error',error=>{totals.lateErrors++;if(kind==='complete')totals.lateErrorsAfterComplete++;record('late-error',f,{terminalKind:kind,error:error.message});});
    totals[kind==='complete'?'completed':kind==='abort'?'aborted':'failed']++;
    const receipt={id:f.id,kind,start:f.start,end:f.end,written:f.written,failedChargedBytes:f.failedChargedBytes,initialDebited:f.initialDebited,steadyDebited:f.steadyDebited,error:error?.message,closeError:f.closeError};f.receipt=receipt;
    if(finished.length===limits.finished){finished.shift();dropped++;droppedReceipts++;}finished.push(receipt);record('flow-'+kind,f,receipt);
    const close=releaseReader(f);
    // An in-flight open/read is allowed to settle, but closed forbids all later read/write.
    f.done=Promise.allSettled([close,f.openPromise,f.readPromise].filter(Boolean)).then(async()=>{await releaseReader(f);if(kind==='complete')f.resolve(receipt);else f.reject(error??new Error('MP4 response aborted'));});
    pendingCleanups.add(f.done);f.done.then(()=>pendingCleanups.delete(f.done),()=>pendingCleanups.delete(f.done));
    clearWake();pump();return f.done;
  }
  function fail(f,error){if(!f.closed){void stopFlow(f,'failure',error);f.res.once('error',()=>{});f.res.destroy(error);}}
  function beginOpen(f) {
    f.opening=true;openReaders++;peakReaders=Math.max(peakReaders,openReaders);record('fd-opening',f);
    f.openPromise=Promise.resolve().then(()=>openFile(f.path,'r')).then(handle=>{f.opening=false;f.handle=handle;record('fd-open',f);if(f.closed)return releaseReader(f);pump();}).catch(error=>{f.opening=false;openReaders--;fail(f,error);pump();});
  }
  function beginRead(f) {
    const length=bytesWanted(f),buffer=Buffer.allocUnsafe(length);f.reading=true;totals.reads++;record('read-start',f,{length,position:f.position});
    const handle=f.handle;
    f.readPromise=Promise.resolve().then(async()=>{let filled=0;while(filled<length){if(f.closed)return null;const r=await handle.read(buffer,filled,length-filled,f.position+filled);if(!(r.bytesRead>0))throw new Error('Unexpected MP4 EOF');filled+=r.bytesRead;}return filled;}).then(bytesRead=>{
      f.reading=false;record('read-end',f,{bytesRead});if(f.closed)return;
      if(bytesRead!==length)throw new Error('Unexpected MP4 EOF: '+bytesRead+'/'+length);
      f.buffer=buffer;pump();
    }).catch(error=>{f.reading=false;fail(f,error);});
  }
  function writeChunk(f) {
    const n=f.buffer.length,a=allocation(f,n);if(!a.allowed)return false;
    initial-=a.fromInitial;steady-=a.fromSteady;f.credit-=a.fromSteady;
    f.initialDebited+=a.fromInitial;f.steadyDebited+=a.fromSteady;totals.initialDebited+=a.fromInitial;totals.steadyDebited+=a.fromSteady;
    const buffer=f.buffer;f.buffer=null;
    try {
      const accepted=f.res.write(buffer);f.written+=n;f.position+=n;totals.written+=n;
      record('write',f,{bytes:n,written:f.written,initial:a.fromInitial,steady:a.fromSteady,globalInitial:initial,globalSteady:steady,streamCredit:f.credit,accepted});
      if(!accepted){f.draining=true;totals.writeFalse++;record('drain-wait',f);}
      if(f.position>f.end){f.ending=true;void releaseReader(f);f.res.end();}
    }catch(error){f.failedChargedBytes+=n;totals.failedChargedBytes+=n;record('write-failed-charged',f,{bytes:n,error:error.message});fail(f,error);return false;}
    return true;
  }
  function schedule() {
    if(timer!==null||!flows.size||closing)return;
    let wait=Infinity;
    for(const f of flows.values()) {
      if(f.closed||f.ending||f.draining||f.opening||f.reading||(!f.handle&&openReaders>=C.maxReaders))continue;
      const n=f.buffer?.length??bytesWanted(f),a=allocation(f,n);
      if(a.allowed){again=true;continue;}
      const globalWait=Math.max(0,a.fromSteady-steady)/C.aggregateRate*1000;
      const streamWait=Math.max(0,a.fromSteady-f.credit)/C.streamRate*1000;
      wait=Math.min(wait,Math.max(globalWait,streamWait));
    }
    if(Number.isFinite(wait))timer=setTimer(()=>{timer=null;pump();},Math.max(1,Math.ceil(wait)));
  }
  function pump() {
    if(pumping){again=true;return;}pumping=true;again=false;clearWake();refill(now());
    try {
      // One round-robin quantum per flow per pass. File reads yield asynchronously.
      const scan=[...order],count=scan.length,start=count?cursor%count:0;
      for(let k=0;k<count;k++){
        const f=flows.get(scan[(start+k)%count]);if(!f||f.closed||f.ending||f.draining)continue;
        if(!f.handle&&!f.opening){if(openReaders<C.maxReaders)beginOpen(f);continue;}
        if(f.opening||f.reading)continue;
        if(f.buffer){const beforeIndex=order.indexOf(f.id);if(writeChunk(f)&&order.length){const still=order.indexOf(f.id);cursor=still>=0?(still+1)%order.length:beforeIndex%order.length;}}
        // The next scan starts AFTER the last actual grant, not after an N-flow traversal.
        if(!f.closed&&!f.ending&&!f.draining&&!f.buffer&&!f.reading&&f.handle&&allocation(f,bytesWanted(f)).allowed)beginRead(f);
      }
    } finally {pumping=false;schedule();}
    // Only an already-eligible transition requests a microtask. No timer polling or busy wait.
    if(again){again=false;queueMicrotask(pump);}
  }
  function send(req,res,{path,start,end}) {
    if(closing)return Promise.reject(new Error('Pacer closing'));
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start)return Promise.reject(new Error('Invalid resolved MP4 range'));
    let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});
    const f={id:++nextId,path,start,end,position:start,written:0,failedChargedBytes:0,initialDebited:0,steadyDebited:0,credit:0,last:now(),req,res,resolve,reject,closed:false,opening:false,reading:false,draining:false,ending:false,handle:null,buffer:null};
    f.onAbort=()=>{const error=new Error('MP4 request aborted');error.code='ABORT_ERR';void stopFlow(f,'abort',error);res.destroy();};
    f.onClose=()=>{if(!res.writableFinished)f.onAbort();};f.onError=error=>fail(f,error);
    f.onDrain=()=>{if(!f.closed){f.draining=false;record('drain',f);pump();}};
    f.onFinish=()=>{void stopFlow(f,'complete');};
    req.once('aborted',f.onAbort);res.once('close',f.onClose);res.once('error',f.onError);res.on('drain',f.onDrain);res.once('finish',f.onFinish);
    flows.set(f.id,f);order.push(f.id);record('flow-open',f,{start,end,path});
    if(req.aborted||res.destroyed)f.onAbort();else pump();return promise;
  }
  const snapshot=()=>({config:C,at:now(),globalInitial:initial,globalSteady:steady,openReaders,peakReaders,activeFlows:flows.size,pendingCleanups:pendingCleanups.size,queueLength:order.length,timerActive:timer!==null,dropped,droppedEvents,droppedReceipts,totals:{...totals},flows:[...flows.values()].map(f=>({id:f.id,written:f.written,opening:f.opening,reading:f.reading,draining:f.draining,ending:f.ending,buffered:f.buffer?.length??0,hasHandle:!!f.handle})),finished:[...finished],events:[...events]});
  return {send,snapshot,close(){
    if(closePromise)return closePromise;
    let resolveClose,rejectClose;closePromise=new Promise((resolve,reject)=>{resolveClose=resolve;rejectClose=reject;});
    closing=true;clearWake();
    // stopFlow registers all pending open/read/close completion, including Map-removed flows.
    for(const f of [...flows.values()]){void stopFlow(f,'abort',new Error('Pacer shutdown'));f.res.destroy();}
    void(async()=>{while(pendingCleanups.size)await Promise.allSettled([...pendingCleanups]);return snapshot();})().then(resolveClose,rejectClose);
    return closePromise;
  }};
}
