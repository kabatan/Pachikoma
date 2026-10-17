// 本体を編集しない観測口。盤/皿の world.step に一度だけ巻き付ける。
// solver impulse は S 倍された力積なので /S。音響処理は例外で物理を止めない。
export function observeContacts(pa, receive, { onError=console.error, onPayout=null }={}) {
  const removers=[], metrics={ steps:0, contacts:0, errors:0, milliseconds:0 };
  for(const [region, owner, world, scale] of [['board',pa.board,pa.bw,10],['tray',pa.tray,pa.tw,pa.tray.S]]) {
    const original=world.step; let previous=new Map(), lastTime=-1, exited=owner.payoutExited??0;
    const wrapper=function(...args) {
      const t0=performance.now(), pre=new Map(), balls=new Map(), movingLabels=new Map();
      try {
        if(pa.t<lastTime) previous.clear(); lastTime=pa.t;
        if(region==='tray') {
          const n=owner.payoutExited;if(n>exited)onPayout?.({t:pa.t,count:n-exited});exited=n;
        }
        for(const [id,b] of owner.balls) {
          if(b.stored) continue;
          const body=b.body, v=body.linvel(), w=body.angvel(), p=body.translation();
          pre.set(body.handle,{ v,w,p });
          for(let j=0;j<body.numColliders();j++) balls.set(body.collider(j).handle,{id,body});
        }
        for(const [id,m] of owner.mechBodies??[]) {
          const body=m.body;pre.set(body.handle,{v:body.linvel(),w:body.angvel(),p:body.translation()});movingLabels.set(body.handle,id);
        }
      } catch(error) { metrics.errors++; onError(error); }
      metrics.milliseconds+=performance.now()-t0;
      const result=original.apply(this,args), t1=performance.now();
      try {
        const now=pa.t, seen=new Set(), next=new Map();
        for(const [handle,a] of balls) {
          const ca=world.getCollider(handle); if(!ca) continue;
          world.contactPairsWith(ca,cb=>{
            const pair=[handle,cb.handle].sort((x,y)=>x-y).join(':'); if(seen.has(pair)) return; seen.add(pair);
            const b=balls.get(cb.handle), part=cb.partId??ca.partId??movingLabels.get(cb.parent()?.handle);
            const pin=owner.pegOf?.get(handle)??owner.pegOf?.get(cb.handle);
            const material=b?'steel':pin!==undefined?'brass':part&&/GATE|FLAP|RAIL/.test(part)?'metal':'resin';
            let impulse=0, speed=0, point=a.body.translation();
            world.contactPair(ca,cb,manifold=>{
              const n=manifold.normal();
              for(let k=0;k<manifold.numContacts();k++) impulse+=Math.max(0,manifold.contactImpulse(k))/scale;
              point=manifold.numSolverContacts()?manifold.solverContactPoint(0):point;
              const velocity=(body)=>{
                const q=body&&pre.get(body.handle); if(!q) return {x:0,y:0,z:0};
                const r={x:point.x-q.p.x,y:point.y-q.p.y,z:point.z-q.p.z};
                return {x:q.v.x+q.w.y*r.z-q.w.z*r.y,y:q.v.y+q.w.z*r.x-q.w.x*r.z,z:q.v.z+q.w.x*r.y-q.w.y*r.x};
              };
              const va=velocity(a.body), vb=velocity(cb.parent());
              speed=Math.max(speed,Math.abs((va.x-vb.x)*n.x+(va.y-vb.y)*n.y+(va.z-vb.z)*n.z)/scale);
            });
            const old=previous.get(pair), last=old?.last??-10;
            next.set(pair,{impulse,last});
            if(speed<.045||impulse<.000025||now-last<.03||(old&&impulse<old.impulse*1.7)) return;
            next.get(pair).last=now;
            // 位置は領域の世界m。pan用には各領域のxを使う(厳密な音源定位は未校正)。
            const contact={t:now,type:'contact',region,material,speed,impulse,x:point.x/scale,
              a:String(a.id),b:b?String(b.id):(pin!==undefined?`pin:${pin}`:part??'surface'),variant:pin??String(a.id).length};
            metrics.contacts++; receive(contact);
          });
        }
        previous=next; metrics.steps++;
      } catch(error) { metrics.errors++; onError(error); }
      metrics.milliseconds+=performance.now()-t1;
      return result;
    };
    world.step=wrapper; removers.push(()=>{if(world.step===wrapper) world.step=original;});
  }
  return { metrics, dispose(){removers.forEach(f=>f());} };
}
