// Same dimensions, samples, geometry and lighting, using float32 intermediates.
// Software backend: keeps MSAA support intact, with higher intermediate precision.
import * as THREE from '../web/vendor/three/three.module.js';
export function installFloatTargets(hr){
  const gl=hr.gl,stats=hr.stats.floatTargets={enabled:false};
  if(!gl.getExtension('EXT_color_buffer_float')||!gl.getExtension('EXT_float_blend'))return;
  const samples=Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER,gl.RGBA32F,gl.SAMPLES));stats.supportedSamples=samples;
  if(hr.rtMain.samples&&!samples.includes(hr.rtMain.samples))return;
  for(const target of [hr.rtMain,hr.rtC]){target.dispose();target.texture.type=THREE.FloatType;}
  stats.enabled=true;stats.samples=hr.rtMain.samples;
}
