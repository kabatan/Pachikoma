// Same VideoTexture sampling contract, with explicit callback ownership.
// Suspend only notifications: never pause, seek, reload or retime the source video.
export function createVisibleVideoTexture(THREE,video,stats){
 const texture=new THREE.Texture(video);texture.isVideoTexture=true;texture.generateMipmaps=false;
 let active=false,disposed=false,callbackId=null;
 const schedule=()=>{if(active&&!disposed&&callbackId===null&&video.requestVideoFrameCallback)callbackId=video.requestVideoFrameCallback(tick);};
 const tick=()=>{callbackId=null;if(!active||disposed)return;stats.callbacks++;texture.needsUpdate=true;schedule();};
 texture.resumeFrames=()=>{if(disposed||active)return;active=true;stats.resumes++;texture.needsUpdate=true;schedule();};
 texture.suspendFrames=()=>{if(!active)return;active=false;stats.suspends++;if(callbackId!==null)video.cancelVideoFrameCallback(callbackId);callbackId=null;};
 Object.defineProperty(texture,'framesActive',{get:()=>active});
 texture.update=()=>{if(active&&!video.requestVideoFrameCallback&&video.readyState>=video.HAVE_CURRENT_DATA)texture.needsUpdate=true;};
 texture.dispose=()=>{if(disposed)return;texture.suspendFrames();disposed=true;THREE.Texture.prototype.dispose.call(texture);};
 texture.resumeFrames();return texture;
}
