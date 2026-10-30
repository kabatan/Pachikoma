// 実際の衝突メッシュを描画する接続。傾斜/壁/穴/フラップの別定義を作らない。
import * as THREE from '../web/vendor/three/three.module.js';
import { trayFloor } from './tray_geometry.mjs';
export function attachTrayVisual(hr, pa) {
  if(hr.trayVisualHandle)return hr.trayVisualHandle;
  const tray=pa.tray, group=new THREE.Group(), material=new THREE.MeshStandardMaterial({color:0x10151c,metalness:.35,roughness:.36,side:THREE.DoubleSide});
  const guardMaterial=new THREE.MeshStandardMaterial({color:0x7c9bb8,metalness:.05,roughness:.15,transparent:true,opacity:.035,depthWrite:false,side:THREE.DoubleSide});
  const make=(vertices,indices,mat=material)=>{const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setIndex(indices);geo.computeVertexNormals();const m=new THREE.Mesh(geo,mat);m.frustumCulled=false;group.add(m);return m;};
  const vertices=[];
  for(let i=0;i<tray.floorMesh.vertices.length;i+=3){const p=tray.floorMesh.vertices.slice(i,i+3).map((v,k)=>v/tray.S-tray.T[k]);vertices.push(...pa.transforms.point('stage1',p));}
  make(vertices,tray.floorMesh.indices);
  // 床下の機構は筐体の中。接触壁の床より上だけを透明な返し縁として可視化する。
  for(const src of tray.visualStatics){
    // 払出トンネルは筐体内。開口の敷居・まぐさはpackのVIS_TRAY_BACKに含まれる。
    // 衝突用凸包を黒い前景として二重描画しない。
    if(src.id.startsWith('COL_PAYOUT_'))continue;
    const vv=[],ii=[],bottom=[],bi=[];
    for(let k=0;k<src.indices.length;k+=3){
      const poly=src.indices.slice(k,k+3).map(i=>src.vertices.slice(i*3,i*3+3).map((v,j)=>v-tray.T[j]));
      const out=[];
      for(let i=0;i<3;i++){const a=poly[i],b=poly[(i+1)%3],da=a[1]-trayFloor(a[0],a[2]),db=b[1]-trayFloor(b[0],b[2]);if(da>=-.0001)out.push(a);if((da>=0)!==(db>=0)){const t=da/(da-db);out.push(a.map((v,j)=>v+(b[j]-v)*t));}}
      if(src.id.startsWith('COL_TRAY')){
        const under=[];for(let i=0;i<3;i++){const a=poly[i],b=poly[(i+1)%3],da=a[1]-trayFloor(a[0],a[2]),db=b[1]-trayFloor(b[0],b[2]);if(da<=0)under.push(a);if((da<=0)!==(db<=0)){const t=da/(da-db);under.push(a.map((v,j)=>v+(b[j]-v)*t));}}
        const base=bottom.length/3;for(const p of under)bottom.push(...pa.transforms.point('stage1',p));for(let j=1;j<under.length-1;j++)bi.push(base,base+j,base+j+1);
      }
      if(out.length<3)continue;const base=vv.length/3;for(const p of out)vv.push(...pa.transforms.point('stage1',p));for(let j=1;j<out.length-1;j++)ii.push(base,base+j,base+j+1);
    }
    make(vv,ii,src.id.startsWith('COL_PAYOUT')?material:guardMaterial);
    if(bottom.length)make(bottom,bi);
  }
  // 静的部品を材質ごとにまとめる。多数の凸片をそのままdraw callへ増やさない。
  for(const mat of [material,guardMaterial]){
    const meshes=group.children.filter(m=>m.isMesh&&m.material===mat),vv=[],ii=[];
    for(const mesh of meshes){const a=mesh.geometry.attributes.position.array,base=vv.length/3;vv.push(...a);ii.push(...Array.from(mesh.geometry.index.array,i=>i+base));group.remove(mesh);mesh.geometry.dispose();}
    // 管の除外でboundsが変わっても、床と同面の可動蓋の描画順は従来どおり保つ。
    if(vv.length){const mesh=make(vv,ii,mat);if(mat===material)mesh.renderOrder=1;}
  }
  // 透明×両面は three が毎フレーム side を裏→表に替えて needsUpdate し、シェーダ選び直し(getProgram)が2回走る。
  // 裏面用・表面用の材質を別メッシュにして同じ順(裏→表)で描く。画は同一。?traysplit=0 で従来。
  const splitMats=[];
  if(new URLSearchParams(globalThis.location?.search??'').get('traysplit')!=='0'){
    for(const mesh of group.children.filter(m=>m.isMesh&&m.material===guardMaterial)){
      const back=guardMaterial.clone(),front=guardMaterial.clone();back.side=THREE.BackSide;front.side=THREE.FrontSide;splitMats.push(back,front);
      mesh.material=back;const twin=new THREE.Mesh(mesh.geometry,front);twin.frustumCulled=mesh.frustumCulled;twin.renderOrder=mesh.renderOrder;
      twin.position.copy(mesh.position);twin.quaternion.copy(mesh.quaternion);twin.scale.copy(mesh.scale);group.add(twin);
    }
  }
  const moving=[];
  for(const src of tray.visualMechs){
    if(!['MECH_OVF_FLAP','MECH_CNT_FLAP'].includes(src.id))continue;
    const mesh=make(src.vertices,src.indices);moving.push({mesh,id:src.id});
  }
  const ambient=new THREE.HemisphereLight(0xcbdcff,0x10121c,1.4),key=new THREE.DirectionalLight(0xfff6e9,3.5);key.position.set(-.2,.5,.7);group.add(ambient,key);
  hr.sBalls.add(group);
  const update=()=>{
    for(const {mesh,id}of moving){const body=tray.mechBodies.get(id).body,t=body.translation(),r=body.rotation();
      const pos=pa.transforms.point('stage1',[t.x/tray.S-tray.T[0],t.y/tray.S-tray.T[1],t.z/tray.S-tray.T[2]]);
      mesh.position.set(...pos);
      const a=pa.transforms.get('stage1').rotation,m=new THREE.Matrix4();m.set(a[0][0],a[0][1],a[0][2],0,a[1][0],a[1][1],a[1][2],0,a[2][0],a[2][1],a[2][2],0,0,0,0,1);
      mesh.quaternion.setFromRotationMatrix(m).multiply(new THREE.Quaternion(r.x,r.y,r.z,r.w));
    }
  };
  const originalRender=hr.render;hr.render=function(...args){update();return originalRender.apply(this,args);};
  hr.trayVisual=true;
  // 筒内の玉は物理・台帳には残す。実際の出口センサーを通るまで筐体内なので表示しない。
  let visiblePositions;
  const visibleBalls=data=>{
    if(!tray.activePayout||!data.ids)return data;
    visiblePositions??=new Float32Array(pa.maxBalls*3);let count=0;
    for(let i=0;i<data.count;i++){
      if(tray.activeBalls.get(data.ids[i])?.state==='payout')continue;
      const dst=count++*3,src=i*3;
      for(let j=0;j<3;j++)visiblePositions[dst+j]=data.positions[src+j];
    }
    return {count,positions:visiblePositions};
  };
  update();const handle={group,update,visibleBalls,dispose(){hr.render=originalRender;hr.trayVisual=false;hr.trayVisualHandle=null;hr.sBalls.remove(group);for(const m of group.children)m.geometry?.dispose();material.dispose();guardMaterial.dispose();for(const m of splitMats)m.dispose();}};
  hr.trayVisualHandle=handle;return handle;
}
