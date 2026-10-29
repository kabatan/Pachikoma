// 新ルールH（連打メーター）の液晶の部品。仮の見た目（監督が手本を選ぶまで置き換え前提）。
// 既存の液晶・play.mjs・*_gpu_* には触れない。2D キャンバス（1152x1268 の液晶面）に重ねるだけの純粋な描画部品。
//
//   const m = createMeterH({ style: 'hokuto' | 'gundam' });
//   m.hit(lane)            // meterLand の hit=true で呼ぶ（弾ける +1 / 炎）
//   m.end(success)         // meterEnd で呼ぶ（成功: FULL CHARGE / MAX の叩きつけ。失敗: 何も足さない＝今のガラス割れの演出へ）
//   m.draw(ctx, dt, status)// 毎フレーム。status は game.meterStatus（meter 以外は null を渡す）
//   alarmLevel(status)     // 赤い警報の段（0/1/2）
//
// 手本（rules_v4 REFS.md）：
//   hokuto : 4A 真・北斗無双「無双チャージ」＝「あと◯個」＋残り時間＋入賞のたびの炎、満タンで FULL CHARGE
//   gundam_tetsuya（既定・監督決定 10/29）: カットインは 1A ガンダム逆シャア（「連打」の青い大字・PUSH・縦の「押せ！」）、
//            穴に入った瞬間は 1B 哲也（窓の6割の巨大な立体数字が叩きつけで入り、色が段ごとに変わる）。入った個数だけで溜まる（押した回数では動かさない）
//   gundam : 1A ガンダム「戦果UP」＝加算「+n」が弾け続け、白飛び→巨大「MAX」（ゲージは 1D の10目盛、色が青→緑→黄→金）
// くっきりした図形は使わない：字は多重縁＋にじみ、ゲージは目盛ごとの光の塊、警報は放射状のぼかし。
export const W = 1152, H = 1268;
export const FONT = '"Dela Gothic One", "Noto Sans CJK JP", sans-serif';

