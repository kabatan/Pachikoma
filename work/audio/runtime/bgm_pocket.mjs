// BGMの中域に「SEの居場所」をあける。録音BGMはメロディが400Hz〜3.2kHzに集まるので、
// 通常のSEが鳴っている間だけBGMのその帯域を少し下げ(全体のduckより目立たない)、SEが終わるとゆっくり戻す。
// 激アツの4〜6灯・ルーレットはr2エンジン側が全体を5dB下げるので、ここでは重ねない。
export const POCKET_DB = -3.5;
export function createPocket(ctx) {
  const node = ctx.createBiquadFilter(); node.type = 'peaking'; node.frequency.value = 1300; node.Q.value = .6; node.gain.value = 0;
  return {
    node,
    duck(seconds, db = POCKET_DB) {
      const now = ctx.currentTime, g = node.gain;
      g.cancelAndHoldAtTime?.(now) ?? g.cancelScheduledValues(now);
      g.linearRampToValueAtTime(db, now + .02);
      g.setTargetAtTime(0, now + Math.max(.05, seconds * .85), .14);
    },
  };
}
// イベント → 鳴るSEの名前(ここに載るものだけBGMの中域をあける)
export function pocketCue(e) {
  switch (e.id) {
    case 'lamp123': return 'lamp' + Math.max(1, Math.min(3, e.state?.lit || e.data?.n || 1));
    case 'ascend': return 'ascend';
    case 'dup_protect': return 'protect';
    case 'start': case 'ticket': case 'add100': case 'fail': return e.id;
    case 'warn10': return 'warn10';
    default: return null;
  }
}
