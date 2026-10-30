// 10/30 初見の客向けの小さな配慮（first_timer_1030.mjs）の「囲いの光」と「効果音」。どちらも既存の仕組みに足すだけ。
// 光：cabinet_light_script の newlight 文法（registerGrammar + NL_SCENES）。穴のLEDだけの演出は cabinet_light_script の holeOverlay（first_timer_1030.mjs が渡す）。
// 音：careful_hint_fx_1030.mjs と同じく r2 エンジンの hotBus へ WebAudio で合成（素材なし・声なし）。
import { registerGrammar, hsvTo } from '../../../effects/cabinet_light_script/flash_fx_20261029.mjs';
import { NL_SCENES } from '../../../effects/cabinet_light_script/newlight_1030.mjs';
import { hotBus } from '../../../audio/runtime/hot_bus.mjs';

const TAU = Math.PI * 2, clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
export const PRAISE_SECONDS = 0.8;
const tmp = new Float32Array(3);
const reg = (o, i, L, h) => { hsvTo(tmp, 0, h); o.aK[i] = L; o.aC[i * 3] = tmp[0]; o.aC[i * 3 + 1] = tmp[1]; o.aC[i * 3 + 2] = tmp[2]; };

// 初めての入賞：囲いと穴を虹色に（0.8秒）。色は 3Hz で回る（4コマ未満の点滅なし）、頭に白い閃き
function firstLamp(o, c) {
  const t = c.t, ck = c.clock;
  o.abs = true; o.holeOn = false; o.hv.fill(0); o.aK.fill(0); for (let j = 0; j < 4; j++) o.aR[j] = 0; o.gain = 1; o.white = 0; o.floor = 0;
  const env = clamp(t / 0.06) * clamp((PRAISE_SECONDS - t) / 0.25), hue = ck * 1.6;
  for (let i = 0; i < 8; i++) reg(o, i, env * (1.25 + .3 * Math.sin(TAU * 3 * ck - i * .7)), hue + i / 8);
  for (let j = 0; j < 4; j++) o.aR[j] = env * .45;
  o.white = Math.exp(-t / .1) * .8;
  o.holeOn = true; for (let h = 0; h < 7; h++) { hsvTo(tmp, 0, hue * 1.3 + h / 7); const L = env * (1.1 + .5 * Math.sin(TAU * 3 * ck - h)); o.hv[h * 3] = tmp[0] * L; o.hv[h * 3 + 1] = tmp[1] * L; o.hv[h * 3 + 2] = tmp[2] * L; }
  o.sOv = true; hsvTo(tmp, 0, hue); o.sc[0] = tmp[0]; o.sc[1] = tmp[1]; o.sc[2] = tmp[2];
}
registerGrammar('nl_first_lamp', firstLamp);
NL_SCENES.first_lamp = 'nl_first_lamp';

// ---- 音 ----
function voice(engine, vol = -13) {
  const ctx = engine?.ctx; if (!ctx) return null;
  const out = ctx.createGain(); out.gain.value = 10 ** (vol / 20); out.connect(hotBus(engine));
  const t0 = ctx.currentTime + 0.03;
  const tone = (f, at, dur, { type = 'sine', g = 1, f2 = null, atk = 0.004 } = {}) => {
    const o = ctx.createOscillator(), e = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f, t0 + at); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + at + dur * .6);
    e.gain.setValueAtTime(0, t0 + at); e.gain.linearRampToValueAtTime(g, t0 + at + atk); e.gain.exponentialRampToValueAtTime(0.0008, t0 + at + dur);
    o.connect(e).connect(out); o.start(t0 + at); o.stop(t0 + at + dur + 0.05); o.onended = () => { try { o.disconnect(); e.disconnect(); } catch { } };
  };
  setTimeout(() => { try { out.disconnect(); } catch { } }, 4000);
  return tone;
}
const safe = (fn) => (engine) => { try { return !!fn(engine); } catch (e) { console.warn('[first-timer-sfx]', e); return false; } };
/** 初めての入賞：上がっていくきらきらのファンファーレ（約0.9秒） */
export const playPraiseSfx = safe((engine) => {
  const tone = voice(engine, -9); if (!tone) return false;
  [784, 988, 1175, 1568].forEach((f, i) => { tone(f, i * 0.085, 0.38, { type: 'triangle', g: .6 }); tone(f * 2, i * 0.085, 0.22, { g: .2 }); });
  tone(2093, 0.38, 0.5, { g: .35 }); tone(3136, 0.4, 0.5, { g: .2 }); tone(392, 0, 0.3, { type: 'triangle', g: .55, f2: 330 });
  return true;
});
/** 小さな知らせ（うぱの声かけ・あと1つ）：やさしい二音 */
export const playChimeSfx = safe((engine) => {
  const tone = voice(engine, -15); if (!tone) return false;
  tone(1318.5, 0, 0.5, { g: .5 }); tone(1760, 0.1, 0.55, { g: .45 }); tone(2637, 0.1, 0.3, { g: .12 });
  return true;
});
/** あと1つ！：ぴこん（上がる） */
export const playOneMoreSfx = safe((engine) => {
  const tone = voice(engine, -13); if (!tone) return false;
  tone(880, 0, 0.18, { type: 'triangle', g: .7 }); tone(1318.5, 0.1, 0.18, { type: 'triangle', g: .7 }); tone(1760, 0.2, 0.5, { type: 'triangle', g: .7 }); tone(3520, 0.2, 0.3, { g: .15 });
  return true;
});
/** 初めての重複：ぽこぽこぽこ（3回の低めの音）＝赤い点滅と同期 */
export const playDupSfx = safe((engine) => {
  const tone = voice(engine, -14); if (!tone) return false;
  for (let k = 0; k < 3; k++) tone(440, k * 0.28, 0.14, { type: 'triangle', g: .6, f2: 300 });
  return true;
});
/** あと1本だった：おしい、の下がる二音 */
export const playNearMissSfx = safe((engine) => {
  const tone = voice(engine, -14); if (!tone) return false;
  tone(659, 0, 0.3, { type: 'triangle', g: .6 }); tone(494, 0.2, 0.55, { type: 'triangle', g: .6, f2: 440 });
  return true;
});
