// 中図柄(リーチの図柄)を玉の軌道で動かす。見た目は焼き込み済みの center_atlas(同じ制作コード)だけを使う。
// ・チャンス前半(sf<96)は映像と同じ台本どおりに回す。・狙いの間は狙う穴の数字。・玉が線を通るたび、いちばん見込みの高い穴へ回って移る(粘りあり)。
// ・口に入る/入った穴で止まる: 当たり(d)は光って跳ね、外れは小さく落ち着く。
const wrap7=x=>{x=((x%7)+7)%7;return x>3.5?x-7:x;};
export function createCenterReel(meta){
  const tr=meta.track,K2=meta.K2,gap=meta.gap,steps=meta.steps;
  let mode='script',tp=0,target=null,final=false,settledAt=null,hit=false,lastP=null,dtAcc=0,clock=0,holdUntil=0,lastSwitch=-9,lastDigit=null;
  const row=sf=>tr[String(sf)];
  const api={
    get mode(){return mode;},get target(){return target;},get tp(){return tp;},
    begin(){mode='script';target=null;final=false;settledAt=null;lastP=null;lastSwitch=-9;},
    aim(d){final=false;settledAt=null;if(mode==='track')api.setTarget(d);else target=d;},
    probs(p,t=clock){ // 粘り: 新しい穴が今の穴より十分高いときだけ、かつ前の切替から0.2秒あけて移す
      if(final||!p)return;let best=0;for(let i=1;i<7;i++)if(p[i]>p[best])best=i;
      const cur=target?target-1:best;
      if(best!==cur&&p[best]>p[cur]*1.3+0.03&&t-lastSwitch>=.2){lastSwitch=t;target=best+1;}
      else if(target===null)target=best+1;
    },
    setTarget(d){if(d!==target){target=d;lastSwitch=clock;}},
    settle(cup,isHit){target=cup;final=true;hit=isHit;settledAt=null;},
    stateFor(sf,scene,dt){
      clock+=dt;const r=row(sf);if(!r)return null;const [cx,cy,w,p,g]=r.c;
      let smear=0,pp;
      if(scene.script_center&&sf<96){ // 台本どおり
        pp=p;const q=row(sf-1)?.c[3]??p;smear=Math.min(1,Math.abs(p-q)/.5);mode='script';lastP=p;
      }else{
        if(mode==='script'){mode='track';tp=lastP??p;if(target===null)target=lastDigit??((Math.round(tp)%7)+7)%7+1;}
        const want=target-1;const delta=wrap7(want-(tp-280));
        let step=0;
        if(Math.abs(delta)>.002){const v=Math.max(-22,Math.min(22,delta*11)),s=v*dt;step=Math.abs(s)>=Math.abs(delta)?delta:s;if(Math.abs(delta)<.02)step=delta;tp+=step;if(Math.abs(delta-step)<.002&&final&&settledAt===null)settledAt=clock;}
        else if(final&&settledAt===null)settledAt=clock;
        const perFrame=dt>0?Math.abs(step)*(1/30)/dt:0;smear=Math.min(1,perFrame/.5);
        pp=tp;
      }
      lastDigit=((Math.floor(pp-280+1e-6)%7)+7)%7+1;
      const u=(((pp-280)%7)+7)%7,sc6=u*steps;let ci=Math.round(sc6);const resid=(sc6-ci)/steps*gap;if(ci>=7*steps)ci-=7*steps;
      let bounce=0,boost=1;
      if(settledAt!==null){const a=clock-settledAt;if(hit){if(a<.4)bounce=-60*Math.exp(-a/.08)*Math.cos(a*40);boost=1+1.5*Math.exp(-a/.15);}else{if(a<.3)bounce=-14*Math.exp(-a/.08)*Math.cos(a*40);}}
      const sh=r.sh??[0,0];
      return {cell:ci,resid,smear,gain:g*boost,scale:w/meta.ref.w,x:cx*K2+sh[0],y:(cy+bounce)*K2+sh[1]};
    },
  };
  return api;
}
