/* グループB共通の画作り。通常画面/他グループのシーンには副作用を持たない。 */
(function () {
  'use strict';
  const { clamp, smooth, lerp, TAU } = LCD;
  const B = LCD.B = {};
  B.assets = ['bg_night_sakura.jpg','bg_gold.jpg','bg_sakura.jpg','branch_tl.png','branch_tr.png','corner_gold_tl.png','corner_gold_tr.png','crest_sakura.png','crest_glow.png','plate_A.png','plate_S.png','ribbon_1.png','ribbon_2.png','petal_stream_1.png','petal_stream_2.png','flip:impact_1','flip:shock_1','flip:pillar_1','flip:digitburst_1','flip:petals_1','flip:twinkle_1','flip:speed_1','flip:ember_1'];
  B.titles = (...keys) => keys.flatMap(k => ['face','glow','shadow'].map(q => `t_${k}_${q}.png`));
  B.digits = () => B.titles('dg_plus', ...Array.from({length:10}, (_, i) => 'dg'+i));
  B.exit = (t, dur, d=.35) => 1-smooth((t-(dur-d))/d);
  // blit/textはalphaを上書きするので、場面のフェードは一枚に合成して行う。
  const layers=[];let depth=0;
  B.layer = (c,a,draw) => {
    if(a<=0)return;
    if(a>=1){draw(c);return;}
    const cv=layers[depth]||(layers[depth]=document.createElement('canvas'));
    if(cv.width!==1280){cv.width=1280;cv.height=720;}
    const g=cv.getContext('2d');g.clearRect(0,0,1280,720);g.save();depth++;
    try{draw(g);}finally{depth--;g.restore();}
    c.save();c.globalAlpha=a;c.drawImage(cv,0,0);c.restore();
  };
  B.scene = def => {
    const draw=def.draw;
    return LCD.scene({...def,draw(c,t,sc){B.layer(c,B.exit(t,def.dur,def.fade??.25),g=>draw(g,t,sc));}});
  };
  B.background = (c,t,o={}) => {
    const a=o.a??1;
    LCD.blit(c,o.gold?'bg_gold.jpg':'bg_night_sakura.jpg',640,360,{w:1280,h:720,a});
    LCD.dim(c,o.gold?.55:.18,'#071025');
    LCD.add(c,'rays_soft.png',640,310,{s:2.6,rot:t*.035,a:(o.gold?.2:.12)*a,tint:o.gold?'#ffd685':'#8dbbff'});
    LCD.blit(c,'branch_tl.png',0,-10,{w:380,h:300,ax:0,ay:0,a:.8*a});
    LCD.blit(c,'branch_tr.png',1280,-10,{w:380,h:300,ax:1,ay:0,a:.8*a});
    LCD.blit(c,'corner_gold_tl.png',0,0,{w:165,h:165,ax:0,ay:0,a});
    LCD.blit(c,'corner_gold_tr.png',1280,0,{w:165,h:165,ax:1,ay:0,a});
    LCD.vignette(c,.42);
  };
  B.drift = (c,t,n=28,o={}) => {
    const rand=LCD.rng(681),a=o.a??1;
    for(let i=0;i<n;i++) {
      const x=(rand()*1420+t*(rand()*32-16)+1420)%1420-70;
      const y=(rand()*900+t*(o.rise?-38:24)*(rand()+.5)+900)%900-90;
      const s=.12+rand()*.35,ph=rand()*TAU;
      LCD.blit(c,o.petals?`petal_${1+i%4}.png`:'glint_1.png',x,y,{s:o.petals?s*1.2:s,a:a*(.3+.5*Math.sin(t*1.7+ph)**2),rot:o.petals?t*.3+ph:0,blend:o.petals?'normal':'add',tint:o.petals?undefined:'#ffe3a0'});
    }
  };
  // 炎の舌を三層で合成。固定seedの輪郭に時間だけを与え、明滅させずにうねらせる。
  let fireCanvas;
  B.fire = (target,t,power=1,a=1) => {
    fireCanvas ||= document.createElement('canvas');
    if(fireCanvas.width!==640){fireCanvas.width=640;fireCanvas.height=360;}
    const c=fireCanvas.getContext('2d');c.clearRect(0,0,640,360);
    const rand=LCD.rng(1931);
    c.save();c.scale(.5,.5);c.globalCompositeOperation='screen';
    for(let layer=0;layer<3;layer++)for(let i=0;i<22;i++){
      const phase=rand()*TAU,x=i*64-40+Math.sin(t*2.4+phase)*26;
      const w=(32+rand()*54)*(1-layer*.14),h=(100+rand()*250)*power*(.85+.15*Math.sin(t*5+phase));
      const bend=Math.sin(t*3.5+phase)*w*1.5,base=755;
      const g=c.createLinearGradient(x,base,x+bend,base-h);
      g.addColorStop(0,layer===2?'rgba(255,243,158,.64)':'rgba(247,71,7,.58)');
      g.addColorStop(.35,layer===2?'rgba(255,204,72,.48)':'rgba(255,122,12,.42)');
      g.addColorStop(.75,'rgba(255,130,17,.12)');g.addColorStop(1,'rgba(235,53,4,0)');
      c.globalAlpha=(1-layer*.15)*.75;c.fillStyle=g;c.beginPath();c.moveTo(x-w,base);
      c.bezierCurveTo(x-w*.2,base-h*.28,x-w*1.2,base-h*.5,x+bend,base-h);
      c.bezierCurveTo(x+bend-w*.7,base-h*.6,x+w*1.1,base-h*.22,x+w,base);c.closePath();c.fill();
    }
    c.restore();
    target.save();target.globalCompositeOperation='source-over';target.globalAlpha=a*.9;target.filter='blur(9px)';
    target.drawImage(fireCanvas,0,0,1280,720);target.filter='none';target.globalAlpha=a*.28;target.drawImage(fireCanvas,0,0,1280,720);target.restore();
  };
  B.burst = (sc,n=60,x=640,y=320,power=1) => {
    for(let i=0;i<n;i++) {
      const an=sc.rand()*TAU,v=(140+sc.rand()*740)*power;
      sc.S.P.emit({x,y,vx:Math.cos(an)*v,vy:Math.sin(an)*v*.7-90,ay:160,drag:1.2,life:.65+sc.rand()*1.05,s0:.15+sc.rand()*.35,s1:.02,img:i%4?'spark.png':'glint_1.png',tint:i%3?'#ffd477':'#fff2d8'});
    }
  };
  B.init = sc => {sc.S.P=LCD.particles(400,29);sc.S.marks=new Set();};
  B.at = (sc,t,fn) => {if(sc.t>=t&&!sc.S.marks.has(t)){sc.S.marks.add(t);fn();}};
  B.step = (sc,dt) => sc.S.P.step(dt);
  B.ribbon = (c,x,y,w=1000,h=110,a=1,gold=false) => {
    LCD.add(c,'glow_soft.png',x,y,{w:w*1.2,h:h*3,a:.22*a,tint:gold?'#ffb44d':'#698fff'});
    LCD.blit(c,gold?'plate_S.png':'plate_A.png',x,y,{w,h,a});
  };
  // 金枠を周回する光。板全体の点滅ではなく、尾を引く局所的な反射。
  B.frameLight = (c,t,x,y,w,h,a=1) => {
    const rw=w*.45,rh=h*.37,perimeter=4*(rw+rh);
    const point = distance => {
      let d=((distance%perimeter)+perimeter)%perimeter;
      if(d<rw*2)return [x-rw+d,y-rh,0];d-=rw*2;
      if(d<rh*2)return [x+rw,y-rh+d,Math.PI/2];d-=rh*2;
      if(d<rw*2)return [x+rw-d,y+rh,0];d-=rw*2;
      return [x-rw,y+rh-d,Math.PI/2];
    };
    for(let j=0;j<2;j++)for(let i=8;i>=0;i--){
      const [xx,yy,rot]=point(t*perimeter*.65+j*perimeter*.5-i*14);
      LCD.add(c,'flare_streak.png',xx,yy,{w:74-i*5,h:10,rot,a:a*(1-i/10)*.48,tint:'#ffdf88'});
      if(!i){LCD.add(c,'glint_2.png',xx,yy,{w:52,h:52,a:a*.8});LCD.add(c,'glow_soft.png',xx,yy,{w:90,h:90,a:a*.23,tint:'#ffca69'});}
    }
  };
  // 奥へ吸い込む/手前へ放つ光の筋。PNGの透明縁を使い矩形を出さない。
  B.stream = (c,t,x,y,o={}) => {
    const rand=LCD.rng(930),n=o.n??28,a=o.a??1;
    for(let i=0;i<n;i++){
      const an=rand()*TAU,phase=(t*(o.speed??.9)+rand())%1;
      const u=o.inward?1-phase:phase,r=70+u*u*850;
      LCD.add(c,'flare_streak.png',x+Math.cos(an)*r,y+Math.sin(an)*r*.65,{w:35+u*180,h:3+u*9,rot:an,a:a*Math.sin(phase*Math.PI)*(.25+rand()*.4),tint:i%3?'#ffd789':'#bcd8ff'});
    }
  };
  // 光沢の走査を文字のアルファ内だけに描く。白い帯の矩形は外に漏らさない。
  let shineCanvas;
  B.shine = (c,t,paint,o={}) => {
    shineCanvas ||= document.createElement('canvas');
    if(shineCanvas.width!==1280){shineCanvas.width=1280;shineCanvas.height=720;}
    const g=shineCanvas.getContext('2d');g.clearRect(0,0,1280,720);g.save();
    paint(g);g.globalCompositeOperation='source-in';
    const x=((t*(o.speed??.8))%1)*1900-300,gradient=g.createLinearGradient(x-100,0,x+100,0);
    gradient.addColorStop(0,'rgba(255,246,210,0)');gradient.addColorStop(.5,'rgba(255,250,225,.8)');gradient.addColorStop(1,'rgba(255,246,210,0)');
    g.fillStyle=gradient;g.fillRect(0,0,1280,720);g.restore();
    c.save();c.globalCompositeOperation='lighter';c.globalAlpha=o.a??.6;c.drawImage(shineCanvas,0,0);c.restore();
  };
  // 操作卓の光る押しボタンの挿絵。金属の段差と乳白の発光レンズ。
  // 発射の案内。射出器は筐体の3Dモデルが盤の上で左右に往復し、発射ボタンは液晶窓の外(左下)にある。
  // 液晶には射出器もボタンも描かない。窓の下端から左下のボタンを指す矢印と、一行だけ。
  B.launchGuide = (c,t,o={}) => {
    const a=o.a??1,s=o.s??1,y=o.y??560,beat=.5+.5*Math.sin(t*TAU*1.6);
    if(a<=0)return;
    LCD.arrow(c,150,658+Math.sin(t*6)*4,'down',t,{s:.62*s,a:a*(.65+.35*beat)});
    LCD.text(c,'うえの しゃしゅつきが うごくよ',640,y-46,{size:44*s,a,stroke:8,fill1:'#fff4d9',fill2:'#ffcf98',glow:'#b46355'});
    LCD.text(c,'ひかる ボタンを おして たまを うとう!',640,y+16,{size:50*s,weight:900,a,stroke:9,fill1:'#fff6d8',fill2:'#ffcf7a',strokeColor:'#6e3f18',glow:'#d98a3a'});
  };
  // 桜の紋を刻んだ金属の玉/メダル。奥行きの違う面をキャッシュして雨に使う。
  const coinFaces=new Map();
  B.coin = (c,x,y,r,spin=0,o={}) => {
    const face=Math.round((.18+.82*Math.abs(Math.cos(spin)))*10),key=face;
    if(!coinFaces.has(key)){
      const cv=document.createElement('canvas');cv.width=160;cv.height=160;const g=cv.getContext('2d');
      g.translate(80,77);g.scale(face/10,1);
      const rim=g.createLinearGradient(-58,-58,58,58);[[0,'#fff9cf'],[.18,'#ffe19a'],[.42,'#945713'],[.52,'#ffefa5'],[.8,'#bd791a'],[1,'#ffdd79']].forEach(([p,k])=>rim.addColorStop(p,k));
      g.fillStyle='#58330c';g.beginPath();g.arc(6,6,59,0,TAU);g.fill();
      g.fillStyle=rim;g.strokeStyle='#fff0a5';g.lineWidth=2;g.beginPath();g.arc(0,0,58,0,TAU);g.fill();g.stroke();
      g.strokeStyle='#76511a';g.lineWidth=3;g.beginPath();g.arc(0,0,49,0,TAU);g.stroke();
      g.strokeStyle='#ffe7a0';g.lineWidth=2;g.beginPath();g.arc(0,0,46,0,TAU);g.stroke();
      LCD.blit(g,'crest_sakura.png',0,0,{w:74,h:74,a:.92});
      g.strokeStyle='rgba(255,255,216,.7)';g.lineWidth=3;g.beginPath();g.arc(0,0,54,3.5,5.1);g.stroke();coinFaces.set(key,cv);
    }
    c.save();c.globalAlpha=o.a??1;c.translate(x,y);c.rotate(o.rot??spin*.22);c.drawImage(coinFaces.get(key),-r*1.36,-r*1.36,r*2.72,r*2.72);c.restore();
    if(o.glint)LCD.add(c,'glint_1.png',x-r*.3,y-r*.55,{w:r*.9,h:r*.9,a:(o.a??1)*o.glint});
  };
  B.coinRain = (c,t,n=90,o={}) => {
    const rand=LCD.rng(o.front?4507:139),a=o.a??1;
    for(let i=0;i<n;i++){
      const z=rand(),speed=110+z*230,phase=rand(),drift=(rand()-.5)*85;
      let x=rand()*1460-90+Math.sin(t*.9+i)*24+drift*t;
      x=((x+100)%1480+1480)%1480-100;
      const y=((phase*1060+t*speed)%1060)-160,r=(o.front?27:9)+z*(o.front?25:19),spin=t*(2+z*4)+i*1.7;
      // 手前の大玉は端を流し、タイトルと配当の可読性を守る。
      if(o.front&&x>180&&x<1100&&y>100&&y<465)continue;
      B.coin(c,x,y,r,spin,{a:a*(o.front?.9:.5+z*.35),rot:Math.sin(spin*.35)*.8,glint:Math.max(0,Math.sin(spin*1.7))*.6});
    }
  };
  B.coinHeap = (c,x,y,count,r=29,a=1,t=0) => {
    let k=0;
    for(let row=0;row<6&&k<count;row++){
      const cols=Math.min(8-row,count-k);
      for(let j=0;j<cols;j++,k++)B.coin(c,x+(j-(cols-1)/2)*r*1.65,y-row*r*1.32,r,.35+Math.sin(k*2.7)*.6,{a,rot:Math.sin(k*3.1)*.45,glint:.12+.25*Math.max(0,Math.sin(t*3+k))});
    }
  };
  B.bubble = (c,str,x,y,o={}) => {
    const w=o.w??760,h=o.h??96,a=o.a??1;
    c.save();c.globalAlpha=a;c.shadowColor='rgba(0,0,0,.45)';c.shadowBlur=18;
    const g=c.createLinearGradient(0,y-h/2,0,y+h/2);g.addColorStop(0,'rgba(24,40,75,.97)');g.addColorStop(1,'rgba(6,13,37,.97)');
    c.fillStyle=g;c.strokeStyle=o.warm?'#f6ce85':'#e7b4cf';c.lineWidth=3;
    c.beginPath();c.roundRect(x-w/2,y-h/2,w,h,26);c.fill();c.stroke();
    c.shadowBlur=0;c.beginPath();c.moveTo(x-w/2+40,y+h/2-2);c.lineTo(x-w/2+12,y+h/2+22);c.lineTo(x-w/2+80,y+h/2-2);c.fill();c.restore();
    LCD.text(c,str,x,y,{size:o.size??36,a,fill1:'#fffbee',fill2:o.warm?'#ffe0a0':'#ffd7ea',stroke:6});
  };
  B.point = (c,x,y,side,t,o={}) => {
    const a=o.a??1,s=o.s??.7;
    LCD.add(c,'glow_soft.png',x+(side==='left'?-30:30),y+35,{w:160*s,h:100*s,a:.25*a,tint:'#ffd16f'});
    LCD.arrow(c,x,y,'down',t,{s,a,color:o.color??'#ffe5a0'});   // 真下向き(ボタンの真上に置く)
  };
  // 穴番号は実機と同じ1始まり。既点灯と、これから狙う未点灯を分ける。
  B.holes = (c,x,y,t,params={},o={}) => {
    const step=o.step??74,r=o.r??22,a=o.a??1;
    const n=clamp(Math.round(params.n??LCD.state.n),0,7),lit=Array.isArray(params.lit)?new Set(params.lit):new Set(Array.from({length:n},(_,i)=>i+1));
    c.save();c.globalAlpha=a;
    for(let i=1;i<=7;i++) {
      const xx=x+(i-4)*step,on=lit.has(i),pulse=.45+.55*Math.sin(t*3.6)**2;
      if(o.emphasis){
        // 宣言時は「入れる先」を主役にする。既点灯は小さく鈍い色で退かせる。
        const beat=.5-.5*Math.cos(t*TAU*1.35),rr=on?r*.8:r*(1.08+.24*beat);
        if(!on) LCD.add(c,'glow_soft.png',xx,y,{w:rr*5.2,h:rr*5.2,a:a*(.48+.32*beat),tint:'#ffce54'});
        const g=c.createRadialGradient(xx,y,rr*.15,xx,y,rr);
        g.addColorStop(0,on?'#29303b':'#120c03');
        g.addColorStop(.6,on?'#262d37':'#372506');
        g.addColorStop(1,on?'#343d49':'#efb83a');
        c.fillStyle=g;c.strokeStyle=on?'#73747b':'#fff0a5';c.lineWidth=on?1.5:4.5;
        c.beginPath();c.arc(xx,y,rr,0,TAU);c.fill();c.stroke();
        if(!on){c.strokeStyle=`rgba(255,211,89,${.55+.4*beat})`;c.lineWidth=2;c.beginPath();c.arc(xx,y,rr+5,0,TAU);c.stroke();}
        continue;
      }
      if(!on&&o.target) LCD.add(c,'glow_soft.png',xx,y,{w:r*5,h:r*5,a:a*(.25+.25*pulse),tint:'#ffca58'});
      const g=c.createRadialGradient(xx-r*.2,y-r*.2,1,xx,y,r);g.addColorStop(0,on?'#f5d590':'#030811');g.addColorStop(1,on?'#836223':'#121e36');
      c.fillStyle=g;c.strokeStyle=!on&&o.target?`rgba(255,205,92,${.5+.5*pulse})`:on?'#f2d89a':'#506181';c.lineWidth=3;c.beginPath();c.arc(xx,y,r,0,TAU);c.fill();c.stroke();
      if(on) LCD.add(c,'glint_1.png',xx-r*.3,y-r*.3,{s:.14,a:.65*a});
    }
    c.restore();
  };
  B.pile = (c,x,y,count,r=22,o={}) => {
    let k=0;
    for(let row=0;row<6&&k<count;row++) {
      const cols=Math.min(8-row,count-k);
      for(let j=0;j<cols;j++,k++) LCD.ball(c,x+(j-(cols-1)/2)*r*1.85,y-row*r*1.62,r,{...o});
    }
  };
  // 玉は液晶の外(下の皿)へ出る。液晶には積まず、下向きの矢印と「おさら」で目を下へ送る。
  B.trayArrow = (c,t,x,y,o={}) => {
    const a=o.a??1,busy=o.busy!==false;
    c.save();
    LCD.add(c,'glow_soft.png',x,y+40,{w:220,h:260,a:.28*a*(busy?1:.5),tint:'#ffc65a'});
    for(let i=0;i<3;i++){
      const ph=((t*(busy?2.2:.7)-i*.28)%1+1)%1,al=Math.sin(ph*Math.PI)*a*(busy?1:.55),yy=y+i*38+ph*14;
      c.globalAlpha=al;c.lineWidth=14;c.lineCap='round';c.lineJoin='round';
      c.strokeStyle='#5a3410';c.beginPath();c.moveTo(x-34,yy-8+3);c.lineTo(x,yy+24+3);c.lineTo(x+34,yy-8+3);c.stroke();
      c.lineWidth=8;c.strokeStyle='#ffd978';c.beginPath();c.moveTo(x-34,yy-8);c.lineTo(x,yy+24);c.lineTo(x+34,yy-8);c.stroke();
    }
    c.restore();
    if(o.first) LCD.text(c,'したの おさらに でるよ',x-10,y+170,{size:28,a:a,fill1:'#fff3c8',fill2:'#ffc66a',stroke:6});
  };
  B.recover = (c,t,count,o={}) => {
    const n=Math.min(7,count),a=o.a??1;
    for(let i=0;i<n;i++) {
      const q=clamp((t-i*.065)/1.15),m=smooth(q),sx=640+(i-(n-1)/2)*105;
      const x=lerp(sx,1100,m),y=lerp(505,742,m)-Math.sin(m*Math.PI)*105;
      const change=smooth((q-.16)/.24);
      LCD.upa(c,x,y,{scale:o.scale??3,hue:LCD.HUES[i],mood:'happy',a:a*(1-change)});
      LCD.ball(c,x,y,22,{a:a*change*(1-smooth((q-.89)/.11))});
      if(q>0&&q<1) LCD.add(c,'glint_1.png',x-28,y-12,{s:.25,a:a*.55});
    }
  };
  // ───── 当たり演出の語彙(勝負宣言・成功系が使う) ─────
  // ヒットストップ: marks=[[開始秒,止める秒],...]。止めた分だけ戻した「絵の時間」を返す。
  B.hs = (t,marks) => {let o=0;for(const [s,d] of marks){if(t>=s+d)o+=d;else if(t>s)o+=t-s;}return t-o;};
  B.frozen = (t,marks) => marks.some(([s,d])=>t>s&&t<s+d);
  // 立体文字を、縦軸まわりに回しながら(ry)・傾けながら(rz)・拡縮して描く。いったん大きめの別キャンバスに本体を描いてから変形する。
  let spinCv,spinGlow;
  B.titleSpin = (c,key,fallback,x,y,o={}) => {
    spinCv ||= document.createElement('canvas');spinGlow ||= document.createElement('canvas');
    for(const k of [spinCv,spinGlow])if(k.width!==1920){k.width=1920;k.height=900;}
    const g=spinCv.getContext('2d'),gg=spinGlow.getContext('2d');g.clearRect(0,0,1920,900);
    // 影+本体は透明な面に、外光(加算用。黒が不透明)は黒い面に別々に描いて、変形したあと重ねる
    LCD.titleFit(g,key,fallback,960,450,{w:o.w??900,h:o.h??260,glowA:0});
    gg.fillStyle='#000';gg.fillRect(0,0,1920,900);
    const fn=LCD.img['t_'+key+'_face.png']?'t_':'rl_t_',im=LCD.img[fn+key+'_face.png'],gl=LCD.img[fn+key+'_glow.png'];
    if(im&&gl){
      const b=LCD.titleBounds(im),s=Math.min((o.w??900)/(b.r-b.l+1),(o.h??260)/(b.bottom-b.top+1));
      gg.save();gg.globalCompositeOperation='lighter';gg.globalAlpha=o.glowA??1;
      gg.translate(960+(im.width/2-(b.l+b.r)/2)*s,450+(im.height/2-(b.top+b.bottom)/2)*s);gg.drawImage(gl,-gl.width*s/2,-gl.height*s/2,gl.width*s,gl.height*s);gg.restore();
    }
    const z=o.zoom??1,cs=Math.cos(o.ry??0),sx=z*(Math.abs(cs)<.04?.04*Math.sign(cs||1):cs);
    for(const [src,mode] of [[spinGlow,'lighter'],[spinCv,'source-over']]){
      c.save();c.globalCompositeOperation=mode;c.globalAlpha=LCD.clamp(o.a??1);c.translate(x,y);c.rotate(o.rz??0);c.scale(sx,z);c.drawImage(src,-960,-450);c.restore();
    }
  };
  // 虹色の数字(t_dr*)。無ければ金(t_dg*)。LCD.number と同じ組版。
  B.numberR = (c,value,x,y,o={}) => {
    const str=String(value),pre=o.pre??'dr',keys=[...str].map(ch=>({'+':pre+'_plus'}[ch]||pre+ch));
    if(!keys.every(LCD.hasTitle))return LCD.number(c,value,x,y,o);
    const glyphs=keys.map(key=>{const im=LCD.img[(LCD.img['t_'+key+'_face.png']?'t_':'rl_t_')+key+'_face.png'];return {key,im,b:LCD.titleBounds(im)};});
    const ref=Math.max(...glyphs.map(g=>g.b.bottom-g.b.top+1)),gap=ref*.065,total=glyphs.reduce((n,g)=>n+g.b.r-g.b.l+1+gap,-gap);
    const s=Math.min((o.h??190)/ref,(o.w??900)/total)*(o.zoom??1);let dx=x-total*s/2;
    for(const g of glyphs){const w=g.b.r-g.b.l+1;LCD.title(c,g.key,dx+(g.im.width/2-g.b.l)*s,y+(g.im.height/2-(g.b.top+g.b.bottom)/2)*s,{...o,s});dx+=(w+gap)*s;}
  };
  B.digitsR = () => B.titles('dr_plus',...Array.from({length:10},(_,i)=>'dr'+i));
  // 画面全体を覆う虹(高彩度)。白で飛ばさないよう乗算寄りの screen で薄く重ねる。a は 0〜1。
  B.rainbow = (c,t,a,o={}) => {
    if(a<=0)return;
    const g=c.createLinearGradient(-200,0,1480,360*(o.tilt??.5)),sp=o.speed??120,n=8;
    for(let i=0;i<=n;i++)g.addColorStop(i/n,`hsl(${(((i/n)*300+t*sp)%360+360)%360},100%,${o.l??52}%)`);
    c.save();c.globalCompositeOperation=o.blend??'screen';c.globalAlpha=LCD.clamp(a);c.fillStyle=g;c.fillRect(-100,-100,1480,920);c.restore();
  };
  // 単色の全面点滅(赤・金)。強い点滅は光過敏のため呼び側が1秒3回以内に収める。
  B.blink = (c,color,a,blend='lighter') => {if(a<=0)return;c.save();c.globalCompositeOperation=blend;c.globalAlpha=LCD.clamp(a);c.fillStyle=color;c.fillRect(-100,-100,1480,920);c.restore();};
  // 金の紙吹雪(回りながら落ちる薄片)。時間だけで決まるので、いつ描いても同じ絵になる。
  B.confetti = (c,t,o={}) => {
    const rand=LCD.rng(o.seed??77),n=o.n??110,a=o.a??1,cols=o.colors??['#ffb000','#ffd24a','#ff9a00','#ffe28a','#ff6a2a'];
    c.save();
    for(let i=0;i<n;i++){
      const x0=rand()*1380-50,sp=130+rand()*260,ph=rand(),spin=2.5+rand()*5,sw=(rand()-.5)*70,s=.7+rand()*.9,col=cols[i%cols.length];
      const u=t-(o.t0??0)-ph*(o.spread??.6);if(u<0)continue;
      const y=-40+u*sp*(o.dir??1)+(o.dir<0?760:0),x=x0+Math.sin(u*2.1+i)*sw;
      if(y<-60||y>790)continue;
      const k=Math.cos(u*spin+i),w=13*s*Math.abs(k)+2,h=20*s;
      c.globalAlpha=a*(.75+.25*Math.abs(k));c.fillStyle=k>0?col:'#c46a00';c.save();c.translate(x,y);c.rotate(u*1.3+i);c.fillRect(-w/2,-h/2,w,h);c.restore();
    }
    c.restore();
  };
  // 放射状の集中線(画面の外から中心へ/中心から外へ)。色は '255,60,40' のような文字列。
  B.speed = (c,t,x,y,o={}) => {
    const n=o.n??46,a=o.a??1,rand=LCD.rng(o.seed??5),col=o.color??'255,255,255';
    c.save();c.globalCompositeOperation='lighter';c.translate(x,y);
    for(let i=0;i<n;i++){
      const an=(i+rand()*.8)/n*TAU+(o.rot??0)*t,r0=(o.r0??230)+rand()*160,len=140+rand()*420,ph=(t*(o.rate??2.4)+rand())%1,p=o.inward?1-ph:ph,rr=r0+p*(o.reach??560);
      const cx=Math.cos(an),cy=Math.sin(an),g=c.createLinearGradient(cx*rr,cy*rr,cx*(rr+len),cy*(rr+len));
      g.addColorStop(0,`rgba(${col},0)`);g.addColorStop(.5,`rgba(${col},${a*(.3+.5*rand())*Math.sin(ph*Math.PI)})`);g.addColorStop(1,`rgba(${col},0)`);
      c.strokeStyle=g;c.lineWidth=2+rand()*7;c.beginPath();c.moveTo(cx*rr,cy*rr);c.lineTo(cx*(rr+len),cy*(rr+len));c.stroke();
    }
    c.restore();
  };
})();
