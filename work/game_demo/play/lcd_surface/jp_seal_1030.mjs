// 封印の扉（10/30 監督承認）：ルールH の JPチャンス（連打メーター中）の映像を、旧「狙い」(jp_aim_d*) から封印の扉の一続きの演出に置き換える。
//   ?jpseal=0 で旧（jp_aim）のまま。?rules=h のときだけ働く（rules_h_20261029.mjs の最後で attach）。
//   雷・黒背景の字・JACKPOT CHANCE の見出し・超筑駒RUSH への接続は不変（jp_chance → ここ → jp_rush は manifest の next のまま）。
//
// 場面（jp1029/seal_jp/manifest_seal.json に書いてある。作り方は work/effects/r4_h_fx/seal_door/jp_through/seal_make.py と make_seal_manifest.py）
//   jp_aim_seal_d{d}_in      「封印解除!!」の叩きつけ（封印のまま、紫黒）。JACKPOT CHANCE（またはチュートリアル）の次。→ s0
//   jp_aim_seal_d{d}_s{k}    残り N-k 本の待機ループ（3秒）。k=0 が暗く禍々しい、k=N-1 が「あと一歩」（金・光の筋・粒子）
//   jp_aim_seal_d{d}_b{k}    k 本目の鎖が切れる（閃光・色温度の跳ね・寄り・カットイン「あと◯本」）→ s{k}
//   jp_aim_seal_d{d}_open    N 本目：錠が砕け、扉が開く。→ jp_rush（本体の既存の流れ）→ jp_bridge → ルーレット
//   N（封印の数）＝その穴の連打のしきい値（穴1〜7で 3・4・4・2・4・3・5）。映像が揃っていない穴は旧のまま。
//   場面名を jp_aim_ で始めているのは、本体の「狙いの映像が見えている間だけメーター部品を出す」判定にそのまま乗せるため。
// 連打の入賞（meterStatus.count）が増えるたびに次の b を流す。続けて入ったときは、b の鎖が切れる所のあと（skipF）から次へ進む。
// 失敗（時間切れ）は規則・本体の既存の失敗（ガラスが割れる）。ここでは何もしない。継続（chainMode）は旧のまま。
const RE = /^jp_aim_seal_d(\d)_(in|s(\d+)|b(\d+)|open)$/;
const FINISH_SECONDS = 1.2;   // rules_h の「満タンの叩きつけ」。封印では open の長さに置き換わる

