// node work/game_demo/physics/stage_transforms_test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsAdapter, KIND } from './adapter.mjs';
import { StageTransforms, loadStageTransforms } from './stage_transforms.mjs';
import { connectAssemblyBalls } from '../play/render_bridge.mjs';
const canonical = await loadStageTransforms();
const close = (a, b, eps = 1e-7) => { assert.equal(a.length,b.length); a.forEach((v,i)=>assert(Math.abs(v-b[i])<eps, `${i}: ${v} != ${b[i]}`)); };
const document = structuredClone(canonical.document);
// Different nonzero rotations and offsets expose omitted/double transforms.
Object.assign(document.stages.stage1, {translation_mm:[15,-8,23],rotation_euler_rad:[.3,-.1,.2]});
Object.assign(document.stages.stage2, {translation_mm:[34,12,-19],rotation_euler_rad:[.1,.2,-.15]});
Object.assign(document.stages.stage3, {translation_mm:[-21,-5,17],rotation_euler_rad:[-.2,.1,.25]});
const transforms = new StageTransforms(document), sample = [.12,-.23,.08];
for(const stage of ['stage1','stage2','stage3','ring','cabinet']) close(transforms.inversePoint(stage,transforms.point(stage,sample)),sample,1e-12);
// Analytic XYZ check, also used independently by the Python audit.
const analytic=structuredClone(document);
Object.assign(analytic.stages.stage1,{translation_mm:[10,20,30],rotation_euler_rad:[Math.PI/2,0,Math.PI/2]});
close(new StageTransforms(analytic).point('stage1',[0,1,0]),[.01,.02,1.03],1e-12);
await RAPIER.init();
const CAB = new URL('../../cabinet/',import.meta.url);
const pa=await PhysicsAdapter.create(RAPIER,{
  readText:async p=>{
    const text=readFileSync(new URL(p,CAB),'utf8');
    if(p==='stage1/export/parts.json') {const parts=JSON.parse(text);parts.roots[0].transform.translation_m=[9,8,7];return JSON.stringify(parts);}
    return text;
  },importModule:p=>import(new URL(p,CAB).href),loadTransforms:async()=>transforms,seed:3,
});
close(pa.tray.T,document.stages.stage1.translation_mm.map(v=>v/1000),1e-12);
pa.shuttleHas=true;pa.setAim(.2,-1);pa.board.launch('board',.2,-1);
const trayId=pa.tray.spawnPayout();
pa._startTransit({cup:1,shotId:'return',vy:-.2});pa.travel.push({id:'lift',s:0});
const s=pa.snapshot();
assert.equal(s.coordinate_frame,'assembly');assert.equal(s.count,5);
const get=k=>{const i=Array.from(s.kinds.slice(0,s.count)).indexOf(k);assert(i>=0);return Array.from(s.positions.slice(3*i,3*i+3));};
const board=pa.board.pos(pa.board.balls.get('board').body);
close(get(KIND.board),transforms.point('stage3',Object.values(board)));
const tray=pa.tray.pos(pa.tray.balls.get(trayId).body);
close(get(KIND.tray),transforms.point('stage1',Object.values(tray).map((v,i)=>v-pa.tray.T[i])));
close(get(KIND.ret),transforms.point('stage3',pa.transit[0].poly.pts[0]));
close(get(KIND.lift),transforms.point('stage2',pa.liftPath.pts[0]));
const sh=pa.board.shuttle(.2,-1), nativeShuttle=[sh.x,pa.muzzle[1],pa.muzzle[2]];
close(get(KIND.shuttle),transforms.point('stage2',nativeShuttle));
// Stage2 spawn reaches board native space before simulation and rotates velocity too.
const launchNative=transforms.pointBetween('stage3','stage2',Object.values(board));
close(launchNative.slice(0,2),nativeShuttle.slice(0,2));
assert(Math.abs(launchNative[2]-nativeShuttle[2])<.0007);
const velocity=pa.board.balls.get('board').body.linvel();
close(transforms.vectorBetween('stage3','stage2',Object.values(velocity).map(v=>v/10)),[sh.vx,-pa.board.launcher.speed,0]);
const intake=pa.tray.parts.connections.find(c=>c.id==='SOCKET_LIFT_IN').center_m;
const s2=JSON.parse(readFileSync(new URL('stage2/export/parts.json',CAB),'utf8'));
const foot=s2.connections.find(c=>c.id==='SOCKET_FOOT').center_m;
close(s.connections.intake_m,transforms.point('stage1',intake));
close(s.connections.lift_foot_m,transforms.point('stage2',foot));
close(s.connections.delta_m,s.connections.lift_foot_m.map((v,i)=>v-s.connections.intake_m[i]));
let drawn=null;const draw=connectAssemblyBalls({setBalls:value=>{drawn=value;}},transforms);draw(s);
assert.equal(drawn.positions,s.positions); // no second transform/copy at rendering boundary
assert.throws(()=>draw({...s,coordinate_frame:'stage1'}),/frame mismatch/);
assert.throws(()=>draw({...s,stage_transforms_revision:'other'}),/frame mismatch/);
const invalid=structuredClone(document);invalid.stages.stage2.translation_mm[0]=NaN;
assert.throws(()=>new StageTransforms(invalid),/Invalid stage transform/);
console.log(JSON.stringify({revision:canonical.revision,transformed_ball_kinds:5,analytic_rotation_tolerance_m:1e-12,render_frame_rejections:2,export_root_override:true}));
pa.bw.free();pa.tw.free();
