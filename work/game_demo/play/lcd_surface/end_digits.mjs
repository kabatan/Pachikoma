// 計数(finish_count)と結果(result)の数字を、数字を抜いて書き出した映像(clips/finish_count_r*.mp4・result_r*.mp4)の上に重ねる。
// 映像は最終ランクごと(tools/end_v/render_end_v.mjs)。数字の枠はコマごとに clips/end_v_slots.json に記録してある(位置・大きさ・揺れ・消え方)。
// 字の部品は継続の数字と同じ(effects/chain/tmp/export/digits、lcd_surface.mjs の loadDigits で読んだ物を受け取る)。
//   balls   持ち玉。映像の数え上げ(u＝0〜1)に合わせて 0 から数え上げる。右寄せ(右端 r)
//   score   JP の合計。映像のものさしの値(cv、代表値 rep まで)を、境の値はそのまま・最後は実際の合計へ写す(境を越える瞬間に境の値を指す)
//   to_next 「あと N玉で」の N
export async function createEndDigits({ slotsUrl, digits }) {
  let T = null;
  try { const r = await fetch(slotsUrl); if (!r.ok) throw new Error(`HTTP ${r.status}`); T = await r.json(); }
  catch (e) { console.warn('end digits', e.message); return null; }
  let vals = {};
  // 映像の中のものさしの値 cv → 重ねる JP の合計。折れ線 [0, 越えた境…, rep] → [0, 同じ境…, 実際の合計]
  const mapScore = (tr, cv, score) => {
    if (!(tr.rep > 0)) return score;
    const th = tr.thresholds.slice(0, tr.rank), xs = [0, ...th, tr.rep], ys = [0, ...th, score];
    for (let i = 1; i < xs.length; i++) if (cv <= xs[i]) return Math.round(ys[i - 1] + (ys[i] - ys[i - 1]) * (cv - xs[i - 1]) / Math.max(1e-6, xs[i] - xs[i - 1]));
    return score;
  };
  // 部品は字ごとに幅 300 へ伸ばしてあり、細い「1」ほど大きく写る(112・410 で 1 だけ大きく隣に重なった)。
  // 字の実際の形(不透明の範囲)を測って、どの字も同じ高さ・同じ字間で並べる
  const box = new Map(), probe = document.createElement('canvas'), pg = probe.getContext('2d', { willReadFrequently: true });
  const bounds = (im) => {
    if (box.has(im)) return box.get(im);
    probe.width = im.naturalWidth; probe.height = im.naturalHeight; pg.clearRect(0, 0, probe.width, probe.height); pg.drawImage(im, 0, 0);
    const d = pg.getImageData(0, 0, probe.width, probe.height).data; let x0 = probe.width, x1 = -1, y0 = probe.height, y1 = -1;
    for (let y = 0; y < probe.height; y++) for (let x = 0; x < probe.width; x++) if (d[(y * probe.width + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const b = x1 < 0 ? { x0: 0, x1: im.naturalWidth, y0: 0, y1: im.naturalHeight } : { x0, x1: x1 + 1, y0, y1: y1 + 1 }; box.set(im, b); return b;
  };
  const draw = (ctx, s, n, X, Y, sc, f) => {
    const face = digits.gold, glyphs = [...String(Math.max(0, Math.round(n)))];
    // 照りは明るい 2 枚(1・2)だけを全桁そろえて交互に(暗い 0・3 は茶の上で沈んだ)
    const H = s.h * s.z * sc, ch = H * 0.806, gap = ch * 0.07, k = 1 + (Math.floor(f / 4) % 2);
    const items = glyphs.map((g) => { const im = face[g]?.[k]; if (!im) return null; const b = bounds(im), q = ch / (b.y1 - b.y0); return { im, b, q, w: (b.x1 - b.x0) * q }; }).filter(Boolean);
    const total = items.reduce((a, it) => a + it.w, 0) + gap * Math.max(0, items.length - 1);
    const cx = X + (s.ox + (s.r ?? s.x) * s.z) * sc, cy = Y + (s.oy + s.y * s.z) * sc;
    let x = s.r != null ? cx - total : cx - total / 2;
    ctx.save(); ctx.globalAlpha = s.a ?? 1;
    for (const it of items) { ctx.drawImage(it.im, x - it.b.x0 * it.q, cy - (it.b.y0 + it.b.y1) / 2 * it.q, it.im.naturalWidth * it.q, it.im.naturalHeight * it.q); x += it.w + gap; }
    ctx.restore();
  };
  for (const g of '0123456789') for (const k of [1, 2]) { const im = digits?.gold?.[g]?.[k]; if (im) bounds(im); }   // 測るのは起動時に済ませる(場面の頭で詰まらない)
  return {
    // ゲームの出来事の値を覚える(finish_count・result の data)
    onEvent(id, p = {}) {
      if (id === 'finish_count' || id === 'result') vals = { ...vals, ...p };
      if (id === 'attract' || id === 'ticket') vals = {};
    },
    // 出来事 → 流す映像の名前(最終ランクと「あと N玉」の有無)。無ければ null(従来の 1 本)
    pick(id) {
      if (id !== 'finish_count' && id !== 'result') return null;
      const r = Number.isInteger(vals.rankIndex) ? vals.rankIndex : Number.isInteger(vals.rank) ? vals.rank : 0;
      const hint = vals.to_next > 0 && vals.to_next <= 27 && Number.isInteger(vals.next_rank);
      const base = `${id}_r${Math.max(0, Math.min(4, r))}`;
      return hint && T[base + 'h'] ? base + 'h' : T[base] ? base : null;
    },
    // 映像の上に重ねる。t＝その映像の再生位置(秒)。X,Y,sc＝映像(1152×1268)を貼った位置と倍率
    draw(ctx, name, t, X, Y, sc = 1) {
      const tr = T[name]; if (!tr || !digits?.gold) return;
      const f = Math.max(0, Math.min(tr.frames.length - 1, Math.floor(t * tr.fps + 1e-6)));
      for (const s of tr.frames[f]) {
        if (s.k === 'balls') draw(ctx, s, Math.floor((vals.total ?? vals.balls ?? 0) * s.u), X, Y, sc, f);
        else if (s.k === 'score') draw(ctx, s, mapScore(tr, s.cv, vals.score ?? 0), X, Y, sc, f);
        else if (s.k === 'to_next' && vals.to_next > 0) draw(ctx, s, vals.to_next, X, Y, sc, f);
      }
    },
  };
}
