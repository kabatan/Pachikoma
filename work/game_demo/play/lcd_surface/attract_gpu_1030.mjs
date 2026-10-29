// One native video upload and panel draw per decoded frame, in the main context.
// Texture.update is intentionally empty: the surface's decoded-frame revision
// owns uploads, including seeks and browsers without requestVideoFrameCallback.
export function createAttractGpu({THREE:T,renderer:r,video,width,height}) {
  const texture=new T.Texture(video);
  texture.isVideoTexture=true;texture.update=()=>{};
  texture.colorSpace=T.NoColorSpace;texture.minFilter=texture.magFilter=T.LinearFilter;
  texture.generateMipmaps=false;texture.flipY=true;
  const target=new T.WebGLRenderTarget(width,height,{depthBuffer:false,stencilBuffer:false,generateMipmaps:false,minFilter:T.LinearFilter,magFilter:T.LinearFilter});
  const geometry=new T.PlaneGeometry(2,2),camera=new T.Camera(),scene=new T.Scene();
  const material=new T.ShaderMaterial({
    uniforms:{video:{value:texture},panel:{value:new T.Vector2(width,height)}},
    vertexShader:'varying vec2 q;void main(){q=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:'varying vec2 q;uniform sampler2D video;uniform vec2 panel;void main(){vec2 p=vec2(q.x,1.-q.y)*panel;vec2 s=(p-vec2(34.,28.))/vec2(1152.,1268.);vec3 c=vec3(0.);if(all(greaterThanEqual(s,vec2(0.)))&&all(lessThan(s,vec2(1.))))c=texture2D(video,vec2(s.x,1.-s.y)).rgb;gl_FragColor=vec4(c,1.);}',
    depthTest:false,depthWrite:false,blending:T.NoBlending,toneMapped:false,dithering:false
  });
  const mesh=new T.Mesh(geometry,material);mesh.frustumCulled=false;scene.add(mesh);
  let revision=-1,disposed=false;
  const stats={uploads:0,draws:0,reuses:0};
  return {
    compose(nextRevision){
      if(disposed||video.readyState<2)return null;
      if(nextRevision===revision){stats.reuses++;return target.texture;}
      if(r.getContext().isContextLost())return null;
      const old={target:r.getRenderTarget(),face:r.getActiveCubeFace(),level:r.getActiveMipmapLevel(),viewport:r.getViewport(new T.Vector4()),scissor:r.getScissor(new T.Vector4()),test:r.getScissorTest(),auto:r.autoClear};
      try {
        texture.needsUpdate=true;r.autoClear=false;r.setRenderTarget(target);r.setScissorTest(false);r.setViewport(0,0,width,height);r.render(scene,camera);
        revision=nextRevision;stats.uploads++;stats.draws++;return target.texture;
      } finally {r.setRenderTarget(old.target,old.face,old.level);r.setViewport(old.viewport);r.setScissor(old.scissor);r.setScissorTest(old.test);r.autoClear=old.auto;}
    },
    diagnostics:()=>({...stats,revision,targetBytes:width*height*4,disposed}),
    dispose(){if(disposed)return;disposed=true;texture.dispose();target.dispose();material.dispose();geometry.dispose();}
  };
}

// Local context only. Keep transforms/styles and every owner update intact.
// The hidden raw video canvas is retained for existing transition consumers.
export function suppressCanvasPaint(ctx) {
  let depth=0;const saved=[];const stats={skipped:0};
  for(const name of ['drawImage','fillRect','clearRect','strokeRect','fillText','strokeText','fill','stroke','putImageData']) {
    const descriptor=Object.getOwnPropertyDescriptor(ctx,name),original=ctx[name];
    if(typeof original!=='function')continue;
    const wrapper=function(...args){if(depth){stats.skipped++;return;}return original.apply(this,args);};
    ctx[name]=wrapper;saved.push({name,descriptor,original,wrapper});
  }
  return {stats,run(fn){depth++;try{return fn();}finally{depth--; }},dispose(){for(const s of saved)if(ctx[s.name]===s.wrapper){if(s.descriptor)Object.defineProperty(ctx,s.name,s.descriptor);else delete ctx[s.name];}}};
}
