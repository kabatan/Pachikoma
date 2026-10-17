// Single final writer: inherits the delivered stage2b controls, then consumes
// the7 absolute pocket RGB triples in the same public apply() invocation.
import {Stage2bLightAdapter} from './cabinet_adapter_base.mjs';
const pocketIndex=s=>s?.steady && Number.isInteger(s.steady.pocket) ? s.steady.pocket : null;
export class Stage2cLightAdapter extends Stage2bLightAdapter {
 setSources(sources){
  const n=super.setSources(sources);
  this._pocketIds=Object.keys(sources).filter(id=>pocketIndex(sources[id])>=1&&pocketIndex(sources[id])<=7);
  this.unmapped=this.unmapped.filter(id=>!this._pocketIds.includes(id));
  return n+this._pocketIds.length;
 }
 apply(F,frame,t,ids){
  const incoming=frame.steadyE?.pocket ?? frame.pocket;
  super.apply(F,frame,t,ids);
  // steadyE is already strength-inclusive linear RGB and already has the
  // Effects ambient multiplication. Never apply ambient or gamma again.
  let values=frame.steadyE?.pocket ?? incoming;
  if(!values && F?.pocket){const a=F.ambient??1;values=Array.from(F.pocket,v=>v*a);}
  if(values && values.length!==21)throw new TypeError('pocket requires7x3=21 absolute linear RGB values');
  const updates=[];
  for(const id of this._pocketIds){
   const index=pocketIndex(this._specs[id])-1,rgb=[0,1,2].map(c=>values?values[index*3+c]:0);
   if(!rgb.every(v=>Number.isFinite(v)&&v>=0&&v<=8))throw new RangeError('pocket absolute linear RGB range is0..8; values are never clipped');
   updates.push([id,{rgb}]);
  }
  for(const [id,value] of updates)frame.q[id]=value;
  return frame;
 }
}
export default Stage2cLightAdapter;
