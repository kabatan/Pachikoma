// 場面の切れ目の GPU→CPU 読み戻し(7.5MB級)で、毎回 作っていた 読み戻し用バッファ・上下反転用バッファ・ImageData(計 約22MB)を
// 使い回す。画素は従来と同一(同じ行入れ替え)。?readscratch=0 で従来(毎回確保)。
const ON = new URLSearchParams(globalThis.location?.search ?? '').get('readscratch') !== '0';
const bytesPool = new Map(), imagePool = new Map();
/** readRenderTargetPixels に渡す受け皿(長さ w*h*4 ちょうど) */
export function readBytes(len) {
  if (!ON) return new Uint8Array(len);
  let b = bytesPool.get(len); if (!b) { if (bytesPool.size >= 3) bytesPool.clear(); b = new Uint8Array(len); bytesPool.set(len, b); }
  return b;
}
/** 読み戻したバイト列(下原点)を上下反転して、新しい canvas に書いて返す */
export function flippedCanvas(bytes, w, h, readyState = false) {
  const row = w * 4; let img;
  if (ON) { const k = w + 'x' + h; img = imagePool.get(k); if (!img) { if (imagePool.size >= 3) imagePool.clear(); img = new ImageData(w, h); imagePool.set(k, img); } }
  else img = new ImageData(new Uint8ClampedArray(bytes.length), w, h);
  const top = img.data;
  for (let y = 0; y < h; y++) top.set(bytes.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  const c = document.createElement('canvas'); c.width = w; c.height = h; if (readyState) c.readyState = 4;
  c.getContext('2d', { alpha: false }).putImageData(img, 0, 0);
  return c;
}
