// ピッチを変えずにJPの全尺・成功の払い出し開始へ追従する。原実機音は使わない。
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const positive=v=>Number.isFinite(v)&&v>0;
export function winPlan(event,timing) {
  const id=event.id,d=event.data??{},f=timing.events[id];if(!f)return null;
  const scale=positive(d.scale)?d.scale:1;
  const duration=id==='jp'?(positive(d.audio?.duration)?d.audio.duration:positive(d.duration)?d.duration:positive(d.scale)?f.duration_s*scale:Number.isInteger(d.tier)&&timing.jp_variants_s?.[d.tier]?timing.jp_variants_s[d.tier]:f.duration_s)
    :(positive(d.audio?.payoutStart)?d.audio.payoutStart:positive(d.payoutStart)?d.payoutStart:f.payout_start_s*scale);
  const bounded=clamp(duration,id==='jp'?4:.4,id==='jp'?90:20);
  return {id,duration:bounded,impactAt:f.charge_s,
    announcementEnd:id==='jp'?timing.jp_parts.head_s:Math.min(duration,f.charge_s+1),
    payoutAt:id==='jp'?bounded*timing.jp_parts.number_fraction:bounded};
}
export function createWinSound(context,buffers,timing,plan) {
  const sr=context.sampleRate,out=context.createBuffer(2,Math.round(plan.duration*sr),sr);
  const put=(name,at,gain=1,maxFrames=Infinity)=>{
    const b=buffers.get(name);if(!b)throw new Error(`win asset ${name} missing`);
    const offset=Math.round(at*sr),n=Math.max(0,Math.min(b.length,maxFrames,out.length-offset));
    for(let k=0;k<2;k++){
      const a=b.getChannelData(k),d=out.getChannelData(k),fade=Math.min(Math.round(.02*sr),Math.floor(n/2));
      for(let i=0;i<n;i++){const edge=n<b.length&&i>=n-fade?(n-1-i)/Math.max(1,fade):1;d[offset+i]+=a[i]*gain*Math.max(0,edge);}
    }
  };
  if(plan.id==='jp') {
    const p=timing.jp_parts,peak=.95,tailAt=plan.duration-p.tail_s;
    put('win_jp_head',0,p.head_gain/peak,Math.round(tailAt*sr));
    for(let at=p.head_s;at<tailAt;at+=p.loop_s-p.overlap_s)put('win_jp_loop',at,p.loop_gain/peak,Math.round((tailAt-at)*sr));
    put('win_number',plan.payoutAt,p.number_gain/peak);
    put('win_jp_tail',tailAt,p.tail_gain/peak);
    let max=0;for(let k=0;k<2;k++){const a=out.getChannelData(k);for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]));}
    const gain=.91/Math.max(1e-9,max);for(let k=0;k<2;k++){const a=out.getChannelData(k);for(let i=0;i<a.length;i++)a[i]*=gain;}
  } else {
    const b=buffers.get(plan.id);
    if(Math.abs(b.duration-plan.duration)<1/sr) {for(let k=0;k<2;k++)out.copyToChannel(b.getChannelData(k),k);return out;}
    // 頭と余韻を保持し、中央の音だけ反復/短縮する。再生速度は常に1。
    const head=Math.min(Math.round(.6*sr),Math.floor(out.length*.4)),tail=Math.min(Math.round(.30*sr),Math.floor(out.length*.25));
    for(let k=0;k<2;k++){
      const src=b.getChannelData(k),dst=out.getChannelData(k);dst.set(src.subarray(0,head),0);
      const region=src.subarray(head,Math.max(head+1,src.length-tail)),hop=Math.max(1,region.length-Math.round(.02*sr));
      for(let at=head;at<dst.length-tail;at+=hop){
        const n=Math.min(region.length,dst.length-tail-at),fade=Math.min(960,Math.floor(n/2));
        for(let i=0;i<n;i++){const g=Math.min(1,i/Math.max(1,fade),(n-1-i)/Math.max(1,fade));dst[at+i]+=region[i]*Math.max(0,g);}
      }
      for(let i=0;i<tail;i++)dst[dst.length-tail+i]=src[src.length-tail+i];
    }
  }
  const fade=Math.min(576,Math.floor(out.length/4));
  for(let k=0;k<2;k++){const a=out.getChannelData(k);for(let i=0;i<fade;i++)a[a.length-fade+i]*=(1+Math.cos(Math.PI*i/(fade-1)))/2;a[0]=a[a.length-1]=0;}
  return out;
}
