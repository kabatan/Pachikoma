// #2 ゲート試験: Rapier 3D(WASM) が 12mm球 / 約2mm釘 / 100球 / 480Hz を扱えるか。
// node physics/gate.mjs [perf|tunnel|board|all]   入力は work/cabinet/stage3 の model3.json / dims.json を読むだけ（書き換えない）。
// 単位 m・kg・s。ボード座標は X右 Y上 Z手前、球中心 z=-d (d=0.054..0.056)。
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const CAB = new URL('../../cabinet/', import.meta.url);
const model = JSON.parse(readFileSync(new URL('stage3/model3.json', CAB)));
const dims = JSON.parse(readFileSync(new URL('dims/dims.json', CAB)));
const layout = JSON.parse(readFileSync(new URL('stage3/layout3.json', CAB)));
await RAPIER.init();
const R = 0.006, RHO = 7800, G = 9.81;
// 物理空間の倍率。Rapier 0.21 の凸包×玉の接触は mm 級の形を m 単位で作ると壊れる(素通り・横滑り)ため 10倍で扱う(S=1 は壊れる確認用)
const S = +(process.env.S ?? 10);
const P = (b) => { const t = b.translation(); return { x: t.x / S, y: t.y / S, z: t.z / S }; };

function makeWorld({ hz = 480, lengthUnit = 1, solver = 4 } = {}) {
  const w = new RAPIER.World({ x: 0, y: -G * S, z: 0 });
  w.timestep = 1 / hz; w.lengthUnit = lengthUnit * S; w.numSolverIterations = solver;
  return w;
}
function addBall(w, p, v, { ccd = true, w0 = [0, 0, 0], lockZ = false } = {}) {
  const b = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().enabledTranslations(true, true, !lockZ).setTranslation(p[0] * S, p[1] * S, p[2] * S).setLinvel(v[0] * S, v[1] * S, v[2] * S).setAngvel({ x: w0[0], y: w0[1], z: w0[2] }).setCcdEnabled(ccd).setCanSleep(true));
  w.createCollider(RAPIER.ColliderDesc.ball(R * S).setDensity(RHO / S ** 3).setFriction(0.12).setRestitution(0.45), b);
  return b;
}
/** 丸端カプセル角柱(A→B, 半径r, dはd0..d1) = 凸包。 */
function addPrism(w, A, B, r, d0, d1, { friction = 0.12, rest = 0.45, seg = 20 } = {}) {
  const pts = [];
  for (const [c, a0] of [[A, Math.atan2(B[1] - A[1], B[0] - A[0]) + Math.PI / 2], [B, Math.atan2(B[1] - A[1], B[0] - A[0]) - Math.PI / 2]]) {
    for (let k = 0; k <= seg / 2; k++) { const a = a0 + (Math.PI * k) / (seg / 2); for (const z of [-d0, -d1]) pts.push(c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), z); }
  }
  const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(pts.map((v) => v * S)));
  if (!desc) throw new Error('hull failed');
  w.createCollider(desc.setFriction(friction).setRestitution(rest));
}
function addPlate(w, bbox, faceZ, side, thick = 0.02, { friction = 0.12, rest = 0.30 } = {}) {
  const [x0, y0, x1, y1] = bbox; const cz = faceZ + side * -1 * 0; // face_z は球側の面。板は球と反対側へ厚み
  const half = thick / 2; const zc = faceZ - (side === -1 ? -half : half) * -1; // side=-1: 板は z>faceZ(手前)側 / side=+1: z<faceZ(奥)側
  const z = side === -1 ? faceZ + half : faceZ - half;
  w.createCollider(RAPIER.ColliderDesc.cuboid((x1 - x0) / 2 * S, (y1 - y0) / 2 * S, half * S).setTranslation((x0 + x1) / 2 * S, (y0 + y1) / 2 * S, z * S).setFriction(friction).setRestitution(rest));
}
function buildBoard(w, opt = {}) {
  let n = 0;
  for (const p of model.phys.prisms) { addPrism(w, p.A, p.B, p.r, p.d0, p.d1, opt); n++; }
  const bb = (poly) => { const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
  for (const pl of model.phys.plates) addPlate(w, bb(pl.poly), pl.face_d * -1e-3 * (Math.abs(pl.face_d) > 1 ? 1 : 1000), pl.side);
  return n;
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

// ---- perf: 100球 × 480Hz 盤全体(釘61・口壁) ---------------------------------
async function perf({ N = 100, hz = 480, lengthUnit = 1 } = {}) {
  const w = makeWorld({ hz, lengthUnit }); const np = buildBoard(w);
  const L = dims.launcher; const xr = L.x_range_m; const bodies = [];
  const stepMs = [];
  let t = 0; const total = Math.round(8 * hz);
  for (let i = 0; i < total; i++) {
    if (bodies.length < N && i % Math.round(hz * 0.04) === 0) { // 25球/s で投入 (玉同士の接触も測る)
      const x = xr[0] + (xr[1] - xr[0]) * Math.random();
      bodies.push(addBall(w, [x, L.muzzle_y_m, -(0.054 + 0.002 * Math.random())], [(Math.random() - .5) * 0.6, -0.3, 0]));
    }
    const t0 = performance.now(); w.step(); stepMs.push(performance.now() - t0);
  }
  const alive = bodies.filter((b) => P(b).y > -0.25).length;
  const frame = []; for (let i = 0; i + 8 <= stepMs.length; i += 8) frame.push(stepMs.slice(i, i + 8).reduce((a, b) => a + b, 0));
  return { S, hz, lengthUnit, balls: bodies.length, prisms: np, ballsOnBoard: alive, ms_per_step_mean: +(stepMs.reduce((a, b) => a + b, 0) / stepMs.length).toFixed(4), ms_per_60Hz_frame_mean: +(frame.reduce((a, b) => a + b, 0) / frame.length).toFixed(3), ms_per_frame_p99: +q(frame, 0.99).toFixed(3), ms_per_frame_max: +Math.max(...frame).toFixed(3) };
}

// ---- tunnel: 細釘(r=1.01mm)への高速衝突で貫通しないか ---------------------------
function tunnel({ hz, ccd, v, trials = 400, lengthUnit = 1 }) {
  let tunnelled = 0;
  for (let k = 0; k < trials; k++) {
    const w = makeWorld({ hz, lengthUnit }); w.gravity = { x: 0, y: 0, z: 0 };
    addPrism(w, [0, 0], [0, 0], 0.00101, 0.0455, 0.062);
    const off = (Math.random() * 2 - 1) * 0.0069; // 球中心と釘軸のずれ(接触する範囲)
    const b = addBall(w, [-0.03, off, -0.055], [v, 0, 0], { ccd });
    let crossed = false;
    for (let i = 0; i < Math.ceil(0.05 * hz) + 2 * hz * 0 ; i++) { w.step(); if (P(b).x > 0.0005 && Math.abs(P(b).y - 0) < 0.0069 - 1e-4) { crossed = true; break; } }
    if (crossed) tunnelled++;
  }
  return { hz, ccd, v, lengthUnit, trials, tunnelled };
}

// ---- board: 射出→7口 の落下・決定論 --------------------------------------------
function cupOf(xmm) { // 口(layout3: xc, mouth_width)の中なら口番号、それ以外(仕切り上)は 0
  const i = layout.cups.findIndex((c) => Math.abs(xmm - c.xc) <= c.mouth_width / 2); return i + 1;
}
function board({ n = +(process.env.N ?? 300), hz = 480, seed = 1, lengthUnit = 0.01, aimed = null, lockZ = false, limitS = 120 } = {}) {
  let s = seed >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const w = makeWorld({ hz, lengthUnit }); buildBoard(w);
  const L = dims.launcher; const xr = L.x_range_m; const res = new Array(n).fill(null); const bodies = [];
  const sweepV = (2 * (xr[1] - xr[0])) / L.sweep_period_s;
  const xs = []; const removeDone = true; let launched = 0; const t0 = performance.now(); let steps = 0; let stuck = 0;
  const sensorY = -0.2100;
  while ((launched < n || bodies.some((b, i) => res[i] == null)) && steps < hz * limitS) {
    if (launched < n && steps % Math.round(hz * 0.5) === 0) { // 0.5秒ごとに1球(同時に十数球いる)
      const x = aimed ?? (xr[0] + (xr[1] - xr[0]) * rnd());
      const ang = (rnd() * 2 - 1) * 90 * Math.PI / 180, sp = 0.35 * (0.98 + 0.04 * rnd()), dir = rnd() < 0.5 ? -1 : 1;
      bodies.push(addBall(w, [x, L.muzzle_y_m, -(lockZ ? 0.055 : 0.054 + 0.002 * rnd())], [Math.sin(ang) * sp + dir * sweepV, -Math.cos(ang) * sp, 0], { lockZ, w0: [(rnd() - .5) * 4, (rnd() - .5) * 4, (rnd() - .5) * 4] }));
      launched++;
    }
    w.step(); steps++;
    bodies.forEach((b, i) => { if (res[i] != null) return; const p = P(b); if (p.y < sensorY) { res[i] = cupOf(p.x * 1000); xs.push(+(p.x * 1000).toFixed(0)); if (removeDone) w.removeRigidBody(b); } else if (p.y < -0.3) res[i] = -1; });
  }
  bodies.forEach((b, i) => { if (res[i] == null) { res[i] = -2; stuck++; } });
  const counts = {}; res.forEach((r) => (counts[r] = (counts[r] ?? 0) + 1));
  const hash = createHash('sha256').update(res.join(',') + xs.join(',')).digest('hex').slice(0, 16);
  return { S, n, hz, lengthUnit, counts, stuck_or_unresolved: stuck, simulated_s: +(steps / hz).toFixed(1), wall_s: +((performance.now() - t0) / 1000).toFixed(1), hash };
}

// ---- apex: 仕切りの山形の頂点に静止した玉を置く（頂点ちょうど・±0.05..0.5mm）→ どの口に入るか・どれだけで落ちるか ----
function apex() {
  const tops = model.phys.prisms.filter((p) => p.id.startsWith('COL_DIV')); const pts = new Map();
  for (const p of tops) for (const q of [p.A, p.B]) { const k = q.map((v) => v.toFixed(5)).join(','); pts.set(k, q); }
  const hi = Math.max(...[...pts.values()].map((q) => q[1])); // 山形は頂点が頂上、単斜の仕切りは高い端が頂点
  const res = [];
  const cands = [...pts.values()].filter((q) => q[1] > -0.1855);   // 頂点（谷の端 y=-0.19002 を除く）
  for (const q of cands) for (const off of [0, 0.00005, -0.00005, 0.0002, -0.0002, 0.0005, -0.0005]) {
    const w = makeWorld({ hz: 480, lengthUnit: 0.01 }); buildBoard(w);
    const b = addBall(w, [q[0] + off, q[1] + 0.00101 + 0.006 + 0.0003, -0.055], [0, 0, 0], { lockZ: true });
    let cup = null, t = 0;
    for (let i = 0; i < 480 * 10; i++) { w.step(); const p = P(b); if (p.y < -0.2100) { cup = cupOf(p.x * 1000); t = i / 480; break; } }
    res.push({ x_mm: +(q[0] * 1000).toFixed(2), off_mm: off * 1000, cup, fell_after_s: cup == null ? null : +t.toFixed(2), asleep: cup == null ? b.isSleeping() : null });
  }
  return res;
}
export { board, buildBoard, makeWorld, addBall };
// ---- pile: 皿に100球を落として山にする（球同士の接触）。箱 251(x)×80(z)mm、壁高60mm ----------------
function pile({ N = 100, hz = 480, lengthUnit = 0.01, hx = 0.14, hz2 = 0.05 } = {}) {
  const w = makeWorld({ hz, lengthUnit }); const box = (x, y, z, hx, hy, hz2) => w.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz2).setTranslation(x, y, z).setFriction(0.25).setRestitution(0.35));
  box(0, -0.005, 0, hx, 0.005, hz2); box(-hx - 0.005, 0.1, 0, 0.005, 0.1, hz2); box(hx + 0.005, 0.1, 0, 0.005, 0.1, hz2); box(0, 0.1, -hz2 - 0.005, hx, 0.1, 0.005); box(0, 0.1, hz2 + 0.005, hx, 0.1, 0.005);
  const bodies = []; const ms = []; let rs = 12345; const rnd = () => (rs = (rs * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < Math.round(hz * 8); i++) {
    if (bodies.length < N && i % Math.round(hz * 0.03) === 0) { const b = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation((rnd() - .5) * hx, 0.08 + 0.02 * rnd(), (rnd() - .5) * hz2).setCcdEnabled(true)); w.createCollider(RAPIER.ColliderDesc.ball(R).setDensity(RHO).setFriction(0.25).setRestitution(0.35), b); bodies.push(b); }
    const t0 = performance.now(); w.step(); ms.push(performance.now() - t0);
  }
  const inside = bodies.filter((b) => { const p = b.translation(); return Math.abs(p.x) < hx && p.y > -0.001 && p.y < 0.2 && Math.abs(p.z) < hz2; }).length;
  const asleep = bodies.filter((b) => b.isSleeping()).length; const maxH = Math.max(...bodies.map((b) => b.translation().y));
  const frames = (a) => { const f = []; for (let i = 0; i + 8 <= a.length; i += 8) f.push(a.slice(i, i + 8).reduce((x, y) => x + y, 0)); return f; };
  const fall = frames(ms.slice(0, Math.round(hz * 3.5))), rest = frames(ms.slice(Math.round(hz * 6)));
  return { N, hz, lengthUnit, inside_box: inside, asleep_after_8s: asleep, pile_top_mm: +(maxH * 1000).toFixed(1), ms_per_frame_while_pouring_mean: +(fall.reduce((a, b) => a + b, 0) / fall.length).toFixed(3), ms_per_frame_while_pouring_p99: +q(fall, 0.99).toFixed(3), ms_per_frame_settled_mean: +(rest.reduce((a, b) => a + b, 0) / rest.length).toFixed(3) };
}

