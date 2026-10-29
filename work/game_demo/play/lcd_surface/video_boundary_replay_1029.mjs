// Perf-only boundary replay. Retains the same decoded source frame, not GL pixels.
// VideoFrame resource references are bounded to two committed sources (+2 while
// replacing them). No decoder, seek, playback, readPixels, or copyTo is used.
import {drawClipSnapshot} from './clip_player.mjs';

const W=1152,H=1268,PW=1240,PH=1510,PX=34,PY=28;
const makeCanvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;c.readyState=4;return c;};
function restored(ctx,fn){ctx.save();try{ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.filter='none';return fn();}finally{ctx.restore();}}

export function createVideoBoundaryReplay({makeFrame=v=>new VideoFrame(v),now=()=>performance.now()}={}){
 let disposed=false,completed=null,sequence=0,raw=null,panel=null;
 const rawDest=new WeakMap(),panelDest=new WeakMap(),staged=new Set();
 const stats={stages:0,commits:0,framesCreated:0,framesClosed:0,liveFrames:0,maxLiveFrames:0,stageMs:0,stageMaxMs:0,rawReplays:0,panelReplays:0,hits:0,materializations:0,replayMs:0,replayMaxMs:0,failures:[]};
 const live=()=>{if(disposed)throw Error('Boundary replay disposed');};
 const close=entry=>{if(entry.closed)return;entry.closed=true;for(const layer of entry.layers){layer.video.close();stats.framesClosed++;stats.liveFrames--;}};
 function stage(snapshot){
  live();const at=now(),entry={layers:[],closed:false,overlay:null,revision:null};
  try{
   if(!snapshot||!Array.isArray(snapshot.layers)||snapshot.layers.length<1||snapshot.layers.length>2||snapshot.layers[0].alpha!==1)throw Error('Replay needs one or two ordered opaque video layers');
   if(snapshot.overlay&&typeof snapshot.overlay.replay!=='function')throw Error('Completed overlay needs immutable 2D replay recipe');
   for(const layer of snapshot.layers){
    const v=layer.video;if(!v||v.readyState<2||v.seeking||v.videoWidth!==W||v.videoHeight!==H||!Number.isFinite(layer.alpha)||layer.alpha<0||layer.alpha>1)throw Error('Replay source not ready native video');
    const frame=makeFrame(v);entry.layers.push({...layer,video:frame});stats.framesCreated++;stats.liveFrames++;stats.maxLiveFrames=Math.max(stats.maxLiveFrames,stats.liveFrames);
    if(frame.displayWidth!==W||frame.displayHeight!==H)throw Error('Retained frame changed native dimensions');
   }
   entry.overlay=snapshot.overlay?.replay??null;staged.add(entry);stats.stages++;
   let settled=false;
   return {
    commit(){live();if(settled)throw Error('Replay stage already settled');settled=true;staged.delete(entry);entry.revision=++sequence;const previous=completed;completed=entry;stats.commits++;if(previous)close(previous);return entry.revision;},
    discard(){if(settled)return;settled=true;staged.delete(entry);close(entry);}
   };
  }catch(e){close(entry);stats.failures.push({phase:'stage',message:String(e.message??e)});throw e;}
  finally{const ms=now()-at;stats.stageMs+=ms;stats.stageMaxMs=Math.max(stats.stageMaxMs,ms);}
 }
 function drawRaw(ctx,privateCache=false){
  if(privateCache&&rawDest.get(ctx)===completed.revision){stats.hits++;return ctx.canvas;}
  restored(ctx,()=>drawClipSnapshot(completed,ctx,W,H));if(privateCache)rawDest.set(ctx,completed.revision);stats.rawReplays++;return ctx.canvas;
 }
 function rawCanvas(){live();if(!completed)return null;raw??=makeCanvas(W,H);drawRaw(raw.getContext('2d',{alpha:false}),true);return raw;}
 function materializeTo({heldCtx=null,panelCtx=null,flash={alpha:0,color:'miss'}}={}){
  live();if(!completed)return null;const at=now();stats.materializations++;
  try{
   const source=heldCtx?drawRaw(heldCtx):rawCanvas();
   if(panelCtx){
    const key=completed.revision+':'+flash.alpha+':'+flash.color;
    const privateCache=panelCtx.canvas===panel;
    if(!privateCache||panelDest.get(panelCtx)!==key){
     restored(panelCtx,()=>{
      panelCtx.fillStyle='#000';panelCtx.fillRect(0,0,PW,PH);
      panelCtx.translate(PX,PY);panelCtx.drawImage(source,0,0);
      completed.overlay?.(panelCtx);
      if(flash.alpha>0){panelCtx.globalAlpha=flash.alpha;panelCtx.fillStyle=flash.color==='hit'?'#fff':'#736099';panelCtx.fillRect(0,0,W,H);panelCtx.globalAlpha=1;}
     });if(privateCache)panelDest.set(panelCtx,key);stats.panelReplays++;
    }else stats.hits++;
   }
   return source;
  }catch(e){stats.failures.push({phase:'replay',message:String(e.message??e)});return null;}
  finally{const ms=now()-at;stats.replayMs+=ms;stats.replayMaxMs=Math.max(stats.replayMaxMs,ms);}
 }
 return {stage,rawCanvas,materializeTo,
  cleanPanel(flash){live();panel??=makeCanvas(PW,PH);return materializeTo({panelCtx:panel.getContext('2d',{alpha:false}),flash})?panel:null;},
  diagnostics(){return {...stats,failures:stats.failures.map(x=>({...x})),completedRevision:completed?.revision??null,committedFrames:completed?.layers.length??0,pendingStages:staged.size,disposed,readPixelsCalls:0,copyToCalls:0};},
  dispose(){if(disposed)return;disposed=true;for(const entry of staged)close(entry);staged.clear();if(completed)close(completed);completed=null;raw=panel=null;}
 };
}
