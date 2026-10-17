// 通常画面(水中の桜)をLCDの土台として使う橋渡し。three.jsのモジュールを使うので、<script type="module">で読む。
import { NormalScreen } from '/work/lcd_normal/src/normal_screen.mjs';
window.LCD_BASE = async (manifestUrl) => {
  const canvas = document.createElement('canvas');
  const ns = new NormalScreen({ canvas, manifestUrl, upaEnabled: false });
  ns.setLamps(0); await ns.init(); ns.update(0); ns.render();
  const bad = new Set();   // 置けない灯数は1回だけ警告して以後は再試行しない(毎フレームの警告の洪水を防ぐ)
  return { canvas, ns, update: (dt) => ns.update(dt), render: () => ns.render(), setLamps: (n) => { if (n === ns.lamps || bad.has(n)) return; for (let k = n; k >= 0; k--) { try { ns.setLamps(k); return; } catch (e) { if (k === n) bad.add(n); console.warn('setLamps', n, 'fallback', k - 1, e.message); } } } };
};
window.dispatchEvent(new Event('lcd-base-ready'));
