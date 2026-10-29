// Cache only complete, opaque video compositions. History accumulation keeps
// its own path: applying translucent pixels repeatedly is not interchangeable.
export function createVideoDrawCache(enabled=new URLSearchParams(globalThis.location?.search??'').get('videoreuse')!=='0'){
 let body=null,panel=null;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 function bodyKey(snapshot,layers,textures,revision){
  if(!enabled)return null;
  const o=snapshot.overlay;
  // Without an owner revision a mutable Canvas must be uploaded every call.
  if(o&&(!Number.isSafeInteger(o.revision)||o.revision<0))return null;
  const key=[revision,snapshot.owner,snapshot.generation??0,layers.length];
  for(let i=0;i<layers.length;i++){
   const l=layers[i],v=l.video,t=textures[i];
   key.push(v,t,t.version,l.alpha,l.generation??snapshot.generation??0,l.src??v.currentSrc,v.src,v.videoWidth,v.videoHeight);
   // THREE.VideoTexture increments version from requestVideoFrameCallback.
   // Its older-browser fallback is conservative: reuse only a frozen clock.
   key.push(typeof v.requestVideoFrameCallback==='function'?null:v.currentTime);
  }
  if(o)key.push(o.canvas,o.revision,o.x,o.y,o.width,o.height,o.blend);
  else key.push(null);
  return key;
 }
 return {
  enabled,
  sameBody(snapshot,layers,textures,revision){return same(body,bodyKey(snapshot,layers,textures,revision));},
  commitBody(snapshot,layers,textures,revision){body=bodyKey(snapshot,layers,textures,revision);},
  samePanel(key){return enabled&&same(panel,key);},
  commitPanel(key){panel=key;}
 };
}