// ---- 赤い警報 ---------------------------------------------------------
// 発動の条件（提案。値は meterStatus と規則設定だけから決まる）
export const ALARM = {
  warnSeconds: 3.0,     // 段1：残りがこれ以下でまだ足りない（連打中のみ。導入・着地待ちは出さない）
  urgentSeconds: 1.5,   // 段2：さらに切迫（脈が速く、強く）
  periodWarn: 0.9,      // 「ブオン、ブオン」の周期（秒）
  periodUrgent: 0.6,
};
export function alarmLevel(st, cfg = ALARM) {
  if (!st || st.stage !== 'firing') return 0;
  if (st.count >= st.threshold) return 0;
  if (st.timeLeft > cfg.warnSeconds) return 0;
  return st.timeLeft <= cfg.urgentSeconds ? 2 : 1;
}
// 1 周期の包絡：立ち上がり 0.10・ゆっくり減衰（ブオン…）。0..1
export function pulse(t, period) {
  const u = (t % period) / period, a = 0.10;
  return u < a ? Math.sin((u / a) * Math.PI / 2) : Math.exp(-(u - a) * 4.2);
}
export function drawAlarm(ctx, level, t, w = W, h = H) {
  if (!level) return;
  const period = level === 2 ? ALARM.periodUrgent : ALARM.periodWarn;
  const e = pulse(t, period), k = level === 2 ? 1.0 : 0.78;
  ctx.save();
  // 谷では少し暗く（脈の山を際立たせる）
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgba(20,0,4,${0.20 * (1 - e) * k})`; ctx.fillRect(0, 0, w, h);
  // 全面を赤へ寄せる（乗算：明るい背景でも赤く見える）＋ほんの少し発光
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgb(255,${Math.round(255 - 185 * e * k)},${Math.round(255 - 195 * e * k)})`; ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = `rgba(150,0,6,${0.22 * e * k})`; ctx.fillRect(0, 0, w, h);
  // 縁から中へ入る赤（放射グラデーション・ぼかしのみ。通常合成で濃く）
  ctx.globalCompositeOperation = 'source-over';
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.20, w / 2, h / 2, Math.hypot(w, h) * 0.55);
  g.addColorStop(0, 'rgba(255,40,30,0)'); g.addColorStop(0.55, `rgba(200,10,10,${0.30 * e * k})`); g.addColorStop(1, `rgba(150,0,6,${0.88 * e * k})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // 上下の縁の回転灯のような広いぼかし
  for (const [y0, y1] of [[0, h * 0.20], [h, h * 0.80]]) {
    const gg = ctx.createLinearGradient(0, y0, 0, y1);
    gg.addColorStop(0, `rgba(255,30,24,${0.70 * e * k})`); gg.addColorStop(1, 'rgba(255,30,24,0)');
    ctx.fillStyle = gg; ctx.fillRect(0, Math.min(y0, y1), w, Math.abs(y1 - y0));
  }
  ctx.restore();
}

// ---- 字（多重縁＋にじみ）-----------------------------------------------
export function fancy(ctx, str, x, y, size, { stops, edge = '#fff', dark = '#18030a', glow = 'rgba(255,210,90,.8)', blur = 0.12, align = 'center', skew = 0, sw = 1 } = {}) {
  ctx.save();
  ctx.font = `${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.translate(x, y); if (skew) ctx.transform(1, 0, skew, 1, 0, 0);
  ctx.shadowColor = glow; ctx.shadowBlur = size * blur * 1.6;
  ctx.strokeStyle = dark; ctx.lineWidth = size * 0.2 * sw; ctx.strokeText(str, 0, 0);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = edge; ctx.lineWidth = size * 0.1 * sw; ctx.strokeText(str, 0, 0);
  ctx.strokeStyle = dark; ctx.lineWidth = size * 0.035 * sw; ctx.strokeText(str, 0, 0);
  const g = ctx.createLinearGradient(0, -size * 0.5, 0, size * 0.5);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g; ctx.fillText(str, 0, 0);
  ctx.restore();
}
const GOLD = [[0, '#fffbe0'], [0.3, '#ffe071'], [0.5, '#e69a12'], [0.52, '#7a3c00'], [0.7, '#ffbd2e'], [1, '#fff0a0']];
const SILVER = [[0, '#ffffff'], [0.4, '#eaeaff'], [0.5, '#9a9acb'], [0.52, '#34285f'], [0.7, '#e6e6ff'], [1, '#ffffff']];
const RED = [[0, '#fff0e0'], [0.3, '#ff8a58'], [0.5, '#e8200c'], [0.52, '#5c0006'], [0.75, '#ff4a2a'], [1, '#ffd8b8']];
const mmss = (s) => { s = Math.max(0, s); return `${Math.floor(s).toString().padStart(2, '0')}.${Math.floor((s % 1) * 100).toString().padStart(2, '0')}`; };

// 光の溜まり（楕円の放射グラデーションを加算で重ねるだけ。線・縁を持たない）
function glow(ctx, x, y, rx, ry, [r, g, b], a) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.translate(x, y); ctx.scale(1, ry / rx);
  const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  gr.addColorStop(0, `rgba(${r},${g},${b},${a})`); gr.addColorStop(0.45, `rgba(${r},${g},${b},${a * 0.45})`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

// ---- メーター ----------------------------------------------------------
export const CUT = { pre: 0.4, hold: 1.8, oshi: [0.7, 1.6] };   // カットイン：連打開始の pre 秒前から hold 秒後まで。縦の「押せ！」はその間の oshi 区間
const STEP_COL = ['#c04cff', '#35e070', '#ff4a3a', '#ffd24a', '#4ac8ff', '#ff7ad0', '#ffffff'];   // 哲也：段ごとに 紫→緑→赤…
const isGundam = (s) => s === 'gundam' || s === 'gundam_tetsuya';
export function createMeterH({ style = 'gundam_tetsuya', seed = 1, sprites = null } = {}) {   // sprites = { digits: [Image x7], max: Image }（rules_h_assets/gem_*.png：艶のある宝石色の面＋金の押し出し）
  let hitK = 0, tsparks = [];
  let t = 0, pops = [], sparks = [], endAt = -1, endOk = false, lastCount = 0, rnd = seed;
  const R = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
  return {
    style,
    hit(lane = 4, n = 1) {
      hitK++;
      for (let i = 0; i < 40; i++) tsparks.push({ at: t, a: R() * Math.PI * 2, v: 200 + R() * 700, r: 10 + R() * 22, k: hitK });
      pops.push({ k: hitK, at: t, n, x: 160 + R() * 830, y: 330 + R() * 520, rot: (R() - 0.5) * 0.5, col: ['#ff6fc0', '#5cf08a', '#62b8ff', '#ffe060'][Math.floor(R() * 4)] });
      for (let i = 0; i < 14; i++) sparks.push({ at: t, x: 576, y: 760, a: R() * Math.PI * 2, v: 160 + R() * 420 });
    },
    end(ok) { endAt = t; endOk = !!ok; },
    // ガンダム系のカットイン（連打・PUSH・押せ！）。HUD とは別に、場面が雷の導入でなければ出す（映像が規則より遅れても見える）
    drawCut(ctx, st) { if (st && isGundam(style) && endAt < 0) { ctx.save(); this._cutin(ctx, st); ctx.restore(); } },
    reset() { hitK = 0; tsparks = []; pops = []; sparks = []; endAt = -1; lastCount = 0; },
    get finishing() { return endAt >= 0; },
    draw(ctx, dt, st) {
      t += dt;
      // 赤い警報は部品の下に敷く（呼び出し側が alarm を別に描くときは draw の前に drawAlarm）
      if (endAt >= 0 && t - endAt > 1.4) endAt = -1;   // 満タンの叩きつけは 1.4 秒で終わり、あとは映像のつなぎへ
      if (!st && endAt < 0) return;
      const since = endAt >= 0 ? t - endAt : -1;
      ctx.save();
      if (style === 'hokuto') this._hokuto(ctx, st, since); else this._gundam(ctx, st, since, style === 'gundam_tetsuya');
      ctx.restore();
      if (since >= 0 && endOk) this._finish(ctx, since);
    },
    _clock(ctx, st, size = 120, y = 150) {
      if (!st) return;
      const low = st.timeLeft <= ALARM.warnSeconds && st.stage === 'firing';
      fancy(ctx, mmss(st.stage === 'firing' ? st.timeLeft : 0), 576, y, size, { stops: low ? RED : GOLD, glow: low ? 'rgba(255,40,30,.9)' : 'rgba(255,210,90,.8)' });
    },
    _hokuto(ctx, st, since) {
      if (st && since < 0) {
        const need = Math.max(0, st.threshold - st.count);
        if (st.stage === 'intro') { if ((st.introLeft ?? 0) <= 0.9) fancy(ctx, '連打', 576, 640, 260, { stops: GOLD, skew: -0.12 }); return; }
        this._clock(ctx, st);
        // 「あと ◯ 個」(4A) ：数字は入るたびに弾む
        const bump = 1 + 0.32 * Math.exp(-(t - (pops.at(-1)?.at ?? -9)) * 9);
        // 題字（「4を狙え!!」＝映像側。y≈700〜960）の下に分ける：残り個数は画面の下端寄り（y≈1005〜1235）
        fancy(ctx, 'あと', 300, 1150, 100, { stops: GOLD });
        fancy(ctx, String(need), 576, 1122, 230 * bump, { stops: GOLD, glow: 'rgba(255,150,30,.9)' });
        fancy(ctx, '個', 850, 1150, 100, { stops: GOLD });
        // 入賞の炎（数字の左で弾ける）
        for (const s of sparks) { const a = t - s.at; if (a > 0.6) continue; const x = s.x + Math.cos(s.a) * s.v * a, y = s.y + Math.sin(s.a) * s.v * a - 80 * a;
          const g = ctx.createRadialGradient(x, y, 0, x, y, 26 * (1 - a / 0.6) + 4); g.addColorStop(0, `rgba(255,230,140,${1 - a / 0.6})`); g.addColorStop(1, 'rgba(255,90,10,0)');
          ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(x - 40, y - 40, 80, 80); }
        ctx.globalCompositeOperation = 'source-over';
      }
    },
    _gundam(ctx, st, since, tet = false) {
      if (st && since < 0) {
        if (st.stage === 'intro') return;   // 導入中のカットインは drawCut（映像の場面に合わせて呼び出し側が出す）
        this._clock(ctx, st, 100, 120);
        // ゲージ（1D の色の移り変わり）：輪郭の線を持たない「光の溜まり」。目盛は溜まりの高さの段差で表す。
        // 灯っていない目盛はほのかな冷たい光、灯った目盛は 白い芯＋色のにじみ＋立ちのぼる光の筋と粒。
        const n = st.threshold, cols = [[60, 200, 255], [60, 235, 190], [110, 245, 90], [205, 240, 60], [255, 200, 50]], gx = 70, gw = W - 140, by = 1150, cw = gw / n;
        const lastHit = pops.at(-1)?.at ?? -9;
        for (let i = 0; i < n; i++) {
          const cx = gx + cw * (i + 0.5), lvl = 46 + (n > 1 ? 70 * i / (n - 1) : 0), c = cols[Math.min(4, Math.floor(i / Math.max(1, n) * 5))], on = i < st.count;
          if (!on) { glow(ctx, cx, by, cw * 0.62, 34, [120, 100, 230], 0.20); continue; }
          const fresh = i === st.count - 1 ? Math.exp(-(t - lastHit) * 5) : 0;
          glow(ctx, cx, by - lvl * 0.2, cw * (0.85 + 0.2 * fresh), lvl + 70, c, 0.55 + 0.3 * fresh);       // 外のにじみ
          glow(ctx, cx, by - lvl * 0.15, cw * 0.55, lvl * 0.9, c, 0.85);                                    // 中の光
          glow(ctx, cx, by - lvl * 0.05, cw * 0.32, lvl * 0.55, [255, 255, 255], 0.95);                    // 白い芯
          // 立ちのぼる光の筋と粒（時間で流れる。輪郭なし）
          for (let k = 0; k < 7; k++) {
            const ph = ((t * (0.35 + 0.1 * k) + k * 0.37 + i * 0.21) % 1), x = cx + Math.sin(t * 2 + k * 2.1 + i) * cw * 0.28, y = by - lvl * 0.3 - ph * (lvl + 190);
            glow(ctx, x, y, 7 + 5 * (1 - ph), 12 + 8 * (1 - ph), c, 0.75 * (1 - ph));
          }
          glow(ctx, cx, by - lvl - 70, cw * 0.14, 110 + 40 * fresh, c, 0.35 + 0.3 * fresh);                 // 立ち上る筋
        }
        if (tet) { this._tetHits(ctx, st, gx, cw, by); return; }
        // +n の弾け（1A）：画面のあちこちで 0.5 秒
        for (const p of pops) { const a = t - p.at; if (a > 0.7) continue; const s = 1 + 1.3 * Math.exp(-a * 9) * 0.6, al = Math.min(1, (0.7 - a) / 0.3);
          ctx.save(); ctx.globalAlpha = al; ctx.translate(p.x, p.y - a * 60); ctx.rotate(p.rot);
          fancy(ctx, `+${p.n}`, 0, 0, 170 * s, { stops: [[0, '#fff'], [0.45, p.col], [0.52, '#201040'], [1, p.col]], glow: p.col }); ctx.restore(); }
      }
    },
    // 1A ガンダム逆シャア：左上の大きな半透明の泡（その中に PUSH）の前に、不透明な青い金属質の「連打」。連打が引いたあとに、短く炎字の「押せ！」
    _cutin(ctx, st) {
      const elapsed = st.stage === 'firing' ? st.seconds - st.timeLeft : -(st.introLeft ?? 9);
      const age = elapsed + CUT.pre, total = CUT.hold + CUT.pre; if (age < 0 || age > total) return;
      const rendaEnd = CUT.oshi[0] + CUT.pre + 0.35, k = Math.min(1, age / 0.05);   // 連打は 押せ の手前まで（引く 0.25 秒）
      if (age < rendaEnd) {
        const out = Math.min(1, Math.max(0, (rendaEnd - age) / 0.25)), sl = age < 0.14 ? 1.7 - 0.7 * (age / 0.14) ** 2 : 1 + 0.03 * Math.sin(age * 9);
        // 大きな半透明の泡（「連打」の後ろの左上）。縁・光はにじませる
        ctx.save(); ctx.globalAlpha = out * k * 0.95;
        const bx = 400, by = 470, br = 360 * (1 + 0.015 * Math.sin(age * 8));
        let g = ctx.createRadialGradient(bx - 60, by - 90, br * 0.1, bx, by, br);
        g.addColorStop(0, 'rgba(190,255,242,.46)'); g.addColorStop(0.6, 'rgba(70,230,205,.52)'); g.addColorStop(0.9, 'rgba(30,190,205,.72)'); g.addColorStop(1, 'rgba(30,190,205,0)');
        ctx.fillStyle = g; ctx.fillRect(bx - br, by - br, br * 2, br * 2);
        ctx.shadowColor = 'rgba(200,255,255,.9)'; ctx.shadowBlur = 22; ctx.strokeStyle = 'rgba(235,255,255,.55)'; ctx.lineWidth = 9;
        ctx.beginPath(); ctx.arc(bx, by, br * 0.93, Math.PI * 0.95, Math.PI * 1.55); ctx.stroke();      // 左上のガラスの反射の弧
        ctx.beginPath(); ctx.arc(bx, by, br * 0.93, Math.PI * 0.05, Math.PI * 0.32); ctx.stroke(); ctx.restore();
        // PUSH（泡の中。灰色の縁に半透明の白）
        ctx.save(); ctx.globalAlpha = out * k * 0.9;
        fancy(ctx, 'PUSH', bx + 10, by - 100, 150, { stops: [[0, '#f4fffd'], [0.5, '#c8ece8'], [1, '#9cc8c4']], glow: 'rgba(120,255,235,.6)', dark: '#1a2a30', edge: '#7a8a92', sw: 0.45, blur: 0.05 }); ctx.restore();
        // 青い金属質の「連打」（不透明。上が明るく下が濃い艶、白銀の縁＋黒の外縁）
        ctx.save(); ctx.globalAlpha = out * k; ctx.translate(480, 590); ctx.scale(sl, sl);
        fancy(ctx, '連打', 0, 0, 400, { stops: [[0, '#f2fcff'], [0.22, '#8ad8ff'], [0.46, '#2d8cf0'], [0.5, '#06235e'], [0.58, '#1b5fd0'], [0.8, '#4aa8ff'], [1, '#d4f0ff']], glow: 'rgba(80,180,255,.9)', skew: -0.12, blur: 0.14, sw: 0.62, edge: '#e8eaf0', dark: '#050a1c' });
        if (Math.sin(age * 34) > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.16 * out; fancy(ctx, '連打', 0, 0, 400, { stops: [[0, '#fff'], [1, '#fff']], glow: 'rgba(0,0,0,0)', skew: -0.12, sw: 0.0001, edge: 'rgba(0,0,0,0)', dark: 'rgba(0,0,0,0)' }); }   // 点滅は明るさで（字は透かさない）
        ctx.restore();
      }
      // 縦でなく大きく中央に「押せ！」（炎字）。連打が引いたあと
      const o0 = CUT.oshi[0] + CUT.pre + 0.35;
      if (age >= o0 && age <= total) {
        const a2 = age - o0, kk = Math.min(1, a2 / 0.08), out2 = Math.min(1, (total - age) / 0.25), sc2 = a2 < 0.12 ? 1.6 - 0.6 * (a2 / 0.12) ** 2 : 1;
        ctx.save(); ctx.globalAlpha = kk * out2; ctx.translate(576 + Math.sin(a2 * 80) * 4, 590); ctx.scale(sc2, sc2);
        fancy(ctx, '押せ！', 0, 0, 330, { stops: [[0, '#fff6c0'], [0.3, '#ffcf2a'], [0.5, '#ff5a10'], [0.52, '#5a0a00'], [0.75, '#ff3a10'], [1, '#ffd890']], glow: 'rgba(255,90,20,.95)', dark: '#2a0400', sw: 0.55 });
        ctx.restore();
      }
    },
    // 1B 哲也：穴に入るたび、巨大な立体数字（入った個数）が叩きつけで入り、段ごとに色が変わる。数字は小さな光の溜まり（目盛）へ吸い込まれる。押した回数では何も動かない
    _tetHits(ctx, st, gx, cw, by) {
      for (const p of pops) {
        if (p.k >= st.threshold) continue;   // 最後の1個は満タン(FULL CHARGE/MAX)に任せる
        const a = t - p.at; if (a > 1.35) continue;
        const col = STEP_COL[(p.k - 1) % STEP_COL.length], tx = gx + cw * (p.k - 0.5);
        // 白い閃光
        if (a < 0.1) { ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - a / 0.1)})`; ctx.fillRect(0, 0, W, H); }
        // 数字
        const slam = a < 0.12, hold = a < 0.95, u = Math.max(0, (a - 0.95) / 0.38), eu = u * u;
        let sc = slam ? 2.6 - 1.6 * (a / 0.12) ** 2 : hold ? 1 + 0.07 * Math.exp(-(a - 0.12) * 9) * Math.cos((a - 0.12) * 34) : 1 - 0.82 * eu;
        const sh = !slam && hold ? 16 * Math.exp(-(a - 0.12) * 14) : 0, ox = Math.sin(a * 110) * sh, oy = Math.cos(a * 93) * sh;
        const x = hold ? 576 + ox : 576 + (tx - 576) * eu, y = hold ? 590 + oy : 590 + (by - 590) * eu, al = hold ? 1 : 1 - eu;
        ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc); ctx.globalAlpha = al;
        const numeral = (dy, alpha) => { ctx.save(); ctx.globalAlpha = al * alpha; ctx.translate(0, dy);
          const im = sprites?.digits?.[(p.k - 1) % 7];
          if (im) ctx.drawImage(im, -im.width / 2, -im.height / 2);   // 宝石色の面・斜めの光の筋・細い黒縁・金の押し出し・柔らかい発光（段ごとに色替え）
          else fancy(ctx, String(p.k), 0, 0, 480, { stops: [[0, '#ffffff'], [0.3, col], [0.5, col], [0.52, '#160630'], [0.75, col], [1, '#ffffff']], glow: col, edge: '#fff', dark: '#160630', blur: 0.1 });
          ctx.restore(); };
        if (slam) for (let i = 5; i >= 1; i--) numeral(-i * 46 * (1 - a / 0.12), 0.22 / i);   // 縦の残像（速さ）
        numeral(0, 1);
        ctx.restore();
        // 火花（加算のにじみ）
        ctx.globalCompositeOperation = 'lighter';
        for (const s of tsparks) { if (s.k !== p.k) continue; const sa = t - s.at; if (sa > 0.8) continue; const d = s.v * (1 - Math.exp(-sa * 5)) / 5;
          const gx2 = 576 + Math.cos(s.a) * d, gy2 = 590 + Math.sin(s.a) * d + 140 * sa * sa, rr = s.r * (1 - sa / 0.8) + 3, g = ctx.createRadialGradient(gx2, gy2, 0, gx2, gy2, rr * 2);
          g.addColorStop(0, `rgba(255,255,255,${0.9 * (1 - sa / 0.8)})`); g.addColorStop(0.4, col + '99'); g.addColorStop(1, 'rgba(255,200,100,0)'); ctx.fillStyle = g; ctx.fillRect(gx2 - rr * 2, gy2 - rr * 2, rr * 4, rr * 4); }
        ctx.globalCompositeOperation = 'source-over';
      }
    },
    _finish(ctx, since) {
      // 満タン：白飛び(0.4秒)→巨大な語を叩きつけ→保持（4A FULL CHARGE / 1A MAX）。ルーレットへ渡るまで
      const label = style === 'hokuto' ? 'FULL CHARGE' : 'MAX';   // gundam / gundam_tetsuya は MAX
      const sc = since < 0.18 ? 1.8 - since / 0.18 * 0.8 : 1 + 0.02 * Math.sin(since * 8);
      ctx.save(); ctx.globalAlpha = Math.min(1, since / 0.06);
      if (style !== 'hokuto' && sprites?.max) { ctx.save(); ctx.translate(576, 600); ctx.scale(sc, sc); ctx.drawImage(sprites.max, -sprites.max.width / 2, -sprites.max.height / 2); ctx.restore(); }
      else fancy(ctx, label, 576, 600, style === 'hokuto' ? 112 * sc : 250 * sc, { stops: style === 'hokuto' ? [[0, '#fff'], [0.35, '#bfe8ff'], [0.5, '#4aa0ff'], [0.52, '#102a70'], [0.75, '#7cc8ff'], [1, '#fff']] : [[0, '#fff'], [0.3, '#ffe071'], [0.5, '#ff5a2a'], [0.52, '#5a0070'], [0.7, '#3ac0ff'], [1, '#fff']], glow: 'rgba(255,255,255,.95)' });
      ctx.restore();
      const fl = Math.max(0, 1 - since / 0.4); if (fl > 0) { ctx.fillStyle = `rgba(255,255,255,${fl})`; ctx.fillRect(0, 0, W, H); }
    },
  };
}
