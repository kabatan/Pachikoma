// web/の担当コードへは公開APIと既存のProbeSetデータ構造で接続する。
import * as THREE from '../web/vendor/three/three.module.js';
import { loadLayerPack } from '../web/src/layer_loader.mjs';
import { LightingDriver } from './lighting.mjs';

async function fetchOk(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r;
}

/** manifest URLまたはpackディレクトリを受ける。環境の未納品部分はダミーを保持。 */
export async function connectLayerPack(hr, url, { dummyEntries = [] } = {}) {
  if (!url) {
    hr.setLayers(dummyEntries);
    hr.useDummyProbeBases([...new Set(dummyEntries.map((e) => e.source_id))]);
    hr.setEnvironment(hr.env); // τ と occ を同じ環境オブジェクトから渡す
    return { lighting: new LightingDriver(dummyEntries, { dummy: true }), info: { layers: 'dummy', environment: 'dummy', probes: 'dummy', occlusion: 'dummy' } };
  }
  const manifestUrl = new URL(url, location.href);
  if (!manifestUrl.pathname.endsWith('.json')) manifestUrl.pathname = manifestUrl.pathname.replace(/\/$/, '') + '/manifest.json';
  // 既存loadLayerPackはディレクトリ/manifest.jsonを読む契約。
  if (!manifestUrl.pathname.endsWith('/manifest.json')) throw new Error('pack manifest must be named manifest.json');
  const base = new URL('.', manifestUrl).href.replace(/\/$/, '');
  const pack = await loadLayerPack(base), m = pack.manifest;
  if (m.image_size?.[0] !== 1440 || m.image_size?.[1] !== 2560) throw new Error('pack image_size must be 1440x2560');
  if (!m.camera_hash || !m.geometry_hash) throw new Error('pack is missing camera/geometry hash');
  hr.setLayers(pack.entries);
  const env = { back: { ...hr.env.back }, front: { ...hr.env.front }, tau: hr.env.tau, occ: hr.env.occ };
  const loaded = [];
  for (const side of ['back', 'front']) for (const key of ['A', 'B', 'M0', 'M1']) {
    const name = key + '_' + side;
    if (pack.env[name]) { env[side][key] = pack.env[name]; loaded.push(name); }
  }
  for (const key of ['tau', 'occ']) if (pack.env[key]) { env[key] = pack.env[key]; loaded.push(key); }
  hr.setEnvironment(env);
  const sourceIds = [...new Set(pack.entries.map((e) => e.source_id))];
  hr.useDummyProbeBases(sourceIds);
  let probes = 'dummy';
  // 別納の13点cube atlas。既存ProbeSetの環境16基底+sourceIndex形式へ載せる。
  if (m.probes) {
    const p = m.probes, W = hr.probes.W, H = hr.probes.H;
    if (p.width !== W || p.height !== H || p.layers !== 16 + p.source_ids.length || p.layers > hr.probes.maxBases || p.linear_space !== 'linear Rec.709') throw new Error('probe atlas contract mismatch');
    // GitHubの1ファイル100MB制限のため、公開版では p.parts(分割ファイル名の配列)に分けて置く。順に結合してから展開する。
    let buf;
    if (Array.isArray(p.parts) && p.parts.length) {
      const chunks = await Promise.all(p.parts.map(async (f) => new Uint8Array(await (await fetchOk(new URL(f, manifestUrl))).arrayBuffer())));
      const joined = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0)); let at = 0;
      for (const c of chunks) { joined.set(c, at); at += c.byteLength; }
      buf = joined.buffer;
    } else buf = await (await fetchOk(new URL(p.file, manifestUrl))).arrayBuffer();
    if (p.encoding === 'gzip') buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    if (buf.byteLength !== W * H * p.layers * 8) throw new Error('probe atlas byte length mismatch');
    const tex = new THREE.DataArrayTexture(new Uint16Array(buf), W, H, p.layers);
    tex.type = THREE.HalfFloatType; tex.format = THREE.RGBAFormat; tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;
    const old = hr.probes.bases; hr.probes.bases = { texture: tex, dispose: () => tex.dispose() }; old?.dispose();
    hr.probes.sourceIndex = new Map(p.source_ids.map((id, i) => [id, 16 + i]));
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
    hr.setBalls({ count: snapshot.count, positions: snapshot.positions });
  };
}
