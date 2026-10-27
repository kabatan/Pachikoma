// linear Rec.709。係数はこの1個のLightingFrameから背景・プローブへ渡す。
export const RECEIVERS = ['p1', 'p2', 'p4', 'l1', 'r1', 'l2', 'r2', 'ext'];
const OFF = [1, 0.67, 0.45, 0.30];
// 演出の利得。個別LEDの重み/色はmanifest側（実基底の係数表は納品待ち）。
const MODE_GAIN = { base:1, reach:1.1, challenge:1.2, final:1.3 };
const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const mixLog = (a, b, u) => Math.exp(Math.log(Math.max(a, 1e-5)) * (1 - u) + Math.log(Math.max(b, 1e-5)) * u);
const transitionValue = (s, time, log) => { const u = Math.min(1, Math.max(0, (time - s.at - s.delay) / .5)); return log ? mixLog(s.from, s.target, u) : s.from + (s.target - s.from) * u * u; };
const RAINBOW = [[1, .04, .01], [1, .35, .01], [1, 1, .03], [.02, 1, .15], [.02, .3, 1], [.4, .02, 1], [1, .02, .4]];

export class LightingDriver {
  constructor(entries, { sources = {}, dummy = false } = {}) {
    const unique = [...new Set(entries.map((e) => e.source_id))];
    this.sources = unique.map((id, i) => {
      const row = entries.find((e) => e.source_id === id), spec = sources[id];
      // 本番の灯番号・色・重みはmanifest.lighting.sourcesに明記する。
      // receiverやIDの綴りから本番の点灯番号を推測しない。
      return { id, ...(spec ?? (dummy ? { lamp: i % 7 + 1, receiver: row.receiver_id ?? RECEIVERS[i % 7] } : {})), weight: spec?.weight ?? 1, rgb: spec?.rgb ?? [1, .8, .5] };
    });
    this.unmapped = this.sources.filter((s) => !Number.isInteger(s.lamp)).map((s) => s.id);
    this.state = new Map();
  }
  transition(key, target, time, delay = 0, log = false) {
    let s = this.state.get(key);
    if (!s) { s = { from: target, target, at: time, delay: 0 }; this.state.set(key, s); }
    if (s.target !== target) { const from = transitionValue(s, time, log); s = { from, target, at: time, delay }; this.state.set(key, s); }
    return transitionValue(s, time, log);
  }
  frame(li, tick) {
    const time = li.clock, n = li.lamps.length, lit = new Set(li.lamps);
    const ea = RECEIVERS.map((r, i) => this.transition('env:' + r, i === 7 ? (n >= 4 ? 1 : OFF[n]) : lit.has(i + 1) ? .08 : OFF[Math.min(n, 3)], time, 0, true));
    const eb = [...ea], q = {};
    for (const s of this.sources) {
      let g = this.transition('led:' + s.id, lit.has(s.lamp) ? 1 : 0, time, .15);
      let rgb = s.rgb;
      if (li.jackpot) {
        // JPも一つの係数を背景と反射で共有。quietは呼出し側で指定する。
        const phase = (li.jackpot.t * 7 + (s.phase ?? 0)) % 7;
        const a = RAINBOW[Math.floor(phase)], b = RAINBOW[(Math.floor(phase) + 1) % 7], u = smooth(phase % 1);
        rgb = a.map((v, c) => v * (1 - u) + b[c] * u);
        g = li.jackpot.settled ? 1.5 : .8 + .2 * Math.sin(2 * Math.PI * li.jackpot.t * 4);
      } else if (li.armed && g > 0) g *= .85 + .15 * Math.sin(time * 2 * Math.PI);
      if (!li.jackpot) { g *= MODE_GAIN[li.mode] ?? 1; if (li.reveal) g *= .9; }
      if (li.roulette && !lit.has(s.lamp)) g *= .5;
      if (s.gate_at4 != null && n === 4) g *= s.gate_at4;
      q[s.id] = { rgb: rgb.map((v) => Math.max(0, v * g * s.weight)) };
    }
    return { tick, time, ea, eb, q };
  }
}
