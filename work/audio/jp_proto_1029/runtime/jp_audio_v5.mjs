// JP(大当たり)の音 第5版(既定)。play.mjs から既定で読まれる。第4版へ戻すには ?jpaudio=v4、第1〜3版は ?jpaudio=old、無効は ?jpaudio=off。
// 考え方(NOTES: previews_v5/NOTES.md):
//  - 出来事を熱さで4段に分け、段ごとに音の「種類」を変える(音量の差だけにしない)。
//      小 S : チップ音のクリック / 中 M : 金属の打撃+うねり / 大 L : ブラスの和音+低音の衝撃 / 最大 XL : JP成功専用(v5_jp_win)
//    最大(v5_jp_win)は **jp_land(JPの着地)でだけ** 鳴らす。溜めの短い無音(土台のJP曲を落とす)→ 確定音(キュイーン)→ ファンファーレ → 鐘の連打。継続の着地などは大。
//  - 段のレシピと出来事の表は runtime_assets_v5/jp_events_v5.json(src/events_v5.py が唯一の定義。プレビュー動画も同じ表から作る)。
//  - 土台は静か(v4と同じ): JP曲 + 控えめなキック/ハット。ずっと鳴る甲高い層なし。音圧の自動調整なし。
//  - 場面の時刻は window.__lcdSurface.jp.model の場面名とserialの変化で検知(v4と同じ)。固定長で次へ進む場面は前の場面の検知時に先に予約して頂点を合わせる。実時間のずれは api.drift に残す。
//  - 実ゲームの導入(10/29 修正): manifest.intro_order==='lightning_first' なら「紫の雷(30コマ・通常BGMの上) → 黒背景+文字(dopamine/reach 84コマ・ここでJP曲が全開) → チャンス」。無ければ従来の「黒背景+文字 → 雷 → チャンス」。雷は「ぶーん」系のまま(v4と同じ素材)。
import { hotBus } from '../../runtime/hot_bus.mjs';   // 10/29: JPの音は圧縮機の後(master入口)の専用出口へ。段ごとの大きさの差が潰れない
const dB = x => 10 ** (x / 20);
const FPS = 30;
const SONG_DB = 0.0;          // JP曲+土台の音量(v4の土台較正値 -1.97 dB)
// 10/29: 出来事バスの圧縮機(閾値-26dB・比3:1)とドライブ+tanh飽和は廃止(音の強弱を潰すため)。固定ゲインのみ。段の大きさは jp_events_v5.json の dB で決める。
const EV_OUT = .82, SFX_LEVEL = .82, EV_THUNDER = -11.5;
const G = { tame: -5, ticks: -20, ping: -27, whoosh: -6, end: -3 };   // 10/29: 常時鳴る層(ルーレットのティック・狙いの脈動)を下げた(ticks -10→-15, ping -22→-27)
const BASE = {   // 場面ごとの土台(キック, ハット, 裏拍キック) [dB, 小さいほど静か]。10/29: 常に鳴る甲高い16分ハットをやめ(null)、キックも3dB下げた
  intro: [-19, null, null], chance: [-16, null, null], aim: [-16, null, null], fly_early: [-15, null, null], fly_t2: [-14, null, -21], fly_t3: [-13, null, -19], after: [-14, null, -20] };
// 組み込み時に追加で読む素材(出来事の表に出ない固定の音)
const EXTRA = ['v3_pre_swell', 'v3_thunder', 'v3_thunder_flash', 'zap_flash', 'v3_jp_entry', 'v3_kick', 'v3_hat16_bar', 'tension_pulse', 'roulette_ticks_accel', 'roulette_ticks_steady', 'roulette_ticks_decel',
  'tame_miss', 'end_stinger', 'transition_whoosh', 'v4_riser_short', 'v5_s_drop', 'v5_l_impact_s'];

