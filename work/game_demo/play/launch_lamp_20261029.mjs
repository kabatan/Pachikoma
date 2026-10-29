// 発射口の「打てる/打てない」の表示と音 (2026-10-29)。見た目は液晶に説明を出さず、射出器のレンズ(LED)と小さな音だけで伝える。
//
//   ready   打てる(通常)                    : 何も足さない(射出器のレンズは元のまま桃)
//   hold    勝負球を待たせている(JPの導入など) : レンズが琥珀色にゆっくり呼吸する。押しは保持される(解けた瞬間に出る)
//   queued  hold 中に押しを受けた            : 琥珀色の速い点滅(「受け付けた」)
//   void    撃てるが今の球は数えない          : レンズが青で点きっぱなし(6灯の勝負球が飛んでいる間。この間に着地した通常球は灯にならず、音も光も出ない)
//   closed  いまは受け付けない                : レンズが赤で点きっぱなし(継続の選択・時間切れ・持ち玉0・精算待ちなど、遊技中だけ)
//   go      hold が解けた直後 0.45 秒         : レンズが緑にひと瞬き＋短い上昇音
//
// 音(全部とても小さい・声なし): 押しが受け付けられない(hold/closed 中)ときの「コッ」、hold が解けた「ピッ・ピ」、
// 規則側が盤上の通常球を取り消した(数えない・手持ちへ戻した)ときの「シュッ」。engine.sfx へ入れるので音量つまみ・消音に従う。
// 規則・物理・演出には触らない。読むだけ(ctrl.game / ctrl.inputLog / ctrl.fireBuffer)。
const PLAYING = new Set(['Ready', 'Flight', 'Effect', 'ChainChoice', 'Continue', 'StaffWait', 'Meter', 'Roulette']);   // Meter/Roulette: H(連打メーター・ルーレット)の局面。G では現れない
export const LAMP_COLORS = { hold: '#ffa200', queued: '#ffc400', closed: '#ff1f1f', void: '#2f8dff', go: '#3dff72' };

/** 純粋関数: いまの状態名。extraHold: 液晶の都合で発射の押しを捨てている間(継続の選択から勝負の映像へ切り替わる瞬間)。 */
export function launchLampMode(ctrl, extraHold = false) {
  const g = ctrl?.game;
  if (!g || !PLAYING.has(g.phase)) return 'ready';
  if (ctrl.confirmFinish) return 'closed';
  if (!g.canAim) return 'closed';
  if (typeof ctrl.fireBlockedReason === 'function' && ctrl.fireBlockedReason()) return 'closed';   // 失敗・確定・配当の演出中など、射出の入口が閉じている間
  if (extraHold) return 'hold';
  const held = typeof g._challengeLaunchHeld === 'function' && !g.canFire && g._challengeLaunchHeld();
  if (held) return ctrl.fireBuffer ? 'queued' : 'hold';
  // 6灯の勝負球が飛んでいる間は、続けて撃った通常球は灯にならない(規則側: Protected+quiet)
  if (g.lampCount === 6 && g.shots?.some(s => s.challenge)) return 'void';
  return 'ready';
}

