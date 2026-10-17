const {Director}=require('../lightbus.js');
const ev=require('../../spec/events.json'), geom=require('../../spec/geometry.json');
const D=new Director({events:ev,geom});
let bad=0;
for(const e of ev.events){
  const d=new Director({events:ev,geom}); d.setState({n:3,rank:2,litPockets:[2,5],hitPocket:5,lastN:3});
  d.start(e.id,{k:1,n_from:3,pocket:5,once:true});
  let mx=0,cues=0,nan=0,fl=0,prev=0;
  const T=(e.dur||3)+.5;
  for(let t=0;t<T;t+=1/60){
    const F=d.step(1/60); cues+=F.cues.length;
    for(const a of [F.petal,F.edge.add,F.edge.ovr,F.pocket]) for(const v of a){ if(!isFinite(v))nan++; mx=Math.max(mx,v);}
    for(const v of F.logo) if(!isFinite(v))nan++;
  }
  console.log(e.id.padEnd(18),'max',mx.toFixed(2),'cues',cues,'nan',nan);
  if(nan)bad++;
}
process.exit(bad?1:0);
