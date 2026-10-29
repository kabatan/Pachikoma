// JP本編のあとの音(継続のつなぎ/選択/継続チャンス/成功/失敗/確定/時間切れ→追加/最終リザルト)。声なし。
// 映像の出来事のコマ(30fps)で一撃を鳴らし、常時鳴る層は作らない。対応表は game_sfx_1029/after_jp/cues_after_jp_1029.json。
// 状態は lcd.jp.model.where()・lcd.choiceV20・controller.game.phase・lcd.finalResultSurface を読むだけ(液晶/規則は変更しない)。
// 通常時の音(launch/lamp/ticket/start/attract/warn10/tray)と JP 本編の音(jp_audio)には触らない。
import { hotBus } from './hot_bus.mjs';
const dB = x => 10 ** (x / 20);
export async function installAfterJpSound(engine, { lcd, controller, cuesUrl = new URL('../game_sfx_1029/after_jp/cues_after_jp_1029.json', import.meta.url), level = .38 } = {}) {
  const cues = await (await fetch(cuesUrl)).json();
  const ctx = engine.ctx, base = cuesUrl;
  const out = ctx.createGain(); out.gain.value = level; out.connect(hotBus(engine));   // 圧縮機の後の専用出口(hot_bus.mjs)
  const buffers = {}, log = [];
  const decode = async u => ctx.decodeAudioData(await (await fetch(u)).arrayBuffer());
  const used = new Set(); const scan = o => { if (Array.isArray(o)) { if (typeof o[0] === 'string') used.add(o[0]); o.forEach(scan); } else if (o && typeof o === 'object') { if (typeof o.s === 'string') used.add(o.s); Object.values(o).forEach(scan); } };
  scan(cues.macros); scan(cues.scenes); scan(cues.choice); scan(cues.timeup); scan(cues.result);
  const files = new Map(); for (const [k, v] of Object.entries(cues.bank)) files.set(k, new URL(v, base).href); for (const [k, v] of Object.entries(cues.ext ?? {})) files.set(k, new URL(v, base).href); for (const n of cues.new) files.set(n, new URL(`sfx/${n}.wav`, base).href);   // ext = JP第5版の部品(bankTrimなし)
  const need = [...files.keys()].filter(k => cues.macros[k] === undefined);
  await Promise.all(need.map(async n => { try { buffers[n] = await decode(files.get(n)); } catch (e) { console.warn('[after-jp] missing', n, e.message); } }));

  const state = { sources: new Set(), sceneSources: new Set() };
  const api = { log, cues, enabled: true, state, played: 0 };
  const now = () => ctx.currentTime;
  function play(name, db = 0, { at = 0, dur = null, fade = .05, rate = 1, stopOnScene = false } = {}, t0 = now() + .004) {
    const b = buffers[name]; if (!b || !api.enabled) return null;
    const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = dB(db + (cues.gainTrim ?? 0) + (cues.bank[name] ? (cues.bankTrim ?? 0) : 0));   // bank=JP v4 の基準(+6.5等)なので、実行側で全体を下げる
    s.connect(g).connect(out);
    const t = Math.max(now(), t0 + at); s.start(t);
    if (dur) { g.gain.setValueAtTime(g.gain.value, t + Math.max(0, dur - fade)); g.gain.linearRampToValueAtTime(0, t + dur); s.stop(t + dur + .02); }
    s.onended = () => { try { s.disconnect(); g.disconnect(); } catch { } state.sources.delete(s); state.sceneSources.delete(s); };
    state.sources.add(s); if (stopOnScene) { state.sceneSources.add(s); s._g = g; }
    log.push({ wall: performance.now() + (t - now()) * 1000, s: name, db: +db.toFixed(1), rate, dur }); if (log.length > 600) log.shift(); api.played++;
    return s;
  }
  function duck(depth, hold, release, t = now()) {
    const bgm = engine.bgm; const p = bgm?.userGain?.gain; if (!p || !bgm.enabled || bgm.muted) return;
    const v = bgm.volume; p.cancelScheduledValues(t); p.setTargetAtTime(v * dB(-depth), Math.max(now(), t - .02), .008); p.setTargetAtTime(v, t + hold, release / 3);
  }
  // 部品名 or 入れ子の macro を再帰展開して鳴らす
  function fire(name, db = 0, o = {}, t0 = now() + .004) {
    const m = cues.macros[name];
    if (!m) return play(name, db, o, t0);
    for (const it of m) { const [n, g = 0, at = 0, dur = null, fade = .05] = it; fire(n, db + g, { ...o, at: (o.at ?? 0) + at, dur: dur ?? o.dur, fade }, t0); }
    const d = cues.duck?.[name]; if (d) duck(d[0], d[1], d[2], t0);
  }
  api.fire = fire; api.play = play;
  const stopScene = () => { for (const s of state.sceneSources) { try { s._g.gain.cancelScheduledValues(now()); s._g.gain.setTargetAtTime(0, now(), .05); s.stop(now() + .25); } catch { } } state.sceneSources.clear(); };
  const item = (it, extra = {}) => { if (it.m) fire(it.m, it.db ?? 0, { rate: it.rate ?? 1 }); else fire(it.s, it.db ?? 0, { dur: it.dur, fade: it.fade, rate: it.rate ?? 1, stopOnScene: !!it.stopOnScene, ...extra }); };

  // 待ちの間(画面は止まっている)に、まばらな一音だけを置く。常時の層ではなく、数秒おきの合図
  const pulse = { key: null, t0: 0, n: 0 };
  function pulseTick(key) {
    const P = key && cues.pulses?.[key]; if (key !== pulse.key) { pulse.key = key; pulse.t0 = performance.now(); pulse.n = 0; }
    if (!P || pulse.n >= P.max) return; const el = (performance.now() - pulse.t0) / 1000;
    if (el >= P.from + P.every * pulse.n) { pulse.n++; for (const [n, d, at = 0] of P.items) play(n, d, { at }); }
  }
  // ---- JP後の場面(lcd.jp) ----
  let jpPulse = null, jpSerial = -1, jpName = null, jpLastF = -1, jpItems = [];
  function jpTick() {
    const jp = lcd.jp; if (!jp?.active) { jpPulse = null; return; }
    const w = jp.where(); if (!w) return; const model = jp.model;
    if (w.serial !== jpSerial || w.name !== jpName) {
      jpSerial = w.serial; jpName = w.name; jpLastF = -1; stopScene();
      let key = w.name.replace(/_d\d$/, '').replace(/^chain_fly_(in|t\d)$/, (m) => m);
      if (key === 'chain_offer') key += model.chainMode ? '@chain' : '@first';
      jpItems = (cues.scenes[key] ?? []).slice();
      if (key === 'chain_confirm') {   // 桁が止まる出来事(f=156-2k)を数に合わせて足す
        const nd = Math.min(5, String(Math.max(0, Math.round(model.earnings ?? 0))).length);
        for (let k = nd - 1; k >= 1; k--) jpItems.push({ f: 156 - 2 * k, s: 'digit_lock' + Math.min(3, 4 - k), db: -2 + (4 - k) });
      }
      api.scene = { key, name: w.name };
    }
    const f = w.f ?? 0; jpPulse = api.scene.key;
    for (const it of jpItems) if (it.f > jpLastF && it.f <= f && (!it.ifChain || (model.resultChain ?? 1) > 1)) item(it);
    jpLastF = Math.max(jpLastF, f);
  }

  // ---- 継続/確定の選択画面 ----
  let chActive = false, chSel = 'neutral', chEv = 0, chN = null;
  function choiceTick() {
    const c = lcd.choiceV20; if (!c) return; const g = controller.game;
    for (const e of c.events) if (e.at > chEv) { chEv = e.at; if (e.kind === 'commit' && e.accepted !== false) for (const [n, d] of cues.choice['commit_' + e.state] ?? []) fire(n, d); }   // 決定の瞬間は画面が切り替わるので、先に拾う
    if (c.active !== chActive) {
      chActive = c.active; chSel = c.selected ?? 'neutral'; chN = Math.ceil(g.choiceLeft ?? 12);
      if (chActive) for (const [n, d] of cues.choice.in) play(n, d);
      return;
    }
    if (!chActive) return;
    const sel = c.selected ?? 'neutral';
    if (sel !== chSel) { chSel = sel; for (const [n, d] of cues.choice['pick_' + sel] ?? []) fire(n, d); }
    const left = g.choiceLeft; if (Number.isFinite(left)) {
      const n = Math.ceil(left);
      if (n !== chN && n < chN) {   // 秒が変わるたび(≤10だけ)。数が小さいほど強く
        const th = cues.choice.tick, pick = n <= 0 ? th['0'] : n <= 3 ? th['3'] : n <= 5 ? th['5'] : n <= 10 ? th['10'] : null;
        if (pick) play(pick[0], pick[1]);
      }
      chN = n;
    }
  }

  // ---- 時間切れ→追加→終了 ----
  let phase = null, offerN = null, tuPulse = null;
  function phaseTick() {
    const g = controller.game, p = g.phase, T = cues.timeup;
    if (p !== phase) {
      const prev = phase; phase = p;
      if (p === 'Continue' && prev !== 'StaffWait') { offerN = Math.ceil(g.offerLeft ?? 30); for (const [n, d] of T.enter) fire(n, d); }
      else if (p === 'StaffWait') { for (const [n, d] of T.staffwait) fire(n, d); }
      else if (prev === 'StaffWait') { for (const [n, d] of T.resume) fire(n, d); }
      else if (prev === 'Continue') { for (const [n, d] of T.end) fire(n, d); }
    }
    tuPulse = p === 'Continue' ? 'continue' : p === 'StaffWait' ? 'staffwait' : null;
    if (p === 'Continue' && Number.isFinite(g.offerLeft)) {
      const n = Math.ceil(g.offerLeft);
      if (offerN != null && n < offerN && n <= 10 && n >= 1) { const k = n <= 5 ? T.tick5 : T.tick10; play(k[0], k[1]); }
      offerN = n;
    }
  }

  // ---- 最終リザルト(350コマ) ----
  let frActive = false, frLast = -1, frItems = [];
  function resultTick() {
    const fr = lcd.finalResultSurface; if (!fr) return;
    if (fr.active !== frActive) {
      frActive = fr.active; frLast = -1; frItems = [];
      if (frActive) {
        const st = fr.state, R = cues.result; frItems = R.frames.slice();
        const [a, b] = R.meterFrames, v = Math.max(1, Math.min(st.value, st.thresholds.at(-1)));
        for (let i = 1; i < st.thresholds.length; i++) if (st.value >= st.thresholds[i]) frItems.push({ f: Math.round(a + (b - a) * st.thresholds[i] / v * Math.min(1, v / st.thresholds.at(-1)) ), s: 'res_ding' + (i - 1), db: -4 });
        if (st.newRecord) frItems.push({ f: 228, s: 'add_sparkle', db: -9 });
        api.result = { rank: st.rankIndex, value: st.value };
      }
    }
    if (!frActive) return;
    const f = fr.frame; if (f < 0) return;
    for (const it of frItems) if (it.f > frLast && it.f <= f) {
      if (it.s === 'MEDAL') { fire('res_medal' + Math.min(4, Math.max(0, fr.state.rankIndex)), it.db ?? 0); duck(7, .3, .9); } else item(it);
    }
    frLast = Math.max(frLast, f);
  }

  const timer = setInterval(() => { if (ctx.state !== 'running') return; try { jpTick(); choiceTick(); phaseTick(); resultTick(); pulseTick(tuPulse ?? jpPulse); } catch (e) { if (!api.error) { api.error = e.message; console.error('[after-jp]', e); } } }, 12);
  api.dispose = () => { clearInterval(timer); stopScene(); out.disconnect(); };
  return api;
}
