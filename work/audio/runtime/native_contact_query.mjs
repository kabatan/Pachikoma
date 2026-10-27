// Isolated scoped-binding contract. Public query surface + raw-method identity only; no WASM memory access or prototype writes.
// File/build pin is independent loader evidence, not runtime authentication.
export const NATIVE_QUERY_SOURCE_PIN=Object.freeze({packageVersion:'0.21.0',bundleSha256:'6ef5000c7200716131f6d008fa6cc947f18a38bb717ad3a36dfc9c3e1ba29b3a'});
const proofs=new WeakMap();
const WORLD_METHODS=['contactPair','contactPairsWith','getCollider','contactPairScoped'];
const NARROW_METHODS=['contactPair','contactPairsWith','contactPairScoped'];
const MANIFOLD_METHODS=['normal','numContacts','contactImpulse','numSolverContacts','solverContactPoint'];
const dataMethod=(prototype,key)=>Object.getOwnPropertyDescriptor(prototype,key)?.value;
export function createOwnedNativeQueryProof(R,{ownedNativeReadOnly=false,sourcePin=null}={}) {
 if(!ownedNativeReadOnly||sourcePin?.packageVersion!==NATIVE_QUERY_SOURCE_PIN.packageVersion||sourcePin?.bundleSha256!==NATIVE_QUERY_SOURCE_PIN.bundleSha256)return null;
 try {
  if(typeof R?.version!=='function'||R.version()!==NATIVE_QUERY_SOURCE_PIN.packageVersion)return null;
  const W=R.World,N=R.NarrowPhase,M=R.TempContactManifold,S=R.SoftBodySet;
  if(!W?.prototype||!N?.prototype||!M?.prototype||!S?.prototype)return null;
  const wp=W.prototype,np=N.prototype,mp=M.prototype,sp=S.prototype;
  const wm=WORLD_METHODS.map(k=>dataMethod(wp,k)),nm=NARROW_METHODS.map(k=>dataMethod(np,k)),mm=MANIFOLD_METHODS.map(k=>dataMethod(mp,k)),len=dataMethod(sp,'len');
  if([...wm,...nm,...mm,len].some(f=>typeof f!=='function'))return null;
  const proof=Object.freeze({kind:'owned-scoped-native-readonly-query',sourcePin:NATIVE_QUERY_SOURCE_PIN});
  proofs.set(proof,{R,W,N,M,S,wp,np,mp,sp,wm,nm,mm,len,version:R.version});return proof;
 } catch {return null;}
}
// Returns a post-step traversal-boundary check. It does not wrap any world API.
// Once rejected, the owned fast mode stays disabled for this observer lifetime.
// Ownership covers the complete traversal: receivers must not replace methods,
// prototypes, sets, or retain/mutate temporary manifold objects. Such changes
// inside a receiver are outside the contract; only the next boundary is checked.
export function bindOwnedNativeQueryTraversal(pa,world,proof) {
 const p=proof&&proofs.get(proof);if(!p||pa.isWorkerProxy||pa.R!==p.R)return null;
 let disabled=false,narrow,bodies,colliders,soft,raw,rawPrototype,rawScopedMethod;
 // Do not probe arbitrary facade/Worker accessors on a rejected native surface.
 try {
  if(Object.getPrototypeOf(world)!==p.wp)return null;
  narrow=Object.getOwnPropertyDescriptor(world,'narrowPhase')?.value;
  bodies=Object.getOwnPropertyDescriptor(world,'bodies')?.value;
  colliders=Object.getOwnPropertyDescriptor(world,'colliders')?.value;
  soft=Object.getOwnPropertyDescriptor(world,'softBodies')?.value;
  if(!narrow||!bodies||!colliders||!soft)return null;
  raw=Object.getOwnPropertyDescriptor(narrow,'raw')?.value;if(!raw)return null;
  rawPrototype=Object.getPrototypeOf(raw);rawScopedMethod=dataMethod(rawPrototype,'contact_pair_scoped');if(typeof rawScopedMethod!=='function'||raw.contact_pair_scoped!==rawScopedMethod)return null;
 } catch {return null;}
 let allowBulk=null,bulkFactory=null,bulkDispatchDisabled=false;
 try {
  bulkFactory=Object.getOwnPropertyDescriptor(p.R,'createOwnedContactChunk64Query')?.value;
  if(typeof bulkFactory==='function') {
   const allow=bulkFactory(raw);if(typeof allow==='function')allowBulk=allow;
  }
 } catch {}
 let allowImpulse=null,impulseDispatchDisabled=false;
 try {const allow=p.R.createOwnedImpulseQuery?.(raw);if(typeof allow==='function')allowImpulse=allow;}catch {}
 // Ptr query bypasses these dispatch reads; identical-returning accessors must
 // still take the old scoped path. Descriptor checks never invoke accessors.
 const ownData=(object,key,value,optional=false)=>{
  const d=Object.getOwnPropertyDescriptor(object,key);
  return d===undefined?optional:Object.hasOwn(d,'value')&&d.value===value;
 };
 const impulseDispatchAllowed=()=>{
  if(impulseDispatchDisabled)return false;
  try {
   const valid=ownData(world,'narrowPhase',narrow)&&ownData(world,'bodies',bodies)&&ownData(narrow,'raw',raw)&&
    dataMethod(p.wp,'contactPairScoped')===p.wm[3]&&ownData(world,'contactPairScoped',p.wm[3],true)&&
    dataMethod(p.np,'contactPairScoped')===p.nm[2]&&ownData(narrow,'contactPairScoped',p.nm[2],true)&&
    ownData(raw,'contact_pair_scoped',rawScopedMethod,true);
   if(!valid)impulseDispatchDisabled=true;
   return valid;
  } catch {impulseDispatchDisabled=true;return false;}
 };
 // Bulk bypasses NarrowPhase.contactPairsWith and its raw dispatch reads.
 // Same-returning accessors retain the old per-source calls, without invoking
 // new accessors here. Rejection is sticky, independently of the ptr path.
 const bulkDispatchAllowed=()=>{
  if(bulkDispatchDisabled)return false;
  try {
   const valid=ownData(narrow,'raw',raw)&&
    dataMethod(p.np,'contactPairsWith')===p.nm[1]&&ownData(narrow,'contactPairsWith',p.nm[1],true)&&
    ownData(p.R,'createOwnedContactChunk64Query',bulkFactory);
   if(!valid)bulkDispatchDisabled=true;
   return valid;
  } catch {bulkDispatchDisabled=true;return false;}
 };
 const valid=()=>Object.getPrototypeOf(world)===p.wp&&Object.getPrototypeOf(narrow)===p.np&&
  world.narrowPhase===narrow&&world.bodies===bodies&&world.colliders===colliders&&world.softBodies===soft&&
  p.R.World===p.W&&p.R.NarrowPhase===p.N&&p.R.TempContactManifold===p.M&&p.R.SoftBodySet===p.S&&p.R.version===p.version&&
  world.contactPair===p.wm[0]&&world.contactPairsWith===p.wm[1]&&world.getCollider===p.wm[2]&&world.contactPairScoped===p.wm[3]&&
  p.wp.contactPair===p.wm[0]&&p.wp.contactPairsWith===p.wm[1]&&p.wp.getCollider===p.wm[2]&&p.wp.contactPairScoped===p.wm[3]&&
  narrow.contactPair===p.nm[0]&&narrow.contactPairsWith===p.nm[1]&&narrow.contactPairScoped===p.nm[2]&&p.np.contactPair===p.nm[0]&&p.np.contactPairsWith===p.nm[1]&&p.np.contactPairScoped===p.nm[2]&&
  narrow.raw===raw&&Object.getPrototypeOf(raw)===rawPrototype&&raw.contact_pair_scoped===rawScopedMethod&&dataMethod(rawPrototype,'contact_pair_scoped')===rawScopedMethod&&
  p.mp.normal===p.mm[0]&&p.mp.numContacts===p.mm[1]&&p.mp.contactImpulse===p.mm[2]&&p.mp.numSolverContacts===p.mm[3]&&p.mp.solverContactPoint===p.mm[4]&&
  soft&&Object.getPrototypeOf(soft)===p.sp&&soft.len===p.len&&p.sp.len===p.len&&soft.len()===0;
 function allowThisTraversal(stepReceiverAndArgsAllowed) {
  allowThisTraversal.impulseQuery=null;allowThisTraversal.bulkQuery=null;
  if(disabled)return false;
  try {if(!stepReceiverAndArgsAllowed||pa.isWorkerProxy||pa.R!==p.R||!valid()){disabled=true;return false;}if(allowImpulse&&impulseDispatchAllowed())allowThisTraversal.impulseQuery=allowImpulse();if(allowBulk&&bulkDispatchAllowed())allowThisTraversal.bulkQuery=allowBulk();return true;}
  catch {disabled=true;return false;}
 };
 return allowThisTraversal;
}
