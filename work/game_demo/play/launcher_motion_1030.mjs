// 射出器が球を「落としている」ように見せる動き（10/30 launcher_anim_1）。見た目だけ。物理・規則・凍結の静止像は変えない。
//   物理の側は、撃った瞬間に射出口の位置から (shuttle の vx, -0.35 m/s) の球をぽんと出し、0.45 秒後に次の球がシャトルに突然現れる。
//   ここでは、描画に渡す玉の位置だけを次のように足し引きして、爪・筒の動きと合わせる（絵は launcher_body_m3.mjs が pose で選ぶ）。
//   ・撃った球：爪が開くまで少し止めて、止まった所から加速して物理の球に追い付く（追い付く先は物理の球そのもの。位置も速さも途切れない）。
//   ・次の球：筒の中で待っている球（stock が 1 以上の間だけ。ゲーム側の予備球の数）が、首の裏を通って爪へ落ち、爪が閉じてつかむ。
//     物理の球が現れた所から、筒の位置までの高さぶん上にずらして描き、落としていく。
//   ・待っている球：筒の底に 1 個。無い（stock=0）ときは筒が空。減った後は頭の下から次が落ちてくる。
//   ・爪の開き（pose）：撃った直後 A1→A2→R1→R2→A3（全開）、球が来る間は A3、つかんだら A2→A1→A0（閉じる）。
// 座標は assembly の m（y が上）。`?launchanim=0` で無効（play.mjs 側）。
const H_REST = 0.0182;       // 待ち球の中心は射出口より 18.2 mm 上（筒の底。K3 y 493.2 と 539.6 の差）
const H_TOP = 0.0407;        // 頭のふたの下に隠れる高さ（筒の上端）
const T_ARRIVE = 0.085;      // 待ち球が首を通って爪まで落ちる時間（H_REST のとき）
const T_WENTER = 0.08;       // 次の待ち球が頭の下から筒の底まで落ちる時間
const W_DELAY = 0.03;        // 前の球が筒を抜けてから、次が降り始めるまで
const D0 = 0.002, D1 = 0.036; // 撃った球の追い付き：物理の球が 2 mm 落ちるまで止め、36 mm 落ちたら一致
const REL_POSES = [[0.014, 'A1'], [0.030, 'A2'], [0.080, 'R1'], [0.140, 'R2']];   // 撃ってからの秒数の上限 → 絵
const CLOSE_POSES = [[0.02, 'A2'], [0.04, 'A1']];                                    // つかんでからの秒数の上限 → 絵（そのあとは A0）
const sstep = (u) => { u = u < 0 ? 0 : u > 1 ? 1 : u; return u * u * (3 - 2 * u); };

