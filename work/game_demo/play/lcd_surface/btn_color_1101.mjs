// 11/01 画面の左右ボタンの色：実機の左ボタンは白か青、右ボタンは赤か黄（台によって違う）。
// 液晶の案内（左＝きかない／終わる、右＝きく／続ける）は、左を白〜青、右を黄〜赤のグラデーションで描き、どちらの色の台でも違和感を出さない。
// 戻す: ?btncolor=0（旧：左=赤・右=青）。変えるのは色だけ。枠・位置・字・左右の割り当ては同じ。
export const btnColorOn = (search = globalThis.location?.search ?? '') => new URLSearchParams(search).get('btncolor') !== '0';

// side 0 = 左ボタン、1 = 右ボタン。top/mid/bot = ボタン面の上端・中ほど・下端の色、glow = 輪の発光、burst = 押した瞬間の輪、
// plate = [下地の上, 下地の下, 上端の線]（吹き出しの札）、tintLabel = 字を寒色側へ回す角度（0 = そのまま）。
export const BTN_COLORS = {
  new: [
    { top: [250, 252, 255], mid: [190, 214, 255], bot: [40, 100, 235], glow: '150,190,255', burst: '215,232,255', plate: ['#eef4ff', '#2f62d8', '#ffffff'], tint: 178 },
    { top: [255, 228, 70], mid: [255, 152, 40], bot: [220, 30, 40], glow: '255,132,36', burst: '255,196,120', plate: ['#ffc83a', '#d83030', '#fff0a0'], tint: 0 },
  ],
  old: [
    { top: [255, 70, 70], bot: [255, 70, 70], glow: '255,70,70', burst: '255,200,160', plate: ['#d83030', '#d83030', '#ff7a7a'], tint: 0, flat: true },
    { top: [60, 130, 255], bot: [60, 130, 255], glow: '60,130,255', burst: '255,200,160', plate: ['#2f62d8', '#2f62d8', '#86aeff'], tint: 0, flat: true },
  ],
};
export const btnPalette = (side, on = btnColorOn()) => BTN_COLORS[on ? 'new' : 'old'][side ? 1 : 0];

// 金色の焼き字を寒色（銀青）に回した複製。色相だけ回し、字の縁・影・形は同じ。
export function tintedCopy(img, deg) {
  if (!img || !deg) return img;
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'); x.filter = `hue-rotate(${deg}deg) saturate(.85) brightness(1.12)`; x.drawImage(img, 0, 0);
  return c;
}
