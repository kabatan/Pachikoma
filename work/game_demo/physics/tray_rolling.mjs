import { trayFloor } from './tray_geometry.mjs';
// 実際の床を使う転がり抵抗。60Hzの作業用座標を再利用し、静止球を起こさない。
export class TrayRollingResistance {
  constructor(T,rng){this.T=T;this.rng=rng;this.prev=new Map();this.dfac=new Map();this.scale=1;}
  attach(id,body){let u=0;while(!u)u=this.rng();const d=Math.exp(.15*Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*this.rng()));this.dfac.set(id,d);body.setAngularDamping(.25*d);}
  update(balls,dt,S){
    for(const [id,b]of balls){if(b.stored||b.body.isSleeping())continue;
      const t=b.prev,x=t.x-this.T[0],y=t.y-this.T[1],z=t.z-this.T[2],hh=y-trayFloor(x,z)-.006;
      let q=this.prev.get(id),lam=0;
      if(q&&x>=-.171&&x<=.084&&z>-.137&&z<-.064&&hh>-.003&&hh<.0008){
        const v=Math.hypot(x-q.x,z-q.z)/dt,ar=.006*(this.dfac.get(id)??1)*this.scale*9.81;
        if(v>ar*dt)lam=Math.min(200,ar/v);
      }
      b.body.setLinearDamping(lam);
      if(!q){q={x,z};this.prev.set(id,q);}else {q.x=x;q.z=z;}
    }
  }
}
