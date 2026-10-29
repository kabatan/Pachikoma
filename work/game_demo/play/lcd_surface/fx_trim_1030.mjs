// 10/30 演出の短縮（監督：「演出をうまく削る」）。ルールHだけ。?fxtrim=0 で全部もとに戻す（何もしない）。
//   削るのは溜めと間だけ。字が出きる瞬間・決めの画は残す。再生の速さは変えず、コマを飛ばす（skip）か、場面の終わりを早める（frames）。
//   コマの飛ばしは jp_surface_confirm1029.mjs の frame() が scene.skip を見て行う（このファイルが skip を入れたときだけ働く）。
//   規則の秒数（導入・ルーレットの開始待ち・失敗の映像）も同じだけ短くし、液晶と規則の時計をそろえる。JP音の出来事のコマも同じだけ前へずらす。
//   見積もりと確認は work/game_tuning/timeplan_1030/REPORT.md。
export const FX_TRIM = {
  // 黒背景＋字（雷のあと）：字が出はじめる前の黒だけの間（1〜12コマ）を飛ばす。字の出と読む時間（13〜53）は残す。1.8→1.4秒。JACKPOT CHANCE の見出しは削らない（10/30 監督：不変）
  intro: { scenes: ['jp_intro_dopamine', 'jp_intro_reach'], skip: [[1, 13]] },
  // 超つくこまRUSH のロゴが出きったあとの静止の後半（48〜59）を省く。2.0→1.6秒
  rush: { scene: 'jp_rush', frames: 48 },
  // 「配当ルーレット!!」の札の静止の中ほど（34〜51）を飛ばす。GO!! は残す。2.6→2.0秒
  bridge: { scene: 'jp_bridge', skip: [[34, 52]] },
  // 配当の「○○ OVER FEVER」：白い閃光がいちばん白いコマ（47）から、寄りの焦らしの途中（70）へ飛ぶ。全体が出る瞬間と決めの画は残す。各配当 −22コマ（0.73秒）
  reward: { scenes: [30, 40, 100, 200, 500].map((a) => `reward_${a}`), skip: [[48, 70]] },
  // 失敗（ガラスが割れて灰色＋TOTAL）：TOTAL が出たあとの灰色の静止の後半（114〜149）を省く。5.0→3.8秒
  fail: { scenes: ['fail_first', 'fail_chain'], frames: 114 },
};
const FPS = 30;
export const FX_TRIM_RULES = {   // 規則（ルールH）の秒数。もとは 6.3・5.8
  JpMeterIntroSeconds: 6.3 - (13 - 1) / FPS,
  RouletteStartDelaySeconds: 5.8 - ((60 - 48) + (52 - 34)) / FPS,
};
export const FX_TRIM_FAIL_SECONDS = 114 / FPS;   // FailFilmSeconds（もとは manifest の 150 コマ = 5.0 秒）

export function fxTrimEnabled(search = globalThis.location?.search ?? '') { return new URLSearchParams(search).get('fxtrim') !== '0'; }

export function attachFxTrim(lcd, { controller, log = () => {} } = {}) {
  const man = lcd?.jp?.man;
  if (!lcd?.production || !man || lcd.fxTrim || !fxTrimEnabled() || controller?.game?.rules?.RuleVariant !== 'H_20261029') return lcd;
  const applied = [];
  const skip = (name, ranges) => { const s = man.scenes[name]; if (!s) return; s.skip = ranges.map(([a, b]) => [a, Math.min(b, s.frames - 1)]); applied.push({ name, skip: s.skip }); };
  const tail = (name, frames) => { const s = man.scenes[name]; if (!s || s.frames <= frames) return; applied.push({ name, frames: [s.frames, frames] }); s.frames = frames; };
  for (const n of FX_TRIM.intro.scenes) skip(n, FX_TRIM.intro.skip);
  tail(FX_TRIM.rush.scene, FX_TRIM.rush.frames);
  skip(FX_TRIM.bridge.scene, FX_TRIM.bridge.skip);
  for (const n of FX_TRIM.reward.scenes) skip(n, FX_TRIM.reward.skip);
  for (const n of FX_TRIM.fail.scenes) tail(n, FX_TRIM.fail.frames);
  // 規則の秒数（同じ rules はリセット後の新しい試合でも使われる）
  const setRules = () => { for (const r of new Set([controller.rules, controller.game?.rules].filter(Boolean))) { Object.assign(r, FX_TRIM_RULES); r.FailFilmSeconds = FX_TRIM_FAIL_SECONDS; } };
  setRules(); controller.onAction?.((action) => { if (action === 'reset') setRules(); });
  // JP音（第5版）の出来事のコマ：飛ばした区間より後ろは同じだけ前へ、区間の中は区間の頭へ（音と絵をそろえる）
  let audio = 0;
  const ev = window.__jpAudio?.events?.events;
  if (Array.isArray(ev) && !ev.__fxTrim) {
    const shift = { jp_bridge: FX_TRIM.bridge.skip, 'reward_*': FX_TRIM.reward.skip };   // 黒背景＋字には JP音の出来事が無い
    for (const e of ev) {
      const ranges = shift[e.scene]; if (!ranges || e.ref === 'stop' || !Number.isFinite(e.off)) continue;
      let off = e.off;
      for (const [a, b] of [...ranges].reverse()) { if (e.off >= b) off -= b - a; else if (e.off >= a) off = a; }
      if (off !== e.off) { e.off = off; audio++; }
    }
    Object.defineProperty(ev, '__fxTrim', { value: true });
  }
  lcd.fxTrim = { applied, rules: { ...FX_TRIM_RULES, FailFilmSeconds: FX_TRIM_FAIL_SECONDS }, audioEventsShifted: audio };
  log('fxtrim', lcd.fxTrim);
  return lcd;
}
