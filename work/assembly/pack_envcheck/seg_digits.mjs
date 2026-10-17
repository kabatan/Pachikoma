// 筐体の7セグ(4桁×7セグ=28)に持ち玉数を出す。Stage2bLightAdapter.setCabinet の display.digits に渡す。
//   ad.setCabinet({ display: { digits: ballCountToDigits(wallet) } });   // walletが変わった時に1回呼べばよい
// seg番号 = 桁*7 + (a,b,c,d,e,f,g)。桁0が左。凍結像の「15」は桁2='1'(b,c)・桁3='5'(a,c,d,f,g)なので 4桁 ' 15' と同じ並び。
// 消灯は {rgb:[0,0,0], gain:1}（gain1+rgb0＝消灯。凍結の15を消すためにも必要）。点灯は既定の赤 [1,.015,.065] gain1（凍結の15と同じ強さ）。
const GLYPH = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
const SEG = 'abcdefg';
export const DIGIT_ON = [1, 0.015, 0.065];
export function ballCountToDigits(count, { on = DIGIT_ON, blank = false } = {}) {
  const n = blank ? null : Math.max(0, Math.min(9999, Math.floor(Number(count) || 0)));
  const s = n === null ? '' : String(n);
  const out = [];
  for (let d = 0; d < 4; d++) {
    const ch = s.length > 3 - d ? s[s.length - 4 + d] : null;   // 右詰め。上位の0は表示しない（0は1桁だけ）
    const lit = ch !== null && ch !== undefined ? GLYPH[ch] : '';
    for (let k = 0; k < 7; k++) out.push(lit.includes(SEG[k]) ? { rgb: [...on], gain: 1 } : { rgb: [0, 0, 0], gain: 1 });
  }
  return out;
}
export default ballCountToDigits;
