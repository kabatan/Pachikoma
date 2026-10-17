// R2-P: 原音不使用。混合実機録音の高域・短い打撃を参照した減衰モード＋励振雑音。
// 固有値の実測ではない。根拠と制約: ../physical_r2/ANALYSIS.md
export const BALL = Object.freeze({radius:.0055,mass:.0054});
export const MATERIALS = Object.freeze({
  brass: { E:100e9, nu:.34, modes:[1920,3470,6280,8810], tau:[.012,.018,.012,.008], weights:[.30,.60,.62,.26], noise:.80, duration:.14 },
  steel: { E:200e9, nu:.30, modes:[3280,5410,8270,11920], tau:[.012,.010,.009,.004], weights:[.45,.60,.68,.15], noise:.90, duration:.12 },
  resin: { E:2.2e9, nu:.35, modes:[710,1670,3730,6970], tau:[.009,.007,.005,.003], weights:[.12,.18,.40,.21], noise:1.20, duration:.09 },
  metal: { E:69e9, nu:.33, modes:[1230,3290,5870,9140], tau:[.016,.020,.012,.007], weights:[.18,.52,.45,.18], noise:.36, duration:.15 },
});
export function modalSamples(contact, sampleRate=48000) {
  const material = MATERIALS[contact.material] ? contact.material : 'resin', m=MATERIALS[material];
  const speed=Math.max(.02,Math.min(5,Number(contact.speed)||.02));
  const impulse=Math.max(0,Math.min(.05,Number(contact.impulse)||0));
  const {radius,mass}=BALL;
  const reducedMass=material==='steel'?mass/2:mass, reducedRadius=material==='steel'?radius/2:radius;
  const effectiveE=1/((1-.3**2)/200e9+(1-m.nu**2)/m.E);
  const hertz=2.94*(reducedMass**2/(reducedRadius*effectiveE**2*speed))**.2;
  const length=Math.ceil(m.duration*sampleRate), out=new Float32Array(length);
  const variation=((contact.variant??0)%7-3)*.006;
  // 衝突のエネルギー/力積が増すほど励振が強まる。静止支持力には別途ゲート。
  const amp=Math.min(.55,(.10*Math.sqrt(speed)+Math.sqrt(impulse))*1.7);
  const brightness=.68+.32*Math.sqrt(speed/5);
  for(let k=0;k<m.modes.length;k++) {
    const f=m.modes[k]*(1+variation), w=m.weights[k]*Math.exp(-((.65*f*hertz)**2))*(k<2?1:brightness);
    for(let i=0;i<length;i++) {
      const t=i/sampleRate, attack=Math.min(1,t/.00025);
      out[i]+=amp*w*Math.sin(2*Math.PI*f*t)*Math.exp(-t/m.tau[k])*attack;
    }
  }
  // Hertz接触による短い励振の広帯域成分を近似。実接触以外の架空の衝突は増やさない。
  let seed=(Math.round(speed*1000)+Math.round(impulse*1e6)+(contact.variant??0)*97)>>>0,low=0,body=0;
  const lp=1-Math.exp(-2*Math.PI*10500/sampleRate), hp=1-Math.exp(-2*Math.PI*2400/sampleRate);
  for(let i=0;i<length;i++) {
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;const white=seed/2147483648-1,t=i/sampleRate;
    low+=lp*(white-low);body+=hp*(low-body);
    const pulse=(low-body)*amp*m.noise*brightness*Math.exp(-t/.004)*Math.min(1,t/.0002);
    out[i]=.78*Math.tanh((out[i]+pulse)*1.25);
  }
  // 放射/取付部の実測なし。公称モードは材質別の試作パラメータ、固有値解析結果ではない。
  const fade=Math.round(.012*sampleRate);
  for(let i=0;i<fade;i++) out[length-fade+i]*=(1+Math.cos(Math.PI*i/(fade-1)))/2;
  return out;
}
