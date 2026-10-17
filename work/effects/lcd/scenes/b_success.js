/* 結果が決まってから再生する増幅演出。玉を積む場所は液晶外の受け皿。 */
(function () {
  'use strict';
  const {B,clamp,smooth,easeOut,easeOutBack,lerp,TAU}=LCD;
  const extras=['petal_5.png','petal_6.png','ribbon_3.png','flip:impact_2','flip:shock_2'];
  function init(sc,big){
    B.init(sc);sc.S.P=LCD.particles(big?900:280,81);sc.S.Q=LCD.particles(big?550:120,92);
    sc.S.acc=0;sc.S.land=0;sc.S.drop=0;sc.S.big=big;
  }
  function burst(sc,sparks,petals,x=640,y=300,power=1){
    for(let i=0;i<sparks;i++){
      const an=sc.rand()*TAU,v=(180+sc.rand()*1100)*power;
      sc.S.P.emit({x,y,vx:Math.cos(an)*v,vy:Math.sin(an)*v*.7-90,ay:180,drag:1.3,life:.35+sc.rand()*1.1,s0:.18+sc.rand()*.5,s1:.015,img:i%5?'spark.png':'glint_2.png',tint:i%3?'#ffd071':'#fff1c5'});
    }
    for(let i=0;i<petals;i++){
      const an=sc.rand()*TAU,v=(100+sc.rand()*660)*power;
      sc.S.Q.emit({x:x+(sc.rand()-.5)*100,y:y+(sc.rand()-.5)*80,vx:Math.cos(an)*v,vy:Math.sin(an)*v*.65-90,ay:100,drag:.55,flutter:45,life:1+sc.rand()*1.65,s0:.25+sc.rand()*.65,s1:.12,rot:an,vr:(sc.rand()-.5)*3,img:`petal_${1+i%6}.png`,blend:'normal'});
    }
  }
  function step(sc,dt){
    sc.S.P.step(dt);sc.S.Q.step(dt);sc.S.drop=Math.max(0,sc.S.drop-dt*2.8);
    const live=sc.t>.48&&sc.t<(sc.S.big?(sc.S.D||6.6)-.3:3.1),rate=sc.S.big?110:22;
    sc.S.acc+=live?dt*rate:0;
    while(sc.S.acc>=1){
      sc.S.acc--;const x=sc.rand()*1400-60,y=sc.rand()*800-40;
      sc.S.P.emit({x,y,vx:(sc.rand()-.5)*80,vy:-25-sc.rand()*100,life:Math.min(.3+sc.rand()*.6,(sc.S.big?7:3.8)-sc.t),s0:.1+sc.rand()*.18,s1:.01,img:'glint_1.png',tint:'#ffe7ac'});
    }
    const pourAt=sc.S.big?3.4:1.4,pourDur=sc.S.big?Math.max(1.2,sc.S.payout/10):.8;
    if(sc.t>=pourAt){
      const amount=LCD.landed(sc.S.payout,Math.min(sc.S.payout,Math.ceil(sc.S.payout*clamp((sc.t-pourAt)/pourDur))));
      if(amount>sc.S.land){
        sc.S.drop=1;
        for(let i=0;i<Math.min(60,(amount-sc.S.land)*7);i++)sc.S.P.emit({x:640+(sc.rand()-.5)*260,y:723,vx:(sc.rand()-.5)*200,vy:-80-sc.rand()*240,ay:230,life:.4+sc.rand()*.6,s0:.16+sc.rand()*.25,s1:.01,img:'glint_2.png',tint:'#ffe0a0'});
      }
      sc.S.land=amount;
    }
  }
  // 加算連番の縁に残る矩形を、透明な放射マスクで落とす。
  let impactCanvas;
  function impact(c,id,t,x,y,s,a){
    if(t<0||a<=0)return;
    impactCanvas ||= document.createElement('canvas');
    if(impactCanvas.width!==1280){impactCanvas.width=1280;impactCanvas.height=720;}
    const g=impactCanvas.getContext('2d');g.clearRect(0,0,1280,720);g.save();
    LCD.flip(g,id,t,x,y,{s,a:1});g.globalCompositeOperation='destination-in';
    const mask=g.createRadialGradient(x,y,120,x,y,620);mask.addColorStop(0,'#fff');mask.addColorStop(.72,'rgba(255,255,255,.8)');mask.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=mask;g.fillRect(0,0,1280,720);g.restore();
    c.save();c.globalAlpha=a;c.globalCompositeOperation='lighter';c.drawImage(impactCanvas,0,0);c.restore();
  }
  function orbit(c,t,a,power=1){
    const colors=['#ffd772','#ff8ec5','#fff0b8'];
    for(let i=0;i<3;i++){
      const an=t*(.38+i*.13)+i*1.9;
      LCD.add(c,`ribbon_${i+1}.png`,640,302,{w:1430*power,h:220*power,rot:an,a:a*(.3-i*.045),tint:colors[i]});
      for(let j=0;j<2;j++){
        const q=an+j*Math.PI,x=640+Math.cos(q)*510*power,y=302+Math.sin(q)*155*power;
        LCD.add(c,'glint_2.png',x,y,{w:70,h:70,a:a*.8});LCD.add(c,'glow_soft.png',x,y,{w:155,h:155,a:a*.2,tint:colors[i]});
      }
    }
  }
  function swirl(c,t,n,a,front=false){
    const r=LCD.rng(front?923:771);
    for(let i=0;i<n;i++){
      const z=.35+r(),seed=r(),ang=i*2.39996+t*(front?.9:.46),phase=(seed+t*(front?.19:.11))%1;
      const rad=180+phase*850,x=640+Math.cos(ang)*rad,y=325+Math.sin(ang)*rad*.62;
      if(front&&x>180&&x<1100&&y>100&&y<475)continue;
      LCD.blit(c,`petal_${1+i%6}.png`,x,y,{w:(front?58:38)*z,h:(front?49:30)*z,rot:ang+t*(i%2?1:-1),a:a*(.4+.5*seed)});
    }
  }
  function receiving(c,t,a,pulse=0){
    if(a<=0)return;
    // 落下点は必ず液晶下端。画面内に受け皿や玉の山を描かない。
    LCD.add(c,'glow_soft.png',640,735,{w:540,h:130,a:a*(.22+.32*pulse),tint:'#ffd17a'});
    LCD.add(c,'flare_streak.png',640,717,{w:620,h:26,a:a*(.3+.3*pulse),tint:'#ffe5ac'});
    B.trayArrow(c,t,640,578,{a,busy:true,first:false});
    LCD.text(c,'おさらへ!',350,647,{size:40,a,stroke:8,fill1:'#ffe6a5'});
  }
  function team(c,t,n,y,scale,a,gap=150){
    for(let i=0;i<n;i++){
      const hop=Math.max(0,Math.sin(t*5-i*.6))*42;
      LCD.upa(c,640+(i-(n-1)/2)*gap,y-hop,{scale,hue:LCD.HUES[i],mood:'happy',a});
    }
  }
  function toTray(c,t,n,y,scale,a,gap=150){
    for(let i=0;i<n;i++){
      const q=clamp((t-i*.08)/1.55),go=smooth(q),x=lerp(640+(i-(n-1)/2)*gap,640,go),yy=lerp(y,760,go)-Math.sin(go*Math.PI)*60,change=smooth((q-.18)/.24);
      LCD.upa(c,x,yy,{scale,hue:LCD.HUES[i],mood:'happy',a:a*(1-change)});
      LCD.ball(c,x,yy,20,{a:a*change*(1-smooth((q-.9)/.1))});
      if(q>0&&q<1)LCD.add(c,'glint_1.png',x,yy-22,{w:36,h:36,a:a*(1-q)});
    }
  }
  // ───────── 成功(小): 回収できた。小さく、でも当たりの語彙で ─────────
  const HS_S=[[.46,.06]];
  LCD.scene({id:'success_small',dur:3.4,assets:[...B.assets,...extras,...B.titles('seikou'),...B.digits(),'sprite_happy.png'],
    start(sc){init(sc,false);sc.S.payout=clamp(Math.round(sc.params.payout??1),1,3);burst(sc,38,17,640,275,.6);LCD.shake(6,.2);},
    update(sc,dt){
      if(!B.frozen(sc.t,HS_S))step(sc,dt);else sc.S.drop=sc.S.drop;
      B.at(sc,.2,()=>{LCD.flash(.6,'#ffc43a',8);LCD.shake(14,.3);LCD.punch(.04);burst(sc,60,20,640,270,.8);});
      B.at(sc,.46,()=>{LCD.shake(10,.2);burst(sc,40,10,640,270,.7);});
      B.at(sc,.95,()=>{LCD.flash(.4,'#ffb000',9);LCD.punch(.02);burst(sc,38,14,640,280,.65);});
    },
    draw(c,t,sc){
      const T=B.hs(t,HS_S),p=sc.S.payout;
      B.layer(c,B.exit(t,3.4,.3),c=>{
        const pre=smooth(T/.2);
        LCD.dim(c,.72*pre,'#0a0830');
        // 金の面+周回する光。彩度を落とさない
        const pulse=T>.2&&T<1.3?Math.max(0,Math.sin((T-.2)*TAU*2.4)):0;
        B.blink(c,'#ff8a00',.2*pulse);
        LCD.add(c,'crest_glow.png',640,290,{w:700,h:700,a:.3,tint:'#ffb000'});
        LCD.rays(c,640,275,{n:21,len:980,rot:T*.2,a:.22,color:'255,180,40'});B.stream(c,T,640,275,{n:22,a:.4,speed:.9});
        B.confetti(c,T,{t0:.2,n:70,a:.9,spread:.5});
        swirl(c,T,26,.7);sc.S.Q.draw(c);orbit(c,T,.45,.8);
        if(T>=.2){
          const u=T-.2,e=easeOut(u/.4),fade=1-smooth((T-1.2)/.18),zoom=lerp(.2,1,easeOutBack(clamp(u/.36)));
          if(fade>0){
            LCD.add(c,'glow_soft.png',640,265,{w:980,h:420,a:.45*fade,tint:'#ff9a00'});
            B.titleSpin(c,'seikou','成功!',640,265,{w:740,h:225,zoom,ry:(1-e)*TAU*1,rz:(1-e)*.3,a:fade});
          }
        }
        if(T>=.95){
          const u=T-.95,show=smooth(u/.13),z=(.45+.55*easeOutBack(u/.34))*(1+.08*sc.S.drop),y=281+Math.sin(u*4)*4-sc.S.drop*7;
          LCD.radial(c,640,280,390,'7,15,33',.5*show,'source-over');
          LCD.number(c,'+'+p,605,y,{w:680,h:235,zoom:z,a:show});
          B.shine(c,u,g=>LCD.number(g,'+'+p,605,y,{w:680,h:235,zoom:z,shadowA:0,glowA:0}),{a:show*.6,speed:.9});
          LCD.text(c,'玉',852,y+44,{size:62,a:show,stroke:9,fill1:'#ffdfa1'});
        }
        if(T<1.45)team(c,T,p,517,6,1,235);else toTray(c,T-1.45,p,517,6,1,235);
        sc.S.P.draw(c);
        receiving(c,T,smooth((T-1.25)/.25),Math.max(sc.S.drop,.25+.25*Math.sin(T*9)));
        if(sc.params.first===true)LCD.text(c,'玉が ふえた!',640,426,{size:40,a:smooth((T-1)/.2),stroke:8,fill1:'#ffe5b2'});
      });
    }
  });

  // ───────── 大成功: 虹の点滅・回転して飛び込む立体文字・光の筋・金の花吹雪・弾む数字 ─────────
  const HS_B=[[.62,.1],[1.9,.08]];
  LCD.scene({id:'success_big',dur:6.6,cover:true,assets:[...B.assets,...extras,...B.titles('daiseikou'),...B.digits(),...B.digitsR(),'sprite_happy.png'],
    start(sc){
      init(sc,true);const pay=Math.round(sc.params.payout??12);sc.S.payout=pay>=24?pay:12;
      sc.S.extra=pay>=24;sc.S.D=sc.S.extra?6.6:4.8;LCD.shake(4,.3);
    },
    update(sc,dt){
      const D=sc.S.D;if(sc.t>D+.02){sc.t=1e9;return;}   // 賞12玉は4.8秒、24/30玉は6.6秒で終える
      if(!B.frozen(sc.t,HS_B))step(sc,dt);
      const x=sc.S.extra;
      B.at(sc,.3,()=>{LCD.flash(.75,'#ffb21a',8);LCD.shake(x?24:20,.4);LCD.punch(.05);burst(sc,130,60,640,300,x?1.4:1.1);});
      B.at(sc,.62,()=>{LCD.flash(.7,'#ff4fa8',9);LCD.shake(x?26:22,.36);LCD.punch(.06);burst(sc,150,70,640,300,1.3);});
      B.at(sc,1.15,()=>{LCD.flash(.45,'#36d6ff',10);burst(sc,60,30,640,300,1);});
      B.at(sc,1.55,()=>{LCD.flash(.5,'#ffd23a',10);LCD.shake(10,.25);burst(sc,60,30,640,300,1);});
      B.at(sc,1.9,()=>{LCD.flash(.75,'#ffc01a',9);LCD.shake(x?24:19,.38);LCD.punch(.06);burst(sc,160,70,640,320,x?1.4:1.15);});
      B.at(sc,2.5,()=>{LCD.flash(.4,'#ff6ad0',10);burst(sc,50,25,640,300,.9);});
      B.at(sc,3.4,()=>{LCD.shake(8,.25);burst(sc,40,15,640,705,.7);});
    },
    draw(c,t,sc){
      const x=sc.S.extra,D=sc.S.D,T=B.hs(t,HS_B);
      B.layer(c,B.exit(t,D,.3),c=>{
        const open=smooth((T-.28)/.12),pre=1-open;
        // タメ: 暗い画面に集中線が吸い込まれる
        if(T<.3)c.translate(Math.sin(T*83)*2.5*pre,Math.cos(T*61)*2*pre);
        c.fillStyle='#14042e';c.fillRect(-128,-72,1536,864);
        LCD.blit(c,'bg_night_sakura.jpg',640,360,{w:1536,h:864,a:.9});
        LCD.blit(c,'bg_sakura.jpg',640,360,{w:1536,h:864,a:open*.55});
        LCD.dim(c,.35*pre,'#10001c');
        // 全画面の虹の点滅(強い点滅は1秒3回まで: 2.5回/秒 → 後半はゆっくり)
        const fast=T>.3&&T<1.8,pulse=fast?Math.max(0,Math.sin((T-.3)*TAU*2.5))**.7:T>=1.8&&T<3.4?.5+.5*Math.sin((T-1.8)*TAU*1.2):.35;
        if(T>=.3)B.rainbow(c,T,(fast?.3+.5*pulse:.2+.25*pulse)*(T<D-.5?1:.5),{speed:150});
        LCD.add(c,'crest_glow.png',640,300,{w:450+open*850,h:450+open*850,a:.1+open*.32,tint:'#ffb000'});
        if(T<.3){
          B.speed(c,T,640,300,{n:40,a:.8,color:'255,200,60',inward:true,rate:3,r0:60,reach:700});
          LCD.add(c,'flare_ring.png',640,300,{w:620-T*1600,h:620-T*1600,a:.5*(T/.3),tint:'#ffcf4a'});
        }
        if(T>=.3){
          LCD.rays(c,640,300,{n:x?39:31,len:1250,rot:T*.14,a:x?.4:.34,color:'255,196,60'});
          LCD.rays(c,640,300,{n:17,len:1100,rot:-T*.2,a:.28,color:'255,120,210'});
          B.stream(c,T,640,300,{n:x?70:50,a:.9,speed:1.9});
          orbit(c,T,x?1:.85);
          swirl(c,T,x?140:100,.85);sc.S.Q.draw(c);
          B.confetti(c,T,{t0:.3,n:x?170:130,a:.95,spread:1.4,seed:31});
          if(T<2.9)B.fire(c,T,x?1.6:1.2,.5*(1-smooth((T-2.2)/.7)));
        }
        // 立体の「大成功!」が回りながら飛び込む → 数字が出る頃に左上へ移る
        if(T>=.3){
          const u=T-.3,e=easeOut(u/.5),zb=easeOutBack(clamp(u/.42)),shift=smooth((T-1.72)/.2);
          const zoom=lerp(.12,1.05,zb)*(1+.025*Math.sin(u*5))*lerp(1,.5,shift);
          const tx=lerp(640,x?390:370,shift),ty=lerp(300+Math.sin(u*3)*5,96,shift);
          if(shift<1)LCD.radial(c,tx,ty,520*lerp(1,.5,shift),'28,2,40',.5*(1-shift),'source-over');
          LCD.add(c,'glow_soft.png',tx,ty,{w:1500*zoom,h:620*zoom,a:.5,tint:'#ffa000'});
          const o={w:x?1160:1080,h:x?350:320,zoom,ry:(1-e)*TAU*1.25,rz:(1-e)*.55};
          B.titleSpin(c,'daiseikou','大成功!',tx,ty,o);
          B.shine(c,u,g=>B.titleSpin(g,'daiseikou','大成功!',tx,ty,{...o,glowA:0,ry:0,rz:0}),{a:.7*e,speed:1.05});
          if(T<1.95)team(c,u,7,575,x?5:4,1,153);
        }
        if(T>=1.9){
          const u=T-1.9,show=smooth(u/.06),z=(lerp(2.2,1,easeOut(u/.16)))*(1+.14*sc.S.drop+.02*Math.sin(u*4)),count=sc.S.payout;
          LCD.radial(c,640,330,560,'23,2,32',.75*show,'source-over');
          B.numberR(c,'+'+count,590,335,{w:x?900:840,h:x?330:300,zoom:z,a:show});
          B.shine(c,u,g=>B.numberR(g,'+'+count,590,335,{w:x?900:840,h:x?330:300,zoom:z,shadowA:0,glowA:0}),{a:show*.6,speed:1.1});
          LCD.text(c,'玉',1062,392,{size:104,a:show,stroke:14,fill1:'#fffbe0',fill2:'#ffb000',glow:'#ff9a00',strokeColor:'#3a1060'});
          if(T<3.6)team(c,T,7,575,3,1,153);else toTray(c,T-3.6,7,575,3,1,153);
        }
        sc.S.P.draw(c);
        if(T>=3.4)receiving(c,T,smooth((T-3.4)/.2),sc.S.drop);
        LCD.vignette(c,.25);
      });
    }
  });
})();
