// 観測をworld.stepの前後に巻き付ける。接触記録とベクトル領域を再利用し、物理処理へは介入しない。
export function observeContacts(pa, receive, { onError=console.error, onPayout=null }={}) {
  const removers=[], metrics={ steps:0, contacts:0, errors:0, milliseconds:0 };
  for(const [region, owner, world, scale] of [['board',pa.board,pa.bw,10],['tray',pa.tray,pa.tw,pa.tray.S]]) {
    const original=world.step, pre=new Map(), balls=new Map(), movingLabels=new Map();
    const statePool=[], ballPool=[], sourcePool=[], pairRecords=new Map();
    let previousPairs=[], nextPairs=[], stateCount=0, ballCount=0, sourceCount=0;
    let lastTime=-1, exited=owner.payoutExited??0, pairFrame=0;
    let sourceBall=null, sourceCollider=null, sourceHandle=0, otherCollider=null, otherBall=null;
    let pairState=null, queryFrame=0, queryImpulse=0, querySpeed=0, queryPoint={x:0,y:0,z:0};
    const normal={x:0,y:0,z:0};

    function pairRecord(a,b) {
      const low=a<b?a:b, high=a<b?b:a;
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
      pairRecords.clear(); previousPairs.length=0; nextPairs.length=0; pairFrame=0;
    }
    function visitManifold(manifold) {
      const n=manifold.normal(normal);
      for(let k=0;k<manifold.numContacts();k++) queryImpulse+=Math.max(0,manifold.contactImpulse(k))/scale;
      if(manifold.numSolverContacts()) queryPoint=manifold.solverContactPoint(0,queryPoint);
      const bodyA=sourceBall.body, bodyB=otherCollider.parent();
      const qa=pre.get(bodyA.handle), qb=bodyB&&pre.get(bodyB.handle);
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
    function visitCollider(cb) {
      otherCollider=cb;
      otherBall=balls.get(cb.handle);
      // contactPairsWith visits ball-ball contacts from both balls. The source
      // ball order matches the old Set-based first-visit order without a Set/key.
      if(otherBall && sourceBall.rank>otherBall.rank) return;
      pairState=pairRecord(sourceHandle,cb.handle);
      if(pairState.workFrame===queryFrame) return;
      pairState.workFrame=queryFrame;
      pairState.nextImpulse=0;
      pairState.nextLast=pairState.frame===pairFrame?pairState.last:-10;
      nextPairs.push(pairState);
      queryImpulse=0; querySpeed=0;
      sourceBall.body.translation(queryPoint);
      world.contactPair(sourceCollider,cb,visitManifold);
      pairState.nextImpulse=queryImpulse;
      const now=pa.t, last=pairState.nextLast;
      if(querySpeed<.045||queryImpulse<.000025||now-last<.03||(pairState.frame===pairFrame&&queryImpulse<pairState.impulse*1.7)) return;
      pairState.nextLast=now;
      const part=cb.partId??sourceCollider.partId??movingLabels.get(cb.parent()?.handle);
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
          body.linvel(q.v); body.angvel(q.w); body.translation(q.p); pre.set(body.handle,q);
          let entry=ballPool[ballCount];
          if(!entry) entry=ballPool[ballCount]={id:null,label:'',body:null,rank:0};
          if(entry.id!==id) { entry.id=id; entry.label=String(id); }
          entry.body=body; entry.rank=rank++;
          for(let j=0;j<body.numColliders();j++) {
            const handle=body.collider(j).handle;
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
          body.linvel(q.v); body.angvel(q.w); body.translation(q.p); pre.set(body.handle,q); movingLabels.set(body.handle,id);
        }
      } catch(error) { metrics.errors++; onError(error); }
      metrics.milliseconds+=performance.now()-t0;
      const result=original.apply(this,arguments), t1=performance.now();
      try {
        queryFrame=pairFrame+1; nextPairs.length=0;
        for(let i=0;i<sourceCount;i++) {
          const source=sourcePool[i];
          sourceHandle=source.handle; sourceBall=source.ball; sourceCollider=world.getCollider(sourceHandle);
          if(!sourceCollider) continue;
          world.contactPairsWith(sourceCollider,visitCollider);
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
