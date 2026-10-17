// 外部ステージ用。描画・物理・演出は単体ページと同じ step を通す。
let lcdReady=false,lcdResolve,lcdReject;
const lcdReadyPromise=new Promise((resolve,reject)=>{lcdResolve=resolve;lcdReject=reject});
// whenReady() を使わないホストでも未処理 rejection を出さない。
lcdReadyPromise.catch(()=>{});
const LCDLAMP={on:false,start:0,t:0,endsAt:0};
function lcdLampBusy(){return showing()||(FX.on&&FX.land>=0&&FX.t-FX.land<FX.dur)}
function lcdLampStarted(){
  // 落下を既存と同じ60Hzで予測。着地後は実際の時刻で補正する。
  let y=-40,v=0,fall=0;
  const ground=H*0.64+SH*P.sz*1.18*0.5;
  while(y<ground){v+=5200/60;y+=v/60;fall+=1/60}
  Object.assign(LCDLAMP,{on:true,start:clock,t:0,endsAt:fall+FX.dur+Math.ceil(FX.T.hit*60)/60+1/60});
}
function lcdTick(){
  if(!LCDLAMP.on)return;
  LCDLAMP.t=clock-LCDLAMP.start;
  // show と FX の時間はヒットストップ中だけ停止する。
  const u=upas.find(u=>u.show);
  if(FX.land>=0){
    const remaining=Math.max(0,FX.dur-(FX.t-FX.land),u?FX.dur-(u.show.t-u.show.t0):0);
    LCDLAMP.endsAt=LCDLAMP.t+remaining+Math.ceil(Math.max(0,HIT)*60)/60+(u?1/60:0);
  }
  if(!lcdLampBusy()){LCDLAMP.on=false;LCDLAMP.endsAt=LCDLAMP.t}
}
function lcdStarted(){
  nsReady.then(()=>{
    if(!nsOK||!R3)throw new Error('LCD: 通常背景またはルーレット3D層を初期化できませんでした');
    // 手動モードでも最初の1枚を読み取れるようにする。
    window.__upa.step(0);lcdReady=true;lcdResolve(window.LCDAPI);
  }).catch(lcdReject);
}
function lcdRequireReady(){if(!lcdReady)throw new Error('LCDAPI.whenReady() を待ってください')}
function lcdInt(value,min,max,name){
  if(!Number.isInteger(value)||value<min||value>max)throw new RangeError(`${name}: ${min}〜${max} の整数が必要です`);
  return value;
}
function lcdClear(restart=false){
  if(RL.on)rlFinish();
  clearLampEffects();
  for(const u of upas){u.show=null;u.asc=null;u.mode='swim';u.zoom=1;u.white=0;u.mono=0;u.alp=1;u.rel=0}
  Object.assign(RL,{on:false,t:0,cfg:null,nsScale:1,shk:0,pun:0,zoomK:0,ascs:[]});
  Object.assign(FX,{on:false,t:0,N:0,T:TIER.A,land:-1,dur:TIER.A.dur,rayPulse:0});
  bloomK=0.7;
  // setLamps は通常画面の時計と既存の個体を維持。reset のみ巻き戻す。
  if(restart){
    lit=1;upas.length=0;setCount(1);clock=0;pulse=0;spinT=0;
    for(const m of mists)m.tilePosition.set(0,0);
    if(NSC){NSC.time=0;NSC.update(0)}
  }
  Object.assign(LCDLAMP,{on:false,start:0,t:0,endsAt:0});
}
window.LCDAPI={
  get ready(){return lcdReady},
  whenReady:()=>lcdReadyPromise,
  get canvas(){return app.view},
  get W(){return app.view.width},get H(){return app.view.height},
  step(dt){
    lcdRequireReady();
    if(!Number.isFinite(dt)||dt<0)throw new RangeError('dt: 0以上の有限秒数が必要です');
    // step 内で renderAll も1回。大きな dt は各サブフレームを描画する
    // (砕ける直前のスナップショットも通常再生と同じにするため)。
    if(dt===0){window.__upa.step(0);return}
    const count=Math.ceil(dt/0.05);
    for(let i=0;i<count;i++)window.__upa.step(Math.min(0.05,dt-i*0.05));
  },
  setLamps(n){
    lcdRequireReady();lcdInt(n,0,6,'n');lcdClear();lit=n;setCount(n);window.__upa.step(0);
  },
  lamp(n){
    lcdRequireReady();lcdInt(n,1,6,'n');
    if(this.busy())return false;
    this.setLamps(n-1);return beginLamp();
  },
  roulette({n_from,k,result}={}){
    lcdRequireReady();lcdInt(n_from,1,5,'n_from');
    const decode=v=>v==='all'?'all':({m1:1,m2:2,m3:3}[v]??v);
    const loss=decode(k===undefined?result:k);
    if(loss!=='all')lcdInt(loss,1,Math.min(3,n_from),'k');
    if(result!==undefined&&decode(result)!==loss)throw new RangeError('k と result の結果が一致していません');
    if(this.busy())return false;
    const outcome=loss==='all'?'all':'m'+loss;
    const near=RL_CASES[n_from<=3?'c1':n_from===4?'c2':'c3'];
    // c1 の盤には全消灯が無い。その結果を指定した場合は c2 の盤を使う。
    const template=near.probs.some(([id])=>id===outcome)?near:RL_CASES.c2;
    this.setLamps(n_from);
    rlStart({...template,id:'lcd',n:n_from,result:outcome});
    return true;
  },
  busy(){return RL.on||LCDLAMP.on},
  state(){
    if(RL.on){
      const phase=RL.t<RLT.ramp0?'pre':RL.t<RLT.T?'spin':RL.t<RL.ascT0?'result':RL.t<RL.retAt?'ascend':'return';
      return {busy:true,kind:'roulette',t:RL.t+0.8,needle:((rlTheta(RL.t)%360+360)%360)/360,phase,lamps:lit,endsAt:RL.endAt+0.8};
    }
    if(LCDLAMP.on)return {busy:true,kind:'lamp',t:LCDLAMP.t,needle:null,phase:null,lamps:lit,endsAt:LCDLAMP.endsAt};
    return {busy:false,kind:null,t:0,needle:null,phase:null,lamps:lit,endsAt:0};
  },
  reset(){lcdRequireReady();lcdClear(true);window.__upa.step(0)},
};
