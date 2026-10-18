import { createDetailChannels } from './detail_channels.mjs';
import { installProbeUniforms } from './probe_uniforms.mjs';
import { installSumAtlas } from './sum_atlas.mjs';
import { installSharedLightField } from './shared_light_field.mjs';
import { installProbeReuse } from './probe_reuse.mjs';
// Selected by select_render.mjs. Keep the tray renderer's render wrapper intact.
import * as THREE from '../web/vendor/three/three.module.js';
import { installSparseLayers } from './sparse_layers.mjs';
import { installMergedBack } from './merged_back.mjs';
import { installFloatTargets } from './float_targets.mjs';
import { installAffineLut } from './affine_lut.mjs';
import { installEnvironmentBasis } from './environment_basis.mjs';
import { PROBES } from '../web/src/probes.mjs';

export async function installRenderR2(hr, { nativePack = false, trimBox = [1100,680,1410,1510] } = {}) {
  const selection=new URLSearchParams(location.search).get('reuse');
  const debug=hr.gl.getExtension('WEBGL_debug_renderer_info');
  const device=debug?String(hr.gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)):'';
  const software=/SwiftShader|llvmpipe|softpipe|software rasterizer|Microsoft Basic Render/i.test(device);
  const enabled=selection!=='reference'&&(selection==='exact'||software);
  if (nativePack) {
    const url = new URL('./data/pack/layer_detail.f16.gz', import.meta.url);
    const response = await fetch(url); if (!response.ok) throw new Error(`R2 detail: HTTP ${response.status}`);
    const raw = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    if (raw.byteLength !== 1440*2560*8) throw new Error('R2 detail size mismatch');
    const detail = new THREE.DataTexture(new Uint16Array(raw), 1440, 2560, THREE.RGBAFormat, THREE.HalfFloatType);
    detail.minFilter = detail.magFilter = THREE.NearestFilter; detail.needsUpdate = true;
    const split=(!enabled&&selection!=='reference'&&!software)?createDetailChannels(new Uint16Array(raw),1440,2560,trimBox):null;
    const layerDetail=split?.layer||detail,copyDetail=split?.copy||detail,copyOffset=split?.offset||[0,0];
    hr.stats.detailChannels={enabled:!!split,layerBytesPerTexel:split?4:8,copyBytesPerTexel:split?2:8,bytes:split?.bytes||raw.byteLength,copyWidth:copyDetail.image.width,copyHeight:copyDetail.image.height};

    for (const side of ['back', 'front']) for (const bucket of hr.layerBuckets[side]) {
      const mat = bucket.mat;
      mat.uniforms.uR2Detail = { value: layerDetail };
      mat.vertexShader = mat.vertexShader.replace('void main() {', 'flat varying vec2 vR2Bbox;\nvoid main() { vR2Bbox = aRect.zw;');
      mat.fragmentShader = mat.fragmentShader.replace('void main() {', 'uniform highp sampler2D uR2Detail; flat varying vec2 vR2Bbox;\nvoid main() {')
        .replace('gl_FragColor = vec4(t.rgb * vW, 0.0);', `
          vec4 correction = texelFetch(uR2Detail, ivec2(int(gl_FragCoord.x), 2559-int(gl_FragCoord.y)), 0);
          bool reduced = any(lessThan(vTex.yz, vR2Bbox-0.5));
          gl_FragColor = vec4(t.rgb * vW * correction.g * (reduced ? correction.r : 1.0), 0.0);`);
      mat.needsUpdate = true;
    }
    // Back G includes static E and cabinet illumination on the metal. Copy only
    // the covered part forward, so moving the body does not extinguish its light.
    const copies = [];
    const addCopy = (geo, mat, order) => {
      const mesh = new THREE.Mesh(geo,mat);mesh.frustumCulled=false;mesh.renderOrder=order;
      const saved = new THREE.Vector4();let scissorTest=false;
      mesh.onBeforeRender = renderer => {
        renderer.getScissor(saved);scissorTest=renderer.getScissorTest();
        renderer.setScissor(trimBox[0],2560-trimBox[3],trimBox[2]-trimBox[0],trimBox[3]-trimBox[1]);renderer.setScissorTest(true);
      };
      mesh.onAfterRender = renderer => {renderer.setScissor(saved);renderer.setScissorTest(scissorTest);};
      hr.sFront.add(mesh);copies.push(mesh);
    };
    const frontBlend = { blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.DstAlphaFactor,
      blendDst:THREE.OneFactor,blendSrcAlpha:THREE.ZeroFactor,blendDstAlpha:THREE.OneFactor };
    const envExpression = 'vec4(wa * a.rgb + wb * b.rgb, 0.0)';
    if (!hr.envBack.fragmentShader.includes(envExpression)) throw new Error('R2 environment shader changed');
    const envCopy=split?`vec4((wa * a.rgb + wb * b.rgb) * texelFetch(uR2Detail, q-ivec2(${copyOffset[0]},${copyOffset[1]}), 0).r, 0.0)`:'vec4((wa * a.rgb + wb * b.rgb) * texelFetch(uR2Detail, q, 0).b, 0.0)';
    const envMat = new THREE.ShaderMaterial({vertexShader:hr.envBack.vertexShader,
      fragmentShader:hr.envBack.fragmentShader.replace('void main() {','uniform highp sampler2D uR2Detail;\nvoid main() {')
        .replace(envExpression,envCopy),
      uniforms:{...hr.envBack.uniforms,uR2Detail:{value:copyDetail}},depthTest:false,depthWrite:false,...frontBlend});
    addCopy(hr.sBack.children.find(mesh=>mesh.material===hr.envBack).geometry,envMat,90);
    for (const bucket of hr.layerBuckets.back) {
      const expression = 't.rgb * vW * correction.g * (reduced ? correction.r : 1.0)';
      if (!bucket.mat.fragmentShader.includes(expression)) throw new Error('R2 layer shader changed');
      let copyFragment=bucket.mat.fragmentShader.replace(expression,expression+(split?` * texelFetch(uR2Copy,ivec2(int(gl_FragCoord.x)-${copyOffset[0]},2559-int(gl_FragCoord.y)-${copyOffset[1]}),0).r`:' * correction.b'));
      if(split)copyFragment='uniform highp sampler2D uR2Copy;\n'+copyFragment;
      const mat = new THREE.ShaderMaterial({ vertexShader:bucket.mat.vertexShader,
        fragmentShader:copyFragment,
        uniforms:{...bucket.mat.uniforms,...(split?{uR2Copy:{value:copyDetail}}:{})},side:THREE.DoubleSide,depthTest:false,depthWrite:false,
        ...frontBlend });
      addCopy(bucket.geo,mat,100+copies.length);
    }
    hr.r2Detail = detail;
    const dispose = hr.dispose.bind(hr);
    hr.dispose = () => { for(const mesh of copies){hr.sFront.remove(mesh);mesh.material.dispose();}detail.dispose();if(split){split.layer.dispose();split.copy.dispose();}dispose(); };
  }
  // Probe selection depends on a sphere centre, not on its mesh vertices.
  // Move the identical nearest-zone/three-point calculation to per-instance CPU data.
  const geo = hr.balls.geometry, n = hr.opts.maxBalls;
  const indices = new THREE.InstancedBufferAttribute(new Float32Array(n*3), 3);
  const weights = new THREE.InstancedBufferAttribute(new Float32Array(n*3), 3);
  indices.setUsage(THREE.DynamicDrawUsage); weights.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aR2PI', indices); geo.setAttribute('aR2PW', weights);
  const mat = hr.ballMat;
  mat.vertexShader = mat.vertexShader.replace('void main() {', 'attribute vec3 aR2PI, aR2PW;\nvoid main() {');
  const begin = mat.vertexShader.indexOf('          // プローブ選択:');
  const end = mat.vertexShader.indexOf('vPI = idx; vPW = wt / max(wt.x + wt.y + wt.z, 1e-12);', begin);
  if (begin < 0 || end < 0) throw new Error('R2 ball shader changed; inspect probe selection before updating');
  mat.vertexShader = mat.vertexShader.slice(0, begin) + 'vPI = aR2PI; vPW = aR2PW;' + mat.vertexShader.slice(end + 'vPI = idx; vPW = wt / max(wt.x + wt.y + wt.z, 1e-12);'.length);
  mat.needsUpdate = true;
  const original = hr.setBalls.bind(hr);
  const distances = new Float32Array(PROBES.length), selected = new Int32Array(3), ws = new Float32Array(3);
  const centres = new Float32Array(n*3); centres.fill(NaN);
  hr.setBalls = data => {
    original(data);
    const count = hr.balls.count, a = hr.balls.instanceMatrix.array;
    let changed = false;
    for (let i = 0; i < count; i++) {
      const x = a[16*i+12], y = a[16*i+13], z = a[16*i+14];
      if (centres[i*3] === x && centres[i*3+1] === y && centres[i*3+2] === z) continue;
      centres[i*3] = x; centres[i*3+1] = y; centres[i*3+2] = z;
      let best = Infinity, zone = 0;
      for (let j = 0; j < PROBES.length; j++) {
        const p = PROBES[j];
        const d = Math.fround(Math.fround((x-p.pos[0])**2) + Math.fround((y-p.pos[1])**2) + Math.fround((z-p.pos[2])**2));
        if (d < best) { best = d; zone = p.zone; } distances[j] = d;
      }
      selected.fill(-1);
      for (let k = 0; k < 3; k++) {
        let dd = Infinity, index = -1;
        for (let j = 0; j < PROBES.length; j++) if (PROBES[j].zone === zone && !selected.includes(j) && distances[j] < dd) { dd = distances[j]; index = j; }
        selected[k] = index;
      }
      let sum = 0;
      for (let k = 0; k < 3; k++) { ws[k] = selected[k] < 0 ? 0 : 1/(distances[selected[k]]+1e-5); sum += ws[k]; }
      for (let k = 0; k < 3; k++) {
        const o = i*3+k, w = Math.fround(ws[k]/Math.max(sum,1e-12));
        if (indices.array[o] !== selected[k] || weights.array[o] !== w) { indices.array[o] = selected[k]; weights.array[o] = w; changed = true; }
      }
    }
    if (changed) {
      for (const attribute of [indices, weights]) { attribute.addUpdateRange(0,count*3); attribute.needsUpdate = true; }
    }
  };
  // Do not resolve a depth attachment that no later pass samples.
  hr.rtMain.resolveDepthBuffer = false;
  hr.stats.renderProfile = 'r2';
  // Keep hardware rendering's existing formats and draw path. The software
  // path computes the same image, with unchanged resolution and MSAA samples.
  hr.stats.renderReuse={enabled,software,selection:selection||'auto',device};
  if(!enabled&&selection!=='reference'&&!software){installSumAtlas(hr);installSparseLayers(hr,{textureWeights:true});installMergedBack(hr);installProbeUniforms(hr);installProbeReuse(hr,{visibleOnly:true});hr.stats.nativeReuse=true;}
  if(enabled){
    installSparseLayers(hr);installFloatTargets(hr);installMergedBack(hr);installAffineLut(hr);installEnvironmentBasis(hr);installProbeReuse(hr,{visibleOnly:true});installSharedLightField(hr);
  }
}
