// JP(大当たり)の曲と効果音(試作・URLフラグ専用)。?jpbgm=A|B|C(1はA) のときだけ play.mjs から読まれる。既定のゲームは変わらない。
// 仕組み:
//  - 全音声(JP曲のOgg + 効果音63本)を起動時に取得・デコード済み。場面切替の瞬間に AudioBuffer は作らない(AudioBufferSourceNode だけ作る)。
//  - JPの場面は window.__lcdSurface.jp.model を毎フレーム見て検知する(場面名と serial の変化)。cueの jp-scene-cue でも同じ(こちらは使わない)。
//  - 黒背景+文字(jp_intro_*)の最初のフレームで、通常BGM(とr2旧JP曲)=engine.bgm.userGain を 4ms で無音に(硬く切る)。
//    その後 silence 秒の間を置いて JP曲を回して音量を上げ、紫の雷(intro開始+84フレーム=2.8秒後)で最大に。雷の一撃は同時刻に鳴らす。
//  - JP曲・効果音は engine.mix に直結(旧JPの勝ち音/duckの影響を受けない)。旧JPの勝ち音(engine.win)は JP の間だけゲートで止める。
//  - JPが終わったら(model.active が false)、変種ごとの終わり方(E1/E2/E3)で通常BGMへ戻す。
const VARIANTS = {
  A: { silence: .55, curve: 1.8, k: 2, hit: 'hit_a_dronedrop', riser: 'riser_1bar', titleRiser: false, end: 'E1', hitGain: -.5 },
  B: { silence: 1.0, curve: 1.4, k: 8, hit: 'hit_b_swellboom', riser: null, titleRiser: true, end: 'E2', hitGain: -.5 },
  C: { silence: .35, curve: 1.0, k: 4, hit: 'hit_d_brassgrowl', riser: 'riser_1bar', titleRiser: false, end: 'E3', hitGain: -3.5, fullAtTitle: true },
};
const dB = x => 10 ** (x / 20);
const G = { riser: -7, zap: -9, slam: -2.5, fanfare: -4, ping: -15, kyuin: -9, tier: -6, tension: -12, tame: -5, land: -1.5, coin: -8, whoosh: -6, rush3: -1.5, bridge: -3, go: -3, final: -1.5, payout: -10, upa: -9,
  fever: -1.5, burst: -3, numslam: -2.5, offer: -6, chainFanfare: -3, door: -10, treasure: -2.5, count: -11, total: -3, end: -3, ticks: -9 };
const JP_BGM_LEVEL = dB(-3.5);          // JP曲(元は -13.7 LUFS)を通常BGMの隣で使えるレベルへ(試聴ミックスと同じ)
const SFX_LEVEL = .85;

