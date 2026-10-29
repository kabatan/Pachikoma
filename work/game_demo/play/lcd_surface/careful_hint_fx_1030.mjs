// 10/30 慎重な客への助言の場面の「囲いの光」と「効果音」。どちらも既存の仕組みに足すだけ（光＝cabinet_light_script の newlight 文法、音＝r2 エンジンの hotBus に WebAudio で合成）。
// 光：明るく優しい色（クリーム・桃・水色）をゆっくり呼吸させる。4コマ未満の点滅なし（連打の拍は 3Hz）。電飾の口（穴の7つ）は、やわらかい白で呼吸させる。
// 音：短い（約2.8秒）。やさしい鈴 →（字が出る瞬間）ぽん ×2 → 連打の軽いタップ。声はなし。
import { registerGrammar } from '../../../effects/cabinet_light_script/flash_fx_20261029.mjs';
import { NL_SCENES } from '../../../effects/cabinet_light_script/newlight_1030.mjs';
import { hotBus } from '../../../audio/runtime/hot_bus.mjs';
import { BEAT, SECONDS } from './careful_hint_1030.mjs';

const TAU = Math.PI * 2, clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const CREAM = [1, .86, .62], PINK = [1, .58, .78], AQUA = [.45, .92, 1], LAV = [.78, .7, 1];
const mixc = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const reg = (o, i, L, c) => { o.aK[i] = L; o.aC[i * 3] = c[0]; o.aC[i * 3 + 1] = c[1]; o.aC[i * 3 + 2] = c[2]; };
const flash = (t, at, d = .14) => t >= at ? Math.exp(-(t - at) / d) : 0;
function advice(o, c) {
  const t = c.t, ck = c.clock;
  o.abs = true; o.holeOn = false; o.hv.fill(0); o.aK.fill(0); for (let j = 0; j < 4; j++) o.aR[j] = 0; o.gain = 1; o.white = 0; o.floor = 0;
  const env = clamp(t / 0.25) * clamp((SECONDS - t) / 0.4), br = .7 + .18 * Math.sin(TAU * 1.1 * ck);   // ゆっくり呼吸
  const sw = .5 + .5 * Math.sin(TAU * 0.8 * ck);   // 桃と水色がゆっくり入れ替わる
  const beat = t >= BEAT.smash ? .5 + .5 * Math.sin(TAU * 3 * (t - BEAT.smash)) : 0;   // 連打の拍（3Hz）
  reg(o, 0, env * br * 1.05, CREAM); reg(o, 1, env * br, mixc(PINK, LAV, sw)); reg(o, 2, env * br * 1.1, mixc(AQUA, CREAM, .3));
  reg(o, 3, env * br * (1 + .2 * beat), mixc(PINK, AQUA, sw)); reg(o, 4, env * br * (1 + .25 * beat), mixc(PINK, AQUA, sw));
  reg(o, 5, env * br * (1 + .2 * beat), mixc(AQUA, PINK, sw)); reg(o, 6, env * br * (1 + .25 * beat), mixc(AQUA, PINK, sw));
  reg(o, 7, env * (.8 + .3 * beat), CREAM);
  for (let j = 0; j < 4; j++) o.aR[j] = env * (.18 + .08 * Math.sin(TAU * 1.1 * ck - j * .8));
  o.white = Math.max(flash(t, 0, .2) * .35, flash(t, BEAT.line1) * .3, flash(t, BEAT.line2) * .25) * env;
  o.holeOn = true; for (let h = 0; h < 7; h++) { const L = env * (.55 + .3 * Math.sin(TAU * 1.1 * ck - h * .5)); o.hv[h * 3] = 1 * L; o.hv[h * 3 + 1] = .92 * L; o.hv[h * 3 + 2] = .78 * L; }
  o.sOv = true; o.sc[0] = 1; o.sc[1] = .82; o.sc[2] = .86;   // 外部LED帯はやさしい桃色
}
registerGrammar('nl_careful', advice);
NL_SCENES.careful_hint = 'nl_careful';

/** 場面が始まるときに1回呼ぶ（engine = r2 のエンジン）。約2.8秒の短い音。engine が無ければ何もしない */
export function playAdviceSfx(engine) {
  try {
    const ctx = engine?.ctx; if (!ctx) return false;
    const out = ctx.createGain(); out.gain.value = 10 ** (-13 / 20); out.connect(hotBus(engine));
    const t0 = ctx.currentTime + 0.03;
    const tone = (f, at, dur, { type = 'sine', g = 1, f2 = null, atk = 0.004 } = {}) => {
      const o = ctx.createOscillator(), e = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f, t0 + at); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + at + dur * .6);
      e.gain.setValueAtTime(0, t0 + at); e.gain.linearRampToValueAtTime(g, t0 + at + atk); e.gain.exponentialRampToValueAtTime(0.0008, t0 + at + dur);
      o.connect(e).connect(out); o.start(t0 + at); o.stop(t0 + at + dur + 0.05); o.onended = () => { try { o.disconnect(); e.disconnect(); } catch { } };
    };
    // 場面に入る：やさしい鈴（E6 → B6、倍音つき）
    tone(1318.5, 0.0, 0.7, { g: .55 }); tone(2637, 0.0, 0.35, { g: .18 }); tone(1975.5, 0.11, 0.8, { g: .5 }); tone(3951, 0.11, 0.4, { g: .15 });
    // 字が出る：ぽん（1行目は低め・2行目はすこし高く）
    tone(330, BEAT.line1, 0.22, { type: 'triangle', g: .9, f2: 150 }); tone(660, BEAT.line1, 0.12, { g: .35 });
    tone(392, BEAT.line2, 0.2, { type: 'triangle', g: .8, f2: 190 }); tone(988, BEAT.line2, 0.14, { g: .3 });
    // 連打：軽いタップ（0.1秒おき・だんだん小さく）
    for (let k = 0; k < 10; k++) tone(880 * (k % 2 ? 1.12 : 1), BEAT.smash + 0.03 + k * 0.1, 0.07, { type: 'triangle', g: .42 * (1 - k * .05) });
    // 終わり：きらっ
    tone(2349, SECONDS - 0.5, 0.35, { g: .25 }); tone(3136, SECONDS - 0.42, 0.4, { g: .2 });
    setTimeout(() => { try { out.disconnect(); } catch { } }, 4500);
    return true;
  } catch (e) { console.warn('[careful-sfx]', e); return false; }
}
