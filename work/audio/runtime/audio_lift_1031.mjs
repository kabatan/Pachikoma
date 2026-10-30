// 10/31 迫力の底上げ(声なし)。通常時 << JPチャンス < 配当ルーレット < JP成功 の階段を、通常時の音を触らずに作る。
// 監督: 「通常時の音響は今のままで問題ない。JPチャンスと、JP成功後の配当ルーレットがまだ地味。もっと脳に響く音を大音量で」。
// やること:
//  1. 圧縮機の後の専用出口(hot_bus)の先に「段ごとの増幅 + 低域の厚み + 滑らかなリミッター」を挟む。通常時(段0)は素通し(経路ごと切り離し)。
//  2. 新しい音(全部合成: audiolift_1031/synth_lift.py)を重ねる:
//     JPチャンス …… 時間が減るほど高まる低い唸りと脈動(甲高い常時層ではない)、入賞ごとの強い衝撃(4段)、鎖が切れる時の重低音付き爆発、扉が開く時の最大の衝撃
//     配当ルーレット …… 回転中のドラムロール(止めどきへ向けて強まる)、ボタンを叩く衝撃、止まる瞬間の叩きつけ、配当の段ごとの昇格音
//     JP成功 …… 最大。衝撃・ブラスのファンファーレ・ティンパニ・金属の雨
//  3. 衝撃の瞬間にBGM(JP曲)を短く沈める(効果音が埋もれない)。
// 状態は controller.game / controller.onAction / lcd.jp.where() を読むだけ(規則・液晶は変更しない)。通常時の音(玉・釘・点灯・通常BGM)の経路は変えない。
// 無効化: ?audiolift=0 (読み込まない=従来どおり)。
import { hotBus } from './hot_bus.mjs';
const dB = x => 10 ** (x / 20);
const FILES = ['al_hit_1', 'al_hit_2', 'al_hit_3', 'al_hit_4', 'al_break', 'al_break_big', 'al_door', 'al_drone', 'al_pulse1', 'al_pulse2', 'al_riser', 'al_roll', 'al_press', 'al_slam',
  'al_promo_0', 'al_promo_1', 'al_promo_2', 'al_promo_3', 'al_promo_4', 'al_win_first', 'al_win_chain'];
// 第2弾(synth_lift2.py): 音の種類を増やす。有名な当たり音の「構成」を写した合成のパロディ(出典は REFERENCE.md)。
//  P=パチスロの「ペカ」 M=海(マリンバ・スチールパン) J=ビッグバンド E=電子(アルペジオ・ビーム・ピアノ) T=和・祭(太鼓・笛・三味線) R=ロック O=オーケストラ
const WIN2 = ['P0', 'P1', 'P2', 'M0', 'M1', 'M2', 'J0', 'J1', 'J2', 'E0', 'E1', 'E2', 'T0', 'T1', 'R0', 'R1', 'O0', 'O1'].map(n => 'al_win_' + n);
const HIT2 = ['B', 'C', 'D'].flatMap(t => [1, 2, 3, 4].map(k => `al_hit${t}_${k}`));
FILES.push(...WIN2, ...HIT2, 'al_breakB', 'al_breakB_big', 'al_breakD', 'al_breakD_big', 'al_rollC', 'al_rollE');
// JP成功の音: 配当の段(0:30玉 1:40 2:100 3:200 4:500)ごとの候補。同じ段でも毎回ちがう変種を選ぶ(直前と同じものは避ける)
const WIN_POOL = [['P0', 'P1', 'P2', 'M0'], ['M0', 'M1', 'P2', 'E0'], ['J0', 'J1', 'J2', 'E1', 'M2'], ['T0', 'T1', 'R0', 'E2'], ['O0', 'O1', 'R1', 'T1', 'first']].map(a => a.map(n => 'al_win_' + n));
const WIN_CHAIN_POOL = ['al_win_O0', 'al_win_T1', 'al_win_E0', 'al_win_R1', 'al_win_J1', 'al_win_chain'];
// JPチャンスの「テーマ」(入賞の衝撃・鎖の爆発・ルーレットの回転の音色の組)。メーターごとに変える
const THEMES = { A: { hit: k => 'al_hit_' + k, brk: b => b ? 'al_break_big' : 'al_break', roll: 'al_roll' }, B: { hit: k => 'al_hitB_' + k, brk: b => b ? 'al_breakB_big' : 'al_breakB', roll: 'al_rollC' },
  C: { hit: k => 'al_hitC_' + k, brk: b => b ? 'al_breakB_big' : 'al_breakB', roll: 'al_rollC' }, D: { hit: k => 'al_hitD_' + k, brk: b => b ? 'al_breakD_big' : 'al_breakD', roll: 'al_rollE' } };
