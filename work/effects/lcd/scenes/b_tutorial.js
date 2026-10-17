/* 小さな案内は下1/3。holdの解除はホストのLCD.stopに任せる。 */
(function () {
  'use strict';
  const {B,smooth,clamp,lerp,easeOut,TAU}=LCD;
  LCD.scene({id:'tut_launch',dur:0,hold:true,assets:B.assets,
    draw(c,t){
      const a=smooth(t/.3),idle=smooth((t-12)/.6);
      // STARTから発射待ちへ移っても、同じ光る操作卓アイコンを続ける。
      B.launchGuide(c,t,{a,s:1+idle*.15,y:628-idle*8});
      // 12秒で一度指し直し、その後も穏やかに呼吸する。
      if(t>=12&&t<13.4) LCD.add(c,'flare_ring.png',116,685,{w:150+100*smooth((t-12)/1.4),h:80,a:.45*(1-smooth((t-12)/1.4))});
    }
  });
  // はじめて灯った時の3ステップ(各約2.2秒)。絵が主役、言葉は一行:
  //  1) 玉が穴に入る→その穴が光る  2) まだ光っていない穴を狙う(矢印)  3) 同じ穴に入ると、ルーレットが回って灯が消える
  LCD.scene({id:'tut_first_lamp',dur:4.8,assets:B.assets,
    draw(c,t,sc){
      const a=smooth(t/.2)*B.exit(t,4.8,.3),lit=Math.max(1,Math.min(7,Math.round(sc.params.pocket||4)));
      c.save();c.globalAlpha=a;const g=c.createLinearGradient(0,420,0,720);g.addColorStop(0,'rgba(5,12,29,0)');g.addColorStop(.16,'rgba(5,12,29,.93)');g.addColorStop(1,'rgba(5,12,29,.97)');c.fillStyle=g;c.fillRect(0,420,1280,300);c.restore();
      const step=t<2.4?0:1,st=[t,t-2.4][step],stp=96,hx=(i)=>640+(i-4)*stp,hy=640;
      const msg=['はいった あなが ひかる!','つぎは ちがう あなに いれよう!'][step];
      // 手順の点(1・2・3)
      for(let i=0;i<2;i++){c.save();c.globalAlpha=a;c.fillStyle=i===step?'#ffd978':'rgba(255,255,255,.28)';c.beginPath();c.arc(640+(i-.5)*34,468,i===step?8:6,0,TAU);c.fill();c.restore();}
      LCD.text(c,msg,640,520,{size:50,weight:900,a,fill1:'#fff6d8',fill2:'#ffcf7a',stroke:9,strokeColor:'#6e3f18',glow:'#d98a3a'});
      // 光っている穴=lit。玉が落ちて光る(1)/灯のない穴を矢印で(2)/同じ穴に玉→ルーレット→消灯(3)
      const lit2=step===2&&t>5.9?[]:[lit];
      B.holes(c,640,hy,t,{lit:lit2},{step:stp,r:28,a,target:step===1});
      if(step===0){
        const u=clamp(st/.7),by=lerp(560,hy,smooth(u));
        if(u<1) LCD.ball(c,hx(lit),by,20,{a});
        else {const q=clamp((st-.7)/.9);LCD.add(c,'flare_ring.png',hx(lit),hy,{w:80+q*220,h:60+q*110,a:a*.9*(1-q)});LCD.add(c,'glow_soft.png',hx(lit),hy,{w:200,h:200,a:a*.6*(1-q*.4),tint:'#ffd070'});}
      }
      if(step===1){
        for(const i of [1,2,3,4,5,6,7]) if(i!==lit){const w=.5+.5*Math.sin(t*4+i);LCD.add(c,'glow_soft.png',hx(i),hy,{w:110,h:110,a:a*.35*w,tint:'#ffd070'});}
        B.point(c,hx(lit<4?lit+2:lit-2),hy-62,'right',t,{s:.5,a:a*smooth(st/.3)});
      }
      if(step===2){
        const u=clamp((st-.1)/.5);
        if(st>.1&&st<.65) LCD.ball(c,hx(lit),lerp(560,hy,smooth(u)),20,{a});
        if(st>.55){const q=clamp((st-.55)/.6);wheelIcon(c,hx(lit)+(lit<5?200:-200),600,42*smooth(q),a*smooth(q),false);
          if(t>5.5){const rot=(t-5.5)*9;c.save();c.globalAlpha=a;c.translate(hx(lit)+(lit<5?200:-200),600);c.rotate(rot);c.strokeStyle='#fff';c.lineWidth=4;c.beginPath();c.moveTo(0,0);c.lineTo(0,-40);c.stroke();c.restore();}
          LCD.add(c,'glow_soft.png',hx(lit),hy,{w:240*q+60,h:240*q+60,a:a*.8*(1-smooth((st-1.4)/.5)),tint:'#ff3a44'});}
      }
      LCD.upa(c,120,640,{scale:4,mood:step===2&&t>5.9?'calm':'happy',a});
    }
  });
  LCD.scene({id:'tut_challenge',dur:2.8,hold:true,assets:B.assets,
    draw(c,t){
      const tail=smooth((t-2.55)/.25),a=smooth(t/.18)*(1-tail);
      if(a>.001){
        // 上2/3は灯数の演出に譲り、下側だけで穴→玉の山を説明。
        c.save();c.globalAlpha=a;
        const g=c.createLinearGradient(0,444,0,720);g.addColorStop(0,'rgba(5,12,29,0)');g.addColorStop(.12,'rgba(5,12,29,.96)');g.addColorStop(1,'rgba(5,12,29,.98)');c.fillStyle=g;c.fillRect(0,444,1280,276);c.restore();
        LCD.text(c,'みぎのボタン しょうぶ!',659,486,{size:39,a,fill1:'#fff0c4',fill2:'#ffcc73',stroke:7});
        LCD.text(c,'あかりのない あなに いれると 玉がふえる',647,536,{size:28,a,stroke:5});
        const enter=clamp((t-.5)/.55),hit=smooth((t-1.05)/.16),pile=smooth((t-1.28)/.4);
        B.holes(c,480,626,t,{lit:[1,2,3,5,6,7]},{step:52,r:16,a,target:true});
        if(t<1.16) LCD.ball(c,480,lerp(558,627,smooth(enter)),13,{a:a*(1-hit)});
        LCD.flip(c,'twinkle_1',t-1.05,480,626,{s:.8,a:a*.75});
        LCD.add(c,'flare_streak.png',695,625,{w:170,h:22,a:a*hit*.6});
        B.pile(c,874,662,Math.round(pile*18),13,{a:a*pile});
        LCD.upa(c,170,620,{scale:3,mood:'smile',a});
      }
      B.point(c,1153,650,'right',t,{s:lerp(.74,.43,tail),a:smooth(t/.2)});
    }
  });
  // ───────── 重複(保護中) ─────────
  // 「同じ穴」を、ルーレットの絵(眠っている)と盾で見せる。初回だけ一行足す。文章で説明しない。
  const wheelIcon=(c,x,y,r,a,sleep)=>{
    c.save();c.globalAlpha=a;c.translate(x,y);
    const cols=['#ff5a6a','#fff0c8','#ff5a6a','#fff0c8','#ff5a6a','#fff0c8'];
    for(let i=0;i<6;i++){c.fillStyle=cols[i];c.globalAlpha=a*(sleep?.5:1);c.beginPath();c.moveTo(0,0);c.arc(0,0,r,i*Math.PI/3-Math.PI/2,(i+1)*Math.PI/3-Math.PI/2);c.closePath();c.fill();}
    c.globalAlpha=a;c.strokeStyle='#f6ce85';c.lineWidth=5;c.beginPath();c.arc(0,0,r,0,TAU);c.stroke();
    c.fillStyle='#2a1d12';c.beginPath();c.arc(0,0,r*.16,0,TAU);c.fill();c.restore();
  };
  const shield=(c,x,y,s,a)=>{
    c.save();c.globalAlpha=a;c.translate(x,y);c.scale(s,s);
    const g=c.createLinearGradient(0,-30,0,34);g.addColorStop(0,'#bff0ff');g.addColorStop(1,'#4aa8e8');
    c.fillStyle=g;c.strokeStyle='#eafaff';c.lineWidth=4;c.beginPath();c.moveTo(0,-32);c.lineTo(28,-22);c.lineTo(26,6);c.quadraticCurveTo(22,24,0,36);c.quadraticCurveTo(-22,24,-26,6);c.lineTo(-28,-22);c.closePath();c.fill();c.stroke();
    c.strokeStyle='#fff';c.lineWidth=7;c.lineCap='round';c.lineJoin='round';c.beginPath();c.moveTo(-12,0);c.lineTo(-3,10);c.lineTo(14,-10);c.stroke();c.restore();
  };
  LCD.scene({id:'dup_protect',dur:1.4,assets:B.assets,
    draw(c,t,sc){
      const first=sc.params.first===true,a=smooth(t/.12)*B.exit(t,1.4,.25),up=easeOut(t/.24);
      LCD.add(c,'glow_soft.png',640,565,{w:1150,h:380,a:.19*a,tint:'#9fdcff'});
      B.ribbon(c,640,560,1130,first?200:175,a);
      LCD.upa(c,200,lerp(830,572,up),{scale:5,mood:'smile',a});
      // 眠るルーレットと盾(セーフ)
      wheelIcon(c,350,first?560:566,42,a,true);
      LCD.text(c,'z z',392,first?520:526,{size:26,a:a*(.5+.5*Math.sin(t*5)),fill1:'#cfe8ff',fill2:'#9fc8f0',stroke:4});
      shield(c,448,first?560:566,1.05,a*smooth((t-.15)/.2));
      const ty=first?530:566;
      LCD.text(c,'おなじ あな! まだ セーフ!',860,ty+6,{size:62,weight:900,a:a*.8,fill1:'#10182a',fill2:'#10182a',stroke:17,strokeColor:'#10182a'});
      LCD.text(c,'おなじ あな! まだ セーフ!',856,ty,{size:62,weight:900,a,fill1:'#f2fbff',fill2:'#8ccff2',stroke:13,strokeColor:'#24527a'});
      LCD.text(c,'おなじ あな! まだ セーフ!',856,ty,{size:62,weight:900,a,fill1:'#ffffff',fill2:'#cfeeff',stroke:5,strokeColor:'#eaf8ff'});
      if(first) LCD.text(c,'ひかる あなが ふえると ランプが きえるかも',850,606,{size:30,a,fill1:'#f4fbff',fill2:'#b9e2fa',stroke:6});
      LCD.add(c,'flare_ring.png',350,566,{w:100+300*smooth(t/.8),h:80+200*smooth(t/.8),a:.35*a*(1-smooth(t/.9)),tint:'#bfe6ff'});
    }
  });
  // 4灯になった最初の1回だけ: ここから勝負が大きくなる。数字が主役、文字は一行。
  LCD.scene({id:'tut_lamp4',dur:3.4,assets:B.assets,
    draw(c,t){
      const a=smooth(t/.2)*B.exit(t,3.4,.3);
      c.save();c.globalAlpha=a;const g=c.createLinearGradient(0,440,0,720);g.addColorStop(0,'rgba(5,12,29,0)');g.addColorStop(.15,'rgba(5,12,29,.92)');g.addColorStop(1,'rgba(5,12,29,.97)');c.fillStyle=g;c.fillRect(0,440,1280,280);c.restore();
      LCD.text(c,'ここから しょうぶで ドッと ふえる!',640,500,{size:42,a,fill1:'#fff3c8',fill2:'#ffcf7a',stroke:7,glow:'#d98a3a'});
      const AW=LCD.rules().awards||[0,1,2,3,12,30,80],items=[['4つ',`${AW[4]}こ`,410],['5つ',`${AW[5]}こ`,640],['6つ','JP!',870]];
      items.forEach(([k,v,x],i)=>{
        const q=smooth((t-.5-i*.3)/.3),b=1+.06*Math.sin(t*4+i);
        LCD.text(c,k,x,578,{size:30,a:a*q,fill1:'#ffe3ee',fill2:'#ffb6d0',stroke:5});
        LCD.text(c,v,x,640,{size:i===2?66:58,weight:900,a:a*q,fill1:i===2?'#fff7d0':'#fff3c8',fill2:i===2?'#ffd24a':'#ffcf7a',stroke:10,strokeColor:'#6e3f18',glow:i===2?'#ffd24a':'#d98a3a'});
        LCD.add(c,'glow_soft.png',x,636,{w:200*b,h:120*b,a:a*q*.28,tint:i===2?'#ffe08a':'#ffcf7a'});
      });
      LCD.text(c,'4つから おなじ あなだと ルーレット。ランプが きえるよ',640,696,{size:27,a:a*smooth((t-1.4)/.3),fill1:'#ffd9e4',fill2:'#ffb0c8',stroke:5});
      LCD.upa(c,150,640,{scale:3,mood:'happy',a});
      B.point(c,1153,650,'right',t,{s:.6,a:a*smooth((t-1)/.3)});
    }
  });
})();
