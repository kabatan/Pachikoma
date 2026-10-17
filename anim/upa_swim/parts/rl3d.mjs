// 重複ルーレットの3D層(three.js)。盤・文字・砕ける画面・火の粉を奥行きのある3Dで描き、透明つきのキャンバスに出す。
// 画面は PixiJS 側がスプライトとして重ねる。座標は「盤の中心が原点、右が+x、上が+y」(px)。
import * as THREE from '../vendor/three/three.module.js';
export { THREE };

const D2R = Math.PI / 180;
const PLAIN_VS = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';
const ADD_FS = 'uniform sampler2D map;uniform float op;uniform vec3 col;varying vec2 vUv;void main(){vec4 c=texture2D(map,vUv);vec3 r=c.rgb*c.a*col*op;gl_FragColor=vec4(r,max(r.r,max(r.g,r.b)));}';
// 光のつや(文字の形に沿って斜めの帯が走る)
const SHINE_FS = 'uniform sampler2D map;uniform float op;uniform float pos;uniform float wid;varying vec2 vUv;void main(){vec4 c=texture2D(map,vUv);float d=(vUv.x+vUv.y*0.45)-pos;float b=exp(-d*d/(wid*wid));vec3 r=vec3(1.,.82,.76)*b*c.a*op;gl_FragColor=vec4(r,max(r.r,max(r.g,r.b)));}';
const PT_VS = 'attribute float size;attribute float alpha;attribute vec3 color;uniform float scale;varying float vA;varying vec3 vC;void main(){vA=alpha;vC=color;vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=min(size*scale/max(1.,-mv.z),180.);}';
const PT_FS = 'varying float vA;varying vec3 vC;void main(){float d=length(gl_PointCoord-.5)*2.;float a=clamp(1.-d,0.,1.);a=a*a;float core=pow(clamp(1.-d*1.8,0.,1.),2.);vec3 r=(vC*a+vec3(1.,.9,.8)*core)*vA;gl_FragColor=vec4(r,max(r.r,max(r.g,r.b)));}';

// 各三角形のローカル頂点と、従来と同じ倍精度CPU計算→float32のmodelViewを使う。
// world座標に頂点を焼く／GPUでEulerを再計算すると、輪郭の丸めと透過の重なりが変わる。
function shardMaterial(mat, edge = false) {
  mat.onBeforeCompile = shader => {
    shader.vertexShader = `attribute mat4 shardModelView;
attribute vec4 shardTint;
attribute float shardEdge;
flat varying vec4 vShardTint;
flat varying float vShardEdge;
` + shader.vertexShader.replace('#include <project_vertex>', `
vec4 mvPosition = vec4( transformed, 1.0 );
mvPosition = shardModelView * mvPosition;
gl_Position = projectionMatrix * mvPosition;
vShardTint = shardTint;
vShardEdge = shardEdge;`);
    shader.fragmentShader = `flat varying vec4 vShardTint;
flat varying float vShardEdge;
` + shader.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );',
      edge ? 'vec4 diffuseColor = vec4( diffuse, vShardEdge );' : 'vec4 diffuseColor = vShardTint;');
  };
  mat.customProgramCacheKey = () => edge ? 'shard-edge-v1' : 'shard-face-v1';
  return mat;
}

