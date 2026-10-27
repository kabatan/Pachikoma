// R3-G：2 球が同じ穴へほぼ同時に入ると詰まるか。node jam2/jam_probe.mjs [stageDir] [nudge=1]
// 口の上 (ym + h) から 2 球を、x の間隔 dx・時間差 dt・速さ v で落とし、3 秒で両方がセンサーを通るかを見る。
import { readFileSync, writeFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { Board3, S } from '../board3.mjs';
const stage = process.argv[2] ?? '../../game_tuning/proto/stage_variants/n81_gate/';
const nudge = (process.argv[3] ?? '1') === '1';
const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const model = read('../' + stage + 'model3.json'), layout = read('../' + stage + 'layout3.json'), dims = read('../../../cabinet/dims/dims.json');
if (process.env.VARIANT === 'straight') {   // jam_play.mjs と同じ：口の幅のまま、漏斗と喉を外して真っすぐ
  const P = model.phys.prisms, out = [];
  for (const p of P) { const m = p.id.match(/^COL_CUP_(\d\d)_(SIDE|FUNNEL|THROAT)_([LR])$/); if (!m) { out.push(p); continue; }
    if (!P.find(q => q.id === `COL_CUP_${m[1]}_FUNNEL_${m[3]}`)) { out.push(p); continue; }
    if (m[2] === 'SIDE') out.push({ ...p, B: [p.B[0], P.find(q => q.id === `COL_CUP_${m[1]}_THROAT_${m[3]}`).B[1]] }); }
  model.phys.prisms = out;
}
await RAPIER.init();
const world = Board3.makeWorld(RAPIER);
let seed = 7; const rng = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
const board = new Board3(RAPIER, world, { model, layout, dims, rng });
board.allowStuckNudge = nudge; if (process.env.KUP) board.jamKickUp = +process.env.KUP; if (process.env.KIN) board.jamKickIn = +process.env.KIN; if (process.env.KST) board.jamStill = +process.env.KST;
const WIDE = !!process.env.WIDE;
const Z = -(dims.launcher.muzzle_depth_m);
function drop(id, x, y, vx, vy) {
  const R = RAPIER;
  const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x * S, y * S, Z * S).setLinvel(vx * S, vy * S, 0).setCcdEnabled(true).setCanSleep(true));
  const col = world.createCollider(R.ColliderDesc.ball(0.006 * S).setDensity(7800 / S ** 3).setFriction(0.12).setRestitution(0.45).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS), body);
  board.balls.set(id, { id, body, col, born: board.tick, still: 0, _p: { x: 0, y: 0, z: 0 }, _v: { x: 0, y: 0, z: 0 } }); board.ballOf ??= new Map(); board.ballOf.set(col.handle, id);
}
const rows = [];
let sid = 0;
for (const cup of layout.cups) {
  if (WIDE && cup.mouth_width < 20) continue;
  const xc = cup.xc / 1000, ym = cup.ym / 1000;
  for (const dx of [0, 0.004, 0.008, 0.012, 0.016, 0.020]) for (const dt of [0, 0.02, 0.05, 0.1]) for (const v of [0.3, 0.8, 1.4]) for (const h of [0.004, 0.012]) for (const vxs of [0, 0.15]) {
    board.clear(); board.drain();
    const a = ++sid, b = ++sid; const jx = (rng() - .5) * 0.001;
    drop(a, xc - dx / 2 + jx, ym + h + 0.006, vxs, -v);
    let t = 0, got = new Map(), nudges0 = board.nudges, dropped = false;
    const hz = board.hz;
    while (t < 4) {
      if (!dropped && t >= dt) { drop(b, xc + dx / 2 + jx, ym + h + 0.006 + 0.0125 * (dx < 0.012 ? 1 : 0), -vxs, -v); dropped = true; }
      board.step(); t += 1 / hz;
      for (const e of board.drain()) if (e.type === 'cup') got.set(e.shotId, { t: +t.toFixed(3), cup: e.cup });
      if (got.size === 2) break;
    }
    const stuck = [a, b].filter(i => !got.has(i));
    const pos = stuck.map(i => { const bb = board.balls.get(i); if (!bb) return null; const p = board.pos(bb.body); return [+(p.x * 1000 - cup.xc).toFixed(1), +(p.y * 1000 - cup.ym).toFixed(1)]; });
    rows.push({ cup: cup.n, w: cup.mouth_width, dx, dt, v, h, vxs, both: got.size === 2, tmax: Math.max(0, ...[...got.values()].map(g => g.t)), cups: [...got.values()].map(g => g.cup), stuck: stuck.length, pos, nudges: board.nudges - nudges0 });
  }
}
const sum = {};
for (const r of rows) { const k = `cup${r.cup}(${r.w}mm)`; sum[k] ??= { n: 0, stuck: 0, slow: 0 }; sum[k].n++; if (!r.both) sum[k].stuck++; else if (r.tmax > 1.0) sum[k].slow++; }
const wide = rows.filter(r => r.w >= 20 && r.both).map(r => r.tmax).sort((a, b) => a - b); console.log('nudge', nudge, process.env.TAG, JSON.stringify(sum), 'p95', wide[Math.floor(wide.length * .95)], 'max', wide.at(-1));
for (const r of rows.filter(r => !r.both).slice(0, 12)) console.log(JSON.stringify(r));
writeFileSync(new URL(`./jam_rows_${process.env.VARIANT ?? 'cur'}_${process.env.TAG ?? ''}_${nudge ? 'nudge' : 'nonudge'}.json`, import.meta.url), JSON.stringify(rows));
