/* 初見向けの案内(tut_*)と「同じ穴」。液晶の下1/3に出し、上の灯の演出と右上の残り時間(約470x150)は空ける。
 * 絵は実物(U字の入賞口・ランプ・銀の玉・実物のルーレット)。文字は筐体全体の画像で読める大きさ(本文44px以上)。
 * 部品は b_entry.js の LCD.E。holdの解除はホストのLCD.stopに任せる。 */
(function () {
  'use strict';
  const {B,E,smooth,clamp,lerp,easeOut,easeOutBack,TAU}=LCD;
  const goldText=(c,s,x,y,o={})=>LCD.text(c,s,x,y,{fill1:'#fff6d8',fill2:'#ffcf7a',stroke:9,strokeColor:'#6e3f18',glow:'#d98a3a',...o});
  const plate=(c,y0,a)=>{c.save();c.globalAlpha=a;const g=c.createLinearGradient(0,y0,0,720);g.addColorStop(0,'rgba(5,12,29,0)');g.addColorStop(.14,'rgba(5,12,29,.94)');g.addColorStop(1,'rgba(5,12,29,.98)');c.fillStyle=g;c.fillRect(0,y0,1280,720-y0);c.restore();};
  // 入賞口の列(7つ)。lev/flash/pulse は 1..7 の配列
  const row=(c,t,y,o)=>{
    const s=o.s,step=o.step;
    for(let i=1;i<=7;i++){
      const x=640+(i-4)*step,pl=o.pulse&&o.pulse[i]?(.5+.5*Math.sin(t*5+i))*o.pulse[i]:0;
      if(pl>0){LCD.add(c,'glow_soft.png',x,y,{w:150*s,h:150*s,a:o.a*.7*pl,tint:'#ffd070'});}
      E.pocket(c,x,y,{s,lit:o.lev[i]||0,flash:o.flash?o.flash[i]||0:0,ly:y+o.ly,ls:o.ls,a:o.a});
      if(pl>0){c.save();c.globalAlpha=o.a*(.4+.5*pl);c.strokeStyle='#ffd070';c.lineWidth=4;c.beginPath();c.arc(x,y+6*s,52*s,0,TAU);c.stroke();c.restore();}
    }
  };
  const drop=(c,x,y0,y1,u,a)=>{if(u<=0||u>=1)return false;const y=lerp(y0,y1,u*u*.5+u*.5);for(let k=1;k<5;k++)LCD.add(c,'glow_soft.png',x,y-k*13,{w:30,h:30,a:.22*a*(1-k/5),tint:'#cfe0ff'});LCD.ball(c,x,y,15,{gold:false,a});return true;};

  LCD.scene({id:'tut_launch',dur:0,hold:true,assets:[...B.assets],
    draw(c,t){
      const a=smooth(t/.3),idle=smooth((t-12)/.6);
      // STARTから発射待ちへ移っても、同じ案内を続ける(筐体の左下のボタンを指す)。12秒で一度指し直し、その後も呼吸する。
      E.launchGuide(c,t,{a,s:1+idle*.1,y:628-idle*6});
      if(t>=12&&t<13.4) LCD.add(c,'flare_ring.png',128,640,{w:150+100*smooth((t-12)/1.4),h:80+60*smooth((t-12)/1.4),a:.45*(1-smooth((t-12)/1.4))});
    }
  });

  // はじめて灯った時(各約2.4秒)。1) 入った穴のランプがつく  2) まだ暗い穴を狙う(矢印)
  LCD.scene({id:'tut_first_lamp',dur:4.8,assets:[...B.assets,...E.assets],
    draw(c,t,sc){
      const a=smooth(t/.2)*B.exit(t,4.8,.3),lit=Math.max(1,Math.min(7,Math.round(sc.params.pocket||4)));
      plate(c,420,a);
      const step=t<2.4?0:1,st=[t,t-2.4][step],X=i=>640+(i-4)*138;
      for(let i=0;i<2;i++){c.save();c.globalAlpha=a;c.fillStyle=i===step?'#ffd978':'rgba(255,255,255,.3)';c.beginPath();c.arc(640+(i-.5)*40,446,i===step?11:8,0,TAU);c.fill();c.restore();}
      goldText(c,['入った 穴の ランプが つくよ!','ちがう 穴に 入れよう!'][step],640,486,{size:58,a});
      const lev=Array(8).fill(0),flash=Array(8).fill(0),pulse=Array(8).fill(0);
      if(step===0){
        const u=(st-.3)/.7;drop(c,X(lit),520,560,u,a);
        if(st>1.0){lev[lit]=smooth((st-1.0)/.15);flash[lit]=Math.max(0,1-(st-1.0)/.6);}
      } else {
        lev[lit]=1;for(let i=1;i<=7;i++)if(i!==lit)pulse[i]=1;
      }
      row(c,t,598,{s:.82,step:138,ly:86,ls:78,lev,flash,pulse,a});
      if(step===1){const tg=lit<4?lit+2:lit-2;LCD.arrow(c,X(tg),534+Math.sin(t*7)*4,'down',t,{s:.5,a:a*smooth(st/.3)});}
    }
  });

  // 灯が増えた最初の勝負の案内(初回の1回だけ。灯の演出の後)。右のボタンへ。
  LCD.scene({id:'tut_challenge',dur:2.8,hold:true,assets:[...B.assets,...E.assets],
    draw(c,t){
      const tail=smooth((t-2.55)/.25),a=smooth(t/.18)*(1-tail);
      if(a>.001){
        plate(c,420,a);
        goldText(c,'右の ボタンで 勝負!',640,466,{size:66,a,stroke:11});
        goldText(c,'ランプの ない 穴で 玉が ふえる!',640,534,{size:50,a,stroke:9,fill1:'#fff3d8',fill2:'#ffd9a0'});
        const u=(t-.5)/.6,hit=t>1.1?1:0,lev=Array(8).fill(1),flash=Array(8).fill(0),pulse=Array(8).fill(0);
        lev[4]=hit?smooth((t-1.1)/.15):0;pulse[4]=hit?0:1;flash[4]=hit?Math.max(0,1-(t-1.1)/.6):0;
        row(c,t,616,{s:.72,step:114,ly:76,ls:64,lev,flash,pulse,a});
        drop(c,640,572,614,u,a);
        // 玉の山(ふえる)
        const pile=smooth((t-1.25)/.45);
        B.pile(c,150,704,Math.round(pile*15),15,{a:a*pile,gold:false});
        if(pile>0)goldText(c,'+',250,610,{size:70,a:a*pile});
      }
      // 右の勝負ボタン(筐体の右下)を指す。液晶の右下の隅。
      B.point(c,1180,646,'right',t,{s:lerp(.9,.55,tail),a:smooth(t/.2)});
    }
  });

  // ───────── 重複(保護中) ─────────
  // 「同じ穴」を、眠っている実物のルーレットと盾で見せる。初回だけ一行足す。
  const shield=(c,x,y,s,a)=>{
    c.save();c.globalAlpha=a;c.translate(x,y);c.scale(s,s);
    const g=c.createLinearGradient(0,-30,0,34);g.addColorStop(0,'#bff0ff');g.addColorStop(1,'#4aa8e8');
    c.fillStyle=g;c.strokeStyle='#eafaff';c.lineWidth=4;c.beginPath();c.moveTo(0,-32);c.lineTo(28,-22);c.lineTo(26,6);c.quadraticCurveTo(22,24,0,36);c.quadraticCurveTo(-22,24,-26,6);c.lineTo(-28,-22);c.closePath();c.fill();c.stroke();
    c.strokeStyle='#fff';c.lineWidth=7;c.lineCap='round';c.lineJoin='round';c.beginPath();c.moveTo(-12,0);c.lineTo(-3,10);c.lineTo(14,-10);c.stroke();c.restore();
  };
  LCD.scene({id:'dup_protect',dur:1.4,assets:[...B.assets,...E.assets],
    draw(c,t,sc){
      const first=sc.params.first===true,a=smooth(t/.12)*B.exit(t,1.4,.25),up=easeOut(t/.24);
      LCD.add(c,'glow_soft.png',640,565,{w:1150,h:380,a:.19*a,tint:'#9fdcff'});
      B.ribbon(c,640,560,1130,first?210:175,a);
      LCD.upa(c,170,lerp(830,572,up),{scale:5,mood:'smile',a});
      // 眠る実物のルーレット(暗く、ゆっくり)と盾(セーフ)
      E.wheel(c,330,first?556:566,46,{dim:.5,a,rot:t*.05,needle:.3});
      LCD.text(c,'z z',395,first?514:524,{size:34,a:a*(.5+.5*Math.sin(t*5)),fill1:'#cfe8ff',fill2:'#9fc8f0',stroke:5});
      shield(c,440,first?556:566,1.1,a*smooth((t-.15)/.2));
      const ty=first?526:566;
      LCD.text(c,'おなじ あな! まだ セーフ!',860,ty+6,{size:62,weight:900,a:a*.8,fill1:'#10182a',fill2:'#10182a',stroke:17,strokeColor:'#10182a'});
      LCD.text(c,'おなじ あな! まだ セーフ!',856,ty,{size:62,weight:900,a,fill1:'#f2fbff',fill2:'#8ccff2',stroke:13,strokeColor:'#24527a'});
      LCD.text(c,'おなじ あな! まだ セーフ!',856,ty,{size:62,weight:900,a,fill1:'#ffffff',fill2:'#cfeeff',stroke:5,strokeColor:'#eaf8ff'});
      if(first) LCD.text(c,'ふえると 同じ穴で ランプが 消えるかも',850,606,{size:42,a,fill1:'#f4fbff',fill2:'#b9e2fa',stroke:8,strokeColor:'#24527a'});
      LCD.add(c,'flare_ring.png',330,566,{w:100+300*smooth(t/.8),h:80+200*smooth(t/.8),a:.35*a*(1-smooth(t/.9)),tint:'#bfe6ff'});
    }
  });

  // 4灯になった最初の1回だけ: ここから勝負が大きくなる。数字が主役。同じ穴の注意は実物のルーレットの絵つき。
  LCD.scene({id:'tut_lamp4',dur:3.8,assets:[...B.assets,...E.assets],
    draw(c,t){
      const a=smooth(t/.2)*B.exit(t,3.8,.3);
      plate(c,424,a);
      goldText(c,'ここから 勝負が 大きいよ!',640,474,{size:58,a,stroke:10});
      const AW=LCD.rules().awards||[0,1,2,3,12,30,80],items=[['4つで',`${AW[4]}こ`,370],['5つで',`${AW[5]}こ`,640],['6つで','JP!',910]];
      items.forEach(([k,v,x],i)=>{
        const q=smooth((t-.4-i*.25)/.3),b=1+.05*Math.sin(t*4+i);
        LCD.text(c,k,x,544,{size:44,a:a*q,fill1:'#ffe3ee',fill2:'#ffb6d0',stroke:7});
        LCD.text(c,v,x,612,{size:i===2?84:76,weight:900,a:a*q,fill1:i===2?'#fff7d0':'#fff3c8',fill2:i===2?'#ffd24a':'#ffcf7a',stroke:12,strokeColor:'#6e3f18',glow:i===2?'#ffd24a':'#d98a3a'});
        LCD.add(c,'glow_soft.png',x,606,{w:260*b,h:150*b,a:a*q*.3,tint:i===2?'#ffe08a':'#ffcf7a'});
      });
      // 同じ穴の注意: 実物のルーレット(回る)つき
      const q2=smooth((t-1.5)/.3);
      E.wheel(c,128,672,40,{rot:t*3.2,needle:0,a:a*q2});
      LCD.text(c,'同じ穴に 入ると ランプが 消えるかも',700,680,{size:46,a:a*q2,fill1:'#ffd9e4',fill2:'#ffb0c8',stroke:8,strokeColor:'#5a1a30'});
      B.point(c,1196,560,'right',t,{s:.6,a:a*smooth((t-1)/.3)});
    }
  });
})();
