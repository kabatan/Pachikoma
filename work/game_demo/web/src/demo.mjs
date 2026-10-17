// デモ: 玉 N 個 + 層 L 層/側 + 点灯アニメ。?balls=300&layers=25&static=1(固定時刻)&view=1
import { HybridRenderer } from './hybrid_renderer.mjs';
import { Gen } from './dummy.mjs';
import { makeScene } from './demo_scene.mjs';

const q = new URLSearchParams(location.search);
const hr = new HybridRenderer({ canvas: document.getElementById('c'), dither: +(q.get('dither') || 0) });
await hr.init();
const scene = makeScene(hr, { balls: +(q.get('balls') || 300), layers: +(q.get('layers') || 25), seed: +(q.get('seed') || 1), envScale: +(q.get('env') ?? 1) });
hr.viewMode = +(q.get('view') || 0); hr.lutEnabled = q.get('lut') !== '0';
const hud = document.getElementById('hud');
const gl = hr.gl, dbg = gl.getExtension('WEBGL_debug_renderer_info');
window.__glinfo = { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?' };
window.__hr = hr;
let t0 = performance.now(), last = t0, frames = 0, acc = 0;
function loop(now) {
  const t = q.get('static') ? +q.get('static') : (now - t0) / 1000;
  scene.update(t);
  hr.render();
  frames++; acc += now - last; last = now;
  if (frames % 30 === 0) { hud.textContent = `${(1000 / (acc / 30)).toFixed(1)} fps  balls=${hr.stats.activeBalls} layers=${hr.stats.activeLayers}\n${window.__glinfo.renderer}`; acc = 0; }
  if (q.get('static') && frames === 3) { window.__canvasPNG = () => { hr.render(); return document.getElementById('c').toDataURL('image/png'); }; window.__result = { ok: true, stats: hr.stats, layerCount: hr.layerCount, calls: hr.renderer.info.render.calls, tris: hr.renderer.info.render.triangles }; window.__done = true; return; }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
