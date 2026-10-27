// R3-G：遊技に近い撃ち方で、穴の中の詰まりがどれくらい起きるか。node jam2/jam_play.mjs <variant> [球数=3000] [間隔秒=0.2]
// variant: cur（今の形）/ straight（28mm の口のまま、漏斗と喉を外して真っすぐ下まで）/ kick（今の形＋詰まりの検出と揺らし）
// 物理のファイルは変えない（読み込んだ model をこの試しの中だけで書き換える）。
import { readFileSync, writeFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { Board3, S } from '../board3.mjs';
const [variant = 'cur', NB = '3000', GAP = '0.2'] = process.argv.slice(2);
const stage = process.env.STAGE ?? '../../game_tuning/proto/stage_variants/n81_gate/';
const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const model = read('../' + stage + 'model3.json'), layout = read('../' + stage + 'layout3.json'), dims = read('../../../cabinet/dims/dims.json');
export function straighten(model) {   // 口の幅のまま、側の壁を喉の下端まで伸ばし、漏斗と喉を外す
  const P = model.phys.prisms, out = [];
  for (const p of P) {
    const m = p.id.match(/^COL_CUP_(\d\d)_(SIDE|FUNNEL|THROAT)_([LR])$/);
    if (!m) { out.push(p); continue; }
    const fun = P.find(q => q.id === `COL_CUP_${m[1]}_FUNNEL_${m[3]}`); if (!fun) { out.push(p); continue; }   // 漏斗の無い穴（細い口）はそのまま
    if (m[2] !== 'SIDE') continue;
    const thr = P.find(q => q.id === `COL_CUP_${m[1]}_THROAT_${m[3]}`);
    out.push({ ...p, B: [p.B[0], thr.B[1]] });
  }
  model.phys.prisms = out; return model;
}
if (variant === 'straight') straighten(model);
await RAPIER.init();
const world = Board3.makeWorld(RAPIER);
let seed = +(process.env.SEED ?? 11); const rng = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
const board = new Board3(RAPIER, world, { model, layout, dims, rng });
const mouthY = board.mouthY, hz = board.hz;
// 詰まりの検出と揺らし（kick）：口の線より下で 0.3 秒ほぼ止まっている球が同じ穴に 2 つ → 片方を上へ小さく突く（穴の部品の小さなソレノイド）
const KICK = variant === 'kick';
let t = 0, next = 0, launched = 0, kicks = 0; const res = { cup: 0, lost: 0, stuckEvents: 0, inCupStill: new Map(), maxStill: 0, cups: Array(8).fill(0), stuckList: [] };
const below = new Map();
while (launched < +NB || board.balls.size) {
  if (launched < +NB && t >= next) { const aim = rng() * 2 - 1, dir = rng() < .5 ? 1 : -1; board.launch(++launched, aim, dir); next = t + (+GAP) * (0.6 + 0.8 * rng()); }
  board.step(); t += 1 / hz;
  for (const e of board.drain()) { if (e.type === 'cup') { res.cup++; res.cups[e.cup]++; below.delete(e.shotId); } else if (e.type === 'lost') { res.lost++; res.stuckList.push({ id: e.shotId, at: e.at.map(v => +(v * 1000).toFixed(1)) }); below.delete(e.shotId); } }
  if (board.tick % 8 === 0) {
    const still = [];
    for (const [id, b] of board.balls) {
      const p = board.pos(b.body), v = b.body.linvel();
      if (p.y < mouthY - 0.001) { const s = Math.hypot(v.x, v.y, v.z) / S; const r = below.get(id) ?? 0; const nr = s < 0.02 ? r + 8 / hz : 0; below.set(id, nr); res.maxStill = Math.max(res.maxStill, nr); if (nr > 0.3) still.push({ id, b, p, cup: board._cupOf(p.x) }); if (nr > 1.0 && !b._counted) { b._counted = true; res.stuckEvents++; } }
    }
    if (KICK) for (const s of still) {
      const pair = still.find(o => o !== s && o.cup === s.cup);
      if (pair && s.p.y >= pair.p.y && !s.b._kickAt || (pair && s.p.y >= pair.p.y && t - s.b._kickAt > 0.3)) { s.b._kickAt = t; kicks++; const m = 0.007057; s.b.body.applyImpulse({ x: m * 0.08 * (rng() < .5 ? -1 : 1) * S, y: m * 0.15 * S, z: 0 }, true); below.set(s.id, 0); }
    }
  }
  if (t > 3600) break;
}
const out = { variant, balls: +NB, gap: +GAP, t: +t.toFixed(1), ...res, inCupStill: undefined, kicks, stuckPer1000: +(res.stuckEvents / +NB * 1000).toFixed(2) };
console.log(JSON.stringify(out));
writeFileSync(new URL(`./jam_play_${variant}_${GAP}.json`, import.meta.url), JSON.stringify(out, null, 1));
