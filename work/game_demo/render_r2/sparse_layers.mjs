// Draw the original light shader only where a source can contribute nonzero RGB.
// Native texels, linear filtering, MSAA, draw order and float operations remain.
import * as THREE from '../web/vendor/three/three.module.js';

function correctionSupport(hr){
 const image=hr.r2Detail?.image,data=image?.data;
 if(!(data instanceof Uint16Array)||data.length!==image.width*image.height*4)return null;
 const width=image.width,height=image.height,stride=width+1,prefix=new Uint32Array(stride*(height+1));
 for(let y=0;y<height;y++){let row=0;for(let x=0;x<width;x++){row+=(data[(y*width+x)*4+1]&32767)!==0;prefix[(y+1)*stride+x+1]=prefix[y*stride+x+1]+row;}}
 return {prefix,width,height,stride};
}
function support(mapping,list,tile=32,detailMask=null){
  const e=mapping.entry,[w,h]=e.resolution,[bx,by,bw,bh]=e.bbox;
  const mask=new Uint8Array(w*h);
  for(const index of mapping.indices){
    const pixels=list[index].pixels;
    if(!pixels)return [[0,0,1,1]];
    const half=pixels instanceof Uint16Array;
    for(let i=0;i<mask.length;i++)if(!mask[i]){
      const k=i*4;
      if(half?((pixels[k]&32767)||(pixels[k+1]&32767)||(pixels[k+2]&32767)):(pixels[k]!==0||pixels[k+1]!==0||pixels[k+2]!==0))mask[i]=1;
    }
  }
  const stride=w+1,prefix=new Uint32Array(stride*(h+1));
  for(let y=0;y<h;y++){let sum=0;for(let x=0;x<w;x++){sum+=mask[y*w+x];prefix[(y+1)*stride+x+1]=prefix[y*stride+x+1]+sum;}}
  const rects=[],previous=new Map();let pixels=0;
  for(let y=0;y<bh;y+=tile){
    const y1=Math.min(bh,y+tile),sy0=Math.max(0,Math.floor(y/bh*h-.5)-1),sy1=Math.min(h,Math.ceil(y1/bh*h+.5)+1),runs=[];
    let begin=-1;
    for(let x=0;x<bw;x+=tile){
      const x1=Math.min(bw,x+tile),sx0=Math.max(0,Math.floor(x/bw*w-.5)-1),sx1=Math.min(w,Math.ceil(x1/bw*w+.5)+1);
      let n=prefix[sy1*stride+sx1]-prefix[sy0*stride+sx1]-prefix[sy1*stride+sx0]+prefix[sy0*stride+sx0];
      if(n&&detailMask){
       const d=detailMask,xlo=Math.max(0,Math.floor(bx+x)-1),xhi=Math.min(d.width,Math.ceil(bx+x1)+1),ylo=Math.max(0,Math.floor(by+y)-1),yhi=Math.min(d.height,Math.ceil(by+y1)+1),p=d.prefix,k=d.stride;
       n=xhi>xlo&&yhi>ylo?p[yhi*k+xhi]-p[ylo*k+xhi]-p[yhi*k+xlo]+p[ylo*k+xlo]:0;
      }
      if(n){pixels+=(x1-x)*(y1-y);if(begin<0)begin=x;}
      if(begin>=0&&(!n||x1===bw)){runs.push([begin,n?x1:x]);begin=-1;}
    }
    const next=new Map();
    for(const [x0,x1]of runs){
      const key=x0+':'+x1,old=previous.get(key);
      if(old!==undefined&&rects[old][3]===y/bh){rects[old][3]=y1/bh;next.set(key,old);}
      else{next.set(key,rects.length);rects.push([x0/bw,y/bh,x1/bw,y1/bh]);}
    }
    previous.clear();for(const [key,index]of next)previous.set(key,index);
  }
  rects.pixels=pixels;return rects;
}
const keyFor=(bbox,res)=>[...bbox,...res].join(',');
export function installSparseLayers(hr,{textureWeights=false,correctionMask=false}={}){
  const detailMask=correctionMask?correctionSupport(hr):null;
  const stats=hr.stats.sparseLayers={groups:0,rectangles:0,fullPixels:0,supportedPixels:0,drawInstances:0},records=[];
  stats.correctionMask=!!detailMask;
  const total=['back','front'].reduce((n,side)=>n+hr.layerBuckets[side].reduce((s,b)=>s+b.n,0),0);
  let table=null,nextOffset=0;
  if(textureWeights&&total>0&&total<=hr.gl.getParameter(hr.gl.MAX_TEXTURE_SIZE)){
    table=new THREE.DataTexture(new Float32Array(total*4),total,1,THREE.RGBAFormat,THREE.FloatType);table.minFilter=table.magFilter=THREE.NearestFilter;table.needsUpdate=true;
  }
  stats.textureWeights=!!table;stats.weightBytes=table?total*16:0;
  for(const side of ['back','front'])for(const b of hr.layerBuckets[side]){
    const originalWeightArray=b.geo.attributes.aW.array,weightOffset=nextOffset;nextOffset+=b.n;
    if(table){table.image.data.set(originalWeightArray,weightOffset*4);b.geo.attributes.aW.array=table.image.data.subarray(weightOffset*4,(weightOffset+b.n)*4);}

    const masks=new Map();let capacity=0;
    for(const m of b.mappings){
      const rects=support(m,b.list,32,detailMask);masks.set(keyFor(m.entry.bbox,m.entry.resolution),rects);capacity+=rects.length;
      stats.groups++;stats.rectangles+=rects.length;stats.fullPixels+=m.entry.bbox[2]*m.entry.bbox[3];stats.supportedPixels+=rects.pixels??m.entry.bbox[2]*m.entry.bbox[3];
    }
    const geo=new THREE.InstancedBufferGeometry();geo.setIndex(b.geo.index);geo.setAttribute('position',b.geo.attributes.position);
    for(const name of ['aRect','aTex','aW','aTile','aClip']){
      const a=new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1,capacity)*4),4);a.setUsage(THREE.DynamicDrawUsage);geo.setAttribute(name,a);
    }
    const meshes=[];
    for(const scene of [hr.sBack,hr.sFront])for(const mesh of scene.children)if(mesh.geometry===b.geo){
      const mat=mesh.material;
      if(!mat.vertexShader.includes('vec2 c = position.xy;')){geo.dispose();throw new Error('Sparse layer vertex contract changed');}
      mat.vertexShader='attribute vec4 aClip;\n'+mat.vertexShader.replace('vec2 c = position.xy;','vec2 c = mix(aClip.xy, aClip.zw, position.xy);');mat.needsUpdate=true;
      if(table){
        if(!mat.vertexShader.includes('vW = aW.rgb;'))throw new Error('Sparse weight shader changed');
        mat.vertexShader='uniform highp sampler2D uSparseWeights;uniform int uSparseOffset;\n'+mat.vertexShader.replace('vW = aW.rgb;','vW = texelFetch(uSparseWeights,ivec2(uSparseOffset+int(aW.w),0),0).rgb;');
        mat.uniforms.uSparseWeights={value:table};mat.uniforms.uSparseOffset={value:weightOffset};mat.needsUpdate=true;
      }
      mesh.geometry=geo;meshes.push(mesh);
    }
    records.push({b,geo,masks,meshes,versions:[],count:-1,originalWeightArray});
  }
  const update=hr._updateLayers.bind(hr);
  hr._updateLayers=()=>{
    update();stats.drawInstances=0;let weightDirty=false;
    for(const a of records){
      const {b,geo,masks}=a,n=b.geo.instanceCount,attributes=b.geo.attributes,names=['aRect','aTex','aW','aTile'];
      const layoutChanged=a.count!==n||[0,1,3].some(i=>a.versions[i]!==attributes[names[i]].version);
      const weightsChanged=layoutChanged||a.versions[2]!==attributes.aW.version;
      if(table){
        weightDirty||=a.versions[2]!==attributes.aW.version;
        if(!layoutChanged){a.versions[2]=attributes.aW.version;stats.drawInstances+=geo.instanceCount;continue;}
      }
      if(!weightsChanged){stats.drawInstances+=geo.instanceCount;continue;}
      if(layoutChanged)a.clips=[];
      const copyNames=layoutChanged?names:['aW'];
      let out=0;
      for(let i=0;i<n;i++){
        const j=i*4,r=attributes.aRect.array,t=attributes.aTex.array;
        if(layoutChanged)a.clips[i]=masks.get([r[j],r[j+1],r[j+2],r[j+3],t[j+1],t[j+2]].join(','))||[[0,0,1,1]];
        for(const clip of a.clips[i]){
          const offset=out++*4;
          if(offset+4>geo.attributes.aClip.array.length)throw new Error('Sparse layer capacity mismatch');
          for(const name of copyNames){
            const src=attributes[name].array,dst=geo.attributes[name].array;
            dst[offset]=src[j];dst[offset+1]=src[j+1];dst[offset+2]=src[j+2];dst[offset+3]=src[j+3];
          }
          if(table)geo.attributes.aW.array[offset+3]=i;
          if(layoutChanged)geo.attributes.aClip.array.set(clip,offset);
        }
      }
      geo.instanceCount=out;stats.drawInstances+=out;a.count=n;a.versions=names.map(name=>attributes[name].version);
      for(const name of layoutChanged?[...names,'aClip']:['aW']){
        const attr=geo.attributes[name];attr.clearUpdateRanges();attr.addUpdateRange(0,out*4);attr.needsUpdate=true;
      }
    }
    if(table&&weightDirty)table.needsUpdate=true;
  };
  const dispose=hr.dispose.bind(hr);
  hr.dispose=()=>{for(const a of records){if(table){a.originalWeightArray.set(a.b.geo.attributes.aW.array);a.b.geo.attributes.aW.array=a.originalWeightArray;}for(const mesh of a.meshes)mesh.geometry=a.b.geo;a.geo.dispose();}table?.dispose();dispose();};
}
