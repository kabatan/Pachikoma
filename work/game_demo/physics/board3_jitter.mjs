import { Board3 } from './board3.mjs';

// lab/jitter_board.mjs と同じLCG32。既存物理のrngとは独立させる。
export function lcg(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export function normalizeJitter(jitter = {}) {
  const result = { x_mm: 0, vx_pct: 0, vy_pct: 0, ...jitter };
  for (const key of ['x_mm', 'vx_pct', 'vy_pct']) {
    if (!Number.isFinite(result[key]) || result[key] < 0) throw new Error(`jitter.${key}: 0以上の有限数が必要です`);
  }
  return result;
}

export class JitterBoard extends Board3 {
  constructor(R, world, options) {
    super(R, world, options);
    this.jitter = normalizeJitter(options.jitter);
    this.jitterRng = lcg((options.seed ^ 0xa5a5f00d) >>> 0);
    this.launchDelta = { x: 0, v: 0, y: 0 };
  }
  normal() {
    return Math.sqrt(-2 * Math.log(1 - this.jitterRng())) * Math.cos(2 * Math.PI * this.jitterRng());
  }
  shuttle(aim, dir) {
    const sh = super.shuttle(aim, dir);
    // 画面のシャトル位置には前の球の揺らぎを残さない。
    if (!this.launching) return sh;
    return { x: sh.x + this.launchDelta.x, vx: sh.vx * (1 + this.launchDelta.v) };
  }
  launch(id, aim, dir) {
    const j = this.jitter;
    this.launchDelta = { x: j.x_mm ? this.normal() * j.x_mm / 1000 : 0,
      v: j.vx_pct ? this.normal() * j.vx_pct / 100 : 0,
      y: j.vy_pct ? this.normal() * j.vy_pct / 100 : 0 };
    const speed = this.launcher.speed;
    this.launcher.speed = speed * (1 + this.launchDelta.y);
    this.launching = true;
    try { return super.launch(id, aim, dir); }
    finally { this.launcher.speed = speed; this.launching = false; }
  }
}
