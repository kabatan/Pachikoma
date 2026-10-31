// 10/31 回転率（監督「失敗表示は FAILED とかでいい」）。失敗の映像（fail_v9、ガラスが割れる瞬間＝16コマ目）に FAILED の字を叩きつける。?turnover=0 で無し。
//   液晶の層：lcd.jpHud.splitLayers に足す（jp_count_1031 と同じ。読み戻し・全画面転送なし）。字は起動時に一度だけ読む。
import * as THREE from '../../web/vendor/three/three.module.js';
import { layerTexture } from './lcd_split_1030.mjs';
const PX = 34, PY = 28, WW = 1152, CY = 600, W_ON = 1040, AT = 16;
export async function attachFailLabel(lcd) {
  if (!lcd?.jp || lcd.failLabel || new URLSearchParams(globalThis.location?.search ?? '').get('turnover') === '0') return lcd;
  const im = new Image(); im.src = new URL('./fail_1031/failed.png', import.meta.url).href;
  try { await im.decode(); } catch (e) { console.warn('[fail-label]', e); return lcd; }
  const tex = layerTexture(THREE, im), w = im.naturalWidth, h = im.naturalHeight, dark = (() => { const c = document.createElement('canvas'); c.width = c.height = 8; const x = c.getContext('2d'); x.fillStyle = '#05030c'; x.fillRect(0, 0, 8, 8); return layerTexture(THREE, c); })();
  (lcd.splitWarmers ??= []).push({ name: 'faillabel', done: false, step(r) { try { r.initTexture(tex); r.initTexture(dark); } catch {} return (this.done = true); } });
  const layers = () => {
    const a = lcd.jp.where?.(); if (!a || !/^fail_/.test(a.name ?? '') || !(a.f >= AT)) return null;
    const t = a.f - AT, slam = t < 4 ? 1.7 - 0.7 * (t / 4) : 1 + 0.03 * Math.exp(-(t - 4) * 0.5) * Math.cos((t - 4) * 1.4), sc = (W_ON / w) * slam;
    const shake = t < 8 ? (8 - t) * (t % 2 ? 1.6 : -1.6) : 0;
    return [{ tex: dark, w: 8, h: 8, ax: 4, ay: 4, x: PX + WW / 2, y: PY + CY, rot: 0, sc: WW / 8 * 1.3, alpha: Math.min(0.35, t * 0.09), add: false },
      { tex, w, h, ax: w / 2, ay: h / 2, x: PX + WW / 2 + shake, y: PY + CY, rot: 0, sc, alpha: Math.min(1, (t + 1) / 2), add: false }];
  };
  let hooked = false; const frame0 = lcd.frame.bind(lcd);
  lcd.frame = (dt, F) => { if (!hooked && lcd.jpHud?.splitLayers) { const o = lcd.jpHud.splitLayers.bind(lcd.jpHud); lcd.jpHud.splitLayers = () => { const x = o(), y = layers(); return x && y ? [...x, ...y] : (x ?? y); }; hooked = true; } return frame0(dt, F); };
  lcd.failLabel = { layers };
  return lcd;
}
