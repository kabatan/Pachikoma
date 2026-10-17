/* 開始1.9秒。払い出し(皿が満ちる)のあとに出る。暗転の一拍(金の光が中心へ集まる溜め)→「スタート!」が奥から飛んできてドンと止まる(衝撃波・光の筋・金の玉と火花)→左ボタンの案内。ウパは出さない(初めはウパはいない)。 */
(function () {
  'use strict';
  const { B, E, smooth, easeOut, easeOutBack, lerp, clamp, TAU }=LCD;
  B.scene({id:'start',dur:1.9,cover:true,assets:[...B.assets,...B.titles('sutato'),'flare_ring.png','flare_streak.png','rays_soft.png',...E.assets],
    start(sc){B.init(sc);},
    update(sc,dt){B.step(sc,dt);B.at(sc,.42,()=>{LCD.flash(.55,'#fff0c8',7);LCD.shake(14,.38);LCD.punch(.05);B.burst(sc,110,640,300,1.2);});},
    draw(c,t,sc){
      const exit=B.exit(t,1.9,.25),slam=clamp((t-.42)/.5),land=smooth((t-.4)/.12);
      B.background(c,t);
      // 暗転の一拍(0〜0.4秒): 暗くして、中心にだけ細い光
      const dark=1-smooth((t-.36)/.12);
      if(dark>0){c.save();c.globalAlpha=.82*dark;c.fillStyle='#02040c';c.fillRect(0,0,1280,720);c.restore();
        LCD.add(c,'flare_streak.png',640,326,{w:260+t*2400,h:18,a:.9*clamp(t/.3)*dark});}
      // 着地後の光: 放射・リング・光の筋
      LCD.rays(c,640,326,{n:33,a:(.1+.2*land)*exit,rot:t*.1,color:'255,196,110',len:1000});
      for(let k=0;k<3;k++){const q=clamp((t-.42-k*.09)/.6);if(q>0&&q<1)LCD.add(c,'flare_ring.png',640,326,{w:200+q*1500,h:120+q*900,a:.85*(1-q),tint:k?'#ffd98a':'#ffffff'});}
      B.stream(c,t,640,326,{inward:t<.45,n:30,a:.75*exit,speed:1.4});
      B.drift(c,t,36,{petals:true,a:.75*exit});B.drift(c,t,30,{a:.7*exit});
      // 文字: 奥(大きく・薄く)から飛んできてドンと止まり、わずかに弾む
      const z=t<.42?lerp(4.2,1,easeOut(clamp((t-.04)/.38))):1+.09*Math.exp(-(t-.42)*9)*Math.cos((t-.42)*22);
      const a=smooth((t-.06)/.18)*exit;
      if(t>.42)B.coinRain(c,t-.42,50,{a:.9*exit*smooth((t-.42)/.2)});
      LCD.add(c,'glow_soft.png',640,322,{w:1300*land,h:520*land,a:.55*land*exit,tint:'#ff8a3a'});
      LCD.titleFit(c,'sutato','スタート!',640,322,{w:980,h:280,zoom:z,a,glowA:.8+.5*Math.sin(t*9)*land});
      LCD.add(c,'flare_streak.png',640,326,{w:1500*land*(1-slam*.2),h:70,a:.7*land*exit*(1-smooth((t-.9)/.8))});
      B.shine(c,t,g=>LCD.titleFit(g,'sutato','スタート!',640,322,{w:980,h:280,zoom:z,shadowA:0,glowA:0}),{a:.7*land*exit,speed:1.2});
      sc.S.P.draw(c);
      // 射出器は筐体の3Dモデル(盤の上を往復)。ここでは文字の案内だけ。
      E.launchGuide(c,t,{a:smooth((t-.95)/.15)*exit});
    }
  });
})();
