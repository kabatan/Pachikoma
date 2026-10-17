// 皿の表示と接触に共用する設計座標(m)。横向き重力の代わりに実際の床を傾ける。
export const TRAY_GEOMETRY = Object.freeze({ revision: 'r2-s2-plane-8', floorLeft: -.264, left: -.170, back: -.137, slopeX: .05, slopeZ: -.025 });
export const COUNT_PORT = Object.freeze({ x: [-.173,-.125], z: [-.136,-.077], rear: -.160 });
export function trayFloor(x, z) {
  const g = TRAY_GEOMETRY; return g.floorLeft + g.slopeX * (x - g.left) + g.slopeZ * (z - g.back);
}
// 既存exportの床(部品原点/管/センサーも同じ変位で接続する)。
export function exportedFloor(x, z, f) {
  x *= 1000; z *= 1000;
  const d=x-f.XL, xs=f.ramp_x, hs=f.ramp_h;
  let r=hs[0];
  if(d>=xs.at(-1))r=hs.at(-1);
  else for(let i=0;i<xs.length-1;i++)if(d>=xs[i]&&d<=xs[i+1]){r=hs[i]+(hs[i+1]-hs[i])*(d-xs[i])/(xs[i+1]-xs[i]);break;}
  const clamp=(v)=>Math.max(0,Math.min(1,v)),w=f.wave,b=f.bowl;
  const wave=w.A*clamp((x-w.fade_x[0])/(w.fade_x[1]-w.fade_x[0]))*Math.sin(Math.PI*clamp((z-f.ZB)/(f.ZF-f.ZB)))*Math.sin(2*Math.PI*(x-f.XL)/w.LX+w.PH)*Math.cos(2*Math.PI*(z-f.ZB)/w.LZ);
  const bowl=b?.D?-b.D*Math.exp(-.5*(((x-b.xc)/b.sx)**2+((z-b.zc)/b.sz)**2)):0;
  return (f.F0+r+f.front_raise*(z-f.z_ref)/(f.ZF-f.ZB)+wave+bowl)/1000;
}
export function trayPoint(p,f) { return [p[0],p[1]+trayFloor(p[0],p[2])-exportedFloor(p[0],p[2],f),p[2]]; }
export function parseObjMeshes(text) {
  const out=new Map();let cur,offset=0,total=0;
  for(const line of text.split('\n')){
    if(line.startsWith('o ')){offset=total;cur={vertices:[],indices:[]};out.set(line.slice(2).trim(),cur);}
    else if(line.startsWith('v ')){cur.vertices.push(...line.slice(2).trim().split(/\s+/).map(Number));total++;}
    else if(line.startsWith('f ')){const ids=line.slice(2).trim().split(/\s+/).map(s=>Number(s.split('/')[0])-1-offset);for(let i=1;i<ids.length-1;i++)cur.indices.push(ids[0],ids[i],ids[i+1]);}
  }
  return out;
}
// 三角形から矩形の穴をくり抜く。接触と表示が同じインデックスを使う。
export function outsideRect(poly, rect) {
  const pieces=[];let rest=poly;
  for(const [axis,bound,sign]of [[0,rect.x[0],1],[0,rect.x[1],-1],[2,rect.z[0],1],[2,rect.z[1],-1]]){
    const clip=(inside)=>{const out=[];for(let i=0;i<rest.length;i++){const a=rest[i],b=rest[(i+1)%rest.length],da=(a[axis]-bound)*sign,db=(b[axis]-bound)*sign,ia=inside?da>=0:da<=0,ib=inside?db>=0:db<=0;if(ia)out.push(a);if(ia!==ib){const t=da/(da-db);out.push(a.map((v,k)=>v+(b[k]-v)*t));}}return out;};
    const exterior=clip(false);if(exterior.length>=3)pieces.push(exterior);rest=clip(true);if(rest.length<3)break;
  }
  return pieces;
}
