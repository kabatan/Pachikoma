// The choice clock/input belong to the visible choice, after the payout and offer.
// Keep the v20 countdown and timer compositors untouched.
export function attachChainConnect(lcd,{controller}) {
  if(!lcd?.jp||lcd.chainConnect)return lcd;
  const dispatch=controller.dispatch;let game,advance;
  let forceReady=false;   // 10/31 保険：選択画面が長く出られないときは、入力と数えを通す（固まらない）
  // 10/31 液晶が画面復旧（displayRecoveryActive。frame_fault_boundary）に入ると、lcd.frame の包み（告知の数え・選択画面・保険）も onEvent も通らない。
  //   それでも規則は液晶の「告知が出ている／選択画面が出ている」を待つので、継続の告知・選択で永久に固まった。復旧中は液晶を待たない（告知は時計どおり、選択は制限時間どおり）。
  const recovering=()=>!!lcd.displayRecoveryActive;
  const ready=()=>forceReady||recovering()||(!lcd.jp.claimed&&!!lcd.choiceV20?.active);
  const bind=()=>{
    if(game===controller.game)return;
    if(game)game._advanceChainChoice=advance;
    game=controller.game;advance=game._advanceChainChoice;
    game._advanceChainChoice=function(seconds){
      if(this.chainAnnouncing){if(!lcd.rulesH?.state?.announceOn&&!this.chainTooLate&&!recovering())return false;}   // H: 告知は液晶に出ている間だけ数える（配当・継続成功の映像が終わってから）。時計は止めない
      else if(this.phase==='ChainChoice'&&!ready()&&!this.chainTooLate)return false;   // 時間切れ間近の確定は映像待ちで止めない
      return advance.call(this,seconds);
    };
  };
  bind();const offReset=controller.onAction?.(action=>{if(action==='reset')bind();});
  controller.dispatch=function(action){
    if(this.game.phase==='ChainChoice'&&['chainContinue','chainStop'].includes(action)&&!ready())return false;
    if(action==='fire'&&this.game.chainStatus?.inChallenge&&lcd.choiceV20?.holding)return false;
    return dispatch.call(this,action);
  };
  lcd.chainConnect={get ready(){return ready();},offerSeconds:1.6,watchdogReleases:0,annForces:0,notReadyReleases:0,forceReadies:0};
  // 保険: 選択に入っているのに、払い出し・案内でも確定でもない JP の場面(導入・狙い等)が残っていると
  // ready() が false のままになり、入力が全部拒否される(ソフトロック)。2秒続いたらその場面を終わらせる。
  const frame=lcd.frame.bind(lcd);let stale=0,annWait=0,notReady=0,relOnce=false;
  lcd.frame=(dt,F)=>{
    // 10/31 固まり対策：(1)告知の数えは映像が出ている間だけ。映像が出ないまま続くなら強制で出す（映像の終わり方を問わず、2秒で出せなければ数えだけ進める。配当・成功の映像が流れている間は最長8秒待つ）
    //   (2)選択画面が出られないまま続くなら、3秒でJPの場面を終わらせ、さらに2秒で入力と制限時間を通す。
    const g0=controller.game,d0=Math.min(dt,.1);
    if(g0?.phase==='ChainChoice'&&g0.chainAnnouncing&&!lcd.rulesH?.state?.announceOn){
      annWait+=d0;const mm=lcd.jp?.model,film=!!mm?.active&&/^(reward_|chain_success|chain_jp_land_|roulette_)/.test(mm.name??'');
      if(annWait>(film?8:2)){annWait=0;lcd.chainAnnounceV09?.force?.('wait');lcd.chainConnect.annForces++;}
    }else annWait=0;
    if(g0?.phase==='ChainChoice'&&!g0.chainAnnouncing&&!ready()){
      notReady+=d0;
      if(notReady>3&&!relOnce){relOnce=true;if(lcd.jp?.model?.active){try{lcd.jp.model.stop('choice-notready');}catch{}lcd.chainConnect.notReadyReleases++;}}
      if(notReady>5&&!forceReady){forceReady=true;lcd.chainConnect.forceReadies++;}
    }else if(g0?.phase!=='ChainChoice'){notReady=0;forceReady=false;relOnce=false;}
    else if(ready()&&!forceReady)notReady=0;
    const m=lcd.jp?.model,legit=!m||m.payout>0||['chain_offer','chain_confirm'].includes(m.name)||/^chain_announce_/.test(m.name??'');   // 継続告知 v09 の映像も正当
    if(game?.phase==='ChainChoice'&&lcd.jp?.claimed&&!lcd.choiceV20?.active&&!legit){
      stale+=dt;if(stale>2){stale=0;lcd.chainConnect.watchdogReleases++;m.stop('choice-watchdog');}
    }else stale=0;
    return frame(dt,F);
  };
  const dispose=lcd.dispose.bind(lcd);
  lcd.dispose=()=>{offReset?.();game._advanceChainChoice=advance;controller.dispatch=dispatch;lcd.frame=frame;dispose();};
  return lcd;
}

export async function createChainOffer(){
  const image=new Image();
  await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('chain offer telop unavailable'));image.src=new URL('./chain_offer_20261029_v2.png',import.meta.url).href;});
  const canvas=document.createElement('canvas');canvas.width=1152;canvas.height=1268;canvas.readyState=4;
  const ctx=canvas.getContext('2d',{alpha:false});
  const held=document.createElement('canvas');held.width=1152;held.height=1268;
  const hold=held.getContext('2d',{alpha:false});
  return {
    begin(previous){if(previous)hold.drawImage(previous,0,0,1152,1268);},
    frame(background,time,waiting){
      if(waiting){ctx.drawImage(held,0,0);return canvas;}
      ctx.drawImage(background,0,0,1152,1268);
      // Only the text moves. The approved sea/palace retains its own color/clock.
      const enter=Math.min(1,time/.18),leave=Math.min(1,(1.6-time)/.18);
      ctx.save();ctx.globalAlpha=Math.max(0,Math.min(enter,leave));
      ctx.drawImage(image,0,Math.round(20*(1-enter)),1152,1268);ctx.restore();
      if(time<.12){ctx.globalAlpha=1-time/.12;ctx.drawImage(held,0,0);ctx.globalAlpha=1;}
      return canvas;
    },
  };
}
