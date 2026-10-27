// R3-G: ゲームの釘（config の stageDir の layout3）を画面 px へ射影して data/pins_px.json へ。読むだけ。
// node work/game_demo/play/m3/proj_pins.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const WORK = decodeURIComponent(new URL('../../../', import.meta.url).pathname);
const { loadStageTransforms } = await import(WORK + 'game_demo/physics/stage_transforms.mjs');
const { projectAnalytic } = await import(WORK + 'game_demo/web/src/window_camera.mjs');
const J = (p) => JSON.parse(readFileSync(WORK + p, 'utf8'));
const config = J('game_tuning/r3/config_r3.json');
const stageDir = config.stageDir.startsWith('work/') ? config.stageDir.slice(5) : 'cabinet/' + config.stageDir;
const layout = J(stageDir + '/layout3.json');
const T = await loadStageTransforms();
const out = {};
const model = J(stageDir + '/model3.json');
// 命釘（LIFE_*）は layout に x が無いので、model3 の衝突の柱（COL_LIFE_*）の位置から（10/21 夜 追加）
const xy = (p) => { if (Number.isFinite(p.x)) return [p.x / 1000, p.y / 1000]; const c = model.phys.prisms.find(q => q.id === 'COL_' + p.id); return c ? c.A : null; };
for (const Z of [-0.055, -0.049, -0.06]) out[Z] = layout.pins.map(p => { const q = xy(p); return q ? projectAnalytic(...T.point('stage3', [q[0], q[1], Z])).map(v => +v.toFixed(2)) : [null, null]; });
writeFileSync(new URL('./data/pins_px.json', import.meta.url), JSON.stringify({ stageDir, n: layout.pins.length, ids: layout.pins.map(p => p.id), px: out }));
console.log('pins', layout.pins.length, out[-0.055].slice(0, 3));