const isMain = process.argv[1] && new URL(process.argv[1], 'file://').href === import.meta.url;
const mode = isMain ? (process.argv[2] ?? 'all') : 'none'; const out = {};
if (mode === 'perf' || mode === 'all') { out.perf = []; for (const lu of [1, 0.01]) out.perf.push(await perf({ lengthUnit: lu })); out.perf.push(await perf({ hz: 120 })); }
if (mode === 'tunnel' || mode === 'all') { out.tunnel = []; for (const [hz, ccd] of [[480, true], [480, false], [120, true], [120, false]]) for (const v of [3, 5, 8]) out.tunnel.push(tunnel({ hz, ccd, v })); for (const v of [5, 8]) out.tunnel.push(tunnel({ hz: 480, ccd: true, v, lengthUnit: 0.01 })); }
if (mode === 'pile' || mode === 'all') { out.pile = [pile({ hx: 0.04, hz2: 0.02 }), pile({ N: 50, hx: 0.04, hz2: 0.02 }), pile({ hx: 0.04, hz2: 0.02, lengthUnit: 1 })]; }
if (mode === 'board' || mode === 'all') { const a = board({ lockZ: true, limitS: +(process.env.LIM ?? 200) }), b = board({ lockZ: true, limitS: +(process.env.LIM ?? 200) }); out.board = { z_locked_run1: a, z_locked_run2_same_seed: b, deterministic: a.hash === b.hash, free_z: board({ limitS: +(process.env.LIM ?? 200) }) }; out.board.python_reference_fractions = { out_or_gutter: 0.296, cup1: 0.074, cup2: 0.102, cup3: 0.108, cup4: 0.022, cup5: 0.079, cup6: 0.092, cup7: 0.227 }; }
if (mode === 'apex') out.apex = apex();
if (isMain) console.log(JSON.stringify(out, null, 1));
