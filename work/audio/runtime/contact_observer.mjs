import {bindOwnedNativeQueryTraversal} from './native_contact_query.mjs';
// Isolated performance candidate. Contract: receive/onPayout must only consume
// audio notifications and must not mutate, step, add or remove physics bodies
// during this synchronous traversal. All current runtime consumers meet this.
// Pair enumeration, sleep/quiet decisions and numerical impulse math are intact.
export function observeContacts(pa, receive, { onError=console.error, onPayout=null, nativeQueryProof=null, contactScan=new URLSearchParams(globalThis.location?.search??'').get('contactscan')!=='0' }={}) {
  const removers=[], metrics={ steps:0, contacts:0, errors:0, milliseconds:0 };
  for(const [region, owner, world, scale] of [['board',pa.board,pa.bw,10],['tray',pa.tray,pa.tw,pa.tray.S]]) {
    const original=world.step, pre=new Map(), balls=new Map(), movingLabels=new Map();
    const nativeTraversalAllowed=bindOwnedNativeQueryTraversal(pa,world,nativeQueryProof);
    let nativeTraversal=false;
    const restCache=new URLSearchParams(globalThis.location?.search??'').get('observerrest')!=='0'&&typeof WeakMap==='function', bodyInfo=new WeakMap();
    const statePool=[], ballPool=[], sourcePool=[], pairRecords=new Map(), quietFrames=new Map();
    let previousPairs=[], nextPairs=[], stateCount=0, ballCount=0, sourceCount=0;
    let lastTime=-1, exited=owner.payoutExited??0, pairFrame=0;
    let sourceBall=null, sourceCollider=null, sourceHandle=0, otherCollider=null, otherBall=null;
    let pairState=null, queryFrame=0, queryImpulse=0, querySpeed=0, queryPoint={x:0,y:0,z:0};
    let pairQA=null, pairQB=null, pairBodyB=null;
    const normal={x:0,y:0,z:0};
    const afterVelocity={x:0,y:0,z:0}, afterAngular={x:0,y:0,z:0};
    // Real Rapier worlds can reject the second visit of a ball pair by handle,
    // before World.contactPairsWith resolves it to a Collider. Worker replay
    // worlds intentionally expose only the higher-level API.
    const narrowPhase=world.narrowPhase;

    function postQuiet(body,state) {
      if(state.postQuiet===undefined) {
        body.linvel(afterVelocity); body.angvel(afterAngular);
        state.postQuiet=!(Math.hypot(afterVelocity.x,afterVelocity.y,afterVelocity.z)/scale>=.005||Math.hypot(afterAngular.x,afterAngular.y,afterAngular.z)>=.02);
      }
      return state.postQuiet;
    }

    function pairRecord(a,b) {
      const low=a<b?a:b, high=a<b?b:a;
      // The committed list contains live records; a miss keeps the Map path.
      const index=nextPairs.length;
      if(index<previousPairs.length) {
        const prior=previousPairs[index];
        if((prior.low===low||(prior.low!==prior.low&&low!==low))&&
           (prior.high===high||(prior.high!==prior.high&&high!==high))) return prior;
      }
      let peers=pairRecords.get(low);
      if(!peers) pairRecords.set(low,peers=new Map());
      let value=peers.get(high);
      if(!value) { value={low,high,frame:0,workFrame:0,impulse:0,last:-10,nextImpulse:0,nextLast:-10}; peers.set(high,value); }
      return value;
    }
    function removePair(value) {
      const peers=pairRecords.get(value.low);
      if(!peers) return;
      peers.delete(value.high);
      if(peers.size===0) pairRecords.delete(value.low);
    }
    function clearPairs() {
      pairRecords.clear(); previousPairs.length=0; nextPairs.length=0; pairFrame=0; quietFrames.clear();
    }
    function visitManifold(manifold) {
      const n=manifold.normal(normal);
      const contacts=manifold.numContacts();
      for(let k=0;k<contacts;k++) queryImpulse+=Math.max(0,manifold.contactImpulse(k))/scale;
      if(manifold.numSolverContacts()) queryPoint=manifold.solverContactPoint(0,queryPoint);
      const qa=pairQA, qb=pairQB;
      let avx=0, avy=0, avz=0, bvx=0, bvy=0, bvz=0;
      if(qa) {
        const rx=queryPoint.x-qa.p.x, ry=queryPoint.y-qa.p.y, rz=queryPoint.z-qa.p.z;
        avx=qa.v.x+qa.w.y*rz-qa.w.z*ry;
        avy=qa.v.y+qa.w.z*rx-qa.w.x*rz;
        avz=qa.v.z+qa.w.x*ry-qa.w.y*rx;
      }
      if(qb) {
        const rx=queryPoint.x-qb.p.x, ry=queryPoint.y-qb.p.y, rz=queryPoint.z-qb.p.z;
        bvx=qb.v.x+qb.w.y*rz-qb.w.z*ry;
        bvy=qb.v.y+qb.w.z*rx-qb.w.x*rz;
        bvz=qb.v.z+qb.w.x*ry-qb.w.y*rx;
      }
      querySpeed=Math.max(querySpeed,Math.abs((avx-bvx)*n.x+(avy-bvy)*n.y+(avz-bvz)*n.z)/scale);
    }
    function visitImpulseOnly(manifold) {
      const contacts=manifold.numContacts();
      for(let k=0;k<contacts;k++) queryImpulse+=Math.max(0,manifold.contactImpulse(k))/scale;
    }
    function visitKinematicsOnly(manifold) {
      const n=manifold.normal(normal);
      if(manifold.numSolverContacts()) queryPoint=manifold.solverContactPoint(0,queryPoint);
      const qa=pairQA, qb=pairQB;
      let avx=0, avy=0, avz=0, bvx=0, bvy=0, bvz=0;
      if(qa) {
        const rx=queryPoint.x-qa.p.x, ry=queryPoint.y-qa.p.y, rz=queryPoint.z-qa.p.z;
        avx=qa.v.x+qa.w.y*rz-qa.w.z*ry;
        avy=qa.v.y+qa.w.z*rx-qa.w.x*rz;
        avz=qa.v.z+qa.w.x*ry-qa.w.y*rx;
      }
      if(qb) {
        const rx=queryPoint.x-qb.p.x, ry=queryPoint.y-qb.p.y, rz=queryPoint.z-qb.p.z;
        bvx=qb.v.x+qb.w.y*rz-qb.w.z*ry;
        bvy=qb.v.y+qb.w.z*rx-qb.w.x*rz;
        bvz=qb.v.z+qb.w.x*ry-qb.w.y*rx;
      }
      querySpeed=Math.max(querySpeed,Math.abs((avx-bvx)*n.x+(avy-bvy)*n.y+(avz-bvz)*n.z)/scale);
    }
    // Called at the original location on generic paths, or immediately before
    // the owned-native kinematics pass. Native impulse-only queries do not read
    // queryPoint. Ownership requires normal side-effect-free body getters.
    function initializeQueryPoint() {
      if(pairQA) {
        if(!pairQA.postPositionValid) {
          sourceBall.body.translation(pairQA.postPosition??={x:0,y:0,z:0});
          pairQA.postPositionValid=true;
        }
        queryPoint.x=pairQA.postPosition.x; queryPoint.y=pairQA.postPosition.y; queryPoint.z=pairQA.postPosition.z;
      } else sourceBall.body.translation(queryPoint);
    }
    function visitCollider(cb) {
      otherBall=balls.get(cb.handle);
      // contactPairsWith visits ball-ball contacts from both balls. The source
      // ball order matches the old Set-based first-visit order without a Set/key.
      if(otherBall && sourceBall.rank>otherBall.rank) return;
      visitAcceptedCollider(cb);
    }
    function visitHandle(handle) {
      otherBall=balls.get(handle);
      if(otherBall && sourceBall.rank>otherBall.rank) return;
      const cb=world.getCollider(handle);
      if(cb) visitAcceptedCollider(cb);
    }
    function visitAcceptedCollider(cb) {
      otherCollider=cb;
      pairQA=sourceBall.state;
      pairBodyB=otherBall?otherBall.body:cb.parent();
      pairQB=otherBall?otherBall.state:(pairBodyB&&pre.get(pairBodyB.handle));
      pairState=pairRecord(sourceHandle,cb.handle);
      if(pairState.workFrame===queryFrame) return;
      pairState.workFrame=queryFrame;
      pairState.nextImpulse=0;
      pairState.nextLast=pairState.frame===pairFrame?pairState.last:-10;
      nextPairs.push(pairState);
      if(region==='tray') {
        const qa=pairQA, bodyB=pairBodyB, qb=pairQB;
        // Sleeping-sleeping and sleeping-static pairs cannot emit a contact sound.
        // Their solver impulse is unchanged while both bodies remain asleep, so
        // retain the last exact value for the next wake-up comparison.
        if(qa?.sleeping&&(!bodyB||(qb?.sleeping))) { pairState.nextImpulse=pairState.impulse; return; }
        // Stable tray contacts keep both bodies dynamic; confirm their post-step
        // speed before skipping the manifold query so impacts use the normal path.
        const fixed=!bodyB||(qb?(qb.postFixed??=bodyB.isFixed()):bodyB.isFixed());
        if(qa?.quietFrames>=72&&(fixed||qb?.quietFrames>=72)) {
          // The audio receiver only accumulates sound events; it does not mutate
          // bodies during this synchronous post-step traversal. Read each body's
          // unchanged post-step speed once, even when it has many quiet contacts.
          const still=postQuiet(sourceBall.body,qa)&&(!bodyB||fixed||postQuiet(bodyB,qb));
          if(still) { pairState.nextImpulse=pairState.impulse; return; }
        }
      }
      queryImpulse=0; querySpeed=0;
      if(nativeTraversal) {
        const impulseQuery=nativeTraversalAllowed.impulseQuery;
        if(impulseQuery)queryImpulse=impulseQuery(sourceCollider.handle,cb.handle,queryImpulse,scale);
        else world.contactPairScoped(sourceCollider,cb,visitImpulseOnly);
        const gateNow=pa.t, gateLast=pairState.nextLast;
        if(!(queryImpulse<.000025||gateNow-gateLast<.03||(pairState.frame===pairFrame&&queryImpulse<pairState.impulse*1.7))) {
          initializeQueryPoint();
          world.contactPairScoped(sourceCollider,cb,visitKinematicsOnly);
        }
      } else {
        initializeQueryPoint();
        world.contactPair(sourceCollider,cb,visitManifold);
      }
      pairState.nextImpulse=queryImpulse;
      const now=pa.t, last=pairState.nextLast;
      if(querySpeed<.045||queryImpulse<.000025||now-last<.03||(pairState.frame===pairFrame&&queryImpulse<pairState.impulse*1.7)) return;
      pairState.nextLast=now;
      const part=cb.partId??sourceCollider.partId??movingLabels.get(pairBodyB?.handle);
      const pin=owner.pegOf?.get(sourceHandle)??owner.pegOf?.get(cb.handle);
      const material=otherBall?'steel':pin!==undefined?'brass':part&&/GATE|FLAP|RAIL/.test(part)?'metal':'resin';
      // Position is in region-world metres; pan uses each region's x as before.
      const contact={t:now,type:'contact',region,material,speed:querySpeed,impulse:queryImpulse,x:queryPoint.x/scale,
        a:sourceBall.label,b:otherBall?otherBall.label:(pin!==undefined?`pin:${pin}`:part??'surface'),variant:pin??sourceBall.label.length};
      metrics.contacts++; receive(contact);
    }

    const wrapper=function() {
      const t0=performance.now(); stateCount=0; ballCount=0; sourceCount=0; pre.clear(); balls.clear(); movingLabels.clear();
      try {
        if(pa.t<lastTime) clearPairs(); lastTime=pa.t;
        if(region==='tray') {
          const n=owner.payoutExited;
          if(n>exited) onPayout?.({t:pa.t,count:n-exited});
          exited=n;
        }
        let rank=0;
        const contactBalls=owner.activeBalls??owner.balls;
        for(const b of contactBalls.values()) {
          const id=b.id;
          if(b.stored) continue;
          const body=b.body;
          let q=statePool[stateCount];
          if(!q) q=statePool[stateCount]={v:{x:0,y:0,z:0},w:{x:0,y:0,z:0},p:{x:0,y:0,z:0}};
          stateCount++;
          if(restCache) {
            // 眠っている玉の速度・位置は眠っている間変わらない。最初に眠っているのを見たとき1回だけ読み、以後は写すだけ(wasm getter 3回を省く)。?observerrest=0 で従来。
            let info=bodyInfo.get(body);
            if(!info) bodyInfo.set(body,info={rest:null,handles:null});
            const asleep=region==='tray'&&body.isSleeping();
            if(asleep&&info.rest) { const r=info.rest; q.v.x=r.vx; q.v.y=r.vy; q.v.z=r.vz; q.w.x=r.wx; q.w.y=r.wy; q.w.z=r.wz; q.p.x=r.px; q.p.y=r.py; q.p.z=r.pz; }
            else {
              body.linvel(q.v); body.angvel(q.w); body.translation(q.p);
              if(asleep) info.rest={vx:q.v.x,vy:q.v.y,vz:q.v.z,wx:q.w.x,wy:q.w.y,wz:q.w.z,px:q.p.x,py:q.p.y,pz:q.p.z}; else info.rest=null;
            }
            q.sleeping=asleep;
          } else { body.linvel(q.v); body.angvel(q.w); body.translation(q.p); q.sleeping=region==='tray'&&body.isSleeping(); }
          q.postQuiet=undefined; q.postFixed=undefined; q.postPositionValid=false;
          // Magnitudes are used only by the tray quiet gate. Evaluate the
          // identical expressions in order, stopping when the result is known.
          // Board values and fast-ball angular magnitudes were never consumed.
          let quiet;
          if(contactScan) quiet=region==='tray'&&Math.hypot(q.v.x,q.v.y,q.v.z)/scale<.005&&Math.hypot(q.w.x,q.w.y,q.w.z)<.02;
          else {q.linearSpeed=Math.hypot(q.v.x,q.v.y,q.v.z)/scale;q.angularSpeed=Math.hypot(q.w.x,q.w.y,q.w.z);quiet=region==='tray'&&q.linearSpeed<.005&&q.angularSpeed<.02;}
          q.quietFrames=quiet?(quietFrames.get(body.handle)??0)+1:0;
          if(quiet)quietFrames.set(body.handle,q.quietFrames);else quietFrames.delete(body.handle);
          pre.set(body.handle,q);
          let entry=ballPool[ballCount];
          if(!entry) entry=ballPool[ballCount]={id:null,label:'',body:null,rank:0};
          if(entry.id!==id) { entry.id=id; entry.label=String(id); }
          entry.body=body; entry.rank=rank++;
          let handles=restCache?bodyInfo.get(body).handles:null;
          if(!handles) {
            const colliderCount=body.numColliders(); handles=[];
            for(let j=0;j<colliderCount;j++) handles.push(body.collider(j).handle);
            if(restCache) bodyInfo.get(body).handles=handles;   // 玉の碰撞体は作られた後に増減しない
          }
          for(let j=0;j<handles.length;j++) {
            const handle=handles[j];
            balls.set(handle,entry);
            let source=sourcePool[sourceCount];
            if(!source) source=sourcePool[sourceCount]={handle:0,ball:null};
            source.handle=handle; source.ball=entry; sourceCount++;
          }
          ballCount++;
        }
        for(const [id,m] of owner.mechBodies??[]) {
          const body=m.body;
          let q=statePool[stateCount];
          if(!q) q=statePool[stateCount]={v:{x:0,y:0,z:0},w:{x:0,y:0,z:0},p:{x:0,y:0,z:0}};
          stateCount++;
          body.linvel(q.v); body.angvel(q.w); body.translation(q.p);
          q.postQuiet=undefined; q.postFixed=undefined; q.postPositionValid=false;
          // Magnitudes are used only by the tray quiet gate. Evaluate the
          // identical expressions in order, stopping when the result is known.
          // Board values and fast-ball angular magnitudes were never consumed.
          let quiet;
          if(contactScan) quiet=region==='tray'&&Math.hypot(q.v.x,q.v.y,q.v.z)/scale<.005&&Math.hypot(q.w.x,q.w.y,q.w.z)<.02;
          else {q.linearSpeed=Math.hypot(q.v.x,q.v.y,q.v.z)/scale;q.angularSpeed=Math.hypot(q.w.x,q.w.y,q.w.z);quiet=region==='tray'&&q.linearSpeed<.005&&q.angularSpeed<.02;}
          q.quietFrames=quiet?(quietFrames.get(body.handle)??0)+1:0;
          if(quiet)quietFrames.set(body.handle,q.quietFrames);else quietFrames.delete(body.handle);
          pre.set(body.handle,q); movingLabels.set(body.handle,id);
        }
       } catch(error) { metrics.errors++; onError(error); }
      // Also cover a partially built source list after a captured pre-step
      // exception. Bind each exposed entry to the current Map, never a previous
      // pool slot. Resolving after all entries preserves aliased-body semantics.
      for(let i=0;i<sourceCount;i++) { const ball=sourcePool[i].ball; ball.state=pre.get(ball.body.handle); }
      metrics.milliseconds+=performance.now()-t0;
      const result=original.apply(this,arguments), t1=performance.now();
      try {
        // One check after the solver, before this synchronous consume-only traversal.
        // Contract violations inside a receiver are not detected until the next boundary.
        nativeTraversal=nativeTraversalAllowed?nativeTraversalAllowed(this===world&&arguments[1]==null):false;
        queryFrame=pairFrame+1; nextPairs.length=0;
        for(let i=0;i<sourceCount;i++) {
          const source=sourcePool[i];
          sourceHandle=source.handle; sourceBall=source.ball; sourceCollider=world.getCollider(sourceHandle);
          if(!sourceCollider) continue;
          // Only the existing owned-native boundary enables chunk64. The
          // vendor bridge consumes each full-handle chunk in the old order,
          // swallowing each visitor exception exactly like native1859. A bridge
          // failure is deferred until native heap/borrow/stack cleanup returns,
          // then reaches this existing outer catch; never retry old enumeration.
          const bulkQuery=nativeTraversal&&nativeTraversalAllowed.bulkQuery;
          if(bulkQuery) bulkQuery(sourceHandle,visitHandle);
          else if(narrowPhase) narrowPhase.contactPairsWith(sourceHandle,visitHandle);
          else world.contactPairsWith(sourceCollider,visitCollider);
        }
        for(const old of previousPairs) if(old.workFrame!==queryFrame) removePair(old);
        for(const current of nextPairs) {
          current.impulse=current.nextImpulse; current.last=current.nextLast; current.frame=queryFrame;
        }
        pairFrame=queryFrame;
        const swap=previousPairs; previousPairs=nextPairs; nextPairs=swap; nextPairs.length=0;
        metrics.steps++;
      } catch(error) {
        metrics.errors++;
        for(const current of nextPairs) {
          current.workFrame=0;
          if(current.frame!==pairFrame) removePair(current);
        }
        nextPairs.length=0;
        onError(error);
      }
      metrics.milliseconds+=performance.now()-t1;
      return result;
    };
    world.step=wrapper; removers.push(()=>{if(world.step===wrapper) world.step=original;});
  }
  return { metrics, dispose(){removers.forEach(f=>f());} };
}
