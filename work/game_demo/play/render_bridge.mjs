// web/の担当コードへは公開APIと既存のProbeSetデータ構造で接続する。
import * as THREE from '../web/vendor/three/three.module.js';
import { loadLayerPack } from '../web/src/layer_loader.mjs';
import { LightingDriver } from './lighting.mjs';

async function fetchOk(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r;
}

/** manifest URLまたはpackディレクトリを受ける。環境の未納品部分はダミーを保持。 */
export async function connectLayerPack(hr, url, { dummyEntries = [], loadLayers = true, ownedM3Prefix = false } = {}) {
  if (!url) {
    if (!hr.env) hr._ensureEnvironment();
    hr.setLayers(loadLayers ? dummyEntries : []);
    hr.useDummyProbeBases([...new Set(dummyEntries.map((e) => e.source_id))]);
    hr.setEnvironment(hr.env); // τ と occ を同じ環境オブジェクトから渡す
    return { lighting: new LightingDriver(dummyEntries, { dummy: true }), info: { layers: 'dummy', environment: 'dummy', probes: 'dummy', occlusion: 'dummy' } };
  }
  const manifestUrl = new URL(url, location.href);
  if (!manifestUrl.pathname.endsWith('.json')) manifestUrl.pathname = manifestUrl.pathname.replace(/\/$/, '') + '/manifest.json';
  // 既存loadLayerPackはディレクトリ/manifest.jsonを読む契約。
  if (!manifestUrl.pathname.endsWith('/manifest.json')) throw new Error('pack manifest must be named manifest.json');
  const base = new URL('.', manifestUrl).href.replace(/\/$/, '');
  const pack = await loadLayerPack(base, { loadLayers, ownedM3Prefix }), m = pack.manifest;
  if (m.image_size?.[0] !== 1440 || m.image_size?.[1] !== 2560) throw new Error('pack image_size must be 1440x2560');
  if (!m.camera_hash || !m.geometry_hash) throw new Error('pack is missing camera/geometry hash');
  hr.setLayers(loadLayers ? pack.entries : []);
  // Check the decoded textures, not just manifest declarations, before skipping the dummy.
  const completeEnvironment = ['A_back', 'B_back', 'M0_back', 'M1_back', 'A_front', 'B_front', 'M0_front', 'M1_front', 'tau', 'occ']
    .every(name => pack.env[name]?.isTexture === true);
  let deferredDummy = !hr.env && !completeEnvironment ? hr._ensureEnvironment() : null;
  const baseEnvironment = hr.env || { back: {}, front: {} };
  const env = { back: { ...baseEnvironment.back }, front: { ...baseEnvironment.front }, tau: baseEnvironment.tau, occ: baseEnvironment.occ };
  const loaded = [];
  for (const side of ['back', 'front']) for (const key of ['A', 'B', 'M0', 'M1']) {
    const name = key + '_' + side;
    if (pack.env[name]) { env[side][key] = pack.env[name]; loaded.push(name); }
  }
  for (const key of ['tau', 'occ']) if (pack.env[key]) { env[key] = pack.env[key]; loaded.push(key); }
  try {
    hr.setEnvironment(env);
  } finally {
    // Only the dummy created here is owned here; retain every RT/texture still live, even on error.
    if (deferredDummy) {
      const slots = e => [...Object.values(e.back), ...Object.values(e.front), e.tau, e.occ];
      const live = new Set(slots(hr.env).flatMap(x => [x, x?.texture]).filter(Boolean));
      for (const rt of new Set(slots(deferredDummy))) {
        if (rt?.isWebGLRenderTarget && !live.has(rt) && !live.has(rt.texture)) rt.dispose();
      }
      deferredDummy = null;
    }
  }
  const sourceIds = [...new Set(pack.entries.map((e) => e.source_id))];
  // atlasがあるpackは直後に基底を置換する。描画前のdummy生成を省き、atlasがない経路だけ従来通り生成する。
  if (!m.probes) hr.useDummyProbeBases(sourceIds);
  let probes = 'dummy';
  // 別納の13点cube atlas。既存ProbeSetの環境16基底+sourceIndex形式へ載せる。
  if (m.probes) {
    const p = m.probes, W = hr.probes.W, H = hr.probes.H;
    const physical = p.layout === 'source-physical-v1';
    const rgb = p.texel_format === 'rgb16f-v1';
    if (p.texel_format != null && !rgb) throw new Error('unsupported probe texel format');
    if (rgb && (!physical || ownedM3Prefix !== true || p.channels !== 3 || p.alpha_bits !== 0x3c00
      || p.encoding !== 'gzip' || p.raw_bytes !== W * H * p.layers * 6 || typeof hr.gl?.RGB16F !== 'number')) throw new Error('private RGB16F probe contract mismatch');
    if (p.layout != null && !physical) throw new Error('unsupported probe layout');
    if (physical && (loadLayers || hr.opts?.deferProbeBases !== true || p.layers !== 126 || p.logical_layers !== 139 || p.source_ids.length !== 123
      || !Array.isArray(p.source_layers) || p.source_layers.length !== p.source_ids.length
      || p.source_layers.some(layer => !Number.isInteger(layer) || layer < 16 || layer >= p.layers)
      || new Set(p.source_layers).size !== p.layers - 16)) throw new Error('physical probe mapping mismatch');
    if (p.width !== W || p.height !== H || (!physical && p.layers !== 16 + p.source_ids.length) || p.layers > hr.probes.maxBases || p.linear_space !== 'linear Rec.709') throw new Error('probe atlas contract mismatch');
    // GitHubの1ファイル100MB制限のため、公開版では p.parts(分割ファイル名の配列)に分けて置く。順に結合してから展開する。
    let buf, inflated = false;
    if (Array.isArray(p.parts) && p.parts.length) {
      const chunks = await Promise.all(p.parts.map(async (f) => new Uint8Array(await (await fetchOk(new URL(f, manifestUrl))).arrayBuffer())));
      const joined = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0)); let at = 0;
      for (const c of chunks) { joined.set(c, at); at += c.byteLength; }
      buf = joined.buffer;
    } else {
      const response = await fetchOk(new URL(p.file, manifestUrl));
      if (p.encoding === 'gzip' && response.body) {
        buf = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
        inflated = true;
      } else buf = await response.arrayBuffer();
    }
    if (p.encoding === 'gzip' && !inflated) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    if (buf.byteLength !== W * H * p.layers * (rgb ? 6 : 8)) throw new Error('probe atlas byte length mismatch');
    const tex = new THREE.DataArrayTexture(new Uint16Array(buf), W, H, p.layers);
    tex.type = THREE.HalfFloatType; tex.format = rgb ? THREE.RGBFormat : THREE.RGBAFormat; tex.minFilter = tex.magFilter = THREE.NearestFilter;
    if (rgb) { tex.internalFormat = 'RGB16F'; tex.colorSpace = THREE.NoColorSpace; }
    tex.needsUpdate = true;
    const old = hr.probes.bases; hr.probes.bases = { texture: tex, dispose: () => tex.dispose() }; old?.dispose();
    hr.probes.sourceIndex = new Map(p.source_ids.map((id, i) => [id, physical ? p.source_layers[i] : 16 + i]));
    hr.probes.nBases = p.layers; hr.probes.composeMat.uniforms.uBases.value = tex;
    probes = 'atlas';
  }
  const lighting = new LightingDriver(pack.entries, { sources: m.lighting?.sources ?? {} });
  return { lighting, info: { layers: 'pack', environment: loaded, probes, occlusion: loaded.includes('occ') ? 'pack' : 'dummy', unmapped: lighting.unmapped, camera_hash: m.camera_hash, geometry_hash: m.geometry_hash, ...pack.stats } };
}

/** Adapter snapshots are already in assembly axes; apply no second stage offset. */
export function connectAssemblyBalls(hr, transforms) {
  return snapshot => {
    if (snapshot.coordinate_frame !== transforms.frame || snapshot.stage_transforms_revision !== transforms.revision) throw new Error('Ball snapshot assembly frame mismatch');
    hr.setBalls(hr.trayVisualHandle?.visibleBalls?.(snapshot) ?? { count: snapshot.count, positions: snapshot.positions });
  };
}
