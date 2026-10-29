// Flashy pachinko-style layer on top of the precomputed 30 Hz cabinet light table (2026-10-29, R3).
// One pure function, shared by the 3D cabinet lights (K / Kc) and the physical RGB strip, so both
// flash on exactly the same beats. No allocation: evalFx() fills a caller-owned object.
// Rules of thumb: bright + punchy, never more than ~10 Hz, high rates only for short bursts.
const TAU = Math.PI * 2;
const frac = x => x - Math.floor(x);
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const sq = (x, duty = .5) => frac(x) < duty ? 1 : 0;                  // square wave, 1 during the first `duty` of a cycle
const pulse = (x, decay) => Math.exp(-frac(x) * decay);                 // fast attack, exponential fall once per cycle
const GOLD = [1, .52, .02], RED = [1, .02, .03], PINK = [1, .06, .42], VIOLET = [.42, .04, 1], BLUE = [.05, .3, 1], WHITE = [1, .95, .85], VIOLET_DEEP = [.38, .02, .8];

export function createFx() { return { gain: 1, white: 0, floor: 0, mode: 0, mix: 0, hue: 0, spread: 0, r: 0, g: 0, b: 0, active: false, cDepth: 0, cHz: 0, cSharp: 2, cWave: 1 }; }
// Running light: each cabinet region dims by up to `depth` as a crest travels around the frame at hz (regions are phased by PH in the runtime). cWave = the same crest for the one-colour strip (whole-strip throb).
function chase(o, depth, hz, sharp = 2) { o.cDepth = depth; o.cHz = hz; o.cSharp = sharp; }

// mode 0: keep the table colours. mode 1: blend toward solid tint (r,g,b) by `mix`. mode 2: rainbow, hue + spread * regionPhase.
function tint(o, c, mix) { o.mode = 1; o.r = c[0]; o.g = c[1]; o.b = c[2]; o.mix = mix; }
function rainbow(o, hue, spread, mix = 1) { o.mode = 2; o.hue = hue; o.spread = spread; o.mix = mix; }
// N blinks at hz starting at t=0 (on first); after the train, an exponential tail from the last flash.
function blinks(o, t, hz, count, color, mix = .85, hi = 1.55, lo = .22) {
  const end = count / hz;
  if (t < end) { const on = sq(t * hz, .5); o.gain = on ? hi : lo; if (on) o.floor = .85; tint(o, color, on ? mix : mix * .4); if (on && frac(t * hz) < .25) o.white = .35; }
  else { const a = t - end; o.gain = 1 + .5 * Math.exp(-a / .3); tint(o, color, mix * Math.exp(-a / .5)); }
}

const ROULETTE_STOP = { roulette_30: 4.033, roulette_40: 4.033, roulette_100: 4.433, roulette_200: 4.833, roulette_500: 4.967 };
const HEAT_HZ = { flight_heat0: 3.5, flight_heat1: 5, flight_heat2: 7, flight_heat3: 9 };
const HEAT_COLOR = { flight_heat0: VIOLET, flight_heat1: PINK, flight_heat2: RED, flight_heat3: GOLD };

