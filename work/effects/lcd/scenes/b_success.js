/* 結果が決まってから再生する増幅演出。玉を積む場所は液晶外の受け皿。 */
(function () {
  'use strict';
  const {B,clamp,smooth,easeOutBack,lerp,TAU}=LCD;
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
    const live=sc.t>.48&&sc.t<(sc.S.big?6.65:3.45),rate=sc.S.big?110:22;
    sc.S.acc+=live?dt*rate:0;
    while(sc.S.acc>=1){
      sc.S.acc--;const x=sc.rand()*1400-60,y=sc.rand()*800-40;
      sc.S.P.emit({x,y,vx:(sc.rand()-.5)*80,vy:-25-sc.rand()*100,life:Math.min(.3+sc.rand()*.6,(sc.S.big?7:3.8)-sc.t),s0:.1+sc.rand()*.18,s1:.01,img:'glint_1.png',tint:'#ffe7ac'});
    }
    const pourAt=sc.S.big?3.4:1.4,pourDur=sc.S.big?3:1.2;
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
  LCD.scene({id:'success_small',dur:3.8,assets:[...B.assets,...extras,...B.titles('seikou'),...B.digits()],
    start(sc){init(sc,false);sc.S.payout=clamp(Math.round(sc.params.payout??1),1,3);burst(sc,38,17,640,275,.6);LCD.shake(5,.18);},
    update(sc,dt){step(sc,dt);B.at(sc,.95,()=>{LCD.flash(.22,'#ffe6ba',8);LCD.punch(.02);burst(sc,38,14,640,280,.65);});},
    draw(c,t,sc){
      const a=B.exit(t,3.8,.3),p=sc.S.payout;
      LCD.dim(c,.65*a,'#08132d');LCD.add(c,'crest_glow.png',640,290,{w:610,h:610,a:.18*a});
      LCD.rays(c,640,275,{n:17,len:900,rot:t*.05,a:.13*a,color:'255,210,136'});B.stream(c,t,640,275,{n:18,a:.3*a,speed:.8});
      swirl(c,t,28,a*.6);sc.S.Q.draw(c);orbit(c,t,a*.4,.8);
      if(t<1.1){
        const fade=1-smooth((t-.9)/.2),z=.7+.3*easeOutBack(t/.22);
        LCD.titleFit(c,'seikou','成功!',640,265,{w:740,h:225,a:a*fade,zoom:z});
      }
      if(t>=.95){
        const u=t-.95,show=smooth(u/.13)*a,z=(.45+.55*easeOutBack(u/.34))*(1+.03*sc.S.drop),y=281+Math.sin(u*4)*4-sc.S.drop*7;
        LCD.radial(c,640,280,390,'7,15,33',.5*show,'source-over');
        LCD.number(c,'+'+p,605,y,{w:680,h:235,zoom:z,a:show});
        B.shine(c,u,g=>LCD.number(g,'+'+p,605,y,{w:680,h:235,zoom:z,shadowA:0,glowA:0}),{a:show*.6,speed:.9});
        LCD.text(c,'玉',852,y+44,{size:56,a:show,stroke:8,fill1:'#ffdfa1'});
      }
      if(t<1.45)team(c,t,p,517,6,a,235);
      else toTray(c,t-1.45,p,517,6,a,235);
      sc.S.P.draw(c);
      receiving(c,t,smooth((t-1.25)/.25)*a,Math.max(sc.S.drop,.25+.25*Math.sin(t*9)));
      if(sc.params.first===true)LCD.text(c,'玉が ふえた!',640,426,{size:36,a:a*smooth((t-1)/.2),stroke:7,fill1:'#ffe5b2'});
    }
  });
  B.scene({id:'success_big',dur:7,cover:true,assets:[...B.assets,...extras,...B.titles('daiseikou'),...B.digits()],
    start(sc){init(sc,true);sc.S.payout=sc.params.payout===30?30:12;LCD.shake(3,.42);},
    update(sc,dt){
      step(sc,dt);const extra=sc.S.payout===30;
      B.at(sc,.5,()=>{LCD.flash(.82,'#ffe1c4',9);LCD.shake(extra?24:18,.4);LCD.punch(.06);burst(sc,140,65,640,310,extra?1.4:1.1);});
      B.at(sc,.82,()=>{LCD.flash(.58,'#ffd1e9',10);burst(sc,75,40,640,310,1.25);});
      B.at(sc,1.4,()=>{LCD.flash(.75,'#fff0c6',9);LCD.shake(extra?21:16,.34);LCD.punch(.05);burst(sc,180,90,640,280,extra?1.45:1.15);});
      B.at(sc,1.72,()=>LCD.flash(.42,'#ffc7e2',11));
      B.at(sc,2.15,()=>{LCD.flash(.58,'#ffedb9',10);burst(sc,55,30,640,285,1);});
      B.at(sc,3.4,()=>{LCD.flash(.86,'#fff0cb',10);LCD.shake(extra?25:18,.36);LCD.punch(.065);burst(sc,170,70,640,300,1.25);});
      B.at(sc,3.83,()=>LCD.flash(.44,'#ffd4eb',10));
      B.at(sc,4.1,()=>{LCD.flash(.58,'#ffe9ae',11);burst(sc,60,30,640,280,.9);});
      B.at(sc,6.4,()=>{LCD.flash(.35,'#ffe5b9',9);burst(sc,40,15,640,705,.55);});
    },
    draw(c,t,sc){
      const extra=sc.S.payout===30,a=B.exit(t,7,.35),open=smooth((t-.47)/.2),pre=1-open;
      // 圧縮するタメ。全画面を空にせず、暗い桜の紋だけを震わせる。
      if(t<.5)c.translate(Math.sin(t*83)*2*pre,Math.cos(t*61)*pre);
      c.fillStyle='#19081b';c.fillRect(-128,-72,1536,864);
      LCD.blit(c,'bg_night_sakura.jpg',640,360,{w:1536,h:864});
      LCD.blit(c,'bg_sakura.jpg',640,360,{w:1536,h:864,a:open*.76});LCD.dim(c,.4+.5*pre,'#16071c');
      LCD.blit(c,'crest_sakura.png',640,300,{w:lerp(235,630,open),h:lerp(235,630,open),a:pre*.5+open*.2,rot:t>.5?t*.12:0});
      LCD.add(c,'crest_glow.png',640,300,{w:450+open*650,h:450+open*650,a:.12+open*.3,tint:'#ffcc78'});
      if(t<.5)LCD.add(c,'flare_ring.png',640,300,{w:290,h:290,a:.25,tint:'#d2a24c'});
      if(t>=.5){
        LCD.rays(c,640,300,{n:extra?39:29,len:1250,rot:t*.11,a:(extra?.36:.29)*a,color:'255,207,124'});
        B.stream(c,t,640,300,{n:extra?66:46,a:.85*a,speed:1.8});
        orbit(c,t,a*(extra?1:.8));
        impact(c,'impact_2',t-.5,640,300,3.1,.55*a);
        impact(c,'shock_2',t-.5,640,300,3.3,.75*a);
        if(t<1.4)impact(c,'pillar_1',t-.5,640,330,3,.6*a);
        swirl(c,t,extra?145:105,.8*a);sc.S.Q.draw(c);
        B.fire(c,t,extra?1.6:1.15,.65*a*(1-smooth((t-2.6)/.8)));
      }
      if(t>=1.4&&t<3.45){
        const u=t-1.4,fade=1-smooth((t-3.28)/.17),zoom=(.58+.42*easeOutBack(u/.25))*(1+.02*Math.sin(u*5)),y=279+Math.sin(u*3)*4;
        LCD.radial(c,640,280,540,'32,4,27',.66*fade,'source-over');
        impact(c,'digitburst_1',u,640,y,1.9,.55*a);
        LCD.titleFit(c,'daiseikou','大成功!',640,y,{w:extra?1160:1080,h:extra?350:320,zoom,a:fade*a});
        B.shine(c,u,g=>LCD.titleFit(g,'daiseikou','大成功!',640,y,{w:extra?1160:1080,h:extra?350:320,zoom,shadowA:0,glowA:0}),{a:fade*a*.85,speed:1.05});
        if(t<3.4)team(c,u,7,555,extra?5:4,a,153);
      }
      if(t>=3.4){
        const u=t-3.4,show=smooth(u/.08)*a,z=1+.13*Math.exp(-u*4)*Math.sin(u*18)+.015*Math.sin(u*4),count=sc.S.land;
        LCD.radial(c,640,290,530,'23,4,25',.88*show,'source-over');
        LCD.titleFit(c,'daiseikou','大成功!',640,87,{w:560,h:90,a:show,glowA:.65});
        LCD.number(c,'+'+count,595,302,{w:extra?900:840,h:extra?330:300,zoom:z,a:show});
        B.shine(c,u,g=>LCD.number(g,'+'+count,595,302,{w:extra?900:840,h:extra?330:300,zoom:z,shadowA:0,glowA:0}),{a:show*.85,speed:1.1});
        LCD.text(c,'玉',1030,364,{size:72,a:show,stroke:10,fill1:'#fff1ba',fill2:'#efb947'});
        if(t<4.65)team(c,t,7,537,3,a,153);
        else toTray(c,t-4.65,7,537,3,a,153);
      }
      if(t>.5)swirl(c,t,extra?65:40,a,true);sc.S.P.draw(c);
      if(t>=3.4)receiving(c,t,smooth((t-3.4)/.2)*a,sc.S.drop);
      LCD.vignette(c,.25);
    }
  });
})();
