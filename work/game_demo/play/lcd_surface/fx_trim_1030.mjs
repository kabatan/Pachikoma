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
  // 失敗（ガラスが割れて灰色＋TOTAL）：TOTAL が出て約0.7秒（68〜89）だけ読ませ、灰色の静止（90〜149）を省く。5.0→3.8秒(10/30)→3.0秒(10/31 監督「失敗画面が体感長い」)
  fail: { scenes: ['fail_first', 'fail_chain'], frames: 90 },
};
const FPS = 30;
export const FX_TRIM_RULES = {   // 規則（ルールH）の秒数。もとは 6.3・5.8
  JpMeterIntroSeconds: 6.3 - (13 - 1) / FPS,
  RouletteStartDelaySeconds: 5.8 - ((60 - 48) + (52 - 34)) / FPS,
};
export const FX_TRIM_FAIL_SECONDS = 90 / FPS;   // FailFilmSeconds（もとは manifest の 150 コマ = 5.0 秒）

// 10/31 配当まわりの短縮（監督：「配当獲得の場面（30 OVER FEVER 周り）は長すぎる。JP 成功後の流れ全体を短く」）。ルールHだけ。?payshort=0 で 10/30 の長さ（上の FX_TRIM のみ）に戻す。
//   見せ場は残す：FEVER の字・「OVER」の叩きつけ・配当額が引いて全景に出る所（音の決め L2 も同じ所）・継続成功の「継続」→「2連目」・告知の「67%で成功」。
//   削るのは同じ絵の引き伸ばしと溜めの繰り返し：FEVER とうぱの交互の明滅、寄りの静止、配当額の長い静止、継続成功の「続」の回転と白飛び、告知のタイトル静止と説明後の静止。
//   skip=[始め,終わり) のコマを飛ばす（jp_surface が実行）。frames=場面の終わりを早める。コマ番号は元の映像のもの。
export const PAY_TRIM = {
  reward: { scenes: [30, 40, 100, 200, 500].map((a) => `reward_${a}`), skip: [[8, 26], [48, 70], [80, 104]], frames: 176 },   // 203/239 → 112 コマ（3.7秒）。もとの 10/30 版は 181/217
  success: { scene: 'chain_success', skip: [[24, 40], [54, 84], [96, 118]], frames: 176 },                               // 186 → 108 コマ（3.6秒）。6.2 → 3.6
  announce: { first: { scene: 'chain_announce_first', skip: [[8, 26], [40, 50], [212, 266]] }, repeat: { scene: 'chain_announce_repeat', skip: [[6, 48], [124, 174], [196, 252]], short: true } },   // 最初の告知 303 → 221（7.4秒）。2回目以降 288 → 142（4.7秒。2/3 の説明は客が一度見た：タイトルの溜めと 67% の組み上がりを省き、没収の玉数は残す）
  announceMargin: 0.3,                                                                                                       // 規則の告知の秒数は映像より 0.3 秒短く（映像の最後の白で終わる）
};
export function payShortEnabled(search = globalThis.location?.search ?? '') { return new URLSearchParams(search).get('payshort') !== '0'; }
const skippedOf = (ranges) => ranges.reduce((n, [a, b]) => n + (b - a), 0);

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
  const pay = payShortEnabled();
  const rewardSkip = pay ? PAY_TRIM.reward.skip : FX_TRIM.reward.skip;
  for (const n of FX_TRIM.reward.scenes) skip(n, rewardSkip);
  if (pay) {
    for (const n of PAY_TRIM.reward.scenes) tail(n, PAY_TRIM.reward.frames);
    skip(PAY_TRIM.success.scene, PAY_TRIM.success.skip); tail(PAY_TRIM.success.scene, PAY_TRIM.success.frames);
    for (const k of ['first', 'repeat']) skip(PAY_TRIM.announce[k].scene, PAY_TRIM.announce[k].skip);
  }
  for (const n of FX_TRIM.fail.scenes) tail(n, FX_TRIM.fail.frames);
  // 規則の秒数（同じ rules はリセット後の新しい試合でも使われる）
  // payshort：規則の秒数（配当のあとの確定待ち・告知）を、短くした映像の長さに合わせる。どれも「いまの値より短いときだけ」下げる（規則の側で短くされたら、それに従う）。
  //   RouletteResultSeconds[段] = 止まってから配当の映像が終わるまで（ルーレットの止まった後の尾＋配当）。これより長いと映像が終わっても告知が出ず空白になる。
  //   ChainAnnounceSecondsFirst / ChainAnnounceSeconds = 告知の映像（飛ばしたあと）の長さ − 0.3 秒。
  const payRules = () => {
    const sc = man.scenes, fps = man.fps || 30, out = {};
    const awards = [30, 40, 100, 200, 500];
    const film = awards.map((a) => { const ro = sc[`roulette_${a}`], rw = sc[`reward_${a}`]; return ro && rw && Number.isFinite(ro.stop_frame) ? (ro.frames - ro.stop_frame + rw.frames - skippedOf(rewardSkip.filter(([x]) => x < rw.frames))) / fps : null; });
    out.filmAfterStop = film;
    for (const [k, key] of [['first', 'ChainAnnounceSecondsFirst'], ['repeat', 'ChainAnnounceSeconds']]) {
      const a = sc[PAY_TRIM.announce[k].scene]; if (a) out[key] = +((a.frames - skippedOf(PAY_TRIM.announce[k].skip)) / fps - PAY_TRIM.announceMargin).toFixed(3);
    }
    return out;
  };
  const payR = pay ? payRules() : null;
  const setRules = () => { for (const r of new Set([controller.rules, controller.game?.rules].filter(Boolean))) { Object.assign(r, FX_TRIM_RULES); r.FailFilmSeconds = FX_TRIM_FAIL_SECONDS;
    if (payR) {
      if (Array.isArray(r.RouletteResultSeconds)) r.RouletteResultSeconds = r.RouletteResultSeconds.map((x, i) => (payR.filmAfterStop[i] != null && payR.filmAfterStop[i] < x ? +payR.filmAfterStop[i].toFixed(3) : x));
      for (const key of ['ChainAnnounceSecondsFirst', 'ChainAnnounceSeconds']) if (payR[key] != null && (r[key] == null || payR[key] < r[key])) r[key] = payR[key];
    } } };
  setRules(); controller.onAction?.((action) => { if (action === 'reset') setRules(); });
  // JP音（第5版）の出来事のコマ：飛ばした区間より後ろは同じだけ前へ、区間の中は区間の頭へ（音と絵をそろえる）
  let audio = 0;
  const ev = window.__jpAudio?.events?.events;
  if (Array.isArray(ev) && !ev.__fxTrim) {
    const shift = { jp_bridge: FX_TRIM.bridge.skip, 'reward_*': rewardSkip };   // 黒背景＋字には JP音の出来事が無い
    for (const e of ev) {
      const ranges = shift[e.scene]; if (!ranges || e.ref === 'stop' || !Number.isFinite(e.off)) continue;
      if (pay && e.scene === 'reward_*' && e.off >= PAY_TRIM.reward.frames) { e.do = []; audio++; continue; }   // 短くした映像の終わりより後の音（配当画面の閃光3）は鳴らさない
      let off = e.off;
      for (const [a, b] of [...ranges].reverse()) { if (e.off >= b) off -= b - a; else if (e.off >= a) off = a; }
      if (off !== e.off) { e.off = off; audio++; }
    }
    Object.defineProperty(ev, '__fxTrim', { value: true });
  }
  lcd.fxTrim = { applied, rules: { ...FX_TRIM_RULES, FailFilmSeconds: FX_TRIM_FAIL_SECONDS }, audioEventsShifted: audio, payshort: pay ? { ...PAY_TRIM, rules: payR } : false };
  log('fxtrim', lcd.fxTrim);
  return lcd;
}