// 段ごとの既存音(JP本編・JP後・新演出の音。hot 経由)の増幅[dB]。段0=素通し
const TIER_GAIN = [0, 1.0, 3.0, 8.0];
// 新しい音の段ごとの出口レベル
const TIER_MAKEUP = [0, 0, 1.0, 1.5];   // リミッターの後の上乗せ[dB]。最後の天井(tanh)の手前いっぱいまで使い、平均を上げる
const SFX_LEVEL = { tension: 0.9, hit: 1.0, break: 1.0, roll: 0.85, win: 1.0 };

export async function installAudioLift(engine, { lcd, controller, base = new URL('../audiolift_1031/sfx/', import.meta.url), params = {} } = {}) {
  const q = new URLSearchParams(globalThis.location?.search ?? '');
  const P = { tier: TIER_GAIN, makeup: TIER_MAKEUP, sfx: 1, pre: -12, thr: -11, ...params };
  const ctx = engine.ctx, now = () => ctx.currentTime;
  const buffers = {}, missing = [];
  await Promise.all(FILES.map(async n => { try { const r = await fetch(new URL(n + '.ogg', base)); if (!r.ok) throw Error('HTTP ' + r.status); buffers[n] = await ctx.decodeAudioData(await r.arrayBuffer()); } catch (e) { missing.push(n); } }));

  // ---- 配線: hot → [段の増幅] → ( 素通し | 低域の厚み → リミッター ) → master ----
  const hot = hotBus(engine);
  try { hot.disconnect(engine.master); } catch { }
  const tierGain = ctx.createGain(); tierGain.gain.value = 1;
  const dry = ctx.createGain(), wet = ctx.createGain(); dry.gain.value = 1; wet.gain.value = 0;
  const lowShelf = ctx.createBiquadFilter(); lowShelf.type = 'lowshelf'; lowShelf.frequency.value = 110; lowShelf.gain.value = 2.5;
  const presence = ctx.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 2600; presence.Q.value = .7; presence.gain.value = 1.5;
  // hot の出口は master(0.45)と最後の天井(tanh)の手前なので、強い音は 0dBFS を超えている(+3〜+6dB)。リミッターは DynamicsCompressor の閾値(最大0dB)の都合で、
  // 前で PRE だけ絞り、後で戻す。小さい音での利得(自動メイクアップ込み)は起動時に OfflineAudioContext で測って打ち消す(calibrate)。
  const wetPre = ctx.createGain(); wetPre.gain.value = dB(P.pre);
  const limiter = ctx.createDynamicsCompressor(); limiter.threshold.value = P.thr; limiter.knee.value = 3; limiter.ratio.value = 20; limiter.attack.value = .002; limiter.release.value = .09;
  const wetTrim = ctx.createGain(); wetTrim.gain.value = dB(-P.pre);
  const makeup = ctx.createGain(); makeup.gain.value = 1;
  const sfxIn = ctx.createGain(); sfxIn.gain.value = 1;                    // 新しい音の入口(段の増幅は受けない)
  const out = ctx.createGain(); out.gain.value = 1;
  hot.connect(tierGain); tierGain.connect(dry).connect(out); tierGain.connect(wetPre).connect(lowShelf).connect(presence).connect(limiter).connect(wetTrim).connect(makeup).connect(wet).connect(out);
  sfxIn.connect(wetPre);                                                    // 新しい音もリミッターを通す
  out.connect(engine.master);

  async function calibrate() {   // 小さい音(-50dBFS)の経路利得を測り、打ち消して「素通しと同じ大きさ」から始める
    try {
      const oc = new OfflineAudioContext(1, 24000, 48000), b = oc.createBuffer(1, 24000, 48000), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * 600 * i / 48000) * dB(-50);
      const s = oc.createBufferSource(); s.buffer = b; const l = oc.createBiquadFilter(); l.type = 'lowshelf'; l.frequency.value = 110; l.gain.value = lowShelf.gain.value;
      const p = oc.createBiquadFilter(); p.type = 'peaking'; p.frequency.value = 2600; p.Q.value = .7; p.gain.value = presence.gain.value;
      const c = oc.createDynamicsCompressor(); c.threshold.value = limiter.threshold.value; c.knee.value = limiter.knee.value; c.ratio.value = limiter.ratio.value; c.attack.value = limiter.attack.value; c.release.value = limiter.release.value;
      const g = oc.createGain(); g.gain.value = dB(P.pre); s.connect(g).connect(l).connect(p).connect(c).connect(oc.destination); s.start();
      const r = (await oc.startRendering()).getChannelData(0); let ss = 0, n = 0; for (let i = 12000; i < r.length; i++) { ss += r[i] * r[i]; n++; }
      const gain = 10 * Math.log10(ss / n * 2) + 50;   // 経路の小信号利得[dB]
      wetTrim.gain.value = dB(-gain); P.calib = +gain.toFixed(2);
    } catch (e) { P.calib = null; }
  }
  await calibrate();
  const st = { theme: 'A', lastTheme: 'A', lastWin: {}, tier: 0, winUntil: 0, lastSfx: -99, drone: null, pulseAt: Infinity, rollSrc: null, rollG: null, meterId: null, log: [], played: 0, ev: {}, scenes: new Set() };
  const log = (name, db = 0, extra) => { st.log.push({ t: +now().toFixed(3), name, db, tier: st.tier, ...extra }); if (st.log.length > 500) st.log.shift(); };
  function setTier(t) {
    if (t === st.tier) return; const old = st.tier; st.tier = t; const n = now();
    tierGain.gain.cancelScheduledValues(n); tierGain.gain.setValueAtTime(tierGain.gain.value, n); tierGain.gain.linearRampToValueAtTime(dB(P.tier[t] ?? 0), n + .12);
    makeup.gain.cancelScheduledValues(n); makeup.gain.setValueAtTime(makeup.gain.value, n); makeup.gain.linearRampToValueAtTime(dB(P.makeup[t] ?? 0), n + .12);
    ls(t > 0); log('tier ' + old + '→' + t);
  }
  function ls(on) {   // 段0は完全に素通し(リミッターを通らない)。クロスフェード
    const n = now(), a = on ? 0 : 1, b = on ? 1 : 0;
    for (const [g, v] of [[dry.gain, a], [wet.gain, b]]) { g.cancelScheduledValues(n); g.setValueAtTime(g.value, n); g.linearRampToValueAtTime(v, n + (on ? .05 : .4)); }
  }

  // ---- 発音 ----
  const dur = { }; const sources = new Set();
  function play(name, db = 0, { at = 0, rate = 1, loop = false, out: dst = sfxIn, pan = 0 } = {}) {
    const b = buffers[name]; if (!b || !api.enabled) return null;
    const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate; s.loop = loop;
    const g = ctx.createGain(); g.gain.value = dB(db) * P.sfx; let tail = g;
    if (pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); tail = p; }
    s.connect(g); tail.connect(dst); const t = Math.max(now() + .003, now() + at); s.start(t);
    s.onended = () => { try { s.disconnect(); g.disconnect(); if (tail !== g) tail.disconnect(); } catch { } sources.delete(s); };
    s._g = g; sources.add(s); st.played++; st.lastSfx = now(); log(name, db, at ? { at: +at.toFixed(2) } : undefined); return s;
  }
  function stopSrc(s, fade = .08) { if (!s) return; try { const n = now(); s._g.gain.cancelScheduledValues(n); s._g.gain.setValueAtTime(s._g.gain.value, n); s._g.gain.linearRampToValueAtTime(0, n + fade); s.stop(n + fade + .02); } catch { } }
  // BGMの瞬間ダッキング。JP中は bgm.userGain の操作が JP曲側へ振り替えられる(jp_audio_v5)ので、after_jp と同じ呼び方で JP曲が沈む
  function duck(depthDb, hold = .25, release = .6, at = 0) {
    const bgm = engine.bgm, p = bgm?.userGain?.gain, inJp = !!globalThis.__jpAudio?.state?.inJp; if (!p || (!inJp && (!bgm.enabled || bgm.muted))) return;
    const v = bgm.volume, t = now() + at; p.cancelScheduledValues(t); p.setTargetAtTime(v * dB(-depthDb), Math.max(now(), t - .02), .008); p.setTargetAtTime(v, t + hold, release / 3);
  }

  // ---- 緊張の層(JPチャンス中、時間が減るほど高まる) ----
  const droneLP = ctx.createBiquadFilter(); droneLP.type = 'lowpass'; droneLP.frequency.value = 260; droneLP.Q.value = .5; droneLP.connect(sfxIn);
  function tensionStart() {
    if (st.drone || !buffers.al_drone) return;
    const s = ctx.createBufferSource(); s.buffer = buffers.al_drone; s.loop = true; const g = ctx.createGain(); g.gain.value = 0; s.connect(g).connect(droneLP); s.start(now() + .005);
    st.drone = { s, g }; st.pulseAt = now() + .4; log('tension start');
  }
  function tensionStop(fade = .4) {
    const d = st.drone; if (!d) return; st.drone = null; st.pulseAt = Infinity; const n = now();
    try { d.g.gain.cancelScheduledValues(n); d.g.gain.setValueAtTime(d.g.gain.value, n); d.g.gain.linearRampToValueAtTime(0, n + fade); d.s.stop(n + fade + .05); } catch { } log('tension stop');
  }
  function tensionTick(m) {   // m = controller.game.meter(firing 中)
    const d = st.drone; if (!d) return; const n = now();
    const total = Math.max(1, m.seconds || 12), u = Math.min(1, Math.max(0, 1 - (m.timeLeft ?? total) / total));   // 0→1
    const prog = m.threshold > 0 ? Math.min(1, m.count / m.threshold) : 0;
    const k = Math.max(u, prog * .8);
    const db = -26 + 20 * Math.pow(k, 1.4);                                                    // -26 → -6 dB
    d.g.gain.setTargetAtTime(dB(db), n, .12); d.s.playbackRate.setTargetAtTime(1 + .09 * u, n, .2);
    droneLP.frequency.setTargetAtTime(220 + 1400 * Math.pow(k, 1.3), n, .15);
    if (n >= st.pulseAt) {   // 脈動:ゆっくり → 速く(1.1秒 → 0.36秒)、強まる
      const per = 1.1 - .74 * Math.pow(u, 1.15); play(k > .55 ? 'al_pulse2' : 'al_pulse1', -17 + 12 * k, { rate: 1 + .12 * u }); st.pulseAt = n + per;
    }
    if ((m.timeLeft ?? 99) <= 3.6 && !st.riserDone) { st.riserDone = true; play('al_riser', -9); duck(2.5, 3.2, .6); }
  }

  // ---- 場面名(封印の扉の鎖・扉) ----
  let lastScene = '';
  function sceneTick() {
    const jp = lcd?.jp; const w = jp?.active ? jp.where() : null; if (!w) { lastScene = ''; return; }
    const key = w.name + '#' + w.serial; if (key === lastScene) return; lastScene = key;
    const m = /^jp_aim_seal_d\d_(b\d|open)$/.exec(w.name);
    if (m) {
      if (m[1] === 'open') { play(THEMES[st.theme].brk(true), -2, { at: .8333 }); play('al_door', 0, { at: .9333 }); duck(7, 1.4, 1.2, .8); }
      else { const k = +m[1].slice(1); play(THEMES[st.theme].brk(k >= 3), -1 + k * .5, { at: k === 1 ? .4667 : .4 }); duck(5, .6, .8, k === 1 ? .45 : .38); }
    }
  }

  function pickTheme(chain) {   // 前回と違うテーマ(継続のメーターは最初のJPとも違う色にする)
    const names = Object.keys(THEMES).filter(n => n !== st.theme); st.theme = names[(Math.random() * names.length) | 0]; st.ev.theme = st.theme; log('theme ' + st.theme);
  }
  function pickWin(tier, chain) {
    const pool = (chain ? WIN_CHAIN_POOL : WIN_POOL[tier]).filter(n => buffers[n]); if (!pool.length) return chain ? 'al_win_chain' : 'al_win_first';
    const key = chain ? 'chain' : tier, last = st.lastWin[key]; const c = pool.filter(n => n !== last); const pick = c[(Math.random() * c.length) | 0] ?? pool[0]; st.lastWin[key] = pick; return pick;
  }

  // ---- ルーレット ----
  function rouletteStartRoll(e) {
    if (st.rollSrc) return; if (!buffers[THEMES[st.theme].roll]) return;
    const total = Math.max(2, e.autoStopSeconds || 8), n = now();
    const s = play(THEMES[st.theme].roll, -30, { loop: true }); if (!s) return; st.rollSrc = s; const g = s._g.gain;
    g.cancelScheduledValues(n); g.setValueAtTime(dB(-30), n); g.exponentialRampToValueAtTime(dB(-9), n + total); s.playbackRate.setValueAtTime(.9, n); s.playbackRate.linearRampToValueAtTime(1.3, n + total);
  }
  function rouletteStopRoll(fade = .05) { stopSrc(st.rollSrc, fade); st.rollSrc = null; }

  // ---- 規則のイベント ----
  const offs = [];
  if (controller?.onAction) offs.push(controller.onAction(act => {
    const e = controller.lastGameEvent; if (!e || e.type !== act) return;
    const jpish = e.kind === 'jp' || e.kind === 'chain';
    if (act === 'meterReady' && jpish) { st.riserDone = false; setTier(1); pickTheme(e.kind === 'chain'); }
    else if (act === 'meterStart' && jpish) { setTier(1); tensionStart(); }
    else if (act === 'meterLand' && jpish && e.hit) {
      const th = Math.max(1, e.threshold || 4), stage = Math.max(1, Math.min(4, Math.ceil(4 * e.count / th))); st.ev.hits = (st.ev.hits ?? 0) + 1;
      play(THEMES[st.theme].hit(stage), 0 + (stage - 1) * .5); duck(2 + stage * 1.2, .16 + .04 * stage, .5);
    }
    else if (act === 'meterEnd' && jpish) { tensionStop(.25); if (!e.success) { st.riserDone = false; setTier(0); } }
    else if (act === 'rouletteStart' && jpish) { setTier(2); st.ev.rouTier = e.tier; rouletteStartRoll(e); }
    else if (act === 'rouletteStopPress' && jpish) { rouletteStopRoll(.04); play('al_press', 0); duck(6, 1.1, .7); }
    else if (act === 'rouletteStopped' && jpish) {
      const first = e.kind === 'jp', tier = Math.max(0, Math.min(4, e.tier | 0));
      const name = pickWin(tier, !first), len = buffers[name]?.duration ?? 8;
      setTier(3); st.winUntil = now() + Math.max(10, len + 3);
      play(name, 2); if (tier >= 2) play('al_promo_' + tier, -4, { at: .12 }); duck(10, 1.6, 1.4); st.ev.wins = (st.ev.wins ?? 0) + 1; st.ev.lastWin = name;
    }
  }));

  // ---- 段の見張り(状態の変わり目の取りこぼし防止・終了検知) ----
  function tick() {
    const g = controller?.game; if (!g) return; const n = now(), m = g.meter, r = g.roulette;
    if (m && (m.kind === 'jp' || m.kind === 'chain') && m.stage === 'firing') tensionTick(m);
    else if (st.drone && !(m && m.stage === 'firing')) tensionStop(.3);
    if (!r && st.rollSrc) rouletteStopRoll(.1);
    if (st.tier === 3 && n > st.winUntil && !r) setTier(0);
    else if (st.tier === 1 && !m && !r && !lcd?.jp?.active) setTier(0);
    else if (st.tier === 2 && !r && !m) setTier(st.winUntil > n ? 3 : 0);
    sceneTick();
  }
  const timer = setInterval(() => { if (ctx.state !== 'running') return; try { tick(); } catch (e) { if (!api.error) { api.error = e.message; console.error('[audio-lift]', e); } } }, 16);
  const api = { enabled: true, version: '1031.1', st, log: st.log, missing, buffers, play, duck, setTier, params: P, nodes: { makeup, wetPre, tierGain, dry, wet, limiter, wetTrim, lowShelf, presence, sfxIn, out },
    dispose() { clearInterval(timer); offs.forEach(f => { try { f(); } catch { } }); tensionStop(.05); rouletteStopRoll(.05); for (const s of sources) try { s.stop(); } catch { } try { out.disconnect(); hot.disconnect(); hot.connect(engine.master); } catch { } } };
  console.info('[audio-lift] ready', Object.keys(buffers).length, 'sfx', missing.length ? 'MISSING ' + missing.join(',') : '');
  return api;
}
