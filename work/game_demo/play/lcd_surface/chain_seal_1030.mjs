// 継続チャレンジ（10/30）：JPチャンスの封印の扉（jp_seal_1030.mjs と同じ s{k} → b{k} → open の流れ）を、継続（chainMode）でも使う。
//   ?chainseal=0 で旧（chain_jp_aim_d*）のまま。?rules=h のときだけ働く（rules_h_20261029.mjs の最後で attach）。jp_seal_1030.mjs には触れない。
//   JPとの違いは設定だけ：
//     ・鎖の数          ＝ 継続の規定数（meterStatus.threshold ← 規則 ChainThresholdByHitSet / ChainMeterByStage）。封印の素材がある N（manifest_chain.json）の範囲で、規定数に合う N を使い、
//                         足りないとき（規定数 > 素材の最大 N）は入賞数に比例して段を進める（最後の1本は規定数に届いたときだけ）
//     ・あたり穴の数    ＝ 規則の ChainHitCount（メーター部品が meterStatus.targets から描く。ここでは何もしない）
//     ・制限時間・時計  ＝ 規則（ChainMeterByStage.Seconds）
//     ・字              ＝ 導入（規則の ChainIntroSeconds の間）に「継続チャレンジ」、以後は「N連目 ・ 成功率 2/3」を1か所（左上）にまとめる。メーター部品・カットインとは重ねない
//   「封印解除!!」の叩きつけ（in）は使わない（JPの導入の字の代わりに上の題字）。映像はいつも s{k}（待機）から。
//   成功＝ open（錠が砕けて扉が開く）→ 以降は本体の既存（jp_rush → jp_bridge → ルーレット → chain_jp_land → 継続成功）。失敗＝本体の既存（ガラスが割れる）。赤い警報は rules_h の既存（JPと同じ）。
//   場面名は chain_jp_aim_seal_d{d}_n{N}_{in|s{k}|b{k}|open}（chain_jp_aim で始まるので、本体のメーター部品・待機判定にそのまま乗る）。
import { fancy, W, H } from './meter_h_20261029.mjs';

const RE = /^chain_jp_aim_seal_d(\d)_n(\d)_(s(\d+)|b(\d+)|open)$/;
const FINISH_SECONDS = 1.2;
const PX = 34, PY = 28;
const GOLD = [[0, '#fffbe0'], [0.3, '#ffe071'], [0.5, '#e69a12'], [0.52, '#7a3c00'], [0.7, '#ffbd2e'], [1, '#fff0a0']];
const RAINBOW = [[0, '#fff3f3'], [0.18, '#ff7a8a'], [0.34, '#ffd24a'], [0.5, '#5fe08a'], [0.52, '#143a52'], [0.68, '#5fb4ff'], [0.85, '#c27cff'], [1, '#fff0ff']];
const FONT_SERIF = '"Kaisei Tokumin", "Noto Serif CJK JP", serif';
const ease = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;

