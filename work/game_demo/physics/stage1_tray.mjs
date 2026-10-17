import { TRAY_GEOMETRY, COUNT_PORT, outsideRect, exportedFloor, trayFloor, trayPoint, parseObjMeshes } from './tray_geometry.mjs';
import { TrayRollingResistance } from './tray_rolling.mjs';
// 皿ユニット(stage1)の Rapier 変換。入力は work/cabinet/stage1/export/{parts.json, col_all.obj}（読むだけ）。
//  - 静的衝突: parts.json の role=collision のうち親が TRAY_UNIT のもの → col_all.obj の凸包(単位m・設計座標) + 根の移動 = 世界座標
//  - 可動部: 親が MECH_* の衝突 → kinematic 剛体(凸包は部品原点=mech.origin_m の局所座標。体は origin+根の移動に置く)。ヒンジ(range_deg)/スライダ(stroke)を setMech で動かす
//  - センサー: parts.json の sensors(plane)を球中心の線分交差で判定。球IDごとに1回ラッチ(逆向きは別記録)
//  - 払出: PATH_PAYOUT の中心線の始点から1球ずつ落とす（トンネルの衝突を通る）
//  - 溢れ: 溢れ口の蓋(MECH_OVF_FLAP)の開閉方針を差し替え可能(下記)。蓋が開いて穴に落ち、収納入口センサーを通った玉が「溢れた」玉
//  - 再読込: reload() はファイルの SHA256 が変わったときだけ静的部を全部作り直す(玉の剛体は残す)。son11 の更新に追従する。
// 単位 m・kg・s。玉: 半径6mm、摩擦.25/反発.35（parts.json の physics）。world.lengthUnit は 0.01 にすること(盤の試験で判明)。
// Web Crypto は loopback Chromium と Node の両方で使える。
async function geometryHash(text) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

const mul = (q, v) => { // クォータニオン(x,y,z,w)でベクトルを回す
  const { x, y, z, w } = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
};
const axisQuat = (axis, rad) => { const n = Math.hypot(...axis), s = Math.sin(rad / 2) / n; return { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: Math.cos(rad / 2) }; };

export function parseObj(text) {
  const objs = new Map(); let cur = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('o ')) { cur = line.slice(2).trim(); objs.set(cur, []); }
    else if (line.startsWith('v ') && cur) { const [, a, b, c] = line.trim().split(/\s+/); objs.get(cur).push(+a, +b, +c); }
  }
  return objs;
}

/** 溢れ蓋の方針。
 *  count: 皿の球数(途中の球を含む)が n 以上で開く(stage1 の元の方針。n 既定 50)。n は規則ではなく試験用の仮値。
 *  reach: 溢れ口付近の球が床上17mmへ届いたら開く。0.8秒の保持と球半径を含む安全インターロック（個数で決めない）。
 *  open:  常に開く(試験用)   closed: 常に閉じる(試験用) */
export const OVERFLOW_POLICIES = ['count', 'reach', 'open', 'closed', 'mouth'];

// 実床の勾配。重力は垂直のまま。
export const TRAY_MOTION = Object.freeze({ tilt: 0, rollingResistance: 0.006, variability: 0.15 });

