// 10/30 継続／確定の選択（ChainChoice）で、初めての人に「継続は何が起きるか（時計0なら100円）」「確定は何が決まるか」を文で伝える重ね描き。
// 戻す: ?timeuphelp=0（時間切れ〜追加の説明と同じスイッチ）。規則・入力・秒数は変えない。
// 選択画面は GPU 合成（choice_gpu_image）のことがあり、2D の液晶には描いても見えない。そのため GPU のときは、
// 液晶右上の HUD（496×410、液晶座標 x656〜1152・y102〜512）の層へ描く。時計の「0秒」（timer_display が描く HUD）は消さず、その上に重ねる。
// 2D 合成のときは、同じ位置に液晶へ直接描く。choice_* / timer_display の中身には触れない。
import { timeupHelpMode, richLine, textPath, GOLD, WHITE } from './timeup_help_1030.mjs';
const PX = 34, PY = 28, HX = 656, HY = 102, HW = 496, HH = 410;   // HUD の液晶座標での位置

export function choiceHelpLines(game) {
  const r = game.rules ?? {}, extra = r.ExtraSeconds ?? 20;
  const add = !!game.chainNeedsAdd;
  return {
    add,
    a: add ? [['継続＝', WHITE], ['100円', GOLD], [`で ${extra}秒追加`, WHITE]] : [['継続＝', WHITE], ['このまま', GOLD], ['続きから', WHITE]],
    b: [['確定＝', WHITE], ['いまの玉', GOLD], ['で賞が決まる', WHITE]],
  };
}

function plate(ctx, x, y, w, h, r = 22) {
  const pg = ctx.createLinearGradient(0, y, 0, y + h); pg.addColorStop(0, 'rgba(30,8,58,.92)'); pg.addColorStop(1, 'rgba(70,14,78,.92)');
  ctx.fillStyle = pg; ctx.strokeStyle = 'rgba(255,205,90,.95)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); ctx.stroke();
}
function drawPlates(ctx, game, t, ox, oy) {   // ox,oy: 液晶座標 → 描く先の座標への平行移動
  const L = choiceHelpLines(game), k = Math.min(1, Math.max(0, t / .35)), ease = 1 - Math.pow(1 - k, 3);
  ctx.save(); ctx.translate(ox, oy); ctx.globalAlpha = ease; ctx.translate((1 - ease) * 30, 0);
  plate(ctx, 676, 372, 462, 138);
  richLine(ctx, L.a, 907, 428, 42, 430);
  richLine(ctx, L.b, 907, 485, 38, 430);
  ctx.restore();
}

export async function attachChoiceHelp(lcd, { controller } = {}) {
  if (!lcd?.production || lcd.choiceHelp || timeupHelpMode() === 'old') return lcd;
  const g = () => controller.game, base = { frame: lcd.frame.bind(lcd) };
  const mine = document.createElement('canvas'); mine.width = HW; mine.height = HH; const mctx = mine.getContext('2d');
  let since = null, timerHud = null, patched = null, drawn = 0, mode = null;
  const patch = be => {   // 時計の HUD を取り込むため、setHudCanvas を横取りして渡された canvas を覚える（渡し先は変えない）
    if (patched === be || typeof be?.setHudCanvas !== 'function') return; patched = be;
    const orig = be.setHudCanvas.bind(be); be.setHudCanvas = (c, rev) => { if (c !== mine) timerHud = c || null; return orig(c, rev); };
  };
  lcd.frame = (dt, F) => {
    base.frame(dt, F);
    const game = g(), on = game.phase === 'ChainChoice' && (game.choiceLeft ?? 0) > 0 && !!lcd.choiceV20?.active;   // 継続告知の映像が出ている間は重ねない
    if (!on) { since = null; mode = null; return; }
    const now = performance.now(); if (since == null) since = now; const t = (now - since) / 1000;
    const be = lcd.gpuPanelSource?.backend;
    if (be && typeof be.setHudCanvas === 'function') {
      patch(be); mode = 'gpu';
      mctx.clearRect(0, 0, HW, HH); if (timerHud) mctx.drawImage(timerHud, 0, 0, HW, HH);
      drawPlates(mctx, game, t, -HX, -HY); drawn++;
      be.setHudCanvas(mine, undefined);   // 毎フレーム更新を明示（改版番号なし）
    } else { mode = '2d'; drawPlates(lcd.canvas.getContext('2d'), game, t, PX, PY); drawn++; }
  };
  lcd.choiceHelp = { get mode() { return mode; }, get drawn() { return drawn; }, lines: () => choiceHelpLines(g()) };
  return lcd;
}
