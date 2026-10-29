// Preserve every used native half-float bit. Alpha is not sampled; the copy
// channel is only sampled inside the existing, integer-aligned scissor.
import * as T from '../web/vendor/three/three.module.js';
export function splitDetailChannels(rgba,width,height,box){
 if(!(rgba instanceof Uint16Array)||rgba.length!==width*height*4)throw new Error('RGBA16 detail size mismatch');
 const rg=new Uint16Array(width*height*2);
 for(let i=0;i<width*height;i++){rg[i*2]=rgba[i*4];rg[i*2+1]=rgba[i*4+1];}
 const cropped=box?.length===4&&box.every(Number.isInteger)&&box[0]>=0&&box[1]>=0&&box[2]<=width&&box[3]<=height&&box[2]>box[0]&&box[3]>box[1];
 const [x0,y0,x1,y1]=cropped?box:[0,0,width,height],copyWidth=x1-x0,copyHeight=y1-y0,copy=new Uint16Array(copyWidth*copyHeight);
 for(let y=0;y<copyHeight;y++)for(let x=0;x<copyWidth;x++)copy[y*copyWidth+x]=rgba[((y+y0)*width+x+x0)*4+2];
 return {rg,copy,width,height,copyWidth,copyHeight,offset:[x0,y0],cropped};
}
export function createDetailChannels(rgba,width,height,box){
 const p=splitDetailChannels(rgba,width,height,box);
 const make=(data,w,h,format)=>{const t=new T.DataTexture(data,w,h,format,T.HalfFloatType);t.minFilter=t.magFilter=T.NearestFilter;t.unpackAlignment=1;t.needsUpdate=true;return t;};
 return {layer:make(p.rg,width,height,T.RGFormat),copy:make(p.copy,p.copyWidth,p.copyHeight,T.RedFormat),offset:p.offset,cropped:p.cropped,bytes:p.rg.byteLength+p.copy.byteLength};
}
