// The original clip product is exactly zero outside the glass. Keep the same
// nonzero arithmetic and light order; avoid the finite accumulator there.
function blockEnd(source,start){let level=0;for(let i=source.indexOf('{',start);i<source.length;i++){if(source[i]==='{')level++;if(source[i]==='}'&&!--level)return i+1;}return -1;}
export function installEarlyLightClip(hr){
 const update=hr._updateEnvUniforms.bind(hr),seen=new WeakMap(),mats=[hr.envBack,hr.envFront];
 const stats=hr.stats.earlyLightClip={patched:0,fallbacks:0};
 const tail='if (uBLi.z > uBLi.x) { vec2 ilo = smoothstep(uBLi.xy - uBLis, uBLi.xy + uBLis, pp), ihi = 1.0 - smoothstep(uBLi.zw - uBLis, uBLi.zw + uBLis, pp); acc *= ilo.x * ilo.y * ihi.x * ihi.y; }';
 hr._updateEnvUniforms=()=>{
  for(const m of mats){
   if(!m.uniforms.uBLi||m.uniforms.uBLi.value.z<=m.uniforms.uBLi.value.x)continue;
   const source=m.fragmentShader;if(seen.get(m)===source)continue;seen.set(m,source);
   if(source.includes('r2LightClip'))continue;
   const start=source.indexOf('          vec2 mlo = smoothstep(uBLr.xy'),loop=source.indexOf('for (int i = 0; i < ',start),end=blockEnd(source,loop),clipAt=source.indexOf(tail,end);
   if(start<0||loop<0||end<0||clipAt<0){stats.fallbacks++;continue;}
   const prefix='float r2LightClip=1.0;if(uBLi.z>uBLi.x){vec2 r2lo=smoothstep(uBLi.xy-uBLis,uBLi.xy+uBLis,pp),r2hi=1.0-smoothstep(uBLi.zw-uBLis,uBLi.zw+uBLis,pp);r2LightClip=r2lo.x*r2lo.y*r2hi.x*r2hi.y;}if(r2LightClip!=0.0){';
   const patched=(source.slice(0,start)+prefix+source.slice(start,end)+'}'+source.slice(end)).replace(tail,'acc *= r2LightClip;');
   m.fragmentShader=patched;m.needsUpdate=true;seen.set(m,patched);stats.patched++;
  }
  update();
 };
}
