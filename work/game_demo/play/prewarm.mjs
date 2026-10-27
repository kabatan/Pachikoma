// 起動時プリウォーム: 初回にだけ重い処理(画像デコード・GPUアップロード・シェーダコンパイル・getImageData走査)を、遊技が始まる前に済ませる。
// 演出を差し替えても効くよう、特定の演出名には依存しない。
//   1. 描画(HybridRenderer): 全光源を点灯し玉を置いて数フレーム描く → 玉・光層・液晶板のシェーダ/テクスチャをGPUへ
//   2. 液晶(LCD): 登録された全シーンを代表パラメータで開始し、進行を数点サンプルして描く(LCD.defs を走査)。LCD.reset()+状態復元で痕跡を残さない
//   3. 液晶の埋め込みアニメ(LCD.mono, iframeのPixi+three): 点灯1〜6とルーレット3種を最後まで進める。Pixiのテクスチャ破棄(GC)を止める
// 演出側のAPI(LCD.defs / LCD.mono.api / LCD.initHooks 等)を読むだけで、演出ファイルは変更しない。
// ?prewarm=0 で無効。結果は window.__prewarm に残す。
const now = () => performance.now();
const tick = () => new Promise((r) => setTimeout(r, 0));   // 描画やタイマーが詰まらないよう時々譲る

const PARAM_SETS = [
  { payout: 20, award: 20, rank: 2, n: 3, n_from: 3, k: 1, pocket: 3, hit: 3, target: 4, first: true, total: 40, to_next: 5, next_rank: 3, near_miss: true, reason: 'time', weak: false },
  { payout: 600, award: 600, rank: 5, n: 6, n_from: 5, k: 'all', pocket: 7, hit: 7, target: 7, first: false, total: 775, to_next: 0, next_rank: 5, near_miss: false, jp: true, weak: true },
];

async function warmRenderer({ hr, pack, fxApi }) {
  const q = {}, ea = Array(8).fill(1), eb = Array(8).fill(1);
  for (const id of Object.keys(pack?.lighting?.sources ?? {})) q[id] = { rgb: [1, 1, 1] };
  for (const e of hr.layerBuckets.back.concat(hr.layerBuckets.front)) for (const l of e.list) q[l.source_id] ??= { rgb: [1, 1, 1] };
  const pos = new Float32Array(3 * 8);
  for (let i = 0; i < 8; i++) { pos[3 * i] = (i - 4) * 0.02; pos[3 * i + 1] = 0.05 - i * 0.02; pos[3 * i + 2] = -0.055; }
  hr.setLightingFrame({ tick: 0, ea, eb, q }); hr.setBalls({ count: 8, positions: pos });
  fxApi?.frame(1 / 60);
  for (let i = 0; i < 3; i++) hr.render();
  hr.gl.finish();   // 非同期のコンパイル・アップロードの完了まで待つ
  hr.setBalls({ count: 0, positions: new Float32Array(0) });
  hr.setLightingFrame({ tick: 0, ea: Array(8).fill(0), eb: Array(8).fill(0), q: {} });
}