export async function installJpAudioV5(engine, opts = {}) {
  const ctx = engine.ctx, bgm = engine.bgm;
  const base1 = new URL('../runtime_assets/', import.meta.url), base4 = new URL('../runtime_assets_v4/', import.meta.url), base5 = new URL('../runtime_assets_v5/', import.meta.url);
  const [meta1, meta4, meta5, jm, EV] = await Promise.all([fetch(new URL('sfx_meta.json', base1)).then(r => r.json()), fetch(new URL('sfx_meta_v4.json', base4)).then(r => r.json()), fetch(new URL('sfx_meta_v5.json', base5)).then(r => r.json()),
    fetch(new URL('jp_bgm_loop.json', base1)).then(r => r.json()), fetch(new URL('jp_events_v5.json', base5)).then(r => r.json())]);
  const meta = { ...meta1, ...meta4, ...meta5 };
  const where = n => n in meta5 ? base5 : n in meta4 ? base4 : base1;
  // 出来事の表が参照する素材(レシピの {変数} は全候補へ展開)を集める
  const need = new Set(EXTRA);
  const expand = (nm) => { if (!nm.includes('{')) return [nm]; const vars = { blip: [1, 2, 3, 4, 5], clang: ['lo', 'D', 'Fs', 'A', 'hi', 'A3'], clang2: ['lo', 'D', 'Fs', 'A', 'hi', 'A3'], root: ['D', 'A'] }; let out = [nm]; for (const k of Object.keys(vars)) out = out.flatMap(s => s.includes('{' + k + '}') ? vars[k].map(v => s.replaceAll('{' + k + '}', v)) : [s]); return out; };
  for (const R of Object.values(EV.recipes)) for (const [n] of R.layers) expand(n).forEach(x => need.add(x));
  for (const e of EV.events) for (const d of e.do) if (d[0] === 'A') need.add(d[1]);
  const unregistered = [...need].filter(n => !(n in meta) && !n.includes('{'));     // 未登録の素材(あれば起動時に分かる)
  const decode = async u => { const r = await fetch(u); if (!r.ok) throw new Error('jp audio HTTP ' + r.status + ' ' + u); return ctx.decodeAudioData(await r.arrayBuffer()); };
  const bgmBuf = await decode(new URL('jp_bgm_loop.ogg', base1));
  const bufs = {};
  await Promise.all([...need].filter(n => n in meta).map(async n => { bufs[n] = await decode(new URL(`sfx/${n}.ogg`, where(n))); }));   // 起動時に全部デコード
  const loopStart = jm.loop_start_samples / jm.sr, loopEnd = jm.loop_end_samples / jm.sr, bar = jm.bar_sec, beat = bar / 4, dbs = jm.downbeats_sec;

  // ---- 場面名 → 出来事の表 ----
  const keyOf = n => n.replace(/_d\d$/, '_d*').replace(/^(roulette|reward)_\d+$/, '$1_*').replace(/fly_in_chance_d\*/, 'fly_in_d*').replace(/^chain_success$/, 'chain_offer2');
  const BYSCENE = {}; for (const e of EV.events) (BYSCENE[e.scene] ??= []).push(e);

  // ---- 配線(v4と同じ) ----
  const hot = hotBus(engine);
  const sfxOut = ctx.createGain(); sfxOut.gain.value = SFX_LEVEL; sfxOut.connect(hot);                               // legacy(旧版の音)用
  const evIn = ctx.createGain();
  const chokeIn = ctx.createGain(); chokeIn.connect(evIn);                                                           // 出来事の音の入口。JP成功の前の無音(溜め)で止める用
  const evOut = ctx.createGain(); evOut.gain.value = EV_OUT; evIn.connect(evOut).connect(hot);
  const bgmFade = ctx.createGain(); bgmFade.gain.value = 0; const bgmDuck = ctx.createGain(), extDuck = ctx.createGain(); bgmFade.connect(extDuck).connect(bgmDuck).connect(hot);
  // JP後担当(window.__afterJp)の duck は bgm.userGain(通常BGM)を直接動かす。JPの間(st.inJp)に通常BGMが持ち上がらないよう、その呼び出しだけ JP曲側の extDuck へ振り替える。
  // v5自身の通常BGMの操作(startJp/endJp)は元のメソッド(UG)を使う。
  const ugp = bgm.userGain.gain, UG = { cancel: ugp.cancelScheduledValues.bind(ugp), target: ugp.setTargetAtTime.bind(ugp), set: ugp.setValueAtTime.bind(ugp), ramp: ugp.linearRampToValueAtTime.bind(ugp) };
  const vol = () => bgm.volume || 1;
  ugp.cancelScheduledValues = (t) => { if (st.inJp) { extDuck.gain.cancelScheduledValues(t); return ugp; } return UG.cancel(t); };
  ugp.setTargetAtTime = (v, t, tc) => { if (st.inJp) { extDuck.gain.setTargetAtTime(Math.min(1, v / vol()), t, tc); return ugp; } return UG.target(v, t, tc); };
  const baseIn = ctx.createGain(); baseIn.connect(bgmDuck);                                                          // キック/ハットも同じダッキングを受ける
  const winGate = ctx.createGain(); try { engine.win.disconnect(); } catch { } engine.win.connect(winGate).connect(engine.mix);   // 旧JPの勝ち音をJPの間だけ止める

  const st = { inJp: false, src: null, tS: 0, root: 'D', chain: false, lastSerial: -1, wasActive: false, nodes: [], nextPing: Infinity, tension: null, done: new Set(), scene: { name: '', t0: 0 },
    nextBeat: 0, endAt: Infinity, log: [], scenes: [], drift: [], missing: [...unregistered], stop: 0, jpWin: 0 };
  const now = () => ctx.currentTime;
  const frT = (t0, f) => t0 + f / FPS;
  const log = (t, name, g, extra) => { st.log.push({ t: +t.toFixed(3), name, gain: +g.toFixed(1), scene: st.scene.name, ...extra }); if (st.log.length > 4000) st.log.shift(); };

  // ---- 発音 ----
  function play(name, t, g = 0, o = {}) {
    const b = bufs[name]; if (!b) { st.missing.push(name); return null; }
    const an = o.anchor === false ? 0 : (meta[name].anchor || 0);
    let at = t - an, off = 0; const nw = now() + .004;
    if (at < nw) { off = nw - at; at = nw; if (off >= b.duration - .02) return null; }       // 溜めの途中から: 頂点だけは合う
    const s = ctx.createBufferSource(); s.buffer = b; const gn = ctx.createGain(); gn.gain.value = dB(g); s.connect(gn).connect(o.bus === 'sfx' ? sfxOut : o.direct ? evIn : chokeIn);
    const endAt = o.stopAt != null ? o.stopAt : o.dur != null ? (t - an + o.dur) : null;
    if (endAt != null && endAt <= at + .01) return null;
    s.start(at, off);
    if (endAt != null) { const fade = o.fade ?? .03; gn.gain.setValueAtTime(dB(g), Math.max(at, endAt - fade)); gn.gain.linearRampToValueAtTime(0, endAt); s.stop(endAt + .01); }
    s.onended = () => { try { s.disconnect(); gn.disconnect(); } catch { } st.nodes = st.nodes.filter(n => n !== s); };
    st.nodes.push(s); log(t, name, g, off > 0 ? { cut: +off.toFixed(3) } : undefined); return s;
  }
  const A = (name, t, g, o) => play(name, t, g, o);
  const L1 = (name, t, g, o) => play(name, t, g, { ...o, bus: 'sfx' });       // legacy(旧版)の鳴らし方

  // ---- 土台(JP曲)のダッキング: 重なっても最小(深い方)を取り、予約を作り直す(v4と同じ) ----
  const segs = [];
  const duckDb = x => { let m = 0; for (const s of segs) { if (x < s.a || x >= s.d) continue; const v = x < s.b ? -s.depth * (x - s.a) / (s.b - s.a || 1e-6) : x < s.c ? -s.depth : -s.depth * (1 - (x - s.c) / (s.d - s.c)); if (v < m) m = v; } return m; };
  function duck(t, depth, hold = .2, release = .7, pre = .04, tag = false) {
    segs.push({ a: t - pre, b: t, c: t + hold, d: t + hold + release, depth, gap: tag });
    const n = now(); for (let i = segs.length - 1; i >= 0; i--) if (segs[i].d < n) segs.splice(i, 1);
    const t0 = n + .003, t1 = Math.max(...segs.map(s => s.d)) + .02; if (t1 <= t0 + .01) return;
    const steps = Math.min(1200, Math.ceil((t1 - t0) / .005)), dt = (t1 - t0) / steps, p = bgmDuck.gain;
    p.cancelScheduledValues(t0); p.setValueAtTime(dB(duckDb(t0)), t0);                       // 区分線形で予約し直す(曲線イベントは重なると例外になるため使わない)
    // Keep both endpoints of exactly constant runs; incoming/outgoing ramps stay unchanged.
    let lastValue, lastTime, pending = false;
    for (let i = 1; i <= steps; i++) {
      const value = dB(i === steps ? duckDb(t1 + .01) : duckDb(t0 + dt * i)), time = t0 + dt * i;
      if (i > 1 && value === lastValue) { lastTime = time; pending = true; continue; }
      if (pending) p.linearRampToValueAtTime(lastValue, lastTime);
      p.linearRampToValueAtTime(value, time);
      lastValue = value; lastTime = time; pending = false;
    }
    if (pending) p.linearRampToValueAtTime(lastValue, lastTime);
  }

  // ---- 段のレシピ(jp_events_v5.json)を鳴らす。src/build_previews_v5.py の run_do と同じ ----
  const fmt = (s, a) => s.replace(/\{(\w+)\}/g, (_, k) => a[k]);
  function tier(k, t, args = {}) {
    const R = EV.recipes[k]; if (!R) { st.missing.push('recipe:' + k); return; }
    if (k === 'XL') return jackpot(t);
    const a = { ...(R.defaults ?? {}), ...args }, g0 = a.g ?? 0;
    if (R.duck && R.duck[0] > 0) duck(t, R.duck[0], R.duck[1], R.duck[2], R.duck[3]);
    for (const [name, g, o0] of R.layers) {
      const o = { ...o0 }; if (o.if && !a[o.if]) continue;
      const delay = o.delay ?? 0; delete o.if; delete o.delay; if (o.anchor !== false) delete o.anchor;
      A(fmt(name, a), t + delay, g + g0, o);
    }
  }
  function runDo(t, doList, ctxArgs = {}) {
    for (const d of doList) {
      if (d[0] === 'duck') duck(t, d[1], d[2], d[3], d[4]);
      else if (d[0] === 'A') { const o = { ...(d[3] ?? {}) }; const delay = o.delay ?? 0; delete o.delay; delete o.if; A(d[1], t + delay, d[2], o); }
      else tier(d[0], t, { ...(d[1] ?? {}), ...ctxArgs });
    }
  }
  const once = (key, fn) => { if (st.done.has(key)) return; st.done.add(key); fn(); };

  // ---- 最大 XL: JP成功(着地)専用。溜めの無音は直前の tame_hit で用意してある(prepareGap) ----
  function prepareGap(tLand) {          // tLand: 着地の見込み時刻。その GAP.len 秒前から土台(JP曲・キック)をほぼ無音にして、着地(確定音)で破る
    const G_ = EV.gap, gs = tLand - G_.len; if (gs < now() - .02) return;
    for (let i = segs.length - 1; i >= 0; i--) if (segs[i].gap) segs.splice(i, 1);   // 金の演出(jp_gold)が間に入ったときは、着地の見込みが後ろへずれるので溜めの無音を取り直す
    duck(gs + G_.ramp, G_.depth, Math.max(.02, tLand - gs - G_.ramp + .06), .05, G_.ramp, true);
    const c = chokeIn.gain; c.cancelScheduledValues(0); c.setValueAtTime(1, Math.max(now(), gs - .02)); c.linearRampToValueAtTime(0, Math.max(now() + .005, gs)); c.setValueAtTime(1, tLand + .3);   // 着地が来なくても(失敗など)0.3秒後には戻す   // それまでに鳴らした音も無音の頭で止める
    st.gapAt = gs; log(gs, 'JP成功の前の溜め(無音)', 0);
  }
  function jackpot(t) {
    if (!/^jp_land_d\d$/.test(st.scene.name)) { log(t, 'REFUSED v5_jp_win(jp_land以外)', 0); st.missing.push('jp_win_outside_land:' + st.scene.name); return; }   // 保険: 着地以外では絶対に鳴らさない
    if (st.jpWin) return; st.jpWin = t;          // JP成功の音は1回のJPにつき1回だけ
    const P = EV.post;
    for (let i = segs.length - 1; i >= 0; i--) if (segs[i].gap && segs[i].a >= t - .01) segs.splice(i, 1);   // 着地が見込みより早く来た(溜めの時間がない)ときは、これから始まる無音の予約を捨てる
    duck(t, P.depth, P.hold, P.release, 0);
    for (const s of st.nodes.slice()) { try { s.stop(now()); } catch { } }            // 無音の間に止めた音の余韻は戻さない
    const c = chokeIn.gain; c.cancelScheduledValues(0); c.setValueAtTime(1, Math.max(now(), t - .001));
    for (const [name, g, o] of EV.recipes.XL.layers) A(name, t, g, { ...o, direct: true });
  }

  // ---- JPの始まり(黒背景+文字の最初のコマ): 通常BGMを切り、JP曲を小節頭から全開で入れる ----
  function startJp(t0) {
    st.inJp = true; st.chain = false; st.root = 'D'; st.done.clear(); segs.length = 0; st.endAt = Infinity; st.stop = 0; st.jpWin = 0; st.gapAt = undefined;
    UG.cancel(t0); UG.set(ugp.value, Math.max(now(), t0 - .004)); UG.ramp(0, Math.max(now() + .002, t0)); extDuck.gain.cancelScheduledValues(0); extDuck.gain.setValueAtTime(1, now()); log(t0, 'normal→無音', 0);
    winGate.gain.cancelScheduledValues(0); winGate.gain.setValueAtTime(0, now());
    const s = ctx.createBufferSource(); s.buffer = bgmBuf; s.loop = true; s.loopStart = loopStart; s.loopEnd = loopEnd; s.connect(bgmFade);
    const tS = Math.max(t0, now() + .005); s.start(tS, dbs[2]); st.src = s; st.tS = tS;
    const lv = dB(SONG_DB) * bgm.volume; bgmFade.gain.cancelScheduledValues(0); bgmFade.gain.setValueAtTime(0, tS - .002); bgmFade.gain.linearRampToValueAtTime(lv, tS + .0015);
    bgmDuck.gain.cancelScheduledValues(0); bgmDuck.gain.setValueAtTime(1, now());
    st.nextBeat = 0; log(tS, 'JP曲 開始 pos=' + dbs[2].toFixed(2), 0);
    // 150: 黒背景+文字の最初のコマ(JP曲全開)。JP曲の入りの一撃(ブラス)+低音の衝撃
    A('v3_jp_entry', tS, -2); A('v5_l_impact_s', tS, -4); duck(tS, 4, .2, .6, 0);
    tier('S', frT(tS, 12), { blip: 3, g: -3 });
    if (lightningFirst()) {
      // 雷は既に鳴らした(導入の最初)。チャンス題字の溜め(ライザー)だけ、公称84コマ後+5コマの頂点に合わせて先に鳴らす。一撃はチャンスの場面の検知時
      st.scheduledC = frT(tS, introFrames()); A('v4_riser_short', frT(st.scheduledC, 5), -13); st.done.add('chancePre');
    } else {
      // 従来の順: 雷の前触れ(風のうなり・頂点まで1.4秒)だけは公称84コマ後に合わせて先に鳴らす。雷本体は雷の場面の検知時に鳴らす
      st.scheduledL = frT(tS, 84); A('v3_pre_swell', st.scheduledL, -9 + EV_THUNDER);
    }
  }
  const introFrames = () => window.__lcdSurface?.jp?.man?.scenes?.jp_intro_dopamine?.frames ?? 84;   // 黒背景+文字の長さ(manifestに従う。10/30 短縮で54)
  const lightningFirst = () => window.__lcdSurface?.jp?.man?.intro_order === 'lightning_first';
  function thunder(tL) {     // 雷 4コマ: 閃光(0)、ネガ反転(+6)、2発目(+8)、再点灯(+10)。「ぶーん」系の非音楽(v4と同じ)
    once('thunder', () => {
      if (!lightningFirst()) duck(tL, 8, .75, .6, .12);   // 従来の順ではJP曲が鳴っているので沈める。雷が先ならまだ通常BGM(JP曲は後から入る)なので沈めない
      A('v3_thunder', tL, 0 + EV_THUNDER);
      A('zap_flash', frT(tL, 6), -8 + EV_THUNDER); A('v3_thunder_flash', frT(tL, 8), -3 + EV_THUNDER); A('zap_flash', frT(tL, 10), -10 + EV_THUNDER);
      if (lightningFirst()) return;
      // 従来の順: チャンス題字(公称30コマ後+5コマ)の溜め(ライザー)だけ先に鳴らして頂点を合わせる。一撃はチャンスの場面の検知時
      st.scheduledC = frT(tL, 30); const tt = frT(st.scheduledC, 5);
      A('v4_riser_short', tt, -13); st.done.add('chancePre');
    });
  }

  // ---- 場面ごとの音(場面の開始 t からのフレーム数。出来事の表は jp_events_v5.json) ----
  function fireScene(key, t, extra = {}) {
    for (const e of BYSCENE[key] ?? []) {
      if (key === 'jp_chance_d*' && globalThis.__jpChanceTrim && e.off >= globalThis.__jpChanceTrim) continue;   // 10/30 JACKPOT CHANCE が短くなった（〇を狙えが無い）ので、その分の音は鳴らさない
      const tt = e.ref === 'stop' ? frT(extra.tStop, e.off) : frT(t, e.off);
      runDo(tt, e.do, key === 'jp_chance_d*' && st.done.has('chancePre') ? { riser: 0 } : {});
    }
  }
  function onScene(name, t) {
    const chain = name.startsWith('chain_'); if (chain) { st.chain = true; st.root = 'A'; }
    st.nextPing = Infinity;
    if (st.tension) { try { st.tension.stop(t + .05); } catch { } st.tension = null; }
    if (/^jp_intro_(dopamine|reach)$/.test(name)) return startJp(t);
    if (name === 'jp_intro_lightning' && !st.inJp && lightningFirst()) {   // 新しい導入: 雷が先。JP曲はまだ始めない(次の黒背景+文字で入る)
      st.done.delete('thunder');
      if (st.scheduledL != null) st.drift.push({ scene: name, expected: +st.scheduledL.toFixed(3), actual: +t.toFixed(3), ms: Math.round((t - st.scheduledL) * 1000) });
      thunder(t); return;
    }
    // H の継続(2連目以降)は JP と同じ映像(jp_rush・jp_bridge・roulette_N・reward_N)を使う。JP曲は告知(chain_announce)で場面が途切れた時に endJp で終わっているので
    // st.inJp は偽。以前はここで黙って return していて、継続成功の突入・ルーレット・配当(reward_40 等 4 秒)が無音だった。JP曲は始めず、一撃の音だけ JP と同じ表で鳴らす(once の印は JP ごとに戻す)。
    const reuse = !st.inJp && /^(jp_rush|jp_bridge|roulette_\d+|reward_\d+)$/.test(name);
    if (reuse && name === 'jp_rush') st.done.delete('rush');
    if (!st.inJp && !/^fail_/.test(name) && !reuse) return;
    // JP後(継続 chain_* と失敗 fail_*)の音は window.__afterJp(JP後担当、?afterjp=0 で無効)が鳴らす。有効なときは二重発音を避けて鳴らさない(失敗ではJP曲の終わりだけ行う)
    if (window.__afterJp?.enabled && (chain || /^fail_/.test(name))) { if (/^fail_/.test(name) && st.inJp) endJp(t, 'E3', true); return; }
    const key = keyOf(name);
    if (name === 'jp_intro_lightning') { if (st.scheduledL != null) st.drift.push({ scene: name, expected: +st.scheduledL.toFixed(3), actual: +t.toFixed(3), ms: Math.round((t - st.scheduledL) * 1000) }); thunder(t); }
    else if (/^jp_chance_d\d$/.test(name)) { if (st.scheduledC != null) st.drift.push({ scene: name, expected: +st.scheduledC.toFixed(3), actual: +t.toFixed(3), ms: Math.round((t - st.scheduledC) * 1000) }); once('chance', () => fireScene(key, t)); }
    else if (/^(chain_)?jp_aim_d\d$/.test(name)) { fireScene(key, t); st.nextPing = t + .15; }
    else if (/^(chain_)?fly_t3_d\d$/.test(name)) { fireScene(key, t); st.tension = A('tension_pulse', t, -18, { stopAt: t + 4, fade: .1 }); }
    else if (/^tame_hit_d\d$/.test(name)) { fireScene(key, t); prepareGap(frT(t, 8)); }      // 着地は公称8コマ後。その直前を無音にする(溜め)
    else if (/^tame_miss_d\d$|^chain_tame_miss_d\d$/.test(name)) L1('tame_miss', t, G.tame);
    else if (/^jp_land_d\d$/.test(name)) { if (st.gapAt != null) st.drift.push({ scene: name, expected: +(st.gapAt + EV.gap.len).toFixed(3), actual: +t.toFixed(3), ms: Math.round((t - st.gapAt - EV.gap.len) * 1000) }); fireScene(key, t); }
    else if (/^jp_gold_d\d$/.test(name)) { tier('M', t, { clang: 'Fs' }); if (st.gapAt != null) prepareGap(frT(t, 18)); }   // 金は18コマ。そのあと着地
    else if (/^chain_jp_gold_d\d$/.test(name)) tier('M', t, { clang: 'Fs' });
    else if (name === 'jp_rush') once('rush', () => fireScene(key, t));
    else if (/^roulette_\d+$/.test(name)) roulette(name, t);
    else if (/^(chain_offer|chain_offer2|chain_success|chain_confirm)$/.test(name) || /^reward_\d+$/.test(name) || BYSCENE[key]) fireScene(key, t);
    else if (/^fail_/.test(name)) { if (st.inJp) endJp(t, 'E3'); }
  }
  function roulette(name, t) {
    const sc = window.__lcdSurface?.jp?.man?.scenes?.[name]; const rev = (sc?.cues ?? []).find(c => c.kind === 'reveal'); const stopF = rev?.f ?? 133;
    const tStop = frT(t, stopF), tLock = frT(t, stopF - 30);
    fireScene('roulette_*', t, { tStop });          // 回転開始(チッ)、桁がそろう(ロック)、最終停止(大)、金の粒(小)
    // 回転ティック: 加速 → 一定 → ロックで減速(旧版の素材。静かめ)
    const decelAt = tStop - meta.roulette_ticks_decel.anchor, accelEnd = t + meta.roulette_ticks_accel.dur - .2;
    play('roulette_ticks_accel', t, G.ticks, { anchor: false, stopAt: Math.min(accelEnd, Math.max(t + .4, decelAt)), fade: .08 });
    if (decelAt - accelEnd > .3) {
      const s = ctx.createBufferSource(); s.buffer = bufs.roulette_ticks_steady; s.loop = true; const g = ctx.createGain(); g.gain.setValueAtTime(0, accelEnd - .1); g.gain.linearRampToValueAtTime(dB(G.ticks), accelEnd);
      g.gain.setValueAtTime(dB(G.ticks), decelAt - .1); g.gain.linearRampToValueAtTime(0, decelAt); s.connect(g).connect(evIn); s.start(Math.max(now(), accelEnd - .1)); s.stop(decelAt + .02); st.nodes.push(s); log(accelEnd, 'roulette_ticks_steady', G.ticks);
    }
    play('roulette_ticks_decel', tStop, G.ticks - 1);
  }

  // ---- 終わり: 通常BGMへ(v4と同じ) ----
  function endJp(t, mode = 'E1', silent = false) {
    if (!st.inJp) return; st.inJp = false;
    const next = x => st.tS + Math.ceil((x - st.tS) / bar - 1e-6) * bar;
    const lv = dB(SONG_DB) * bgm.volume;
    const fadeOut = (a, b) => { const g = bgmFade.gain; g.cancelScheduledValues(a); g.setValueAtTime(g.value || lv, a); g.linearRampToValueAtTime(0, b); };
    let tn;
    if (mode === 'E1') { const tc = next(t); st.endAt = tc; fadeOut(tc - .006, tc); L1('end_stinger', tc, G.end); tn = tc + .55; st.stop = tc + .1; }
    else { st.endAt = t; fadeOut(t, t + .8); if (!silent) L1('transition_whoosh', t + .3, -9); tn = t + 1.3; st.stop = t + .9; }
    try { st.src?.stop(st.stop); } catch { }
    const fadeIn = mode === 'E1' ? 1.0 : 1.3;
    log(tn, `end ${mode} 通常へ`, 0);
    const wait = setInterval(() => {
      if (ctx.currentTime < tn - .02) return;
      if (bgm.jpPlan) return;
      clearInterval(wait);
      const at = ctx.currentTime + .01; UG.cancel(at); UG.set(0, at); UG.ramp(bgm.enabled && !bgm.muted ? bgm.volume : 0, at + fadeIn);
      winGate.gain.cancelScheduledValues(0); winGate.gain.setValueAtTime(1, ctx.currentTime + 1.5);
    }, 40);
    st.src = null;
  }

  // ---- 土台(キック/ハット)を拍に合わせて少し先まで予約(v4と同じ) ----
  function baseLevel(name) {
    if (/^jp_intro_/.test(name)) return BASE.intro;
    if (/^jp_chance_/.test(name)) return BASE.chance;
    if (/^(chain_)?jp_aim_/.test(name)) return BASE.aim;
    if (/^(chain_)?fly_(in|t0|t1)/.test(name)) return BASE.fly_early;
    if (/^(chain_)?fly_t2/.test(name)) return BASE.fly_t2;
    if (/^(chain_)?(fly_t3|tame_)/.test(name)) return BASE.fly_t3;
    return BASE.after;
  }
  function scheduleBase(upTo) {
    if (!st.inJp || !st.src) return;
    const lv = bgm.volume;
    for (let g = 0; g < 64; g++) {
      const tb = st.tS + st.nextBeat * beat; if (tb >= upTo || tb >= st.endAt - .05) break;
      st.nextBeat++; if (tb < now() - .02) continue;
      const [k, h, k8] = baseLevel(st.scene.name);
      const pb = (name, t, db) => { const b = bufs[name]; if (!b) return; const s = ctx.createBufferSource(); s.buffer = b; const gn = ctx.createGain(); gn.gain.value = dB(db + SONG_DB) * lv; s.connect(gn).connect(baseIn); s.start(Math.max(t, now() + .002)); s.onended = () => { try { s.disconnect(); gn.disconnect(); } catch { } }; };
      pb('v3_kick', tb, k);
      if (h != null && (st.nextBeat - 1) % 4 === 0) pb('v3_hat16_bar', tb, h);
      if (k8 != null) pb('v3_kick', tb + beat / 2, k8);
    }
  }

  // ---- 毎フレームの監視(v4と同じ。狙いの脈動だけチップ音の低めの「コッ」に) ----
  let jp = null, raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    jp = window.__lcdSurface?.jp ?? jp; const model = jp?.model; if (!model || ctx.state !== 'running') return;
    const t = now();
    const shown = model.active && model.delay <= 0;
    // 雷が先の導入: 6灯の直後の待ち(model.delay)の間に、雷の前触れ(風のうなり・頂点=雷の最初のコマ)を鳴らす。頂点は雷の場面の始まりに合わせ、途中からでも頂点は合う
    if (model.active && model.delay > 0 && model.name === 'jp_intro_lightning' && model.serial !== st.preSerial && lightningFirst()) {
      st.preSerial = model.serial; st.scheduledL = t + model.delay + .01; A('v3_pre_swell', st.scheduledL, -9 + EV_THUNDER);
    }
    if (shown && (model.serial !== st.lastSerial)) {
      st.lastSerial = model.serial; st.scene = { name: model.name, t0: t + .01 }; st.scenes.push({ scene: model.name, serial: model.serial, t: +(t + .01).toFixed(3) });
      onScene(model.name, t + .01);
    }
    if (st.inJp && st.wasActive && !model.active) endJp(t + .05);
    st.wasActive = model.active;
    if (st.nextPing < Infinity) while (st.nextPing < t + .12) { A('v5_s_drop', st.nextPing, G.ping); st.nextPing += 1 / 1.7; }
    scheduleBase(t + .3);
  };
  raf = requestAnimationFrame(tick);
  const api = { variant: 'v5', log: st.log, scenes: st.scenes, drift: st.drift, state: st, bufs, meta, events: EV, trigger: name => onScene(name, now() + .05), end: m => endJp(now() + .05, m), dispose() { cancelAnimationFrame(raf); ugp.cancelScheduledValues = ugp.constructor.prototype.cancelScheduledValues; ugp.setTargetAtTime = ugp.constructor.prototype.setTargetAtTime; },
    record() { return { variant: 'v5', sounds: st.log.slice(), scenes: st.scenes.slice(), drift: st.drift.slice(), missing: [...new Set(st.missing)], jpWinCount: st.log.filter(l => l.name === 'v5_jp_win').length }; } };
  console.info('[jp-audio] ready v5', Object.keys(bufs).length, 'sfx + bgm', bgmBuf.duration.toFixed(1) + 's', unregistered.length ? 'UNREGISTERED ' + unregistered.join(',') : '');
  return api;
}
