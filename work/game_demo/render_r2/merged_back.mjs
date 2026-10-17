// Background vertex shaders already produce clip-space coordinates. They can
// precede the real geometry in one scene/camera, with one identical MSAA resolve.
// The first resolve was unused: probes and spheres never sample rtMain.
import * as THREE from '../web/vendor/three/three.module.js';
export function installMergedBack(hr){
  const r=hr.renderer,draw=r.render.bind(r),render=hr.render.bind(hr);
  const merged=new THREE.Scene(),back=new THREE.Group();back.renderOrder=-100;
  back.add(hr.sBack);merged.add(back,hr.sBalls);
  const stats=hr.stats.mergedBack={merged:0,standalone:0,samples:hr.rtMain.samples};
  let active=false,prepared=false;
  const wrapper=function(scene,camera){
    if(!active)return draw(scene,camera);
    if(scene===hr.sBack){
      if(hr.balls.count>0||hr.trayVisual){prepared=true;return;}
      stats.standalone++;return draw(scene,camera);
    }
    if(scene===hr.sBalls&&prepared){prepared=false;stats.merged++;return draw(merged,camera);}
    return draw(scene,camera);
  };
  r.render=wrapper;
  hr.render=()=>{active=true;prepared=false;try{return render();}finally{active=false;prepared=false;}};
  const dispose=hr.dispose.bind(hr);
  hr.dispose=()=>{if(r.render===wrapper)r.render=draw;back.remove(hr.sBack);merged.remove(hr.sBalls);dispose();};
}