async function warmLcd(LCD) {
  const saved = { ...LCD.state };
  const savedTime = LCD.t, savedBaseTime = LCD.base?.time;
  const savedSwim = LCD.swim ? { n: LCD.swim.n, list: LCD.swim.list.map((u) => ({ ...u })) } : null;
  const ids = Object.keys(LCD.defs).filter((id) => !id.startsWith('_') && id !== 'roulette_sat' && !/^(roulette|ascend)$/.test(id));   // lamp123/4/5/6 は start内の11 tickも温める。roulette_sat は2枚目専用なので単独再生しない
  const imgs = Object.values(LCD.img);
  await Promise.all(imgs.map((im) => (im.decode ? im.decode().catch(() => {}) : null)));   // 画像デコードを先に済ませる
  const titleImgs = Object.entries(LCD.img).filter(([name]) => /^(?:rl_)?t_.+_face\.png$/.test(name));
  const boundsAt = now();
  let titleBoundCount = 0, commonBoundCount = 0;
  for (const [, im] of titleImgs) { try { LCD.titleBounds(im); titleBoundCount++; } catch {} }
  if (LCD.C?.bounds) for (const [name, im] of titleImgs) if (/^t_.+_face\.png$/.test(name)) {
    try { LCD.C.bounds(im); commonBoundCount++; } catch {}
  }
  const bounds = { titleImages: titleImgs.length, titleBoundCount, commonBoundCount, ms: Math.round(now() - boundsAt) };
  // 描画先(GPUラスタのCanvas2D)への画像アップロードを、全素材について先に済ませる(初回drawImageで同期的に起きるため)
  // 1巡で終わらない(ブラウザ側のデコード・アップロードが非同期に進む)ので、1巡の所要時間が落ち着くまで繰り返す(上限あり)
  const c = LCD.ctx, all = [...imgs, ...Object.values(LCD.flipImg || {})], upload = { rounds: [] };
  for (let r = 0; r < 12; r++) {
    const ts = now(); c.save(); c.globalAlpha = 0.01;
    for (const im of all) { try { c.drawImage(im, 0, 0, 4, 4); } catch {} }
    c.restore(); try { c.getImageData(0, 0, 1, 1); } catch {}   // 描画の実行まで待つ
    const d = Math.round(now() - ts); upload.rounds.push(d);
    if (d < 6 && r >= 1) break;
    await new Promise((res) => setTimeout(res, 250));
  }
  LCD.render(null, 0, 0);
  let n = 0, lampWarmSteps = 0;
  for (const id of ids) {
    const def = LCD.defs[id], dur = Math.min(def.dur || 3, 8);
    const params = id === 'lamp123' ? [1, 2, 3].map((n) => ({ ...PARAM_SETS[0], n }))
      : /^lamp[456]$/.test(id) ? [PARAM_SETS[0]] : PARAM_SETS;
    for (const p of params) {
      try {
        LCD.setState({ n: p.n, nDisp: p.n, rank: p.rank, hold: 18, sec: 60 });
        LCD.play(id, { ...p, scale: 1, seed: 7 });
        LCD.update(0.001);   // start時の状態を初期化し、通常の土台だけを1 tick進める
        const sc = LCD.active[LCD.active.length - 1];
        // The first live lamp frames still create and animate the falling balls.
        // Advance one representative 3-lamp and 6-lamp route through that window.
        if ((id === 'lamp123' && p.n === 3) || id === 'lamp6') {
          for (let i = 0; i < 11; i++) {
            LCD.update(0.05); lampWarmSteps++;
            if (i === 2 || i === 6 || i === 10) { LCD.render(null, 0, 0); n++; }
          }
        }
        for (const t of [0.001, dur * 0.5, Math.max(0.001, dur - 0.01)]) {
          if (sc) sc.t = t;   // 先読みではシーンの描画時刻だけを動かし、物理や土台の時間を何秒分も刻まない
          LCD.render(null, 0, 0); n++;
        }
      } catch (e) { console.warn('[prewarm] lcd scene', id, e.message); }
      LCD.active = []; LCD.seen.clear();
    }
    if (n % 20 === 0) await tick();
  }
  // 2枚目の盤は、通常の roulette.start() が segment を作った後に def を切り替える。
  // 先読みでも同じ入口を2度通り、後半のサテライト描画素材と文字を代表時刻で温める。
  let rouletteSatRenders = 0;
  if (LCD.defs.roulette && LCD.defs.roulette_sat) {
    const M = LCD.mono;
    LCD.reset(); if (M?.roul) M.roul.length = 0; if (M) M.heroSc = null;
    try {
      LCD.setState({ n: 5, nDisp: 5, rank: 4, hold: 18, sec: 60 });
      LCD.play('roulette', { n_from: 5, k: 'all', scale: 1, seed: 7 });
      LCD.play('roulette', { n_from: 4, k: 2, scale: 1, seed: 8 });
      const sat = LCD.active.find((sc) => sc.def === LCD.defs.roulette_sat);
      if (!sat || !Array.isArray(sat.segs)) throw new Error('roulette.start did not initialize satellite segments');
      // Warm the hero iframe along its real 20Hz update path through the
      // stop/result transition. The outer LCD composition only needs milestone
      // frames; the 60Hz live scene path is checked separately.
      const lcdSamples = new Set([0, 1, 7, 15, 26, 37, 41, 65, 119, 138, 141]);
      for (let i = 0; i < 142; i++) {
        LCD.update(0.05);
        if (lcdSamples.has(i)) { LCD.render(null, 0, 0); rouletteSatRenders++; }
      }
      // The 2D satellite remains active after the hero reaches the wheel result.
      for (const t of [8.4, 13, 19.5]) {
        for (const sc of LCD.active) sc.t = Math.max(0, t - 0.05);
        LCD.update(0.05); LCD.render(null, 0, 0); rouletteSatRenders++;
      }
    } catch (e) { console.warn('[prewarm] lcd roulette_sat', e.message); }
    LCD.reset(); if (M?.roul) M.roul.length = 0; if (M) M.heroSc = null; M?.api?.reset();
  }
  LCD.reset(); LCD.state = { ...saved }; LCD.setState({ n: saved.n, nDisp: saved.nDisp ?? saved.n ?? 0 });
  LCD.t = savedTime;
  if (Number.isFinite(savedBaseTime) && LCD.base) { LCD.base.time = savedBaseTime; LCD.base.update(0); }
  if (savedSwim && LCD.swim) { LCD.swim.n = savedSwim.n; LCD.swim.list = savedSwim.list; }
  return { scenes: ids.length, renders: n + rouletteSatRenders, rouletteSatRenders, lampWarmSteps, bounds, upload };
}

