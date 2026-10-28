// G's left/right offer contract; the serial protocol and gameplay stay legacy.
import {CabinetSerial as BaseSerial,parseCabinetLine} from './cabinet_serial.mjs';
export class CabinetSerial extends BaseSerial {
 get gOffer(){return this.ctrl.rules?.RuleVariant==='G_20261028'&&['Continue','StaffWait'].includes(this.ctrl.phase);}
 accept(text){
  const message=parseCabinetLine(text);
  if(this.gOffer&&this.ready&&message?.type==='button'){
   const phase=this.ctrl.phase,action=message.name==='CHALLENGE'?(phase==='StaffWait'?'cancelExtra':'finish'):phase==='Continue'?'requestExtra':null;
   if(action){const accepted=this.ctrl.dispatch(action);this.onInput?.({source:'cabinet',action,accepted,phase},this.ctrl.game);}return;
  }
  return super.accept(text);
 }
 tick(now){
  if(!this.gOffer||!this.port||!this.ready)return super.tick(now);
  const leds=this.ctrl.phase==='Continue'?'1,1':'0,1';
  if(leds!==this.lastLeds||now-this.lastLedAt>=1000){this.lastLeds=leds;this.lastLedAt=now;this.send(`LED,${leds}`);}
 }
}
