// R3の物理モデルを正として口・のど・壁を画面へ投影する。旧m3データは変更しない。
import { readFileSync, writeFileSync } from 'node:fs';
import { loadStageTransforms } from '../../physics/stage_transforms.mjs';
import { projectAnalytic, WINDOW } from '../../web/src/window_camera.mjs';
const work = new URL('../../../', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, work), 'utf8'));
const cfg = read('game_tuning/r3/config_r3.json'), stageDir = cfg.stageDir.replace(/^work\//, '');
const layout = read(stageDir + '/layout3.json'), model = read(stageDir + '/model3.json');
const transform = await loadStageTransforms();
const project = (x, y) => projectAnalytic(...transform.point('stage3', [x, y, -0.055])).map(v => +v.toFixed(2));
const scale = WINDOW.W_PX / WINDOW.W_M * WINDOW.EYE[2] / (WINDOW.EYE[2] + .055);
const prism = Object.fromEntries(model.phys.prisms.map(p => [p.id, p]));
const cups = layout.cups.map(c => {
  const id = String(c.n).padStart(2, '0'), l = prism[`COL_CUP_${id}_SIDE_L`], r = prism[`COL_CUP_${id}_SIDE_R`];
  const tl = prism[`COL_CUP_${id}_THROAT_L`], tr = prism[`COL_CUP_${id}_THROAT_R`];
  const yL = Math.max(l.A[1], l.B[1]), yR = Math.max(r.A[1], r.B[1]);
  const sensor = model.phys.sensors.find(s => s.n === c.n);
  return { n: c.n, width_mm: c.mouth_width, narrow: !tl, xc: project(c.xc / 1000, yL)[0],
    mouth: [project(l.A[0] + l.r, yL)[0], project(r.A[0] - r.r, yR)[0]],
    topL: project(l.A[0], yL)[1], topR: project(r.A[0], yR)[1],
    throat: tl ? [project(tl.A[0] + tl.r, -.205)[0], project(tr.A[0] - tr.r, -.205)[0]] : null,
    funnel_bot: tl ? project(l.A[0], -.20502)[1] : null, sensor: project(sensor.x, sensor.y) };
});
const caps = model.phys.prisms.filter(p => /^COL_(CUP|DIV|EDGE_GUIDE|SIDE_RAIL|LIFE|GUARD)/.test(p.id))
  .map(p => ({ id: p.id, A: project(...p.A), B: project(...p.B), r: +(p.r * scale).toFixed(2) }));
writeFileSync(new URL('./data/holes_r3_1026.json', import.meta.url), JSON.stringify({ stageDir, cups, caps }, null, 2));
console.log('R3 mouth projection', cups.map(c => [c.n, c.mouth]));
