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
  const draw = (ctx, s, n, X, Y, sc, f) => {
    const face = digits.gold, glyphs = [...String(Math.max(0, Math.round(n)))];
    const H = s.h * s.z * sc, k = Math.floor(f / 3) % 4;   // 照りは 3 コマごと（継続の数字と同じ）
    const items = glyphs.map((g, i) => { const im = face[g]?.[(k + i) % 4]; if (!im) return null; const h = H * (im.naturalHeight / 350); return { im, w: im.naturalWidth * h / im.naturalHeight, h }; }).filter(Boolean);
    const total = items.reduce((a, it, i) => a + it.w * (i < items.length - 1 ? 0.92 : 1), 0);
    const cx = X + (s.ox + (s.r ?? s.x) * s.z) * sc, cy = Y + (s.oy + s.y * s.z) * sc;
    let x = s.r != null ? cx - total : cx - total / 2;
    ctx.save(); ctx.globalAlpha = s.a ?? 1;
    for (const it of items) { ctx.drawImage(it.im, x, cy - it.h / 2, it.w, it.h); x += it.w * 0.92; }
    ctx.restore();
  };
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
