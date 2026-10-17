// デモ/ベンチ共通のダミー場面: 玉の配置、層 manifest、点灯アニメ（LightingFrame）
import { Gen } from './dummy.mjs';

export function makeScene(hr, { balls = 300, layers = 25, seed = 1, envScale = 1 } = {}) {
  const manifest = Gen.makeLayerManifest(layers, { seed });
  hr.setLayers(manifest);
  // 玉: 盤面 (±0.15, ±0.27) に 乱数配置、z=-0.055（球中心 d=55mm）。一部は釘頭の背後に重なる位置へ。
  let s = 12345;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const pos = new Float32Array(balls * 3), vel = new Float32Array(balls * 2);
  for (let i = 0; i < balls; i++) {
    pos[3 * i] = (rnd() - 0.5) * 0.30; pos[3 * i + 1] = (rnd() - 0.5) * 0.54; pos[3 * i + 2] = -0.055 + (rnd() - 0.5) * 0.004;
    vel[2 * i] = (rnd() - 0.5) * 0.02; vel[2 * i + 1] = -0.02 - rnd() * 0.05;
  }
  if (balls > 4) { pos[0] = 0.03; pos[1] = 0.04; pos[3] = 0.0; pos[4] = 0.0; }   // 釘頭(0.03,0.04)の真後ろ・(0,0)の釘の真後ろ
  const ids = manifest.filter(m => m.side === 'back').map(m => m.source_id);
  hr.useDummyProbeBases(ids);
  return {
    manifest, pos,
    update(t) {
      for (let i = 0; i < balls; i++) {   // 落下（ダミー）。釘用の 2 個は固定
        if (balls > 4 && i < 2) continue;
        pos[3 * i + 1] += vel[2 * i + 1] * 1 / 60; pos[3 * i] += vel[2 * i] * 1 / 60;
        if (pos[3 * i + 1] < -0.28) pos[3 * i + 1] = 0.28;
        if (Math.abs(pos[3 * i]) > 0.16) vel[2 * i] *= -1;
      }
      hr.setBalls({ count: balls, positions: pos });
      const ea = [], eb = [];
      for (let r = 0; r < 8; r++) { ea.push(envScale * (0.5 + 0.5 * Math.sin(t * 1.3 + r))); eb.push(envScale * (0.5 + 0.5 * Math.cos(t * 0.9 + r * 0.7))); }
      const q = {};
      ids.forEach((id, i) => {                                   // 虹の流れ + 呼吸（全層が毎フレーム変化する最悪ケース）
        const ph = t * 2.0 + i * 0.37, br = 0.35 + 0.35 * Math.sin(t * 3 + i * 0.1);
        q[id] = { rgb: [br * (0.5 + 0.5 * Math.sin(ph)), br * (0.5 + 0.5 * Math.sin(ph + 2.094)), br * (0.5 + 0.5 * Math.sin(ph + 4.188))] };
      });
      hr.setLightingFrame({ tick: Math.round(t * 480), time: t, ea, eb, q });
    },
  };
}
