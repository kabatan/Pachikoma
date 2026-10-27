// Isolated candidate; intended URL: web/src/native_merged_main.mjs.
import * as THREE from '../vendor/three/three.module.js';

const installed = new WeakMap();
const shaderChecks = new WeakMap();
const SLOT = '_nativeMergedMain';
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const defaultBefore = THREE.Object3D.prototype.onBeforeRender;
const defaultAfter = THREE.Object3D.prototype.onAfterRender;
const normalData = (o, key) => { const d = Object.getOwnPropertyDescriptor(o, key); return !!d && 'value' in d && d.writable; };
const normalGraph = o => !!o?.isObject3D && normalData(o, 'parent') && normalData(o, 'children') && Array.isArray(o.children) && Object.isExtensible(o.children) && !Object.isFrozen(o.children);
const identity = o => o.position.x === 0 && o.position.y === 0 && o.position.z === 0 && o.quaternion.x === 0 && o.quaternion.y === 0 && o.quaternion.z === 0 && o.quaternion.w === 1 && o.scale.x === 1 && o.scale.y === 1 && o.scale.z === 1 && o.matrix.elements.every((v, i) => v === IDENTITY[i]) && o.matrixWorld.elements.every((v, i) => v === IDENTITY[i]);
const defaultHooks = o => o.onBeforeRender === defaultBefore && o.onAfterRender === defaultAfter;
function plainAncestors(o) {
  const seen = new Set();
  while (o) {
    if (seen.has(o) || !normalGraph(o) || !identity(o)) return false;
    seen.add(o); o = o.parent;
  }
  return true;
}
function safeShader(m) {
  const vs = m.vertexShader, fs = m.fragmentShader;
  let c = shaderChecks.get(m);
  if (!c || c.vs !== vs || c.fs !== fs) {
    c = { vs, fs, safe: typeof vs === 'string' && typeof fs === 'string' && /gl_Position\s*=\s*vec4\s*\(\s*position\.xy\s*,/.test(vs) && !/\b(cameraPosition|projectionMatrix|viewMatrix|modelMatrix|modelViewMatrix)\b|#\s*include/.test(vs + '\n' + fs) };
    shaderChecks.set(m, c);
  }
  return c.safe;
}
function safeScene(s, mask) {
  return s?.isScene && s.visible === true && s.layers.mask === mask && s.background === null && s.environment === null && s.fog === null && s.overrideMaterial === null && defaultHooks(s) && plainAncestors(s);
}
function allowed(s) {
  const h = s.hr, r = h.renderer, mask = h.camera.layers.mask;
  if (h[SLOT] !== s.handle || s.disposed || s.disabled || r.sortObjects !== true || r.autoClear !== false || h.fsCam.layers.mask !== mask || !safeScene(h.sBack, mask) || !safeScene(h.sBalls, mask)) return false;
  if (!(h.balls.count > 0 || h.trayVisual) || h.rtMain.samples !== 4 || h.rtMain.resolveDepthBuffer !== false || !h.rtMain.depthBuffer || h.rtMain.depthTexture || h.rtMain.stencilBuffer || h.rtMain.storeMultisampledDepthBuffer !== true) return false;
  for (let o = h.sBack; o; o = o.parent) if (o === h.sBalls) return false;
  for (let o = h.sBalls; o; o = o.parent) if (o === h.sBack) return false;
  const lcd = s.getLCDMesh(), children = h.sBack.children;
  if (h.envBack !== s.environmentMaterial || (s.lcdMesh && (lcd !== s.lcdMesh || lcd.material !== s.lcdMaterial))) return false;
  let environment = 0, display = 0;
  for (const mesh of children) {
    if (!mesh.isMesh || mesh.children.length || !normalGraph(mesh) || !defaultHooks(mesh) || mesh.frustumCulled !== false || mesh.layers.mask !== mask) return false;
    const m = mesh.material;
    if (!m?.isShaderMaterial || m.transparent !== false || m.depthTest !== false || m.depthWrite !== false || m.lights || !safeShader(m)) return false;
    if (mesh === s.environmentMesh && m === s.environmentMaterial && mesh !== lcd && mesh.renderOrder === 0 && m.blending === THREE.NoBlending) environment++;
    else if (mesh === lcd && mesh.renderOrder === 50 && m.blending === THREE.CustomBlending && m.blendEquation === THREE.AddEquation && m.blendSrc === THREE.OneFactor && m.blendDst === THREE.OneFactor && m.blendSrcAlpha === THREE.OneFactor && m.blendDstAlpha === THREE.OneFactor) display++;
    else return false;
  }
  if (environment !== 1 || display > 1 || (lcd && !children.includes(lcd))) return false;
  let unsafeBalls = false;
  h.sBalls.traverse(o => {
    if (o.isGroup && o.renderOrder <= -100) unsafeBalls = true;
    // Three's extra transmission pass would include newly attached back meshes.
    if (o.isMesh) {
      if (Array.isArray(o.material)) {
        for (const material of o.material) if (material?.transmission > 0) unsafeBalls = true;
      } else if (o.material?.transmission > 0) unsafeBalls = true;
    }
  });
  if (unsafeBalls) return false;
  if (lcd && !s.lcdMesh) { s.lcdMesh = lcd; s.lcdMaterial = lcd.material; }
  return true;
}
function removeEdge(parent, child) {
  if (!parent) return;
  let i;
  while ((i = parent.children.indexOf(child)) !== -1) parent.children.splice(i, 1);
  if (child.parent === parent) child.parent = null;
}
function repair(s, snap) {
  const back = s.hr.sBack, balls = s.hr.sBalls, group = s.group;
  if (back.parent !== null && back.parent !== group && back.parent !== snap.parent) throw Error('native merge: external graph ownership changed during draw');
  removeEdge(group, back); removeEdge(balls, group);
  if (snap.parent) {
    removeEdge(snap.parent, back);
    snap.parent.children.splice(snap.index, 0, back); back.parent = snap.parent;
  } else back.parent = null;
  group.parent = null;
  if (back.parent !== snap.parent || (snap.parent && snap.parent.children.indexOf(back) !== snap.index)) throw Error('native merge: parent/index restoration failed');
}
// Final structural repair avoids re-firing a listener which already threw.
function restore(s) {
  if (s.restoringSnapshot) { repair(s, s.restoringSnapshot); return; }
  const snap = s.snapshot;
  if (!snap) return;
  s.restoringSnapshot = snap;
  const back = s.hr.sBack, balls = s.hr.sBalls, group = s.group;
  let failure;
  const attempt = fn => { try { fn(); } catch (error) { failure ??= { error }; } };
  try {
    attempt(() => { if (back.parent === group) group.remove(back); });
    attempt(() => { if (group.parent === balls) balls.remove(group); });
    attempt(() => { if (snap.parent && back.parent !== snap.parent) snap.parent.add(back); });
    // Supported graphs have ordinary writable data fields and mutable arrays.
    // Arbitrary external reparenting while a frame executes is out of contract.
    attempt(() => repair(s, snap));
  } finally { s.snapshot = null; s.restoringSnapshot = null; }
  if (failure) { s.disabled = true; s.stats.cleanupFailures++; throw failure.error; }
}
function separateAfterCompose(s) {
  const h = s.hr, r = h.renderer;
  restore(s);
  r.setRenderTarget(h.rtMain); r.setViewport(0, 0, h.rtMain.width, h.rtMain.height);
  r.render(h.sBack, h.fsCam);
  r.render(h.sBalls, h.camera);
  s.stats.interrupted++;
}
function tryDraw(s) {
  if (s.phase !== 'idle') {
    s.abort = true; s.stats.reentrant++;
    restore(s); // Leave no private edge visible to the recursive legacy call.
    return false;
  }
  let safe = false;
  try { safe = allowed(s); } catch { /* Unknown owner/getter/material: legacy. */ }
  if (!safe) { s.stats.fallback++; return false; }
  const h = s.hr, back = h.sBack;
  s.snapshot = { parent: back.parent, index: back.parent ? back.parent.children.indexOf(back) : -1 };
  if (s.snapshot.parent && s.snapshot.index < 0) { s.snapshot = null; s.stats.fallback++; return false; }
  s.phase = 'attaching'; s.abort = false;
  try {
    s.group.layers.mask = h.camera.layers.mask;
    s.group.add(back);
    if (s.abort || s.disposed || h[SLOT] !== s.handle) {
      restore(s); s.phase = 'idle'; s.stats.fallback++; return false;
    }
    h.sBalls.add(s.group);
    if (s.abort || s.disposed || h[SLOT] !== s.handle) {
      restore(s); s.phase = 'idle'; s.stats.fallback++; return false;
    }
  } catch (error) {
    let restoreFailure;
    try { restore(s); } catch (e) { restoreFailure = { error: e }; }
    s.phase = 'idle'; s.disabled = true; s.stats.attachFailures++;
    if (restoreFailure) throw error; // First error preserved; graph repair was attempted.
    return false;
  }
  let failure;
  try {
    s.phase = 'composing';
    h.probes.compose(h.frame); // Always compose: no probe result cache.
    if (s.abort || s.disposed || h[SLOT] !== s.handle) {
      separateAfterCompose(s); return true;
    }
    const r = h.renderer;
    r.setRenderTarget(h.rtMain); r.setViewport(0, 0, h.rtMain.width, h.rtMain.height);
    s.phase = 'drawing'; r.render(h.sBalls, h.camera);
    s.stats.merged++; return true;
  } catch (error) {
    failure = { error }; throw error;
  } finally {
    s.phase = 'restoring';
    try { restore(s); } catch (error) { if (!failure) throw error; }
    finally { s.phase = 'idle'; }
  }
}
export function installNativeMergedMain(hr, { getLCDMesh = () => null } = {}) {
  const previous = installed.get(hr);
  if (previous && !previous.disposed) return hr[SLOT] === previous.handle ? previous.handle : null;
  const slot = Object.getOwnPropertyDescriptor(hr, SLOT);
  if ((slot && (!('value' in slot) || !slot.writable || slot.value != null)) || (!slot && !Object.isExtensible(hr))) return null;
  const environmentMeshes = hr.sBack.children.filter(mesh => mesh.isMesh && mesh.material === hr.envBack);
  if (environmentMeshes.length !== 1) return null;
  const stats = { merged: 0, fallback: 0, interrupted: 0, reentrant: 0, attachFailures: 0, cleanupFailures: 0 };
  const s = { hr, getLCDMesh, environmentMesh: environmentMeshes[0], environmentMaterial: hr.envBack, lcdMesh: null, lcdMaterial: null, group: new THREE.Group(), phase: 'idle', snapshot: null, restoringSnapshot: null, disposed: false, disabled: false, abort: false, stats, handle: null };
  s.group.renderOrder = -100;
  const handle = Object.freeze({ stats, dispose() {
    if (s.disposed) return;
    s.disposed = true; s.abort = true;
    try { restore(s); } finally {
      if (hr[SLOT] === handle) { if (slot) Object.defineProperty(hr, SLOT, slot); else delete hr[SLOT]; }
      if (installed.get(hr) === s) installed.delete(hr);
    }
  } });
  s.handle = handle; installed.set(hr, s); hr[SLOT] = handle;
  return handle;
}
export function tryNativeMergedMain(hr) {
  const s = installed.get(hr);
  return s ? tryDraw(s) : false;
}
export function disposeNativeMergedMain(hr) {
  installed.get(hr)?.handle.dispose();
}
