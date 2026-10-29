// CPU-only ownership candidate. The caller supplies the synchronous GL copy.
// This module creates no GL resources, canvases, videos, timers or fences.
export const CAPTURE_POLICIES=Object.freeze({
 'interrupt-clean':Object.freeze({view:'visible',timer:'omit',countdownPatch:'keep',countdownDigit:'omit',total:'omit'}),
 'handoff-keep':Object.freeze({view:'visible',timer:'omit',countdownPatch:'keep',countdownDigit:'keep-completed',total:'keep-completed'}),
 'handoff-stop-zero':Object.freeze({view:'visible',timer:'omit',countdownPatch:'keep',countdownDigit:'require-completed-zero',total:'keep-completed'}),
 'bridge-clean':Object.freeze({view:'panel',timer:'omit',countdownPatch:'owner-completed',countdownDigit:'owner-completed',total:'owner-completed'}),
});
const size=view=>view==='panel'?{width:1240,height:1510}:{width:1152,height:1268};
export function createCaptureLeaseStore({context,copyCompleted,maxLive=2}={}){
 if(!context||typeof copyCompleted!=='function'||copyCompleted.constructor.name==='AsyncFunction')throw Error('Existing context and synchronous copyCompleted required');
 if(!Number.isInteger(maxLive)||maxLive<1||maxLive>2)throw Error('Capture lease bound must be 1 or 2');
 const entries=new Set();let closed=false,nextId=0,lastFailure=null;
 const stats={copies:0,capacityMisses:0,unsupported:0,copyFailures:0,liveMax:0,releases:0,releaseFailures:0,cpuReads:0,cpuReadHits:0,cpuReadFailures:0};
 const fail=(why,key='unsupported')=>{lastFailure=why;stats[key]++;return null;};
 const ownerRelease=resource=>{try{resource?.release?.();}catch{stats.releaseFailures++;}};
 const releaseEntry=entry=>{if(entry.dead)return;entry.dead=true;entries.delete(entry);ownerRelease(entry.resource);stats.releases++;ownerRelease(entry.cpu);entry.cpu=null;};
 // Unexpected asynchronous adapters are rejected. Settle their result and clean
 // any eventual owned snapshot without publishing a lease or leaving rejection.
 const rejectAsync=result=>{Promise.resolve(result).then(resource=>ownerRelease(resource),()=>{}).catch(()=>{});return fail('asynchronous-adapter','copyFailures');};
 function handle(entry){let released=false;
  const check=()=>{if(released||entry.dead||closed)throw Error('Capture lease no longer live');};
  return Object.freeze({
   id:entry.id,stamp:entry.stamp,policy:entry.policy,view:entry.view,width:entry.width,height:entry.height,
   get texture(){check();return entry.resource.texture;},get context(){check();return context;},
   get live(){return !released&&!entry.dead&&!closed;},
   retain(){check();entry.refs++;return handle(entry);},
   release(){if(released)return;released=true;if(entry.dead)return;entry.refs--;if(entry.refs===0)releaseEntry(entry);},
   // Only explicit CPU consumers invoke this callback; normal hold/fade does not.
   materialize({reason,readSnapshot}={}){check();if(!reason||typeof readSnapshot!=='function')throw Error('Named CPU consumer/readSnapshot required');
    if(entry.cpu){stats.cpuReadHits++;return entry.cpu.value;}
    entry.cpu={value:null,release:null};stats.cpuReads++;
    try{const value=readSnapshot({texture:entry.resource.texture,context,stamp:entry.stamp,policy:entry.policy,view:entry.view,width:entry.width,height:entry.height,reason});
     if(value&&typeof value.then==='function'){Promise.resolve(value).then(resource=>ownerRelease(resource),()=>{}).catch(()=>{});stats.cpuReadFailures++;lastFailure='asynchronous-readback';return null;}
     if(value==null){stats.cpuReadFailures++;lastFailure='no-cpu-snapshot';return null;}if(typeof value.release==='function'&&'image' in value){entry.cpu.release=()=>value.release();entry.cpu.value=value.image;}else entry.cpu.value=value;return entry.cpu.value;
    }catch{stats.cpuReadFailures++;lastFailure='readback-failed';return null;}
   },
  });
 }
 return {
  capture({source,policy}={}){
   if(closed)return fail('disposed');const recipe=CAPTURE_POLICIES[policy];if(!recipe)throw Error('Unknown capture policy');
   if(!source?.completed||source.context!==context||!source.texture||typeof source.ownerId!=='string'||!Number.isInteger(source.generation)||source.generation<0||!Number.isInteger(source.revision)||source.revision<0)return fail('source-not-completed-on-this-context');
   if(policy==='handoff-stop-zero'&&(!source.zeroOverrideApplied||source.countdownValue!==0||source.totalRevision!==source.retainedTotalRevision))return fail('stop-zero-or-retained-total-unproven');
   if(entries.size>=maxLive)return fail('capacity','capacityMisses');
   const dimensions=size(recipe.view),stamp=Object.freeze({ownerId:source.ownerId,generation:source.generation,revision:source.revision,countdownValue:source.countdownValue??null,totalRevision:source.totalRevision??null,zeroOverrideApplied:!!source.zeroOverrideApplied});
   let resource;
   try{resource=copyCompleted({source,policy,recipe,view:recipe.view,...dimensions,stamp});}catch{return fail('copy-threw','copyFailures');}
   if(resource&&typeof resource.then==='function')return rejectAsync(resource);
   if(!resource)return fail('copy-unsupported');
   if(!resource.complete||resource.context!==context||!resource.texture||resource.texture===source.texture||resource.policy!==policy||resource.width!==dimensions.width||resource.height!==dimensions.height||typeof resource.release!=='function'){
    ownerRelease(resource);return fail('copy-not-independent-completed-native-snapshot','copyFailures');
   }
   const entry={id:++nextId,resource,policy,view:recipe.view,...dimensions,stamp,refs:1,dead:false,cpu:null};entries.add(entry);stats.copies++;stats.liveMax=Math.max(stats.liveMax,entries.size);lastFailure=null;return handle(entry);
  },
  diagnostics(){return {...stats,closed,live:entries.size,lastFailure};},
  dispose(){if(closed)return;closed=true;for(const entry of [...entries])releaseEntry(entry);},
 };
}
