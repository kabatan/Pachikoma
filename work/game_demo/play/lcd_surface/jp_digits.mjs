// Failure-only sprite atlas. No font rasterization or pixel reads during playback.
export async function createJpDigits(base, slotsFile) {
  const response=await fetch(new URL(slotsFile,base));if(!response.ok)throw Error('fail slots HTTP '+response.status);const slots=await response.json(),atlas={};
  for(const color of ['ash','gold'])for(const d of '0123456789玉'){
    const r=await fetch(new URL(`${color}_${d}.png`,base));if(!r.ok)throw Error('fail digit HTTP '+r.status);atlas[`${color}_${d}`]=await createImageBitmap(await r.blob());
  }
  const amounts=new Map();
  function amount(value,color){const key=`${color}:${value}`;if(amounts.has(key))return amounts.get(key);const str=String(Math.min(9999,Math.max(0,Math.floor(value))))+'玉';
    const height=300,images=[...str].map(d=>atlas[`${color}_${d}`]),widths=images.map((im,i)=>im.width/im.height*(i===images.length-1?210:height));
    const c=document.createElement('canvas');c.width=Math.ceil(widths.reduce((a,b)=>a+b,0)+24*(images.length-1));c.height=height;const x=c.getContext('2d');let at=0;
    images.forEach((im,i)=>{const h=i===images.length-1?210:height;x.drawImage(im,at,height-h,widths[i],h);at+=widths[i]+24;});amounts.set(key,c);return c;
  }
  function pair(ctx,ash,gold,box,sweep){const {x,y,w,h,opacity=1}=box;ctx.save();ctx.globalAlpha=opacity;ctx.drawImage(ash,x-w/2,y-h/2,w,h);
    if(sweep!=null){ctx.beginPath();ctx.rect(0,0,Math.max(0,sweep),1268);ctx.clip();ctx.drawImage(gold,x-w/2,y-h/2,w,h);}ctx.restore();}
  return {prepare(value){amount(value,'ash');amount(value,'gold');},draw(ctx,w){const row=slots[w.name]?.[w.f];if(!row)return;const values=[w.result?.unlit?.[0]??4,w.result?.unlit?.[0]??4,w.result?.lane??w.result?.pocket??5];
    for(const s of row.digits??[]){const a=atlas[`ash_${values[s.value]}`],g=atlas[`gold_${values[s.value]}`],ww=a.width/a.height*s.h;pair(ctx,a,g,{...s,w:ww},s.color==='sweep'?s.sweepX:null);}
    if(row.amount){const a=amount(w.earnings??0,'ash'),g=amount(w.earnings??0,'gold'),s=row.amount;const scale=Math.min(s.w/a.width,s.h/a.height);pair(ctx,a,g,{...s,w:a.width*scale,h:a.height*scale},s.sweepX);}
  },dispose(){Object.values(atlas).forEach(i=>i.close());amounts.clear();}};
}
