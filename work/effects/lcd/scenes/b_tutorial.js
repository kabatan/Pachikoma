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
    draw(c,t,sc){
      // 当たり・失敗・皿のあふれなど、ほかの演出が出ている間は案内を引っ込める(文字の重なりを作らない)。0.15秒でフェード。
      const busy=LCD.active.some(o=>o!==sc&&!o.def.hold);
      const dtt=Math.max(0,Math.min(.1,t-(sc.gt??t)));sc.gt=t;
      sc.gf=clamp((sc.gf??1)+(busy?-1:1)*dtt/.15,0,1);
      const a=smooth(t/.3)*sc.gf,idle=smooth((t-12)/.6);
      // STARTから発射待ちへ移っても、同じ案内を続ける(筐体の左下のボタンを指す)。12秒で一度指し直し、その後も呼吸する。
      E.launchGuide(c,t,{a,s:1+idle*.1,y:628-idle*6});
      if(t>=12&&t<13.4) LCD.add(c,'flare_ring.png',128,640,{w:150+100*smooth((t-12)/1.4),h:80+60*smooth((t-12)/1.4),a:.45*(1-smooth((t-12)/1.4))});
    }
  });

  // ───────── 字幕の段(ヒント)の共通部 ─────────
  // 方針(R2-TU 設計 DESIGN.md): 1回に1概念・1文(12字以内)・起きた直後に・主役の演出が出たら引っ込める。
  // 字幕は液晶の左下の「レーン」に出し、常設の札(もちだま・のこり・賞のチップ)と重ねない。穴を指す絵は液晶に出さない(穴は盤面のLED。fx.hint 参照)。
  // 検査用の記録 LCD.tut.log: vis=読める濃さで出ていた秒、hid=主役に譲っていた秒、ovl=主役と同時に0.05以上の濃さで描いた秒。
  const TUT=LCD.tut=LCD.tut||{log:[]};
  TUT.HINTS=['tut_launch','tut_goal','tut_first_lamp','tut_aim','tut_dup1','tut_challenge','tut_win','tut_lose','tut_lamp4','tut_roul','tut_end'];
  TUT.MAIN=/^(challenge_|success|jp|fail|lamp[456]|dup_protect|roulette|ascend|timeup|add100|finish|result|ticket|start|howto|title|attract|warn10|ladder)/;
  TUT.LANE={x:24,y:440,w:616,h:250};   // 字幕の置ける範囲(1280x720の液晶上)。常設の札は上段(y<330)なので重ならない
  const hint=(id,dur,paint,o={})=>LCD.scene({id,dur,hold:true,assets:[...B.assets,...E.assets],
    start(sc){sc.ht=0;sc.wall=0;sc.gf=1;sc.rec={id,at:+LCD.t.toFixed(2),dur,vis:0,hid:0,ovl:0};TUT.log.push(sc.rec);},
    update(sc,dt){
      const busy=LCD.active.some(x=>x!==sc&&TUT.MAIN.test(x.id));
      sc.gf=clamp(sc.gf+(busy?-1:1)*dt/.1,0,1);
      if(!busy)sc.ht+=dt;
      sc.wall+=dt;sc.busy=busy;
      if(sc.gf>.85)sc.rec.vis+=dt;if(busy)sc.rec.hid+=dt;if(busy&&sc.gf>.05)sc.rec.ovl+=dt;
      if(sc.ht>=dur||sc.wall>dur+5)LCD.stop(sc.uid);
    },
    draw(c,t,sc){const a=sc.gf*smooth(sc.ht/.18)*B.exit(sc.ht,dur,.3);if(a>.001)paint(c,sc.ht,sc,a);}});
  // 字幕: 画面下の帯(あそびかたと同じ形)。lines は1〜2行(1行目は小さめ、2行目が大きい。1行だけなら大きく)。幅が画面に収まるよう縮める。
  const cap=(c,a,lines,o={})=>{
    c.save();const g=c.createLinearGradient(0,540,0,720);g.addColorStop(0,'rgba(4,10,30,0)');g.addColorStop(.28,'rgba(4,10,30,.82)');g.addColorStop(1,'rgba(4,10,30,.94)');c.globalAlpha=a;c.fillStyle=g;c.fillRect(0,540,1280,180);c.restore();
    const n=lines.length;
    lines.forEach((ln,i)=>{
      const big=(i===n-1),sz0=big?64:48,cy=n===1?646:(i===0?604:668);
      c.save();c.font=`900 ${sz0}px ${LCD.font}`;const w=c.measureText(ln).width;c.restore();
      const sz=Math.min(sz0,sz0*1120/Math.max(1,w));
      goldText(c,ln,640,cy,{size:sz,a,stroke:Math.max(7,sz*.17),...(big?{fill1:'#fff9e0',fill2:'#ffd24a',strokeColor:'#6e3f18'}:{})});
    });
    if(o.extra)o.extra(c,a);
  };
  const rbtn=(c,t,a)=>B.point(c,1196,636,'right',t,{s:.8,a});     // 右のボタン(筐体の右下)を指す
  const lbtn=(c,t,a)=>B.point(c,128,636,'left',t,{s:.8,a});       // 左のボタン(筐体の左下)を指す

  hint('tut_goal',2.8,(c,t,sc,a)=>{const sec=Math.round(sc.params.sec||LCD.state.sec||100);cap(c,a,['たまを うって あなに いれて',`たまを ふやそう! (${sec}びょう)`]);});
  hint('tut_first_lamp',2.2,(c,t,sc,a)=>cap(c,a,['はいった あなが ひかる!','ちがう あなに いれよう']));
  hint('tut_aim',2.8,(c,t,sc,a)=>cap(c,a,['ひかっていない あなに','いれよう']));

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
      const first=false,a=smooth(t/.12)*B.exit(t,1.4,.25),up=easeOut(t/.24);
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
      LCD.add(c,'flare_ring.png',330,566,{w:100+300*smooth(t/.8),h:80+200*smooth(t/.8),a:.35*a*(1-smooth(t/.9)),tint:'#bfe6ff'});
    }
  });


  // おなじ あな(最初の保護)。直後に1回だけ。
  // (「おなじ あな! まだ セーフ」は dup_protect 自身が言う。ここでは次の一言: 4つからは危ない)
  hint('tut_dup1',2.8,(c,t,sc,a)=>cap(c,a,['おなじ あなは あぶない!','4つから ランプが きえる']));
  // 勝負の案内(ランプ2つ以上・落ち着いた時)。右ボタンを指す。ボタンのLEDは fx.hint('button')。
  hint('tut_challenge',3.6,(c,t,sc,a)=>{cap(c,a,['みぎボタンで しょうぶ!','ひかってない あなへ!']);rbtn(c,t,a*smooth(t/.2));});
  hint('tut_win',2.6,(c,t,sc,a)=>cap(c,a,['せいこう!','たまが ふえた']));
  hint('tut_lose',3.2,(c,t,sc,a)=>cap(c,a,['はずれ…','ランプが ぜんぶ きえた']));
  hint('tut_lamp4',2.8,(c,t,sc,a)=>cap(c,a,['4つ! しょうぶで +12玉','ランプが おおいほど ふえる']));
  hint('tut_roul',3.0,(c,t,sc,a)=>cap(c,a,['おなじ あなで ルーレット','ランプが きえた']));
  hint('tut_end',3.4,(c,t,sc,a)=>cap(c,a,['のこり すくない!','もちだま 0 か じかん 0 で おわり']));
})();