async function warmMono(LCD) {
  const M = LCD.mono, api = M?.api;
  if (!api) return { skipped: 'no mono' };
  const win = M.frame?.contentWindow;
  try { const gc = win?.PIXI?.GC_MODES, tg = win?.__upa?.app?.renderer?.textureGC; if (gc && tg) tg.mode = gc.MANUAL; } catch (e) { console.warn('[prewarm] textureGC', e.message); }
  const runs = [['lamp', 1], ['lamp', 2], ['lamp', 3], ['lamp', 4], ['lamp', 5], ['lamp', 6], ['roulette', { n_from: 3, k: 1 }], ['roulette', { n_from: 4, k: 2 }], ['roulette', { n_from: 5, k: 'all' }]];
  let steps = 0;
  for (const [kind, arg] of runs) {
    api.reset();
    const ok = kind === 'lamp' ? api.lamp(arg) : api.roulette(arg);
    if (!ok) continue;
    // LCD lampScene.start already warms the exact 11 falling-ball setup ticks for
    // lamps 1-6. Direct mono flows share those resources, so their first two frames
    // are enough here; roulette variants share the warmed roulette renderer.
    for (let i = 0; i < 2 && api.busy(); i++) { api.step(0.05); steps++; }
  }
  api.reset();
  return { steps };
}

export async function prewarm(ctx) {
  const out = { ms: {} };
  const t0 = now();
  const LCD = window.LCD;
  try { await warmRenderer(ctx); out.ms.renderer = Math.round(now() - t0); } catch (e) { out.renderer_error = e.message; console.warn('[prewarm] renderer', e); }
  if (LCD?.ready) {
    const t1 = now();
    try { out.lcd = await warmLcd(LCD); } catch (e) { out.lcd_error = e.message; console.warn('[prewarm] lcd', e); }
    out.ms.lcd = Math.round(now() - t1);
    const t2 = now();
    const skip = new URLSearchParams(location.search).get('prewarm') ?? '';   // 検証用: prewarm=nomono / prewarm=nolcd
    try { out.mono = skip === 'nomono' ? { skipped: 'query' } : await warmMono(LCD); } catch (e) { out.mono_error = e.message; console.warn('[prewarm] mono', e); }
    out.ms.mono = Math.round(now() - t2);
  }
  out.ms.total = Math.round(now() - t0);
  return out;
}
