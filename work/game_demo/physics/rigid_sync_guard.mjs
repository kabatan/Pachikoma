// Isolated opt-in for game-owned Worlds using normal JS create/remove APIs only.
// NOT safe for arbitrary raw writes, external topology changes or another vendor build.
// No raw fields, WASM views, handle decoding, prototype writes, or solver reimplementation.
export const SOURCE_PIN=Object.freeze({packageVersion:'0.21.0',bundleSha256:'6ef5000c7200716131f6d008fa6cc947f18a38bb717ad3a36dfc9c3e1ba29b3a'});
const SET_KEYS=['bodies','colliders','softBodies','impulseJoints','multibodyJoints','physicsPipeline','integrationParameters'];
export function installRigidSyncGuard(world,R,{ownedNormalApi=false,sourceFingerprint=null,mode='guard-only',collectMetrics=false}={}){
 const stats={mode,steps:0,eligibleSyncs:0,skippedSyncs:0,fullSyncs:0,initialSyncs:0,disabled:false,fallbackReason:null};
 const reject=reason=>({installed:false,reason,stats,dispose(){}});
 if(!ownedNormalApi)return reject('owned-normal-api-contract-required');
 if(!['guard-only','skip'].includes(mode))return reject('unsupported-mode');
 if(sourceFingerprint?.packageVersion!==SOURCE_PIN.packageVersion||sourceFingerprint?.bundleSha256!==SOURCE_PIN.bundleSha256)return reject('independently-verified-source-pin-required');
 if(typeof R?.version!=='function'||R.version()!==SOURCE_PIN.packageVersion)return reject('rapier-version-mismatch');
 const wp=R.World?.prototype,sp=R.SoftBodySet?.prototype;
 if(!wp||!sp||!(world instanceof R.World)||world.step!==wp.step||world.mapNewSoftBodies!==wp.mapNewSoftBodies)return reject('native-world-method-identity-required');
 const sb=world.softBodies;
 if(!sb||sb.createSoftBody!==sp.createSoftBody||sb.len!==sp.len||SET_KEYS.some(k=>!world[k]))return reject('native-world-sets-required');
 const sourceStep=wp.step,sourceSync=wp.mapNewSoftBodies,sourceCreate=sp.createSoftBody,sourceLen=sp.len;
 const refs=Object.fromEntries(SET_KEYS.map(k=>[k,world[k]]));
 // Initial original sync establishes JS-wrapper alignment using only the public API.
 sourceSync.call(world);if(collectMetrics)stats.initialSyncs++;
 if(sb.len()!==0)return reject('soft-bodies-present');
 let disabled=false,disposed=false,depth=0;
 const disable=reason=>{if(!disabled){disabled=true;stats.disabled=true;stats.fallbackReason=reason;}};
 const identities=()=>SET_KEYS.every(k=>world[k]===refs[k])&&world.mapNewSoftBodies===guardedSync&&sb.createSoftBody===guardedCreate&&sb.len===sourceLen&&wp.step===sourceStep&&wp.mapNewSoftBodies===sourceSync&&sp.createSoftBody===sourceCreate&&sp.len===sourceLen;
 function guardedStep(){
  if(collectMetrics)stats.steps++;
  if(!disabled&&!disposed){
   if(this!==world)disable('foreign-world-this');
   else if(arguments[1]!=null)disable('hooks');
   else if(depth!==0)disable('nested-step');
   else if(!identities())disable('source-or-set-change');
  }
  if(disabled||disposed)return sourceStep.apply(this,arguments);
  depth++;
  try{return sourceStep.apply(this,arguments);}finally{depth--;}
 }
 function guardedSync(){
  if(!disabled&&!disposed){
   if(depth!==1)disable('explicit-sync');
   else if(this!==world||!identities())disable('source-or-set-change');
   else if(sb.len()!==0)disable('soft-bodies-present');
   else{
    if(collectMetrics)stats.eligibleSyncs++;
    if(mode==='skip'){if(collectMetrics)stats.skippedSyncs++;return;}
   }
  }
  if(collectMetrics)stats.fullSyncs++;
  return sourceSync.apply(this,arguments);
 }
 function guardedCreate(){disable('soft-body-create');return sourceCreate.apply(this,arguments);}
 world.step=guardedStep;world.mapNewSoftBodies=guardedSync;sb.createSoftBody=guardedCreate;
 return {installed:true,reason:null,stats,dispose(){
  disposed=true;disable('disposed');
  // Dispose outer audio/Worker wrappers first. Never overwrite another owner.
  if(world.step===guardedStep)world.step=sourceStep;
  if(world.mapNewSoftBodies===guardedSync)world.mapNewSoftBodies=sourceSync;
  if(sb.createSoftBody===guardedCreate)sb.createSoftBody=sourceCreate;
 }};
}
