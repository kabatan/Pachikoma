// JP(大当たり)の音 第4版(既定)。play.mjs から既定で読まれる。旧音へ戻すには ?jpaudio=old(旧: jp_audio.mjs)、無効は ?jpaudio=off。
// 考え方(NOTES: previews_v4/NOTES.md):
//  - 土台は静か: JP曲 + 控えめなキック/ハット(拍に合わせて少し先の分だけ予約)。高域の持続層は敷かない。
//  - 出来事の瞬間に大きな一撃: 場面の開始から「フレーム数」で相対的に鳴らす(XL/L/M/S の積み方は previews_v4/events_jp_v4_*.json と同じ)。
//    山の音は出来事バス(コンプ→ドライブ→ソフトクリップ)を通す。出来事の少し前から土台(JP曲)を下げる(重なっても深い方だけ=最小を取る)。
//  - ライザー/サイレンなどの「溜め」は頂点(anchor)が出来事に合う。溜めを鳴らす余裕がない時は途中から鳴らして頂点だけ合わせる。
//  - 場面の時刻は window.__lcdSurface.jp.model の場面名とserialの変化で検知(旧版と同じ)。固定長で次へ進む場面
//    (導入→雷→チャンス、着地→ラッシュ→橋)は、前の場面の検知時点で先に予約して頂点を合わせる。実時間のずれは api.drift に残す。
//  - 実ゲームの導入は「黒背景+文字(dopamine/reach 84コマ) → 雷(30コマ) → チャンス」の順(v4の映像と逆)。JP曲は黒背景+文字の最初のコマで全開、雷はそのあと。
//  - JP後(継続の選択・継続チャンス・確定・時間切れ)は別担当。ここでは旧版と同じ音をそのまま鳴らす(legacy)。担当が差し替える。
const dB = x => 10 ** (x / 20);
const FPS = 30;
const SONG_DB = -2.0;          // JP曲+土台の音量(v4の土台較正値 -1.97 dB)
const K = { XL: 8, L: 4, M: -4, S: -4 };   // クラス別の加算dB
const TAIL = { mega: 2.4, fan: 2.0, mega_small: 1.3 };
const EV_COMP = { thr: -26, ratio: 3, makeup: 4 }, EV_DRIVE = 7, EV_TH = .75, EV_OUT = .85, SFX_LEVEL = .85, EV_THUNDER = 3.5;
const G = { tier: -3, tame: -5, ticks: -10, ping: -17,
  chainFanfare: -3, offer: -6, door: -10, treasure: -2.5, payout: -10, count: -11, total: -3, end: -3, land: -1.5, coin: -8, whoosh: -6, kyuin: -9, tierL: -6, tension: -12 };   // 後半は legacy 用(旧版の値)
const BASE = {   // 場面ごとの土台(キック, ハット, 裏拍キック) [dB, 小さいほど静か]。v4の foundation() と同じ値
  intro: [-16, null, null], chance: [-13, -24, null], aim: [-13, -24, null], fly_early: [-12, -23, null], fly_t2: [-11, -22, -18], fly_t3: [-10, -21, -16], after: [-11, -22, -17] };

