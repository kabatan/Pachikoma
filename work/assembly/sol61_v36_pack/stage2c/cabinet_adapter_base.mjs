// Optional integration module. The coordinator replaces the one draw-time
// LightAdapter with this subclass; do not install a second q writer in draw.
import {LightAdapter} from '../../../effects/runtime/light_adapter.mjs';
const clone=x=>JSON.parse(JSON.stringify(x));
const leaf=rgb=>({rgb:[...rgb],gain:0});
const defaults=()=>({logo:leaf([1,.2,.4]),display:{digits:Array.from({length:28},()=>leaf([1,.015,.065])),meter:Array.from({length:5},()=>leaf([1,.025,.30]))},buttons:{left:leaf([1,0,0]),right:leaf([1,1,1])}});
const checkKeys=(v,keys,name)=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new TypeError(name);for(const k of Object.keys(v))if(!keys.includes(k))throw new TypeError(name+': unknown '+k);};
const finite=(v,lo,hi,name)=>{if(!Number.isFinite(v)||v<lo||v>hi)throw new TypeError(name);return v;};
function updateLeaf(previous,value,base){
 if(value===null)return clone(base);
 checkKeys(value,['rgb','gain'],'light');const next=clone(previous);
 if('rgb'in value){if(!Array.isArray(value.rgb)||value.rgb.length!==3)throw new TypeError('rgb[3]');next.rgb=value.rgb.map(v=>finite(v,0,8,'linear RGB0..8'));}
 if('gain'in value)next.gain=finite(value.gain,0,1,'gain0..1');return next;
}
function update(previous,patch){
 checkKeys(patch,['logo','display','buttons'],'cabinet');const next=clone(previous),base=defaults();
 if('logo'in patch)next.logo=updateLeaf(next.logo,patch.logo,base.logo);
 if('display'in patch){
  checkKeys(patch.display,['digits','meter'],'display');
  for(const key of ['digits','meter'])if(key in patch.display){
   const a=patch.display[key],n=key==='digits'?28:5;
   if(!Array.isArray(a)||a.length!==n)throw new TypeError(key+' requires '+n+' elements');
   next.display[key]=a.map((v,i)=>updateLeaf(next.display[key][i],v,base.display[key][i]));
  }
 }
 if('buttons'in patch){
  checkKeys(patch.buttons,['left','right'],'buttons');
  for(const side of ['left','right'])if(side in patch.buttons)next.buttons[side]=updateLeaf(next.buttons[side],patch.buttons[side],base.buttons[side]);
 }
 return next;
}
function kind(s){
 if(s.steady===true)return 'steady';
 if(typeof s.reference_for==='string')return 'reference';
 if(s.logo===true)return 'logo';
 if(Number.isInteger(s.seg)&&s.seg>=0&&s.seg<28)return 'seg';
 if(Number.isInteger(s.meter)&&s.meter>=0&&s.meter<5)return 'meter';
 if(s.button==='left'||s.button==='right')return 'button';
 return null;
}
export class Stage2bLightAdapter extends LightAdapter {
 constructor(options){super(options);this._cabinet=defaults();}
 setSources(sources){
  const n=super.setSources(sources);this._specs=sources;this._cabinetIds=Object.keys(sources).filter(id=>kind(sources[id]));
  this.unmapped=this.unmapped.filter(id=>!kind(sources[id]));return n+this._cabinetIds.length;
 }
 setCabinet(patch){const next=update(this._cabinet,patch);this._cabinet=next;return this.getCabinet();}
 getCabinet(){return clone(this._cabinet);}
 resetCabinet(){this._cabinet=defaults();return this.getCabinet();}
 _value(spec){
  if(spec.logo===true)return this._cabinet.logo;
  if(Number.isInteger(spec.seg))return this._cabinet.display.digits[spec.seg];
  if(Number.isInteger(spec.meter))return this._cabinet.display.meter[spec.meter];
  if(spec.button)return this._cabinet.buttons[spec.button];
  throw new Error('unsupported cabinet source');
 }
 apply(F,frame,t,ids){
  super.apply(F,frame,t,ids);const q=frame.q||(frame.q={});
  // Positive implementation of E + sum g*(W*rgb-R). h>=every gain whose
  // frozen R is nonzero. Default gains0 leave only static/E_steady at1.
  const h=Math.max(0,...this._cabinetIds.filter(id=>kind(this._specs[id])==='reference').map(id=>this._value(this._specs[this._specs[id].reference_for]).gain));
  for(const id of this._cabinetIds){
   const spec=this._specs[id],k=kind(spec);
   if(k==='steady'){const w=spec.steady_role==='residual'?h:1-h;q[id]={rgb:[w,w,w]};}
   else if(k==='reference'){
    const target=this._specs[spec.reference_for];if(!target)throw new Error('missing reference target');
    const g=this._value(target).gain;q[id]={rgb:[h-g,h-g,h-g]};
   }else{const {rgb,gain}=this._value(spec);q[id]={rgb:rgb.map(v=>v*gain)};}
  }
  return frame;
 }
}
export default Stage2bLightAdapter;