export async function attachJpSeal(lcd, { controller, log = () => {} } = {}) {
  const q = new URLSearchParams(globalThis.location?.search ?? '').get('jpseal');
  if (q === '0' || q === 'off') return lcd;
  const rh = lcd?.rulesH, jp = lcd?.jp;
  if (!rh || !jp || lcd.jpSeal) return lcd;
  const man = jp.man, model = jp.model;
  let ms;
  try {
    const r = await fetch(new URL('./jp1029/seal_jp/manifest_seal.json', import.meta.url));
    if (!r.ok) return lcd;
    ms = await r.json();
  } catch (e) { console.warn('[jp-seal] manifest', e); return lcd; }
  const ds = Object.keys(ms.byD ?? {}).filter((d) => ms.byD[d]?.N && man.scenes[`jp_aim_seal_d${d}_s0`] === undefined);
  if (!ds.length) return lcd;
  for (const [k, v] of Object.entries(ms.scenes)) man.scenes[k] = v;
  const S = { final: false, lastCount: 0, started: 0, swaps: 0, reserved: null, events: [] };
  const note = (k, d = {}) => { S.events.push({ k, at: +(rh.state?.clock ?? 0).toFixed(2), ...d }); if (S.events.length > 100) S.events.shift(); log('jpseal:' + k, d); };
  const N = (d) => ms.byD[d]?.N ?? 0;
  const nm = (d, p) => `jp_aim_seal_d${d}_${p}`;
  // JACKPOT CHANCE の次を封印の「in」に（チュートリアルの有無にかかわらず。チュートリアルの最後の次は毎フレーム下で直す）
  for (const d of Object.keys(ms.byD)) { const cs = man.scenes[`jp_chance_d${d}`]; if (cs && man.scenes[nm(d, 'in')]) cs.next = nm(d, 'in'); }

  const off = controller.onAction((action) => {
    const e = controller.lastGameEvent ?? {};
    if (action === 'meterReady') { S.final = false; S.lastCount = 0; S.reserved = null; }
    else if (action === 'meterEnd') { if (e.success) S.final = true; else S.final = false; }
    else if (action === 'reset') { S.final = false; S.lastCount = 0; setDelay(); }
  });

  // 満タンの叩きつけ（FULL CHARGE/MAX）は、封印では扉が開く演出に置き換わる。封印の映像を流しているときだけ出さない
  const end0 = rh.meter.end?.bind(rh.meter);
  if (end0) rh.meter.end = (...a) => (RE.test(model.name ?? '') ? undefined : end0(...a));

  // 規則の「ルーレットの開始待ち」：叩きつけ 1.2 秒の分を open の長さに置き換える（trim 後の値に足す。リセットで規則が戻ったら足し直す）
  const openSec = Math.max(...ds.map((d) => (man.scenes[nm(d, 'open')]?.frames ?? 0))) / (man.fps ?? 30);
  const setDelay = () => {
    for (const r of new Set([controller.rules, controller.game?.rules].filter(Boolean))) {
      if (r.__sealApplied === r.RouletteStartDelaySeconds) continue;
      r.RouletteStartDelaySeconds = +(r.RouletteStartDelaySeconds + openSec - FINISH_SECONDS).toFixed(3); r.__sealApplied = r.RouletteStartDelaySeconds;
    }
  };
  setDelay();

  const start = (name, why) => { if (!man.scenes[name]) return false; model.delay = 0; model.pending = null; model.start(name); S.started++; note('start', { name, why }); return true; };
  const nextFor = (d, k) => (k + 1 < N(d) ? nm(d, `b${k + 1}`) : nm(d, 'open'));

  // 旧の狙い(jp_aim_d*)の開始を、封印の場面へ差し替える（JACKPOT CHANCE・チュートリアル・打ち切りのどの経路でも）
  const start0 = model.start.bind(model);
  model.start = (name) => {
    const am = /^jp_aim_d(\d)$/.exec(name ?? '');
    if (am && !model.chainMode && ms.byD[am[1]] && man.scenes[nm(am[1], 'in')]) {
      const d = am[1], st = controller.game?.meterStatus;
      if (!st || (st.kind === 'jp' && st.threshold === N(d))) {
        const c = S.final ? N(d) : Math.min(N(d), st?.count | 0);
        name = c <= 0 ? nm(d, 'in') : c >= N(d) ? nm(d, 'open') : nm(d, `s${c}`); S.swaps++; note('redirect', { to: name });
      }
    }
    return start0(name);
  };

  const tick = () => {
    if (!model.active || model.chainMode) return;
    const g = controller.game, st = g.meterStatus, name = model.name ?? '';
    if (st?.kind === 'jp') S.lastCount = st.count | 0;
    const m = RE.exec(name);
    if (!m) return;
    const d = m[1], kind = m[2][0] === 'i' ? 'in' : m[2][0] === 'o' ? 'open' : m[2][0], n = N(d);
    if (kind === 'open') return;
    const count = S.final ? n : Math.min(n, S.lastCount);
    const sc = man.scenes[name], f = (model.time ?? 0) * (man.fps ?? 30);
    const k = kind === 'in' ? -1 : +(m[3] ?? m[4]);
    const canAdvance = kind === 's' || ((kind === 'b' || kind === 'in') && f >= (sc.seal?.skipF ?? 30));
    // in は 1 個も入っていない間は流し続ける（count>0 で初めて b1 へ）。満タン（count>=N）なら残りの切断を飛ばして open へ
    if (canAdvance && count > Math.max(0, k)) { start(count >= n ? nm(d, 'open') : nextFor(d, Math.max(0, k)), kind === 'in' ? 'in→' : 'hit'); return; }
    if (kind === 'in' && count > 0) { /* in の叩きつけの途中は最後まで。skipF 以降は上で進む */ }
    // 次の切断の映像を先に読み込んでおく（待機の間に）
    if (kind === 's' && S.reserved !== name) { S.reserved = name; try { jp.reserve?.(nextFor(d, k)); } catch {} }
  };

  const jpFrame = jp.frame.bind(jp);
  jp.frame = (dt) => {
    tick();
    // 封印の open を流している間は、満タン→jp_rush の既存の予定（叩きつけの後）を使わない（open の next が jp_rush）
    const P = rh.state?.plan;
    if (P && !P.done && /^jp_aim_seal_d\d_open$/.test(model.name ?? '')) { P.done = true; note('plan:skipped (open→jp_rush)'); }
    else if (P && !P.done && /^jp_aim_seal_d\d_(in|s\d+|b\d+)$/.test(model.name ?? '') && P.at - rh.state.clock < 0.5) P.at = rh.state.clock + 0.5;   // 満タンが続けて入っても、open（扉が開く）より先に jp_rush を出さない
    return jpFrame(dt);
  };
  lcd.jpSeal = { state: S, ms, N, dispose() { off?.(); model.start = start0; jp.frame = jpFrame; if (end0) rh.meter.end = end0; } };
  note('attached', { d: Object.keys(ms.byD), openSec });
  return lcd;
}
