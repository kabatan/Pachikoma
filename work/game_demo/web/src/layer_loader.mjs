// 光層パック（tools/pack_layers.py の出力: layers.pack + manifest.json）の読込。
// 形式は半精度 float + gzip（DecompressionStream で復号。追加ライブラリなし）。行0=画像の上、RGB(A) インターリーブ、premultiplied、線形 Rec.709。
import * as THREE from '../vendor/three/three.module.js';

async function gunzip(u8) {
  const ds = new DecompressionStream('gzip');
  const stream = new ReadableStream({ start(c) { c.enqueue(u8); c.close(); } }).pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const toU16 = (u8) => new Uint16Array(u8.buffer, u8.byteOffset, u8.byteLength >> 1);
const ONE_HALF = 0x3c00;
// Only the validated private default-M3 decoder creates this representation.
const M3_ENV_CHANNELS = new WeakMap();
export function m3EnvironmentChannels(texture) {
  const channels = M3_ENV_CHANNELS.get(texture) || 0;
  if (!channels || texture.format === (channels === 1 ? THREE.RedFormat : THREE.RGBFormat)) return channels;
  // A normal fullRGBA replacement can use the old path; never reinterpret compact bytes with4-channel strides.
  const image = texture.image, data = image?.data;
  if (texture.type === THREE.HalfFloatType && texture.format === THREE.RGBAFormat && image.width === 1440 && image.height === 2560
    && ArrayBuffer.isView(data) && Object.getPrototypeOf(data) === Uint16Array.prototype && data.length === 1440 * 2560 * 4
    && data.byteOffset === 0 && data.byteLength === data.length * 2 && data.buffer instanceof ArrayBuffer
    && !data.buffer.resizable && data.buffer.byteLength === data.byteLength) return 0;
  throw new Error('marked M3 environment format/shape mismatch');
}
export function inheritM3EnvironmentChannels(source, texture, channels) {
  if (!M3_ENV_CHANNELS.has(source) || (channels !== 1 && channels !== 3)) throw new Error('unknown M3 compact source');
  M3_ENV_CHANNELS.set(texture, channels);
}

const RGB16_U32_LE = typeof Uint32Array === 'function' && new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
function rgbToRgba(h, n, startPixel = 0, prefixHalf = 0, sourceStartPixel = startPixel) {
  const o = new Uint16Array(n * 4);
  if (prefixHalf) o.fill(prefixHalf, 0, startPixel * 4);
  if (RGB16_U32_LE && Number.isSafeInteger(n) && n > 0 && n % 2 === 0 && h instanceof Uint16Array && h.buffer instanceof ArrayBuffer && !h.buffer.resizable && h.byteOffset % 4 === 0 && h.length === (n - startPixel + sourceStartPixel) * 3) {
    const src = new Uint32Array(h.buffer, h.byteOffset, h.length / 2), dst = new Uint32Array(o.buffer);
    for (let s = sourceStartPixel * 3 / 2, d = startPixel * 2; s < src.length; s += 3, d += 4) {
      const rg = src[s], br = src[s + 1], gb = src[s + 2];
      dst[d] = rg;
      dst[d + 1] = (br & 0xffff) | 0x3c000000;
      dst[d + 2] = (br >>> 16) | ((gb & 0xffff) << 16);
      dst[d + 3] = (gb >>> 16) | 0x3c000000;
    }
    return o;
  }
  for (let i = startPixel, s = sourceStartPixel * 3; i < n; i++, s += 3) { o[4*i] = h[s]; o[4*i+1] = h[s+1]; o[4*i+2] = h[s+2]; o[4*i+3] = ONE_HALF; }
  return o;
}

/** @returns {{manifest, entries, env, stats}}  entries は HybridRenderer.setLayers にそのまま渡せる。env は name → THREE.DataTexture(RGBA16F, 行0=上, フルサイズ) */
export async function loadLayerPack(baseUrl, { concurrency = 4, onProgress = null, loadLayers = true, ownedM3Prefix = false } = {}) {
  const t0 = performance.now();
  const manifest = await (await fetch(baseUrl + '/manifest.json')).json();
  if (manifest.version !== 1) throw new Error('unsupported manifest version ' + manifest.version);
  if (manifest.linear_space !== 'linear Rec.709') throw new Error('linear_space mismatch: ' + manifest.linear_space);
  // Private default-M3 opt-in only; unknown/partial/RGBA inputs keep the original conversion.
  const targetNames = ['A_back', 'B_back', 'A_front', 'B_front', 'tau', 'occ'];
  const names = [...targetNames, 'M0_back', 'M1_back', 'M0_front', 'M1_front'];
  // A tail/omitted marker is never interpreted by the generic full-record decoder.
  const maskFormat = manifest.m3_environment_layout === 'rgb-tail-mask-v1';
  const tailFormat = maskFormat || manifest.m3_environment_layout === 'rgb-tail-v1';
  const markedTail = Object.hasOwn(manifest, 'm3_environment_layout')
    || manifest.env?.some(e => ['f16-gzip-m3-tail', 'f16-half01-lsb-gzip', 'f16-zero'].includes(e?.encoding))
    || manifest.layers?.some(e => e?.payload_omitted === true || e?.encoding === 'omitted');
  let end = 0;
  const validTail = tailFormat && ownedM3Prefix === true && !loadLayers
    && manifest.image_size?.[0] === 1440 && manifest.image_size?.[1] === 2560
    && Array.isArray(manifest.layers) && manifest.layers.every(e => e && e.payload_omitted === true && e.encoding === 'omitted' && !('offset' in e) && !('bytes' in e))
    && Array.isArray(manifest.env) && manifest.env.length === 10 && new Set(manifest.env.map(e => e?.name)).size === 10
    && manifest.env.every(e => {
      if (!e || !names.includes(e.name) || e.size?.[0] !== 1440 || e.size?.[1] !== 2560
        || !Number.isSafeInteger(e.offset) || e.offset !== end || !Number.isSafeInteger(e.bytes)
        || (maskFormat && e.name === 'M0_front' ? e.bytes !== 0 : e.bytes <= 0)) return false;
      end += e.bytes;
      const target = targetNames.includes(e.name), row = e.name === 'tau' || e.name === 'occ' ? 2470 : 2215;
      if (!Number.isSafeInteger(end) || e.channels !== (target ? 3 : 4)) return false;
      if (target) return e.encoding === 'f16-gzip-m3-tail' && e.tail_start_row === row && e.raw_bytes === 1440 * (2560 - row) * 6;
      if (Object.hasOwn(e, 'tail_start_row') || e.raw_bytes !== 1440 * 2560 * 8) return false;
      if (!maskFormat) return e.encoding === 'f16-gzip';
      return e.name === 'M0_front'
        ? e.encoding === 'f16-zero' && e.zero_bits === 0 && e.packed_bytes === 0
        : e.encoding === 'f16-half01-lsb-gzip' && e.packed_bytes === 1440 * 2560 / 2 && !Object.hasOwn(e, 'zero_bits');
    }) && Number.isSafeInteger(manifest.pack_bytes) && manifest.pack_bytes === end && end > 0;
  if (markedTail && !validTail) throw new Error('invalid private M3 tail pack');
  const pack = new Uint8Array(await (await fetch(baseUrl + '/' + manifest.pack)).arrayBuffer());
  if (tailFormat && pack.byteLength !== manifest.pack_bytes) throw new Error('M3 tail pack byte length mismatch');
  const prepareM3 = ownedM3Prefix === true && !loadLayers && manifest.image_size?.[0] === 1440 && manifest.image_size?.[1] === 2560
    && Array.isArray(manifest.env) && manifest.env.length === 10 && new Set(manifest.env.map(e => e?.name)).size === 10
    && manifest.env.every(e => e && e.encoding === 'f16-gzip' && names.includes(e.name) && e.size?.[0] === 1440 && e.size?.[1] === 2560
      && e.channels === (targetNames.includes(e.name) ? 3 : 4) && e.raw_bytes === 1440 * 2560 * e.channels * 2);
  const decode = async (rec, nPix) => {
    if (maskFormat && validTail && rec.encoding === 'f16-zero') return new Uint8Array(nPix * 4);
    const u8 = await gunzip(pack.subarray(rec.offset, rec.offset + rec.bytes));
    const bitmap = maskFormat && validTail && rec.encoding === 'f16-half01-lsb-gzip';
    if (u8.byteLength !== (bitmap ? rec.packed_bytes : rec.raw_bytes)) throw new Error('raw_bytes mismatch for ' + (rec.source_id || rec.name));
    if (bitmap) {
      const data = new Uint8Array(nPix * 4), view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      for (let i = 0; i < u8.byteLength; i += 4) {
        let bits = view.getUint32(i, true);
        while (bits) {
          data[i * 8 + 31 - Math.clz32(bits & -bits)] = 255;
          bits = (bits & (bits - 1)) >>> 0;
        }
      }
      return data;
    }
    const h = toU16(u8.byteLength % 2 ? u8.slice() : u8);
    if (tailFormat && rec.encoding === 'f16-gzip-m3-tail') {
      if (maskFormat && validTail) {
        const channels = rec.name === 'occ' ? 1 : 3, start = rec.tail_start_row * 1440;
        const data = new Uint16Array(nPix * channels), prefix = rec.name === 'tau' ? ONE_HALF : rec.name === 'occ' ? 0x5240 : 0;
        if (prefix) data.fill(prefix, 0, start * channels);
        if (channels === 3) data.set(h, start * 3);
        else for (let i = start, j = 0; i < nPix; i++, j += 3) data[i] = h[j];
        return data;
      }

      return rgbToRgba(h, nPix, rec.tail_start_row * 1440, rec.name === 'tau' ? ONE_HALF : rec.name === 'occ' ? 0x5240 : 0, 0);
    }
    if (prepareM3 && targetNames.includes(rec.name) && RGB16_U32_LE && h instanceof Uint16Array && Object.getPrototypeOf(h) === Uint16Array.prototype
      && h.buffer instanceof ArrayBuffer && !h.buffer.resizable && h.byteOffset % 4 === 0 && h.length === nPix * 3) {
      const row = rec.name === 'tau' || rec.name === 'occ' ? 2470 : 2215;
      return rgbToRgba(h, nPix, row * 1440, rec.name === 'tau' ? ONE_HALF : rec.name === 'occ' ? 0x5240 : 0);
    }
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
        rgb_scale: L.rgb_scale || [1, 1, 1], ...(loadLayers ? { pixels: await decode(L, rw * rh) } : {}) };
      if (onProgress) onProgress(++done, manifest.layers.length);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const env = {};
  for (const E of manifest.env || []) {
    const [w, h] = E.size;
    const data = await decode(E, w * h);
    const maskU8 = maskFormat && validTail && !targetNames.includes(E.name);
    const channels = maskFormat && validTail && targetNames.includes(E.name) ? (E.name === 'occ' ? 1 : 3) : 4;
    const t = new THREE.DataTexture(data, w, h, channels === 1 ? THREE.RedFormat : channels === 3 ? THREE.RGBFormat : THREE.RGBAFormat, maskU8 ? THREE.UnsignedByteType : THREE.HalfFloatType);
    if (channels !== 4) { t.internalFormat = channels === 1 ? 'R16F' : 'RGB16F'; M3_ENV_CHANNELS.set(t, channels); }

    t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
    env[E.name] = t;
  }
  return { manifest, entries, env, stats: { ms: performance.now() - t0, layers: entries.length, packBytes: pack.byteLength } };
}