// c: { grammar, name, t (seconds in the clip / mode), clock, lampN, hitAge (s since a ball entered a hole), secondsLeft, playing, source }
export function evalFx(o, c) {
  const t = c.t, ck = c.clock, g = c.grammar;
  o.gain = 1; o.white = 0; o.mode = 0; o.mix = 0; o.hue = 0; o.spread = 0; o.floor = 0; o.cDepth = 0; o.cHz = 0;
  switch (g) {
    case 'sea_breathe': {                          // normal lamps: the more lamps, the more it throbs
      const n = c.lampN;
      // calm but alive: a slow running light even with no lamps; 3+ lamps add a beat; 5 = fast gold chase; 6 = hard gold/red strobe + chase (chance is near)
      if (n <= 0) { o.gain = .8 + .2 * Math.sin(TAU * ck * .3); o.floor = .3; chase(o, .3, .35, 1.5); }
      else if (n <= 2) { o.gain = .72 + .3 * (.5 + .5 * Math.sin(TAU * ck * .55)); o.floor = .34; chase(o, .45, .7, 2); }
      else if (n <= 4) { o.gain = .55 + .7 * pulse(ck * 1.6, 2.2); o.floor = .4; tint(o, PINK, .45); chase(o, .6, 1.2, 2.5); }
      else if (n === 5) { o.gain = .45 + 1.05 * pulse(ck * 3, 2.6); tint(o, GOLD, .7); chase(o, .7, 2.2, 3); }
      else { const a = sq(ck * 4, .5); o.gain = a ? 1.55 : .3; if (a) o.floor = .95; tint(o, a ? GOLD : RED, .9); if (a && frac(ck * 4) < .2) o.white = .4; chase(o, .5, 3.5, 3); }
      break;
    }
    case 'blue_arrival': blinks(o, t, 7, 3, BLUE, .8, 1.5, .15); break;
    case 'violet_arrival': blinks(o, t, 8, 4, VIOLET, .85, 1.5, .15); break;
    case 'pink_arrival': blinks(o, t, 9, 5, PINK, .9, 1.55, .12); break;
    case 'sakura': blinks(o, t, 9, 6, PINK, .9, 1.55, .12); break;
    case 'school_gold': blinks(o, t, 10, 8, GOLD, .95, 1.55, .1); break;
    case 'jp_prepare': { const a = sq(t * 8, .5); o.gain = a ? 1.55 : .2; if (a) o.floor = .95; tint(o, a ? GOLD : RED, .95); if (a && frac(t * 8) < .25) o.white = .5; chase(o, .4, 4, 3); break; }
    case 'guard': blinks(o, t, 7, 3, BLUE, .7, 1.4, .3); break;
    case 'reset': { const a = sq(t * 5, .5); o.gain = a ? 1.5 : .3; if (a) o.floor = .85; tint(o, RED, a ? .9 : .5); break; }
    case 'chance_gold': { const a = sq(t * 7, .55); o.gain = a ? 1.55 : .2; if (a) o.floor = .95; tint(o, GOLD, .95); if (a && frac(t * 7) < .15) o.white = .55; chase(o, .4, 3.5, 3); break; }
    case 'aim': { const ph = ck * 4; o.gain = .5 + 1.05 * pulse(ph * 2, 1.6); tint(o, frac(ph) < .5 ? GOLD : RED, .95); chase(o, .45, 2.5, 3); break; }   // gold / red alternation, 4 Hz + running light
    case 'flight': { o.gain = .4 + 1.15 * pulse(ck * 5, 2.4); tint(o, PINK, .85); chase(o, .5, 2, 3); break; }
    case 'flight_heat0': case 'flight_heat1': case 'flight_heat2': case 'flight_heat3': {
      const hz = HEAT_HZ[g], a = sq(ck * hz, .5);
      o.gain = a ? 1.55 : .18; if (a) o.floor = .75 + .07 * (hz > 8 ? 3 : hz > 6 ? 2 : hz > 4 ? 1 : 0); tint(o, HEAT_COLOR[g], .95); if (g === 'flight_heat3') { o.white = a ? .4 : 0; if (a) o.mix = .6; } chase(o, .3 + .1 * (hz > 6 ? 1 : 0), hz * .4, 3);
      break;
    }
    case 'mouth_squeeze': case 'miss_squeeze': o.gain = .8; break;     // the table already goes nearly black: tension before the result
    case 'jackpot_burst': {                          // the hit: white-gold strobe at 10 Hz, then rainbow
      const a = sq(t * 10, .5);
      if (t < .8) { o.gain = a ? 1.55 : .1; if (a) o.floor = 1; tint(o, a ? WHITE : GOLD, .95); o.white = a ? .8 : 0; }
      else { o.gain = 1.2 + .3 * sq(ck * 8, .5); o.floor = .85; rainbow(o, ck * 2, .6); chase(o, .3, 3, 2); }
      break;
    }
    case 'rush_rainbow': { o.gain = .9 + .65 * sq(ck * 9, .5); o.floor = .85; rainbow(o, ck * 2.4, .7); chase(o, .35, 3, 2); break; }
    case 'bridge_charge': { const k = clamp(t / 2.6); const hz = 3 + 7 * k, a = sq(t * hz, .5); o.gain = (.5 + 1.05 * k) * (a ? 1 : .4); o.floor = (a ? .3 : .12) + .6 * k; tint(o, GOLD, .9); if (k > .85) o.white = a ? .3 : 0; break; }
    case 'lightning': { const a = t < .27 ? .35 : t < .33 || (t > .45 && t < .5) ? 1 : 0; o.gain = .45 + 1.1 * a; tint(o, WHITE, .5 + .4 * a); o.white = .6 * a; break; }
    case 'intro_squeeze': o.gain = .4 + .6 * pulse(ck * 2, 1.8); tint(o, VIOLET, .7); chase(o, .5, 1.2, 2); break;
    case 'roulette': {                               // colours step around, then lock to gold
      const stop = ROULETTE_STOP[c.name] ?? 4.5;
      if (t < stop) { const sl = Math.floor(t * (16 - 7 * clamp(t / stop))); rainbow(o, sl / 12, 0, 1); o.gain = .8 + .7 * (sl & 1); o.floor = .8; chase(o, .3, 4, 2); }
      else { const a = t - stop; o.gain = 1 + .55 * pulse(a * 6, 3); o.floor = .85; tint(o, GOLD, 1); o.white = .8 * Math.exp(-a / .1); chase(o, .25, 1.5, 2); }
      break;
    }
    case 'reward_gold': { o.gain = .6 + .9 * pulse(ck * 5, 2.5); tint(o, GOLD, .95); chase(o, .4, 2, 3); break; }
    case 'reward_rainbow': { o.gain = .85 + .65 * sq(ck * 7, .5); o.floor = .75; rainbow(o, ck * 1.8, .6); chase(o, .35, 2.5, 2); break; }
    case 'gold_hold': { o.gain = .7 + .85 * pulse(ck * 6, 2.2); o.floor = .6; tint(o, GOLD, .95); chase(o, .3, 2, 3); break; }
    case 'confirm': {
      if (t < 5.2) { o.gain = .5 + .5 * clamp(t / 5) + .55 * pulse(ck * (2.5 + 5 * clamp(t / 5)), 2.4); tint(o, GOLD, .92); chase(o, .45, 1.5 + 2 * clamp(t / 5), 2); }
      else { const a = t - 5.2; o.gain = 1 + .55 * pulse(a * 6, 3); tint(o, GOLD, 1); o.white = .95 * Math.exp(-a / .12); chase(o, .25, 1.5, 2); }
      break;
    }
    case 'failure': { o.gain = .65; tint(o, VIOLET_DEEP, 1); o.floor = .22; break; }                          // dim and sad, no flashing
    case 'choice_neutral': { const ph = ck * 2; o.gain = .6 + .85 * pulse(ph * 2, 1.8); tint(o, frac(ph) < .5 ? PINK : GOLD, .9); chase(o, .4, 1.5, 2); break; }
    case 'choice_left': { o.gain = .5 + .9 * pulse(ck * 4, 2), tint(o, VIOLET, .85); chase(o, .4, 2, 2); break; }
    case 'choice_right': { o.gain = .6 + .95 * pulse(ck * 5, 2.2); tint(o, GOLD, .95); chase(o, .4, 2.5, 3); break; }
    case 'attract': case 'title': case 'instruction': {                                      // calm breathing, slow hue drift blue -> violet -> pink
      o.gain = .65 + .35 * (.5 + .5 * Math.sin(TAU * ck * .3)); chase(o, g === 'instruction' ? .15 : .3, .4, 1.5);
      const h = .5 + .5 * Math.sin(TAU * ck / 14);
      o.mode = 1; o.mix = g === 'instruction' ? .0 : .85; o.r = BLUE[0] + (PINK[0] - BLUE[0]) * h; o.g = BLUE[1] + (PINK[1] - BLUE[1]) * h; o.b = BLUE[2] + (PINK[2] - BLUE[2]) * h;
      if (g === 'title') o.gain *= .9 + .4 * pulse(ck * .8, 3);
      break;
    }
    // v4 video-clock scenes: t = displayed video time (s). Colours come from the table (video palette); the layer adds the beats.
    case 'attract_wait': {                           // 20 s loop: logo 0-3.5 / JACKPOT CHANCE 3.5-5.83 / RUSH -7.23 / roulette -9.23 (stop 8.47) / 500 FEVER -13.5 / upa
      const w = (at, tau) => t >= at ? Math.exp(-(t - at) / tau) : 0;
      const calm = .7 + .3 * (.5 + .5 * Math.sin(TAU * ck * .22)), h = .5 + .5 * Math.sin(TAU * ck / 14);
      o.gain = calm; chase(o, .25, .4, 1.5); o.mode = 1; o.mix = .45; o.r = BLUE[0] + (PINK[0] - BLUE[0]) * h; o.g = BLUE[1] + (PINK[1] - BLUE[1]) * h; o.b = BLUE[2] + (PINK[2] - BLUE[2]) * h;
      if (t >= 3.5 && t < 5.83) { o.gain = .7 + .85 * pulse(t * 3, 2.2); o.floor = .5; tint(o, GOLD, .8); chase(o, .4, 2, 3); }
      else if (t >= 5.83 && t < 7.23) { const a = sq(t * 6, .5); o.gain = a ? 1.55 : .4; if (a) o.floor = .9; tint(o, a ? WHITE : GOLD, .85); if (a && frac(t * 6) < .25) o.white = .35; }
      else if (t >= 7.23 && t < 8.47) { const sl = Math.floor((t - 7.23) * (10 - 5 * (t - 7.23) / 1.24)); rainbow(o, sl / 12, 0, .8); o.gain = 1.1 + .3 * (sl & 1); o.floor = .75; }
      else if (t >= 8.47 && t < 9.23) { o.gain = 1.1 + .45 * pulse((t - 8.47) * 5, 3); o.floor = .85; tint(o, GOLD, .95); }
      else if (t >= 9.23 && t < 13.5) { o.gain = 1.2 + .3 * sq(t * 5, .5); o.floor = .7; rainbow(o, t * 1.4, .6, .9); }
      const wf = Math.max(.85 * w(8.47, .1), .8 * w(9.23, .12), .6 * w(13.63, .12), .6 * w(19.8, .12));
      if (wf > .02) { o.white = Math.max(o.white, wf); o.gain = Math.max(o.gain, 1.2); }
      break;
    }
    case 'offer': {                                  // 30 s extension offer: a soft tick on every countdown second, redder and faster near zero
      const left = 30 - t, urgent = clamp((10 - left) / 10);
      const tick = left <= 3 ? pulse(t * 3, 3) : left <= 10 ? pulse(t * 2, 3) : pulse(t, 3);
      o.gain = .65 + (.5 + .6 * urgent) * tick; chase(o, .2 + .3 * urgent, .6 + 2 * urgent, 2); o.floor = .15 + .3 * urgent * tick;
      const c = [VIOLET[0] + (RED[0] - VIOLET[0]) * urgent, VIOLET[1] + (PINK[1] - VIOLET[1]) * urgent * .6, VIOLET[2] + (PINK[2] - VIOLET[2]) * urgent];
      tint(o, c, .45 + .45 * urgent);
      if (left <= 5 && frac(left <= 3 ? t * 3 : t * 2) < .15) o.white = .35;
      break;
    }
    case 'result_media': {                           // 11.7 s result: doors 0-1.3 / count 3.4-5.2 / lock 5.2 / medal 7.13 / re-challenge 9.73
      const a = (x) => t - x;
      if (t < 3.4) { o.gain = .8 + .15 * pulse(t * .8, 2); tint(o, VIOLET, .4); }
      else if (t < 5.2) { const k = clamp((t - 3.4) / 1.8), hz = 4 + 4 * k, on = sq(t * hz, .5); o.gain = .4 + .7 * k + (on ? .5 : 0); o.floor = .35 + .3 * k; tint(o, GOLD, .85); chase(o, .3, 2.5, 2); }
      else if (t < 7.13) { const d = a(5.2); o.gain = 1 + .55 * pulse(d * 6, 3); o.floor = .6; tint(o, GOLD, 1); o.white = .95 * Math.exp(-d / .12); chase(o, .25, 1.5, 2); }
      else if (t < 9.73) { const d = a(7.13); o.gain = 1.15 + .35 * pulse(d * 1.5, 2); o.floor = .6; if (d < .9) rainbow(o, ck * 2.2, .7, 1 - d / .9); else tint(o, GOLD, .9); chase(o, .3, 2, 2); o.white = Math.max(o.white, .9 * Math.exp(-d / .15)); }
      else { o.gain = .6 + .6 * pulse(ck * 2, 2.2); tint(o, PINK, .8); chase(o, .4, 1.5, 2); }
      break;
    }
    case 'start': { blinks(o, t, 8, 5, GOLD, .95, 1.55, .15); break; }
    case 'timeup': { const a = sq(ck * 3, .5); o.gain = a ? 1.3 : .2; o.floor = a ? .85 : .05; tint(o, RED, a ? .95 : .7); chase(o, .3, 1.5, 2); break; }
    case 'extend': { o.gain = .6 + .95 * pulse(ck * 4, 2.2); tint(o, GOLD, .95); chase(o, .4, 2, 3); break; }
    case 'count': { o.gain = .6 + .7 * pulse(ck * 3.5, 2.4); tint(o, BLUE, .7); chase(o, .35, 1.5, 2); break; }
    case 'result': { o.gain = .65 + .7 * pulse(ck * 2, 2.2) + .3 * sq(ck * 7, .2); tint(o, GOLD, .9); chase(o, .35, 1.5, 2); break; }
    case 'continue': { o.gain = .55 + .9 * pulse(ck * 4, 2.2); tint(o, PINK, .9); chase(o, .4, 2.2, 3); break; }
    default: break;
  }
  // A ball that just entered a hole: bright flick on top of whatever is playing.
  const age = c.hitAge;
  if (age >= 0 && age < .6) {
    // double flash: hard flick, a short dip, a second flick
    const dip = age > .1 && age < .22 ? .45 : 1, second = age >= .22 ? .7 * Math.exp(-(age - .22) / .12) : 0;
    o.gain *= dip * (1 + .9 * Math.exp(-age / .14) + second);
    const w = Math.max(.9 * Math.exp(-age / .05), age >= .22 ? .6 * Math.exp(-(age - .22) / .06) : 0); if (w > o.white) o.white = w; o.floor = Math.max(o.floor, .5 * Math.exp(-age / .25));
  }
  // Last ten seconds of the game: red warning blink (ordinary play only, never over a JP show).
  const sl = c.secondsLeft;
  if (c.playing && sl > 0 && sl <= 10 && c.source !== 'jp' && c.source !== 'choice') {
    const hz = sl <= 3 ? 5 : sl <= 6 ? 3.5 : 2.5, a = sq(ck * hz, .5);
    if (a) { o.gain = Math.max(o.gain, 1.3); o.floor = .95; tint(o, RED, .95); } else o.gain *= .3;
  }
  o.cWave = o.cDepth > 0 ? Math.pow(.5 + .5 * Math.cos(TAU * ck * o.cHz), o.cSharp) : 1;
  o.active = o.gain !== 1 || o.white > 0 || o.mix > 0 || o.mode !== 0 || o.floor > 0 || o.cDepth > 0;
  return o;
}

