// Reuse only identical float32 lighting coefficients. No temporal approximation.
import * as THREE from '../web/vendor/three/three.module.js';
import {N_PROBES,PROBE_T} from '../web/src/probes.mjs';

export function installProbeReuse(hr,{visibleOnly=false}={}) {
  const probes=hr.probes, original=probes.compose.bind(probes);
  const previous=new Float32Array(probes.maxBases*4);
  let length=-1, texture=null, version=-1,validMask=0;
  const stats=hr.stats.probeReuse={composed:0,reused:0,empty:0,rows:0};
  const restore=()=>{length=-1;validMask=0;},dispose=hr.dispose.bind(hr);
  hr.renderer.domElement.addEventListener('webglcontextrestored',restore);
  hr.dispose=()=>{hr.renderer.domElement.removeEventListener('webglcontextrestored',restore);dispose();};
  probes.compose=frame=>{
    // The current tray uses standard materials, not this sphere reflection atlas.
    if(hr.balls.count===0){stats.empty++;return probes.nActive;}
    const basis=probes.bases?.texture;
    if(!basis)return original(frame);
    let k=0, changed=basis!==texture || basis.version!==version;
    const component=value=>{const v=Math.fround(value);if(previous[k]!==v){previous[k]=v;changed=true;}k++;};
    const put=(r,g,b,layer)=>{component(r);component(g);component(b);component(layer);};
    const ea=frame.ea||[],eb=frame.eb||[];
    for(let r=0;r<8;r++){
      if(ea[r]>1e-6)put(ea[r],ea[r],ea[r],2*r);
      if(eb[r]>1e-6)put(eb[r],eb[r],eb[r],2*r+1);
    }
    for(const[id,layer]of probes.sourceIndex){const v=frame.q?.[id];if(!v)continue;const c=v.rgb||v;if(c[0]+c[1]+c[2]<1e-6)continue;put(c[0],c[1],c[2],layer);}
    changed ||= length!==k;
    length=k;texture=basis;version=basis.version;
    if(changed)validMask=0;
    let neededMask=(1<<N_PROBES)-1;
    const attributes=hr.balls.geometry.attributes;
    if(visibleOnly&&attributes.aR2PI&&attributes.aR2PW){
      neededMask=0;const ids=attributes.aR2PI.array,weights=attributes.aR2PW.array;
      for(let i=0;i<hr.balls.count*3;i++)if(weights[i]>0&&ids[i]>=0)neededMask|=1<<ids[i];
    }
    const fresh=neededMask&~validMask;
    if(!fresh){stats.reused++;return probes.nActive;}
    const renderer=hr.renderer,draw=renderer.render,saved=new THREE.Vector4(),savedTest=renderer.getScissorTest();renderer.getScissor(saved);
    if(visibleOnly)renderer.render=function(scene,camera){
      if(scene!==probes.sCompose)return draw.call(this,scene,camera);
      for(let first=0;first<N_PROBES;first++)if(fresh&(1<<first)){
        let end=first+1;while(end<N_PROBES&&(fresh&(1<<end)))end++;
        this.setScissor(0,first*PROBE_T,probes.W,(end-first)*PROBE_T);this.setScissorTest(true);draw.call(this,scene,camera);stats.rows+=end-first;first=end-1;
      }
    };
    try{stats.composed++;const result=original(frame);validMask|=fresh;return result;}
    finally{renderer.render=draw;if(visibleOnly){renderer.setScissor(saved);renderer.setScissorTest(savedTest);}}
  };
}

