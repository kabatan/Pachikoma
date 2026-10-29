// Reuse the v20 compositor's exact gold glyphs; only this small region is patched.
export async function createChoiceCountdown(canvas,getValue){
  const base=new URL('./timer_assets_20261029/choice/',import.meta.url);
  const response=await fetch(new URL('metadata.json',base));
  if(!response.ok)throw Error('Choice countdown metadata: '+response.status);
  const meta=await response.json(),r=meta.rect,ctx=canvas.getContext('2d');
  const make=()=>{const c=document.createElement('canvas');c.width=r.width;c.height=r.height;return c;};
  const mixed=make(),mix=mixed.getContext('2d'),saved=make(),save=saved.getContext('2d',{alpha:false});
  const snapshot=make(),snap=snapshot.getContext('2d');
  const load=async file=>{const res=await fetch(new URL(file,base));if(!res.ok)throw Error('Choice countdown asset: '+file);return createImageBitmap(await res.blob());};
  const states={};
  for(const [name,files] of Object.entries(meta.states)){
    const patch=await load(files.patch),digits={};
    await Promise.all(Object.entries(files.digits).map(async([n,file])=>{digits[n]=await load(file);}));
    states[name]={patch,digits};
  }
  let drawn=false,value=null,bumpAge=1;
  const x=34+r.x,y=28+r.y;
  // Both operands share one alpha mask. Add premultiplied weighted pixels,
  // then composite once, so a fading patch cannot expose the baked numeral.
  const combine=(a,b,t)=>{
    mix.clearRect(0,0,r.width,r.height);mix.globalAlpha=1-t;mix.drawImage(a,0,0);
    mix.globalCompositeOperation='lighter';mix.globalAlpha=t;mix.drawImage(b,0,0);
    mix.globalAlpha=1;mix.globalCompositeOperation='source-over';return mixed;
  };
  return {
    get value(){return value;},
    reset(){drawn=false;value=null;bumpAge=1;},
    invalidate(){drawn=false;},
    clearDigit(){if(drawn){ctx.drawImage(saved,x,y);drawn=false;}},
    snapshot(source){
      snap.clearRect(0,0,r.width,r.height);
      snap.drawImage(source,r.x,r.y,r.width,r.height,0,0,r.width,r.height);
      snap.globalCompositeOperation='destination-in';snap.drawImage(states.neutral.patch,0,0);
      snap.globalCompositeOperation='source-over';
    },
    draw(state,blend,dt,override){
      const raw=override??getValue();
      if(!Number.isFinite(raw))return;
      const next=Math.min(12,Math.max(0,Math.ceil(raw-1e-9)));
      if(next!==value){bumpAge=value===null?1:0;value=next;}
      bumpAge+=Math.max(0,dt);
      const target=states[state];
      const patch=blend?combine(blend.from?states[blend.from].patch:snapshot,target.patch,blend.alpha):target.patch;
      ctx.drawImage(patch,x,y);
      save.drawImage(canvas,x,y,r.width,r.height,0,0,r.width,r.height);
      // Only one numeral is composited after the complete video/patch blend.
      const digit=blend?.from?combine(states[blend.from].digits[value],target.digits[value],blend.alpha):target.digits[value];
      const t=Math.min(1,bumpAge/.18),scale=1+.025*Math.sin(Math.PI*t)*(1-t);
      ctx.save();ctx.translate(34+meta.box[0],28+meta.box[1]);ctx.scale(scale,scale);
      ctx.drawImage(digit,r.x-meta.box[0],r.y-meta.box[1]);ctx.restore();drawn=true;
    },
    dispose(){for(const s of Object.values(states)){s.patch.close();for(const im of Object.values(s.digits))im.close();}},
  };
}
