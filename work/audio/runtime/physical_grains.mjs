// 自作払い出し粒。実センサーの本数を120ms窓に集約する補助音。
// 接触音は別途実接触で駆動。粒数は球数の表現で、実接触数の推定ではない。
import {modalSamples} from './modal_core.mjs';
export function payoutSamples(count=1,sampleRate=48000) {
  const n=Math.max(1,Math.min(8,Math.round(Number(count)||1)));
  const length=Math.ceil(.24*sampleRate),left=new Float32Array(length),right=new Float32Array(length);
  for(let j=0;j<n;j++) {
    const grain=modalSamples({material:j%3===1?'resin':'steel',speed:.55+(j%3)*.16,impulse:.003,variant:j},sampleRate);
    const at=Math.round((j===0?0:j*.105/n+((j*7)%5)*.0007)*sampleRate),pan=((j*5)%7-3)*.065;
    const gain=1.1/Math.sqrt(Math.max(1,n/3));
    for(let i=0;i<grain.length&&i+at<length;i++) {
      left[at+i]+=grain[i]*Math.sqrt((1-pan)/2)*gain;
      right[at+i]+=grain[i]*Math.sqrt((1+pan)/2)*gain;
    }
  }
  return [left,right];
}
