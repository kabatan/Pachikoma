// Boot-only, sequential: no new video/canvas/GL resource or model callback.
function nextFrame(v, timeoutMs) {
  let id, timer, done;
  const promise=new Promise((resolve,reject)=>{
    done=()=>{clearTimeout(timer);if(id!==undefined)v.cancelVideoFrameCallback(id);v.removeEventListener('error',bad);};
    const bad=()=>{done();reject(Error('warm video decode failed'));};
    v.addEventListener('error',bad,{once:true});
    timer=setTimeout(()=>{done();reject(Error('warm video frame timeout'));},timeoutMs);
    id=v.requestVideoFrameCallback(()=>{done();resolve();});
  });
  return {promise,cancel:()=>done()};
}
function restoreTime(v,time,timeoutMs){
  if(v.currentTime===time&&!v.seeking)return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);v.removeEventListener('seeked',done);v.removeEventListener('error',bad);};
    const done=()=>{cleanup();v.currentTime===time?resolve():reject(Error('warm time restore mismatch'));};
    const bad=()=>{cleanup();reject(Error('warm time restore failed'));};
    const timer=setTimeout(()=>{cleanup();reject(Error('warm time restore timeout'));},timeoutMs);
    v.addEventListener('seeked',done);v.addEventListener('error',bad,{once:true});
    try{v.currentTime=time;}catch(e){cleanup();reject(e);}
  });
}
export async function warmPausedVideo(v,draw,{timeoutMs=3000}={}){
  if(!v.paused||v.ended||v.seeking||v.readyState<2)return {skipped:true,reason:'not-paused-ready'};
  if(!v.requestVideoFrameCallback||!v.cancelVideoFrameCallback)return {skipped:true,reason:'no-frame-callback'};
  const time=v.currentTime,src=v.currentSrc||v.src,frame=nextFrame(v,timeoutMs);
  let playbackTimer;
  try{
    // rVFC can resolve before play(); retain a deadline until both have settled.
    const playbackDeadline=new Promise((_,reject)=>{playbackTimer=setTimeout(()=>reject(Error('warm video play/frame timeout')),timeoutMs);});
    await Promise.race([Promise.all([v.play(),frame.promise]),playbackDeadline]);v.pause();
    if((v.currentSrc||v.src)!==src)throw Error('warm source changed');
    await draw(v);
    return {skipped:false};
  }finally{
    clearTimeout(playbackTimer);frame.cancel();v.pause();await restoreTime(v,time,timeoutMs);
  }
}
// Loading only. The original context must be unclipped; callers must await warm in order.
export async function withRestored2D(ctx,work){
  if(ctx.getContextAttributes?.()?.alpha!==false)throw Error('Startup warm snapshot requires an opaque canvas');
  const bitmap=await createImageBitmap(ctx.canvas,{premultiplyAlpha:'none',colorSpaceConversion:'none'});
  let saved=false;
  try{
    ctx.save();saved=true;
    ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
    return await work();
  }finally{
    try{
      if(saved){
        // Restore the original (unclipped) state first, undoing work's own clip/styles.
        ctx.restore();ctx.save();
        try{
          ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.filter='none';ctx.globalCompositeOperation='copy';
          ctx.shadowColor='rgba(0,0,0,0)';ctx.shadowBlur=0;ctx.shadowOffsetX=0;ctx.shadowOffsetY=0;
          ctx.imageSmoothingEnabled=false;
          ctx.drawImage(bitmap,0,0);
        }finally{ctx.restore();}
      }
    }finally{bitmap.close();}
  }
}
