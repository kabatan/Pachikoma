// Public renderer state only. Scope deliberately requires the default-target
// frame boundary; arbitrary caller FBO/viewport overrides are not accepted.
export function createGlSegment({THREE,renderer,getVao=()=>null,getBuffer=()=>null}){
 const gl=renderer.getContext();let depth=0;
 const stats={segments:0,nested:0,thenableRejected:0,active:0,maxActive:0};
 function run(label,fn){
  if(depth){stats.nested++;return fn();}
  if(renderer.getRenderTarget()!==null)throw Error('Injected result requires default-target frame boundary: '+label);
  if(gl.isContextLost?.())throw Error('Main GL context is lost');
  const state={viewport:renderer.getViewport(new THREE.Vector4()),scissor:renderer.getScissor(new THREE.Vector4()),scissorTest:renderer.getScissorTest(),color:renderer.getClearColor(new THREE.Color()),alpha:renderer.getClearAlpha(),face:renderer.getActiveCubeFace(),level:renderer.getActiveMipmapLevel(),autoClear:renderer.autoClear,autoClearColor:renderer.autoClearColor,autoClearDepth:renderer.autoClearDepth,autoClearStencil:renderer.autoClearStencil};
  depth=1;stats.segments++;stats.active=1;stats.maxActive=1;
  try{
   renderer.resetState();renderer.autoClear=false;
   for(const k of [gl.BLEND,gl.SCISSOR_TEST,gl.DEPTH_TEST,gl.STENCIL_TEST,gl.CULL_FACE,gl.RASTERIZER_DISCARD])gl.disable(k);
   gl.enable(gl.DITHER);gl.colorMask(true,true,true,true);gl.blendEquation(gl.FUNC_ADD);
   gl.bindVertexArray(getVao());gl.bindBuffer(gl.ARRAY_BUFFER,getBuffer());
   gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);gl.activeTexture(gl.TEXTURE0);
   for(const [k,v] of [[gl.UNPACK_ALIGNMENT,4],[gl.PACK_ALIGNMENT,4],[gl.PACK_ROW_LENGTH,0],[gl.PACK_SKIP_ROWS,0],[gl.PACK_SKIP_PIXELS,0],[gl.UNPACK_FLIP_Y_WEBGL,false],[gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false],[gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.BROWSER_DEFAULT_WEBGL],[gl.UNPACK_ROW_LENGTH,0],[gl.UNPACK_IMAGE_HEIGHT,0],[gl.UNPACK_SKIP_ROWS,0],[gl.UNPACK_SKIP_PIXELS,0],[gl.UNPACK_SKIP_IMAGES,0]])gl.pixelStorei(k,v);
   const value=fn();if(value&&typeof value.then==='function'){stats.thenableRejected++;throw Error('A raw GL segment must not return a Promise: '+label);}return value;
  }finally{
   depth=0;stats.active=0;
   // Invalidate Three's program/VAO/texture/framebuffer binding caches after raw
   // calls, then restore its public default-target state before yielding JS.
   renderer.resetState();renderer.setRenderTarget(null,state.face,state.level);
   renderer.setViewport(state.viewport);renderer.setScissor(state.scissor);renderer.setScissorTest(state.scissorTest);renderer.setClearColor(state.color,state.alpha);
   for(const key of ['autoClear','autoClearColor','autoClearDepth','autoClearStencil'])renderer[key]=state[key];
  }
 }
 return {run,diagnostics:()=>({...stats}),get active(){return depth>0;}};
}

export function createThreeOutput({THREE,renderer,width=1152,height=1268,segment}){
 const gl=renderer.getContext(),target=new THREE.WebGLRenderTarget(width,height,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,generateMipmaps:false,depthBuffer:false,stencilBuffer:false,samples:0,colorSpace:THREE.NoColorSpace});
 target.texture.name='jp-result-injected-native';target.texture.flipY=false;target.texture.generateMipmaps=false;
 let framebuffer;
 try{framebuffer=segment.run('observe-Three-output-FBO',()=>{
  renderer.setRenderTarget(target);
  const f=gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);if(!f)throw Error('Three output framebuffer unavailable');
  gl.viewport(0,0,width,height);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);return f;
 });}catch(error){target.dispose();throw error;}
 return {target,texture:target.texture,framebuffer,width,height,
  readPixels(){return segment.run('comparison-or-boundary-readback',()=>{const bytes=new Uint8Array(width*height*4);gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return {bytes,width,height,origin:'bottom-left',format:'RGBA8'};});},
  dispose(){target.dispose();}
 };
}
