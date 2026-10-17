/* 入口の三場面: タイトル → ルール説明(howto) → チケットが玉に変わる(ticket)。
 * 「画面の中だけで説明する」場面ではなく、タイトルは世界観の入口、howtoは一言で仕組み、ticketは皿へ玉が出る瞬間をつなぐ。 */
(function () {
  'use strict';
  const { B, smooth, easeOut, easeOutBack, lerp, clamp, TAU }=LCD;
  const goldText=(c,s,x,y,o={})=>LCD.text(c,s,x,y,{fill1:'#fff6d6',fill2:'#ffcf7a',stroke:8,glow:'#d98a3a',...o});

  // ───────── タイトル ─────────
  // 世界に引き込む一枚絵: 夜桜の海に月と光の柱、奥にウパたちの群れ、中央に大きな虹色のウパ(主役)、
  // 金の玉が泡のように昇る。ロゴは金の面+白い光の走り+紋章で、説明はしない。
  LCD.scene({id:'title',dur:0,hold:true,cover:true,assets:[...B.assets,...B.titles('logo'),'bokeh_disc.png','flare_ring.png','flare_streak.png','rays_soft.png','glow_soft.png','glint_1.png','petal_1.png','petal_2.png','petal_3.png','petal_4.png'],
    start(sc){B.init(sc);sc.S.balls=Array.from({length:16},(_,i)=>({x:60+((i*83)%1160),y:760+((i*97)%600),v:26+(i%5)*10,r:6+(i%3)*3,ph:i*1.3}));},
    update(sc,dt){
      B.step(sc,dt);
      if(sc.t>.5&&sc.rand()<dt*22){
        const x=sc.rand()*1280;
        sc.S.P.emit({x,y:560+sc.rand()*140,vx:(sc.rand()-.5)*10,vy:-22-sc.rand()*34,life:2+sc.rand()*1.4,s0:.04,s1:.22+sc.rand()*.2,a0:0,a1:0,img:'glint_1.png',tint:sc.rand()<.5?'#ffe3a0':'#ffb0d0',blend:'add'});
        sc.S.P.list[sc.S.P.list.length-1].fade=true;
      }
      sc.S.balls.forEach(b=>{b.y-=b.v*dt;b.x+=Math.sin(sc.t*.8+b.ph)*10*dt;if(b.y<-30)b.y=760+((b.ph*50)%160);});
    },
    draw(c,t,sc){
      const open=smooth(t/.9),pulse=.5+.5*Math.sin(t*1.3);
      B.background(c,t);
      LCD.dim(c,.18,'#050a1e');
      // 月の光の柱(ロゴの背後)と、ゆっくり回る桜の紋
      LCD.add(c,'crest_glow.png',640,300,{w:1160+pulse*50,h:1160+pulse*50,a:(.34+.08*pulse)*open});
      LCD.rays(c,640,300,{n:31,a:.15*open,rot:t*.028,color:'255,214,125',len:980});
      LCD.rays(c,640,300,{n:19,a:.09*open,rot:-t*.04,color:'255,150,190',len:900});
      LCD.add(c,'crest_sakura.png',640,300,{w:760,h:760,a:.2*open,rot:t*.045,tint:'#ff9cc4'});
      B.drift(c,t,22,{a:.55});
      // 奥のウパの群れ(小さく・暗く・ゆっくり横切る。奥行きを出す)
      for(let i=0;i<7;i++){
        const sp=9+i%3*5,x=((i*230+t*sp)%1700)-210,y=372+Math.sin(t*.7+i*1.9)*14+(i%2)*26;
        LCD.upa(c,x,y,{scale:3,hue:LCD.HUES[i],mood:i%2?'smile':'happy',a:.42*open});
      }
      // 金の玉が泡のようにゆっくり昇る(説明ではなく、きらめく世界の粒)
      sc.S.balls.forEach(b=>{const a2=.55*open*clamp(b.y/300,0,1);LCD.add(c,'glow_soft.png',b.x,b.y,{w:b.r*7,h:b.r*7,a:a2*.5,tint:'#ffd98a'});LCD.ball(c,b.x,b.y,b.r,{a:a2});});
      // 主役: 虹色の大きなウパ(整数倍)。ふわっと浮かび、ロゴの下で見上げる
      const hy=538+Math.sin(t*1.1)*9,hl=smooth((t-.2)/.6);
      LCD.add(c,'glow_soft.png',640,hy+10,{w:620,h:380,a:.45*hl,tint:'#ffb2d6'});
      LCD.upa(c,640,hy,{scale:8,hue:0,mood:'happy',a:hl});
      // 左右の相棒(中くらい)
      for(const [sx,hue,m,ph] of [[255,190,'smile',0],[1025,70,'happy',1.4]]){
        LCD.upa(c,sx,560+Math.sin(t*1.3+ph)*8,{scale:4,hue,mood:m,a:smooth((t-.45)/.5)*.95});
      }
      B.drift(c,t,34,{petals:true,a:.85});
      for(let k=0;k<2;k++){
        const x=((t*(30+k*24)+k*700)%2400)-1100;
        LCD.blit(c,`petal_stream_${1+k}.png`,x+640,560+k*60-Math.sin(t*.6+k)*20,{w:1500,h:660,a:(.3-.08*k)*open});
      }
      // ロゴ: ドンと出て、わずかに浮かぶ。光が走る
      const land=clamp((t-.35)/.5),k=easeOutBack(land),zoom=lerp(1.4,1,easeOut(land))*(1+.012*Math.sin(t*1.2)),a=smooth((t-.3)/.3);
      const ly=176+Math.sin(t*1.1)*5;
      LCD.add(c,'glow_soft.png',640,ly,{w:1240,h:420,a:.42*a,tint:'#ffb458'});
      if(t>.7&&t<1.3) LCD.add(c,'flare_streak.png',640,ly,{w:1400*(1-(t-.7)*.7),h:64,a:.8*(1-(t-.7)/.6)});
      LCD.titleFit(c,'logo','パチコマ',640,ly,{w:960,h:240,zoom,a,glowA:.95+.2*Math.sin(t*2.2)});
      B.shine(c,t,g=>LCD.titleFit(g,'logo','パチコマ',640,ly,{w:960,h:240,zoom,shadowA:0,glowA:0}),{a:.65*a,speed:.3});
      // ロゴの両脇に金の線と菱形(文字だけの安っぽさを避ける)
      c.save();c.globalAlpha=a*.85;const lg=c.createLinearGradient(0,0,1,0);
      for(const sgn of[-1,1]){const x0=640+sgn*540,x1=640+sgn*400;const gr=c.createLinearGradient(x0,0,x1,0);gr.addColorStop(0,'rgba(255,214,125,0)');gr.addColorStop(1,'rgba(255,214,125,.9)');c.strokeStyle=gr;c.lineWidth=3;c.beginPath();c.moveTo(x0,ly+150);c.lineTo(x1,ly+150);c.stroke();c.fillStyle='#ffe6a8';c.save();c.translate(x1,ly+150);c.rotate(Math.PI/4);c.fillRect(-6,-6,12,12);c.restore();}
      c.restore();
      if(t>1.1){const sg=smooth((t-1.1)/.5);goldText(c,'さくらの うみで たまあそび',640,ly+150,{size:30,a:sg*.9,stroke:5,glow:'#ff9ac0'});}
      sc.S.P.draw(c);
      // 下の案内: 枠のない金の文字。光るボタンを指す。下から押し寄せるリングで「ここを押す」を強調
      const g=c.createLinearGradient(0,590,0,720);g.addColorStop(0,'rgba(4,8,22,0)');g.addColorStop(1,'rgba(4,8,22,.78)');c.fillStyle=g;c.fillRect(0,590,1280,130);
      const pa=smooth((t-1.5)/.5),beat=.5+.5*Math.sin(t*TAU*.8);
      for(let r=0;r<2;r++){const q=((t*.8+r*.5)%1);LCD.add(c,'flare_ring.png',160,664,{w:70+q*150,h:70+q*150,a:pa*(1-q)*.7,tint:'#ffd98a'});}
      goldText(c,'ひかっている ボタンを おしてね',700,664,{size:40,a:pa*(.75+.25*beat),stroke:7});
      B.point(c,160,664,'left',t,{s:.85,a:pa*(.6+.4*beat)});
    }
  });

  // ───────── ルール説明(タイトルのボタンの後、玉が出る前に) ─────────
  // 一文で「玉を上から落として、穴に入れて増やす」。落ちる→穴が光る→玉が増える、を絵で見せる。
  const PEG_ROWS=[[300,380,460,540,620,700,780,860,940],[340,420,500,580,660,740,820,900],[300,380,460,540,620,700,780,860,940]];
  // ───────── あそびかた(開始前の基本説明) ─────────
  // 実機の「あそびかた」画面にならい、番号つきの3コマを絵で順に見せる。字幕は大きく2行。計7.6秒(ボタンで飛ばせる。時計は止まる)。
  //  1 玉を落として穴に入れる→入った穴が光る  2 ちがう穴に入るほど光が増え、7つ全部でJP  3 同じ穴に入るとルーレット→ランプが消えることがある
  // 「しょうぶ」(4つ以上)の説明は、はじめて4灯になった時に出す(tut_lamp4)。ここでは詰め込まない。
  const HOW=[[0,2.2],[2.2,5.0],[5.0,7.6]],HOW_END=7.6,FD=.5;
  const wheel=(c,x,y,r,rot,a)=>{
    c.save();c.globalAlpha=a;c.translate(x,y);c.rotate(rot);
    for(let i=0;i<8;i++){c.fillStyle=i%2?'#fff0c8':'#ff4a5c';c.beginPath();c.moveTo(0,0);c.arc(0,0,r,i*TAU/8,(i+1)*TAU/8);c.closePath();c.fill();}
    c.restore();c.save();c.globalAlpha=a;c.strokeStyle='#f6ce85';c.lineWidth=7;c.beginPath();c.arc(x,y,r,0,TAU);c.stroke();
    c.fillStyle='#2a1d12';c.beginPath();c.arc(x,y,r*.14,0,TAU);c.fill();
    c.fillStyle='#fff';c.strokeStyle='#6e3f18';c.lineWidth=3;c.beginPath();c.moveTo(x,y-r-6);c.lineTo(x-12,y-r-30);c.lineTo(x+12,y-r-30);c.closePath();c.fill();c.stroke();c.restore();
  };
  const HX=(i,step)=>640+(i-4)*step;
  LCD.scene({id:'howto',dur:HOW_END,cover:true,assets:[...B.assets,...B.titles('jackpot')],
    start(sc){B.init(sc);},
    update(sc,dt){B.step(sc,dt);
      B.at(sc,4.35,()=>{LCD.flash(.45,'#fff0c4',7);LCD.shake(10,.3);B.burst(sc,80,640,330,1.1);});
      B.at(sc,5.72,()=>{LCD.flash(.3,'#ff4a5c',8);LCD.shake(8,.3);});
    },
    draw(c,t,sc) {
      B.layer(c,B.exit(t,HOW_END,.3),g=>{
        const open=smooth(t/.25),step=HOW.findIndex(([a,b])=>t>=a&&t<b),st=step<0?2:step,lt=t-HOW[st][0],S=92,HY=560;
        B.background(g,t);B.drift(g,t,24,{a:.5});B.drift(g,t,26,{petals:true,a:.7});
        goldText(g,'あそびかた',140,50,{size:38,a:open,stroke:7});
        for(let i=0;i<3;i++){const on=i===st,x=560+i*80,y=50;g.save();g.globalAlpha=open;g.fillStyle=on?'#ffd978':'rgba(255,255,255,.2)';g.strokeStyle=on?'#6e3f18':'rgba(255,255,255,.4)';g.lineWidth=4;g.beginPath();g.arc(x,y,on?26:20,0,TAU);g.fill();g.stroke();g.restore();LCD.text(g,String(i+1),x,y+2,{size:on?32:24,a:open,fill1:on?'#4a2a10':'#dfe6f8',fill2:on?'#4a2a10':'#dfe6f8',stroke:0,strokeColor:'rgba(0,0,0,0)'});}
        g.save();g.globalAlpha=.9*open;
        const bg=g.createLinearGradient(0,110,0,610);bg.addColorStop(0,'rgba(10,18,44,.55)');bg.addColorStop(1,'rgba(10,18,44,.78)');
        g.fillStyle=bg;g.strokeStyle='rgba(246,206,133,.55)';g.lineWidth=3;g.beginPath();g.roundRect(170,108,940,500,26);g.fill();g.stroke();
        PEG_ROWS.forEach((row,ri)=>row.forEach(px=>{const py=190+ri*84;LCD.add(g,'glow_soft.png',px,py,{w:34,h:34,a:.5,tint:'#ffd98a'});g.fillStyle='#ffe6a8';g.beginPath();g.arc(px,py,7,0,TAU);g.fill();}));
        g.restore();
        const fall=(t0,i,tt=t)=>{const u=(tt-t0)/FD;if(u<0||u>=1)return false;const y=lerp(130,HY-26,u*u*.45+u*.55),x0=HX(i,S),zig=Math.sin(u*TAU*2)*(1-u)*70;
          for(let k=1;k<5;k++)LCD.add(g,'glow_soft.png',x0+zig*(1-.02*k),y-k*14,{w:30,h:30,a:.2*(1-k/5),tint:'#ffd98a'});LCD.ball(g,x0+zig,y,22,{a:smooth(u/.15)});return true;};
        const ring=(tt,i,col='#ffd070')=>{const q=clamp((t-tt)/.5);if(q>0&&q<1){LCD.add(g,'flare_ring.png',HX(i,S),HY,{w:60+q*240,h:60+q*120,a:.8*(1-q)});LCD.add(g,'glow_soft.png',HX(i,S),HY,{w:200,h:200,a:.6*(1-q*.5),tint:col});}};
        let lit=[],sub1='',sub2='';
        if(st===0){
          fall(.2,4);lit=lt>.2+FD?[4]:[];ring(.2+FD,4);
          sub1='たまを うえから おとして あなに いれよう';sub2='はいった あなが ひかる!';
          if(lt>.75)LCD.text(g,'ひかった!',HX(4,S),HY-96,{size:40,a:smooth((lt-.8)/.2)*(1-smooth((lt-1.9)/.3)),fill1:'#fff6d8',fill2:'#ffcf7a',stroke:8,glow:'#d98a3a'});
        } else if(st===1){
          const seq=[[.1,3],[.4,5],[.7,2],[1.0,6],[1.3,1],[1.6,7]];
          lit=[4];seq.forEach(([a,i])=>{fall(a,i,lt);if(lt>a+FD)lit.push(i);ring(HOW[1][0]+a+FD,i);});
          goldText(g,`ひかった あな ${lit.length} / 7`,640,196,{size:46,a:open});
          sub1='ちがう あなに はいるほど ひかる あなが ふえる';sub2=lit.length>=7?'7つ ぜんぶで JP!':'7つ そろえば…';
          if(lt>2.1){const q=clamp((lt-2.1)/.35);LCD.titleFit(g,'jackpot','JACKPOT',640,330,{w:620,h:150,a:smooth(q),zoom:lerp(1.6,1,easeOut(q))});LCD.add(g,'flare_streak.png',640,330,{w:1100*q,h:60,a:.8*(1-smooth((lt-2.5)/.3))});}
        } else {
          lit=lt<1.6?[1,2,3,4]:[1,2];
          fall(.2,2,lt);if(lt>.2+FD&&lt<1.3)LCD.add(g,'glow_soft.png',HX(2,S),HY,{w:230,h:230,a:.8*(1-smooth((lt-.7)/.6)),tint:'#ff3a44'});
          if(lt>.75){const q=clamp((lt-.75)/.3),rot=18*(1-Math.exp(-Math.max(0,lt-.75)*1.6)),k=smooth(q)*(1-smooth((lt-2.3)/.3));
            LCD.add(g,'glow_soft.png',640,330,{w:560*q,h:560*q,a:.55*k,tint:'#ff3a44'});wheel(g,640,330,130*smooth(q),rot+lt*.2,k);
            if(lt>1.6)LCD.text(g,'ランプが きえた!',640,500,{size:40,a:k*smooth((lt-1.65)/.2),fill1:'#fff0f0',fill2:'#ff9aa6',stroke:8,strokeColor:'#6a1a2a',glow:'#ff4a5c'});}
          sub1='おなじ あなに はいると ルーレット!';sub2='ランプが きえる ことも あるよ';
        }
        B.holes(g,640,HY,t,{lit},{step:S,r:23,a:open,target:false});
        for(let i=1;i<=7;i++)LCD.text(g,String(i),HX(i,S),HY+50,{size:22,a:.7*open,stroke:3,fill2:'#bcc8ea'});
        sc.S.P.draw(g);
        const sa=smooth(lt/.2)*(1-smooth((lt-(HOW[st][1]-HOW[st][0]-.2))/.2));
        goldText(g,sub1,640,646,{size:42,a:Math.max(sa,.0)});goldText(g,sub2,640,696,{size:50,weight:900,a:sa,fill1:'#fff9e0',fill2:'#ffd24a'});
        LCD.text(g,'ひかる ボタンで とばせる ▶',1050,100,{size:28,a:smooth((t-.4)/.3)*(.7+.3*Math.sin(t*4)),fill1:'#f4f8ff',fill2:'#c8d4f2',stroke:6});
      });
    }
  });

  // ───────── チケット → 玉 ─────────
  // チケットは店員が受け取り済み。ここでは「18球ゲット」が決まる瞬間を見せ、玉は下の皿に出る。
  const drawTicket=(c,x,y,rot,s,a,shineT)=>{
    c.save();c.globalAlpha=a;c.translate(x,y);c.rotate(rot);c.scale(s,s);
    c.shadowColor='rgba(0,0,0,.5)';c.shadowBlur=30;c.shadowOffsetY=14;
    const w=520,h=230;
    const g=c.createLinearGradient(-w/2,-h/2,w/2,h/2);g.addColorStop(0,'#fff6d8');g.addColorStop(.5,'#ffe9b0');g.addColorStop(1,'#f6cf86');
    c.fillStyle=g;c.beginPath();c.roundRect(-w/2,-h/2,w,h,22);c.fill();c.shadowBlur=0;c.shadowOffsetY=0;
    // 金の二重罫
    c.strokeStyle='#c68a2e';c.lineWidth=5;c.beginPath();c.roundRect(-w/2+10,-h/2+10,w-20,h-20,16);c.stroke();
    c.strokeStyle='rgba(198,138,46,.55)';c.lineWidth=2;c.beginPath();c.roundRect(-w/2+20,-h/2+20,w-40,h-40,10);c.stroke();
    // 切り取り線とミシン目の半円
    c.setLineDash([8,8]);c.strokeStyle='#b8782a';c.lineWidth=3;c.beginPath();c.moveTo(130,-h/2+16);c.lineTo(130,h/2-16);c.stroke();c.setLineDash([]);
    c.fillStyle='#07102a';for(const yy of[-h/2,h/2]){c.beginPath();c.arc(130,yy,16,0,TAU);c.fill();}
    LCD.blit(c,'crest_sakura.png',-w/2+75,0,{w:120,h:120,a:.9});
    LCD.text(c,'パチコマ',85,-56,{size:40,fill1:'#6b3b1d',fill2:'#8a4f1f',stroke:0,strokeColor:'rgba(0,0,0,0)'});
    LCD.text(c,`${LCD.rules().loanBalls} BALLS`,85,10,{size:60,fill1:'#8a4a12',fill2:'#c2761c',stroke:0,strokeColor:'rgba(0,0,0,0)'});
    LCD.text(c,'あそびけん',85,66,{size:26,fill1:'#8a4f1f',fill2:'#8a4f1f',stroke:0,strokeColor:'rgba(0,0,0,0)'});
    LCD.text(c,'あそびけん',320,0,{size:28,fill1:'#8a4f1f',stroke:0,strokeColor:'rgba(0,0,0,0)',a:0});
    // 光沢が走る
    if(shineT!=null){c.save();c.beginPath();c.roundRect(-w/2,-h/2,w,h,22);c.clip();c.globalCompositeOperation='lighter';
      const sx=lerp(-w,w,shineT),sg=c.createLinearGradient(sx-60,0,sx+60,0);sg.addColorStop(0,'rgba(255,255,255,0)');sg.addColorStop(.5,'rgba(255,255,255,.75)');sg.addColorStop(1,'rgba(255,255,255,0)');
      c.fillStyle=sg;c.fillRect(-w/2,-h/2,w,h);c.restore();}
    c.restore();
  };
  B.scene({id:'ticket',dur:5,fade:.08,cover:true,assets:[...B.assets,...B.digits(),...B.titles('get'),'flare_ring.png'],
    start(sc){B.init(sc);sc.S.count=0;sc.S.fall=[];},
    update(sc,dt){
      B.step(sc,dt);
      const tot=LCD.rules().loanBalls,count=Number.isFinite(sc.params.count)?clamp(Math.floor(sc.params.count),0,tot):LCD.landed(tot,Math.min(tot,Math.round(clamp((sc.t-1.2)/2.4)*tot)));
      if(count>sc.S.count){sc.S.count=count;
        // 数字が増えるたび、右下(皿の出口)へ向けて玉の影がこぼれる
        for(let i=0;i<2;i++) sc.S.P.emit({x:880+sc.rand()*30,y:420,vx:60+sc.rand()*90,vy:20,ay:900,life:.9,s0:.2,s1:.16,a0:1,a1:.2,img:'glint_1.png',tint:'#ffe3a0',blend:'add'});
      }
      // ゲット後(1.1秒〜)、皿の出口へ向けて光の玉がつぎつぎ落ちる(物理の玉は液晶の外の皿に出る)
      if(sc.t>1.1&&sc.t<3.9&&sc.rand()<dt*9) sc.S.fall.push({x:1010+sc.rand()*60,y:380+sc.rand()*40,v:260+sc.rand()*140,age:0,r:12+sc.rand()*3});
      sc.S.fall.forEach(f=>{f.age+=dt;f.y+=f.v*dt;f.v+=900*dt;f.x+=40*dt;});sc.S.fall=sc.S.fall.filter(f=>f.y<780);
      B.at(sc,1.0,()=>{LCD.flash(.45,'#fff0c4',7);LCD.shake(11,.35);LCD.punch(.03);B.burst(sc,70,640,330,1.0);});
    },
    draw(c,t,sc){
      const a=B.exit(t,5,.08),tot=LCD.rules().loanBalls;
      B.background(c,t);B.drift(c,t,22,{a:.55});B.drift(c,t,30,{petals:true,a:.6});
      LCD.rays(c,640,330,{n:21,a:.18*smooth((t-.9)/.3),rot:t*.06,color:'255,214,125'});
      // 0〜1秒: チケットが手前に飛んできて止まり、ひかる → 光になって弾ける
      if(t<1.05){
        const m=easeOut(clamp(t/.6)),x=lerp(180,640,m),y=lerp(560,330,m)-Math.sin(m*Math.PI)*50,rot=lerp(-.35,-.04,m),s=lerp(.55,1.12,m)*(1+.04*smooth((t-.7)/.3)),fade=1-smooth((t-.88)/.17);
        LCD.add(c,'glow_soft.png',x,y,{w:720*s,h:420*s,a:.45*fade,tint:'#ffcf72'});
        drawTicket(c,x,y,rot,s,fade,clamp((t-.45)/.45));
        LCD.text(c,'チケットを うけとったよ',640,110,{size:40,a:smooth(t/.3)*fade,fill1:'#fff0c8',fill2:'#ffd488',stroke:7,glow:'#d98a3a'});
        if(t>.88) LCD.add(c,'flare_streak.png',640,330,{w:1100,h:50,a:.9*(t-.88)/.17});
      } else {
        const q=clamp((t-1)/.4),pop=easeOutBack(q);
        // GET! と数字
        LCD.titleFit(c,'get','GET!',640,142,{w:420,h:130,a:smooth(q),zoom:lerp(1.5,1,easeOut(q))});
        B.shine(c,t,g=>LCD.titleFit(g,'get','GET!',640,142,{w:420,h:130,zoom:1,shadowA:0,glowA:0}),{a:.5,speed:.9});
        LCD.add(c,'glow_soft.png',640,350,{w:1000,h:380,a:.35*smooth(q),tint:'#ffb85a'});
        LCD.number(c,sc.S.count,560,352,{h:210,w:560,a:smooth(q),zoom:lerp(.6,1,pop)});
        goldText(c,'たま',920,372,{size:72,a:smooth(q),stroke:10});
        // 数字の下: 進み具合の金のバー
        const pg=clamp(sc.S.count/tot);c.save();c.globalAlpha=smooth(q)*a;
        c.fillStyle='rgba(8,14,36,.75)';c.strokeStyle='#f1cc86';c.lineWidth=3;c.beginPath();c.roundRect(300,490,680,26,13);c.fill();c.stroke();
        const bg=c.createLinearGradient(300,0,980,0);bg.addColorStop(0,'#ff9fbf');bg.addColorStop(1,'#ffd36e');c.fillStyle=bg;c.beginPath();c.roundRect(304,494,672*pg,18,9);c.fill();c.restore();
        // 皿の出口へ落ちる光の玉(液晶の外へ出ていく)
        sc.S.fall.forEach(f=>{LCD.ball(c,f.x,f.y,f.r,{a:Math.min(1,f.age*6)});LCD.add(c,'glow_soft.png',f.x,f.y-18,{w:60,h:90,a:.35,tint:'#ffd98a'});});
        B.trayArrow(c,t,1130,520,{a:a*smooth((t-1.3)/.3),first:sc.params.first===true,busy:sc.S.count<tot});
      }
      sc.S.P.draw(c);
    }
  });
})();
