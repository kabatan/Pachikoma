/* 勝負の宣言(実機の「当たり前兆」の語彙)・勝負の玉が飛んでいる間の案内・失敗のチュートリアル吹き出し。
 * 液晶の右上 x795〜1265,y10〜160 は残り時間の枠(LCD.hud)なので、文字は置かない。 */
(function () {
  'use strict';
  const {B,smooth,easeOut,easeOutBack,lerp,clamp,TAU}=LCD;
  // 勝負用の7口。点灯済みは赤(重複)、未点灯は金(成功)。穴番号は1始まり。
  function mouths(params){
    const n=clamp(Math.round(params.n??LCD.state.n),0,7);
    return new Set(Array.isArray(params.lit)?params.lit:Array.from({length:n},(_,i)=>i+1));
  }
  // 筐体の7つの穴の真上にあたる液晶のx座標(筐体全体の画像で合わせた値)。穴は液晶の下端のさらに下にある。
  const HOLE_X=i=>27+196.6*(i-1);

  // ───────── 勝負宣言 ─────────
  const HS=[[.32,.1]];                               // ヒットストップ(文字が当たった瞬間に0.1秒止める)
  function declareBg(c,T,jp,pulse){
    const g=c.createRadialGradient(640,340,30,640,340,980);
    if(jp){g.addColorStop(0,'#8a4a00');g.addColorStop(.45,'#3c1c00');g.addColorStop(1,'#0c0400');}
    else{g.addColorStop(0,'#d4001c');g.addColorStop(.42,'#68000f');g.addColorStop(1,'#14000a');}
    c.fillStyle=g;c.fillRect(-128,-72,1536,864);
    B.speed(c,T,640,340,{n:54,a:.9,color:jp?'255,176,0':'255,60,50',rate:1.9,r0:150,reach:760,rot:.02});
    LCD.rays(c,640,350,{n:19,len:1000,rot:T*.35,a:.16,color:jp?'255,176,0':'255,70,50'});
    B.blink(c,jp?'#ff9a00':'#ff1a2a',.34*pulse);
    LCD.vignette(c,.55,jp?'30,10,0':'40,0,6');
  }
  // カットインの帯(斜めの黒い帯+金の縁)。offは横へずらす量。
  function band(c,off,jp){
    const y0=196,y1=556,sk=80;
    c.save();c.translate(off,0);
    const g=c.createLinearGradient(0,y0,0,y1);g.addColorStop(0,'rgba(6,0,4,.97)');g.addColorStop(.5,'rgba(30,0,10,.95)');g.addColorStop(1,'rgba(6,0,4,.97)');
    c.fillStyle=g;c.beginPath();c.moveTo(-200+sk,y0);c.lineTo(1480+sk,y0);c.lineTo(1480-sk,y1);c.lineTo(-200-sk,y1);c.closePath();c.fill();
    c.strokeStyle=jp?'#ffb000':'#ff3040';c.lineWidth=10;c.shadowColor=jp?'#ffb000':'#ff2030';c.shadowBlur=24;
    c.beginPath();c.moveTo(-200+sk,y0);c.lineTo(1480+sk,y0);c.moveTo(1480-sk,y1);c.lineTo(-200-sk,y1);c.stroke();
    c.restore();
  }
  LCD.scene({id:'challenge_declare',dur:1.6,cover:true,assets:[...B.assets,...B.titles('shobu','jpchance'),'sprite_calm.png','flare_ring.png'],
    start(sc){B.init(sc);sc.S.jp=sc.params.jp===true;},
    update(sc,dt){
      if(!B.frozen(sc.t,HS))B.step(sc,dt);
      const jp=sc.S.jp;
      B.at(sc,.02,()=>{LCD.flash(.55,jp?'#ffb000':'#ff2a3a',9);LCD.shake(8,.2);});
      B.at(sc,.32,()=>{LCD.flash(.7,jp?'#ffc02a':'#ff4050',8);LCD.shake(jp?18:20,.42);LCD.punch(.05);B.burst(sc,70,850,376,1);});
    },
    draw(c,t,sc){
      const jp=sc.S.jp,T=B.hs(t,HS),a=B.exit(t,1.6,.14);
      B.layer(c,a,c=>{
        // 点滅は 2.5 回/秒 を超えない(強い点滅は1秒3回まで)
        const pulse=T>.3&&T<1.15?Math.max(0,Math.sin((T-.3)*TAU*2.5)):0;
        declareBg(c,T,jp,pulse);
        const out=smooth((T-.95)/.22);                       // 帯が右へ抜ける
        const inn=easeOut(T/.12);
        band(c,-(1-inn)*1500+out*1500,jp);
        // ウパが帯の下から飛び出す
        const u=clamp((T-.05)/.3),uy=lerp(960,428,easeOutBack(u))-Math.sin(clamp((T-.3)/.12)*Math.PI)*0,ux=265-out*800;
        const trem=T>.34&&T<1?Math.sin(T*70)*3:0;
        if(jp)LCD.upa(c,ux+trem,uy,{scale:11,hue:'rainbow',t:T,mood:'happy'});else LCD.upa(c,ux+trem,uy,{scale:11,hue:0,mood:'calm'});
        // 立体の文字がドンと入る
        const slam=clamp((T-.14)/.18),e=easeOut(slam),shift=smooth((T-.98)/.25);
        const zoom=lerp(3.2,1,e)*lerp(1,.66,shift),tx=lerp(850,640,shift),ty=lerp(376,268,shift);
        if(T>.14){
          const ta=clamp((T-.14)/.05);
          LCD.add(c,'glow_soft.png',tx,ty,{w:900*zoom,h:520*zoom,a:.5*ta,tint:jp?'#ff9a00':'#ff2030'});
          if(jp)B.titleSpin(c,'jpchance','JPチャンス!',tx,ty,{w:800,h:240,zoom,a:ta,rz:lerp(-.12,0,e)});
          else B.titleSpin(c,'shobu','勝負!',tx,ty,{w:780,h:340,zoom,a:ta,rz:lerp(-.12,0,e)});
        }
        if(T>=.32){
          const k=T-.32;
          LCD.add(c,'flare_ring.png',850,376,{w:200+k*2600,h:200+k*2600,a:.9*(1-clamp(k/.5)),tint:jp?'#ffb000':'#ff4050'});
          LCD.add(c,'flare_ring.png',850,376,{w:120+k*1700,h:120+k*1700,a:.6*(1-clamp(k/.4)),tint:jp?'#ffd060':'#ff8a70'});
        }
        sc.S.P.draw(c);
        // 結果は匂わせない: 「次の1球」とだけ
        const sa=smooth((T-1.12)/.15);
        if(sa>0){
          const left=7-mouths(sc.params).size;
          LCD.text(c,jp?(left===1?'あと 1つで JP!':`あと ${left}つで JP!`):'つぎの 1球!',640,jp?458:428,{size:jp?66:78,a:sa,stroke:12,fill1:'#fff6d8',fill2:jp?'#ffb000':'#ffb0a0',strokeColor:jp?'#5a2a00':'#4a0010',glow:jp?'#ff9a00':'#ff3040'});
        }
      });
    }
  });

  // ───────── 勝負の玉が飛んでいる間 ─────────
  // 穴の真上に「ここに入れば 成功!」(未点灯の穴)/「ここは しっぱい」(点灯済みの穴)を置き、矢印で液晶の下端(その先に穴)を指す。
  function column(c,t,i,on){
    const x=HOLE_X(i),ax=clamp(x,40,1240),lx=clamp(x,74,on?1170:1200),beat=.5-.5*Math.cos(t*TAU*1.4);
    if(!on){                                                    // 成功の穴: 金の柱+大きな矢印+「成功!」
      const w=140+beat*34;
      const g=c.createLinearGradient(0,330,0,720);g.addColorStop(0,'rgba(255,176,0,0)');g.addColorStop(1,`rgba(255,176,0,${.4+.3*beat})`);
      c.fillStyle=g;c.fillRect(ax-w/2,330,w,390);
      LCD.add(c,'glow_soft.png',ax,690,{w:300,h:200,a:.55+.3*beat,tint:'#ffb000'});
      const z=1+.07*beat;
      c.save();c.translate(lx,520);c.scale(z,z);LCD.text(c,'成功!',0,0,{size:60,stroke:12,fill1:'#fffbe0',fill2:'#ffb000',glow:'#ff9a00',strokeColor:'#4a2000'});c.restore();
      for(let k=0;k<2;k++)LCD.arrow(c,ax,626,'down',t+k*.4,{s:.82-k*.2,color:'#ffd24a',glow:'rgba(255,176,0,.95)',a:k?.5:1});
    }else{                                                      // 失敗の穴: 赤く控えめ
      const fl=.7+.3*Math.sin(t*23+i*2.1)*Math.sin(t*7.3+i);
      const g=c.createLinearGradient(0,520,0,720);g.addColorStop(0,'rgba(220,0,30,0)');g.addColorStop(1,`rgba(220,0,30,${.3*fl})`);
      c.fillStyle=g;c.fillRect(ax-46,520,92,200);
      LCD.text(c,'ここは',lx,510,{size:30,stroke:7,a:.9,fill1:'#ffb8c0',fill2:'#ff7a88',strokeColor:'#2a0008'});
      LCD.text(c,'しっぱい',lx,554,{size:36,stroke:8,a:.92*fl,fill1:'#ffc0c8',fill2:'#ff3a52',strokeColor:'#2a0008'});
      LCD.arrow(c,ax,640,'down',t+i,{s:.46,color:'#ff6a7c',glow:'rgba(255,30,60,.8)',a:.7*fl});
    }
  }
  // 成功の穴が続くひとかたまりごとに、「ここに入れば」を真上へ。
  function banners(c,t,lit){
    let i=1;
    while(i<=7){
      if(lit.has(i)){i++;continue;}
      let j=i;while(j<7&&!lit.has(j+1))j++;
      const x0=Math.max(0,HOLE_X(i)-98),x1=Math.min(1280,HOLE_X(j)+98),w=x1-x0,size=clamp(w/6.3,42,50);
      const beat=.5-.5*Math.cos(t*TAU*1.4);
      LCD.text(c,'ここに入れば',clamp((x0+x1)/2,size*3.2,1280-size*3.2),452,{size,stroke:9,fill1:'#fff0c0',fill2:'#ffc23a',strokeColor:'#3a1800',a:.9+.1*beat});
      i=j+1;
    }
  }
  LCD.scene({id:'challenge_flight',dur:0,hold:true,cover:true,assets:['glow_soft.png','flare_streak.png'],
    draw(c,t,sc){
      // 通常画面は完全に覆う。結果を先取りせず、実際の7口の点灯済み/未点灯だけを見せる。
      const beat=Math.exp(-Math.pow((t%1.12)/.14,2))+.45*Math.exp(-Math.pow(((t+.86)%1.12)/.12,2));
      const g=c.createLinearGradient(0,0,0,720);g.addColorStop(0,'#14020a');g.addColorStop(1,'#2a0410');c.fillStyle=g;c.fillRect(-128,-72,1536,864);
      LCD.vignette(c,.5+beat*.2,'160,10,40');
      const jp=sc.params.jp===true;
      LCD.text(c,jp?'JPチャンス!':'しょうぶの 1球',jp?330:340,92,{size:52,stroke:10,fill1:jp?'#ffe08a':'#ffd0c0',fill2:jp?'#ffb000':'#ff8a78',strokeColor:'#2a0008'});
      const JA=LCD.rules().jackpotAwards||[];
      LCD.text(c,jp&&JA.length?`JPで ${Math.min(...JA)}〜${Math.max(...JA)}玉!`:'たまを おいかけよう',340,152,{size:36,stroke:8,a:.9,fill1:jp?'#fff0b8':'#ffe6d0',strokeColor:'#2a0008'});
      const lit=mouths(sc.params);
      for(let i=1;i<=7;i++)column(c,t,i,lit.has(i));
      banners(c,t,lit);
      const p=sc.params;
      if(Number.isFinite(p.x)&&Number.isFinite(p.y)){
        const px=clamp(p.x>=0&&p.x<=1?p.x*1280:p.x,24,1256),py=clamp(p.y>=0&&p.y<=1?p.y*720:p.y,24,696);
        LCD.add(c,'glow_soft.png',px,py,{w:90,h:90,a:.65,tint:'#fff0b8'});
        LCD.radial(c,px,py,14,'255,239,195',.8);c.fillStyle='#fff7d1';c.beginPath();c.arc(px,py,4,0,TAU);c.fill();
      }
    }
  });
  LCD.scene({id:'tut_fail',dur:2,assets:[],
    draw(c,t){
      const a=smooth(t/.18)*B.exit(t,2,.25);
      const g=c.createLinearGradient(0,605,0,720);g.addColorStop(0,'rgba(5,9,26,0)');g.addColorStop(.55,`rgba(5,9,26,${.65*a})`);g.addColorStop(1,'rgba(5,9,26,0)');c.fillStyle=g;c.fillRect(0,605,1280,115);
      LCD.text(c,'ざんねん。また あつめよう',640,660,{size:42,a,stroke:8,fill1:'#fff1d5',fill2:'#ffc4d6'});
    }
  });
})();
