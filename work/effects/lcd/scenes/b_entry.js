/* 入口の三場面: タイトル → ルール説明(howto) → チケットが玉に変わる(ticket)。
 * 「画面の中だけで説明する」場面ではなく、タイトルは世界観の入口、howtoは一言で仕組み、ticketは皿へ玉が出る瞬間をつなぐ。 */
(function () {
  'use strict';
  const { B, smooth, easeOut, easeOutBack, lerp, clamp, TAU }=LCD;
  const goldText=(c,s,x,y,o={})=>LCD.text(c,s,x,y,{fill1:'#fff6d6',fill2:'#ffcf7a',stroke:8,strokeColor:'#5a2e0a',glow:'#d98a3a',...o});

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
      if(t>1.1){const sg=smooth((t-1.1)/.5);goldText(c,'さくらの うみで 玉あそび',640,ly+152,{size:44,a:sg*.9,stroke:5,glow:'#ff9ac0'});}
      sc.S.P.draw(c);
      // 下の案内: 枠のない金の文字。光るボタンを指す。下から押し寄せるリングで「ここを押す」を強調
      const g=c.createLinearGradient(0,590,0,720);g.addColorStop(0,'rgba(4,8,22,0)');g.addColorStop(1,'rgba(4,8,22,.78)');c.fillStyle=g;c.fillRect(0,590,1280,130);
      const pa=smooth((t-1.5)/.5),beat=.5+.5*Math.sin(t*TAU*.8);
      for(let r=0;r<2;r++){const q=((t*.8+r*.5)%1);LCD.add(c,'flare_ring.png',160,664,{w:70+q*150,h:70+q*150,a:pa*(1-q)*.7,tint:'#ffd98a'});}
      goldText(c,'ひかっている ボタンを おしてね',700,664,{size:54,a:pa*(.75+.25*beat),stroke:7});
      B.point(c,160,664,'left',t,{s:.85,a:pa*(.6+.4*beat)});
    }
  });

  // ───────── 実物の絵の部品(あそびかた・チュートリアルで共用) ─────────
  // 筐体の実物にならう: 紺の盤・橙の釘・銀の玉・U字の入賞口とその下のランプ・黒い縁の赤いルーレット。
  // 点と丸の模式図は使わない。LCD.E に置いて b_tutorial.js / start.js からも使う。
  const E=LCD.E={};
  E.assets=['rl_rim.png','rl_dome.png','rl_hub.png','rl_face_1.png','rl_face_2.png','rl_face_3.png','rl_face_4.png','rl_needle.png','rl_needle_glow.png','rl_lamp_on.png','rl_lamp_off.png'];
  E.boardPanel=(c,x,y,w,h,a=1)=>{
    c.save();c.globalAlpha=a;
    c.shadowColor='rgba(0,0,0,.55)';c.shadowBlur=26;c.shadowOffsetY=10;
    const g=c.createLinearGradient(0,y,0,y+h);g.addColorStop(0,'#10245a');g.addColorStop(.55,'#0a1840');g.addColorStop(1,'#060f2c');
    c.fillStyle=g;c.beginPath();c.roundRect(x,y,w,h,26);c.fill();c.shadowBlur=0;c.shadowOffsetY=0;
    c.strokeStyle='#d9dfef';c.lineWidth=7;c.stroke();
    c.strokeStyle='rgba(120,140,190,.7)';c.lineWidth=2;c.beginPath();c.roundRect(x+9,y+9,w-18,h-18,19);c.stroke();
    const s=c.createLinearGradient(x,y,x+w,y+h*.5);s.addColorStop(0,'rgba(255,255,255,.12)');s.addColorStop(.35,'rgba(255,255,255,0)');
    c.fillStyle=s;c.beginPath();c.roundRect(x+10,y+10,w-20,h*.5,18);c.fill();
    c.restore();
  };
  E.pin=(c,x,y,glow=0,r=6.5)=>{
    if(glow>0.01)LCD.add(c,'glow_soft.png',x,y,{w:46,h:46,a:.8*glow,tint:'#ffd070'});
    const g=c.createRadialGradient(x-r*.35,y-r*.4,.5,x,y,r);g.addColorStop(0,'#fff0c4');g.addColorStop(.45,'#f2a23c');g.addColorStop(1,'#8a4510');
    c.fillStyle=g;c.beginPath();c.arc(x,y,r,0,TAU);c.fill();
  };
  // 入賞口(U字の金属の受け皿)+その下のランプ。lit:0〜1 flash:0〜1(入った瞬間の光) warn:0〜1(赤い警告)
  E.pocket=(c,x,y,o={})=>{
    const s=o.s??1,lit=o.lit??0,flash=o.flash??0,warn=o.warn??0,a=o.a??1,ly=o.ly??(y+96*s),ls=o.ls??96*s;
    c.save();c.globalAlpha=a;c.translate(x,y);c.scale(s,s);
    const R=44;
    c.fillStyle='rgba(2,6,20,.92)';c.beginPath();c.moveTo(-R,-34);c.lineTo(-R,0);c.arc(0,0,R,Math.PI,0,true);c.lineTo(R,-34);c.closePath();c.fill();
    if(lit>0){const gf=c.createLinearGradient(0,-34,0,R);gf.addColorStop(0,warn>0?'#ff7a60':'#fff0b8');gf.addColorStop(1,warn>0?'#c02a2a':'#d99a30');c.globalAlpha=a*lit*.8;c.fillStyle=gf;c.beginPath();c.moveTo(-R,-34);c.lineTo(-R,0);c.arc(0,0,R,Math.PI,0,true);c.lineTo(R,-34);c.closePath();c.fill();c.globalAlpha=a;}
    if(lit>0||flash>0||warn>0){
      const gl=c.createRadialGradient(0,8,2,0,8,R*1.2),k=Math.max(lit*.95,flash);
      gl.addColorStop(0,warn>0?`rgba(255,70,60,${.9*Math.max(warn,k)})`:`rgba(255,238,175,${.98*k})`);gl.addColorStop(1,'rgba(255,200,100,0)');
      c.fillStyle=gl;c.beginPath();c.arc(0,8,R*1.2,0,TAU);c.fill();
    }
    const m=c.createLinearGradient(-R,-34,R,44);m.addColorStop(0,'#f4f8ff');m.addColorStop(.35,'#7d8aa6');m.addColorStop(.6,'#e8eefc');m.addColorStop(1,'#6b7893');
    c.strokeStyle=m;c.lineWidth=8;c.lineCap='round';c.beginPath();c.moveTo(-R,-34);c.lineTo(-R,0);c.arc(0,0,R,Math.PI,0,true);c.lineTo(R,-34);c.stroke();
    c.fillStyle=m;c.beginPath();c.roundRect(-R-10,-46,2*R+20,12,5);c.fill();   // 上の口の板
    c.restore();
    // ランプ(消:黒いガラス/点:赤〜白熱)
    LCD.blit(c,'rl_lamp_off.png',x,ly,{w:ls,h:ls,a});
    if(lit>0){
      LCD.add(c,'glow_soft.png',x,ly,{w:ls*2.2,h:ls*2.2,a:.55*lit*a,tint:warn>0?'#ff4a3c':'#ffb0c8'});
      LCD.add(c,'rl_lamp_on.png',x,ly,{w:ls,h:ls,a:a*lit});
      LCD.add(c,'rl_lamp_on.png',x,ly,{w:ls*.8,h:ls*.8,a:a*lit*.6});
    }
    if(flash>0){LCD.add(c,'flare_ring.png',x,y,{w:100+(1-flash)*240,h:70+(1-flash)*130,a:.9*flash*a});}
  };
  // 実物のルーレット(rl_* 素材)。rot=盤の回転 needle=針の角度 dim=暗さ
  E.wheel=(c,x,y,r,o={})=>{
    const rot=o.rot??0,na=o.needle??0,a=o.a??1,dim=o.dim??1,D=2*r/.8,fs=2*r/.99;
    if(a<=0||r<2)return;
    c.save();c.globalAlpha=a;
    LCD.radial(c,x,y,r*1.9,'255,50,60',.55*dim*a);
    c.restore();
    c.save();c.translate(x,y);
    for(let i=0;i<4;i++){
      c.save();c.beginPath();c.moveTo(0,0);c.arc(0,0,r*1.002,rot+i*Math.PI/2-Math.PI*.75,rot+(i+1)*Math.PI/2-Math.PI*.75);c.closePath();c.clip();
      LCD.blit(c,`rl_face_${i+1}.png`,0,0,{w:fs,h:fs,a:a*dim});c.restore();
    }
    c.strokeStyle=`rgba(160,170,190,${.8*a*dim})`;c.lineWidth=Math.max(1.5,r*.025);
    for(let i=0;i<4;i++){const an=rot+i*Math.PI/2-Math.PI*.75;c.beginPath();c.moveTo(0,0);c.lineTo(Math.cos(an)*r,Math.sin(an)*r);c.stroke();}
    c.restore();
    LCD.blit(c,'rl_rim.png',x,y,{w:D,h:D,a:a*(.55+.45*dim)});
    LCD.blit(c,'rl_needle.png',x,y,{w:D/2,h:D,rot:na,a});
    LCD.add(c,'rl_needle_glow.png',x,y,{w:D/2,h:D,rot:na,a:a*dim});
    LCD.blit(c,'rl_hub.png',x,y,{w:r*.36,h:r*.36,a});
    LCD.add(c,'rl_dome.png',x,y,{w:D,h:D,a:.5*a});
  };
  // 左のボタン(発射)を指す案内。筐体の左下。start と tut_launch で共通。
  E.launchGuide=(c,t,o={})=>{
    const a=o.a??1,s=o.s??1,y=o.y??628,beat=.5+.5*Math.sin(t*TAU*1.6);
    if(a<=0)return;
    c.save();c.globalAlpha=a*.8;const g=c.createLinearGradient(0,y-96,0,720);g.addColorStop(0,'rgba(4,10,30,0)');g.addColorStop(.32,'rgba(4,10,30,.86)');g.addColorStop(1,'rgba(4,10,30,.94)');c.fillStyle=g;c.fillRect(0,y-96,1280,820-y);c.restore();
    for(let r=0;r<2;r++){const q=((t*.9+r*.5)%1);LCD.add(c,'flare_ring.png',34,706,{w:90+q*190,h:90+q*190,a:a*(1-q)*.8,tint:'#ff9ac0'});}
    LCD.arrow(c,128,y-6+Math.sin(t*6)*4,'down',t,{s:.95*s,a:a*(.7+.3*beat)});
    LCD.text(c,'ひかる 左の ボタンを おして',706,y-24,{size:56*s,a,stroke:9,fill1:'#fff4d9',fill2:'#ffcf98',glow:'#b46355'});
    LCD.text(c,'玉を うとう!',706,y+48,{size:76*s,a,stroke:12,fill1:'#fff9e0',fill2:'#ffd24a',strokeColor:'#6e3f18',glow:'#d98a3a'});
  };

  // ───────── あそびかた(開始前の基本説明) ─────────
  // 2コマ(計約11秒。2コマ目まで読ませる。時計は止まる)。実物の盤・入賞口・ランプ・ルーレットの絵で見せる。
  //  1 左のボタンで玉を打つ→穴に入るとランプがつく  2 ちがう穴に入るほどランプが増える(7つでJP)。同じ穴のルーレットは遊技中の最初の保護で例を見せる(tut_dup)
  // 「しょうぶ」は、はじめて4灯になった時(tut_lamp4)・はじめて勝負の合図が出る時(tut_challenge)に出す。
  const HOW_END=25.0,FDUR=.8;   // 4コマ。実際の長さはゲームが渡す seconds(events.json の dur)を等分
  const PX=i=>640+(i-4)*130,PY=410,PLY=500;
  const PIN_ROWS=Array.from({length:5},(_,r)=>{const o=[];for(let x=232+(r%2?32:0);x<1060;x+=64)o.push([x,172+r*44]);return o;});
  const WP_Y=[108,172,216,260,304,348,414];
  // 玉の経路: 釘の間を左右に跳ねながら tx へ。u=0..1
  const ballPos=(sx,tx,u)=>{
    const m=WP_Y.length-1,k=Math.min(m-1,Math.floor(u*m)),v=u*m-k,wx=j=>j===m?tx:lerp(sx,tx,j/m)+(j%2?1:-1)*30*(1-j/m);
    return {x:lerp(wx(k),wx(k+1),v),y:lerp(WP_Y[k],WP_Y[k+1],v)-Math.sin(v*Math.PI)*13,k,v};
  };
  const caption=(c,l1,l2,a,o={})=>{
    c.save();const g=c.createLinearGradient(0,566,0,720);g.addColorStop(0,'rgba(4,10,30,0)');g.addColorStop(.25,'rgba(4,10,30,.8)');g.addColorStop(1,'rgba(4,10,30,.92)');c.fillStyle=g;c.fillRect(0,566,1280,154);c.restore();
    goldText(c,l1,640,606,{size:52,a,stroke:9});
    goldText(c,l2,640,664,{size:o.s2??62,weight:900,a:a*(o.a2??1),stroke:11,fill1:o.f1??'#fff9e0',fill2:o.f2??'#ffd24a',strokeColor:o.sc??'#6e3f18',glow:o.glow});
  };
  // 4コマ(各約6秒、計約24秒。ボタンで次へ・時計は止まる)。文字でなく絵で3つの約束を見せる:
  //  1 玉を入れるとランプ(多いほど勝負で大きい)  2 勝負=ランプのない穴で成功  3 ランプのある穴だと全部消える  4 おなじ穴は(4つから)ルーレットでランプが消える
  const NP=5,AWARD=[0,1,2,3,12,30];
  const hits=(c,x,y,txt,a,col)=>{if(a<=0)return;goldText(c,txt,x,y,{size:112,a,stroke:14,fill1:col?'#ffffff':'#fff9e0',fill2:col??'#ffd24a',strokeColor:col?'#5a0a0a':'#6e3f18',weight:900});};
  LCD.scene({id:'howto',dur:HOW_END,cover:true,assets:[...B.assets,...B.titles('jackpot'),...E.assets],
    start(sc,p){B.init(sc);sc.H=sc.params.seconds>0?sc.params.seconds:HOW_END;if(p&&p.panel!=null)sc.fixPanel=p.panel;},
    update(sc,dt){B.step(sc,dt);
      const hc=(typeof window!=='undefined'&&window.__play&&window.__play.app&&window.__play.app.ctrl)||null;
      if(hc&&hc.howto)sc.hT=hc.howto.t;else sc.hT=sc.t;   // ボタンで次のコマへ進める(コントローラの時刻に合わせる)。無ければ場面の時刻
      if(sc.fixPanel!=null)sc.hT=sc.fixPanel*sc.H/NP+(sc.t%(sc.H/NP));
    },
    draw(c,t,sc) {
      if (LCD.rules().r3Enabled) {
        // R3用の簡単な説明（仮）。旧「勝負」ボタンの説明を出さない。
        B.background(c,t);
        const k=Math.min(2,Math.floor((sc.hT??t)/Math.max(.01,sc.H)*3));
        const lines=[['左のボタンで 玉をうつ','穴に入ると ランプがつく'],['ランプを６つ集めよう','６つで JPチャンス！'],['光っていない穴へ！','入れば 大当り！']][k];
        LCD.text(c,'あそびかた',640,180,{size:78,stroke:8,fill1:'#ffffff',fill2:'#ffdc91'});
        lines.forEach((line,i)=>LCD.text(c,line,640,340+i*120,{size:58,stroke:6,fill1:'#ffffff',fill2:'#b8eeff'}));
        return;
      }
      const H=sc.H,per=H/NP,T=sc.hT??t;
      B.layer(c,B.exit(t,H,.3),g=>{
        const open=smooth(t/.25),st=Math.min(NP-1,Math.floor(T/per)),lt=T-st*per;
        B.background(g,t);B.drift(g,t,24,{a:.5});B.drift(g,t,26,{petals:true,a:.7});
        goldText(g,'あそびかた',40,46,{size:56,a:open,stroke:9,align:'left'});
        for(let i=0;i<NP;i++){const on=i===st,x=470+i*80,y=46;g.save();g.globalAlpha=open;g.fillStyle=on?'#ffd978':'rgba(255,255,255,.22)';g.strokeStyle=on?'#6e3f18':'rgba(255,255,255,.45)';g.lineWidth=5;g.beginPath();g.arc(x,y,on?34:26,0,TAU);g.fill();g.stroke();g.restore();LCD.text(g,String(i+1),x,y+2,{size:on?44:32,a:open,fill1:on?'#4a2a10':'#dfe6f8',fill2:on?'#4a2a10':'#dfe6f8',stroke:0,strokeColor:'rgba(0,0,0,0)'});}
        const lev=Array(8).fill(0),flash=Array(8).fill(0),warn=Array(8).fill(0);let ball=null;
        const arrive=(tt,i)=>{lev[i]=Math.max(lev[i],smooth((lt-tt)/.14));const q=(lt-tt)/.5;if(q>0&&q<1)flash[i]=Math.max(flash[i],1-q);};
        const drop=(t0,i,sx,miss)=>{const u=(lt-t0)/FDUR;if(u>=0&&u<1){const b=ballPos(sx,PX(i),u);ball=ball||[];ball.push(b);}};
        const off=(tt,i)=>{if(lt>tt)lev[i]=Math.max(0,lev[i]*(1-smooth((lt-tt)/.2)));};
        let shobu=false,status=false,l1='',l2='',big=null,bigCol=null,readout=null,bt=null,extra=null,btn=0;
        let jp=0;
        if(st===0){
          // 左のボタンを押すたびに玉が1つ。4番の穴へ(ランプがつく)。狙いは自動でゆれる
          btn=Math.max(smooth(1-Math.abs(lt-1.3)/.25),0);
          drop(1.5,4,PX(4)+36);arrive(1.5+FDUR,4);
          if(lev[4]>.5){l1='入ると';l2='ランプが つく!';} else {l1='たまを うって';l2='あなに いれよう';}
        } else if(st===1){
          const seq=[2,6,3,5,1,7],step=Math.min(.26,(per-FDUR-2.2)/6);let n=1;lev[4]=1;
          seq.forEach((i,k)=>{const t0=.4+k*step;drop(t0,i,PX(i)+((k*53)%5-2)*26);arrive(t0+FDUR,i);if(lt>.4+k*step+FDUR)n++;});
          jp=smooth((lt-(.4+6*step+FDUR+.2))/.3);
          l1='ちがう あなに はいるほど';l2=n>=7?'7つで JP!':'ランプが ふえるよ';readout=-n;
        } else if(st===2){
          // 勝負(右ボタン)→ランプのない穴に入れば成功。成功でもランプは全部きえる
          [1,3,6].forEach(i=>lev[i]=1);shobu=true;
          btn=Math.max(smooth(1-Math.abs(lt-.8)/.3),0);bt='right';
          drop(2.0,5,PX(5)+30);arrive(2.0+FDUR,5);
          if(lt>2.0+FDUR){[1,3,6].forEach(i=>off(2.0+FDUR+.5,i));}
          if(lt<1.9){l1='みぎボタンで しょうぶ!';l2='金色の あなを ねらう';}
          else {l1='金色の あなに はいれば たまが ふえる';l2='ランプが おおいほど たくさん!';}
          if(lt>2.0+FDUR){const q=smooth((lt-2.0-FDUR)/.25);big='たまが ふえる!';extra=q;}
        } else if(st===3){
          [1,3,6].forEach(i=>lev[i]=1);shobu=true;
          btn=Math.max(smooth(1-Math.abs(lt-.8)/.3),0);bt='right';
          drop(2.0,3,PX(3)-24);
          if(lt>2.0+FDUR){const q=smooth((lt-2.0-FDUR)/.25);[1,3,6].forEach(i=>{warn[i]=q;off(2.0+FDUR+.6,i);});flash[3]=Math.max(flash[3],q*.6);big='はずれ…';bigCol='#ff6a5a';extra=q;}
          l1='赤い あなは はずれ!';l2='ランプが ぜんぶ きえる';
        } else if(st===4){
          // おなじ穴にもう一度入るとルーレットで ランプが きえる ことがある(条件の数は文字にしない)
          [1,2,4,6,7].forEach(i=>lev[i]=1);
          drop(1.2,2,PX(2)+24);
          const R0=1.2+FDUR;
          if(lt>R0)for(let i=1;i<=7;i++)if(lev[i]>0)warn[i]=smooth((lt-R0)/.3);
          if(lt>R0+3.2)off(R0+3.2,2);
          if(lt<R0){l1='ひかっている あなに';l2='もういちど はいると…';}   // 具体的な数(何灯から等)は言わない: 監督 10/18
          else{l1='おなじ あなに はいると ルーレット!';l2='ランプが きえる ことが ある';}
          if(lt>R0+.3)extra=smooth((lt-R0-.3)/.3);
        }
        if(!status)E.boardPanel(g,150,96,980,464,open);
        if(!status)PIN_ROWS.forEach(row=>row.forEach(([px,py])=>{let gl=0;if(ball)for(const b of ball){const d=Math.hypot(b.x-px,b.y-py);if(d<46)gl=Math.max(gl,1-d/46);}E.pin(g,px,py,gl);}));
        if(!status)for(let i=1;i<=7;i++){
          const red=shobu&&(i===1||i===3||i===6);   // 勝負中: ランプのある穴は赤、ない穴は金色(本番の盤面LEDと同じ)
          E.pocket(g,PX(i),PY,{lit:lev[i],flash:flash[i],warn:red?Math.max(warn[i],lev[i]>.02?1:0):warn[i],ly:PLY,a:open});
          if(shobu&&!red){const pu=.5+.5*Math.sin(t*5),k=(st===2&&i===5&&lt>2.0+FDUR)?0:1;LCD.add(g,'glow_soft.png',PX(i),PY+4,{w:210,h:210,a:open*k*(.6+.3*pu),tint:'#ffce54'});g.save();g.globalAlpha=open*k;g.strokeStyle='#ffe27a';g.lineWidth=5;g.beginPath();g.arc(PX(i),PY+2,50,Math.PI,0);g.stroke();g.restore();}
        }
        if(ball)for(const b of ball){for(let k=1;k<5;k++)LCD.add(g,'glow_soft.png',b.x,b.y-k*14,{w:34,h:34,a:.22*(1-k/5),tint:'#cfe0ff'});LCD.ball(g,b.x,b.y,17,{gold:false});}
        if(readout!=null&&readout<0)goldText(g,`ランプ ${-readout} / 7`,1120,46,{size:44,a:open,stroke:9,fill2:-readout>=7?'#ff9ad0':'#ffcf7a'});
        if(readout!=null&&readout>0)goldText(g,`ランプ ${readout}つ → しょうぶで +${AWARD[readout]}玉`,640,150,{size:50,a:open,stroke:9,fill2:readout>=4?'#ff9ad0':'#ffcf7a'});
        if(big&&extra!=null)hits(g,640,300,big,extra,bigCol);
        if(jp>0){LCD.titleFit(g,'jackpot','JACKPOT',640,268,{w:640,h:150,a:jp,zoom:lerp(1.5,1,easeOut(jp))});}
        if(st===4&&extra!=null){   // ルーレット: まわって、ランプが きえる ことが ある
          const R0=1.2+FDUR+.3,k=Math.min(1,Math.max(0,(lt-R0)/2.8)),rot=lt*9*(1-easeOut(k)*.97);
          LCD.add(g,'glow_soft.png',640,230,{w:300,h:300,a:.5*extra,tint:'#ff5a4a'});
          E.wheel(g,640,230,86,{a:extra,rot,needle:rot*.3});
          goldText(g,'ルーレット',640,128,{size:44,a:extra,stroke:8,fill2:'#ffb0a0'});
        }
        const sa=smooth(lt/.25)*(1-smooth((lt-(per-.2))/.2));
        caption(g,l1,l2,sa,{});
        // ボタン(筐体の下): 押す瞬間にまっすぐ下向きの矢印が光る。左=うつ、右=しょうぶ
        const bx=bt==='right'?1196:128;
        if(st===0||st===2||st===3)B.point(g,bx,632+btn*10,bt==='right'?'right':'left',t,{s:.8,a:sa});
        LCD.text(g,st<NP-1?'ひかる ボタンで つぎへ ▶':'ひかる ボタンで スタート ▶',1262,708,{size:24,align:'right',a:smooth((lt-.5)/.3)*(.75+.25*Math.sin(t*4)),fill1:'#f4f8ff',fill2:'#c8d4f2',stroke:6});
      });
    }
  });

  // ───────── チケット → 玉 ─────────
  // 尺: ticket 2.8秒(0〜0.7 チケット飛来、0.7〜 GET!と数字。皿の払い出しは約0.3〜2.3秒)。実際の流れ: ticket(0〜) → 玉が皿へ出る(約1.9秒) → start。液晶の順番は チケット→GET!(持ち玉の数が増える)→皿が満ちる→(startが引き継ぐ)。
  // 数字は皿に着いた玉の数(LCD.landed)に合わせる。startが始まったらticketは自分で退く(ticketの上でstartが終わって戻って見えるのを防ぐ)。
  const drawTicket=(c,x,y,rot,s,a,shineT)=>{
    c.save();c.globalAlpha=a;c.translate(x,y);c.rotate(rot);c.scale(s,s);
    c.shadowColor='rgba(0,0,0,.5)';c.shadowBlur=30;c.shadowOffsetY=14;
    const w=520,h=230;
    const g=c.createLinearGradient(-w/2,-h/2,w/2,h/2);g.addColorStop(0,'#fff6d8');g.addColorStop(.5,'#ffe9b0');g.addColorStop(1,'#f6cf86');
    c.fillStyle=g;c.beginPath();c.roundRect(-w/2,-h/2,w,h,22);c.fill();c.shadowBlur=0;c.shadowOffsetY=0;
    c.strokeStyle='#c68a2e';c.lineWidth=5;c.beginPath();c.roundRect(-w/2+10,-h/2+10,w-20,h-20,16);c.stroke();
    c.strokeStyle='rgba(198,138,46,.55)';c.lineWidth=2;c.beginPath();c.roundRect(-w/2+20,-h/2+20,w-40,h-40,10);c.stroke();
    c.setLineDash([8,8]);c.strokeStyle='#b8782a';c.lineWidth=3;c.beginPath();c.moveTo(130,-h/2+16);c.lineTo(130,h/2-16);c.stroke();c.setLineDash([]);
    c.fillStyle='#07102a';for(const yy of[-h/2,h/2]){c.beginPath();c.arc(130,yy,16,0,TAU);c.fill();}
    LCD.blit(c,'crest_sakura.png',-w/2+75,0,{w:120,h:120,a:.9});
    LCD.text(c,'パチコマ',85,-56,{size:44,fill1:'#6b3b1d',fill2:'#8a4f1f',stroke:0,strokeColor:'rgba(0,0,0,0)'});
    LCD.text(c,`${LCD.shownLoan??LCD.rules().loanBalls} BALLS`,85,10,{size:64,fill1:'#8a4a12',fill2:'#c2761c',stroke:0,strokeColor:'rgba(0,0,0,0)'});
    LCD.text(c,'あそびけん',85,66,{size:34,fill1:'#8a4f1f',fill2:'#8a4f1f',stroke:0,strokeColor:'rgba(0,0,0,0)'});
    if(shineT!=null){c.save();c.beginPath();c.roundRect(-w/2,-h/2,w,h,22);c.clip();c.globalCompositeOperation='lighter';
      const sx=lerp(-w,w,shineT),sg=c.createLinearGradient(sx-60,0,sx+60,0);sg.addColorStop(0,'rgba(255,255,255,0)');sg.addColorStop(.5,'rgba(255,255,255,.75)');sg.addColorStop(1,'rgba(255,255,255,0)');
      c.fillStyle=sg;c.fillRect(-w/2,-h/2,w,h);c.restore();}
    c.restore();
  };
  B.scene({id:'ticket',dur:9.5,fade:.08,cover:true,assets:[...B.assets,...B.digits(),...B.titles('get'),'flare_ring.png'],
    start(sc){B.init(sc);sc.S.count=0;sc.S.max=0;},
    update(sc,dt){
      B.step(sc,dt);
      if(LCD.active.some(s=>s.id==='start')){sc.t=99;return;}   // startが引き継いだら退く
      const tot=LCD.shownLoan=(Number.isFinite(sc.params.balls)?sc.params.balls:LCD.rules().loanBalls),count=Number.isFinite(sc.params.count)?clamp(Math.floor(sc.params.count),0,tot):LCD.landed(tot,Math.min(tot,Math.round(clamp((sc.t-.75)/1.5)*tot)));
      if(count>sc.S.count){const d=count-sc.S.count;sc.S.count=count;
        for(let i=0;i<4*d;i++) sc.S.P.emit({x:640+(sc.rand()-.5)*520,y:300+sc.rand()*80,vx:(sc.rand()-.5)*200,vy:-140-sc.rand()*160,ay:900,life:.9,s0:.3,s1:.1,a0:1,a1:0,img:'glint_1.png',tint:'#ffe3a0',blend:'add'});
        sc.S.pulse=sc.t;
      }
      B.at(sc,.68,()=>{LCD.flash(.55,'#fff0c4',7);LCD.shake(12,.35);LCD.punch(.035);B.burst(sc,90,640,330,1.1);});
      if(sc.S.count>=tot&&tot>0&&!sc.S.full){sc.S.full=1;LCD.flash(.28,'#fff0c4',9);LCD.shake(7,.25);B.burst(sc,60,640,350,.9);}
    },
    draw(c,t,sc){
      const a=B.exit(Math.min(t,2.7),2.8,.08),tot=LCD.shownLoan=(Number.isFinite(sc.params.balls)?sc.params.balls:LCD.rules().loanBalls),cnt=sc.S.count,pg=clamp(cnt/tot);
      // 金の盤面(全面)。上下の帯だけにしない
      LCD.blit(c,'bg_gold.jpg',640,360,{w:1280,h:720});
      LCD.add(c,'rays_soft.png',640,330,{s:2.8,rot:t*.06,a:.4,tint:'#ffe3a0'});
      LCD.rays(c,640,340,{n:21,a:.2+.12*pg,rot:t*.08,color:'255,226,150',len:1100});
      LCD.vignette(c,.38,'60,20,0');
      B.drift(c,t,26,{a:.7});
      if(t<.7){
        // 0〜0.6秒: チケットが飛んできて止まり、光る → 光になって弾ける
        const m=easeOut(clamp(t/.42)),x=lerp(180,640,m),y=lerp(560,340,m)-Math.sin(m*Math.PI)*50,rot=lerp(-.35,-.04,m),s=lerp(.55,1.12,m),fade=1-smooth((t-.52)/.16);
        LCD.add(c,'glow_soft.png',x,y,{w:720*s,h:420*s,a:.5*fade,tint:'#ffcf72'});
        drawTicket(c,x,y,rot,s,fade,clamp((t-.2)/.3));
        goldText(c,'チケットを うけとったよ',640,100,{size:58,a:smooth(t/.2)*fade,stroke:10});
        if(t>.52) LCD.add(c,'flare_streak.png',640,340,{w:1200,h:60,a:.95*(t-.52)/.16});
      } else {
        const q=clamp((t-.66)/.3);
        // どっと降る金の玉(奥は小さく、手前は大きく。数が増えるほど量が増す)
        const rain=.35+.65*Math.max(pg,smooth((t-.66)/.9));
        B.coinRain(c,t,Math.round(40+60*rain),{a:a*smooth(q)});
        B.coinRain(c,t,Math.round(10+16*rain),{front:true,a:a*smooth(q)});
        // GET! と持ち玉の数(皿に着いた数に合わせて増える)
        LCD.add(c,'glow_soft.png',640,345,{w:1000,h:400,a:.28*smooth(q),tint:'#ffcf72'});
        LCD.titleFit(c,'get','GET!',640,128,{w:560,h:150,a:smooth(q),zoom:lerp(1.6,1,easeOut(q))});
        B.shine(c,t,g=>LCD.titleFit(g,'get','GET!',640,128,{w:560,h:150,zoom:1,shadowA:0,glowA:0}),{a:.5,speed:.9});
        const pu=Math.exp(-(t-(sc.S.pulse??-9))*9),zoom=lerp(.7,1,easeOutBack(q))*(1+.12*pu);
        LCD.number(c,cnt,560,340,{h:250,w:600,a:smooth(q),zoom});
        goldText(c,'玉',930,372,{size:110,a:smooth(q),stroke:14});
        // 皿が満ちていく: 金の玉の山が下から増える。下(皿)へ送る矢印
        B.coinHeap(c,640,682,Math.round(cnt),34,smooth(q)*a,t);
        const ar=smooth((t-.9)/.2);
        LCD.add(c,'glow_soft.png',1130,560,{w:300,h:360,a:.35*ar,tint:'#ffc65a'});
        LCD.arrow(c,1130,610+Math.sin(t*8)*3,'down',t,{s:.95,a:a*ar});
        goldText(c,'下の おさらへ!',1050,528,{size:54,a:a*ar,stroke:10});
      }
      sc.S.P.draw(c);
    }
  });
})();
