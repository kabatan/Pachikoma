import * as THREE from '../../web/vendor/three/three.module.js';

// Keep native pixel coordinates and MSAA. Only omit empty top rows of the
// sphere/tray framebuffer; viewport, projection, and fragment coordinates stay
// unchanged. A conservative projected geometry bound selects a retained target.
export function createBallTargetCrop(hr, full) {
  let enabled=new URLSearchParams(globalThis.location?.search??'').get('ballcrop')!=='0';
  // 10/30 表示実寸描画：球バッファが小さいときは同じ割合で（1440×2560 では従来の 768・1856 のまま）
  const targets=[768,1856].map(h=>Math.ceil(h*full.height/2560)).map(height=>{
    const t=full.clone();t.setSize(full.width,height);
    // 解決後の深度は読まないので色だけ解決する（?ballzskip=0 で従来）
    if(new URLSearchParams(globalThis.location?.search??'').get('ballzskip')!=='0')t.resolveDepthBuffer=false;
    hr.renderer.initRenderTarget(t);return t;
  });
  const world=new THREE.Matrix4(),clip=new THREE.Matrix4(),vp=new THREE.Matrix4(),instance=new THREE.Matrix4();
  const bounds=new WeakMap(),stats={frames:0,cropped:0,fullPixels:0,drawPixels:0,lastHeight:full.height,maxY:0};
  let maxY=0,unsupported=false;
  function bound(geometry,matrix) {
    const position=geometry.attributes.position;
    let rec=bounds.get(geometry);
    if(!rec||rec.position!==position||rec.version!==position.version){geometry.computeBoundingBox();rec={position,version:position.version,box:geometry.boundingBox};bounds.set(geometry,rec);}
    const box=rec.box,e=matrix.elements;
    if(!box){unsupported=true;return;}
    for(let i=0;i<8;i++){
      const x=i&1?box.max.x:box.min.x,y=i&2?box.max.y:box.min.y,z=i&4?box.max.z:box.min.z;
      const w=e[3]*x+e[7]*y+e[11]*z+e[15];
      if(!(w>0)){unsupported=true;return;}
      const sy=((e[1]*x+e[5]*y+e[9]*z+e[13])/w+1)*full.height*.5;
      if(!Number.isFinite(sy)){unsupported=true;return;}
      maxY=Math.max(maxY,sy);
    }
  }
  function visit(o){
    if(!o.isMesh)return;
    if(o.isSkinnedMesh||o.morphTargetInfluences?.length||!o.geometry?.attributes.position){unsupported=true;return;}
    if(o.isInstancedMesh){
      for(let i=0;i<o.count&&!unsupported;i++){
        o.getMatrixAt(i,instance);world.multiplyMatrices(o.matrixWorld,instance);clip.multiplyMatrices(vp,world);bound(o.geometry,clip);
      }
    }else{clip.multiplyMatrices(vp,o.matrixWorld);bound(o.geometry,clip);}
  }
  return {
    select(){
      stats.frames++;stats.fullPixels+=full.width*full.height;
      let target=full;
      if(enabled){
        maxY=0;unsupported=false;hr.sBalls.updateMatrixWorld(true);hr.camera.updateMatrixWorld(true);
        vp.multiplyMatrices(hr.camera.projectionMatrix,hr.camera.matrixWorldInverse);
        hr.sBalls.traverseVisible(visit);
        if(!unsupported)target=targets.find(t=>maxY+4<t.height)??full;
      }
      stats.maxY=maxY;stats.lastHeight=target.height;stats.drawPixels+=target.width*target.height;if(target!==full)stats.cropped++;
      return target;
    },
    setEnabled(on){enabled=!!on;},
    diagnostics(){return{enabled,...stats,heights:targets.map(t=>t.height),samples:full.samples};},
    dispose(){for(const t of targets)t.dispose();},
  };
}
