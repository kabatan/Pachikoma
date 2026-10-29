// The choice clock/input belong to the visible choice, after the payout and offer.
// Keep the v20 countdown and timer compositors untouched.
export function attachChainConnect(lcd,{controller}) {
  if(!lcd?.jp||lcd.chainConnect)return lcd;
  const dispatch=controller.dispatch;let game,advance;
  const ready=()=>!lcd.jp.claimed&&!!lcd.choiceV20?.active;
  const bind=()=>{
    if(game===controller.game)return;
    if(game)game._advanceChainChoice=advance;
    game=controller.game;advance=game._advanceChainChoice;
    game._advanceChainChoice=function(seconds){
      if(this.chainAnnouncing){if(!lcd.rulesH?.state?.announceOn&&!this.chainTooLate)return false;}   // H: 告知は液晶に出ている間だけ数える（配当・継続成功の映像が終わってから）。時計は止めない
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
  lcd.chainConnect={get ready(){return ready();},offerSeconds:1.6,watchdogReleases:0};
  // 保険: 選択に入っているのに、払い出し・案内でも確定でもない JP の場面(導入・狙い等)が残っていると
  // ready() が false のままになり、入力が全部拒否される(ソフトロック)。2秒続いたらその場面を終わらせる。
  const frame=lcd.frame.bind(lcd);let stale=0;
  lcd.frame=(dt,F)=>{
    const m=lcd.jp?.model,legit=!m||m.payout>0||['chain_offer','chain_confirm'].includes(m.name);
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