export async function installJpAudio(engine, flag = '1') {
  const V = VARIANTS[String(flag).toUpperCase()] ?? VARIANTS.A;
  const ctx = engine.ctx, bgm = engine.bgm;
  const base = new URL('../runtime_assets/', import.meta.url);
  const [meta, jm] = await Promise.all([fetch(new URL('sfx_meta.json', base)).then(r => r.json()), fetch(new URL('jp_bgm_loop.json', base)).then(r => r.json())]);
  const decode = async u => { const r = await fetch(u); if (!r.ok) throw new Error('jp audio HTTP ' + r.status + ' ' + u); return ctx.decodeAudioData(await r.arrayBuffer()); };
  const bgmBuf = await decode(new URL('jp_bgm_loop.ogg', base));
  const bufs = {};
  await Promise.all(Object.keys(meta).map(async n => { bufs[n] = await decode(new URL(`sfx/${n}.ogg`, base)); }));   // 起動時に全部デコード
  const loopStart = jm.loop_start_samples / jm.sr, loopEnd = jm.loop_end_samples / jm.sr, bar = jm.bar_sec, dbs = jm.downbeats_sec;

  // ---- 配線 ----
  const sfxOut = ctx.createGain(); sfxOut.gain.value = SFX_LEVEL; sfxOut.connect(engine.mix);
  const bgmFade = ctx.createGain(); bgmFade.gain.value = 0; const bgmDuck = ctx.createGain(); bgmFade.connect(bgmDuck).connect(engine.mix);
  const winGate = ctx.createGain(); try { engine.win.disconnect(); } catch { } engine.win.connect(winGate).connect(engine.mix);   // 旧JPの勝ち音をJPの間だけ止める

  const st = { inJp: false, src: null, t0: 0, tHit: 0, chain: false, lastSerial: -1, lastName: null, wasActive: false, nodes: [], endPlan: null, nextPing: Infinity, log: [], tension: null };
  const log = (t, what) => { st.log.push([+t.toFixed(3), what]); if (st.log.length > 400) st.log.shift(); };
  const userGainRestore = () => bgm.setVolume(bgm.volume);
  const now = () => ctx.currentTime;

  function play(name, t, gainDb = 0, { anchor = true, stopAt = null, fade = .03, rate = 1 } = {}) {
    const b = bufs[name]; if (!b) return null;
    const s = ctx.createBufferSource(); s.buffer = b; const g = ctx.createGain(); g.gain.value = dB(gainDb);
    s.playbackRate.value = rate; s.connect(g).connect(sfxOut);
    const at = Math.max(now(), t - (anchor ? meta[name].anchor : 0));
    s.start(at);
    if (stopAt != null) { g.gain.setValueAtTime(dB(gainDb), stopAt - fade); g.gain.linearRampToValueAtTime(0, stopAt); s.stop(stopAt + .01); }
    s.onended = () => { try { s.disconnect(); g.disconnect(); } catch { } st.nodes = st.nodes.filter(n => n !== s); };
    st.nodes.push(s); log(t, name); return s;
  }
  function duck(t, depth, hold = .2, release = .7) {
    const p = bgmDuck.gain, lo = dB(-depth);
    p.setTargetAtTime(lo, Math.max(now(), t - .02), .006); p.setTargetAtTime(1, t + hold, release / 3);
  }

  // ---- JPの始まり: 無音→JP曲→雷 ----
  function startJp(t0) {
    st.inJp = true; st.t0 = t0; st.chain = false; st.endPlan = null;
    const tHit = t0 + 84 / 30; st.tHit = tHit;
    // 黒背景の最初のフレームで硬く無音(通常BGMも旧JP曲も engine.bgm.userGain を通る)
    const ug = bgm.userGain.gain; ug.cancelScheduledValues(t0); ug.setValueAtTime(ug.value, Math.max(now(), t0 - .004)); ug.linearRampToValueAtTime(0, Math.max(now() + .002, t0)); log(t0, 'normal→無音');
    winGate.gain.cancelScheduledValues(0); winGate.gain.setValueAtTime(0, now());
    // JP曲: 雷(tHit)に小節頭が来る位置から逆算して、ta から流す
    const ta = t0 + V.silence, tFull = V.fullAtTitle ? t0 + 84 / 30 + 30 / 30 + 5 / 30 : tHit;
    const pos = dbs[V.k] - (tHit - ta);
    if (pos < 0) { console.warn('[jp-audio] k too small'); return; }
    const s = ctx.createBufferSource(); s.buffer = bgmBuf; s.loop = true; s.loopStart = loopStart; s.loopEnd = loopEnd; s.connect(bgmFade);
    s.start(ta, pos); st.src = s;
    const n = 256, curve = new Float32Array(n); for (let i = 0; i < n; i++) curve[i] = (i / (n - 1)) ** V.curve * JP_BGM_LEVEL * bgm.volume;
    bgmFade.gain.cancelScheduledValues(0); bgmFade.gain.setValueAtTime(0, t0); bgmFade.gain.setValueAtTime(0, ta);
    bgmFade.gain.setValueCurveAtTime(curve, ta, tFull - ta); bgmFade.gain.setValueAtTime(JP_BGM_LEVEL * bgm.volume, tFull + .01);
    bgmDuck.gain.cancelScheduledValues(0); bgmDuck.gain.setValueAtTime(1, now());
    log(ta, `JP曲 開始 pos=${pos.toFixed(2)}`);
    if (V.riser) play(V.riser, tHit, G.riser);
    play(V.hit, tHit, V.hitGain, {}); duck(tHit, 9, .3, .9);
    play('zap_flash', tHit + 8 / 30, G.zap);
  }

  // ---- 場面ごとの効果音(場面開始 t からの相対時刻は、実映像で確認した値) ----
  function onScene(name, t) {
    const chain = name.startsWith('chain_'); if (chain) st.chain = true;
    st.nextPing = Infinity;
    if (st.tension) { try { st.tension.stop(t + .05); } catch { } st.tension = null; }
    if (/^jp_intro_(dopamine|reach)$/.test(name)) return startJp(t);
    if (!st.inJp && !/^fail_/.test(name)) return;
    if (/^jp_chance_d\d$/.test(name)) {
      if (V.titleRiser) play('chance_title_riser', t + 5 / 30, -9);
      play('chance_slam', t + 5 / 30, G.slam); duck(t + 5 / 30, 6, .2, .7); play('fanfare_paapaa', t + 5 / 30, G.fanfare);
      play('charge_ding', t + 51 / 30, -11); play('kyuin_c', t + 81 / 30, G.kyuin);
    } else if (/^(chain_)?jp_aim_d\d$/.test(name)) {
      if (chain) { play('chain_continue_fanfare', t, G.chainFanfare); duck(t, 6, .25, .7); }
      st.nextPing = t + .15;
    } else if (/^(chain_)?fly_in(_chance)?_d\d$/.test(name)) play('kyuin_b', t, G.kyuin);
    else if (/^(chain_)?fly_t1_d\d$/.test(name)) { play('tier_up_1', t, G.tier); duck(t, 3, .1, .4); }
    else if (/^(chain_)?fly_t2_d\d$/.test(name)) { play('tier_up_2', t, G.tier); duck(t, 3, .1, .4); }
    else if (/^(chain_)?fly_t3_d\d$/.test(name)) { play('tier_up_3', t, G.tier); duck(t, 5, .1, .4); st.tension = play('tension_pulse', t, G.tension, { stopAt: t + 4 }); }
    else if (/^(chain_)?tame_hit_d\d$/.test(name)) play('tame_hit_ok', t, G.tame);
    else if (/^(chain_)?tame_miss_d\d$/.test(name)) play('tame_miss', t, G.tame);
    else if (/^(chain_)?jp_land_d\d$/.test(name)) { play(chain ? 'land_boom_A' : 'land_boom_D', t, G.land); duck(t, 8, .25, .8); play('coin_burst', t, G.coin); }
    else if (name === 'jp_rush') { play('rush_whoosh', t + .5, G.whoosh); play('rush_slam3', t + 16 / 30, G.rush3); duck(t + 16 / 30, 9, .55, .8); }
    else if (name === 'jp_bridge') { play('bridge_text', t + 19 / 30, G.bridge); duck(t + 19 / 30, 5, .2, .6); play('go_hit', t + 59 / 30, G.go); duck(t + 59 / 30, 5, .2, .6); }
    else if (/^roulette_\d+$/.test(name)) roulette(name, t);
    else if (/^reward_\d+$/.test(name)) {
      play('upa_strobe_arp', t, G.upa); play('fever_slam', t + 36 / 30, G.fever); duck(t + 36 / 30, 7, .25, .7);
      play('reward_burst', t + 46 / 30, G.burst); duck(t + 46 / 30, 6, .2, .6); play('reward_number_slam', t + 109 / 30, G.numslam); duck(t + 109 / 30, 6, .2, .6);
    } else if (name === 'chain_offer') play('chain_offer_ping', t + 4 / 30, G.offer);
    else if (name === 'chain_confirm') {
      play('confirm_door_grind', t + 30 / 30, G.door); play('confirm_treasure_burst', t + 84 / 30, G.treasure); duck(t + 84 / 30, 7, .3, .8);
      play('payout_flow_b', t + 87 / 30, G.payout - 1, { anchor: false, stopAt: t + 87 / 30 + 3 }); play('count_roll', t + 88 / 30, G.count);
      play('total_final_ring', t + 156 / 30, G.total); duck(t + 156 / 30, 6, .25, .8);
    } else if (/^fail_/.test(name)) { if (st.inJp) endJp(t, 'E3'); }
  }

  function roulette(name, t) {
    const sc = jp?.man?.scenes?.[name]; const rev = (sc?.cues ?? []).find(c => c.kind === 'reveal'); const stopF = rev?.f ?? 133;
    const tStop = t + stopF / 30, decelAt = tStop - meta.roulette_ticks_decel.anchor;
    const accelEnd = t + meta.roulette_ticks_accel.dur - .2;
    play('roulette_ticks_accel', t, G.ticks, { anchor: false, stopAt: Math.min(accelEnd, Math.max(t + .4, decelAt)), fade: .08 });
    if (decelAt - accelEnd > .3) {            // 間は一定速度のブリップをループで
      const s = ctx.createBufferSource(); s.buffer = bufs.roulette_ticks_steady; s.loop = true; const g = ctx.createGain(); g.gain.setValueAtTime(0, accelEnd - .1); g.gain.linearRampToValueAtTime(dB(G.ticks), accelEnd);
      g.gain.setValueAtTime(dB(G.ticks), decelAt - .1); g.gain.linearRampToValueAtTime(0, decelAt); s.connect(g).connect(sfxOut); s.start(Math.max(now(), accelEnd - .1)); s.stop(decelAt + .02); st.nodes.push(s);
    }
    play('roulette_ticks_decel', tStop, G.ticks, {});
    play('roulette_final_stop', tStop, G.final); duck(tStop, 6, .2, .6);
    play('payout_flow_a', tStop + .1, G.payout, { anchor: false, stopAt: tStop + 4.4, fade: .4 });
  }

  // ---- 終わり: 通常BGMへ ----
  function endJp(t, mode = V.end) {
    if (!st.inJp) return; st.inJp = false;
    const next = x => st.tHit + Math.ceil((x - st.tHit) / bar - 1e-6) * bar;     // 次の小節頭(JP曲の格子)
    const fadeOut = (a, b) => { const g = bgmFade.gain; g.cancelScheduledValues(a); g.setValueAtTime(g.value || JP_BGM_LEVEL * bgm.volume, a); g.linearRampToValueAtTime(0, b); };
    let tn;                                                                       // 通常BGMへ戻る時刻
    if (mode === 'E1') { const tc = next(t); fadeOut(tc - .006, tc); play('end_stinger', tc, G.end); tn = tc + .55; st.stop = tc + .1; }
    else if (mode === 'E2') { let tc = next(t + .1); if (tc - t < .9 * bar) tc += bar; const g = bgmFade.gain; g.cancelScheduledValues(tc - bar); g.setValueAtTime(JP_BGM_LEVEL * bgm.volume, tc - bar); g.linearRampToValueAtTime(0, tc);
      play('end_reverse_swell', tc, -4); play('end_stinger', tc, G.end - 4); tn = tc; st.stop = tc + .1; }
    else { fadeOut(t, t + .8); play('transition_whoosh', t + .3, -9); tn = t + 1.3; st.stop = t + .9; }
    try { st.src?.stop(st.stop); } catch { }
    // 通常BGMへ: 旧JP曲(r2)が残っていれば消えるまで userGain を戻さない
    const fadeIn = mode === 'E1' ? 1.0 : mode === 'E2' ? .5 : 1.3;
    log(tn, `end ${mode} 通常へ`);
    const wait = setInterval(() => {
      if (ctx.currentTime < tn - .02) return;
      if (bgm.jpPlan) return;                                                      // 旧JP曲がまだ続いている間は待つ
      clearInterval(wait);
      const ug = bgm.userGain.gain, at = ctx.currentTime + .01; ug.cancelScheduledValues(at); ug.setValueAtTime(0, at); ug.linearRampToValueAtTime(bgm.enabled && !bgm.muted ? bgm.volume : 0, at + fadeIn);
      winGate.gain.cancelScheduledValues(0); winGate.gain.setValueAtTime(1, ctx.currentTime + 1.5);
    }, 40);
    st.src = null;
  }

  // ---- 毎フレームの監視 ----
  let jp = null, raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    jp = window.__lcdSurface?.jp ?? jp; const model = jp?.model; if (!model || ctx.state !== 'running') return;
    const t = now();
    const shown = model.active && model.delay <= 0;
    if (shown && (model.serial !== st.lastSerial)) { st.lastSerial = model.serial; st.lastName = model.name; onScene(model.name, t + .01); }
    if (st.inJp && st.wasActive && !model.active) endJp(t + .05);
    st.wasActive = model.active;
    if (st.nextPing < Infinity) {       // 狙い(ループ)の脈動 1.7Hz
      while (st.nextPing < t + .12) { play('aim_ping', st.nextPing, G.ping); st.nextPing += 1 / 1.7; }
    }
  };
  raf = requestAnimationFrame(tick);
  const api = { variant: flag, V, log: st.log, state: st, bufs, meta, trigger: (name) => onScene(name, now() + .05), end: (m) => endJp(now() + .05, m), dispose() { cancelAnimationFrame(raf); } };
  console.info('[jp-audio] ready', flag, Object.keys(bufs).length, 'sfx + bgm', bgmBuf.duration.toFixed(1) + 's');
  return api;
}
