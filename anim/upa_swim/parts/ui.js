// ---- スライダー・ボタン ----
function bind(id,key,fmt,onchg){
  const el=document.getElementById(id),out=document.getElementById(id+'v');
  const upd=()=>{P[key]=parseFloat(el.value);out.textContent=fmt(P[key]);onchg&&onchg()};
  el.addEventListener('input',upd);upd();
}
const litBtn=document.getElementById('lit'),resetBtn=document.getElementById('reset');
function showing(){return upas.some(u=>u.show)}
function updateButtons(){
  const busy=showing()||FX.on&&FX.land>=0&&FX.t-FX.land<FX.dur;
  litBtn.disabled=busy||lit>=6;
  litBtn.textContent=lit>=6?'6灯 (7灯は後日)':busy?'演出中…':(lit+1)+'灯目を点ける';
}
function beginLamp(){
  if(!SPR||lit>=6||showing())return false;
  lit++;pulse=0;fxStart(lit);
  const u=new Upa((lit-1)%HUES.length);u.startShow(lit);upas.push(u);
  lcdLampStarted();return true;
}
litBtn.addEventListener('click',beginLamp);
function resetAll(){
  lit=1;setCount(1);upas[0].show=null;upas[0].mode='swim';upas[0].zoom=1;
  clearLampEffects();
}
function clearLampEffects(){
  FX.on=false;FX.land=-1;FX.flash=0;FX.shake=0;FX.punch=0;dayT=0;dayV=0;HIT=0;envV=0;
  for(const p of PARTS)p.s.destroy();PARTS.length=0;
  for(const o of LANTERNS)o.c.destroy({children:true});LANTERNS.length=0;
  logoClear();decorClear();
}
resetBtn.addEventListener('click',()=>{if(SPR)resetAll()});
bind('spd','spd',v=>'×'+v.toFixed(2));
bind('calm','calm',v=>v.toFixed(2));
bind('sz','sz',v=>'×'+v,()=>{if(SPR)makeBuf()});
app.view.addEventListener('pointerdown',e=>{
  if(EMBED)return;
  const r=app.view.getBoundingClientRect();
  const fx=(e.clientX-r.left)/r.width*W,fy=(e.clientY-r.top)/r.height*H;
  for(const u of upas)u.scare(fx,fy);
});
loadAll().then(()=>{assetsReady=true;tryStart()}).catch(e=>{lcdReject(e);showError('素材の読み込みに失敗: '+(e&&e.message||e))});
app.view.addEventListener('webglcontextlost',e=>{e.preventDefault();showError('WebGLが中断されました。ページを再読み込みしてください')});
})();
</script>
