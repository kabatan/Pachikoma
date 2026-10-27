// JP の重ね物（FLOW 第3版 §7 の A）：灯の柱（左右 2 本）と揃いの札（左下の 4・4・？）。JP の映像の上、数字の下に描く。
// 見え方の手本は effects/jp_film/review/flow/make_flow_v3.py の pillar と slots（576×634）。ここは 1152×1268 の窓の座標で描き、VIS へ写す。
//   const ov = await createFlowOverlay({ ctx, VIS, base })   // base＝泡の部品の場所（effects/jp_film/pub/overlay/）
//   ov.draw(jp.where(), dt)                                 // JP の場面の間、毎コマ
// 柱：通常時の画面の 6 つの泡（6 つ目は金）を縦に並べる。場面で泡のまわりの光の色が変わる。JP チャンス・カットイン・確定・大当りの間は引っ込める。
// 札：リーチで出す。狙いの間「？」が脈打ち、球が飛んでいる間（カットイン）は速く強く光る。確定で「？」が「4」に変わる。
const FPS = 30;
const GOLD = '255,214,110';
const LAMP = { six: GOLD, aim: '170,220,255', pay: GOLD };
const KAKUTEI = 30;   // S4a_hit の頭の確定のコマ数（slot v17c）
const easeOut = (t) => 1 - (1 - Math.max(0, Math.min(1, t))) ** 3;

// 場面の名前とコマ → { pillar: 色の名前 | null, slots: null | 'q' | 'a', glow, pop }
function stateOf(name, f) {
  if (name === 'S2_intro') return { pillar: 'six', slots: f >= 30 ? 'q' : null, pop: 0, glow: 0 };
  if (name.startsWith('S1')) return { pillar: null, slots: 'q', glow: 0 };
  if (name === 'S2_aim') return { pillar: 'aim', slots: 'q', glow: 0 };
  if (name.startsWith('S3')) return { pillar: null, slots: 'q', glow: 0.55 + 0.45 * Math.sin(f * 0.9), fast: true };   // 球が飛んでいる
  if (name.startsWith('S4a')) return { pillar: null, slots: 'a', pop: f < KAKUTEI ? Math.max(0, 1 - f / 8) : 0 };
  if (name.startsWith('S4b')) return { pillar: null, slots: null };
  if (/^S[56]_/.test(name)) return { pillar: 'pay', slots: 'a', pop: 0 };
  return { pillar: null, slots: null };   // 継続（C*）などは重ねない
}

