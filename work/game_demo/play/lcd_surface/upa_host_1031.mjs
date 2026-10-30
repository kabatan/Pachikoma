// 10/31 うぱ接客の冒頭（チュートリアルの置き換え）。監督 v02 の映像（effects/upa_host/intro_v02/）を、液晶の重ね描きとして実装する。
//   ボタン（START の札）のあと、通常画面だけが映る → 巨大なスライムのうぱが落ちて画面を覆う → 上半分へ縮む
//   → 「プレイは はじめて？ せつめいを きく？」 左ボタン=きく／右ボタン=きかない（12秒押さなければ「きく」）
//   きかない → 「ルールは きかなくて だいじょうぶ？」（左=やっぱり きく／右=だいじょうぶ）→ 「じゃあ またね！」→ うぱが飛んで消え、時計が動き出す
//   きく   → 「じゃあ せつめい するね！」（全画面）→ 「パチコマは 玉を ふやす ゲームだよ！」（大量の玉）→ 「500こ ためると Switch 2 が もらえるよ！」（写真）
//          → 左下（案Aの席）へ移り「ボタンを れんだ しよう！」。ここで時計が動き出す。最初のボタンかお10秒で引っ込む
//   2回目の客（ctrl.repeatVisit）は短く：左下へ跳んできて「おかえり！ いってみよう！」で開始。
// 規則・演出は変えない：冒頭の間だけ規則の時計を止め（ctrl.freezeRules）、時計の表示を隠す（ctrl.howto を立てる＝既存の仕組み）。ボタンは冒頭の間だけ選択に使い、玉は撃たせない。
// ?upahost=0 でこのファイルは読まれず、従来どおり（play.mjs の差し込み）。?upavoice=1 で effects/upa_host/voice/<id>.ogg|wav があれば声を鳴らす（既定は文字＋効果音だけ）。
// 数字は規則から読む：S賞のしきい値（PrizeThresholds の最後）。台本の直書きはしない。
// v03：字は M PLUS 1(OFL) 太さ800 の金のパチンコ字（lib2.gtext で吹き出しごと焼いた txt_*.png。dtext=Dela Gothic One は焼いた字が無いときの代わり）。うぱは原画 upa_source.png の画素そのまま（落ち着いている間は最近傍の整数倍、動いている間だけ艶つきの lit に切り替え）。
//   素材は effects/upa_host/game_build/bake_assets.py。吹き出しは案A（ドット階段の角・茶/金/茶の縁・クリーム地）。
import { hotBus } from '../../../audio/runtime/hot_bus.mjs';
import { createGuide } from './upa_guide_1031.mjs';
import { createUpaFlow } from './upa_flow_1031.mjs';
import { HOLE_X } from './tutorial_jp_overlay_1030.mjs';

const PX = 34, PY = 28, W = 1152, H = 1268;
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const lerp = (a, b, x) => a + (b - a) * x;
const easeOut = (x) => 1 - (1 - clamp(x)) ** 3;
const easeBack = (x, c1 = 1.9) => { x = clamp(x); const c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; };
const spring = (u, k0, d, hz) => 1 + (k0 - 1) * Math.exp(-d * u) * Math.cos(2 * Math.PI * hz * u);
const hop = (k) => Math.sin(Math.PI * clamp(k));
const frac = (x) => x - Math.floor(x);
const A = new URL('./upa_host_assets/', import.meta.url);

const CX = 576, GROUND = 1262, PARK = 410, MBIG = 24;
// 映像の時刻（tv）での台本。listen は press=8.0 を基準にした続き
const T = { FALL: 1.3, LAND: 1.8, SHR: 3.3, PARK: 4.2, ASK: [4.3, 8.3], BTN: 5.4, PRESS: 8.0,
  Q_CONF: 8.9, Q_BTN: 9.7, Q_PRESS: 11.4, Q_BYE: 11.8, LAUNCH: 13.0,
  G_UP: 8.6, G_LAND: 9.7, EXPL: [10.1, 11.9], SHR2: 11.8, BALLS: [12.3, 16.3], SW: [16.7, 20.0], JPC: [20.1, 22.5], LAMP: [22.6, 26.6], SEAT0: 26.7, SEAT: [27.7, 30.8] };
const lampLift = (v) => 72 * Math.min(1, Math.max(0, Math.min((v - T.JPC[1]) / 0.25, (T.LAMP[1] - v) / 0.25)));   // ランプの説明の間はうぱを少し上げて矢印を空ける
const CLOCK_IDLE_START = 20;   // 10/31 発射しないまま放置したら、促しのあとこの秒数で時計を動かす（スタッフ待ちで詰まらせない保険）

