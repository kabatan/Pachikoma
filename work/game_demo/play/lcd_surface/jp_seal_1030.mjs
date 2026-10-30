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
// 失敗（時間切れ）は規則・本体の既存の失敗（ガラスが割れる）。ここでは何もしない。
// 継続チャレンジ（chainMode, 10/30）も同じ流れ・字・映像（in → s{k} → b{k} → open）。違いは設定だけ：
//   鎖の本数＝継続の規定数（meterStatus.threshold）。素材が無い本数はいちばん近い本数の素材（同じ穴 d にあればそれ）を使い、段は入賞数に比例して進める。
// 10/31 カットイン第3版（効果の作り直し）：鎖が切れる b{k}・扉が開く open の映像を jp1029/seal_jp_cut/ の新しい版（切断の火花・破片・屈折する衝撃波＋帯と字のカットイン、1152 のまま描いたもの）へ差し替える。
//   ?jpcut=0 で旧（seal_jp/ の b・open）のまま。差し替えるのは file / frames / skipF だけ（場面の名前・流れは不変）。作り方は work/effects/r4_h_fx/seal_door/jp_through/seal_make_cut.py と cutin2.py。
//   ?chainseal=v02 で旧の独自実装（chain_seal_1030.mjs）、?chainseal=0 でさらに旧（chain_jp_aim）。
const RE = /^jp_aim_seal_d(\d)_(in|s(\d+)|b(\d+)|open)$/;
const FINISH_SECONDS = 1.2;   // rules_h の「満タンの叩きつけ」。封印では open の長さに置き換わる

