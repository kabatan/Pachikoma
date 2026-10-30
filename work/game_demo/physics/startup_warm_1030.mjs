// Startup only. Warm the installed Rapier runtime using private restored worlds.
// Never step, replace or mutate the authoritative worlds or their owners.
export function warmPhysicsRuntime(RAPIER,worlds){
 const started=performance.now(),records=[];
 for(const [name,world] of worlds){
  const at=performance.now(),bytes=world.takeSnapshot();let copy=null;
  const record={name,snapshotBytes:bytes.length,stepMs:[]};
  try{
   copy=RAPIER.World.restoreSnapshot(bytes);
   if(!copy)throw Error('Unable to restore private warm world '+name);
   for(let i=0;i<8;i++){const t=performance.now();copy.step();record.stepMs.push(performance.now()-t);}
  }finally{copy?.free();record.ms=performance.now()-at;}
  records.push(record);
 }
 return {completed:true,ms:performance.now()-started,records};
}
