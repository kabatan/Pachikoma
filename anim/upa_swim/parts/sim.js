(function(){
const W=2560,H=1440;
const LCDPARAMS=new URLSearchParams(location.search),EMBED=LCDPARAMS.get('embed')==='1';
if(EMBED)document.documentElement.classList.add('lcd-embed');
const cv=document.getElementById('stage');

const P={spd:1,calm:0.5,sz:16};
// ---- 原画を読む ----
const img=new Image();
let SW=0,SH=0,SPR=null,SPRV=[];
const HUES=[0,190,70,285,140,35,235]; // 色相のずらし量(度): ピンク,水色,黄,紫,緑,オレンジ,青
img.onload=()=>{
  SW=img.width;SH=img.height;
  const c=document.createElement('canvas');c.width=SW;c.height=SH;
  const g=c.getContext('2d');g.drawImage(img,0,0);
  SPR=g.getImageData(0,0,SW,SH).data;
  SPRV=HUES.map(h=>recolor(SPR,h));
  tryStart();
};
img.onerror=()=>{const e=new Error('ウパ原画を読み込めません');lcdReject(e);showError(e.message)};
let assetsReady=false,started=false;
function tryStart(){if(SPR&&assetsReady&&!started){started=true;start()}}
img.src=SRC;
function recolor(src,deg){
  const out=new Uint8ClampedArray(src);
  if(!deg)return out;
  for(let i=0;i<out.length;i+=4){
    if(out[i+3]===0)continue;
    let r=out[i]/255,g=out[i+1]/255,b=out[i+2]/255;
    const mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2,d=mx-mn;
    if(d<0.05||l<0.16)continue;           // 目・口の黒はそのまま
    let h=0;const s=d/(1-Math.abs(2*l-1));
    if(mx===r)h=((g-b)/d+6)%6;else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;
    h=((h*60+deg)%360)/60;
    const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs(h%2-1)),m=l-c/2;
    const k=Math.floor(h);const rgb=[[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]][k%6];
    out[i]=(rgb[0]+m)*255;out[i+1]=(rgb[1]+m)*255;out[i+2]=(rgb[2]+m)*255;
  }
  return out;
}
// 低解像度バッファ(原画1ドット=1画素)に描いて整数倍で拡大する
let LW,LH,buf,bctx,bdata;
function makeBuf(){
  LW=Math.ceil(W/P.sz);LH=Math.ceil(H/P.sz);
  buf=document.createElement('canvas');buf.width=LW;buf.height=LH;
  bctx=buf.getContext('2d');bctx.imageSmoothingEnabled=false;
  bdata=bctx.createImageData(LW,LH);
  if(window.onBufRemade)window.onBufRemade();
}
const rnd=(a,b)=>a+Math.random()*(b-a);
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smooth=u=>{u=clamp(u,0,1);return u*u*(3-2*u)};
function angDiff(a,b){let d=b-a;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;return d}
// ---- 1匹ぶんの動き ----
class Upa{
  constructor(v){
    this.v=v;this.zoom=1;this.show=null;this.x=rnd(0.1,0.9)*W;this.y=rnd(0.1,0.9)*H;
    this.ang=Math.random()*Math.PI*2;this.tang=this.ang;
    this.sp=0;this.base=rnd(0.8,1.2);       // 個体差
    this.phase=Math.random();               // 泳ぎ(ひとかき)の位相
    this.mode='swim';this.t=0;this.dur=rnd(1,3);
    this.dash=0;this.tilt=0;this.sy=0;this.sxv=0;this.wob=Math.random()*10;
    this.freq=rnd(0.85,1.15);
    this.pickDir(true);
  }
  pickDir(any){
    // 斜めも含めて全方向。壁際では内側へ向けやすくする
    let a=Math.random()*Math.PI*2;
    const mx=this.x/W,my=this.y/H;
    if(mx<0.12)a=rnd(-1.2,1.2);else if(mx>0.88)a=Math.PI+rnd(-1.2,1.2);
    if(my<0.08)a=rnd(0.4,Math.PI-0.4);else if(my>0.92)a=-rnd(0.4,Math.PI-0.4);
    this.tang=a;if(any)this.ang=a;
  }
  nextMode(){
    const c=P.calm;
    const wRest=0.10+0.45*c, wDash=0.18*(1-c)+0.02, wTurn=0.30;
    const r=Math.random()*(wRest+wDash+wTurn+0.5);
    if(r<wRest){this.mode='rest';this.dur=rnd(0.8,2.2)*(0.6+c)}
    else if(r<wRest+wDash){this.mode='dash';this.dur=rnd(0.5,0.9);this.pickDir(false);this.dash=1}
    else if(r<wRest+wDash+wTurn){this.mode='swim';this.dur=rnd(0.8,2)*(0.6+c);this.pickDir(false)}
    else{this.mode='swim';this.dur=rnd(1.2,3.5)*(0.6+c)}
    this.t=0;
  }
  update(dt,scale,spdScale){
    if(this.show){this.updateShow(dt);return}
    this.zoom+=(1-this.zoom)*Math.min(1,dt*1.6);
    this.t+=dt;if(this.t>=this.dur)this.nextMode();
    const c=P.calm;
    // ひとかきの周期: 速く泳ぐほど短い
    const strokeHz=(0.7+0.9*(1-c))*this.freq*(this.mode==='dash'?1.6:1);
    if(this.mode!=='rest')this.phase=(this.phase+dt*strokeHz)%1;
    const ph=this.phase;
    // かき: 蹴り出し(0-0.3) → 滑走(0.3-1)
    const kick=ph<0.3?Math.sin(Math.PI*ph/0.3):0;
    const glide=ph>=0.3?Math.exp(-(ph-0.3)*2.2):1;
    const cruise=(110+260*(1-c))*P.spd*this.base*spdScale; // px/s
    let target=0;
    if(this.mode==='swim')target=cruise*(0.12+1.2*Math.max(kick,glide*0.5));
    else if(this.mode==='dash')target=cruise*(2.4+0.8*kick);
    else target=cruise*0.04;
    this.sp+=(target-this.sp)*Math.min(1,dt*(this.mode==='dash'?8:4));
    // 向き転換はゆるやかに
    const turnRate=(this.mode==='dash'?9:2.2+2*(1-c));
    this.ang+=angDiff(this.ang,this.tang)*Math.min(1,dt*turnRate);
    const vx=Math.cos(this.ang)*this.sp,vy=Math.sin(this.ang)*this.sp;
    this.x+=vx*dt;this.y+=vy*dt;
    // 壁で反射(向きも目標も反転)
    const mx=Math.min(SW*scale*0.5,W*0.45),my=Math.min(SH*scale*0.5,H*0.45);
    if(this.x<mx){this.x=mx;this.reflect(true)}
    else if(this.x>W-mx){this.x=W-mx;this.reflect(true)}
    if(this.y<my){this.y=my;this.reflect(false)}
    else if(this.y>H-my){this.y=H-my;this.reflect(false)}
    // 見た目: ばね風のなめらかな追従
    const spn=clamp(this.sp/(cruise*1.6+1),0,1.4);
    const tk=(this.mode==='rest')?0:(kick-0.35*(1-kick)*0)*1;
    this.kk=(this.kk||0)+((this.mode==='rest'?0:kick)-(this.kk||0))*Math.min(1,dt*18);
    this.wob+=dt*(this.mode==='rest'?1.6:4.5);
    const idle=Math.sin(this.wob)*0.035*(this.mode==='rest'?1:0.4);
    const hx=Math.abs(Math.cos(this.ang)),hy=Math.abs(Math.sin(this.ang));
    // かくときは進行方向に縮んでから伸びる
    const s=0.26*this.kk*clamp(spn+0.3,0,1)-0.10*(1-this.kk)*spn+idle;
    this.sx=1+s*hx-0.7*s*hy;
    this.sy=1+s*hy-0.7*s*hx;
    // 傾き: 横に進むほど進行方向へ傾く、泳ぎに合わせて揺れる
    const tt=clamp(vx/(cruise*2.4+1),-1,1)*0.22+Math.sin(ph*Math.PI*2)*0.05*spn;
    this.tilt+=(tt-this.tilt)*Math.min(1,dt*8);
    this.amp=spn;this.wph=ph;
    this.sx*=this.zoom;this.sy*=this.zoom;
  }
  // ---- 点灯演出: 上から落下 → ぽよんぽよん → N灯 → 奥へ泳ぎ去る ----
  startShow(N){
    this.show={t:0,vy:0,yf:-40,bounces:0,rest:false,z:0,zv:0,n:N,t0:-1};
    this.mode='show';this.zoom=1.18;this.x=rnd(0.4,0.6)*W;this.sp=0;this.tilt=0;this.amp=0;this.wph=0;
  }
  updateShow(dt){
    const s=this.show;s.t+=dt;
    const G=5200,hh=SH*P.sz*this.zoom;
    const GY=H*0.64+hh*0.5;
    if(s.rest){s.vy=0;s.yf=GY}else{s.vy+=G*dt;s.yf+=s.vy*dt}
    if(!s.rest&&s.yf>=GY&&s.vy>0){
      const imp=s.vy;s.yf=GY;
      const first=s.bounces===0&&s.t0<0;
      if(first)s.t0=s.t;
      onImpact(this,imp,first);
      s.z=-0.30*Math.min(1,imp/3200);s.zv=0;
      if(imp*0.52>330&&s.bounces<3){s.vy=-imp*0.52;s.bounces++}
      else{s.vy=0;s.rest=true}
    }
    const air=!s.rest&&s.yf<GY-1;
    const tg=air?clamp(Math.abs(s.vy)*0.00006,0,0.15):0;
    for(let k=0;k<3;k++){s.zv+=(-190*(s.z-tg)-9*s.zv)*dt/3;s.z+=s.zv*dt/3}
    this.sy=this.zoom*(1+s.z);this.sx=this.zoom/Math.pow(1+s.z,0.9);
    this.y=s.yf-SH*P.sz*this.sy*0.5;
    this.tilt=0.05*Math.sin(s.t*9)*Math.exp(-s.t*1.1);
    // 「N灯」を見せ終わったら、奥(遠く)へ向かって泳ぎ出す
    if(s.t0>=0&&s.t-s.t0>FX.dur&&s.rest){
      this.show=null;this.mode='dash';this.t=0;this.dur=1.0;this.dash=1;
      this.tang=this.ang=Math.random()<0.5?rnd(-0.9,0.5)-0.2:Math.PI+rnd(-0.5,0.9)+0.2;this.sp=0;
    }
  }
  reflect(horiz){
    if(horiz){this.ang=Math.PI-this.ang;this.tang=Math.PI-this.tang}
    else{this.ang=-this.ang;this.tang=-this.tang}
    this.mode='swim';this.t=0;this.dur=rnd(1,2.5);
  }
  scare(fx,fy){
    if(this.show)return;
    const a=Math.atan2(this.y-fy,this.x-fx);
    this.tang=a;this.mode='dash';this.t=0;this.dur=rnd(0.5,0.8);
  }
  // 原画を逆変換で最近傍サンプルして低解像度バッファへ(ドットがにじまない)
  draw(scale){
    const cx=this.x/scale,cy=this.y/scale;
    const cs=Math.cos(this.tilt),sn=Math.sin(this.tilt);
    const rx=Math.ceil((SW*1.2+SH)*0.6),ry=Math.ceil((SH*1.2+SW*0.3)*0.7);
    const ox=Math.round(cx),oy=Math.round(cy);
    const sxi=1/this.sx,syi=1/this.sy;
    const wa=this.amp*1.1,wp=this.wph*Math.PI*2,wh=this.white||0,mn=this.mono||0,al=this.alp===undefined?1:this.alp;
    for(let dy=-ry;dy<=ry;dy++){
      const py=oy+dy;if(py<0||py>=LH)continue;
      // 行ごとにわずかに横へずらす(体をくねらせる)。整数ずらしなので格子は崩れない
      const sh=Math.round(Math.sin(wp+dy*0.22)*wa);
      for(let dx=-rx;dx<=rx;dx++){
        const px=ox+dx;if(px<0||px>=LW)continue;
        const ux=dx-sh+0.5,uy=dy+0.5;
        // 回転の逆変換 → 伸縮の逆変換
        const rxp=(ux*cs+uy*sn)*sxi,ryp=(-ux*sn+uy*cs)*syi;
        const sx=Math.floor(rxp+SW/2),sy=Math.floor(ryp+SH/2);
        if(sx<0||sy<0||sx>=SW||sy>=SH)continue;
        const si=(sy*SW+sx)*4;
        const S=SPRV[this.v];
        if(S[si+3]<128)continue;
        const di=(py*LW+px)*4;
        let cr=S[si],cg=S[si+1],cb=S[si+2];
        if(mn>0){const l=0.3*cr+0.59*cg+0.11*cb,t=l<60?l*0.9:150+l*0.4;cr+=(t-cr)*mn;cg+=(t-cg)*mn;cb+=(t+6-cb)*mn}   // 天使: 白黒(目と縁の暗い所は残す)
        if(wh>0){cr+=(255-cr)*wh;cg+=(255-cg)*wh;cb+=(255-cb)*wh}
        bdata.data[di]=cr;bdata.data[di+1]=cg;bdata.data[di+2]=cb;
        bdata.data[di+3]=255*al;
      }
    }
  }
}
let upas=[];
function setCount(n){
  while(upas.length<n){
    const u=new Upa(upas.length%HUES.length);
    // 出現位置は既存の子から離れた場所を何度か試す
    let best=null,bd=-1;
    for(let k=0;k<12;k++){
      u.x=rnd(0.1,0.9)*W;u.y=rnd(0.1,0.9)*H;
      const dm=upas.reduce((m,o)=>Math.min(m,Math.hypot(o.x-u.x,o.y-u.y)),1e9);
      if(dm>bd){bd=dm;best=[u.x,u.y]}
    }
    u.x=best[0];u.y=best[1];
    upas.push(u);
  }
  upas.length=n;
}
// 近づきすぎた子どうしを、進路をゆるく曲げつつ少しだけ押し離す(急に弾かない)
function separate(dt,scale){
  const a=SW*scale*0.42,b=SH*scale*0.5;
  for(let i=0;i<upas.length;i++)for(let j=i+1;j<upas.length;j++){
    const p=upas[i],q=upas[j];
    const dx=q.x-p.x,dy=q.y-p.y;
    const d=Math.hypot(dx/(2*a),dy/(2*b));
    if(d>=1.5||d===0)continue;
    const w=smooth((1.5-d)/0.7);               // 近いほど強い(0〜1)
    const away=Math.atan2(dy,dx);              // p→q
    // 進路: 相手から離れる向きへ少しずつ寄せる
    const mp=p.show?0:1,mq=q.show?0:1;
    if(!mp&&!mq)continue;
    if(mp){p.tang+=angDiff(p.tang,away+Math.PI)*Math.min(1,w*dt*2.2);p.ang+=angDiff(p.ang,p.tang)*Math.min(1,w*dt*1.2)}
    if(mq){q.tang+=angDiff(q.tang,away)*Math.min(1,w*dt*2.2);q.ang+=angDiff(q.ang,q.tang)*Math.min(1,w*dt*1.2)}
    // 重なりかけたら位置もやんわり押し戻す
    if(d<1){
      const push=(1-d)*Math.min(1,dt*3)*Math.min(a,b)*0.5;
      const ux=dx/(d*2*a||1),uy=dy/(d*2*b||1),ul=Math.hypot(ux,uy)||1;
      const f=(mp+mq)===2?1:2;p.x-=mp*f*ux/ul*push;p.y-=mp*f*uy/ul*push;q.x+=mq*f*ux/ul*push;q.y+=mq*f*uy/ul*push;
    }
  }
}

