(function () {
  'use strict';
  const {B,smooth,easeOutBack,lerp}=LCD;
  // 勝負用の7口。点灯済みは赤(重複)、未点灯は金(成功)。穴番号は1始まり。
  function mouths(params){
    const n=LCD.clamp(Math.round(params.n??LCD.state.n),0,7);
    return new Set(Array.isArray(params.lit)?params.lit:Array.from({length:n},(_,i)=>i+1));
  }
  function row(c,t,params,o={}){
    const lit=mouths(params),a=o.a??1,y=o.y??578,step=144;
    const beat=.5-.5*Math.cos(t*LCD.TAU*1.15);
    c.save();c.globalAlpha=a;
    for(let i=1;i<=7;i++){
      const x=640+(i-4)*step,on=lit.has(i),r=on?35:40+beat*8;
      const color=on?'#f45465':'#ffcf5c';
      if(o.links){
        c.strokeStyle=on?'rgba(246,65,86,.18)':'rgba(255,211,105,.28)';c.lineWidth=on?1.5:2.5;
        c.beginPath();c.moveTo(on?930:350,365);c.bezierCurveTo(on?930:350,430,x,435,x,y-r-12);c.stroke();
      }
      LCD.add(c,'glow_soft.png',x,y,{w:r*(on?3.4:4.7),h:r*(on?3.4:4.7),a:a*(on?.1+.05*beat:.38+.3*beat),tint:color});
      const g=c.createRadialGradient(x,y,3,x,y,r);g.addColorStop(0,'#05040a');g.addColorStop(.65,on?'#21060c':'#251806');g.addColorStop(.9,on?'#65212d':'#a06c1c');g.addColorStop(1,on?'#b44756':'#ffe5a0');
      c.fillStyle=g;c.strokeStyle=on?'#bd4859':'#ffefb9';c.lineWidth=on?3:5;c.beginPath();c.arc(x,y,r,0,LCD.TAU);c.fill();c.stroke();
      c.lineWidth=2;c.strokeStyle=on?'#542532':'#b5812e';c.beginPath();c.arc(x,y,r+7,0,LCD.TAU);c.stroke();
      if(!on)LCD.add(c,'glint_2.png',x-r*.6,y-r*.75,{w:28,h:28,a:a*.8});
      LCD.text(c,String(i),x,y+77,{size:25,a:a*.7,stroke:4,fill1:on?'#ce8a94':'#ffe6a7'});
    }
    c.restore();
  }
  // 専用PNGの無いJPチャンスは、金属の面・厚い縁・奥の影を持つ文字面として作る。
  // titleOrの代用文字を拡大するのではなく、完成した字面をキャッシュする。
  let jpFace;
  function jpTitle(c,x,y,w,a,zoom=1){
    if(!jpFace){
      jpFace=document.createElement('canvas');jpFace.width=1500;jpFace.height=350;
      const g=jpFace.getContext('2d');g.translate(750,170);g.transform(1,0,-.075,1,0,0);g.font=`900 220px ${LCD.font}`;g.textAlign='center';g.textBaseline='middle';g.lineJoin='round';
      const word='JPチャンス!';g.shadowColor='#14030b';g.shadowBlur=15;g.shadowOffsetY=14;
      for(let d=16;d>=0;d--){g.strokeStyle=d?'#5c260e':'#ffeca9';g.lineWidth=d?24:20;g.strokeText(word,d*.65,d);}
      g.shadowBlur=0;g.shadowOffsetY=0;g.lineWidth=11;g.strokeStyle='#9b5b13';g.strokeText(word,0,0);
      const grad=g.createLinearGradient(0,-90,0,90);[[0,'#fffbd4'],[.19,'#ffe6a0'],[.43,'#a56519'],[.48,'#fff3b7'],[.63,'#f8c44b'],[1,'#a45c10']].forEach(([p,k])=>grad.addColorStop(p,k));
      g.fillStyle=grad;g.fillText(word,0,0);
    }
    LCD.add(c,'glow_soft.png',x,y,{w:w*.95,h:300*zoom,a:a*.25,tint:'#ffc962'});
    c.save();c.globalAlpha=a;c.translate(x,y);c.scale(zoom,zoom);c.drawImage(jpFace,-w/2,-w*350/3000,w,w*350/1500);c.restore();
  }
  function atmosphere(c,t,jp,level=1){
    c.fillStyle=jp?'#130a13':'#10030c';c.fillRect(-128,-72,1536,864);
    LCD.blit(c,'bg_night_sakura.jpg',640,360,{w:1536,h:864,a:.24,tint:jp?'#a58461':'#943b53'});
    LCD.radial(c,640,260,630,jp?'188,110,23':'175,24,44',.22*level);
    LCD.vignette(c,.7,jp?'128,71,6':'135,10,31');
    LCD.add(c,'flare_streak.png',640,290,{w:1260,h:42,a:.22*level,tint:jp?'#ffde89':'#ff6c70'});
    LCD.blit(c,'crest_sakura.png',640,240,{w:600,h:600,a:.09*level,rot:t*.08,tint:jp?'#bd8a37':'#802c37'});
    LCD.flip(c,'ember_1',t,640,650,{s:2.4,a:.25*level,loop:true});
    B.stream(c,t,640,270,{n:28,a:.45*level,speed:1.3,inward:t<.2});
  }
  LCD.scene({id:'challenge_declare',dur:1.6,cover:true,assets:[...B.assets,...B.titles('shobu','jpchance')],
    start(sc){B.init(sc);LCD.flash(.32,sc.params.jp===true?'#ffe2a1':'#ffc5b6',8);LCD.shake(10,.25);B.burst(sc,52,640,250,.85);},
    update:B.step,
    draw(c,t,sc){
      const jp=sc.params.jp===true,a=B.exit(t,1.6,.12),settle=LCD.clamp(t/.22),shrink=smooth((t-1)/.4);
      atmosphere(c,t,jp);
      const zoom=jp?lerp(1.14-.14*easeOutBack(settle),.82,shrink):lerp(1.42-.42*easeOutBack(settle),.68,shrink),y=lerp(224,145,shrink);
      LCD.rays(c,640,240,{n:17,a:.075*a,rot:t*.1,color:jp?'255,210,116':'255,96,77'});
      if(jp)LCD.titleFit(c,'jpchance','JPチャンス!',640,y+10,{w:1000,h:210,zoom,a});
      else LCD.titleFit(c,'shobu','勝負!',640,y,{w:850,h:280,zoom,a});
      sc.S.P.draw(c);
      LCD.text(c,jp?'7つぜんぶ ともれば JP':'つぎの1球!',640,409,{size:jp?46:52,a,stroke:9,fill1:'#fff2cc',fill2:jp?'#ffd25f':'#ffbd98'});
      row(c,t,sc.params,{a,y:563});
      if(jp){const left=7-mouths(sc.params).size;LCD.text(c,`あと${left}つ!`,640,678,{size:38,a,stroke:7,fill1:'#ffe29a'});}
    }
  });
  LCD.scene({id:'challenge_flight',dur:0,hold:true,cover:true,assets:['bg_night_sakura.jpg'],
    draw(c,t,sc){
      // 通常画面は完全に覆う。結果を先取りせず、実際の7口の成功/重複を見せる。
      const beat=Math.exp(-Math.pow((t%1.12)/.14,2))+.45*Math.exp(-Math.pow(((t+.86)%1.12)/.12,2));
      c.fillStyle='#08040b';c.fillRect(-128,-72,1536,864);LCD.vignette(c,.52+beat*.18,'139,14,39');
      LCD.text(c,sc.params.jp===true?'JPチャンス':'しょうぶの1球',640,103,{size:33,fill1:'#deb298',stroke:6});
      LCD.text(c,'ここに入れば',350,249,{size:40,stroke:7,fill1:'#ffe6a5'});
      LCD.text(c,'成功!',350,317,{size:68,stroke:10,fill1:'#fff3bf',fill2:'#f6bc45',glow:'#a46e20'});
      LCD.text(c,'ここは',930,249,{size:40,stroke:7,fill1:'#ffc2c8'});
      LCD.text(c,'しっぱい',930,317,{size:60,stroke:9,fill1:'#ffb0bb',fill2:'#dd5269'});
      row(c,t,sc.params,{links:true,y:570});
      const p=sc.params;
      if(Number.isFinite(p.x)&&Number.isFinite(p.y)){
        const px=LCD.clamp(p.x>=0&&p.x<=1?p.x*1280:p.x,24,1256),py=LCD.clamp(p.y>=0&&p.y<=1?p.y*720:p.y,24,696);
        LCD.add(c,'glow_soft.png',px,py,{w:90,h:90,a:.65,tint:'#fff0b8'});
        LCD.radial(c,px,py,14,'255,239,195',.8);c.fillStyle='#fff7d1';c.beginPath();c.arc(px,py,4,0,LCD.TAU);c.fill();
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