export async function installJpAudioV4(engine, opts = {}) {
  const ctx = engine.ctx, bgm = engine.bgm;
  const base1 = new URL('../runtime_assets/', import.meta.url), base4 = new URL('../runtime_assets_v4/', import.meta.url);
  const [meta1, meta4, jm] = await Promise.all([fetch(new URL('sfx_meta.json', base1)).then(r => r.json()), fetch(new URL('sfx_meta_v4.json', base4)).then(r => r.json()), fetch(new URL('jp_bgm_loop.json', base1)).then(r => r.json())]);
  const meta = { ...meta1, ...meta4 };
  const decode = async u => { const r = await fetch(u); if (!r.ok) throw new Error('jp audio HTTP ' + r.status + ' ' + u); return ctx.decodeAudioData(await r.arrayBuffer()); };
  const bgmBuf = await decode(new URL('jp_bgm_loop.ogg', base1));
  const bufs = {};
  await Promise.all([...Object.keys(meta1).map(async n => { bufs[n] = await decode(new URL(`sfx/${n}.ogg`, base1)); }), ...Object.keys(meta4).map(async n => { bufs[n] = await decode(new URL(`sfx/${n}.ogg`, base4)); })]);   // 起動時に全部デコード
  const loopStart = jm.loop_start_samples / jm.sr, loopEnd = jm.loop_end_samples / jm.sr, bar = jm.bar_sec, beat = bar / 4, dbs = jm.downbeats_sec;

  // ---- 配線 ----
  const sfxOut = ctx.createGain(); sfxOut.gain.value = SFX_LEVEL; sfxOut.connect(engine.mix);                       // legacy(旧版の音)用
  const evIn = ctx.createGain(), evComp = ctx.createDynamicsCompressor(); evComp.threshold.value = EV_COMP.thr; evComp.ratio.value = EV_COMP.ratio; evComp.knee.value = 6; evComp.attack.value = .003; evComp.release.value = .12;
  const evDrive = ctx.createGain(); evDrive.gain.value = dB(EV_COMP.makeup + EV_DRIVE) / 4;                          // 1/4 は WaveShaper の入力範囲(±1)に収めるため
  const shaper = ctx.createWaveShaper(); { const n = 4096, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1) * 2 - 1) * 4; c[i] = EV_TH * Math.tanh(x / EV_TH); } shaper.curve = c; shaper.oversample = '2x'; }
  const evOut = ctx.createGain(); evOut.gain.value = EV_OUT; evIn.connect(evComp).connect(evDrive).connect(shaper).connect(evOut).connect(engine.mix);
  const bgmFade = ctx.createGain(); bgmFade.gain.value = 0; const bgmDuck = ctx.createGain(); bgmFade.connect(bgmDuck).connect(engine.mix);
  const baseIn = ctx.createGain(); baseIn.connect(bgmDuck);                                                          // キック/ハットも同じダッキングを受ける
  const winGate = ctx.createGain(); try { engine.win.disconnect(); } catch { } engine.win.connect(winGate).connect(engine.mix);   // 旧JPの勝ち音をJPの間だけ止める

  const st = { inJp: false, src: null, tS: 0, root: 'D', chain: false, lastSerial: -1, wasActive: false, nodes: [], nextPing: Infinity, tension: null, done: new Set(), scene: { name: '', t0: 0 },
    nextBeat: 0, endAt: Infinity, log: [], scenes: [], drift: [], missing: [], stop: 0 };
  const now = () => ctx.currentTime;
  const frT = (t0, f) => t0 + f / FPS;
  const log = (t, name, g, extra) => { st.log.push({ t: +t.toFixed(3), name, gain: +g.toFixed(1), scene: st.scene.name, ...extra }); if (st.log.length > 4000) st.log.shift(); };

  // ---- 発音 ----
  function play(name, t, g = 0, o = {}) {
    const b = bufs[name]; if (!b) { st.missing.push(name); return null; }
    const an = o.anchor === false ? 0 : (meta[name].anchor || 0);
    let at = t - an, off = 0; const nw = now() + .004;
    if (at < nw) { off = nw - at; at = nw; if (off >= b.duration - .02) return null; }       // 溜めの途中から: 頂点だけは合う
    const s = ctx.createBufferSource(); s.buffer = b; const gn = ctx.createGain(); gn.gain.value = dB(g); s.connect(gn).connect(o.bus === 'sfx' ? sfxOut : evIn);
    const endAt = o.stopAt != null ? o.stopAt : o.dur != null ? (t - an + o.dur) : null;
    if (endAt != null && endAt <= at + .01) return null;
    s.start(at, off);
    if (endAt != null) { const fade = o.fade ?? .03; gn.gain.setValueAtTime(dB(g), Math.max(at, endAt - fade)); gn.gain.linearRampToValueAtTime(0, endAt); s.stop(endAt + .01); }
    s.onended = () => { try { s.disconnect(); gn.disconnect(); } catch { } st.nodes = st.nodes.filter(n => n !== s); };
    st.nodes.push(s); log(t, name, g, off > 0 ? { cut: +off.toFixed(3) } : undefined); return s;
  }
  const A = (name, t, g, o) => play(name, t, g, o);
  const L1 = (name, t, g, o) => play(name, t, g, { ...o, bus: 'sfx' });       // legacy(旧版)の鳴らし方

  // ---- 土台(JP曲)のダッキング: 重なっても最小(深い方)を取り、予約を作り直す ----
  const segs = [];
  const duckDb = x => { let m = 0; for (const s of segs) { if (x < s.a || x >= s.d) continue; const v = x < s.b ? -s.depth * (x - s.a) / (s.b - s.a || 1e-6) : x < s.c ? -s.depth : -s.depth * (1 - (x - s.c) / (s.d - s.c)); if (v < m) m = v; } return m; };
  function duck(t, depth, hold = .2, release = .7, pre = .04) {
    segs.push({ a: t - pre, b: t, c: t + hold, d: t + hold + release, depth });
    const n = now(); for (let i = segs.length - 1; i >= 0; i--) if (segs[i].d < n) segs.splice(i, 1);
    const t0 = n + .003, t1 = Math.max(...segs.map(s => s.d)) + .02; if (t1 <= t0 + .01) return;
    const steps = Math.min(1200, Math.ceil((t1 - t0) / .005)), dt = (t1 - t0) / steps, p = bgmDuck.gain;
    p.cancelScheduledValues(t0); p.setValueAtTime(dB(duckDb(t0)), t0);                       // 区分線形で予約し直す(曲線イベントは重なると例外になるため使わない)
    for (let i = 1; i <= steps; i++) p.linearRampToValueAtTime(dB(i === steps ? duckDb(t1 + .01) : duckDb(t0 + dt * i)), t0 + dt * i);
  }

  // ---- 出来事の「一撃」(クラス別)。値は src/build_previews_v4.py と同じ ----
  const hitXL = (t, root, mega = -.5, fan = -2, { riser = true, siren = true } = {}) => {
    const a = (n, g, o) => A(n, t, g + K.XL, o);
    duck(t, 9, .35, 1.0, .10);
    if (riser) { a('v4_riser_short', -17); a('v4_roll_short', -19); }
    if (siren) a('v4_siren_one', -17);
    a('v3_mega_' + root, mega, { dur: TAIL.mega, fade: .7 }); a('v3_fanfare_' + root, fan, { dur: TAIL.fan + .35, fade: .6, anchor: false });
    a('v3_chime_cascade', -10, { dur: 1.7, fade: .5 }); a('v3_ping_high', -5); a('kyuin_b', -7); a('v4_bell_big', -10, { dur: 1.8, fade: .8 }); a('v4_sub_hit', -3);
  };
  const hitL = (t, root, kyuin = 'kyuin_a', pre = .06) => {
    const a = (n, g, o) => A(n, t, g + K.L, o);
    duck(t, 5.5, .25, .8, pre);
    a('v3_mega_small', -3, { dur: TAIL.mega_small, fade: .4 }); a('v3_stab_' + root, -6); a(kyuin, -8); a('v3_ping_high', -6); a('v4_sub_hit', -5); a('v4_bell_big', -15, { dur: 1.0, fade: .5 });
  };
  const hitM = (t, root, g = 0) => { const a = (n, gg) => A(n, t, gg + g + K.M); duck(t, 3.5, .15, .5, .04); a('v3_stab_' + root, -9); a('v3_ping_high', -8); a('v4_sub_hit', -7); };
  const hitS = (t, g = -12) => A('v3_ping_high', t, g + K.S);
  const once = (key, fn) => { if (st.done.has(key)) return; st.done.add(key); fn(); };

  // ---- JPの始まり(黒背景+文字の最初のコマ): 通常BGMを切り、JP曲を小節頭から全開で入れる ----
  function startJp(t0) {
    st.inJp = true; st.chain = false; st.root = 'D'; st.done.clear(); segs.length = 0; st.endAt = Infinity; st.stop = 0;
    const ug = bgm.userGain.gain; ug.cancelScheduledValues(t0); ug.setValueAtTime(ug.value, Math.max(now(), t0 - .004)); ug.linearRampToValueAtTime(0, Math.max(now() + .002, t0)); log(t0, 'normal→無音', 0);
    winGate.gain.cancelScheduledValues(0); winGate.gain.setValueAtTime(0, now());
    const s = ctx.createBufferSource(); s.buffer = bgmBuf; s.loop = true; s.loopStart = loopStart; s.loopEnd = loopEnd; s.connect(bgmFade);
    const tS = Math.max(t0, now() + .005); s.start(tS, dbs[2]); st.src = s; st.tS = tS;
    const lv = dB(SONG_DB) * bgm.volume; bgmFade.gain.cancelScheduledValues(0); bgmFade.gain.setValueAtTime(0, tS - .002); bgmFade.gain.linearRampToValueAtTime(lv, tS + .0015);
    bgmDuck.gain.cancelScheduledValues(0); bgmDuck.gain.setValueAtTime(1, now());
    st.nextBeat = 0; log(tS, 'JP曲 開始 pos=' + dbs[2].toFixed(2), 0);
    // 150: 黒背景+文字の最初のコマ(JP曲全開)
    A('v3_jp_entry', tS, -2); A('v4_sub_hit', tS, -4); A('v4_bell_big', tS, -13); duck(tS, 4, .2, .6, 0);
    A('v3_ping_high', frT(tS, 12), -14); A('v4_chime_run', frT(tS, 12), -22);
    // 雷の前触れ(風のうなり・頂点まで1.4秒)だけは公称84コマ後に合わせて先に鳴らす。雷本体は雷の場面の検知時に鳴らす(実測で場面の長さに±数コマの揺れがあるため)
    st.scheduledL = frT(tS, 84); A('v3_pre_swell', st.scheduledL, -9 + EV_THUNDER);
  }
  function thunder(tL) {     // 雷 4コマ: 閃光(0)、ネガ反転(+6)、2発目(+8)、再点灯(+10)。雷は +3.5dB(v3と同じ)
    once('thunder', () => {
      duck(tL, 8, .75, .6, .12);
      A('v3_thunder', tL, 0 + EV_THUNDER);
      A('zap_flash', frT(tL, 6), -8 + EV_THUNDER); A('v3_thunder_flash', frT(tL, 8), -3 + EV_THUNDER); A('zap_flash', frT(tL, 10), -10 + EV_THUNDER);
      // チャンス題字(公称30コマ後+5コマ)の溜め(ライザー/ロール/サイレン)だけ先に鳴らして頂点を合わせる。一撃はチャンスの場面の検知時
      st.scheduledC = frT(tL, 30); const tt = frT(st.scheduledC, 5);
      A('v4_riser_short', tt, -17 + K.XL); A('v4_roll_short', tt, -19 + K.XL); A('v4_siren_one', tt, -17 + K.XL); st.done.add('chancePre');
    });
  }
  function chanceStart(tC) {  // JPチャンス(105コマ)
    once('chance', () => {
      A('transition_whoosh', tC, -6); A('v4_sub_hit', tC, -8);
      hitXL(frT(tC, 5), 'D', -2, -3, { riser: !st.done.has('chancePre'), siren: !st.done.has('chancePre') }); A('chance_slam', frT(tC, 5), -4);
      hitS(frT(tC, 16), -12); hitS(frT(tC, 20), -13); A('aim_ping', frT(tC, 62), -12);
      hitL(frT(tC, 82), 'D', 'kyuin_c'); hitS(frT(tC, 90), -14);
    });
  }

  // ---- 場面ごとの音(場面の開始 t からのフレーム数。master_silent_v2.mp4 の出来事フレームを場面の頭で引いた値) ----
  function onScene(name, t) {
    const chain = name.startsWith('chain_'); if (chain) { st.chain = true; st.root = 'A'; }
    st.nextPing = Infinity;
    if (st.tension) { try { st.tension.stop(t + .05); } catch { } st.tension = null; }
    if (/^jp_intro_(dopamine|reach)$/.test(name)) return startJp(t);
    if (!st.inJp && !/^fail_/.test(name)) return;
    const R = st.root;
    if (name === 'jp_intro_lightning') { if (st.scheduledL != null) st.drift.push({ scene: name, expected: +st.scheduledL.toFixed(3), actual: +t.toFixed(3), ms: Math.round((t - st.scheduledL) * 1000) }); thunder(t); }
    else if (/^jp_chance_d\d$/.test(name)) { if (st.scheduledC != null) st.drift.push({ scene: name, expected: +st.scheduledC.toFixed(3), actual: +t.toFixed(3), ms: Math.round((t - st.scheduledC) * 1000) }); chanceStart(t); }
    else if (/^jp_aim_d\d$/.test(name)) st.nextPing = t + .15;
    else if (/^(chain_)?fly_in(_chance)?_d\d$/.test(name) && !chain) { hitL(t, R, 'kyuin_b'); A('v4_riser_short', t, -18); A('v3_motor_clank', t, -10); hitM(frT(t, 10), R); }
    else if (/^fly_t1_d\d$/.test(name)) { A('tier_up_1', t, -3); hitM(t, R, -1); A('v4_chime_run', t, -14); }
    else if (/^fly_t2_d\d$/.test(name)) { A('tier_up_2', t, -3); hitM(t, R, 1); A('v4_chime_run', t, -12); }
    else if (/^fly_t3_d\d$/.test(name)) {
      A('tier_up_3', t, -3); hitL(t, R, 'kyuin_a');
      const t8 = frT(t, 8); A('v3_stab_' + R, t8, -4); A('v4_sub_hit', t8, -3); A('v4_bell_big', t8, -12); A('v3_ping_high', t8, -6); A('kyuin_a', t8, -8); duck(t8, 5, .25, .7, .04);
      st.tension = A('tension_pulse', t, -12, { stopAt: t + 4, fade: .1 });
    }
    else if (/^jp_gold_d\d$/.test(name)) { hitM(t, R, 1); A('v3_ping_high', t, -8); }
    else if (/^tame_hit_d\d$/.test(name)) {
      A('tame_hit_ok', t, 0); hitM(t, R, 2);
      A('gauge_charge_1bar', frT(t, 8), -9);      // 着地までの溜め(頂点=公称8コマ後。着地は玉が口に入った時なので実際の着地は場面の検知時に鳴らす)
    }
    else if (/^tame_miss_d\d$/.test(name)) L1('tame_miss', t, G.tame);
    else if (/^jp_land_d\d$/.test(name)) {
      hitXL(t, R, -.5, -2, { riser: false }); A('land_boom_' + R, t, -4);
      hitL(frT(t, 4), R, 'kyuin_c');
      A('zap_flash', frT(t, 14), -4); A('transition_whoosh', frT(t, 14), -6);
    }
    else if (name === 'jp_rush') rushStart(t);
    else if (name === 'jp_bridge') {
      A('transition_whoosh', frT(t, 15), -6);
      const tb = frT(t, 19); A('bridge_text', tb, -2); duck(tb, 4, .2, .5, .04); hitL(tb, R, 'kyuin_a');
      const tg = frT(t, 59); A('go_hit', tg, -2); duck(tg, 4, .2, .5, .04); A('v3_mega_small', tg, -6); A('v4_siren_one', tg, -8); A('v3_ping_high', tg, -7);
    }
    else if (/^roulette_\d+$/.test(name)) roulette(name, t, R);
    else if (/^reward_\d+$/.test(name)) {
      A('upa_strobe_arp', frT(t, 3), -6); hitM(frT(t, 3), R, 0);
      hitM(frT(t, 27), R, 2); A('v4_sub_hit', frT(t, 27), -4);
      const tf = frT(t, 37); A('fever_slam', tf, -3); duck(tf, 4, .25, .7, .04); hitL(tf, R, 'kyuin_a');
      const tb = frT(t, 46); hitXL(tb, R, -.5, -2); A('reward_burst', tb, -2);
      const to = frT(t, 55); hitL(to, R, 'kyuin_b'); A('v4_chime_run', to, -12);
      const tn = frT(t, 109); hitXL(tn, R, -1.5, -3); A('reward_number_slam', tn, -2);
      hitS(frT(t, 139), -10); hitS(frT(t, 163), -10); hitS(frT(t, 187), -9);
    }
    else legacy(name, t, chain);
  }
  function rushStart(tR) {    // ラッシュ(60コマ)
    once('rush', () => {
      const R = st.root;
      A('rush_whoosh', frT(tR, 1), -4); A('v4_sub_hit', frT(tR, 1), -6); A('zap_flash', frT(tR, 6), -9);
      const t11 = frT(tR, 11); A('v3_stab_' + R, t11, -5); A('v4_sub_hit', t11, -4); A('kyuin_a', t11, -8); A('v3_ping_high', t11, -7);
      A('v3_mega_small', frT(tR, 16), -5); hitM(frT(tR, 16), R, 0);
      A('v3_mega_small', frT(tR, 21), -4); hitM(frT(tR, 21), R, 1);
      hitXL(frT(tR, 26), R, -1.5, -3, { riser: false }); hitS(frT(tR, 33), -11);
    });
  }
  function roulette(name, t, R) {
    const sc = window.__lcdSurface?.jp?.man?.scenes?.[name]; const rev = (sc?.cues ?? []).find(c => c.kind === 'reveal'); const stopF = rev?.f ?? 133;
    const tStop = frT(t, stopF), tLock = frT(t, stopF - 30);
    A('v4_sub_hit', t, -9);
    // 回転ティック: 加速 → 一定 → ロックで減速(旧版の素材。静かめ)
    const decelAt = tStop - meta.roulette_ticks_decel.anchor, accelEnd = t + meta.roulette_ticks_accel.dur - .2;
    play('roulette_ticks_accel', t, G.ticks, { anchor: false, stopAt: Math.min(accelEnd, Math.max(t + .4, decelAt)), fade: .08 });
    if (decelAt - accelEnd > .3) {
      const s = ctx.createBufferSource(); s.buffer = bufs.roulette_ticks_steady; s.loop = true; const g = ctx.createGain(); g.gain.setValueAtTime(0, accelEnd - .1); g.gain.linearRampToValueAtTime(dB(G.ticks), accelEnd);
      g.gain.setValueAtTime(dB(G.ticks), decelAt - .1); g.gain.linearRampToValueAtTime(0, decelAt); s.connect(g).connect(evIn); s.start(Math.max(now(), accelEnd - .1)); s.stop(decelAt + .02); st.nodes.push(s); log(accelEnd, 'roulette_ticks_steady', G.ticks);
    }
    play('roulette_ticks_decel', tStop, G.ticks - 1);
    A('roulette_lock', tLock, -3); A('v3_motor_clank', tLock, -8); hitM(tLock, R, 1);
    hitXL(tStop, R, -.5, -2); A('roulette_final_stop', tStop, -2);
    hitS(frT(tStop, 4), -11); hitS(frT(tStop, 8), -13);
  }

  // ---- JP後(別担当が差し替える)。旧版(jp_audio.mjs)と同じ音をそのまま鳴らす ----
  function legacy(name, t, chain) {
    const R = st.root;
    if (/^(chain_)?jp_aim_d\d$/.test(name)) { if (chain) { L1('chain_continue_fanfare', t, G.chainFanfare); duck(t, 6, .25, .7); } st.nextPing = t + .15; }
    else if (/^chain_fly_in(_chance)?_d\d$/.test(name)) L1('kyuin_b', t, G.kyuin);
    else if (/^chain_fly_t1_d\d$/.test(name)) { L1('tier_up_1', t, G.tierL); duck(t, 3, .1, .4); }
    else if (/^chain_fly_t2_d\d$/.test(name)) { L1('tier_up_2', t, G.tierL); duck(t, 3, .1, .4); }
    else if (/^chain_fly_t3_d\d$/.test(name)) { L1('tier_up_3', t, G.tierL); duck(t, 5, .1, .4); st.tension = L1('tension_pulse', t, G.tension, { stopAt: t + 4 }); }
    else if (/^chain_tame_hit_d\d$/.test(name)) L1('tame_hit_ok', t, G.tame);
    else if (/^chain_tame_miss_d\d$/.test(name)) L1('tame_miss', t, G.tame);
    else if (/^chain_jp_land_d\d$/.test(name)) { L1('land_boom_A', t, G.land); duck(t, 8, .25, .8); L1('coin_burst', t, G.coin); }
    else if (name === 'chain_offer') L1('chain_offer_ping', t + 4 / 30, G.offer);
    else if (name === 'chain_confirm') {
      L1('confirm_door_grind', t + 30 / 30, G.door); L1('confirm_treasure_burst', t + 84 / 30, G.treasure); duck(t + 84 / 30, 7, .3, .8);
      L1('payout_flow_b', t + 87 / 30, G.payout - 1, { anchor: false, stopAt: t + 87 / 30 + 3 }); L1('count_roll', t + 88 / 30, G.count);
      L1('total_final_ring', t + 156 / 30, G.total); duck(t + 156 / 30, 6, .25, .8);
    } else if (/^fail_/.test(name)) { if (st.inJp) endJp(t, 'E3'); }
  }

  // ---- 終わり: 通常BGMへ ----
  function endJp(t, mode = 'E1') {
    if (!st.inJp) return; st.inJp = false;
    const next = x => st.tS + Math.ceil((x - st.tS) / bar - 1e-6) * bar;
    const lv = dB(SONG_DB) * bgm.volume;
    const fadeOut = (a, b) => { const g = bgmFade.gain; g.cancelScheduledValues(a); g.setValueAtTime(g.value || lv, a); g.linearRampToValueAtTime(0, b); };
    let tn;
    if (mode === 'E1') { const tc = next(t); st.endAt = tc; fadeOut(tc - .006, tc); L1('end_stinger', tc, G.end); tn = tc + .55; st.stop = tc + .1; }
    else { st.endAt = t; fadeOut(t, t + .8); L1('transition_whoosh', t + .3, -9); tn = t + 1.3; st.stop = t + .9; }
    try { st.src?.stop(st.stop); } catch { }
    const fadeIn = mode === 'E1' ? 1.0 : 1.3;
    log(tn, `end ${mode} 通常へ`, 0);
    const wait = setInterval(() => {
      if (ctx.currentTime < tn - .02) return;
      if (bgm.jpPlan) return;
      clearInterval(wait);
      const ug = bgm.userGain.gain, at = ctx.currentTime + .01; ug.cancelScheduledValues(at); ug.setValueAtTime(0, at); ug.linearRampToValueAtTime(bgm.enabled && !bgm.muted ? bgm.volume : 0, at + fadeIn);
      winGate.gain.cancelScheduledValues(0); winGate.gain.setValueAtTime(1, ctx.currentTime + 1.5);
    }, 40);
    st.src = null;
  }

  // ---- 土台(キック/ハット)を拍に合わせて少し先まで予約 ----
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

  // ---- 毎フレームの監視 ----
  let jp = null, raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    jp = window.__lcdSurface?.jp ?? jp; const model = jp?.model; if (!model || ctx.state !== 'running') return;
    const t = now();
    const shown = model.active && model.delay <= 0;
    if (shown && (model.serial !== st.lastSerial)) {
      st.lastSerial = model.serial; st.scene = { name: model.name, t0: t + .01 }; st.scenes.push({ scene: model.name, serial: model.serial, t: +(t + .01).toFixed(3) });
      onScene(model.name, t + .01);
    }
    if (st.inJp && st.wasActive && !model.active) endJp(t + .05);
    st.wasActive = model.active;
    if (st.nextPing < Infinity) while (st.nextPing < t + .12) { A('aim_ping', st.nextPing, G.ping); st.nextPing += 1 / 1.7; }
    scheduleBase(t + .3);
  };
  raf = requestAnimationFrame(tick);
  const api = { variant: 'v4', log: st.log, scenes: st.scenes, drift: st.drift, state: st, bufs, meta, trigger: name => onScene(name, now() + .05), end: m => endJp(now() + .05, m), dispose() { cancelAnimationFrame(raf); },
    record() { return { variant: 'v4', sounds: st.log.slice(), scenes: st.scenes.slice(), drift: st.drift.slice(), missing: [...new Set(st.missing)] }; } };
  console.info('[jp-audio] ready v4', Object.keys(bufs).length, 'sfx + bgm', bgmBuf.duration.toFixed(1) + 's');
  return api;
}
