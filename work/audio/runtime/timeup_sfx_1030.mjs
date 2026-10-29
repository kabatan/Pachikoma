// 時間切れまわりの小さな効果音(2026-10-30 パートD)。?timeupsfx=0 で無効。
//  time_call : 0秒の瞬間の「時間です！」の一撃(低い衝撃＋明るい鐘の和音。追加画面の timeup の音の前に鳴る)
//  offer_tick: 追加受付の残り10秒から1秒ごとの刻み(残り3秒は2連打で強め)
// effects_bus の timeup_call / offer_tick を購読し、engine._play(group 'ui')で鳴らす。既存のキュー・カタログには触らない。
const TAU = Math.PI * 2;
const mk = (ctx, sec, fn) => { const n = Math.round(sec * ctx.sampleRate), b = ctx.createBuffer(2, n, ctx.sampleRate), d = [b.getChannelData(0), b.getChannelData(1)]; fn(d, ctx.sampleRate, n); return b; };
const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) - .5; };
function timeCall(ctx) {
  return mk(ctx, 1.3, (d, sr, n) => {
    for (let i = 0; i < n; i++) {
      const t = i / sr, f0 = 52 + 70 * Math.exp(-t * 14);
      let v = .62 * Math.sin(TAU * f0 * t) * Math.exp(-t * 6.5);                       // 低い衝撃
      v += .42 * hash(i) * Math.exp(-t * 55);                                           // 頭のノイズ
      for (const [fr, g] of [[784, .22], [988, .2], [1175, .2], [1568, .14]]) {          // 鐘の和音(G B D G)
        const tt = Math.max(0, t - .05); v += g * Math.sin(TAU * fr * tt + 2.1 * Math.sin(TAU * fr * 2 * tt) * Math.exp(-tt * 9)) * Math.exp(-tt * 3.2) * (t > .05 ? 1 : 0);
      }
      const e = Math.min(1, t / .002) * Math.min(1, (n - i) / (sr * .08));
      d[0][i] = d[1][i] = Math.tanh(v * 1.1) * e * .8;
    }
  });
}
function tick(ctx, strong) {
  return mk(ctx, strong ? .34 : .14, (d, sr, n) => {
    const hits = strong ? [0, .15] : [0];
    for (let i = 0; i < n; i++) {
      const t = i / sr; let v = 0;
      hits.forEach((h, k) => { const u = t - h; if (u < 0) return; const f = strong ? (k ? 2100 : 1500) : 1700; v += (strong ? .8 : .5) * (Math.sin(TAU * f * u) * Math.exp(-u * 38) + .35 * Math.sin(TAU * f * 2.76 * u) * Math.exp(-u * 70)) + .18 * hash(i) * Math.exp(-u * 160); });
      d[0][i] = d[1][i] = v * Math.min(1, (n - i) / (sr * .02));
    }
  });
}
export function installTimeupSfx1030(engine, bus) {
  const ctx = engine.ctx, B = { call: timeCall(ctx), tick: tick(ctx, false), tick3: tick(ctx, true) }, log = [];
  const play = (name, spec, gain) => { const ok = engine._play(B[name], spec, { gain }); log.push([+ctx.currentTime.toFixed(3), name, ok]); if (log.length > 100) log.shift(); return ok; };
  const off = [
    bus.on('timeup_call', () => play('call', { group: 'ui', priority: 4, max: 2, gain: .9 }, 1)),
    bus.on('offer_tick', (e) => play(e.data?.strong ? 'tick3' : 'tick', { group: 'ui', priority: 3, max: 2, gain: .8 }, 1)),
  ];
  return { buffers: B, log, dispose() { off.forEach((f) => f()); } };
}
