// 10/31 待機画面の常時案内「ボタンを押してスタート」。金の押し出し字(カウントダウン「連打」と同じ Blender の作り、work/effects/r4_h_fx/attract_push_1031)を
// 起動時に一度だけ小さな2Dキャンバスへ置き(premultiplied)、待機映像の上に重ねる。GPU経路は createAttractGpu の overlay(+明るさ gain)、2D経路は draw() が重ねる。
// 点滅で消える時間は作らない(明るさ0.82〜1.0 の脈動のみ)。待機(attract)のループ映像にだけ使い、説明・ゲーム中・結果には出さない。?attractpush=0 で無効。
export const PUSH_W=960;                 // 映像(1152x1268)上の大きさ。スマホでも読める大きさ
export async function createAttractPush({px,py,videoW=1152,videoH=1268,url=new URL('./attract_push_1031/pushbtn.png',import.meta.url)}) {
  const img=new Image();img.decoding='async';img.src=url.href;await img.decode();
  const w=PUSH_W,h=Math.round(PUSH_W*img.naturalHeight/img.naturalWidth),PH=h+76;        // PH: 字の下地(暗い紫の帯)を含む高さ
  const canvas=document.createElement('canvas');canvas.width=videoW;canvas.height=PH;
  const c=canvas.getContext('2d');c.imageSmoothingQuality='high';
  // 下地：上へ向かってにじんで消える暗い帯。映像に焼き込まれた冒頭の「ボタンでスタート!」を覆い、明るい場面でも字を読ませる(縁のくっきりした図形は作らない)
  const g=c.createLinearGradient(0,0,0,PH);g.addColorStop(0,'rgba(22,4,42,0)');g.addColorStop(0.26,'rgba(22,4,42,0.86)');g.addColorStop(1,'rgba(22,4,42,0.9)');
  c.fillStyle=g;c.fillRect(0,0,videoW,PH);
  c.drawImage(img,Math.round((videoW-w)/2),PH-h-8,w,h);
  const x=px,y=py+videoH-PH;                                                          // 液晶の下寄り(ロゴ「コマ」の下)
  const gain=(ms=performance.now())=>Math.round((0.91+0.09*Math.sin(ms/1000*2*Math.PI/1.6))*24)/24;   // 周期1.6秒・量子化して再合成を減らす
  return {canvas,x,y,w:videoW,h:PH,revision:0,gain,
    draw2d(ctx){const g=gain();ctx.save();ctx.globalAlpha=g;ctx.drawImage(canvas,x,y,videoW,PH);ctx.restore();}};
}