// hue (0..1) -> rgb written into out[i..i+2]
export function hsvTo(out, i, h) {
  h = frac(h) * 6; const k = Math.floor(h), f = h - k;
  switch (k) {
    case 0: out[i] = 1; out[i + 1] = f; out[i + 2] = .01; break;
    case 1: out[i] = 1 - f; out[i + 1] = 1; out[i + 2] = .01; break;
    case 2: out[i] = .01; out[i + 1] = 1; out[i + 2] = f; break;
    case 3: out[i] = .01; out[i + 1] = 1 - f; out[i + 2] = 1; break;
    case 4: out[i] = f; out[i + 1] = .01; out[i + 2] = 1; break;
    default: out[i] = 1; out[i + 1] = .01; out[i + 2] = 1 - f; break;
  }
}

// One RGB for the monitor-surround strip (floats 0..1 written into strip[0..2]) from the *unmodified* table row.
const scratch = new Float32Array(3);
export function stripFrom(strip, o, K, Kc) {
  let sum = 0, r = 0, g = 0, b = 0;
  for (let i = 0; i < 8; i++) { const k = K[i]; sum += k; r += k * Kc[i][0]; g += k * Kc[i][1]; b += k * Kc[i][2]; }
  if (sum > 1e-4) { r /= sum; g /= sum; b /= sum; } else { r = Kc[0][0]; g = Kc[0][1]; b = Kc[0][2]; }
  const level = clamp(sum / 8 * 1.25 + .06, 0, 1);
  if (o.mode === 1) { r += (o.r - r) * o.mix; g += (o.g - g) * o.mix; b += (o.b - b) * o.mix; }
  else if (o.mode === 2) { hsvTo(scratch, 0, o.hue); r += (scratch[0] - r) * o.mix; g += (scratch[1] - g) * o.mix; b += (scratch[2] - b) * o.mix; }
  const m = Math.max(r, g, b, 1e-3), amp = clamp(Math.max(level * o.gain, o.floor) * (1 - o.cDepth * (1 - o.cWave) * .8), 0, 1.5) / m;   // max channel of the colour = brightness
  strip[0] = clamp(r * amp + o.white, 0, 1);
  strip[1] = clamp(g * amp + o.white * .93, 0, 1);
  strip[2] = clamp(b * amp + o.white * .8, 0, 1);
}