export class Stage1Tray {
  constructor(RAPIER, world, { readText, base = '', overflow = { type: 'open' }, rng = Math.random, scale = 10, RollingResistance = null, translation_m = null, debugHistory = false } = {}) {
    this.RollingResistanceClass = RollingResistance; this.rr = null; this.payoutActive = false; this.countOpen = false; this.countEmptySince = null; this.blockSince = null; this.idleSince = null; this.ovfWant = false;
    this.translationOverride = translation_m; this.debugHistory = debugHistory; this.activeBalls = new Map(); this.activePayout = 0;
    this.tilt = TRAY_MOTION.tilt;
    world.numSolverIterations = 4;
    this.S = scale; // 物理空間の倍率(m→物理単位)。Rapier の凸包は mm 級の形をメートルで作ると玉との接触が壊れる(素通り・横滑り)ため、10倍にして使う。world の重力と lengthUnit も同倍率にすること
    this.R = RAPIER; this.world = world; this.readText = readText; this.base = base; this.overflow = overflow; this.rng = rng; this._rawVelocity = { x: 0, y: 0, z: 0 };
    this.statics = []; this.mechBodies = new Map(); this.balls = new Map(); this.events = []; this.hash = null;
    this.mech = {}; this.sensors = []; this.latched = new Map(); this.tick = 0; this.nextBall = 0;
    this.stored = { overflow: 0, count: 0 }; this.payoutExited = 0;
  }
  async load() { return this.reload(true); }
  /** @returns {Promise<boolean>} 作り直したか */
  async reload(force = false) {
    const [pj, obj] = await Promise.all([this.readText(this.base + 'parts.json'), this.readText(this.base + 'col_all.obj')]);
    const hash = await geometryHash(pj + obj + JSON.stringify(TRAY_GEOMETRY));
    if (!force && hash === this.hash) return false;
    for (const c of this.statics) this.world.removeCollider(c, false);
    for (const b of this.mechBodies.values()) this.world.removeRigidBody(b.body);
    this.statics = []; this.mechBodies.clear(); this.hash = hash;
    const parts = JSON.parse(pj); const hulls = parseObj(obj), meshes = parseObjMeshes(obj); this.parts = parts;
    const oldFloor = parts.physics.floor_model;
    this.geometry = TRAY_GEOMETRY;
    const warp = p => trayPoint(p, oldFloor);
    const exitDelta = trayFloor(.0263,-.14)-exportedFloor(.0263,-.14,oldFloor);
    const warpPayout = p => [p[0],p[1]+exitDelta-.10*(p[2]+.14),p[2]];
    // 可動部の原点/軸・平面センサー・払出中心線を同じ床変位へつなぐ。
    const originalOrigins = new Map(parts.mechs.map(m => [m.id, m.origin_m.slice()]));
    for (const m of parts.mechs) {
      if(m.id==='MECH_SEP_NEEDLE'){m.origin_m[0]=-.180;originalOrigins.get(m.id)[0]=-.180;}
      const o=m.origin_m; if(m.axis){const a=warp(o), b=warp(o.map((v,i)=>v+m.axis[i]*.001));m.axis=b.map((v,i)=>(v-a[i])/.001);}
      m.origin_m=warp(o);
    }
    for(const s of parts.sensors)if(s.center_m)s.center_m=(s.id==='SENSOR_PAYOUT_EXIT'?warpPayout:warp)(s.center_m);
    const os=parts.sensors.find(s=>s.id==='SENSOR_RES_OVERFLOW_ENTRANCE');os.center_m[1]=(os.center_m[1]+trayFloor(os.center_m[0],os.center_m[2]))/2;os.half_y_m=.050;
    for(const p of parts.paths)if(p.centerline_m)p.centerline_m=p.centerline_m.map(p.id==='PATH_PAYOUT'?warpPayout:warp);
    const T = this.translationOverride ?? parts.roots.find((r) => r.id === 'TRAY_UNIT').transform.translation_m; this.T = T;
    const world = (v, i) => v + T[i % 3];
    const R = this.R; const mechDef = Object.fromEntries(parts.mechs.map((m) => [m.id, m]));
    const mergedVertices = [], mergedIndices = [], floorVertices = [], floorIndices = []; this.visualMechs = []; this.visualStatics = [];
    for (const p of parts.parts) {
      if (p.role !== 'collision' || p.id.startsWith('COL_CNT_') || p.parent === 'MECH_CNT_FLAP') continue;
      const raw = hulls.get(p.mesh.object); if (!raw) throw new Error('missing hull ' + p.mesh.object);
      const isStatic = p.parent === 'TRAY_UNIT'; // 可動部の凸包は可動部の原点(part.transform)基準の局所座標、静的部は設計座標
      const o = originalOrigins.get(p.parent);
      const warped = [];
      for(let i=0;i<raw.length;i+=3){
        const v=raw.slice(i,i+3), a=isStatic?(p.id.startsWith('COL_PAYOUT')?warpPayout:warp)(v):warp(v.map((x,k)=>x+o[k])).map((x,k)=>x-mechDef[p.parent].origin_m[k]);warped.push(...a);
      }
      const wp = isStatic ? warped.map(world) : warped;
      if(isStatic && p.id.startsWith('COL_TRAY_FLOOR_')) {
        const mesh=meshes.get(p.mesh.object);
        for(let k=0;k<mesh.indices.length;k+=3){
          const tri=mesh.indices.slice(k,k+3).map(i=>raw.slice(i*3,i*3+3));
          if(!tri.every(v=>Math.abs(v[1]-exportedFloor(v[0],v[2],oldFloor))<.00001))continue;
          for(const pc of outsideRect(tri,COUNT_PORT)){
            const base=floorVertices.length/3;
            for(const v of pc)floorVertices.push(v[0]*this.S+T[0]*this.S,(trayFloor(v[0],v[2])+T[1])*this.S,(v[2]+T[2])*this.S);
            for(let j=1;j<pc.length-1;j++)floorIndices.push(base,base+j,base+j+1);
          }
        }
        continue;
      }
      if(isStatic){
        if(p.id.startsWith('COL_TRAY_') || p.id.startsWith('COL_PAYOUT_'))this.visualStatics.push({id:p.id,vertices:wp,indices:meshes.get(p.mesh.object).indices});
        const offset=mergedVertices.length/3;
        mergedVertices.push(...wp.map(v=>v*this.S));
        mergedIndices.push(...meshes.get(p.mesh.object).indices.map(i=>i+offset));
      }
      // Rapier 0.21 の convexHull は原点から離れた点群だと接触が壊れる(玉が素通りする)ため、重心を引いて setTranslation で戻す
      const c = [0, 1, 2].map((k) => { let a = 0, n = 0; for (let i = k; i < wp.length; i += 3) { a += wp[i]; n++; } return a / n; });
      const S = this.S; const pts = new Float32Array(wp.map((v, i) => (v - c[i % 3]) * S));
      const desc = R.ColliderDesc.convexHull(pts); if (!desc) throw new Error('hull failed ' + p.id);
      desc.setTranslation(c[0] * S, c[1] * S, c[2] * S);
      desc.setFriction(p.collision.friction_assumed ?? 0.25).setRestitution(p.collision.restitution_assumed ?? 0.35);
      if (p.parent === 'TRAY_UNIT') { const c2 = this.world.createCollider(desc); c2.partId = p.id; this.statics.push(c2); }
      else {
        let m = this.mechBodies.get(p.parent);
        if (!m) { const o0 = mechDef[p.parent].origin_m.map((v, i) => v + T[i]); const body = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(o0[0] * S, o0[1] * S, o0[2] * S)); m = { body, def: mechDef[p.parent], value: 0 }; this.mechBodies.set(p.parent, m); }
        this.world.createCollider(desc, m.body);
        this.visualMechs.push({id:p.parent,vertices:wp,indices:meshes.get(p.mesh.object).indices});
      }
    }
    const floorDesc=R.ColliderDesc.trimesh(new Float32Array(floorVertices),new Uint32Array(floorIndices),R.TriMeshFlags.FIX_INTERNAL_EDGES);
    floorDesc.setFriction(.25).setRestitution(.35);this.statics.push(this.world.createCollider(floorDesc));
    this.floorMesh={vertices:floorVertices,indices:floorIndices};
    const floorOffset=mergedVertices.length/3;mergedVertices.push(...floorVertices);mergedIndices.push(...floorIndices.map(i=>i+floorOffset));
    const ductVertices=[],ductIndices=[];
    // 左端の幅48mm・奥行59mmの計数シャッターと、その幅に一致する下向き排出路。
    // 旧22x18mmの一点穴は多球で架橋し、100玉すべてが強制収納になった。
    const cp=COUNT_PORT, cx=(cp.x[0]+cp.x[1])/2, front=cp.z[1];
    const cm=mechDef.MECH_CNT_FLAP; cm.origin_m=[cx,trayFloor(cx,front),front];cm.axis=[1,TRAY_GEOMETRY.slopeX,0];
    const cb=this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation((cx+T[0])*this.S,(cm.origin_m[1]+T[1])*this.S,(front+T[2])*this.S));
    this.mechBodies.set('MECH_CNT_FLAP',{body:cb,def:cm,value:0});
    const flap=[];
    for(const x of cp.x)for(const z of cp.z)for(const h of [0,-.003])flap.push((x-cx)*this.S,(trayFloor(x,z)+h-cm.origin_m[1])*this.S,(z-front)*this.S);
    this.world.createCollider(R.ColliderDesc.convexHull(new Float32Array(flap)).setFriction(.25).setRestitution(.35),cb);
    const fv=[];for(const h of [-.003,0])for(const [x,z]of [[cp.x[0],cp.z[0]],[cp.x[1],cp.z[0]],[cp.x[1],cp.z[1]],[cp.x[0],cp.z[1]]])fv.push(x-cx,trayFloor(x,z)+h-cm.origin_m[1],z-front);
    this.visualMechs.push({id:'MECH_CNT_FLAP',vertices:fv,indices:[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7]});
    const ductY=z=>-.300+(z-front)*Math.tan(Math.PI/6);
    const box=(x0,x1,z0,z1,lo,hi)=>{
      const base=ductVertices.length/3;
      for(const y of [lo,hi])for(const [x,z]of [[x0,z0],[x1,z0],[x1,z1],[x0,z1]])ductVertices.push((x+T[0])*this.S,(y(x,z)+T[1])*this.S,(z+T[2])*this.S);
      for(const i of [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7])ductIndices.push(base+i);
    };
    const [xl,xr]=cp.x;
    box(xl-.002,xr+.002,cp.rear,front+.002,(x,z)=>ductY(z)-.003,(x,z)=>ductY(z));
    for(const [a,b]of [[xl-.002,xl],[xr,xr+.002]])box(a,b,cp.rear,front+.002,(x,z)=>ductY(z)-.003,(x,z)=>trayFloor(x,z));
    box(xl-.002,xr+.002,front,front+.002,(x,z)=>ductY(z)-.003,(x,z)=>trayFloor(x,z));
    const cs=parts.sensors.find(s=>s.id==='SENSOR_RES_COUNT_ENTRANCE');cs.center_m=[cx,(ductY(cp.rear+.006)+trayFloor(cx,cp.rear+.006))/2,cp.rear+.006];cs.half_x_m=(xr-xl)/2;cs.half_y_m=.050;
    const meshDesc=R.ColliderDesc.trimesh(new Float32Array(ductVertices),new Uint32Array(ductIndices),R.TriMeshFlags.FIX_INTERNAL_EDGES);
    meshDesc.setFriction(.25).setRestitution(.35);
    this.statics.push(this.world.createCollider(meshDesc));
    const ductOffset=mergedVertices.length/3;mergedVertices.push(...ductVertices);mergedIndices.push(...ductIndices.map(i=>i+ductOffset));
    this.staticMesh = { vertices: mergedVertices, indices: mergedIndices };
    this.sensors = parts.sensors.filter((s) => s.kind === 'plane').map((s) => ({ ...s, center: s.center_m.map((v, i) => v + T[i]), normal: s.normal }));
    // 払出の中心線(設計座標→世界)
    const path = parts.paths.find((x) => x.id === 'PATH_PAYOUT'); this.payoutStart = path.centerline_m[0].map((v, i) => v + T[i]);
    const ovf = parts.reservoir.find((r) => r.id === 'RES_OVERFLOW'); this.ovfHole = { x: ovf.hole_x_m.map((v) => v + T[0]), z: ovf.hole_z_m.map((v) => v + T[2]) };
    const cnt = parts.reservoir.find((r) => r.id === 'RES_COUNT'); this.cntHole = { x: COUNT_PORT.x.map(v=>v+T[0]), z: COUNT_PORT.z.map(v=>v+T[2]) };
    this.trayBox = { x: [-0.173 + T[0], 0.0855 + T[0]], z: [-0.140 + T[2], -0.064 + T[2]], y: [-0.30 + T[1], -0.236 + T[1]] }; // 皿の内側体積（col_all.obj の皿壁の範囲）
    for (const k of this.mechBodies.keys()) this.setMech(k, 0);
    this.rr = new TrayRollingResistance(T, this.rng);
    for (const [id, b] of this.activeBalls) if (!b.stored) this.rr.attach(id, b.body);
    return true;
  }

  /** ヒンジ: value=角度(rad) / スライダ: value=変位(m)。 */
  setMech(id, value) {
    const m = this.mechBodies.get(id); if (!m) return; m.value = value; const d = m.def;
    const o = d.origin_m.map((v, i) => v + this.T[i]);
    if (d.axis) { m.body.setNextKinematicRotation(axisQuat(d.axis, value)); m.body.setNextKinematicTranslation({ x: o[0] * this.S, y: o[1] * this.S, z: o[2] * this.S }); }
    else if (d.slide_axis) m.body.setNextKinematicTranslation({ x: (o[0] + d.slide_axis[0] * value) * this.S, y: (o[1] + d.slide_axis[1] * value) * this.S, z: (o[2] + d.slide_axis[2] * value) * this.S });
  }

  /** 払出口(トンネル始点)から1球落とす。ばらつき: 位置 x±2mm z±1.5mm(parts.json の payout jitter)。 */
  spawnPayout(opts = {}) {
    const R = this.R, j = (a) => (this.rng() * 2 - 1) * a, p = this.payoutStart;
    const S = this.S;
    const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation((p[0] + j(0.002)) * S, p[1] * S, (p[2] + j(0.0015)) * S).setCcdEnabled(true));
    const f = 1 + j(0.08), e = 1 + j(0.10);
    this.world.createCollider(R.ColliderDesc.ball(0.006 * S).setDensity(7800 / S ** 3).setFriction(0.25 * f).setRestitution(Math.min(0.9, 0.35 * e)), body);
    const id = opts.id ?? `B${String(this.nextBall++).padStart(3, '0')}`;
    if (this.rr) this.rr.attach(id, body);
    const b = { id, body, prev: this.pos(body), sensorMask: 0, state: 'payout' };
    this.balls.set(id, b); this.activeBalls.set(id, b); this.activePayout++; this._countCache = null; this._dishCount = null; return id;
  }
  /** 剛体を台帳へ移した後は480Hzの走査から外す。診断用のballs履歴は保つ。 */
  retire(b, reason) {
    if (b.stored) return;
    if (b.state === 'payout') this.activePayout--;
    b.stored = reason; this.activeBalls.delete(b.id); this._countCache = null; this._dishCount = null; this.world.removeRigidBody(b.body);
    this.rr?.prev.delete(b.id); this.rr?.dfac.delete(b.id);
  }
  pos(body, out = {x:0,y:0,z:0}) { const t = body.translation(this._rawPosition ??= {x:0,y:0,z:0}), S = this.S; out.x=t.x/S;out.y=t.y/S;out.z=t.z/S;return out; }
  /** 皿の中の球(中心が皿の内側体積)と、途中(トンネル内)の球。 */
  counts() {
    if (this._countCache) return this._countCache;
    const b = this.trayBox; let inDish = 0, tunnel = 0, resting = 0;
    for (const x of this.activeBalls.values()) { if (x.stored) continue; const t = x.prev; if (t.x > b.x[0] && t.x < b.x[1] && t.z > b.z[0] && t.z < b.z[1] && t.y > b.y[0] && t.y < b.y[1] + 0.03) { inDish++; if (x.body.isSleeping()) resting++; else { const v = x.body.linvel(this._rawVelocity); if (Math.hypot(v.x, v.y, v.z) < 0.02 * this.S) resting++; } } else tunnel++; }
    return this._countCache = { inDish, outside: tunnel, resting };
  }
  _overflowWantsOpen() {
    const o = this.overflow; if (o.type === 'open') return true; if (o.type === 'closed') return false;
    if (o.type === 'mouth') {
      if (!this.activePayout && !this.ovfWant) return false; // 払出口の出口が詰まった(トンネル最後の12mmに球が0.5秒動かない)ら開き、払出が終わって1秒で閉じる
      const PX = 0.0263 + this.T[0], ZB = -0.137 + this.T[2]; let blocked = false;
      for (const x of this.activeBalls.values()) { if (x.stored || x.state !== 'payout') continue; const t = x.prev; const v = x.body.linvel(this._rawVelocity);
        if (Math.abs(t.x - PX) < 0.014 && t.z > ZB - 0.012 && t.z < ZB + 0.002 && Math.hypot(v.x, v.y, v.z) < 0.02 * this.S) blocked = true; }
      const now = this.tick / (this.hz ?? 480);
      if (blocked) { this.blockSince ??= now; if (now - this.blockSince >= 0.5) this.ovfWant = true; } else this.blockSince = null;
      if (!this.payoutActive) { this.idleSince ??= now; if (now - this.idleSince >= 1.0) this.ovfWant = false; } else this.idleSince = null;
      return this.ovfWant;
    }
    if(o.type === 'reach') {
      const h=this.ovfHole;let high=false;
      for(const b of this.activeBalls.values()){
        const t=b.prev;if(t.x<h.x[0]-.012||t.x>h.x[1]+.012||t.z<h.z[0]-.008||t.z>h.z[1]+.008)continue;
        const floor=trayFloor(t.x-this.T[0],t.z-this.T[2])+this.T[1];
        if(t.y>floor+.017 && t.y<floor+.050){high=true;break;}
      }
      if(high){this.levelLast=this.tick;this.ovfWant=true;}
      else if(this.tick-(this.levelLast??-1e9)>.8*(this.hz??480))this.ovfWant=false;
      return this.ovfWant;
    }
    const c = this.counts();
    if (o.type === 'count') return c.inDish + this._inFlightToDish() >= o.n;
    // reach: 溢れ口の手前(x±22mm, z±20mm)に、静止した球が2層以上(中心高さが床+9mm超)で届いたら開く
    const h = this.ovfHole, floor = this.floorY ?? (-0.2686 + this.T[1]); let reach = false;
    for (const x of this.activeBalls.values()) { if (x.stored) continue; const t = x.prev; const v = x.body.linvel(this._rawVelocity); /* 物理単位/s */
      if (t.x > h.x[0] - 0.022 && t.x < h.x[1] + 0.022 && t.z > h.z[0] - 0.02 && t.z < h.z[1] + 0.02 && t.y > floor + 0.009 + 0.006 && Math.hypot(v.x, v.y, v.z) < 0.05 * this.S) reach = true; }
    return reach;
  }
  _inFlightToDish() { let n = 0; for (const x of this.activeBalls.values()) if (!x.stored && x.state === 'payout') { const t = x.prev; if (!(t.z > this.trayBox.z[0])) n++; } return n; }

  /** 床の実傾斜と垂直重力だけで転がす。互換用の空hook。 */
  beforeStep(dt) {}
  _updateFlap(fid, want, hole, dt) {
    const m = this.mechBodies.get(fid); if (!m) return;
    const speed = (Math.PI / 2) / 0.25 * dt; let v = m.value;
    const occupied = this._ballOnHole(hole);
    if (want || (occupied && v < -.05)) v = Math.max(-Math.PI / 2, v - speed); else if (!occupied) v = Math.min(0, v + speed);
    if (v !== m.value) this.setMech(fid, v);
    if (hole === 'ovf') this.flapOpen = v < -Math.PI / 4; else this.cntFlapOpen = v < -Math.PI / 4;
  }
  /** 480Hz などの固定刻みの1step後に呼ぶ。蓋の開閉・センサー・球の収納を処理。 */
  afterStep(dt) {
    this.tick++; this._countCache = null; this._dishCount = null;
    // 蓋(溢れ・計数): 0.25s で 0→-90°。穴の上に沈みかけた球がいる間は閉じない(parts.json の interlock)
    this.hz = 1 / dt;
    const ovfWant = this._overflowWantsOpen(), countWant = this.countOpen;
    this._updateFlap('MECH_OVF_FLAP', ovfWant, 'ovf', dt);
    this._updateFlap('MECH_CNT_FLAP', countWant, 'cnt', dt);
    for (const b of this.activeBalls.values()) {
      const id = b.id;
      if (b.stored || b.body.isSleeping()) continue; const t = this.pos(b.body, this._stepPosition ??= {x:0,y:0,z:0});
      for (let si = 0; si < this.sensors.length; si++) {
        const s = this.sensors[si], mask = 1 << si; if (b.sensorMask & mask) continue;
        const n = s.normal, d0 = (b.prev.x - s.center[0]) * n[0] + (b.prev.y - s.center[1]) * n[1] + (b.prev.z - s.center[2]) * n[2];
        const d1 = (t.x - s.center[0]) * n[0] + (t.y - s.center[1]) * n[1] + (t.z - s.center[2]) * n[2];
        if (d0 < 0 && d1 >= 0) {
          const k = -d0 / (d1 - d0), hx = b.prev.x + (t.x - b.prev.x) * k, hy = b.prev.y + (t.y - b.prev.y) * k, hz = b.prev.z + (t.z - b.prev.z) * k;
          const ok = s.radius_m != null ? Math.hypot(hx - s.center[0], hy - s.center[1], hz - s.center[2]) <= s.radius_m
            : Math.abs(hx - s.center[0]) <= (s.half_x_m ?? 1e9) && Math.abs(hy - s.center[1]) <= (s.half_y_m ?? 1e9);
          if (ok) { b.sensorMask |= mask; this.latched.set(s.id + '|' + id, this.tick); this.events.push({ tick: this.tick, ball: id, sensor: s.id }); this._onSensor(s.id, id, b); }
        }
      }
      if (this.debugHistory && this.tick % 24 === 0) b.last = [t.x - this.T[0], t.y - this.T[1], t.z - this.T[2]].map((v) => +(v * 1000).toFixed(0));
      b.prev.x = t.x; b.prev.y = t.y; b.prev.z = t.z;
      if (!b.fell && t.y < this.T[1] - 0.34) { b.fell = true; this.events.push({ tick: this.tick, ball: id, sensor: 'FELL', at: [t.x - this.T[0], t.y - this.T[1], t.z - this.T[2]].map((v) => +(v * 1000).toFixed(0)), prev: b.prevLog }); }
      if (this.debugHistory && this.tick % 12 === 0) { const p = b.hist ??= []; p.push([t.x - this.T[0], t.y - this.T[1], t.z - this.T[2]].map((v) => +(v * 1000).toFixed(0))); if (p.length > 12) p.shift(); }
      if (t.y < -0.6) { this.events.push({ tick: this.tick, ball: id, sensor: 'LOST', last: b.last }); this.retire(b, 'lost'); }
    }
    if (this.rr && this.tick % Math.max(1, Math.round(this.hz / 60)) === 0) this.rr.update(this.activeBalls, 1 / 60, this.S);
  }
  _ballOnHole(which = 'ovf') { const h = which === 'ovf' ? this.ovfHole : this.cntHole, floor = trayFloor((h.x[0]+h.x[1])/2-this.T[0], (h.z[0]+h.z[1])/2-this.T[2])+this.T[1]; for (const x of this.activeBalls.values()) { if (x.stored) continue; const t = x.prev; if (t.x > h.x[0]-.0065 && t.x < h.x[1]+.0065 && t.z > h.z[0]-.0065 && t.z < h.z[1]+.0065 && t.y < floor+.020 && t.y > floor-.020) return true; } return false; }
  /** 取込口(皿の左)に最も近い、皿の中の球を取り除いて返す(取込ゲート〜昇降の物理は未移植、台帳＋時間差で代用)。 */
  takeNearestIntake() {
    let best = null, bx = 1e9;
    for (const [id, b] of this.activeBalls) { if (b.stored || b.state !== 'dish') continue; const t = b.prev; if (t.x > this.trayBox.x[0] && t.x < this.trayBox.x[1] && t.z > this.trayBox.z[0] && t.z < this.trayBox.z[1] && t.x < bx) { bx = t.x; best = id; } }
    if (best == null) return null; const b = this.balls.get(best); this.retire(b, 'feed'); this.stored.feed = (this.stored.feed ?? 0) + 1; return best;
  }
  dishCount() {
    if(this._dishTick===this.tick && this._dishCount!=null)return this._dishCount;
    const b=this.trayBox;let n=0;
    for(const x of this.activeBalls.values()){const t=x.prev;if(t.x>b.x[0]&&t.x<b.x[1]&&t.z>b.z[0]&&t.z<b.z[1]&&t.y>b.y[0]&&t.y<b.y[1]+.03)n++;}
    this._dishTick=this.tick;return this._dishCount=n;
  }
  _onSensor(sid, id, b) {
    if (sid === 'SENSOR_PAYOUT_EXIT') { this.payoutExited++; this.activePayout--; b.state = 'dish'; this._countCache = null; this._dishCount = null; }
    else if (sid === 'SENSOR_RES_OVERFLOW_ENTRANCE') { this.stored.overflow++; this.retire(b, 'overflow'); }
    else if (sid === 'SENSOR_RES_COUNT_ENTRANCE') { this.stored.count++; this.retire(b, 'count'); }
  }
}