export function createLauncherMotion({ getShots = null } = {}) {
  let prevHas = null, prevShots = null, prevStock = null;
  let arrive = null;          // { t0, h0, T, ball: 'hold' | 'gone' }
  let lastRel = -1;           // 直近に撃った時刻
  let wEnter = null;          // { t0 }：待ち球が頭の下から降りている最中
  const rels = [];            // { id, y0, t0, arr }
  const out = { snapshot: null, pose: 'A3' };

  function nearestBoard(s, x, y, z) {
    let best = -1, bd = 1e9;
    for (let i = 0; i < s.count; i++) {
      if (s.kinds[i] !== 0) continue;
      const dx = s.positions[3 * i] - x, dy = s.positions[3 * i + 1] - y, dz = s.positions[3 * i + 2] - z, d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    return bd < 0.03 * 0.03 ? best : -1;
  }
  const arrOff = (a, now) => { if (!a) return 0; const u = (now - a.t0) / a.T; return u >= 1 ? 0 : u < 0 ? a.h0 : a.h0 * (1 - u * u); };

  function update(s) {
    const now = s.time, sh = s.shuttle, has = !!sh.hasBall, P = sh.position_m, pos = s.positions;
    const stock = s.ledger?.stock ?? 1;
    const shots = getShots ? getShots() : null;
    let nShot = 0;
    if (shots != null) { if (prevShots != null && shots > prevShots) nShot = shots - prevShots; prevShots = shots; }
    else if (prevHas === true && !has) nShot = 1;
    const wasShown = prevStock == null ? stock > 0 : prevStock > 0;
    // 球が来た（物理で shuttleHas が立った。立った刻みで撃たれた場合も、撃った数で拾う）
    const arrived = prevHas === false && (has || nShot > 0);
    if (arrived) {
      const h0 = wasShown ? H_REST : H_TOP;
      arrive = { t0: now, h0, T: T_ARRIVE * Math.sqrt(h0 / H_REST), ball: 'hold' };
      if (stock > 0) wEnter = { t0: now + W_DELAY + arrive.T * 0.5 };   // 前の球が筒を抜けたあとに、次の球が降りてくる
    } else if (prevStock === 0 && stock > 0) {
      wEnter = { t0: now };   // 予備球が届いた（空だった筒に次の球）
    }
    for (let k = 0; k < nShot; k++) {
      const i = nearestBoard(s, P[0], P[1], P[2]);
      if (i >= 0) {
        const id = s.ids[i];
        if (!rels.some(r => r.id === id)) {
          const holdArr = arrive && arrive.ball === 'hold' ? arrive : null;
          rels.push({ id, y0: P[1], t0: now, arr: holdArr }); if (holdArr) holdArr.ball = 'gone';
        }
      }
      lastRel = now;
    }
    prevHas = has; prevStock = stock;

    // 撃った球の位置：物理の球から、止めた分だけ上へ引き戻して描く
    for (let r = rels.length - 1; r >= 0; r--) {
      const R = rels[r]; let i = -1;
      for (let j = 0; j < s.count; j++) if (s.ids[j] === R.id) { i = j; break; }
      if (i < 0) { rels.splice(r, 1); continue; }
      const d = R.y0 - pos[3 * i + 1];
      if (d >= D1 && now - R.t0 > 0.2) { rels.splice(r, 1); continue; }
      const lag = d > 0 && d < D1 ? d * (1 - sstep((d - D0) / (D1 - D0))) : 0;
      pos[3 * i + 1] += lag + arrOff(R.arr, now);
    }
    // いま装てんされている球（物理の shuttle 球）は、筒の高さぶん上から爪へ落ちてくる
    if (arrive && arrive.ball === 'hold') {
      const off = arrOff(arrive, now);
      if (off > 0) for (let i = 0; i < s.count; i++) if (s.kinds[i] === 4) { pos[3 * i + 1] += off; break; }
    }
    if (arrive && now - arrive.t0 > arrive.T + 0.12) arrive = null;

    // 筒で待っている球（stock が 1 以上の間）
    let n = s.count;
    if (stock > 0 && n < pos.length / 3) {
      let y = H_REST;
      if (wEnter) {
        const u = (now - wEnter.t0) / T_WENTER;
        if (u >= 1) wEnter = null; else y = u < 0 ? H_TOP : H_TOP - (H_TOP - H_REST) * u * u;
      }
      pos[3 * n] = P[0]; pos[3 * n + 1] = P[1] + y; pos[3 * n + 2] = P[2]; s.kinds[n] = 5; s.ids[n] = 'launcher_wait'; n++;
    } else wEnter = null;

    // 爪の絵
    let pose;
    const sinceRel = now - lastRel;
    if (lastRel >= 0 && sinceRel < 0.14) { pose = 'R2'; for (const [t, p] of REL_POSES) if (sinceRel < t) { pose = p; break; } }
    else if (arrive && has) {
      const e = now - arrive.t0 - arrive.T;
      if (e < 0) pose = 'A3'; else { pose = 'A0'; for (const [t, p] of CLOSE_POSES) if (e < t) { pose = p; break; } }
    } else pose = has ? 'A0' : 'A3';
    out.snapshot = n === s.count ? s : { ...s, count: n };
    out.pose = pose;
    return out;
  }
  return { update, get pose() { return out.pose; } };
}