export function createLaunchLamp({ ctrl, getEngine = () => null, getExtraHold = () => false, now = () => performance.now() / 1000, minHold = 1.2, flashSeconds = 0.45, lockGap = 0.3 } = {}) {
  const view = { mode: 'ready', color: null, alpha: 0, held: 0 };
  const st = { mode: 'ready', since: 0, holdSince: null, flashUntil: -1, lastLock: -9, lastEntry: null, locks: 0, unlocks: 0, recalls: 0, last: [] };
  let noise = null;
  const eng = () => { const e = getEngine(); return e?.ctx && e.ctx.state !== 'closed' ? e : null; };
  const out = e => e.sfx ?? e.master;
  const tone = (e, t, f0, f1, dur, gain, type = 'sine', lp = 4000) => {
    const ctx = e.ctx, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    f.type = 'lowpass'; f.frequency.value = lp;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(out(e)); o.start(t); o.stop(t + dur + 0.02);
    o.onended = () => { try { o.disconnect(); f.disconnect(); g.disconnect(); } catch {} };
  };
  const sound = {
    lock(e) { const t = e.ctx.currentTime + 0.003; tone(e, t, 165, 120, 0.055, 0.07, 'square', 900); tone(e, t + 0.075, 120, 90, 0.07, 0.07, 'square', 800); },
    unlock(e) { const t = e.ctx.currentTime + 0.003; tone(e, t, 1046, 1046, 0.07, 0.05); tone(e, t + 0.085, 1568, 1568, 0.11, 0.05); },
    recall(e) {
      const ctx = e.ctx; if (!noise) { noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.35), ctx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      const t = ctx.currentTime + 0.003, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noise; f.type = 'bandpass'; f.Q.value = 2.2; f.frequency.setValueAtTime(2600, t); f.frequency.exponentialRampToValueAtTime(520, t + 0.3);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      s.connect(f).connect(g).connect(out(e)); s.start(t); s.stop(t + 0.35);
      s.onended = () => { try { s.disconnect(); f.disconnect(); g.disconnect(); } catch {} };
    },
  };
  const play = (name) => { const e = eng(); if (!e) return false; try { sound[name](e); return true; } catch { return false; } };
  const log = (kind, t) => { st.last.push([+t.toFixed(2), kind]); if (st.last.length > 40) st.last.shift(); };
  return {
    view, state: st,
    /** 毎フレーム。 */
    update() {
      const t = now(), mode = launchLampMode(ctrl, getExtraHold());
      if (mode !== st.mode) {
        const wasHold = st.mode === 'hold' || st.mode === 'queued', isHold = mode === 'hold' || mode === 'queued';
        if (isHold && !wasHold) st.holdSince = t;
        if (wasHold && !isHold) {
          // 解けた(打てる状態へ戻った)。長く待たせた時だけ合図を出す(一瞬の切り替わりでは鳴らさない)
          if ((mode === 'ready' || mode === 'void') && st.holdSince != null && t - st.holdSince >= minHold) { st.flashUntil = t + flashSeconds; st.unlocks++; play('unlock'); log('unlock', t); }
          st.holdSince = null;
        }
        st.mode = mode; st.since = t; log(mode, t);
      }
      // 押しが受け付けられなかった(hold/closed 中の発射の押し)→ 「コッ」
      const L = ctrl.inputLog;
      if (L?.length) {
        let i = L.length - 1; const fresh = [];
        while (i >= 0 && L[i] !== st.lastEntry) { fresh.push(L[i]); i--; }
        st.lastEntry = L[L.length - 1];
        for (let k = fresh.length - 1; k >= 0; k--) {
          const x = fresh[k]; if (x.action !== 'fire' || x.fired || ctrl.frame - x.frame > 3) continue;
          if ((st.mode === 'hold' || st.mode === 'queued' || st.mode === 'closed') && t - st.lastLock >= lockGap) { st.lastLock = t; st.locks++; play('lock'); log('lock', t); }
        }
      }
      // レンズの色と強さ
      let color = null, alpha = 0;
      if (t < st.flashUntil) { color = LAMP_COLORS.go; alpha = 0.95 * Math.min(1, (st.flashUntil - t) / flashSeconds + 0.25); }
      else if (st.mode === 'hold') { color = LAMP_COLORS.hold; alpha = 0.6 + 0.35 * Math.sin(t * Math.PI * 2 * 1.1); }
      else if (st.mode === 'queued') { color = LAMP_COLORS.queued; alpha = Math.sin(t * Math.PI * 2 * 4) > 0 ? 0.98 : 0.4; }
      else if (st.mode === 'closed') { color = LAMP_COLORS.closed; alpha = 0.92; }
      else if (st.mode === 'void') { color = LAMP_COLORS.void; alpha = 0.8; }
      view.mode = st.mode; view.color = color; view.alpha = alpha; view.held = st.holdSince == null ? 0 : t - st.holdSince;
      return view;
    },
    /** 規則側が通常球を取り消した(数えない・手持ちへ戻した)。 */
    noteRecall(n = 1) { const t = now(); st.recalls += n; play('recall'); log('recall', t); },
  };
}
