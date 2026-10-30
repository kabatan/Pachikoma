// Approved 30s offer -> unlimited staff wait -> staff receipt -> resume.
import {entryGuard} from '../play/cabinet_serial_r3_20261029.mjs';
export function attachCreditPanel({parent,ctrl,overlay,onInput}){
 const panel=document.createElement('section');panel.id='g-credit-panel';panel.setAttribute('aria-live','polite');
 panel.style.cssText='position:absolute;left:6%;right:6%;bottom:2%;z-index:30;padding:16px;border:2px solid #e8c672;border-radius:14px;background:#10152bf2;color:#fff;text-align:center;font:600 clamp(15px,2.5vw,28px) sans-serif;box-shadow:0 4px 24px #0008';
 const title=document.createElement('div'),detail=document.createElement('div'),buttons=document.createElement('div');
 detail.style.cssText='margin:8px 0;font-weight:400';buttons.style.cssText='display:flex;justify-content:center;gap:12px';
 const left=document.createElement('button'),right=document.createElement('button');
 for(const b of [left,right])b.style.cssText='font:inherit;padding:10px 16px;border-radius:8px;border:1px solid #dcb766;color:#fff;background:#282f53';
 left.textContent='左：終了する';right.textContent='右：チケット一枚で続ける';buttons.append(left,right);panel.append(title,detail,buttons);parent.append(panel);
 const input=(action,source)=>{const phase=ctrl.phase,accepted=(source!=='staff-keyboard'&&entryGuard(ctrl))?false:ctrl.dispatch(action);onInput?.({source,action,accepted,phase},ctrl.game);render();};
 const onRight=()=>input('requestExtra','pointer'),onLeft=()=>input(ctrl.phase==='StaffWait'?'cancelExtra':'finish','pointer');   // R3: 左右は液晶(終わる|続ける)と同じ向き
 left.addEventListener('click',onLeft);right.addEventListener('click',onRight);
 const key=e=>{if(e.code!=='KeyS'||e.repeat||ctrl.phase!=='StaffWait')return;e.preventDefault();input('staffActivate','staff-keyboard');};window.addEventListener('keydown',key);
 // 10/30 毎フレームの DOM 書き込みを、値が変わったときだけに（見た目・挙動は同じ）
 const put=(el,k,v)=>{if(el[k]!==v)el[k]=v;};
 function render(){
  const g=ctrl.game,waiting=g.phase==='StaffWait';put(panel,'hidden',(!waiting&&g.phase!=='Continue')||panel.dataset.lcd==='1');   // 液晶の追加画面が出る経路では箱を出さない
  put(title,'textContent',waiting?'チケット一枚をスタッフに渡してください':`つづけますか？ あと${Math.ceil(g.offerLeft)}秒`);
  put(detail,'textContent',waiting?'スタッフの確認後に再開します（スタッフ：左右ボタン同時に長押し／Sキー）':`チケット一枚で再開できます（＋${g.rules.ExtraSeconds}秒${(g.extraLoanBallsNow ?? g.rules.ExtraLoanBalls) > 0 ? `・＋${g.extraLoanBallsNow ?? g.rules.ExtraLoanBalls}玉` : ''}。今の続きから遊べます）。`);
  put(right,'hidden',waiting);put(left,'textContent',waiting?'左：取り消して終了':'左：終了する');
 }
 const original=overlay.render;overlay.render=function(...args){const result=original.apply(this,args);render();return result;};render();
 return ()=>{overlay.render=original;window.removeEventListener('keydown',key);left.removeEventListener('click',onLeft);right.removeEventListener('click',onRight);panel.remove();};
}
