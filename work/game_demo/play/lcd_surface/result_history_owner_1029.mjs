// Result history coordinator: no media/model/clock advancement. References and boundaries only.
export function createResultHistoryOwner({manager,backend,ctx,hold,previous}){
 let disposed=false,published=null,pin=null,bridge=null,owned=false,frames=0,alpha=0;
 const stats={publishes:0,pins:0,captures:0,historyFrames:0,cpuFallbacks:[],failures:[],releases:0};
 const same=(a,b)=>a&&b&&['generation','serial','revision','kind','frame','value','chain'].every(k=>a[k]===b[k]);
 const release=name=>{const v=name==='pin'?pin:bridge;if(v){v.release();stats.releases++;}if(name==='pin')pin=null;else bridge=null;};
 const fail=reason=>{stats.failures.push(reason);throw Error('Result history owner: '+reason);};
 function fromLease(lease,dest,reason){const out=manager.materializeLease(lease,{...dest,reason});if(!out)fail('lease restoration failed: '+reason);return out;}
 function producerFallback(reason){if(pin){fromLease(pin,{panelCtx:ctx,heldCtx:hold},reason);release('pin');}
  else if(published){const s=published.backend.boundarySource?.();if(!same(s,published.stamp))fail('old published revision no longer available: '+reason);const out=published.backend.materializeTo({panelCtx:ctx,heldCtx:hold,reason});if(!out||published.backend.diagnostics?.().failed)fail('old producer restoration failed: '+reason);}
  else return false;stats.cpuFallbacks.push(reason);published=null;return true;
 }
 function acquire(){if(pin)return pin.retain();if(!published)return null;const s=published.backend.boundarySource?.();if(!same(s,published.stamp)||s.flashAlpha!==0||s.dim)return null;return published.backend.captureCleanPanel({expectedRevision:s.revision,expectedGeneration:s.generation,reason:'result-history-exit'});}
 function fallback(reason,{includeBridge=false,panelCtx=ctx,heldCtx=hold}={}){
  if(!owned)return null;stats.cpuFallbacks.push(reason);let out;
  if(frames===0&&bridge){out=fromLease(bridge,{panelCtx,heldCtx},reason);}
  else{out=backend.materializeHistoryTo({panelCtx,heldCtx,includeBridge,reason});if(!out)fail('completed history restoration failed: '+reason);}
  // Continuing original inner fade needs the old transition, separately from raw
  // H_t and its ring/flash. A rebridge instead requested the actual composed panel.
  if(!includeBridge&&bridge)fromLease(bridge,{panelCtx:previous},reason+'-transition');
  backend.endResultHistory();owned=false;frames=0;release('bridge');published=null;return out;
 }
 const api={
  get active(){return owned;},get bridgeActive(){return !!bridge;},
  notePublished(b){const stamp=b?.boundarySource?.();if(!stamp||stamp.flashAlpha!==0||stamp.dim||b.getComposedPanelContext?.()!==manager.context){published=null;return;}if(pin&&!same(pin.stamp,stamp))release('pin');published={backend:b,stamp:{...stamp}};stats.publishes++;},
  resultFrame(b){let value=false;return {backend:b,owner:'jp-result',get published(){return value;},set published(v){value=!!v;if(value)api.notePublished(b);}};},
  clearPublished(){published=null;release('pin');},
  beforeReuse(next){if(!published||published.stamp.generation===next.generation&&published.stamp.serial===next.serial)return null;if(pin&&same(pin.stamp,published.stamp))return {pinned:true};const x=acquire();if(x){release('pin');pin=x;stats.pins++;return {pinned:true};}return producerFallback('before-reuse-capture-failed')?{cpu:true}:null;},
  begin({blocked=false}={}){
   if(disposed)return null;if(owned){fallback('rebridge',{includeBridge:true});return 'cpu';}
   if(blocked)return producerFallback('choice-or-covered')?'cpu':null;
   const lease=acquire();if(!lease){if(published||pin)return producerFallback('capture-unavailable')?'cpu':null;return null;}
   let seeded=false;try{seeded=backend.seedResultHistory(lease);if(!seeded)throw Error('Video history rejected clean seed');if(backend.setResultBridge({lease,alpha:1})===false)throw Error('Video history rejected bridge');}
   catch(error){try{backend.endResultHistory();}catch(cleanup){stats.failures.push('seed cleanup: '+String(cleanup.message??cleanup));}lease.release();stats.failures.push(String(error.message??error));return producerFallback('seed-unavailable')?'cpu':null;}
   bridge=lease;release('pin');published=null;owned=true;frames=0;alpha=1;stats.captures++;return 'gpu';
  },
  afterRender(value){if(!owned)return false;alpha=value;frames++;stats.historyFrames++;
   if(bridge){if(alpha>0){if(backend.setResultBridge({lease:bridge,alpha})===false)fail('video history rejected active bridge');}else{backend.clearResultBridge();release('bridge');}}
   const h=backend.historyDiagnostics();if(!bridge&&!h.dependent&&!h.seedPending){backend.endResultHistory();owned=false;frames=0;}return owned;
  },
  fallback,
  diagnostics(){return {...stats,cpuFallbacks:[...stats.cpuFallbacks],failures:[...stats.failures],active:owned,frames,alpha,published:published?{...published.stamp}:null,pin:pin?{...pin.stamp}:null,bridge:bridge?{...bridge.stamp}:null,disposed};},
  dispose(){if(disposed)return;disposed=true;try{if(owned)backend.endResultHistory();}finally{owned=false;release('bridge');release('pin');published=null;}}
 };
 return api;
}