export async function createFlowOverlay({ ctx, VIS, base }) {
  const load = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  const bubbles = await Promise.all([0, 1, 2, 3, 4, 5].map((k) => load(new URL(`bubble_${k}.png`, base).href)));
  if (bubbles.some((b) => !b)) console.warn('flow overlay: bubbles missing');
  const sx = VIS.w / 1152, sy = VIS.h / 1268;
  const X = (x) => VIS.x + x * sx, Y = (y) => VIS.y + y * sy;
  let rise = 0, col = GOLD, slotA = 0, frame = 0, acc = 0, lastSt = 'q';

  const drawPillar = () => {
    const pw = 92, y0 = 260, y1 = 1012;
    const h = (y1 - y0) * easeOut(rise), ya = y1 - h;
    if (h < 24) return;
    for (const x0 of [32, 1152 - 32 - pw]) {
      ctx.save();
      ctx.beginPath(); ctx.roundRect(X(x0), Y(ya), pw * sx, h * sy, (pw / 2) * sx);
      ctx.fillStyle = 'rgba(26,12,6,0.67)'; ctx.fill();
      ctx.lineWidth = 6 * sx; ctx.strokeStyle = `rgb(${GOLD})`; ctx.stroke();
      ctx.clip();
      const step = (y1 - y0 - 48) / 6, cx = x0 + pw / 2;
      for (let k = 0; k < 6; k++) {
        const cy = y1 - 32 - step * (k + 0.5);
        if (cy - 44 < ya) continue;
        const glow = 0.5 + 0.5 * Math.sin(frame * 0.5 - k * 0.8);
        ctx.beginPath(); ctx.arc(X(cx), Y(cy), 50 * sx, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${col},${((60 + 60 * glow) / 255).toFixed(3)})`; ctx.fill();
        ctx.beginPath(); ctx.arc(X(cx), Y(cy), 46 * sx, 0, Math.PI * 2);
        ctx.lineWidth = 6 * sx; ctx.strokeStyle = `rgb(${col})`; ctx.stroke();
        if (bubbles[k]) ctx.drawImage(bubbles[k], X(cx - 44), Y(cy - 44), 88 * sx, 88 * sy);
      }
      ctx.restore();
    }
  };

  const drawSlots = (st, pop, glow, fast) => {
    if (slotA <= 0.01) return;
    const bw = 92, bh = 108, gap = 16, x00 = 104, y00 = 1048;
    const pulse = 0.5 + 0.5 * Math.sin(frame * (fast ? 0.9 : 0.45));
    ctx.save(); ctx.globalAlpha = slotA;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (let i = 0; i < 3; i++) {
      let x = x00 + i * (bw + gap), y = y00, w = bw, h = bh;
      const q = i === 2 && st === 'q';
      if (i === 2 && pop > 0) { const g = 60 * pop; x -= g / 2; y -= g / 2; w += g; h += g; }
      if (q && glow > 0) { const g = 32 * glow; x -= g / 2; y -= g / 2; w += g; h += g; }
      ctx.beginPath(); ctx.roundRect(X(x), Y(y), w * sx, h * sy, 14 * sx);
      ctx.fillStyle = q ? `rgba(${20 + 200 * glow | 0},${16 + 170 * glow | 0},${30 + 60 * glow | 0},0.92)` : 'rgba(30,20,8,0.92)'; ctx.fill();
      ctx.lineWidth = (q ? 6 : 4) * sx;
      ctx.strokeStyle = q ? `rgb(255,${Math.min(255, 190 + 60 * pulse + 60 * glow) | 0},${Math.min(255, 90 + 80 * pulse + 150 * glow) | 0})` : `rgb(${GOLD})`;
      ctx.stroke();
      const size = (i === 2 && !q ? 80 + 20 * pop : 80) * sy;
      ctx.font = `${size}px "Dela Gothic One"`;
      const cx = X(x + w / 2), cy = Y(y + h / 2 + 2);
      if (q) {
        ctx.lineWidth = 4 * sx; ctx.strokeStyle = 'rgb(90,40,0)';
        ctx.fillStyle = `rgba(255,245,190,${Math.min(1, (150 + 105 * pulse + 100 * glow) / 255).toFixed(3)})`;
        ctx.strokeText('?', cx, cy); ctx.fillText('?', cx, cy);
      } else {
        ctx.lineWidth = 6 * sx; ctx.strokeStyle = 'rgb(90,40,0)'; ctx.fillStyle = 'rgb(255,230,140)';
        ctx.strokeText('4', cx, cy); ctx.fillText('4', cx, cy);
      }
    }
    if (pop > 0) {   // 揃った瞬間の輪
      const r = 60 + 240 * (1 - pop), cx = x00 + 2 * (bw + gap) + bw / 2, cy = y00 + bh / 2;
      ctx.beginPath(); ctx.arc(X(cx), Y(cy), r * sx, 0, Math.PI * 2);
      ctx.lineWidth = 8 * sx; ctx.strokeStyle = `rgba(255,240,180,${(0.86 * pop).toFixed(3)})`; ctx.stroke();
    }
    ctx.restore();
  };

  return {
    draw(w, dt = 1 / FPS) {
      if (!w?.name) { rise = 0; slotA = 0; return; }
      acc += dt; const steps = Math.min(4, Math.floor(acc * FPS + 1e-6)); acc -= steps / FPS;
      const s = stateOf(w.name, w.f ?? 0);
      if (s.pillar) col = LAMP[s.pillar];
      for (let i = 0; i < steps; i++) {
        frame++;
        rise = s.pillar ? Math.min(1, rise + 1 / 11) : Math.max(0, rise - 1 / 6);   // 立つのは 11 コマ、引っ込むのは 6 コマ
        slotA = s.slots ? Math.min(1, slotA + 1 / 4) : Math.max(0, slotA - 1 / 6);
      }
      if (s.slots) lastSt = s.slots;
      drawPillar();
      drawSlots(s.slots ?? lastSt, s.pop ?? 0, s.glow ?? 0, !!s.fast);
    },
  };
}