export async function attachChainSeal(lcd, { controller, log = () => {} } = {}) {
  const q = new URLSearchParams(globalThis.location?.search ?? '').get('chainseal');
  if (q === '0' || q === 'off') return lcd;
  const rh = lcd?.rulesH, jp = lcd?.jp;
  if (!rh || !jp || lcd.chainSeal) return lcd;
  const man = jp.man, model = jp.model;
  let mc;
  try {
    const r = await fetch(new URL('./jp1029/seal_chain/manifest_chain.json', import.meta.url));
    if (!r.ok) return lcd;
    mc = await r.json();
  } catch (e) { console.warn('[chain-seal] manifest', e); return lcd; }
  const Ns = Object.keys(mc.byN ?? {}).map(Number).sort((a, b) => a - b);
  if (!Ns.length) return lcd;
  const fps = man.fps ?? 30;
  // 10/31 カットイン第3版（?jpcut=0 で旧）：b{k}・open の映像を seal_jp_cut/ の新しい版へ（jp_seal_1030.mjs と同じ。file / frames / skipF だけ差し替え）
  const cutQ = new URLSearchParams(globalThis.location?.search ?? '').get('jpcut');
  if (cutQ === '1') {
    try {
      const r = await fetch(new URL('./jp1029/seal_jp_cut/manifest_cut.json', import.meta.url));
      if (r.ok) {
        const mcut = await r.json();
        for (const N of Object.keys(mc.byN)) for (const [p, f] of Object.entries(mc.byN[N])) {
          const e = mcut[`n${N}_${p}`]; if (!e || !/^(b\d+|open)$/.test(p)) continue;
          f.file = e.file; f.frames = e.frames; if (e.skipF != null) f.skipF = e.skipF; else delete f.skipF;
        }
      }
    } catch (e) { console.warn('[chain-seal] cut manifest', e); }
  }
  const S = { final: false, lastCount: 0, started: 0, swaps: 0, reserved: null, T: 0, N: 0, d: 0, introAt: -9, events: [] };
  const note = (k, d = {}) => { S.events.push({ k, at: +(rh.state?.clock ?? 0).toFixed(2), ...d }); if (S.events.length > 100) S.events.shift(); log('chainseal:' + k, d); };
  const nm = (d, N, p) => `chain_jp_aim_seal_d${d}_n${N}_${p}`;

  // 規定数 T に使う N（素材のある N のうち T 以下で最大。T が最小の N より小さければ最小）
  const pickN = (T) => { let n = Ns[0]; for (const x of Ns) if (x <= T) n = x; return n; };
  // 入賞数 → 段（0..N-1 が待機 s{k}、N が open）。N==T は 1 対 1。N<T は比例（最後の1本は規定数に届いたときだけ）
  const stageOf = (count, T, N) => (count >= T ? N : count <= 0 ? 0 : Math.min(N - 1, Math.max(1, Math.round((count * N) / T))));
  // 場面を（なければ）作る。部品の一覧は manifest_chain.json
  const ensure = (d, N) => {
    if (man.scenes[nm(d, N, 'open')]) return true;
    const P = mc.byN[String(N)]; if (!P) return false;
    const base = (f, extra = {}) => ({ file: f.file, frames: f.frames, digit: +d, lights_key: `jp_aim_d${d}`, cues: [], seal: { N, ...(f.skipF ? { skipF: f.skipF } : {}) }, ...extra });
    for (let k = 0; k < N; k++) man.scenes[nm(d, N, `s${k}`)] = base(P[`s${k}`], { loop: true, ...(k === 0 ? { cues: [{ f: 0, kind: 'snd', id: `jp_scene_jp_aim_d${d}` }] } : {}) });
    for (let k = 1; k < N; k++) man.scenes[nm(d, N, `b${k}`)] = base(P[`b${k}`], { next: nm(d, N, `s${k}`) });
    man.scenes[nm(d, N, 'open')] = base(P.open, { next: 'jp_rush' });
    return true;
  };

  const off = controller.onAction((action) => {
    if (action === 'meterReady') { S.final = false; S.lastCount = 0; S.reserved = null; }
    else if (action === 'meterEnd') { S.final = !!controller.lastGameEvent?.success; }
    else if (action === 'reset') { S.final = false; S.lastCount = 0; setDelay(); }
  });

  // 満タンの叩きつけ（FULL CHARGE/MAX）は、封印の open に置き換わる。jp_seal の包みの上に重ねる
  const end1 = rh.meter.end?.bind(rh.meter);
  if (end1) rh.meter.end = (...a) => (RE.test(model.name ?? '') ? undefined : end1(...a));

  // 規則の「ルーレットの開始待ち」：叩きつけ 1.2 秒の分を open の長さに置き換える（jp_seal と同じ印 __sealApplied で二重に足さない）
  const openSec = Math.max(...Ns.map((n) => mc.byN[String(n)].open.frames)) / fps;
  const setDelay = () => {
    for (const r of new Set([controller.rules, controller.game?.rules].filter(Boolean))) {
      if (r.__sealApplied === r.RouletteStartDelaySeconds) continue;
      r.RouletteStartDelaySeconds = +(r.RouletteStartDelaySeconds + openSec - FINISH_SECONDS).toFixed(3); r.__sealApplied = r.RouletteStartDelaySeconds;
    }
  };
  setDelay();

  const start = (name, why) => { if (!man.scenes[name]) return false; model.delay = 0; model.pending = null; model.start(name); S.started++; note('start', { name, why }); return true; };
  const nextFor = (d, N, k) => (k + 1 < N ? nm(d, N, `b${k + 1}`) : nm(d, N, 'open'));

  // 旧の継続の狙い（chain_jp_aim_d*）の開始を、封印の場面へ差し替える
  const start0 = model.start.bind(model);
  model.start = (name) => {
    const am = /^chain_jp_aim_d(\d)$/.exec(name ?? '');
    if (am && model.chainMode) {
      const d = am[1], st = controller.game?.meterStatus;
      if (st?.kind === 'chain' && st.threshold > 0) {
        const T = st.threshold, N = pickN(T);
        if (ensure(d, N)) {
          const c = stageOf(S.final ? T : st.count | 0, T, N);
          S.T = T; S.N = N; S.d = +d; S.introAt = rh.state?.clock ?? 0;
          name = c >= N ? nm(d, N, 'open') : nm(d, N, `s${c}`); S.swaps++; note('redirect', { to: name, T, N });
        }
      }
    }
    return start0(name);
  };

  const tick = () => {
    if (!model.active || !model.chainMode) return;
    const g = controller.game, st = g.meterStatus, name = model.name ?? '';
    if (st?.kind === 'chain') S.lastCount = st.count | 0;
    const m = RE.exec(name);
    if (!m) return;
    const d = m[1], N = +m[2], kind = m[3][0] === 'o' ? 'open' : m[3][0];
    if (kind === 'open') return;
    const T = st?.kind === 'chain' ? st.threshold : S.T;
    const stage = S.final ? N : stageOf(S.lastCount, T, N);
    const sc = man.scenes[name], f = (model.time ?? 0) * fps;
    const k = +(m[4] ?? m[5]);
    const canAdvance = kind === 's' || (kind === 'b' && f >= (sc.seal?.skipF ?? 30));
    if (canAdvance && stage > k) { start(nextFor(d, N, k), 'hit'); return; }
    if (kind === 's' && S.reserved !== name) { S.reserved = name; try { jp.reserve?.(nextFor(d, N, k)); } catch {} }
  };

  const jpFrame = jp.frame.bind(jp);
  jp.frame = (dt) => {
    tick();
    const P = rh.state?.plan;
    if (P && !P.done && /^chain_jp_aim_seal_d\d_n\d_open$/.test(model.name ?? '')) { P.done = true; note('plan:skipped (open→jp_rush)'); }
    return jpFrame(dt);
  };

  // 字：導入の題字（ChainIntroSeconds の間、字は上寄り。連打のカットインは下）→ 以後は左上に「N連目 ・ 成功率 2/3」の1か所
  const base = lcd.frame.bind(lcd);
  let t0 = 0, lastScene = '';
  lcd.frame = (dt, F) => {
    const r = base(dt, F);
    const name = model.active ? (model.name ?? '') : '';
    if (!RE.test(name)) { lastScene = ''; return r; }
    const g = controller.game, st = g.meterStatus;
    if (st?.kind !== 'chain') return r;
    if (!lastScene) t0 = 0; lastScene = name; t0 += dt;
    const ctx = lcd.canvas.getContext('2d');
    const rules = g.rules, stage = model.chainStage ?? (st.chainStage ?? 0);
    const disp = (() => { try { return rules.chainMeterFor(st.chainStage ?? 0).Display; } catch { return '2/3'; } })() ?? '2/3';
    const nth = `${(stage | 0) + 1}連目`;
    ctx.save(); ctx.translate(PX, PY); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    const intro = st.stage === 'intro' && st.introLeft > 0;
    if (t0 < 1.9) {
      // 題字：極太明朝×虹×白銀縁＋黒縁。上寄り（y≈300）。着地で大きく叩きつけ、すぐ落ち着く
      const a = Math.min(1, t0 / 0.08) * (t0 > 1.5 ? Math.max(0, 1 - (t0 - 1.5) / 0.4) : 1);
      if (a > 0.01) {
        const s = 1 + 0.6 * (1 - ease(t0 / 0.22)) + 0.015 * Math.sin(t0 * 7);
        ctx.save(); ctx.globalAlpha = a; ctx.translate(W / 2, 215); ctx.scale(s, s);
        fancy(ctx, '継続チャレンジ', 0, 0, 122, { stops: RAINBOW, glow: 'rgba(190,120,255,.9)', skew: -0.1 });
        fancy(ctx, `${nth}　成功率 ${disp}`, 0, 100, 62, { stops: GOLD, glow: 'rgba(255,200,80,.9)', skew: -0.1 });
        ctx.restore();
      }
    }
    if (t0 >= 1.9) {
      const k = ease((t0 - 1.9) / 0.25);
      ctx.save(); ctx.globalAlpha = k; ctx.translate(40, 190);
      fancy(ctx, nth, 0, 0, 70, { stops: GOLD, glow: 'rgba(255,200,80,.8)', align: 'left', skew: -0.1 });
      fancy(ctx, `成功率 ${disp}`, 0, 74, 44, { stops: [[0, '#ffffff'], [0.5, '#c9c9ee'], [1, '#ffffff']], glow: 'rgba(150,150,255,.8)', align: 'left', skew: -0.1 });
      ctx.restore();
    }
    ctx.restore();
    return r;
  };

  lcd.chainSeal = { state: S, mc, pickN, stageOf, dispose() { off?.(); model.start = start0; jp.frame = jpFrame; lcd.frame = base; if (end1) rh.meter.end = end1; } };
  note('attached', { Ns, openSec });
  return lcd;
}