export async function attachUpaHost(lcd, { controller, log = () => {} } = {}) {
  if (!lcd?.production || lcd.upaHost) return lcd;
  const qs = new URLSearchParams(globalThis.location?.search ?? '');
  const VOICE = qs.get('upavoice') === '1';
  const mainCtx = lcd.canvas.getContext('2d');
  const game = () => controller.game;
  const eng = () => globalThis.__r2Audio?.engine;

  // ---------------- 素材 ----------------
  // 開始ボタンのあとの従来の「遊び方」（チュートリアル動画）は、うぱの接客に置き換える。素材が読めなかったら戻す
  const how0 = { s: controller.howtoSeconds, f: controller.howtoSecondsFull, sh: controller.howtoSecondsShort, p: controller.howtoPanels, k: controller.tutSkipEnabled };
  controller.howtoSeconds = 0; controller.howtoSecondsFull = null; controller.howtoSecondsShort = null; controller.tutSkipEnabled = false;
  const R = { ready: false, failed: null, man: null, spr: {}, plain: {}, txt: {}, txtMeta: null, guide: {}, guideMeta: {}, ball: [], photo: null, fall: null, fallMeta: null };
  const img = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(Error('asset ' + u)); i.src = u; });
  const loading = (async () => {
    const man = await (await fetch(new URL('manifest.json', A))).json(); R.man = man;
    const font = new FontFace('UpaDela', `url(${new URL('DelaGothicOne-Regular.ttf', A).href})`); await font.load(); document.fonts.add(font);
    await Promise.all(Object.keys(man).map(async (k) => { R.spr[k] = await img(new URL(k + '.webp', A).href); R.plain[k] = await img(new URL('plain_' + k + '.webp', A).href); }));
    // 字・吹き出し（lib2.gtext で焼いたもの。読めなければ下の dtext/bubbleA に戻る）
    try { R.txtMeta = await (await fetch(new URL('txt.json', A))).json(); await Promise.all(Object.keys(R.txtMeta.items).map(async (k) => { R.txt[k] = await img(new URL(`txt_${k}.png`, A).href); })); } catch (e) { R.txtMeta = null; R.txt = {}; console.warn('[upa-host] 焼いた字を読めませんでした（代わりの字で出します）', e); }
    R.ball = await Promise.all([0, 1].map((k) => img(new URL(`ball_${k}.png`, A).href)));
    R.photo = await img(new URL('switch2_nintendo_sns.png', A).href);
    R.fallMeta = await (await fetch(new URL('balls_fall.json', A))).json();
    R.fall = new Int16Array(await (await fetch(new URL('balls_fall.bin', A))).arrayBuffer());
    try { R.guideMeta = await (await fetch(new URL('guide.json', A))).json(); await Promise.all(Object.keys(R.guideMeta).map(async (k) => { R.guide[k] = await img(new URL(`txt_g_${k}.webp`, A).href); })); } catch (e) { R.guideMeta = {}; R.guide = {}; console.warn('[upa-host] 案内の吹き出しを読めませんでした（開始後の案内は出しません）', e); }
    R.ready = true;
  })().catch((e) => { R.failed = e; console.warn('[upa-host] 素材を読めませんでした（従来の遊び方に戻します）', e); Object.assign(controller, { howtoSeconds: how0.s, howtoSecondsFull: how0.f, howtoSecondsShort: how0.sh, tutSkipEnabled: how0.k }); });

  // ---------------- 字・吹き出し（案A）----------------
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(2, Math.ceil(w)); c.height = Math.max(2, Math.ceil(h)); return c; };
  const FONT = (sz) => `${sz}px UpaDela, "Dela Gothic One", "Noto Sans CJK JP", sans-serif`;
  /** パチンコ風の字。lines=[[ [text, accent] ]]。Dela Gothic One・やや斜体・面グラデ＋白の細縁＋暗い太縁＋右下の押し出し */
  function dtext(lines, sz, { align = 'center', shear = 0.14, lead = 1.22 } = {}) {
    const m = mk(10, 10).getContext('2d'); m.font = FONT(sz);
    const ws = lines.map((ln) => ln.reduce((a, [t]) => a + m.measureText(t).width, 0)), mw = Math.max(...ws), pad = Math.ceil(sz * 0.45);
    const Wc = Math.ceil(mw + pad * 2 + sz * 0.3), Hc = Math.ceil(sz * lead * lines.length + pad * 2), L = sz * lead;
    const c = mk(Wc, Hc), x = c.getContext('2d'); x.font = FONT(sz); x.textBaseline = 'alphabetic'; x.lineJoin = 'round'; x.miterLimit = 2;
    const rO = sz * 0.095, rW = sz * 0.04, ext = Math.max(2, Math.round(sz * 0.07));
    x.setTransform(1, 0, -shear, 1, shear * Hc / 2, 0);
    const runs = []; lines.forEach((ln, li) => { let px = pad + (align === 'center' ? (mw - ws[li]) / 2 : 0); for (const [t, a] of ln) { runs.push({ t, a, x: px, y: pad + li * L + sz * 0.86 }); px += m.measureText(t).width; } });
    const stroke = (w, col, dx = 0, dy = 0) => { x.lineWidth = w; x.strokeStyle = col; for (const r of runs) x.strokeText(r.t, r.x + dx, r.y + dy); };
    x.save(); x.shadowColor = 'rgba(20,6,30,.5)'; x.shadowBlur = sz * 0.1; x.shadowOffsetX = sz * 0.05; x.shadowOffsetY = sz * 0.05; stroke(2 * (rO + rW), 'rgba(30,12,50,1)', ext * 0.7, ext); x.restore();
    for (let k = ext; k >= 1; k--) stroke(2 * (rO + rW), 'rgb(30,12,50)', k * 0.7, k);
    stroke(2 * (rO + rW), 'rgb(45,18,78)'); stroke(2 * rW, 'rgb(250,250,255)');
    const g0 = x.createLinearGradient(0, 0, 0, Hc); g0.addColorStop(0, 'rgb(255,255,245)'); g0.addColorStop(1, 'rgb(255,226,120)');
    const g1 = x.createLinearGradient(0, 0, 0, Hc); g1.addColorStop(0, 'rgb(255,214,90)'); g1.addColorStop(1, 'rgb(255,70,40)');
    for (const r of runs) { x.fillStyle = r.a ? g1 : g0; x.fillText(r.t, r.x, r.y); }
    return c;
  }
  const CELL = 6, BROWN = '#30180a', GOLD = '#f0b840', CREAM = '#fff6de';
  /** 案Aの吹き出し。tail: 't'(上へ)|'b'(下へ)|'bl'(左下へ)。戻り値 {c, tip}（tip=しっぽの先の画像内座標）。 */
  function bubbleA(lines, sz, { tail = 't', tailX = 'c', pad = null } = {}) {
    const t = dtext(lines, sz); pad = pad ?? Math.round(sz * 0.55);
    let w = t.width + pad * 2, h = t.height + pad * 2; w = (Math.floor(w / CELL) + 1) * CELL; h = (Math.floor(h / CELL) + 1) * CELL;
    const gw = w / CELL, gh = h / CELL, MG = 8 * CELL;
    const g = mk(gw, gh), gx = g.getContext('2d');
    const rect = (x0, y0, x1, y1) => gx.fillRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    const shape = (ins, col) => { gx.fillStyle = col; const x0 = ins, y0 = ins, x1 = gw - 1 - ins, y1 = gh - 1 - ins, c = 3; rect(x0 + c, y0, x1 - c, y1); rect(x0, y0 + c, x1, y1 - c); rect(x0 + 1, y0 + 1, x1 - 1, y1 - 1); rect(x0 + 2, y0, x1 - 2, y1); rect(x0, y0 + 2, x1, y1 - 2); };
    shape(0, BROWN); shape(1, GOLD); shape(2, BROWN); shape(3, CREAM); gx.fillStyle = '#fff'; rect(6, 3, gw - 7, 3);
    const out = mk(w + 2 * MG, h + 2 * MG), o = out.getContext('2d'); o.imageSmoothingEnabled = false;
    // 影（ひとマス右下）
    const sh = mk(gw, gh), sx = sh.getContext('2d'); sx.drawImage(g, 0, 0); sx.globalCompositeOperation = 'source-in'; sx.fillStyle = 'rgba(10,0,20,.4)'; sx.fillRect(0, 0, gw, gh);
    o.drawImage(sh, MG + CELL, MG + CELL, w, h); o.drawImage(g, MG, MG, w, h);
    let tip = null;
    if (tail) {
      const ROWS = ['BGBCCCCCCBGB', '.BGBCCCCBGB.', '..BGBCCBGB..', '...BGBBGB...', '....BGGB....', '.....BB.....'];
      const dirn = tail.endsWith('l') ? -1 : tail.endsWith('r') ? 1 : 0, up = tail[0] === 't';
      const x0 = MG + (tailX === 'c' ? Math.floor((w / 2 - 6 * CELL) / CELL) * CELL : Math.floor(w * tailX / CELL) * CELL), COL = { B: BROWN, G: GOLD, C: CREAM };
      o.fillStyle = CREAM; if (!up) o.fillRect(x0 + 3 * CELL, MG + h - 3 * CELL, 6 * CELL, 3 * CELL); else o.fillRect(x0 + 3 * CELL, MG, 6 * CELL, 3 * CELL);
      ROWS.forEach((row, r) => { for (let i = 0; i < row.length; i++) { const ch = row[i]; if (ch === '.') continue; o.fillStyle = COL[ch]; o.fillRect(x0 + (i + dirn * r) * CELL, up ? MG - (r + 1) * CELL : MG + h + r * CELL, CELL, CELL); } });
      tip = { x: x0 + (6 + dirn * 5) * CELL, y: up ? MG - 6 * CELL : MG + h + 6 * CELL };
    }
    o.imageSmoothingEnabled = true; o.drawImage(t, MG + (w - t.width) / 2, MG + (h - t.height) / 2);
    return { c: out, tip };
  }
  const cache = new Map();
  const cached = (k, fn) => { let v = cache.get(k); if (!v) { v = fn(); cache.set(k, v); } return v; };
  // 焼いた吹き出し／ラベルがあればそれ（金のパチンコ字）。台詞の数字（S賞）が焼いた値と違うときだけ従来の字で組む
  const Bub = (k, lines, sz, opt) => cached('b_' + k, () => { const m = R.txtMeta?.items[k]; if (m && R.txt[k] && (k !== 'sw' || R.txtMeta.prize === sPrize())) return { c: R.txt[k], tip: { x: m.tip[0], y: m.tip[1] } }; return bubbleA(lines, sz, opt); });
  const Lab = (k, text, sz) => cached('l_' + k, () => R.txt[k] ?? dtext([[[text, false]]], sz));

  // ---------------- 規則から読む数字 ----------------
  const sPrize = () => { const r = game().rules, th = r.PrizeThresholds; return th?.[th.length - 1] ?? 500; };
  const LINES = () => ({   // id は effects/upa_host/lines.json と対応
    intro_ask: [[['プレイは はじめて？', false]], [['せつめいを ', false], ['きく', true], ['？', false]]],
    intro_quit_confirm: [[['ルールは ', false], ['きかなくて', true]], [['だいじょうぶ', true], ['？', false]]],
    intro_quit_bye: [[['じゃあ ', false], ['またね', true], ['！', false]]],
    intro_listen: [[['じゃあ', false]], [['せつめい', true], [' するね！', false]]],
    rule_goal: [[['玉', true], ['を ふやす', false]], [['ゲーム', true], ['だよ！', false]]],
    rule_prize: [[[`${sPrize()}こ `, true], ['ためると', false]], [['Switch 2', true], [' が もらえるよ！', false]]],
    rule_jp: [[['玉を たくさん もらうには', false]], [['JPチャンス', true], ['！', false]]],
    rule_lamp: [[['7この ', false], ['ランプ', true], ['のうち', false]], [['6こ', true], [' 光らせたら', false]], [['JPチャンス', true], ['だよ！', false]]],
    rule_hands: [[['ボタンを ', false], ['れんだ', true], ['して、', false]], [['穴', true], ['に 玉を入れよう！', false]], [['入った穴の ', false], ['ランプ', true], ['が つくよ！', false]]],
    intro_repeat: [[['おかえり！', true]], [['いってみよう！', false]]],
  });

  // ---------------- 効果音（WebAudio 合成・素材なし）----------------
  const sfx = (() => {
    const out = (vol = -9) => { const ctx = eng()?.ctx; if (!ctx) return null; const g = ctx.createGain(); g.gain.value = 10 ** (vol / 20); g.connect(hotBus(eng())); setTimeout(() => { try { g.disconnect(); } catch { } }, 6000); return { ctx, g, t0: ctx.currentTime + 0.02 }; };
    const tone = (o, f, f2, at, dur, { type = 'sine', gain = 1, atk = 0.004, fm = 0, fmf = 0 } = {}) => {
      const os = o.ctx.createOscillator(), e = o.ctx.createGain(); os.type = type; os.frequency.setValueAtTime(f, o.t0 + at); if (f2 && f2 !== f) os.frequency.exponentialRampToValueAtTime(f2, o.t0 + at + dur * 0.9);
      let lfo = null; if (fm) { lfo = o.ctx.createOscillator(); const lg = o.ctx.createGain(); lfo.frequency.value = fmf; lg.gain.value = fm; lfo.connect(lg).connect(os.frequency); lfo.start(o.t0 + at); lfo.stop(o.t0 + at + dur + 0.05); }
      e.gain.setValueAtTime(0, o.t0 + at); e.gain.linearRampToValueAtTime(gain, o.t0 + at + atk); e.gain.exponentialRampToValueAtTime(0.0008, o.t0 + at + dur);
      os.connect(e).connect(o.g); os.start(o.t0 + at); os.stop(o.t0 + at + dur + 0.05); os.onended = () => { try { os.disconnect(); e.disconnect(); } catch { } };
    };
    const noise = (o, at, dur, { f = 2000, q = 0.8, gain = 0.5, f2 = null } = {}) => {
      const n = Math.max(1, Math.floor(o.ctx.sampleRate * dur)), b = o.ctx.createBuffer(1, n, o.ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-3 * i / n);
      const s = o.ctx.createBufferSource(), bp = o.ctx.createBiquadFilter(), e = o.ctx.createGain(); s.buffer = b; bp.type = 'bandpass'; bp.frequency.setValueAtTime(f, o.t0 + at); if (f2) bp.frequency.exponentialRampToValueAtTime(f2, o.t0 + at + dur); bp.Q.value = q; e.gain.value = gain;
      s.connect(bp).connect(e).connect(o.g); s.start(o.t0 + at); s.onended = () => { try { s.disconnect(); bp.disconnect(); e.disconnect(); } catch { } };
    };
    const safe = (fn) => (...a) => { try { fn(...a); } catch (e) { console.warn('[upa-host-sfx]', e); } };
    const blip = (o, at, f, g = 0.35) => { tone(o, f, f * 1.5, at, 0.1, { type: 'triangle', gain: g }); tone(o, f * 1.5, f * 2, at + 0.07, 0.14, { gain: g * 0.7 }); };
    const S = {
      fall: safe(() => { const o = out(-10); if (!o) return; noise(o, 0, 0.55, { f: 400, f2: 3000, q: 0.5, gain: 0.7 }); tone(o, 300, 1400, 0, 0.5, { atk: 0.1, gain: 0.12 }); }),
      land: safe(() => { const o = out(-6); if (!o) return; tone(o, 95, 38, 0, 0.5, { gain: 1 }); noise(o, 0, 0.12, { f: 900, gain: 0.5 }); tone(o, 520, 190, 0.02, 0.7, { gain: 0.45, fm: 60, fmf: 9 }); tone(o, 400, 260, 0.35, 0.45, { gain: 0.28, fm: 40, fmf: 11 }); tone(o, 330, 240, 0.75, 0.35, { gain: 0.18, fm: 25, fmf: 12 });
        for (let i = 0; i < 12; i++) tone(o, 900 + Math.random() * 1300, 1500 + Math.random() * 1500, 0.1 + i * 0.07, 0.07, { gain: 0.12 }); }),
      hop: safe(() => { const o = out(-10); if (!o) return; tone(o, 180, 620, 0, 0.45, { gain: 0.4, fm: 50, fmf: 8 }); }),
      park: safe(() => { const o = out(-10); if (!o) return; tone(o, 260, 120, 0, 0.25, { gain: 0.45, fm: 40, fmf: 10 }); tone(o, 70, 40, 0, 0.3, { gain: 0.5 }); }),
      pop: safe((f = 740, g = 0.35) => { const o = out(-10); if (!o) return; blip(o, 0, f, g); }),
      click: safe(() => { const o = out(-7); if (!o) return; noise(o, 0, 0.04, { f: 3000, gain: 0.8 }); tone(o, 160, 90, 0, 0.08, { gain: 0.6 }); tone(o, 660, 990, 0.04, 0.12, { gain: 0.35 }); tone(o, 990, 1320, 0.12, 0.18, { gain: 0.35 }); }),
      confirmGo: safe(() => { const o = out(-8); if (!o) return; noise(o, 0, 0.04, { f: 3000, gain: 0.8 }); tone(o, 160, 90, 0, 0.08, { gain: 0.6 }); tone(o, 784, 1175, 0.04, 0.12, { gain: 0.35 }); tone(o, 1175, 1568, 0.12, 0.2, { gain: 0.35 }); }),
      surprise: safe(() => { const o = out(-11); if (!o) return; tone(o, 400, 200, 0, 0.3, { gain: 0.25, fm: 40, fmf: 10 }); }),
      joy: safe(() => { const o = out(-11); if (!o) return; tone(o, 520, 780, 0, 0.2, { gain: 0.25, fm: 30, fmf: 9 }); }),
      grow: safe(() => { const o = out(-9); if (!o) return; tone(o, 160, 520, 0, 0.9, { gain: 0.4, fm: 40, fmf: 7 }); }),
      thud: safe(() => { const o = out(-5); if (!o) return; tone(o, 90, 40, 0, 0.45, { gain: 0.9 }); tone(o, 380, 200, 0.02, 0.7, { gain: 0.35, fm: 50, fmf: 9 }); for (let i = 0; i < 10; i++) tone(o, 900 + Math.random() * 1300, 1500 + Math.random() * 1500, 0.15 + i * 0.06, 0.07, { gain: 0.1 }); }),
      bye: safe(() => { const o = out(-9); if (!o) return; tone(o, 880, 880, 0, 0.12, { gain: 0.35 }); tone(o, 1175, 1175, 0.13, 0.12, { gain: 0.35 }); tone(o, 1568, 1568, 0.26, 0.3, { gain: 0.4 }); }),
      crouch: safe(() => { const o = out(-10); if (!o) return; tone(o, 220, 120, 0, 0.3, { gain: 0.3, fm: 30, fmf: 10 }); }),
      launch: safe(() => { const o = out(-8); if (!o) return; tone(o, 250, 1500, 0, 0.5, { gain: 0.45, fm: 60, fmf: 9 }); noise(o, 0, 0.5, { f: 600, f2: 4000, gain: 0.5 }); for (let i = 0; i < 10; i++) tone(o, 1000 + Math.random() * 1600, 1500 + Math.random() * 1700, 0.1 + i * 0.06, 0.06, { gain: 0.1 }); }),
      // 玉のじゃらじゃら：降る（0〜3.1秒）→ 床が抜けて流れ落ちる（3.3〜4.3秒）。一度にバッファへ合成して鳴らす
      rattle: safe(() => {
        const ctx = eng()?.ctx; if (!ctx) return; const sr = ctx.sampleRate, dur = 4.6, n = Math.floor(sr * dur), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
        const click = (t, f, g) => { const i0 = Math.floor(t * sr), len = Math.floor(0.05 * sr); for (let i = 0; i < len && i0 + i < n; i++) { const x = i / sr; d[i0 + i] += ((Math.sin(2 * Math.PI * f * x) * 0.7 + Math.sin(2 * Math.PI * f * 2.31 * x) * 0.3) * Math.exp(-x / 0.011) + (Math.random() * 2 - 1) * Math.exp(-x / 0.002) * 0.3) * g; } };
        for (let i = 0; i < 520; i++) { const t = 0.2 + Math.random() ** 0.8 * 3.1; click(t, 2600 + Math.random() * 3600, (0.05 + Math.random() * 0.11) * (0.5 + 0.9 * Math.min(1, t / 1.8))); }
        for (let i = 0; i < 160; i++) { const t = 3.3 + Math.random(); click(t, 2200 + Math.random() * 3000, (0.04 + Math.random() * 0.08) * (1 - (t - 3.3))); }
        let lp = 0; for (let i = 0; i < n; i++) { const x = i / sr, env = clamp((x - 0.1) / 1.8) * clamp((4.5 - x) / 1.0); lp += 0.35 * ((Math.random() * 2 - 1) - lp); d[i] += lp * env * 0.12; }
        let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(d[i])); for (let i = 0; i < n; i++) d[i] /= Math.max(1, mx * 1.05);
        const s = ctx.createBufferSource(), g = ctx.createGain(); g.gain.value = 10 ** (-8 / 20); s.buffer = b; s.connect(g).connect(hotBus(eng())); s.start(ctx.currentTime + 0.02); s.onended = () => { try { s.disconnect(); g.disconnect(); } catch { } };
      }),
      photo: safe(() => { const o = out(-9); if (!o) return; blip(o, 0, 980, 0.35); [1318, 1568, 1976, 2637].forEach((f, j) => tone(o, f, f, 0.3 + j * 0.07, 0.25, { gain: 0.25 })); }),
      twinkle: safe(() => { const o = out(-14); if (!o) return; tone(o, 3200 + Math.random() * 800, 3800, 0, 0.08, { gain: 0.3 }); }),
    };
    return S;
  })();
  const speak = async (id) => {   // 声（別担当）。?upavoice=1 のときだけ、effects/upa_host/voice/<id>.ogg|wav があれば鳴らす。無ければ何もしない
    if (!VOICE) return; const ctx = eng()?.ctx; if (!ctx) return;
    for (const ext of ['ogg', 'wav']) {
      try { const r = await fetch(new URL(`../../../effects/upa_host/voice/${id}.${ext}`, import.meta.url)); if (!r.ok) continue; const b = await ctx.decodeAudioData(await r.arrayBuffer()); const s = ctx.createBufferSource(); s.buffer = b; s.connect(hotBus(eng())); s.start(); return; } catch { /* 声なしで続行 */ }
    }
  };

  // ---------------- 状態 ----------------
  const U = { active: false, t: 0, pressT: null, branch: null, press2T: null, switched: false, fired: new Set(), hold: null, exit: null, saved: null, done: false, pending: [] };
  const reset = () => { U.released = false; U.t = 0; U.pressT = null; U.branch = null; U.press2T = null; U.switched = false; U.fired = new Set(); U.hold = null; U.exit = null; U.done = false; U.pending = []; U.short = false; };
  const ASK_TIMEOUT = 12;
  // ---------------- 開始後のライブ案内（頭脳は upa_guide_1031.mjs、描くのはここ）----------------
  const sceneQuiet = () => { const g = game(); return !g || !['Ready', 'Flight', 'Effect'].includes(g.phase) || !!g.meterStatus || !!g.rouletteStatus || !!g.chainStatus || (g.lampCount ?? 0) >= 6 || g.secondsLeft <= 0 || !!lcd.jp?.model?.active || !!lcd.choiceV20?.active || !!lcd.rulesH?.hint?.state?.active; };   // 黙る場面（JP・メーター・ルーレット・結果/選択・継続・時間切れ・ワンポイント）
  const jpQuiet = () => U.active || controller.freezeRules || sceneQuiet() || !!FL?.busy;
  const GD = createGuide({ game: () => game(), quiet: jpQuiet, log });
  let FL = null;   // JP・継続の説明（upa_flow_1031）。drawSlime が要るので下で作る
  GD.setFrozen(() => !!controller.freezeRules);
  const Lv = { vis: false, art: null, tone: 'normal', small: false, t0: 0, last: null, outAt: null, presence: 0, dup: false, t: 0 };

  let begunFor = null;   // 2回目の客は札の段で冒頭が終わることがある。続く 'start' でもう一度始めない
  let preHide = false;   // START の札（スタート！60玉）の間も残り時間を隠す。冒頭に切れ目なくつなぐ
  const unHide = () => { if (preHide) { preHide = false; controller.howto = null; controller.howtoSeconds = 0; } };
  const begin = (atTicket = false) => {   // 10/31 開始の操作（ticket）で始める。払い出しの段は規則を止めず、'start'（Ready）で止める
    if (!R.ready || U.active) return false;
    const g = game(); begunFor = g; reset(); U.active = true; U.t = T.FALL - 0.25; U.lateFreeze = atTicket; U.short = !!controller.repeatVisit;
    preHide = false; U.saved = { howtoSeconds: 0, secs: g.secondsLeft, freeze: controller.freezeRules, game: g }; prebuild();
    controller.howtoSeconds = Infinity; controller.howto = { t: 0 };   // 時計の表示を隠す（timer_display は howto 中は出さない）。howtoSeconds=∞ で規則の開始処理は走らない
    controller.freezeRules = !atTicket; log('upa:begin', { repeat: U.short, atTicket });
    return true;
  };
  // 10/31 制限時間は最初の発射から。規則は変えず、発射まで残り秒を毎フレーム元に戻す
  let clockHold = null, clockDone = null;   // clockDone: 開始の案内と時計の保持は1ゲーム1回
  const clockStart = (why) => { if (!clockHold) return; clockHold = null; log('upa:clock-start', { why }); FL?.timeStart(); };
  const release = (why) => {   // 時計を動かす（冒頭の終わり）。冒頭の間に進んだ分があれば戻す
    if (!U.saved || U.released) return; U.released = true; const g = game();
    if (!String(why).startsWith('abort') && controller.game === U.saved.game && (g.phase === 'Ready' || g.phase === 'Effect')) g.secondsLeft = U.saved.secs;
    controller.howto = null; controller.howtoSeconds = U.saved.howtoSeconds; controller.freezeRules = U.saved.freeze === true ? true : false; log('upa:release', { why, secs: g.secondsLeft });
    if (!String(why).startsWith('abort') && clockDone !== g) { clockDone = g; GD.start({ repeat: why !== 'seat' }); FL?.begin({ repeat: !!U.short }); clockHold = { game: g, sec: g.secondsLeft, t: 0 }; }   // 説明の手順は「きく」の客だけ。きかない・2回目の客は、開始後のアドリブだけ
  };
  const finish = (why) => { release(why); GD.introEnded(); U.active = false; U.done = true; U.saved = null; U.released = false; };

  // ---------------- 入力：冒頭の間は左=fire・右=challenge を選択に使い、規則へは渡さない ----------------
  const dispatch0 = controller.dispatch.bind(controller);
  const choose = (side) => {   // 'L' | 'R'
    const t = U.t;
    if (U.branch === null && U.pressT === null) {   // 最初の質問（ボタンが出てから）
      if (t < T.BTN + 0.3 || t < T.PARK) return;
      U.pressT = t; U.branch = side === 'R' ? 'listen' : 'quit'; sfx.click(); log('upa:answer1', { side });   // 10/31 左=きかない／右=きく
    } else if (U.branch === 'quit' && U.press2T === null && tv() >= T.Q_BTN + 0.3) {   // 確認（左=だいじょうぶ／右=やっぱり きく）
      U.press2T = t; sfx.click(); if (side === 'R') { U.branch = 'listen'; U.switched = true; U.pressT = t; } log('upa:answer2', { side });
    }
  };
  controller.dispatch = (action, ...r) => {
    if (preHide) return false;
    const btn = ['fire', 'challenge', 'chainContinue', 'chainStop'].includes(action);
    if (FL?.asking && btn) { FL.answerPress(action === 'challenge' || action === 'chainContinue' ? 'R' : 'L'); return false; }   // JP・継続の問いの間は左右を選択に使う
    if (FL?.holding && btn) { FL.press(); return false; }   // 選択画面の説明の間は選ばせない（押すと飛ばす）。説明が終わると選択の秒も誤選択防止も頭から
    if (action === 'fire' && clockHold && !sceneQuiet()) clockStart('fire');
    if (!U.active && (action === 'fire' || action === 'challenge')) FL?.press();
    if (U.active && !U.released) { if (action === 'fire') { choose('L'); return false; } if (action === 'challenge') { choose('R'); return false; } return false; }
    if (action === 'fire' && !sceneQuiet()) { GD.S.introShowing = !!(U.active && U.hold && !U.exit); GD.press(); }
    if (U.active && U.hold && action === 'fire' && !U.exit) { if (U.t - U.hold.at >= 2.5) U.exit = { at: U.t }; else U.hold.pressed = true; }   // 台本の最後の文を読む時間は残す   // 最初のボタンでうぱは引っ込む（ボタン自体は規則へ通す）
    return dispatch0(action, ...r);
  };
  Object.defineProperty(controller, 'sideChoice', { configurable: true, get: () => (U.active && !U.released) || !!FL?.asking });   // 10/31 冒頭の きく|きかない の間だけ、実機・キーの左右を fire|challenge に分ける(r3ButtonAction／ui/choice_gate_1031)。それ以外は左右どちらも同じ

  // ---------------- 映像の時刻 ----------------
  const tv = () => {
    const t = U.t;
    if (U.pressT === null) return Math.min(t, T.PRESS - 0.01);
    if (U.branch === 'listen') return T.PRESS + (t - U.pressT);
    if (U.press2T === null) return Math.min(T.PRESS + (t - U.pressT), T.Q_PRESS - 0.1);
    return T.Q_PRESS + (t - U.press2T);
  };

  // ---------------- うぱの動き（映像の upa_state の移植。座標は液晶）----------------
  function upaState(t, ta) {
    const s = { face: ['face_normal', 0], m: MBIG, sx: 1, sy: 1, wob: 0, belly: 0, x: CX, y: GROUND, vis: true };
    const idle = () => ['face_normal', Math.floor(ta * 25 / 5) % 6], joy = () => ['face_joy', Math.floor(ta * 25 / 3) % 2 * 2], surp = (d = 4) => ['face_surprise', Math.floor(ta * 25 / d) % 2];
    const quit = U.branch === 'quit', listen = U.branch === 'listen';
    if (t < T.FALL) { s.vis = false; return s; }
    if (t < T.LAND) { const k = (t - T.FALL) / (T.LAND - T.FALL); Object.assign(s, { face: surp(3), sx: 0.9, sy: 1.18, y: lerp(-1500, GROUND, k * k) }); return s; }
    if (t < T.SHR) { const u = t - T.LAND, sy = spring(u, 0.46, 3.3, 1.9); Object.assign(s, { face: u < 0.35 ? surp(4) : (u < 1.1 ? joy() : idle()), sx: 1 + (1 - sy) * 0.8, sy, belly: 0.30 * Math.exp(-3.0 * u), wob: 22 * Math.exp(-3.0 * u) * (u > 0.05 ? 1 : 0.3) }); return s; }
    if (t < T.PARK) { const k = (t - T.SHR) / (T.PARK - T.SHR), e = easeOut(k), st = 1 + 0.2 * Math.sin(Math.PI * Math.min(1, k * 1.4)); Object.assign(s, { face: k < 0.6 ? joy() : idle(), m: lerp(MBIG, 10, e), y: lerp(GROUND, PARK, e) - 210 * hop(k), sx: 1 / Math.sqrt(st), sy: st, wob: 8 * (1 - k) }); return s; }
    const u = t - T.PARK, sy0 = 1 + 0.012 * Math.sin(ta * 3.1) + (u < 1.2 ? spring(u, 0.74, 5.5, 2.6) - 1 : 0);
    Object.assign(s, { face: idle(), m: 10, y: PARK, wob: 3.0 * Math.exp(-1.2 * Math.min(u, 6)) + 0.9, sy: sy0, sx: 1 + (1 - sy0) * 0.7, belly: 0.2 * Math.exp(-4 * u) });
    if (quit) {
      const P1 = T.PRESS, P2 = T.Q_PRESS, LA = T.LAUNCH;
      if (t >= P1 && t < P1 + 0.9) { const uu = t - P1, sy = spring(uu, 0.68, 5, 2.4); Object.assign(s, { face: uu < 0.5 ? surp() : idle(), sy, sx: 1 + (1 - sy) * 0.7, wob: 6 * Math.exp(-3 * uu) }); }
      if (t >= P2 && t < LA - 0.3) { const uu = t - P2, sy = uu < 1.2 ? spring(uu, 0.72, 4.5, 2.2) : 1 + 0.015 * Math.sin(uu * 6); Object.assign(s, { face: joy(), sy, sx: 1 + (1 - sy) * 0.7, wob: 5 * Math.exp(-2 * uu) + 0.6 }); }
      if (t >= LA - 0.3 && t < LA) { const k = (t - (LA - 0.3)) / 0.3, sy = lerp(1, 0.6, easeOut(k)); Object.assign(s, { face: joy(), sy, sx: 1 + (1 - sy) * 0.8 }); }
      if (t >= LA && t < LA + 0.9) { const k = (t - LA) / 0.5, st = 1 + 0.5 * Math.min(1, k * 2); Object.assign(s, { face: joy(), sy: st, sx: 1 / st ** 0.6, y: PARK - 1500 * Math.max(0, k) ** 1.6 }); if (t >= LA + 0.55) s.vis = false; }
      if (t >= LA + 0.9) s.vis = false;
      return s;
    }
    if (!listen) return s;
    const P = T.PRESS;
    if (t >= P && t < P + 0.8) { const uu = t - P, sy = spring(uu, 0.72, 5, 2.4); Object.assign(s, { face: joy(), sy, sx: 1 + (1 - sy) * 0.7, wob: 6 * Math.exp(-3 * uu) }); }
    if (t >= T.G_UP && t < T.G_LAND) { const k = (t - T.G_UP) / (T.G_LAND - T.G_UP), e = easeBack(k, 1.2), st = 1 + 0.14 * hop(k); Object.assign(s, { face: joy(), m: lerp(10, MBIG, Math.min(1, e)), y: lerp(PARK, GROUND, easeOut(k)), wob: 10 * Math.exp(-2 * (t - T.G_UP)), sy: st, sx: 1 / Math.sqrt(st) }); }
    if (t >= T.G_LAND && t < T.SHR2) { const uu = t - T.G_LAND, sy = spring(uu, 0.55, 3.4, 2.0); Object.assign(s, { face: uu < 1.6 ? joy() : idle(), m: MBIG, y: GROUND, sy, sx: 1 + (1 - sy) * 0.75, belly: 0.25 * Math.exp(-3 * uu), wob: 10 * Math.exp(-2 * uu) + 1.0 }); }
    if (t >= T.SHR2 && t < T.SHR2 + 0.9) { const k = (t - T.SHR2) / 0.9, e = easeOut(k), st = 1 + 0.12 * hop(k); Object.assign(s, { face: joy(), m: lerp(MBIG, 14, e), y: GROUND, sy: st, sx: 1 / Math.sqrt(st), wob: 6 * (1 - k) }); }
    if (t >= T.SHR2 + 0.9 && t < T.SEAT0) { const uu = t - T.SHR2 - 0.9, sy = uu < 0.8 ? spring(uu, 0.8, 6, 2.6) : 1 + 0.012 * Math.sin(ta * 3.1); Object.assign(s, { face: joy(), m: 14, y: GROUND - lampLift(t), sy, sx: 1 + (1 - sy) * 0.7, wob: 1.2 }); }
    if (t >= T.SEAT0 && t < T.SEAT0 + 1.0) { const k = (t - T.SEAT0) / 1.0, e = easeOut(k), st = 1 + 0.14 * hop(Math.min(1, k * 1.3)); Object.assign(s, { face: k < 0.6 ? joy() : idle(), m: lerp(14, 7, e), x: lerp(CX, 235, e), y: GROUND - 330 * hop(k), sy: st, sx: 1 / Math.sqrt(st), wob: 6 * (1 - k) }); }
    if (t >= T.SEAT0 + 1.0) { const uu = t - T.SEAT0 - 1.0, sy = uu < 0.8 ? spring(uu, 0.78, 6, 2.6) : 1 + 0.012 * Math.sin(ta * 3.1); Object.assign(s, { face: t < T.SEAT[1] ? joy() : idle(), m: 7, x: 235, y: GROUND, sy, sx: 1 + (1 - sy) * 0.7, wob: 1.0 }); }
    return s;
  }
  // 2回目の客：上から左下の席へ跳んでくる
  function upaShort(u, ta) {
    const s = { face: ['face_joy', Math.floor(ta * 25 / 3) % 2 * 2], m: 7, sx: 1, sy: 1, wob: 0, belly: 0, x: 235, y: GROUND, vis: true };
    if (u < 0) { s.vis = false; return s; }
    if (u < 0.8) { const k = u / 0.8; s.y = lerp(-300, GROUND, k * k); s.sy = 1.15; s.sx = 0.93; s.face = ['face_surprise', 0]; return s; }
    const uu = u - 0.8, sy = uu < 0.8 ? spring(uu, 0.72, 5.5, 2.5) : 1 + 0.012 * Math.sin(ta * 3.1); s.sy = sy; s.sx = 1 + (1 - sy) * 0.7; s.belly = 0.2 * Math.exp(-4 * uu); s.wob = 4 * Math.exp(-3 * uu) + 0.8; return s;
  }

  // ---------------- 描画の部品 ----------------
  const spriteFor = (name, idx, m) => {
    const ns = [24, 14, 10, 7]; let n = ns.reduce((a, q) => Math.abs(q - m) < Math.abs(a - m) ? q : a, ns[0]);
    const avail = (nn) => Object.keys(R.man).filter((k) => k.startsWith(name + '_') && R.man[k].n === nn).map((k) => +k.split('_')[2]);
    let list = avail(n); if (!list.length) { for (const nn of ns) { list = avail(nn); if (list.length) { n = nn; break; } } }
    if (!list.length) { name = 'face_joy'; list = avail(n); if (!list.length) return null; }
    const id = list.includes(idx) ? idx : list.reduce((a, q) => Math.abs(q - idx) < Math.abs(a - idx) ? q : a, list[0]);
    const key = `${name}_${id}_n${n}`; return { key, n, man: R.man[key], img: R.spr[key] };
  };
  function drawSlime(ctx, s, t, g = 1) {   // g=艶の度合い。落ち着いている間(0)は原画の画素そのまま（最近傍・整数倍）、動いている間だけ艶
    const sp = spriteFor(s.face[0], s.face[1], s.m); if (!sp?.img) return;
    const { man, img: lit, n, key } = sp, pl = R.plain[key] ?? lit, f = s.m / n, NS = 22, sh = man.h / NS;
    if (g < 0.03 && Math.abs(s.sx - 1) < 0.01 && Math.abs(s.sy - 1) < 0.01 && s.wob * (n / 8) < 0.3 && s.belly < 0.01 && Math.abs(f - 1) < 1e-3) {
      const sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false; ctx.drawImage(pl, Math.round(s.x - man.ax), Math.round(s.y - man.ay)); ctx.imageSmoothingEnabled = sm; return;
    }
    const pass = (im, al) => {
      ctx.globalAlpha = al;
      for (let i = 0; i < NS; i++) {
        const ys0 = i * sh, ym = ys0 + sh / 2, hg = clamp((man.ay - ym) / man.bodyH, 0, 1.3), h1 = clamp(hg);
        const sxl = s.sx * (1 + s.belly * (1 - h1) ** 1.5 - s.belly * 0.35 * h1), dx = s.wob * (n / 8) * Math.sin(t * 11 + hg * 5) * hg * f;
        ctx.drawImage(im, 0, ys0, man.w, sh, s.x + (0 - man.ax) * sxl * f + dx, s.y + (ys0 - man.ay) * s.sy * f, man.w * sxl * f, sh * s.sy * f + 1.5);
      }
      ctx.globalAlpha = 1;
    };
    if (g < 1) pass(pl, 1);
    if (g > 0) pass(lit, g);
  }
  const sprBubble = (d) => cached('wb' + d, () => { const c = mk(d + 8, d + 8), x = c.getContext('2d'), r = d / 2, m = (d + 8) / 2; const g = x.createRadialGradient(m, m, r * 0.6, m, m, r); g.addColorStop(0, 'rgba(215,240,255,.08)'); g.addColorStop(0.85, 'rgba(215,240,255,.25)'); g.addColorStop(1, 'rgba(235,250,255,.9)'); x.fillStyle = g; x.beginPath(); x.arc(m, m, r, 0, 7); x.fill(); x.fillStyle = 'rgba(255,255,255,.85)'; x.beginPath(); x.ellipse(m - r * 0.35, m - r * 0.35, r * 0.2, r * 0.13, -0.7, 0, 7); x.fill(); return c; });
  const sprDrop = (d) => cached('dp' + d, () => { const c = mk(d + 8, d + 8), x = c.getContext('2d'), r = d / 2, m = (d + 8) / 2; const g = x.createRadialGradient(m - r * 0.35, m - r * 0.4, r * 0.1, m, m, r); g.addColorStop(0, 'rgb(255,225,240)'); g.addColorStop(0.35, 'rgb(255,150,190)'); g.addColorStop(1, 'rgb(190,60,110)'); x.fillStyle = g; x.beginPath(); x.arc(m, m, r, 0, 7); x.fill(); x.fillStyle = 'rgba(255,255,255,.9)'; x.beginPath(); x.ellipse(m - r * 0.35, m - r * 0.4, r * 0.22, r * 0.14, -0.7, 0, 7); x.fill(); return c; });
  const sprButton = (col, pressed) => cached('bt' + col + pressed, () => {
    const d = 215, M = 40, Wc = d + 2 * M, c = mk(Wc, Wc), x = c.getContext('2d'), m = Wc / 2, r = d / 2;
    const ring = x.createLinearGradient(0, m - r * 1.18, 0, m + r * 1.18); ring.addColorStop(0, 'rgb(86,84,106)'); ring.addColorStop(1, 'rgb(40,38,52)'); x.fillStyle = ring; x.beginPath(); x.arc(m, m + d * 0.05, r * 1.18, 0, 7); x.fill();
    const cy = m - (pressed ? d * 0.02 : d * 0.06), g = x.createRadialGradient(m - r * 0.35, cy - r * 0.4, r * 0.05, m, cy, r);
    const [R0, G0, B0] = col; const k = (q) => `rgb(${Math.min(255, R0 * q) | 0},${Math.min(255, G0 * q) | 0},${Math.min(255, B0 * q) | 0})`;
    g.addColorStop(0, k(pressed ? 1.2 : 1.5)); g.addColorStop(0.5, k(pressed ? 0.8 : 1.0)); g.addColorStop(1, k(0.35)); x.fillStyle = g; x.beginPath(); x.arc(m, cy, r, 0, 7); x.fill();
    x.fillStyle = 'rgba(255,255,255,.75)'; x.beginPath(); x.ellipse(m - r * 0.38, cy - r * 0.45, r * 0.25, r * 0.14, -0.6, 0, 7); x.fill();
    return c;
  });
  const glowRing = (ctx, x, y, d, col, k) => { if (k <= 0.01) return; const g = ctx.createRadialGradient(x, y, d * 0.38, x, y, d * 0.85); g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(0.45, `rgba(${col},${0.55 * k})`); g.addColorStop(1, `rgba(${col},0)`); ctx.fillStyle = g; ctx.fillRect(x - d, y - d, d * 2, d * 2); };
  const star = (ctx, x, y, r, a) => { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a; ctx.fillStyle = 'rgb(255,255,235)'; ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x, y - r * 0.12); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r * 0.12); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.12, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.12, y); ctx.closePath(); ctx.fill(); ctx.restore(); };
  const photoSprite = () => cached('photo', () => {
    const w = 860, h = Math.round(w * 630 / 1200), B = 10, M = 48, Wc = w + 2 * B + 2 * M + 40, Hc = h + 2 * B + 2 * M + 40, c = mk(Wc, Hc), x = c.getContext('2d');
    x.translate(Wc / 2, Hc / 2); x.rotate(2 * Math.PI / 180); x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 24; x.shadowOffsetX = 8; x.shadowOffsetY = 10; x.fillStyle = '#fff'; x.fillRect(-w / 2 - B, -h / 2 - B, w + 2 * B, h + 2 * B); x.shadowColor = 'transparent'; x.drawImage(R.photo, -w / 2, -h / 2, w, h); return c;
  });
  const place = (ctx, c, cx, cy, a = 1, sc = 1) => { if (a <= 0.01 || sc <= 0.01) return; ctx.save(); ctx.globalAlpha = clamp(a); ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.drawImage(c, -c.width / 2, -c.height / 2); ctx.restore(); };
  const placeTip = (ctx, b, tx, ty, a, sc) => { if (a <= 0.01) return; ctx.save(); ctx.globalAlpha = clamp(a); ctx.translate(tx, ty); ctx.scale(sc, sc); ctx.drawImage(b.c, -b.tip.x, -b.tip.y); ctx.restore(); };
  const bubbleWin = (v, a, b) => (v >= a && v < b + 0.25) ? { p: Math.max(0.05, easeBack((v - a) / 0.25)), f: v >= b ? Math.max(0, 1 - (v - b) / 0.2) : 1 } : null;

  // ---------------- 毎フレーム ----------------
  const scratch = document.createElement('canvas'); scratch.width = W; scratch.height = H;
  const frame0 = lcd.frame.bind(lcd);
  const rnd = (i, k = 0) => frac(Math.sin(i * 12.9898 + k * 78.233) * 43758.5453);
  const cues = () => {   // 映像の時刻に結びつけた効果音
    const v = tv(), fire = (id, fn, at) => { if (v >= at && !U.fired.has(id)) { U.fired.add(id); fn(); } };
    fire('fall', () => sfx.fall(), T.FALL - 0.05); fire('land', () => sfx.land(), T.LAND); fire('hop', () => sfx.hop(), T.SHR); fire('park', () => sfx.park(), T.PARK);
    fire('askpop', () => { sfx.pop(740); speak('intro_ask'); }, T.ASK[0]); fire('btnpop', () => sfx.pop(1040, 0.3), T.BTN);
    if (U.branch === 'quit') {
      fire('surp', () => sfx.surprise(), T.PRESS + 0.05); fire('qpop', () => { sfx.pop(700); speak('intro_quit_confirm'); }, T.Q_CONF); fire('qbtn', () => sfx.pop(1040, 0.3), T.Q_BTN);
      if (U.press2T !== null) { fire('bye', () => { sfx.bye(); speak('intro_quit_bye'); }, T.Q_BYE); fire('crouch', () => sfx.crouch(), T.LAUNCH - 0.3); fire('launch', () => sfx.launch(), T.LAUNCH); }
    } else if (U.branch === 'listen') {
      fire('joy', () => sfx.joy(), T.PRESS + 0.05); fire('grow', () => sfx.grow(), T.G_UP); fire('thud', () => sfx.thud(), T.G_LAND - 0.05);
      fire('lst', () => { sfx.pop(740); speak('intro_listen'); }, T.EXPL[0]); fire('hop2', () => sfx.hop(), T.SHR2); fire('park2', () => sfx.park(), T.SHR2 + 0.9);
      fire('ballpop', () => { sfx.pop(900); speak('rule_goal'); }, T.BALLS[0]); fire('rattle', () => sfx.rattle(), T.BALLS[0] + 0.2);
      fire('photo', () => { sfx.photo(); speak('rule_prize'); }, T.SW[0]); for (let i = 0; i < 5; i++) fire('tw' + i, () => sfx.twinkle(), T.SW[0] + 0.9 + i * 0.55);
      fire('jpcpop', () => { sfx.pop(980); speak('rule_jp'); }, T.JPC[0]); fire('lamppop', () => { sfx.pop(1020); speak('rule_lamp'); }, T.LAMP[0]); fire('hop3', () => sfx.hop(), T.SEAT0); fire('seatpop', () => { sfx.pop(1040, 0.4); speak('rule_hands'); }, T.SEAT[0]);
    }
  };
  let shortStart = null;
  const prebuild = () => {   // 吹き出し・字・ボタン・写真は冒頭の始まり（通常画面だけの静かな間）に作っておく
    const L = LINES();
    Bub('ask', L.intro_ask, 92); Bub('conf', L.intro_quit_confirm, 92); Bub('bye', L.intro_quit_bye, 100); Bub('lst', L.intro_listen, 92, { tail: 'b' });
    Bub('ball', L.rule_goal, 96, { tail: 'b' }); Bub('sw', L.rule_prize, 84, { tail: 'b' }); Bub('jp', L.rule_jp, 78, { tail: 'b' }); Bub('lamp', L.rule_lamp, 80, { tail: 'b' }); Bub('seat', L.rule_hands, 64, { tail: 'bl', tailX: 0.07 }); Bub('rep', L.intro_repeat, 92, { tail: 'bl', tailX: 0.07 });
    for (const [tag, labs] of [['a', ['きかない', 'きく']], ['b', ['だいじょうぶ', 'やっぱり きく']]]) labs.forEach((lab, side) => { Lab('lab' + tag + side, lab, lab === 'きく' ? 92 : 68); Lab(side ? 'subR' : 'subL', side ? '右ボタン' : '左ボタン', 44); });
    for (const col of [[60, 130, 255], [255, 70, 70]]) { sprButton(col, false); sprButton(col, true); }
    photoSprite(); for (const d of [8, 12, 16, 22, 30, 40, 52, 64]) sprDrop(d);
  };
  const draw = (dt) => {
    U.t += dt;
    const ctx = mainCtx, t = U.t, ta = t; let v = tv(); const L = LINES();
    // 区切り：時計を動かす・終わる
    if (!U.short) {
      if (U.branch === 'listen' && v >= T.SEAT[0] && !U.hold) { U.hold = { at: U.t }; release('seat'); }
      if (U.branch === 'quit' && U.press2T !== null && v >= T.LAUNCH && !U.released) release('quit');
      if (U.branch === 'quit' && U.press2T !== null && v >= T.LAUNCH + 1.0) { finish('quit-gone'); return; }
      if (U.hold && !U.exit && (t - U.hold.at > 10 || (t - U.hold.at >= 2.5 && (U.hold.pressed || GD.pending())))) U.exit = { at: t };
      if (U.exit && t - U.exit.at > 0.9) { finish('exit'); return; }
      // 押されないまま：12秒で「きく」
      if (U.pressT === null && t > T.BTN + ASK_TIMEOUT) choose('R');
      if (U.branch === 'quit' && U.press2T === null && tv() >= T.Q_BTN + 0.3 && t - (U.pressT + (T.Q_BTN + 0.3 - T.PRESS)) > ASK_TIMEOUT) choose('R');
    } else {
      if (shortStart === null) shortStart = t;
      if (!U.hold && t > 1.0) { U.hold = { at: t }; release('short'); }
      if (U.hold && !U.exit && t - U.hold.at > 3.2) U.exit = { at: t };
      if (U.exit && t - U.exit.at > 0.9) { shortStart = null; finish('short-exit'); return; }
    }
    if (!U.short) cues(); else if (!U.fired.has('s')) { U.fired.add('s'); sfx.fall(); setTimeout(() => sfx.land(), 650); speak('intro_repeat'); }
    v = tv();
    ctx.save(); ctx.translate(PX, PY); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    // 着地の揺れとフラッシュ
    if (!U.short) for (const [tl, amp] of [[T.LAND, 1], [T.G_LAND, 0.6]]) {
      if (tl === T.G_LAND && U.branch !== 'listen') continue; const u = v - tl;
      if (u >= 0 && u < 0.6) { const dx = Math.round(10 * amp * Math.exp(-7 * u) * Math.sin(55 * u)), dy = Math.round(18 * amp * Math.exp(-6 * u) * Math.cos(45 * u)); const sx = scratch.getContext('2d'); sx.drawImage(lcd.canvas, PX, PY, W, H, 0, 0, W, H); ctx.drawImage(scratch, dx, dy); }
      if (u >= 0 && u < 0.15) { ctx.fillStyle = `rgba(255,255,255,${0.3 * amp * (1 - u / 0.15)})`; ctx.fillRect(0, 0, W, H); }
    }
    // 水の泡
    const bubbles = (t0s, n) => { for (let i = 0; i < n; i++) { const t0 = t0s + rnd(i, 1) * 0.25, life = 1.4 + rnd(i, 2), uu = v - t0; if (uu < 0 || uu > life) continue; const d = Math.round(20 + rnd(i, 3) * 68), x = rnd(i, 4) * W + (rnd(i, 5) - 0.5) * 160 * uu, y = GROUND - 30 - (260 + rnd(i, 6) * 520) * uu; ctx.globalAlpha = 0.9 * (1 - uu / life) ** 0.7; const b = sprBubble(d); ctx.drawImage(b, x - b.width / 2, y - b.height / 2); ctx.globalAlpha = 1; } };
    if (!U.short) { bubbles(T.LAND, 30); if (U.branch === 'listen') bubbles(T.G_LAND, 16); }
    // 玉の大放出（うぱの後ろ）
    if (!U.short && U.branch === 'listen' && v >= T.BALLS[0] - 0.05 && v < T.BALLS[1] + 0.3) {
      const meta = R.fallMeta, f = clamp(Math.round((v - T.BALLS[0]) * meta.fps), 0, meta.frames - 1), fp = Math.max(0, f - 1), N = meta.balls, D = 68;
      const sh = cached('ballsh', () => { const c = mk(D + 16, D + 16), x = c.getContext('2d'); const g = x.createRadialGradient(D / 2 + 8, D / 2 + 8, D * 0.3, D / 2 + 8, D / 2 + 8, D * 0.55); g.addColorStop(0, 'rgba(0,0,20,.45)'); g.addColorStop(1, 'rgba(0,0,20,0)'); x.fillStyle = g; x.fillRect(0, 0, D + 16, D + 16); return c; });
      const idx = []; for (let i = 0; i < N; i++) { const x = R.fall[(f * N + i) * 2], y = R.fall[(f * N + i) * 2 + 1]; if (x === -32768 || y < -80) continue; idx.push([i, x, y]); }
      idx.sort((a, b) => a[2] - b[2]);
      for (const [i, x, y] of idx) ctx.drawImage(sh, x - sh.width / 2 + 6, y - sh.height / 2 + 8);
      for (const [i, x, y] of idx) {
        const yp = R.fall[(fp * N + i) * 2 + 1], vy = yp === -32768 ? 0 : y - yp, im = R.ball[i % 2];
        ctx.save(); ctx.translate(x, y); ctx.rotate((i * 0.9) % 6.283); if (vy > 35) { ctx.globalAlpha = 0.2; ctx.drawImage(im, -D / 2, -D / 2 - vy * 1.0, D, D); ctx.drawImage(im, -D / 2, -D / 2 - vy * 2.0, D, D); ctx.globalAlpha = 1; } ctx.drawImage(im, -D / 2, -D / 2, D, D); ctx.restore();
      }
    }
    // うぱ
    const s = U.short ? upaShort(t - 0.0, ta) : upaState(v, ta);
    if (U.exit) { const k = clamp((t - U.exit.at) / 0.9); if (!U.short || true) { const e = k * k; s.y = (U.short ? GROUND : GROUND) - 1500 * e * (k > 0.25 ? 1 : 0) - 120 * hop(Math.min(1, k * 4)); const st = 1 + 0.4 * Math.min(1, k * 2); s.sy *= st; s.sx *= 1 / st ** 0.6; if (k > 0.85) s.vis = false; } }
    if (s.vis) {
      if (s.y >= GROUND - 5) { const w = 560 * (s.m / MBIG) + 120; const g = ctx.createRadialGradient(s.x, GROUND - 6, 4, s.x, GROUND - 6, w * 0.5); g.addColorStop(0, 'rgba(0,0,30,.32)'); g.addColorStop(1, 'rgba(0,0,30,0)'); ctx.save(); ctx.translate(0, 0); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(s.x, GROUND - 6, w * 0.5, 22, 0, 0, 7); ctx.fill(); ctx.restore(); }
      const s2 = U.short ? upaShort(t - 0.04, ta - 0.04) : upaState(v - 0.04, ta - 0.04), mv = Math.abs(s.m - s2.m) + Math.abs(s.y - s2.y) + Math.abs(s.x - s2.x);
      let g = Math.min(1, Math.abs(s.sy - 1) * 3 + Math.abs(s.sx - 1) * 3 + s.wob / 5 + s.belly * 3 + (mv > 0.5 || U.exit ? 1 : 0)); if (g < 0.12) g = 0;
      drawSlime(ctx, s, t, g);
    }
    // 着地のしぶき
    const splash = (tl, n, scale) => { for (let i = 0; i < n; i++) { const uu = v - tl; if (uu < 0 || uu > 1.1) continue; const vx = (rnd(i, 7) - 0.5) * 1500 * scale, vy = -(450 + rnd(i, 8) * 900) * scale, d = Math.round((16 + rnd(i, 9) * 40) * scale * 1.2), x0 = CX + (rnd(i, 10) - 0.5) * 700; const sp = sprDrop(Math.max(8, d)); ctx.globalAlpha = Math.min(1, (1.1 - uu) * 3); ctx.drawImage(sp, x0 + vx * uu - sp.width / 2, GROUND - 60 + vy * uu + 1300 * uu * uu - sp.height / 2); ctx.globalAlpha = 1; } };
    if (!U.short) { splash(T.LAND, 22, 1); if (U.branch === 'listen') splash(T.G_LAND, 14, 0.7); }
    // 吹き出し・字・ボタン
    const tipUpa = { x: CX, y: PARK + 22 };
    if (!U.short) {
      const askEnd = U.pressT !== null ? (U.branch === 'listen' && !U.switched ? T.PRESS + 0.3 : T.PRESS + 0.3) : 1e9;
      if (!U.switched) { const w = bubbleWin(v, T.ASK[0], U.pressT !== null ? T.PRESS + 0.05 : 1e9); if (w) placeTip(ctx, Bub('ask', L.intro_ask, 92), tipUpa.x, tipUpa.y, w.p * 1.5 * w.f, w.p); }
      const btns = (a, b, labL, labR, pressT, pside, tag) => {
        if (!(v >= a && v < b + 0.35)) return; const f = v >= b ? Math.max(0, 1 - (v - b) / 0.25) : 1, pp = easeBack((v - a) / 0.3);
        [[290, [255, 70, 70], labL, '左ボタン'], [862, [60, 130, 255], labR, '右ボタン']].forEach(([xl, col, lab, sub], side) => {
          const pressed = pressT !== null && side === pside && v >= pressT && v < pressT + 0.35, chosen = pressT !== null && v >= pressT;
          const alpha = f * Math.min(1, pp * 1.3) * (chosen && side !== pside ? 0.35 : 1), yb = 1105 + (pp >= 1 ? 0 : (1 - pp) * 120), sc = Math.max(0.05, pp);
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; glowRing(ctx, xl, yb, 215, col.join(','), (pressed ? 0.9 : 0.55 * (0.5 + 0.5 * Math.sin((ta) * 5))) * alpha); ctx.restore();
          const bs = sprButton(col, pressed); place(ctx, bs, xl, yb, alpha, 1);
          place(ctx, Lab('lab' + tag + side, lab, lab === 'きく' ? 92 : 68), xl, 935, alpha, sc);
          place(ctx, Lab(side ? 'subR' : 'subL', sub, 44), xl, 1248, alpha * 0.95, sc);
        });
        if (pressT !== null && v >= pressT && v < pressT + 0.6) { const uu = (v - pressT) / 0.6; ctx.save(); ctx.globalCompositeOperation = 'lighter'; glowRing(ctx, pside === 0 ? 290 : 862, 1105, 215 * (1 + uu * 1.4), '255,200,160', (1 - uu) * 0.9); ctx.restore(); }
      };
      if (!U.switched) btns(T.BTN, U.pressT !== null ? T.PRESS + 0.3 : 1e9, 'きかない', 'きく', U.pressT !== null ? T.PRESS : null, U.branch === 'listen' ? 1 : 0, 'a');
      if (U.branch === 'quit') {
        let w = bubbleWin(v, T.Q_CONF, U.press2T !== null ? T.Q_PRESS + 0.3 : 1e9); if (w) placeTip(ctx, Bub('conf', L.intro_quit_confirm, 92), tipUpa.x, tipUpa.y, w.p * 1.5 * w.f, w.p);
        btns(T.Q_BTN, U.press2T !== null ? T.Q_PRESS + 0.3 : 1e9, 'だいじょうぶ', 'やっぱり きく', U.press2T !== null ? T.Q_PRESS : null, 0, 'b');
        w = bubbleWin(v, T.Q_BYE, T.LAUNCH + 0.4); if (w && U.press2T !== null) placeTip(ctx, Bub('bye', L.intro_quit_bye, 100), tipUpa.x, tipUpa.y, w.p * 1.5 * w.f, w.p);
      } else if (U.branch === 'listen') {
        const TOPY = 520;
        let w = bubbleWin(v, T.EXPL[0], T.EXPL[1]); if (w) placeTip(ctx, Bub('lst', L.intro_listen, 92, { tail: 'b' }), CX, TOPY, w.p * 1.5 * w.f, w.p);
        w = bubbleWin(v, T.BALLS[0], T.BALLS[1]); if (w) placeTip(ctx, Bub('ball', L.rule_goal, 96, { tail: 'b' }), CX, 945, w.p * 1.5 * w.f, w.p);
        if (v >= T.SW[0] && v < T.SW[1] + 0.3) {
          const p = v >= T.SW[0] + 0.25 ? Math.max(0.05, easeBack((v - T.SW[0] - 0.25) / 0.4)) : 0, f = v >= T.SW[1] ? Math.max(0, 1 - (v - T.SW[1]) / 0.25) : 1;
          if (p > 0) { place(ctx, photoSprite(), CX, 345, Math.min(1, p * 1.5) * f, p); if (p >= 0.99) [[-300, -220, 0], [310, -200, 1.7], [-330, 190, 3.1], [300, 210, 4.4], [0, -250, 2.3]].forEach(([dx, dy, ph], j) => { const tw = Math.max(0, Math.sin((v - T.SW[0]) * 6 + ph)); if (tw > 0.1) star(ctx, CX + dx, 345 + dy, 26 + 16 * tw, tw * f); }); }
        }
        w = bubbleWin(v, T.SW[0], T.SW[1]); if (w) placeTip(ctx, Bub('sw', L.rule_prize, 84, { tail: 'b' }), CX, 948, w.p * 1.5 * w.f, w.p);
        const exitA = U.exit ? Math.max(0, 1 - (t - U.exit.at) / 0.3) : 1;
        w = bubbleWin(v, T.JPC[0], T.JPC[1]); if (w) placeTip(ctx, Bub('jp', L.rule_jp, 78, { tail: 'b' }), CX, 948, w.p * 1.5 * w.f, w.p);
        w = bubbleWin(v, T.LAMP[0], T.LAMP[1]);
        if (w) {   // 実際の7つのランプ（穴）を、液晶の下端の矢印で指す。穴のLEDそのものは光らせない
          placeTip(ctx, Bub('lamp', L.rule_lamp, 80, { tail: 'b' }), CX, 948 - lampLift(v), w.p * 1.5 * w.f, w.p);
          ctx.save(); ctx.globalAlpha = clamp(w.p * w.f); drawArrows(ctx, HOLE_X, GOLD, 1214, v - T.LAMP[0]); ctx.restore();
        }
        w = bubbleWin(v, T.SEAT[0], 1e9); if (w) placeTip(ctx, Bub('seat', L.rule_hands, 64, { tail: 'bl', tailX: 0.07 }), 235 + 10, GROUND - 290, w.p * 1.5 * w.f * exitA, w.p);
      }
    } else {
      const sv = Math.max(0, t - 0.8), w = bubbleWin(sv, 0.35, 99), exitA = U.exit ? Math.max(0, 1 - (t - U.exit.at) / 0.3) : 1;
      if (w) placeTip(ctx, Bub('rep', L.intro_repeat, 92, { tail: 'bl', tailX: 0.07 }), 235 + 10, GROUND - 290, w.p * 1.5 * exitA, w.p);
    }
    ctx.restore();
  };
  // 開始後のうぱ：左下の席にせり上がって吹き出しを出し、言い終わったら沈む。出ている間だけ液晶を2Dの面にする（それ以外は通常の経路のまま）
  const SEATX = 235, liveSeat = { x: SEATX, y: GROUND };
  FL = createUpaFlow(lcd, { controller, base: A, labels: (side) => R.txt['laba' + side], liveVisible: () => Lv.vis || !!(U.active && U.hold), sfx, log });
  // 10/31 「7このうち6こ」の間だけ、筐体の穴のランプを実演（順に流れる→6つ点灯・1つ消灯）。窓の外は元の処理のまま
  let holesHooked = false;
  const hookHoles = () => {
    const cl = lcd.cabinetLightScript; if (holesHooked || !cl) return; holesHooked = true;
    Object.defineProperty(cl, 'holeOverlay', (() => { let prev = cl.holeOverlay; return { configurable: true, enumerable: true, get: () => (v, ck) => {
      const uu = U.active && !U.short && U.branch === 'listen' ? tv() - T.LAMP[0] : -1;
      if (uu < 0 || tv() >= T.LAMP[1]) return prev ? prev(v, ck) : false;
      const set = (h, L) => { v[h * 3] = L; v[h * 3 + 1] = 0.82 * L; v[h * 3 + 2] = 0.42 * L; };
      if (uu < 1.5) for (let h = 0; h < 7; h++) { const d = (uu * 7 / 0.75) % 7 - h; set(h, d >= 0 && d < 1.6 ? 2.2 : 0.06); }
      else for (let h = 0; h < 7; h++) set(h, h === 3 ? 0 : Math.min(1, (uu - 1.5 - Math.abs(h - 3) * 0.08) / 0.12) > 0 ? 1.8 : 0.06);
      return true;
    }, set: (f) => { prev = f; } }; })());
  };
  const drawArrows = (ctx, xs, c1, y0, k) => { xs.forEach((x, i) => { const y = y0 + 6 * Math.sin(k * 7 - i * 0.5); for (const [col, g] of [[BROWN, 0], [c1, 6]]) { ctx.fillStyle = col; ctx.fillRect(x - 12 + g, y - 30 + g, 24 - 2 * g, 36 - g); for (let r = 0; r < 6; r++) { const hw = (6 - r) * 6 - g; if (hw > 0) ctx.fillRect(x - hw, y + 6 + r * 6, hw * 2, 6); } } }); };
  const updateLive = (dt) => {
    GD.tick(dt); const c = GD.cur;
    if (c && c.art && R.guide[c.art]) { if (!Lv.vis || Lv.art !== c.art || Lv.t0 !== c.t0) { if (!Lv.vis) Lv.presence = 0; Lv.vis = true; Lv.art = c.art; Lv.tone = c.tone; Lv.small = c.small; Lv.t0 = c.t0; Lv.t = 0; Lv.outAt = null; Lv.last = c; sfx.pop(c.tone === 'surp' ? 520 : 760, 0.25); speak(c.id); } }
    else if (Lv.vis && Lv.outAt === null) Lv.outAt = Lv.t;
    if (Lv.vis) { Lv.t += dt; Lv.presence = Lv.outAt === null ? Math.min(1, Lv.presence + dt / 0.28) : Math.max(0, Lv.presence - dt / 0.28); if (Lv.outAt !== null && Lv.presence <= 0) Lv.vis = false; }
  };
  const drawLive = () => {
    const ctx = mainCtx, m = R.guideMeta[Lv.art], im = R.guide[Lv.art]; if (!m || !im) return;
    const k = Lv.outAt === null ? Math.min(1, Lv.t / 0.3) : 1, p = Lv.outAt === null ? Math.max(0.05, easeBack(k)) : Math.max(0.05, Lv.presence), fade = Lv.outAt === null ? Math.min(1, k * 1.5) : Lv.presence;
    ctx.save(); ctx.translate(PX, PY); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    // うぱ（せり上がる）
    const pe = easeOut(Lv.presence), y = GROUND + (1 - pe) * 260, hopY = Lv.outAt === null && Lv.t < 0.5 ? -26 * Math.sin(Math.PI * Math.min(1, Lv.t / 0.5)) : 0;
    const face = Lv.tone === 'surp' ? 'face_surprise' : Lv.tone === 'joy' ? 'face_joy' : 'face_normal', s = { face: [face, 0], m: 7, sx: 1, sy: 1, wob: 0, belly: 0, x: SEATX, y: y + hopY, vis: true };
    const moving = (1 - pe) > 0.01 || hopY !== 0; drawSlime(ctx, s, Lv.t, moving ? 1 : 0);
    // 吹き出し：うぱの頭の上。画面からはみ出す幅は寄せる。小さく出す台詞は 0.8 倍。「dup_first_reset」は大きく中央寄り
    const big = Lv.art === 'dup_first_reset', sc = (Lv.small ? 0.8 : 1) * p, w = im.width * sc, tipx = big ? CX : SEATX + 10, tipy = big ? 760 : GROUND - 290, tx = (m.tip?.[0] ?? im.width / 2) * sc;
    let left = tipx - tx; left = clamp(left, 6, W - 6 - w); const ox = left + tx, oy = tipy;
    const lanes = GD.pointing(); if (lanes.length) { ctx.save(); ctx.globalAlpha = clamp(fade); drawArrows(ctx, lanes.map((d) => HOLE_X[d - 1]), '#ff5a4a', 1214, Lv.t); ctx.restore(); }
    ctx.save(); ctx.globalAlpha = clamp(fade); ctx.translate(ox, oy); ctx.scale(sc, sc); ctx.drawImage(im, -(m.tip?.[0] ?? im.width / 2), -(m.tip?.[1] ?? im.height)); ctx.restore();
    ctx.restore();
  };
  // 描画は液晶 canvas へ直接（first_timer の ?ftsplit=0 と同じ作法）。冒頭の間は GPU の映像経路でなく2Dの面で描かせる
  lcd.frame = (dt, F) => { const r = frame0(dt, F); if (clockHold) { const g = game(); if (g !== clockHold.game || !['Ready', 'Flight', 'Effect'].includes(g.phase)) clockHold = null; else { g.secondsLeft = clockHold.sec; clockHold.t += dt; if (clockHold.t >= CLOCK_IDLE_START) clockStart('idle'); } } hookHoles(); if (U.active) { try { draw(dt); } catch (e) { console.warn('[upa-host] draw', e); finish('error'); } } if (!U.active && R.ready) { try { FL?.tick(dt); } catch (e) { console.warn('[upa-flow]', e); controller.game?.endJpTutorial?.(); } try { updateLive(dt); if (Lv.vis) drawLive(); } catch (e) { console.warn('[upa-host] live', e); Lv.vis = false; GD.reset(); } } return r; };
  const hold0 = lcd.overlayHold;
  lcd.overlayHold = () => (U.active || Lv.vis ? true : (hold0 ? hold0() : false));
  const rev = Object.getOwnPropertyDescriptor(lcd, 'uploadRevision')?.get;
  if (rev) Object.defineProperty(lcd, 'uploadRevision', { configurable: true, enumerable: true, get: () => (U.active || Lv.vis ? undefined : rev.call(lcd)) });

  // ---------------- 出来事 ----------------
  if (lcd.firstTimer?.flags) lcd.firstTimer.flags[3] = false;   // 最初の10秒の迷い対策（流れる光＋「左のボタンを押してね」）はうぱの接客に置き換える
  const onEvent0 = lcd.onEvent.bind(lcd);
  lcd.onEvent = (id, p = {}) => {
    try {
      if (id === 'attract' || id === 'ticket') { if (U.active) finish('abort:' + id); }
      if (id === 'attract') { unHide(); FL?.reset(); clockHold = null; }
      if (id === 'ticket' && R.ready) { preHide = true; controller.howto = { t: 0 }; controller.howtoSeconds = Infinity; }
      GD.event(id, p); FL?.event(id);
      if (id === 'ticket' && R.ready && begin(true)) { const r = onEvent0(id, p); onEvent0('challenge_cancel', {}); return r; }   // 旧スタート札は出さない（challenge_cancel は札の場面を閉じる既存の口）
      if (id === 'start' && U.active && U.lateFreeze && !U.released) { U.lateFreeze = false; controller.freezeRules = true; if (U.saved) U.saved.secs = game().secondsLeft; }
      if (id === 'start' && !U.active) { if (begunFor === game() || !begin()) unHide(); /* 素材が間に合わなかったら冒頭なしで続行 */ }
    } catch (e) { console.warn('[upa-host] event', e); finish('error'); }
    return onEvent0(id, p);
  };
  lcd.upaHost = { state: U, flow: FL, guide: GD, live: Lv, ready: () => loading, assets: R, sPrize, lines: LINES, tv, dispose() { finish('dispose'); controller.dispatch = dispatch0; delete controller.sideChoice; lcd.onEvent = onEvent0; lcd.frame = frame0; lcd.overlayHold = hold0 ?? null; } };
  return lcd;
}