export class RL3D {
  constructor({ canvas, width, height, tex, worldW, worldH, fov = 30 }) {
    this.tex = tex;                       // 名前 → 画像(HTMLImageElement/ImageBitmap/Canvas)
    this.ww = worldW; this.wh = worldH;   // 映す範囲(px)。中心が原点
    const r = this.r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1); r.setSize(width, height, false);
    r.outputColorSpace = THREE.LinearSRGBColorSpace; r.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.fov = fov; this.D0 = (worldH / 2) / Math.tan(fov * D2R / 2);
    this.cam = new THREE.PerspectiveCamera(fov, worldW / worldH, 50, 20000);
    this.camState = { az: 0, el: 0, dist: this.D0, roll: 0, fov, tx: 0, ty: 0, tz: 0 };
    this.texCache = {};
    this.ord = 0;
    this.disc = new THREE.Group(); this.scene.add(this.disc); this.disc.visible = false;
    this.titles = {};
    this.parts = null;
    this.buildParticles();
    this.shards = null;
    this.setCam({});
  }
  T(name) {
    if (this.texCache[name]) return this.texCache[name];
    const src = this.tex[name]; if (!src) throw new Error('rl3d: missing ' + name);
    const t = new THREE.Texture(src); t.colorSpace = THREE.NoColorSpace; t.flipY = true; t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 8; t.needsUpdate = true;
    return (this.texCache[name] = t);
  }
  basic(name, o = {}) {
    const m = new THREE.MeshBasicMaterial({ map: typeof name === 'string' ? this.T(name) : name, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    if (o.color !== undefined) m.color.setHex(o.color);
    if (o.opacity !== undefined) m.opacity = o.opacity;
    return m;
  }
  additive(name, o = {}) {
    return new THREE.ShaderMaterial({
      uniforms: { map: { value: this.T(name) }, op: { value: o.op ?? 1 }, col: { value: new THREE.Color(o.color ?? 0xffffff) } },
      vertexShader: PLAIN_VS, fragmentShader: ADD_FS, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    });
  }
  plane(mat, w, h, z = 0, parent = this.disc) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.z = z; m.renderOrder = this.ord++; parent.add(m); return m;
  }
  setCam(o) {
    const c = Object.assign(this.camState, o);
    const cam = this.cam, e = c.el * D2R, a = c.az * D2R;
    cam.fov = c.fov; cam.updateProjectionMatrix();
    cam.position.set(c.tx + c.dist * Math.sin(a) * Math.cos(e), c.ty + c.dist * Math.sin(e), c.tz + c.dist * Math.cos(a) * Math.cos(e));
    cam.up.set(Math.sin(c.roll * D2R), Math.cos(c.roll * D2R), 0);
    cam.lookAt(c.tx, c.ty, c.tz);
  }
  // ---- 盤 ----
  // segs: [{k,a0,a1,w,mid}], labels: {k:canvas}, Rf: 面の半径
  buildDisc(segs, labels, tierFace, Rf, NL = 40) {
    const g = this.disc; this.Rf = Rf;
    while (g.children.length) { const c = g.children.pop(); c.geometry && c.geometry.dispose(); }
    this.ord = 100;
    const k = Rf / 819.2;
    // 影(盤の外に落ちる)
    this.shadow = this.plane(this.basic('rl_shadow.png', { opacity: 0.95 }), 2560 * k, 2560 * k, -90);
    // 盤の厚み(縁を奥へ重ねて側面に見せる)
    this.side = [];
    for (let i = 7; i >= 1; i--) { const m = this.plane(this.basic('rl_rim.png', { color: 0x120709 }), 2048 * k, 2048 * k, -i * 6); this.side.push(m); }
    // 札
    this.segMeshes = [];
    const wedgeZ = -8;
    segs.forEach(s => {
      const geo = new THREE.CircleGeometry(Rf * 1.0, Math.max(8, Math.ceil(s.w / 3)), (90 - s.a1) * D2R, s.w * D2R);
      const mat = this.basic(tierFace[s.k]);
      const m = new THREE.Mesh(geo, mat); m.position.z = wedgeZ; m.renderOrder = this.ord++; g.add(m);
      this.segMeshes.push(m); s.m3 = m;
    });
    // 札の下の凹み(外周の暗い影)
    // 仕切り
    segs.forEach(s => {
      const d = this.plane(this.basic('rl_divider.png'), Math.max(8, Rf * 0.025), Rf * 1.02, -4);
      d.geometry.translate(0, Rf * 0.51, 0); d.rotation.z = -s.a0 * D2R;
    });
    // 札の文字
    segs.forEach(s => {
      const cv = labels[s.k]; if (!cv) return;
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.NoColorSpace;
      const inside = s.inside, lr = inside ? Rf * 0.62 : Rf * 1.15, ang = s.mid * D2R;
      const sc = s.labScale;
      const m = this.plane(this.basic(t), 512 * sc, 200 * sc, 3);
      m.position.set(Math.sin(ang) * lr, Math.cos(ang) * lr, 3); m.visible = s.w >= 10; s.lab3 = m;
    });
    // 縁(ベゼル)
    this.rim = this.plane(this.basic('rl_rim.png'), 2048 * k, 2048 * k, 4);
    // 外周のランプ
    this.lampOn = []; this.NL = NL;
    for (let i = 0; i < NL; i++) {
      const a = i * 360 / NL, r = Rf * 1.36;
      const off = this.plane(this.basic('rl_lamp_off.png'), Rf * 0.17, Rf * 0.17, 5);
      const on = this.plane(this.additive('rl_lamp_on.png'), Rf * 0.17, Rf * 0.17, 8);
      for (const m of [off, on]) { m.position.set(Math.sin(a * D2R) * r, Math.cos(a * D2R) * r, m.position.z); m.rotation.z = -a * D2R; }
      on.material.uniforms.op.value = 0; this.lampOn.push(on);
    }
    // 針の尾
    this.trail = this.plane(this.additive('rl_arc_trail.png'), 2048 * k, 2048 * k, 9);
    this.trail.material.uniforms.op.value = 0;
    // 針(回転の軸が盤の中心)
    this.needle = new THREE.Group(); this.needle.position.z = 11; g.add(this.needle);
    const nw = 1024 * k, nh = 2048 * k;
    this.needleShadow = this.plane(this.basic('rl_needle.png', { color: 0x000000, opacity: 0.55 }), nw, nh, -14, this.needle);
    this.needleShadow.position.x = 7; this.needleShadow.position.y = -9;
    this.ndMesh = this.plane(this.basic('rl_needle.png'), nw, nh, 0, this.needle);
    this.ngMesh = this.plane(this.additive('rl_needle_glow.png'), nw, nh, 2, this.needle);
    // 中心のキャップ
    this.hubBase = this.plane(this.basic('rl_hub.png', { color: 0x1a0c0f }), 512 * k * 1.02, 512 * k * 1.02, 8);
    this.hub = this.plane(this.basic('rl_hub.png'), 512 * k, 512 * k, 18);
    // ガラスのドーム(浮かせて視差を出す)
    this.dome = this.plane(this.additive('rl_dome.png', { op: 0.9 }), 2048 * k, 2048 * k, 26);
    this.segs = segs;
    this.regs = [];
    g.traverse(m => { if (!m.material) return; m.userData.base = m.material.uniforms ? m.material.uniforms.op.value : m.material.opacity; this.regs.push(m); });
    this.discAlpha = 1;
  }
  setDisc(o) {
    const d = this.disc;
    d.visible = !!o.vis; d.position.set(o.x || 0, o.y || 0, o.z || 0); d.scale.setScalar(o.s ?? 1);
    d.rotation.set((o.rx || 0) * D2R, (o.ry || 0) * D2R, (o.rz || 0) * D2R);
    this.discAlpha = o.alpha ?? 1;
  }
  base(m, v) { m.userData.base = v; }
  setNeedle(deg, glow, trail) {
    this.needle.rotation.z = -deg * D2R; this.trail.rotation.z = -deg * D2R;
    this.base(this.ngMesh, glow); this.base(this.trail, trail);
  }
  setLamp(i, a) { this.base(this.lampOn[i], a); this.lampOn[i].scale.setScalar(1 + 0.5 * a); }
  setSeg(i, tint, labA) {
    const s = this.segs[i]; s.m3.material.color.setHex(tint);
    if (s.lab3) this.base(s.lab3, labA);
  }
  setDome(a) { this.base(this.dome, a); }
  setHubOffset(z) { this.hub.position.z = z; }
  // ---- 文字(立体の看板) ----
  makeTitle(id) {
    const g = new THREE.Group(); g.visible = false; this.scene.add(g);
    const base = 1800, h = 640;
    const T = { g, id };
    T.shadow = this.plane(this.basic(`rl_t_${id}_shadow.png`, { opacity: 0.85 }), base, h, -90, g);
    // 厚み: 面を奥へ重ねて側面にする
    T.layers = [];
    const N = 16;
    for (let i = N; i >= 1; i--) {
      const sh = 0.12 + 0.2 * (1 - i / N);
      const m = this.plane(this.basic(`rl_t_${id}_face.png`, { color: new THREE.Color(sh, sh * 0.55, sh * 0.6).getHex() }), base, h, -i * 3.2, g);
      T.layers.push(m);
    }
    T.face = this.plane(this.basic(`rl_t_${id}_face.png`), base, h, 0, g);
    T.glow = this.plane(this.additive(`rl_t_${id}_glow.png`), base * 1.0, h * 1.0, 6, g);
    T.shine = this.plane(new THREE.ShaderMaterial({
      uniforms: { map: { value: this.T(`rl_t_${id}_face.png`) }, op: { value: 0 }, pos: { value: -1 }, wid: { value: 0.07 } },
      vertexShader: PLAIN_VS, fragmentShader: SHINE_FS, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    }), base, h, 8, g);
    return (this.titles[id] = T);
  }
  setTitle(id, o) {
    const T = this.titles[id] || this.makeTitle(id), g = T.g;
    g.visible = !!o.vis; if (!o.vis) return;
    g.position.set(o.x || 0, o.y || 0, o.z || 0); g.scale.setScalar(o.s ?? 1);
    g.rotation.set((o.rx || 0) * D2R, (o.ry || 0) * D2R, (o.rz || 0) * D2R);
    const a = o.alpha ?? 1;
    T.face.material.opacity = a; T.shadow.material.opacity = 0.85 * a;
    for (const l of T.layers) l.material.opacity = a;
    T.glow.material.uniforms.op.value = (o.glow ?? 1) * a;
    T.shine.material.uniforms.pos.value = o.shine ?? -1; T.shine.material.uniforms.op.value = a * 0.9;
  }
  // ---- 砕けるガラス(直前の画面を破片にして手前へ飛ばす) ----
  shatter(snapCanvas, cx = 0, cy = 0, cols = 18, rows = 10) {
    this.clearShards();
    const tex = new THREE.CanvasTexture(snapCanvas); tex.colorSpace = THREE.NoColorSpace;
    const W = this.ww - 200, H = this.wh - 200;   // 画面(余白を除く)
    const pts = [];
    for (let j = 0; j <= rows; j++) { pts.push([]); for (let i = 0; i <= cols; i++) {
      const jx = (i === 0 || i === cols) ? 0 : (Math.random() - .5) * 0.7, jy = (j === 0 || j === rows) ? 0 : (Math.random() - .5) * 0.7;
      pts[j].push([(i + jx) / cols, (j + jy) / rows]);
    } }
    const grp = new THREE.Group(); this.scene.add(grp);
    const N = cols * rows * 2, V = N * 3;
    const pos = new THREE.BufferAttribute(new Float32Array(V * 3), 3);
    const uv = new THREE.BufferAttribute(new Float32Array(V * 2), 2);
    const matrices = new THREE.BufferAttribute(new Float32Array(V * 16), 16).setUsage(THREE.DynamicDrawUsage);
    const tint = new THREE.BufferAttribute(new Float32Array(V * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const edge = new THREE.BufferAttribute(new Float32Array(V), 1).setUsage(THREE.DynamicDrawUsage);
    let geo, edgeGeo, mesh, line;
    const list = [];
    const mk = (a, b, c) => {
      const index = list.length, v = index * 3;
      // 元は1破片につき5オブジェクト×UUIDの乱数4個を消費した。
      // バッチ用5個を最初、線geometryを2枚目の同じ消費枠で作り、残りは読み捨てる。
      // これにより固定seedの形・速度と、shatter後の他演出の乱数列も変えない。
      if (index === 0) {
        geo = new THREE.BufferGeometry();
        const mat = shardMaterial(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
        // 三角形1枚は表か裏のどちらかだけに寄与する。両面2パスと同じ合成順。
        mat.forceSinglePass = true;
        mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 900; mesh.frustumCulled = false; grp.add(mesh);
        line = new THREE.LineSegments(geo, shardMaterial(new THREE.LineBasicMaterial({ color: 0xff7a60, transparent: true, depthTest: false, depthWrite: false, linewidth: 1 }), true));
        line.renderOrder = 901; line.frustumCulled = false; grp.add(line);
      } else if (index === 1) {
        edgeGeo = new THREE.BufferGeometry(); line.geometry = edgeGeo;
      }
      for (let n = index === 0 ? 20 : index === 1 ? 4 : 0; n < 20; n++) Math.random();
      const mx = (a[0] + b[0] + c[0]) / 3, my = (a[1] + b[1] + c[1]) / 3;
      const P = [a, b, c].map(p => [(p[0] - mx) * W, -(p[1] - my) * H, 0]);
      pos.array.set(P.flat(), v * 3);
      uv.array.set([a, b, c].flatMap(p => [p[0], 1 - p[1]]), v * 2);
      // threeの透明オブジェクトのソート基準はgeometryのboundingSphere中心。
      // 重心(0,0)とは異なるため、元と同じfloat32頂点のbbox中心を保持する。
      const p = pos.array, off = v * 3;
      const center = new THREE.Vector3(
        (Math.min(p[off], p[off + 3], p[off + 6]) + Math.max(p[off], p[off + 3], p[off + 6])) * .5,
        (Math.min(p[off + 1], p[off + 4], p[off + 7]) + Math.max(p[off + 1], p[off + 4], p[off + 7])) * .5, 0);
      // Object3DのEuler→Quaternion→Matrix4と同じ計算。UUIDもsceneノードも不要。
      const m = { position: new THREE.Vector3(), rotation: new THREE.Euler(), quaternion: new THREE.Quaternion(), matrix: new THREE.Matrix4() };
      const px = (mx - .5) * W, py = -(my - .5) * H;
      m.position.set(px, py, 0);
      const dx = px - cx, dy = py - cy, dist = Math.hypot(dx, dy) + 1;
      const sp = 700 + 900 / (1 + dist / 500);
      list.push({ m, index, center, depth: 0, opacity: 1, edgeOpacity: 0, color: new THREE.Color(1, 1, 1), px, py, vx: dx / dist * sp * (0.6 + Math.random() * 0.8), vy: dy / dist * sp * (0.6 + Math.random() * 0.8) + 200,
        vz: 500 + Math.random() * 1700 + 1400 / (1 + dist / 400), ax: (Math.random() - .5) * 9, ay: (Math.random() - .5) * 9, az: (Math.random() - .5) * 9,
        delay: Math.min(0.28, dist / 4200) + Math.random() * 0.03 });
    };
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const p00 = pts[j][i], p10 = pts[j][i + 1], p01 = pts[j + 1][i], p11 = pts[j + 1][i + 1];
      if ((i + j) & 1) { mk(p00, p10, p11); mk(p00, p11, p01); } else { mk(p00, p10, p01); mk(p10, p11, p01); }
    }
    for (const g of [geo, edgeGeo]) {
      g.setAttribute('position', pos); g.setAttribute('uv', uv);
      g.setAttribute('shardModelView', matrices); g.setAttribute('shardTint', tint); g.setAttribute('shardEdge', edge);
    }
    const IndexArray = V > 65535 ? Uint32Array : Uint16Array;
    geo.setIndex(new THREE.BufferAttribute(new IndexArray(V), 1).setUsage(THREE.DynamicDrawUsage));
    edgeGeo.setIndex(new THREE.BufferAttribute(new IndexArray(N * 6), 1).setUsage(THREE.DynamicDrawUsage));
    this.shards = { grp, list, tex, mesh, line, matrices, tint, edge, order: list.slice(),
      modelView: new THREE.Matrix4(), projScreen: new THREE.Matrix4(), projected: new THREE.Vector4(), scale: new THREE.Vector3(1, 1, 1),
      compare: (a, b) => b.depth - a.depth || a.index - b.index };
    this.updateShards(0);
  }
  updateShards(tl) {
    const S = this.shards; if (!S) return;
    let alive = 0;
    for (const s of S.list) {
      const t = tl - s.delay; const m = s.m;
      if (t <= 0) { m.position.set(s.px, s.py, 0); m.rotation.set(0, 0, 0); s.opacity = 1; s.color.setRGB(1, 1, 1); alive++; continue; }
      m.position.set(s.px + s.vx * t, s.py + s.vy * t - 1400 * t * t, s.vz * t);
      m.rotation.set(s.ax * t, s.ay * t, s.az * t);
      const f = Math.min(1, Math.max(0, (t - 0.35) / 0.9));
      s.opacity = 1 - f;
      s.edgeOpacity = Math.min(1, t / 0.08) * (1 - f) * 0.85;
      const c = 1 - 0.3 * Math.min(1, t / 0.5); s.color.setRGB(c, c * 0.7, c * 0.72);
      if (f < 1) alive++;
    }
    if (!alive) this.clearShards();
  }
  prepareShards() {
    const S = this.shards; if (!S) return;
    // render直前に更新。カメラだけを動かして再描画する場合も元のMeshと一致させる。
    this.cam.updateMatrixWorld();
    S.projScreen.multiplyMatrices(this.cam.projectionMatrix, this.cam.matrixWorldInverse);
    const ma = S.matrices.array, ca = S.tint.array, ea = S.edge.array;
    for (const s of S.list) {
      s.m.quaternion.setFromEuler(s.m.rotation);
      s.m.matrix.compose(s.m.position, s.m.quaternion, S.scale);
      S.modelView.multiplyMatrices(this.cam.matrixWorldInverse, s.m.matrix);
      const me = S.modelView.elements;
      for (let v = s.index * 3; v < s.index * 3 + 3; v++) {
        for (let k = 0; k < 16; k++) ma[v * 16 + k] = me[k];
        ca[v * 4] = s.color.r; ca[v * 4 + 1] = s.color.g; ca[v * 4 + 2] = s.color.b; ca[v * 4 + 3] = s.opacity;
        ea[v] = s.edgeOpacity;
      }
      // Vector4は透視除算しない。threeのreversePainterSortStableと同じclip-space z。
      s.depth = S.projected.copy(s.center).applyMatrix4(s.m.matrix).applyMatrix4(S.projScreen).z;
    }
    S.order.sort(S.compare);
    const fi = S.mesh.geometry.index.array, wi = S.line.geometry.index.array;
    for (let i = 0; i < S.order.length; i++) {
      const v = S.order[i].index * 3, f = i * 3, w = i * 6;
      fi[f] = v; fi[f + 1] = v + 1; fi[f + 2] = v + 2;
      wi[w] = v; wi[w + 1] = v + 1; wi[w + 2] = v + 1; wi[w + 3] = v + 2; wi[w + 4] = v + 2; wi[w + 5] = v;
    }
    S.matrices.needsUpdate = S.tint.needsUpdate = S.edge.needsUpdate = true;
    S.mesh.geometry.index.needsUpdate = S.line.geometry.index.needsUpdate = true;
  }
  clearShards() {
    if (!this.shards) return;
    this.scene.remove(this.shards.grp);
    for (const m of [this.shards.mesh, this.shards.line]) { m.geometry.dispose(); m.material.dispose(); }
    this.shards.tex.dispose(); this.shards = null;
  }
  // ---- 火の粉・粒(奥行きをもって流れる) ----
  buildParticles() {
    const N = this.PN = 900;
    const geo = new THREE.BufferGeometry();
    this.pp = { pos: new Float32Array(N * 3), size: new Float32Array(N), alpha: new Float32Array(N), color: new Float32Array(N * 3), vel: new Float32Array(N * 3), life: new Float32Array(N), max: new Float32Array(N), kind: new Uint8Array(N), grav: new Float32Array(N) };
    geo.setAttribute('position', new THREE.BufferAttribute(this.pp.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.pp.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.pp.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pp.color, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 1 } }, vertexShader: PT_VS, fragmentShader: PT_FS, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.points = new THREE.Points(geo, mat); this.points.frustumCulled = false; this.points.renderOrder = 500; this.scene.add(this.points);
    this.pnext = 0; this.ambientRate = 0;
  }
  spawn(x, y, z, vx, vy, vz, life, size, color, grav = 0) {
    const p = this.pp, i = this.pnext; this.pnext = (this.pnext + 1) % this.PN;
    p.pos[i * 3] = x; p.pos[i * 3 + 1] = y; p.pos[i * 3 + 2] = z; p.vel[i * 3] = vx; p.vel[i * 3 + 1] = vy; p.vel[i * 3 + 2] = vz;
    p.life[i] = life; p.max[i] = life; p.size[i] = size; p.grav[i] = grav;
    const c = new THREE.Color(color); p.color[i * 3] = c.r; p.color[i * 3 + 1] = c.g; p.color[i * 3 + 2] = c.b;
  }
  // 中心から全方向へ(奥行きも使う)
  burst(x, y, z, n, o = {}) {
    for (let i = 0; i < n; i++) {
      const th = Math.random() * 6.283, ph = Math.acos(2 * Math.random() - 1), sp = (o.speed || 1400) * (0.3 + Math.random() * 0.9);
      this.spawn(x, y, z, Math.sin(ph) * Math.cos(th) * sp, Math.sin(ph) * Math.sin(th) * sp, Math.cos(ph) * sp * (o.zk ?? 1.2),
        (o.life || 1.4) * (0.5 + Math.random()), (o.size || 60) * (0.4 + Math.random() * 1.1), o.color ?? [0xff5a3a, 0xff9a60, 0xffe0c0][(Math.random() * 3) | 0], o.grav ?? 500);
    }
  }
  // 常に漂う赤い粒(奥行きの手がかり)
  ambient(dt, rate, zr = [-1800, 1800]) {
    this.ambAcc = (this.ambAcc || 0) + dt * rate;
    while (this.ambAcc >= 1) {
      this.ambAcc -= 1;
      const z = zr[0] + Math.random() * (zr[1] - zr[0]);
      this.spawn((Math.random() - .5) * 3600, -900 - Math.random() * 200, z, (Math.random() - .5) * 60, 160 + Math.random() * 280, (Math.random() - .5) * 120,
        3 + Math.random() * 3, 14 + Math.random() * 30, [0xff3a2a, 0xff6a3a, 0xc01a28][(Math.random() * 3) | 0], -40);
    }
  }
  updateParticles(dt) {
    const p = this.pp, N = this.PN;
    for (let i = 0; i < N; i++) {
      if (p.life[i] <= 0) { p.alpha[i] = 0; continue; }
      p.life[i] -= dt;
      p.vel[i * 3 + 1] -= p.grav[i] * dt;
      p.pos[i * 3] += p.vel[i * 3] * dt; p.pos[i * 3 + 1] += p.vel[i * 3 + 1] * dt; p.pos[i * 3 + 2] += p.vel[i * 3 + 2] * dt;
      const u = p.life[i] / p.max[i];
      p.alpha[i] = Math.min(1, u * 3) * Math.min(1, (1 - u) * 12) * 0.9;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = g.attributes.alpha.needsUpdate = g.attributes.size.needsUpdate = g.attributes.color.needsUpdate = true;
    this.points.material.uniforms.scale.value = this.r.domElement.height / (2 * Math.tan(this.camState.fov * D2R / 2));
  }
  clearParticles() { this.pp.life.fill(0); this.pp.alpha.fill(0); }
  render() {
    this.prepareShards();
    if (this.regs) for (const m of this.regs) { const v = m.userData.base * this.discAlpha; if (m.material.uniforms) m.material.uniforms.op.value = v; else m.material.opacity = v; }
    this.r.render(this.scene, this.cam);
  }
}
