// Index only vertices whose complete per-vertex inputs have identical bits.
// Preserve primitive order and every instance attribute; no mesh simplification.
import * as T from '../web/vendor/three/three.module.js';
export function installIndexedBalls(hr){
 const original=hr.balls.geometry,position=original.attributes.position;
 if(original.index||!position||Object.keys(original.morphAttributes).length)return;
 const attrs=Object.entries(original.attributes).filter(([,a])=>!a.isInstancedBufferAttribute);
 if(attrs.some(([,a])=>a.isInterleavedBufferAttribute||!(a.array instanceof Float32Array)||a.count!==position.count))return;
 // Vertex IDs must not be an additional shader input when remapping indices.
 if(/\bgl_VertexID\b/.test(hr.ballMat.vertexShader))return;
 const views=attrs.map(([,a])=>new Uint32Array(a.array.buffer,a.array.byteOffset,a.array.length));
 const first=[],map=new Map(),indices=new Uint32Array(position.count);
 for(let i=0;i<position.count;i++){
  const key=[];for(let k=0;k<attrs.length;k++){const size=attrs[k][1].itemSize;for(let c=0;c<size;c++)key.push(views[k][i*size+c]);}
  const encoded=key.join(',');let index=map.get(encoded);
  if(index===undefined){index=first.length;map.set(encoded,index);first.push(i);}indices[i]=index;
 }
 if(first.length>=position.count)return;
 const next=new T.BufferGeometry();
 for(const [name,a]of Object.entries(original.attributes)){
  if(a.isInstancedBufferAttribute){next.setAttribute(name,a);continue;}
  const values=new Float32Array(first.length*a.itemSize),bits=new Uint32Array(values.buffer),old=new Uint32Array(a.array.buffer,a.array.byteOffset,a.array.length);
  for(let i=0;i<first.length;i++)for(let c=0;c<a.itemSize;c++)bits[i*a.itemSize+c]=old[first[i]*a.itemSize+c];
  const attribute=new T.BufferAttribute(values,a.itemSize,a.normalized);attribute.setUsage(a.usage);attribute.gpuType=a.gpuType;attribute.name=a.name;next.setAttribute(name,attribute);
 }
 next.setIndex(new T.BufferAttribute(first.length<=65536?new Uint16Array(indices):indices,1));
 next.boundingBox=original.boundingBox;next.boundingSphere=original.boundingSphere;
 next.groups=original.groups.map(group=>({...group}));next.setDrawRange(original.drawRange.start,original.drawRange.count);
 hr.balls.geometry=next;hr.stats.indexedBalls={before:position.count,after:first.length,triangles:indices.length/3,allVertexAttributesBitIdentical:true};
 const dispose=hr.dispose.bind(hr);hr.dispose=()=>{hr.balls.geometry=original;next.dispose();dispose();};
}
