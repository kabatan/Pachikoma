// 光層パック（tools/pack_layers.py の出力: layers.pack + manifest.json）の読込。
// 形式は半精度 float + gzip（DecompressionStream で復号。追加ライブラリなし）。行0=画像の上、RGB(A) インターリーブ、premultiplied、線形 Rec.709。
import * as THREE from '../vendor/three/three.module.js';

async function gunzip(u8) {
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([u8]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const toU16 = (u8) => new Uint16Array(u8.buffer, u8.byteOffset, u8.byteLength >> 1);
const ONE_HALF = 0x3c00;
function rgbToRgba(h, n) { const o = new Uint16Array(n * 4); for (let i = 0; i < n; i++) { o[4*i] = h[3*i]; o[4*i+1] = h[3*i+1]; o[4*i+2] = h[3*i+2]; o[4*i+3] = ONE_HALF; } return o; }

/** @returns {{manifest, entries, env, stats}}  entries は HybridRenderer.setLayers にそのまま渡せる。env は name → THREE.DataTexture(RGBA16F, 行0=上, フルサイズ) */
export async function loadLayerPack(baseUrl, { concurrency = 4, onProgress = null } = {}) {
  const t0 = performance.now();
  const manifest = await (await fetch(baseUrl + '/manifest.json')).json();
  if (manifest.version !== 1) throw new Error('unsupported manifest version ' + manifest.version);
  if (manifest.linear_space !== 'linear Rec.709') throw new Error('linear_space mismatch: ' + manifest.linear_space);
  const pack = new Uint8Array(await (await fetch(baseUrl + '/' + manifest.pack)).arrayBuffer());
  const decode = async (rec, nPix) => {
    const u8 = await gunzip(pack.subarray(rec.offset, rec.offset + rec.bytes));
    if (u8.byteLength !== rec.raw_bytes) throw new Error('raw_bytes mismatch for ' + (rec.source_id || rec.name));
    const h = toU16(u8.byteLength % 2 ? u8.slice() : u8);
    return rec.channels === 3 ? rgbToRgba(h, nPix) : h;
  };
  const entries = new Array(manifest.layers.length);
  let next = 0, done = 0;
  const worker = async () => {
    for (;;) {
      const i = next++; if (i >= manifest.layers.length) return;
      const L = manifest.layers[i];
      const [rw, rh] = L.resolution;
      entries[i] = { source_id: L.source_id, receiver_id: L.receiver_id, route_band: L.route_band, side: L.side, bbox: L.bbox, resolution: L.resolution,
        rgb_scale: L.rgb_scale || [1, 1, 1], pixels: await decode(L, rw * rh) };
      if (onProgress) onProgress(++done, manifest.layers.length);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const env = {};
  for (const E of manifest.env || []) {
    const [w, h] = E.size;
    const data = await decode(E, w * h);
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
    env[E.name] = t;
  }
  return { manifest, entries, env, stats: { ms: performance.now() - t0, layers: entries.length, packBytes: pack.byteLength } };
}
