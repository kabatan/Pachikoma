// 10/30 新しい演出の効果音(声なし)。冒頭チュートリアル v06・JPチャンスのチュートリアル・継続告知 v09・封印の扉(JP通し)・待機の煽り・穴の強調・残り時間の警告・連打メーターの警報。
// 音は ../r4_h_sfx_1030/sfx_ogg(一発・ogg)と loops(ループ・wav)。出来事の表は ../r4_h_sfx_1030/cues_r4_h_1030.json(src/cues.py が唯一の定義)。
// play.mjs から installR4Sfx(engine,{lcd,controller}) で読まれ、?newsfx=0 で読まれない(従来の音だけ)。
// 状態は lcd.attractSurface / lcd.jp.model.where() / lcd.timerDisplay.shown / lcd.choiceV20 / controller.game / controller.onAction を読むだけ(液晶・規則は変更しない)。
// JP の音(jp_audio_v5)・JP後の音(after_jp)・通常時の音には触らない。出口は hotBus(圧縮機の後)。
import { hotBus } from './hot_bus.mjs';
const dB = x => 10 ** (x / 20);
const HOLE_X = [46, 214, 394, 576, 746, 924, 1104];
export async function installR4Sfx(engine, { lcd, controller, cuesUrl = new URL('../r4_h_sfx_1030/cues_r4_h_1030.json', import.meta.url), level = null } = {}) {
  const q = new URLSearchParams(globalThis.location?.search ?? '');
  const cues = await (await fetch(cuesUrl)).json();
  const ctx = engine.ctx, root = new URL('./', cuesUrl);
  const out = ctx.createGain(); out.gain.value = level ?? cues.level ?? .45; out.connect(hotBus(engine));
  const loops = new Set(cues.loops ?? []);
  const urlOf = n => cues.ext?.[n] ? new URL(cues.ext[n], cuesUrl).href : loops.has(n) ? new URL(`loops/${n}.wav`, root).href : new URL(`sfx_ogg/${n}.ogg`, root).href;
  // 使う部品を表から集める
  const used = new Set(); const scan = o => { if (Array.isArray(o)) { if (typeof o[1] === 'string' && typeof o[0] === 'number') used.add(o[1]); else if (typeof o[0] === 'string' && typeof o[1] === 'number') used.add(o[0]); o.forEach(scan); } else if (o && typeof o === 'object') Object.values(o).forEach(scan); };
  scan(cues); for (const n of loops) used.add(n); for (const n of Object.values(cues.seal_api ?? {}).flat()) used.add(n);
  for (const n of [...used]) if (n.startsWith('amb:') || typeof n !== 'string') used.delete(n);
  const buffers = {}, missing = [];
  await Promise.all([...used].map(async n => { try { const r = await fetch(urlOf(n)); if (!r.ok) throw Error('HTTP ' + r.status); buffers[n] = await ctx.decodeAudioData(await r.arrayBuffer()); } catch (e) { missing.push(n); } }));
  const api = { cues, enabled: true, log: [], missing, played: 0, state: {}, idleVisual: q.get('sealidle') === '1' };
  const now = () => ctx.currentTime;
  const nodes = new Set();
  const panOf = (p, d) => p === 'hole' ? ((HOLE_X[Math.min(6, Math.max(0, (d | 0) - 1))] ?? 576) - 576) / 576 * .5 : (p || 0);
  // 一発を鳴らす。at=いまからの秒(先取りの予約)
  function play(name, db = 0, { at = 0, pan = 0, rate = 1, bus = out } = {}) {
    const b = buffers[name]; if (!b || !api.enabled) return null;
    const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = dB(db); let n = g;
    if (pan) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); n = p; }
    s.connect(g); n.connect(bus); const t = Math.max(now() + .002, now() + at); s.start(t);
    s.onended = () => { try { s.disconnect(); g.disconnect(); if (n !== g) n.disconnect(); } catch { } nodes.delete(s); };
    nodes.add(s); api.played++; api.log.push({ wall: performance.now() + (t - now()) * 1000, s: name, db, pan }); if (api.log.length > 400) api.log.shift();
    return s;
  }
  api.play = play;
  // ---- 封印の扉:段ごとの環境音(残りN本)。クロスフェードで入れ替える ----
  const amb = { cur: null, rem: null };
  function ambient(rem, db = 0, fade = .2) {
    if (rem != null && amb.cur && amb.rem === rem) return;
    const t = now();
    if (amb.cur) { const { g, s } = amb.cur; try { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + fade); s.stop(t + fade + .05); } catch { } amb.cur = null; }
    amb.rem = rem; if (rem == null) return;
    const b = buffers['sd_amb_r' + rem]; if (!b) return;
    const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(dB(db), t + fade);
    s.connect(g).connect(out); s.start(t); s.onended = () => { try { s.disconnect(); g.disconnect(); } catch { } }; amb.cur = { s, g };
  }
  function ambStop(fade = .3) { ambient(null, 0, fade); }
  api.seal = {
    ambient, stop: ambStop,
    // 鎖が切れる(k=0..N-1。最後は錠)。切れる直前の「きしみ」は strain(k) を ev の 0.55 秒前に
    breakChain: (k, N = 4, db = 0) => play(cues.seal_api.break_[Math.min(3, N === 4 ? k : (k === N - 1 ? 3 : Math.min(2, k)))], db),
    strain: (k, db = -4) => play(cues.seal_api.strain[Math.min(3, k)], db),
    creak: (i = 0, db = -3, pan = 0) => play(cues.seal_api.creaks[i % 3], db, { pan }),
    cutinAto: (rem, db = -2) => play(cues.seal_api.cutin_ato[Math.min(2, Math.max(0, 3 - rem))], db),
    open: (db = -2) => play('sd_door_open', db),
    // JP通し v05 の表をそのまま走らせる(t0=通しの先頭の ctx 時刻)
    run(key = 'seal_through_v05', t0 = now()) { for (const [t, n, db, pan] of cues[key].items) { const at = t0 + t - now(); if (n.startsWith('amb:')) { const r = n.slice(4); setTimeout(() => (r === 'stop' ? ambStop(.4) : ambient(+r, db)), Math.max(0, at * 1000)); } else play(n, db, { at: Math.max(0, at), pan }); } },
  };
  api.idle = { spark: (pan = 0) => play(...cues.idle.spark, { pan }), oshii: (pan = 0) => play(...cues.idle.oshii, { pan }), ireyo: () => play(...cues.idle.ireyo), arrow: () => play(...cues.idle.arrow), pulse: () => play(...cues.idle.pulse) };

  // ---- 時刻表を走らせる(場面・動画の再生時刻に合わせる。1コマ先取りで予約して、ポーリングの揺れを消す) ----
  const AHEAD = 1 / 30;
  function runTrack(track, t, state, d) {
    if (t < state.last - .2) state.last = -1;           // 巻き戻り
    for (const [ti, n, db, pan, rate] of track.items) if (ti > state.last && ti <= t + AHEAD) {
      if (n.startsWith('amb:')) { const r = n.slice(4); if (r === 'stop') ambStop(.4); else ambient(+r, db); } else play(n, db, { at: Math.max(0, ti - t), pan: panOf(pan, d), rate: rate || 1 });
    }
    state.last = Math.max(state.last, t + AHEAD);
  }
  const tState = { attract: { last: -1 }, seal: { last: -1, key: null }, tutorial: { last: -1, on: false }, jp: { last: -1, key: null }, chain: { last: -1, key: null }, jpSerial: -1 };
  function tick() {
    // 冒頭のチュートリアル(attract の howto)
    const as = lcd.attractSurface, ts = tState.tutorial;
    if (as && as.active && as.kind === 'tutorial') { if (!ts.on) { ts.on = true; ts.last = -1; } runTrack(cues.tutorial, as.time, ts); } else ts.on = false;
    // 待機画面 v5c(20.2秒ループ)
    const as2 = tState.attract;
    if (as && as.active && as.kind === 'attract') runTrack(cues.attract, as.time, as2); else as2.last = -1;
    // JP の場面(チュートリアル・継続告知)
    const jp = lcd.jp, w = jp?.active ? jp.where() : null;
    if (!w) { tState.jp.key = null; tState.chain.key = null; tState.seal.key = null; if (amb.cur) ambStop(.3); return; }
    const sm = /^jp_aim_seal_d\d_(in|s\d|b\d|open)$/.exec(w.name);
    if (sm) { const ss = tState.seal, key = w.name + '#' + w.serial; if (ss.key !== key) { ss.key = key; ss.last = -1; } const tr = cues.seal_scenes?.[sm[1]]; if (tr) runTrack({ items: tr }, (w.f ?? 0) / 30, ss, w.d); }
    else if (amb.cur && !/^jp_chance|^jp_rush|^tutorial_jp/.test(w.name)) ambStop(.3);
    const off = cues.tutorial_jp.offsets[w.name];
    if (off !== undefined) {
      const js = tState.jp; if (js.key !== w.name + '#' + w.serial) { js.key = w.name + '#' + w.serial; if (w.name !== 'tutorial_jp_fin' && js.last > 0 && !w.name.startsWith('tutorial_jp_n')) js.last = -1; if (w.name.startsWith('tutorial_jp_n')) js.last = -1; }
      runTrack(cues.tutorial_jp, off + (w.f ?? 0) / 30, js, w.d);
    }
    const ck = cues[w.name];
    if (w.name === 'chain_announce_first' || w.name === 'chain_announce_repeat') {
      const cs = tState.chain; if (cs.key !== w.name + '#' + w.serial) { cs.key = w.name + '#' + w.serial; cs.last = -1; }
      runTrack(ck, (w.f ?? 0) / 30, cs);
    }
  }
  // 継続の選択画面:2/3 の札の叩きつけ(rules_h の BADGE_DELAY .25 + .14 のあと)
  let chActive = false;
  function choiceTick() {
    const c = lcd.choiceV20; if (!c) return;
    if (c.active !== chActive) { chActive = c.active; if (chActive && controller.game?.chainOfferRepeat !== false) { const [n, db, at] = cues.chain_choice.badge; play(n, db, { at }); } }
  }
  // ---- 残り時間 ----
  let lastSec = null;
  function timerTick() {
    const sh = lcd.timerDisplay?.shown; if (!sh) { lastSec = null; return; }
    const s = sh.seconds;
    if (lastSec != null && s < lastSec && s >= 1 && s <= 9) { const it = cues.timer.ticks[String(s)]; if (it) play(it[0], it[1]); }
    lastSec = s;
  }
  // ---- 連打メーター:警報・穴の強調・入賞/外れ ----
  let hintOn = false;   // 慎重な客へのうぱの声かけ(rules_h の mash hint:字のみ)が出た瞬間のやさしい合図
  let alarmAt = 0, hlOn = false, lastHit = 0, idleAt = 0, idleSeq = 0, pulseSrc = null;
  function meterTick() {
    const g = controller.game, m = g?.meter ?? null, t = now();
    const on = !!m && Array.isArray(m.targets) && m.targets.length > 0;
    if (on && !hlOn) { hlOn = true; lastHit = t; idleAt = t; play(...cues.hole.hl_in); }
    if (!on && hlOn) { hlOn = false; if (pulseSrc) { try { pulseSrc.stop(t + .1); } catch { } pulseSrc = null; } }
    const hs = lcd.rulesH?.hint?.state; if (hs && !!hs.active !== hintOn) { hintOn = !!hs.active; if (hintOn) play('tu_pop', -4); }
    const lvl = lcd.rulesH?.alarmLevel?.() ?? 0;
    if (lvl > 0 && t >= alarmAt) { const [n, db, per] = cues.meter_alarm[String(lvl)]; play(n, db); alarmAt = t + per; } else if (lvl === 0) alarmAt = 0;
    if (api.idleVisual && on && m.stage === 'firing') {      // 無入賞 2.5 秒の煽り(映像 parts/idle の部品に合わせる): ireyo → arrow の順、4 秒以上あけ、待つ間は脈動のループ
      if (t - lastHit >= 2.5 && t >= idleAt) { idleAt = t + 4; (idleSeq++ % 2 ? api.idle.arrow : api.idle.ireyo)(); if (!pulseSrc) { pulseSrc = play(...cues.idle.pulse); if (pulseSrc) pulseSrc.loop = true; } }
    }
  }
  let actOff = null;
  if (controller?.onAction) actOff = controller.onAction(act => {
    if (act !== 'meterLand') return; const e = controller.lastGameEvent; if (!e) return;
    const pan = panOf('hole', e.lane);
    lastHit = now(); if (pulseSrc) { try { pulseSrc.stop(now() + .08); } catch { } pulseSrc = null; }
    // 入った個数が増えるほど少し高く(満タンへ向かう上昇感)。count/threshold は規則 H の meterLand のイベントそのまま
    if (e.hit) { const u = Number.isFinite(e.count) && e.threshold > 0 ? Math.min(1, e.count / e.threshold) : 0; play(...cues.hole.hit, { pan, rate: 1 + .26 * u }); api.meterHits = (api.meterHits ?? 0) + 1; }
    else play(...cues.hole.miss, { pan });
  });
  // ---- 既定H:メーター導入・開始・満タン、ルーレットの刻み、ボタン停止、JP確定(衝撃・ブラス・きらめき・余韻)。規則のイベント(controller.onAction)から ----
  let rlNext = 0, cwNext = 0;
  function rouletteTick() {
    const g = controller.game, r = g?.roulette, t = now();
    if (r && r.stage === 'spinning' && r.age >= 0) {
      if (t >= rlNext) {
        const total = Math.max(1, (g.rules?.RouletteAutoStopSeconds ?? 8)), u = Math.min(1, r.age / total), R = cues.roulette;
        const per = R.period[0] + (R.period[1] - R.period[0]) * u * u, rate = R.rate[0] + (R.rate[1] - R.rate[0]) * u;
        play(R.tick[0], R.tick[1] + 5 * u, { rate }); rlNext = t + per;
      }
    } else rlNext = 0;
    const c = lcd.choiceV20;
    if (c?.active && !r) { if (t >= cwNext) { play(cues.choice_wait.tick[0], cues.choice_wait.tick[1]); cwNext = t + cues.choice_wait.period; } } else cwNext = 0;
  }
  let actOff2 = null;
  if (controller?.onAction) actOff2 = controller.onAction(act => {
    const e = controller.lastGameEvent; if (!e || e.type !== act) return;
    const M = cues.meter, C = cues.jp_confirm;
    if (act === 'meterReady') play(...M.ready);
    else if (act === 'meterStart') play(...M.go);
    else if (act === 'meterEnd') { if (e.success) play(...M.max); }
    else if (act === 'rouletteStopPress') { play(...C.press); const sl = Number(e.slideSeconds) || 1.15; play(C.riser[0], C.riser[1], { rate: 1.15 / sl }); }
    else if (act === 'rouletteStopped') { play(...C.stop); play(...(e.kind === 'chain' ? C.chain : C.first)); api.jpHits = (api.jpHits ?? 0) + 1; }
  });
  const timer = setInterval(() => { if (ctx.state !== 'running') return; try { tick(); choiceTick(); timerTick(); meterTick(); rouletteTick(); } catch (e) { if (!api.error) { api.error = e.message; console.error('[r4-sfx]', e); } } }, 12);
  api.dispose = () => { clearInterval(timer); try { actOff?.(); actOff2?.(); } catch { } ambStop(.05); for (const s of nodes) { try { s.stop(); } catch { } } out.disconnect(); };
  return api;
}
