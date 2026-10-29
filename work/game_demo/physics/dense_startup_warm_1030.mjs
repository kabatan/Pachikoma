// Loading only: exercise dense-ball code in an independent adapter. No live
// game, authoritative world, RNG, audio engine, clock or event bus is touched.
import {PhysicsAdapter} from './adapter.mjs';
import {installRigidSyncGuard,SOURCE_PIN} from './rigid_sync_guard.mjs';
import {observeContacts} from '../../audio/runtime/contact_observer.mjs';
import {createOwnedNativeQueryProof} from '../../audio/runtime/native_contact_query.mjs';
export async function warmDensePhysics(R,options,{naturalBoardMotion=false}={}){
 const at=performance.now(),guards=[],errors=[];let pa=null,observer=null,contacts=0,maxBalls=0;
 try{
  pa=await PhysicsAdapter.create(R,options);
  if(naturalBoardMotion){pa.board.allowJamKick=false;pa.board.allowStuckNudge=false;}
  for(const w of [pa.bw,pa.tw])guards.push(installRigidSyncGuard(w,R,{ownedNormalApi:true,sourceFingerprint:SOURCE_PIN,mode:'skip'}));
  const proof=createOwnedNativeQueryProof(R,{ownedNativeReadOnly:true,sourcePin:SOURCE_PIN});
  observer=observeContacts(pa,()=>{contacts++;},{nativeQueryProof:proof,onError:e=>errors.push(String(e))});
  pa.beginGame(120);pa.payout(120,false,40);let shots=0;
  for(let i=0;i<3840;i++){
   if(i%144===0){pa.setAim(Math.sin(shots*1.7),shots%2?1:-1);pa.launch(++shots);}
   pa.step();pa.drainEvents();maxBalls=Math.max(maxBalls,pa.tray.activeBalls.size);
   if(i%480===479)await new Promise(r=>setTimeout(r,0));
  }
  if(errors.length)throw Error('Dense physics rehearsal: '+errors.join(';'));
  return {completed:true,ms:performance.now()-at,ticks:3840,contacts,maxBalls,observer:{...observer.metrics}};
 }finally{
  observer?.dispose();for(const g of guards.reverse())g.dispose();
  if(pa){pa.board.queue.free();pa.bw.free();pa.tw.free();}
 }
}
