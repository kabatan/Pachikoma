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
  const ids = Object.keys(LCD.defs).filter((id) => !id.startsWith('_') && !/^(roulette|ascend|lamp[0-9]+)$/.test(id));   // mono系は iframe 側で
  const imgs = Object.values(LCD.img);
  await Promise.all(imgs.map((im) => (im.decode ? im.decode().catch(() => {}) : null)));   // 画像デコードを先に済ませる
  for (const im of imgs) { try { LCD.titleBounds(im); } catch {} if (LCD.C?.bounds && im.width * im.height > 4096) { try { LCD.C.bounds(im); } catch {} } }   // 文字の実寸走査(getImageData)をキャッシュ(LCD本体とC系シーン共通部の両方)
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
  let n = 0;
  for (const id of ids) {
    const def = LCD.defs[id], dur = Math.min(def.dur || 3, 8);
    for (const p of PARAM_SETS) {
      try {
        LCD.setState({ n: p.n, nDisp: p.n, rank: p.rank, hold: 18, sec: 60 });
        LCD.play(id, { ...p, scale: 1, seed: 7 });
        const steps = Math.max(6, Math.ceil(dur * 2)), dt = dur / steps;   // 約0.5秒ごと
        for (let s = 0; s <= steps; s++) { LCD.update(s ? dt : 0.001); LCD.render(null, 0, 0); n++; }
      } catch (e) { console.warn('[prewarm] lcd scene', id, e.message); }
      LCD.active = []; LCD.seen.clear();
    }
    if (n % 20 === 0) await tick();
  }
  LCD.reset(); LCD.state = { ...saved }; LCD.setState({ n: saved.n, nDisp: saved.nDisp ?? saved.n ?? 0 });
  return { scenes: ids.length, renders: n, upload };
}

async function warmMono(LCD) {
  const M = LCD.mono, api = M?.api;
  if (!api) return { skipped: 'no mono' };
  const win = M.frame?.contentWindow;
  try { const gc = win?.PIXI?.GC_MODES, tg = win?.__upa?.app?.renderer?.textureGC; if (gc && tg) tg.mode = gc.MANUAL; } catch (e) { console.warn('[prewarm] textureGC', e.message); }
  const runs = [['lamp', 1], ['lamp', 3], ['lamp', 4], ['lamp', 5], ['lamp', 6], ['roulette', { n_from: 3, k: 1 }], ['roulette', { n_from: 4, k: 2 }], ['roulette', { n_from: 5, k: 'all' }]];
  let steps = 0;
  for (const [kind, arg] of runs) {
    api.reset();
    const ok = kind === 'lamp' ? api.lamp(arg) : api.roulette(arg);
    if (!ok) continue;
    for (let i = 0; i < 2400 && api.busy(); i++) { api.step(0.05); steps++; if (steps % 40 === 0) await tick(); }
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
