import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadPlayConfig } from '../play/config.mjs';
import { PhysicsAdapter } from './adapter.mjs';
await RAPIER.init();
const CAB = new URL('../../cabinet/', import.meta.url);
const config = await loadPlayConfig(new URL('../../game_tuning/proto/config.json', import.meta.url).href, async p => readFileSync(new URL(p), 'utf8'));
const shots = [[-0.55, 1], [0.1, -1], [0.7, 1]]; const out = {};
for (const scale of [1, 0.35]) {
  out[scale] = [];
  for (const [aim, dir] of shots) {
    const pa = await PhysicsAdapter.create(RAPIER, { readText: async (p) => readFileSync(new URL(p, CAB), 'utf8'), importModule: (p) => import(new URL(p, CAB).href), seed: 11, stageDir: config.stageDir, jitter: { x_mm: 0, vx_pct: 0, vy_pct: 0 }, boardTimeScale: scale });
    pa.beginGame(15); pa.setAim(aim, dir); pa.shuttleHas = true; pa.launch(1);
    const pts = []; let cup = null, tEnd = null;
    for (let step = 0; step < 480 * 8; step++) {
      pa.step();
      if (step % 8 === 0) { const b = pa.board.balls.get(1); if (b) { const p = pa.board.pos(b.body); pts.push([+(step / 480).toFixed(3), +(p.x * 1000).toFixed(1), +(p.y * 1000).toFixed(1)]); } }
      for (const e of pa.drainEvents()) if (e.type === 'cup' && cup === null) { cup = e.cup; tEnd = step / 480; }
      if (cup !== null && step / 480 > tEnd + 0.3) break;
    }
    out[scale].push({ aim, dir, cup, tEnd, pts });
  }
}
const L = JSON.parse(readFileSync(new URL('../../game_tuning/proto/stage_variants/n81_gate/layout3.json', import.meta.url)));
out.layout = { pins: L.pins.map(p => [p.x, p.y]), cups: L.cups.map(c => [c.n, c.xc, c.ym, c.mouth_width]) };
writeFileSync(process.argv[2], JSON.stringify(out));
console.log(out[1].map(s => [s.cup, s.tEnd]), out[0.35].map(s => [s.cup, s.tEnd]), out[1][0].pts[0], out[1][0].pts.at(-1));
