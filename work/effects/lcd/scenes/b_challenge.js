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
  // 盤にある情報(どの穴が当たりか・その位置)は液晶に出さない(10/18 監督: 液晶の位置は実際の穴とずれて気持ち悪い)。
  // 当たりの穴は、穴そのものの光(穴のLEDと、口の真上の照り返し。lightbus の pbeat)で見せる。液晶は盤に無い情報だけ: いくつ貰えるか、いまの気分。
  LCD.scene({id:'challenge_flight',dur:0,hold:true,cover:true,assets:['glow_soft.png','flare_streak.png'],
    draw(c,t,sc){
      const beat=Math.exp(-Math.pow((t%1.12)/.14,2))+.45*Math.exp(-Math.pow(((t+.86)%1.12)/.12,2)),slow=.5-.5*Math.cos(t*TAU*.9);
      const jp=sc.params.jp===true,n=clamp(Math.round(sc.params.n??LCD.state.n??0),0,7),AW=LCD.rules().awards||[0,1,2,3,12,30,80],JA=LCD.rules().jackpotAwards||[];
      const g=c.createLinearGradient(0,0,0,720);g.addColorStop(0,'#14020a');g.addColorStop(1,'#2a0410');c.fillStyle=g;c.fillRect(-128,-72,1536,864);
      LCD.vignette(c,.5+beat*.2,'160,10,40');
      LCD.add(c,'glow_soft.png',640,400,{w:1100+120*slow,h:560+60*slow,a:.3+.12*slow,tint:jp?'#ff9a00':'#ff2a3a'});
      LCD.text(c,jp?'JPチャンス!':'しょうぶの 1球',640,214,{size:64,stroke:10,fill1:jp?'#ffe08a':'#ffd0c0',fill2:jp?'#ffb000':'#ff8a78',strokeColor:'#2a0008'});
      // 成功したらいくつ貰えるか(数は規則から)。盤の写しではなく、盤に書いていない数
      const stake=jp&&JA.length?`${Math.min(...JA)}〜${Math.max(...JA)}`:String(AW[Math.min(n,6)]??0);
      const z=1+.035*slow;
      c.save();c.translate(640,420);c.scale(z,z);
      LCD.text(c,'せいこうで',0,-96,{size:42,stroke:8,a:.92,fill1:'#fff0e4',fill2:'#ffc8b0',strokeColor:'#2a0008'});
      LCD.text(c,`+${stake}玉`,0,0,{size:jp?150:190,stroke:16,fill1:'#fffbe0',fill2:jp?'#ffb000':'#ffc23a',strokeColor:'#4a1a00',glow:jp?'#ff9a1a':'#ff7a1a'});
      c.restore();
      LCD.text(c,'金色に ひかる あなを ねらえ!',640,610,{size:46,stroke:9,a:.9,fill1:'#fff0c0',fill2:'#ffc23a',strokeColor:'#3a1800'});
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