export async function attachJpSeal(lcd, { controller, log = () => {} } = {}) {
  const qs = new URLSearchParams(globalThis.location?.search ?? '');
  const q = qs.get('jpseal');
  if (q === '0' || q === 'off') return lcd;
  const cq = qs.get('chainseal');
  const chainOn = !(cq === '0' || cq === 'off' || cq === 'v02');   // 継続でも封印（JPと同じ）を使うか
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
  // 10/31 鎖が切れる豪華版（監督承認の第4版。大きな鎖の輪の寄り→C字の破片と錠の破片→光の帯→白飛び→「あと◯本」の叩きつけ。576x634）。
  //   ?jpgb=0 で旧（seal_jp/ の b）のまま。差し替えるのは b{k} の file / frames / skipF と seal.gb=true（音の表 seal_scenes_gb を使う印）だけ。open は旧のまま。作り方は work/effects/r4_h_fx/seal_door/jp_through/（gb_debris.py / seal_make_gb.py / gb_all.sh）。
  if (qs.get('jpgb') !== '0') {
    try {
      const r = await fetch(new URL('./jp1029/seal_jp_gb/manifest_gb.json', import.meta.url));
      if (r.ok) {
        const mgb = await r.json(); let n = 0;
        for (const [k, v] of Object.entries(man.scenes)) {
          const m = /^jp_aim_seal_d\d_b(\d+)$/.exec(k); const e = m && mgb[`n${v.seal?.N}_b${m[1]}`];
          if (!e) continue;
          v.file = e.file; v.frames = e.frames; v.seal = { ...v.seal, skipF: e.skipF ?? v.seal?.skipF, gb: true }; n++;
        }
        globalThis.__jpGb = { n };
      }
    } catch (e) { console.warn('[jp-seal] gb manifest', e); }
  }
  // 10/31 カットイン第3版（?jpcut=0 で旧）
  const cutQ = qs.get('jpcut');
  if (cutQ === '1') {
    try {
      const r = await fetch(new URL('./jp1029/seal_jp_cut/manifest_cut.json', import.meta.url));
      if (r.ok) {
        const mcut = await r.json(); let n = 0;
        for (const [k, v] of Object.entries(man.scenes)) {
          const m = /^jp_aim_seal_d\d_(b\d+|open)$/.exec(k); const e = m && mcut[`n${v.seal?.N}_${m[1]}`];
          if (!e) continue;
          v.file = e.file; v.frames = e.frames; if (e.skipF != null) v.seal = { ...v.seal, skipF: e.skipF }; n++;
        }
        globalThis.__jpCut = { n, mcut };
      }
    } catch (e) { console.warn('[jp-seal] cut manifest', e); }
  }
  const S = { T: 0, final: false, lastCount: 0, started: 0, swaps: 0, reserved: null, events: [] };
  const note = (k, d = {}) => { S.events.push({ k, at: +(rh.state?.clock ?? 0).toFixed(2), ...d }); if (S.events.length > 100) S.events.shift(); log('jpseal:' + k, d); };
  const N = (d) => ms.byD[d]?.N ?? 0;
  // 継続：規定数 T に近い N の素材を持つ穴 d' を選ぶ（同じ d が持っていればそれ。近さが同じなら多い方）
  const pickD = (d, T) => {
    let best = null, bd = 1e9;
    for (const x of Object.keys(ms.byD)) {
      if (!man.scenes[`jp_aim_seal_d${x}_in`]) continue;
      const diff = Math.abs(N(x) - T) * 10 + (x === String(d) ? 0 : 1) - (N(x) > T ? 0.5 : 0);
      if (diff < bd) { bd = diff; best = x; }
    }
    return best;
  };
  // 入賞数 → 段（0..n-1 が待機 s{k}、n が open）。n==T は 1 対 1、n<T は比例（最後の1本は規定数に届いたときだけ）
  // 10/31 T>n（継続の N=6,7。鎖の映像は N=5 まで）は比例をやめ、残り個数（T-count）が映像の残り（n-段）と一致する入賞だけ映像を切る
  //   例 N=7,n=5：3個目→b1、4→b2、5→b3、6→b4、7→open。それより前（1〜2個目）は段0のまま＝今の場面を続けて、火花と音だけ。T<n は従来どおり比例。
  const stageOf = (count, T, n) => (count >= T ? n : count <= 0 ? 0 : T === n ? count : T > n ? Math.max(0, count - (T - n)) : Math.min(n - 1, Math.max(1, Math.round((count * n) / T))));
  const nm = (d, p) => `jp_aim_seal_d${d}_${p}`;
  // JACKPOT CHANCE の次を封印の「in」に（チュートリアルの有無にかかわらず。チュートリアルの最後の次は毎フレーム下で直す）
  for (const d of Object.keys(ms.byD)) { const cs = man.scenes[`jp_chance_d${d}`]; if (cs && man.scenes[nm(d, 'in')]) cs.next = nm(d, 'in'); }
  // 10/30 JACKPOT CHANCE の背景を封印の扉に（旧は竜宮・水晶＋「〇を狙え」）。導入の前半 jp_chance_open_d{d}（2.0秒）→ 題字 jp_chance_d{d}（1.5秒、扉の上）→ in。合計3.5秒＝旧と同じ。?jpopen=0 で旧。
  //   題字の場面は名前を jp_chance_d{d} のまま（音・照明・チュートリアルの差し込みは名前で引くため）。音は off>=45 の「〇を狙え」の分を鳴らさない（__jpChanceTrim）。
  if (qs.get('jpopen') !== '0' && ms.jpOpen) {
    for (const [k, v] of Object.entries(ms.jpOpen)) man.scenes[k] = { ...v };
    for (const k of ['jp_intro_dopamine', 'jp_intro_reach']) if (man.scenes[k]) man.scenes[k].next = 'jp_chance_open_d4';   // 実行時に _d{d} へ置き換わる
    globalThis.__jpChanceTrim = man.scenes.jp_chance_d4?.frames ?? 45;
  }

  const off = controller.onAction((action) => {
    const e = controller.lastGameEvent ?? {};
    if (action === 'meterReady') { S.final = false; S.lastCount = 0; S.reserved = null; S.chainInit = false; }
    else if (action === 'meterEnd') {
      if (e.success) S.final = true;
      else {
        S.final = false;
        // 10/30 初見向け(?ft1=0で無し)：失敗のガラス割れのあと「あと◯本だった！」（残りの本数＝映像の鎖の数−切れた本数）
        try { const T = e.threshold > 0 ? e.threshold : S.curT, n = S.curN || T, c = stageOf(e.count | 0, T, n); lcd.firstTimer?.nearMiss?.({ rem: n - c, kind: e.kind }); } catch {}
      }
    }
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
      const st = controller.game?.meterStatus, lane = st?.kind === 'jp' && st.targets?.length === 1 ? String(st.targets[0]) : null;
      const d = lane && ms.byD[lane] && man.scenes[nm(lane, 'in')] ? lane : am[1];   // 10/30 映像の穴は規則の残り穴（model.d が既定の4に戻っている経路があった）
      if (!st || st.kind !== 'chain') {   // 10/30 規定数が鎖の数と違っても封印へ（段は比例）。旧は threshold===N のときだけ
        const T = st?.threshold > 0 ? st.threshold : N(d), c = S.final ? N(d) : stageOf(st?.count | 0, T, N(d));
        name = c <= 0 ? nm(d, 'in') : c >= N(d) ? nm(d, 'open') : nm(d, `s${c}`); S.swaps++; note('redirect', { to: name });
      }
    }
    const cm = /^chain_jp_aim_d(\d)$/.exec(name ?? '');
    if (cm && model.chainMode && chainOn) {
      const st = controller.game?.meterStatus;
      if (st?.kind === 'chain' && st.threshold > 0) {
        const T = st.threshold, d = pickD(cm[1], T);
        if (d) {
          S.final = false;   // 直前のJPの成功が残っていても、継続の挑戦は最初から
          const n = N(d), c = stageOf(S.final ? T : st.count | 0, T, n);
          S.T = T;
          name = c <= 0 ? nm(d, 'in') : c >= n ? nm(d, 'open') : nm(d, `s${c}`); S.swaps++; note('redirect:chain', { to: name, T, n });
        }
      }
    }
    return start0(name);
  };

  const tick = () => {
    if (!model.active) return;
    const g = controller.game, st = g.meterStatus, name = model.name ?? '';
    // 10/30 どの経路で旧の狙い(jp_aim_d*)が始まっても（start の差し替えを通らない経路があった：初回のチュートリアルの後）、ここで封印へ乗り換える
    { const am = /^jp_aim_d(\d)$/.exec(name); if (am && !model.chainMode && st?.kind !== 'chain' && ms.byD[am[1]] && man.scenes[nm(am[1], 'in')]) { const before = S.swaps; model.start(name); if (S.swaps !== before) { note('redirect:tick', { from: name }); return; } } }
    { const cm = /^chain_jp_aim_d(\d)$/.exec(name); if (cm && model.chainMode && chainOn && st?.kind === 'chain' && st.threshold > 0) { const before = S.swaps; model.start(name); if (S.swaps !== before) { note('redirect:tick:chain', { from: name }); return; } } }
    if (st?.kind === 'jp' || st?.kind === 'chain') S.lastCount = st.count | 0;
    const m = RE.exec(name);
    if (!m) return;
    const d = m[1], kind = m[2][0] === 'i' ? 'in' : m[2][0] === 'o' ? 'open' : m[2][0], n = N(d);
    if (kind === 'open') return;
    const T = st?.kind === 'chain' && st.threshold > 0 ? st.threshold : n;
    S.curN = n; S.curT = T;   // ft1：失敗のときの残りの本数の計算用
    const count = S.final ? n : stageOf(S.lastCount, T, n);
    const sc = man.scenes[name], f = (model.time ?? 0) * (man.fps ?? 30);
    const k = kind === 'in' ? -1 : +(m[3] ?? m[4]);
    // 10/31 満タン（成功確定）なら b の途中でも（skipF を待たず）すぐ open へ。古い「あと◯本」のカットインを成功後に残さない
    if (kind === 'b' && count >= n) { start(nm(d, 'open'), 'full'); return; }
    const canAdvance = kind === 's' || ((kind === 'b' || kind === 'in') && f >= (sc.seal?.skipF ?? 30));
    // in は 1 個も入っていない間は流し続ける（count>0 で初めて b1 へ）。満タン（count>=N）なら残りの切断を飛ばして open へ
    //   10/31 続けて入ったときは貯まった分を順に流さず、最新の残りの場面（b{count}）へ飛ぶ。b の skipF は「あと◯本」のカットインが読める所まで（manifest_gb.json）
    if (canAdvance && count > Math.max(0, k)) { start(count >= n ? nm(d, 'open') : nm(d, `b${count}`), kind === 'in' ? 'in→' : 'hit'); return; }
    if (kind === 'in' && count > 0) { /* in の叩きつけの途中は最後まで。skipF 以降は上で進む */ }
    // 次の切断の映像を先に読み込んでおく（待機の間に）
    if (kind === 's' && S.reserved !== name) { S.reserved = name; try { jp.reserve?.(nextFor(d, k)); } catch {} }
  };

  // 10/30 継続の連打（meterStatus.kind==='chain'）の間、JPの映像が動いていなければ封印の扉を始める。
  //   最初の継続（JP直後・ChainFirstAuto）は選択なしで規則が自動で継続へ進み、'chainContinue' の操作が無い＝ effects_bus が chain_continue を出さない。
  //   すると JP の映像が chainMode にならず、通常背景（idle）に灯と秒数を重ねた画のままだった。ここで同じ chain_continue を液晶へ渡して、選んだときと同じ流れ（start → 封印へ乗り換え）にする。
  //   jp.frame は JP の映像が動いている間しか呼ばれないので、毎フレーム呼ばれる lcd.frame で見る。?chainseal=0/v02 では何もしない。
  const chainEnsure = () => {
    if (!chainOn || S.chainInit) return;
    const g = controller.game, st = g?.meterStatus;
    if (st?.kind !== 'chain' || !(st.threshold > 0) || (st.stage !== 'intro' && st.stage !== 'firing')) return;
    if (model.active) { if (model.chainMode || RE.test(model.name ?? '')) S.chainInit = true; return; }   // 継続の映像が既に動いている（選んだ経路）なら済み。告知・配当などが流れている間は待つ（終わったら ここへ来る）
    const c = g.chainStatus ?? {};
    S.chainInit = true; note('chain:ensure', { stage: st.stage, count: st.count | 0, T: st.threshold });
    lcd.onEvent('chain_continue', { chain: c.successes, lamps: g.lampCount, pending: c.pendingAward, base: c.baseAward });
  };
  const frame0 = lcd.frame.bind(lcd);
  lcd.frame = (dt, F) => { chainEnsure(); return frame0(dt, F); };

  const jpFrame = jp.frame.bind(jp);
  jp.frame = (dt) => {
    tick();
    // 封印の open を流している間は、満タン→jp_rush の既存の予定（叩きつけの後）を使わない（open の next が jp_rush）
    const P = rh.state?.plan;
    if (P && !P.done && /^jp_aim_seal_d\d_open$/.test(model.name ?? '')) { P.done = true; note('plan:skipped (open→jp_rush)'); }
    else if (P && !P.done && /^jp_aim_seal_d\d_(in|s\d+|b\d+)$/.test(model.name ?? '') && P.at - rh.state.clock < 0.5) P.at = rh.state.clock + 0.5;   // 満タンが続けて入っても、open（扉が開く）より先に jp_rush を出さない
    return jpFrame(dt);
  };
  lcd.jpSeal = { state: S, ms, N, dispose() { off?.(); model.start = start0; jp.frame = jpFrame; lcd.frame = frame0; if (end0) rh.meter.end = end0; } };
  note('attached', { d: Object.keys(ms.byD), openSec });
  return lcd;
}
