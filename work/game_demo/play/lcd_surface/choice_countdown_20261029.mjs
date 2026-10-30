// Reuse the v20 compositor's exact gold glyphs; only this small region is patched.
export async function createChoiceCountdown(canvas,getValue,{cache=new URLSearchParams(location.search).get('choiceoverlay')!=='0'}={}){
  const base=new URL('./timer_assets_20261029/choice/',import.meta.url);
  const response=await fetch(new URL('metadata.json',base));
  if(!response.ok)throw Error('Choice countdown metadata: '+response.status);
  const meta=await response.json(),r=meta.rect;let ctx=canvas.getContext('2d'),overlayMode=false,overlayRevision=0;
  // Conservative original-glyph bounds including the unchanged <=1.025 bump.
  const dr={x:34+Math.floor(meta.box[0]+(r.x-meta.box[0])*1.025)-2,y:28+Math.floor(meta.box[1]+(r.y-meta.box[1])*1.025)-2};
  dr.width=34+Math.ceil(meta.box[0]+(r.x+r.width-meta.box[0])*1.025)+2-dr.x;
  dr.height=28+Math.ceil(meta.box[1]+(r.y+r.height-meta.box[1])*1.025)+2-dr.y;
  const make=()=>{const c=document.createElement('canvas');c.width=r.width;c.height=r.height;return c;};
  const mixed=make(),mix=mixed.getContext('2d'),saved=make(),save=saved.getContext('2d',{alpha:false});
  const snapshot=make(),snap=snapshot.getContext('2d');
  const load=async file=>{const res=await fetch(new URL(file,base));if(!res.ok)throw Error('Choice countdown asset: '+file);return createImageBitmap(await res.blob());};
  const states={},maxValue=Math.max(...meta.values);   // 10/31：100円の追加の選択は 30 秒。素材は 0..30（以前は 0..12 で 12 に張り付いた）
  for(const [name,files] of Object.entries(meta.states)){
    const patch=await load(files.patch),digits={};
    await Promise.all(Object.entries(files.digits).map(async([n,file])=>{digits[n]=await load(file);}));
    states[name]={patch,digits};
  }
  const patchOut=make(),patchCtx=patchOut.getContext('2d'),digitOut=document.createElement('canvas');digitOut.width=dr.width;digitOut.height=dr.height;const digitCtx=digitOut.getContext('2d');
  const gpuMask=make(),gpuTarget=make();gpuMask.getContext('2d').drawImage(states.neutral.patch,0,0);let gpuSnapshot=null;
  let drawn=false,value=null,bumpAge=1,patchKey=null,digitKey=null,patchRevision=0,digitRevision=0,paintPatch=true,paintDigit=true;
  const advance=(dt,override)=>{
    const raw=override??getValue();if(!Number.isFinite(raw))return false;
    const next=Math.min(maxValue,Math.max(0,Math.ceil(raw-1e-9)));
    if(next!==value){bumpAge=value===null?1:0;value=next;}bumpAge+=Math.max(0,dt);return true;
  };
  const scaleNow=()=>{const t=Math.min(1,bumpAge/.18);return 1+.025*Math.sin(Math.PI*t)*(1-t);};
  const x=34+r.x,y=28+r.y;
  // Both operands share one alpha mask. Add premultiplied weighted pixels,
  // then composite once, so a fading patch cannot expose the baked numeral.
  const combine=(a,b,t)=>{
    mix.clearRect(0,0,r.width,r.height);mix.globalAlpha=1-t;mix.drawImage(a,0,0);
    mix.globalCompositeOperation='lighter';mix.globalAlpha=t;mix.drawImage(b,0,0);
    mix.globalAlpha=1;mix.globalCompositeOperation='source-over';return mixed;
  };
  const api={
    createGpuWarmInputs(){
      if(drawn||value!==null||bumpAge!==1||gpuSnapshot)throw Error('Choice COUNT warm is boot-only');
      const patch=make(),pc=patch.getContext('2d'),digit=document.createElement('canvas');digit.width=dr.width;digit.height=dr.height;const dc=digit.getContext('2d');
      // Draw the already-loaded original glyphs on private scratch only.
      for(const state of Object.values(states)){pc.clearRect(0,0,r.width,r.height);pc.drawImage(state.patch,0,0);for(const glyph of Object.values(state.digits)){dc.clearRect(0,0,dr.width,dr.height);dc.drawImage(glyph,0,0);}}
      pc.clearRect(0,0,r.width,r.height);pc.drawImage(states.neutral.patch,0,0);dc.clearRect(0,0,dr.width,dr.height);dc.save();dc.translate(34+meta.box[0]-dr.x,28+meta.box[1]-dr.y);dc.drawImage(states.neutral.digits[8],r.x-meta.box[0],r.y-meta.box[1]);dc.restore();
      return {patch:{canvas:patch,x,y,width:r.width,height:r.height},digit:{canvas:digit,...dr},mask:gpuMask,target:gpuTarget};
    },
    get value(){return value;},
    reset(){drawn=false;value=null;bumpAge=1;gpuSnapshot=null;patchKey=digitKey=null;},
    invalidate(){drawn=false;},
    clearDigit(){if(drawn){ctx.drawImage(saved,x,y);drawn=false;}},
    snapshotGpu(source){gpuSnapshot=source;},
    snapshot(source){gpuSnapshot=null;
      snap.clearRect(0,0,r.width,r.height);
      snap.drawImage(source,r.x,r.y,r.width,r.height,0,0,r.width,r.height);
      snap.globalCompositeOperation='destination-in';snap.drawImage(states.neutral.patch,0,0);
      snap.globalCompositeOperation='source-over';
    },
    draw(state,blend,dt,override){
      if(!advance(dt,override))return;
      const target=states[state];
      const patch=blend?combine(blend.from?states[blend.from].patch:snapshot,target.patch,blend.alpha):target.patch;
      if(overlayMode){if(paintPatch){patchCtx.clearRect(0,0,r.width,r.height);patchCtx.drawImage(patch,0,0);}}
      else {ctx.drawImage(patch,x,y);save.drawImage(canvas,x,y,r.width,r.height,0,0,r.width,r.height);}
      // Only one numeral is composited after the complete video/patch blend.
      const digit=blend?.from?combine(states[blend.from].digits[value],target.digits[value],blend.alpha):target.digits[value];
      if(!overlayMode||paintDigit){const scale=scaleNow();ctx.save();ctx.translate(34+meta.box[0],28+meta.box[1]);ctx.scale(scale,scale);
      ctx.drawImage(digit,r.x-meta.box[0],r.y-meta.box[1]);ctx.restore();}drawn=true;
    },
    renderOverlay(state,blend,dt,override){
      const valid=advance(dt,override),nonce=++overlayRevision;
      // A selection fade has changing premultiplied operands; keep its original path.
      const pk=valid?state:'empty',dk=valid?state+':'+value+':'+scaleNow():'empty';
      paintPatch=!cache||!!blend||patchKey!==pk;paintDigit=!cache||!!blend||digitKey!==dk;
      if(paintPatch){patchCtx.clearRect(0,0,r.width,r.height);patchRevision++;}
      if(paintDigit){digitCtx.clearRect(0,0,dr.width,dr.height);digitRevision++;}
      const previous=ctx;
      digitCtx.save();digitCtx.translate(-dr.x,-dr.y);ctx=digitCtx;overlayMode=true;
      try{if(valid&&(paintPatch||paintDigit))api.draw(state,blend,0,value);}finally{ctx=previous;overlayMode=false;digitCtx.restore();drawn=false;paintPatch=paintDigit=true;}
      patchKey=blend?null:pk;digitKey=blend?null:dk;
      const gpuBlend=blend?.from===null&&gpuSnapshot?{source:gpuSnapshot,mask:gpuMask,target:gpuTarget,alpha:blend.alpha}:null;if(gpuBlend){const g=gpuTarget.getContext('2d');g.clearRect(0,0,r.width,r.height);g.drawImage(states[state].patch,0,0);}
      return {patch:{canvas:patchOut,x,y,width:r.width,height:r.height,revision:cache?patchRevision:nonce,...(gpuBlend?{gpuBlend}:null)},digit:{canvas:digitOut,...dr,revision:cache?digitRevision:nonce},value};
    },
    dispose(){for(const s of Object.values(states)){s.patch.close();for(const im of Object.values(s.digits))im.close();}},
  };return api;
}
