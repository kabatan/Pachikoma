// 10/30 説明(チュートリアル)の「長押しでスキップ」表示。液晶の隅に、筐体の左ボタンと同じ形・色のボタン絵＋リング＋字を小さな2D絵として描く。
// 押し始めるとリングが満ち、ボタンが押し込まれて光が強まる。満ちきったら閃光＋「SKIP」。短い押下ではリングが少し満ちてすぐ戻る(controller.tutSkipView)。
// update(view) は絵が変わったときだけ再描画して revision を進める(GPU側はそれで再合成)。映像の上に重ねるだけで、映像・操作は変えない。
export const OV_W = 470, OV_H = 176;
const FONT = "'Noto Sans JP','Noto Sans CJK JP','Hiragino Sans','Yu Gothic','Meiryo',sans-serif";
export function createSkipOverlay({ x, y }) {
  const canvas = document.createElement('canvas'); canvas.width = OV_W; canvas.height = OV_H;
  const c = canvas.getContext('2d');
  let key = '', rev = 0, visible = false;
  const ease = (t) => t * t * (3 - 2 * t);
  function plate(a) {   // 暗い曲面ガラス＋走査線。平らな箱にしない
    const r = 26, w = OV_W - 6, h = OV_H - 6;
    c.save(); c.translate(3, 3); c.globalAlpha = a;
    c.beginPath(); c.roundRect(0, 0, w, h, r);
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(18,26,52,.80)'); g.addColorStop(.5, 'rgba(6,10,26,.78)'); g.addColorStop(1, 'rgba(0,2,12,.86)');
    c.fillStyle = g; c.fill();
    c.clip(); c.fillStyle = 'rgba(0,0,0,.20)'; for (let yy = 1; yy < h; yy += 4) c.fillRect(0, yy, w, 1.5);
    const hl = c.createLinearGradient(0, 0, 0, h * .45); hl.addColorStop(0, 'rgba(255,255,255,.16)'); hl.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = hl; c.fillRect(0, 0, w, h * .45);
    c.restore();
    c.save(); c.globalAlpha = a; c.translate(3, 3); c.beginPath(); c.roundRect(1, 1, OV_W - 8, OV_H - 8, r);
    const eg = c.createLinearGradient(0, 0, 0, OV_H); eg.addColorStop(0, 'rgba(220,235,255,.85)'); eg.addColorStop(.5, 'rgba(110,140,200,.55)'); eg.addColorStop(1, 'rgba(60,80,140,.7)');
    c.lineWidth = 3; c.strokeStyle = eg; c.stroke(); c.restore();
  }
  function button(cx, cy, press, glow, flash) {
    c.save(); c.translate(cx, cy);
    const R = 58;   // ベゼル(金属の縁)
    let g = c.createLinearGradient(0, -R, 0, R); g.addColorStop(0, '#e9edf5'); g.addColorStop(.45, '#8d96a8'); g.addColorStop(1, '#2d3340');
    c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fillStyle = g; c.fill();
    g = c.createLinearGradient(0, R, 0, -R); g.addColorStop(0, '#f5f7fb'); g.addColorStop(.5, '#555d6e'); g.addColorStop(1, '#161a22');
    c.beginPath(); c.arc(0, 0, R - 5, 0, Math.PI * 2); c.fillStyle = g; c.fill();
    c.beginPath(); c.arc(0, 2, R - 9, 0, Math.PI * 2); c.fillStyle = '#05060a'; c.fill();   // 溝
    const s = 1 - 0.09 * press, dy = 5 * press;   // 押し込み：小さくなって沈む
    c.shadowColor = `rgba(255,${70 + 90 * glow | 0},40,${.35 + .65 * glow})`; c.shadowBlur = 10 + 34 * glow;
    const rr = (R - 12) * s;
    g = c.createRadialGradient(-rr * .3, -rr * .4 + dy, rr * .05, 0, dy, rr);
    const l = 1 + .35 * glow;   // 光が強まる
    const col = (r, gg, b) => `rgb(${Math.min(255, r * l) | 0},${Math.min(255, gg * l) | 0},${Math.min(255, b * l) | 0})`;
    g.addColorStop(0, col(255, 150, 120)); g.addColorStop(.35, col(236, 44, 44)); g.addColorStop(.8, col(170, 14, 24)); g.addColorStop(1, col(100, 6, 14));
    c.beginPath(); c.arc(0, dy, rr, 0, Math.PI * 2); c.fillStyle = g; c.fill(); c.shadowBlur = 0;
    const hi = c.createRadialGradient(-rr * .35, -rr * .5 + dy, 1, -rr * .35, -rr * .5 + dy, rr * .7);   // 艶
    hi.addColorStop(0, `rgba(255,255,255,${.75 - .35 * press})`); hi.addColorStop(1, 'rgba(255,255,255,0)');
    c.beginPath(); c.arc(0, dy, rr, 0, Math.PI * 2); c.fillStyle = hi; c.fill();
    if (flash > 0) { c.globalCompositeOperation = 'lighter'; c.beginPath(); c.arc(0, 0, R + 10, 0, Math.PI * 2); c.fillStyle = `rgba(255,240,200,${.8 * flash})`; c.fill(); }
    c.restore();
  }
  function ring(cx, cy, level, flash, holding) {
    const R = 78; c.save(); c.translate(cx, cy); c.lineCap = 'round';
    c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.lineWidth = 13; c.strokeStyle = 'rgba(0,0,0,.65)'; c.stroke();
    c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.lineWidth = 9; c.strokeStyle = 'rgba(70,90,140,.55)'; c.stroke();
    if (level > 0.001) {
      const a0 = -Math.PI / 2, a1 = a0 + Math.PI * 2 * Math.min(1, level);
      const hue = 190 - 140 * level;   // 水色 → 金
      c.shadowColor = `hsla(${hue},100%,65%,1)`; c.shadowBlur = 10 + 22 * (holding ? 1 : .5) + 30 * flash;
      c.beginPath(); c.arc(0, 0, R, a0, a1); c.lineWidth = 9; c.strokeStyle = flash > 0 ? `hsl(${hue},100%,${70 + 28 * flash}%)` : `hsl(${hue},100%,66%)`; c.stroke();
      c.shadowBlur = 0; c.beginPath(); c.arc(0, 0, R, a0, a1); c.lineWidth = 3; c.strokeStyle = 'rgba(255,255,255,.9)'; c.stroke();
    }
    c.restore();
  }
  function label(text, tx, ty, size, a, glow, grad) {
    c.save(); c.globalAlpha = a; c.font = `900 ${size}px ${FONT}`; c.textBaseline = 'middle'; c.lineJoin = 'round';
    c.shadowColor = `rgba(120,200,255,${.35 + .6 * glow})`; c.shadowBlur = 8 + 18 * glow;
    c.lineWidth = size * .2; c.strokeStyle = '#04060f'; c.strokeText(text, tx, ty);
    c.shadowBlur = 0;
    const g = c.createLinearGradient(0, ty - size / 2, 0, ty + size / 2); g.addColorStop(0, grad[0]); g.addColorStop(.5, grad[1]); g.addColorStop(1, grad[2]);
    c.fillStyle = g; c.fillText(text, tx, ty);
    c.lineWidth = 1.5; c.strokeStyle = 'rgba(255,255,255,.55)'; c.strokeText(text, tx, ty); c.restore();
  }
  return {
    canvas, x, y, get revision() { return rev; }, get visible() { return visible; },
    /** view = controller.tutSkipView()。見えるべきなら true。 */
    update(view) {
      const a = view?.active ? Math.min(1, Math.max(0, (view.t - 0.3) / 0.5)) : 0;
      visible = a > 0.001;
      const level = view?.level ?? 0, tap = view?.tap ?? 0, flash = view?.flash ?? 0, done = !!view?.done, holding = !!view?.holding;
      const k = `${visible ? 1 : 0}|${(a * 30) | 0}|${(level * 120) | 0}|${(tap * 12) | 0}|${(flash * 12) | 0}|${done ? 1 : 0}|${holding ? 1 : 0}`;
      if (k === key) return visible;
      key = k; rev++;
      c.clearRect(0, 0, OV_W, OV_H); if (!visible) return false;
      const press = holding || done ? 1 : Math.min(1, tap * 1.2), glow = Math.min(1, .15 + .85 * level + .5 * tap);
      plate(a * .96); c.save(); c.globalAlpha = a;
      ring(88, 88, level, flash, holding); button(88, 88, press, glow, flash); c.restore();
      if (done) {
        label('SKIP', 178, 88, 78, a, 1, ['#ffffff', '#fff3b0', '#ffc13b']);
        if (flash > 0) { c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = `rgba(255,248,220,${.35 * flash})`; c.beginPath(); c.roundRect(3, 3, OV_W - 6, OV_H - 6, 26); c.fill(); c.restore(); }
      } else {
        label('長押しで', 178, 54, 40, a, tap, ['#ffffff', '#e6f2ff', '#9cc7ff']);
        label('スキップ', 178, 114, 52, a, tap + level, ['#ffffff', '#fff6c8', '#ffcf5c']);
      }
      return true;
    },
  };
}
