import * as THREE from '../vendor/three/three.module.js';

// Final user choice: six fish at six lamps; the last value also selects the dense mode.
export const COUNT = Object.freeze([1, 2, 3, 4, 5, 5, 6]);
export const SETTINGS = Object.freeze({
  spriteScale: 3, transitionSec: 1.5,
  bubbles: 42, petals: 32, snow: 130, causticsStrength: 0.075, seed: 80321,
});
export const REFERENCE = Object.freeze({ width: 770, height: 500 });
const TAU = Math.PI * 2;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const smooth = t => t * t * (3 - 2 * t);
const vertex = `precision highp float;
 attribute vec3 position; attribute vec2 uv;
 uniform mat4 projectionMatrix, modelViewMatrix;
 varying vec2 vUv;
 void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const imageFragment = `precision highp float;
 uniform sampler2D image; uniform float opacity; varying vec2 vUv;
 void main(){vec4 c=texture2D(image,vUv);gl_FragColor=vec4(c.rgb,c.a*opacity);}`;

function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function surface(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
function quad(w, h, nx = 1, ny = 1) {
  const g = new THREE.PlaneGeometry(w, h, nx, ny);
  // ImageBitmap upload uses top-left source rows. Coordinates are screen pixels, Y down.
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + w / 2, -p.getY(i) + h / 2, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  return g;
}
function material(fragment, uniforms, additive = false, v = vertex) {
  return new THREE.RawShaderMaterial({
    vertexShader: v, fragmentShader: fragment, uniforms,
    transparent: true, depthTest: false, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}
async function bitmap(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot load ${url}: HTTP ${response.status}`);
  return createImageBitmap(await response.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}
function texture(b, nearest = false) {
  const t = new THREE.Texture(b);
  t.flipY = false; t.generateMipmaps = false;
  t.minFilter = t.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  // Raw shaders preserve source sRGB bytes, especially the unmodified sprite palette.
  t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true; return t;
}

/** A manifest-sized, deterministic, self-contained liquid-crystal screen renderer.
 * No RAF, DOM, audio, network dependencies, or host-scene state is owned by this class.
 * init() loads only the given manifest and local image URLs.
 */
export class NormalScreen {
  constructor({ canvas, manifestUrl, upaEnabled = false }) {
    if (!canvas || !manifestUrl) throw new TypeError('canvas and manifestUrl are required');
    this.canvas = canvas;
    this.upaEnabled = Boolean(upaEnabled);
    this.manifestUrl = new URL(manifestUrl, globalThis.location?.href || import.meta.url);
    this.time = 0; this.lamps = 0; this.debug = false; this.ready = false; this.disposed = false;
    this.dense = false; this.layoutUntil = 0;
    this.layers = []; this.sprites = []; this.bitmaps = []; this.textures = [];
    this.anchors = []; this.crowdAnchors = []; this.upaPrepared = false;
    this.causticsStrength = SETTINGS.causticsStrength;
  }

  async init() {
    if (this.disposed || this.ready) throw new Error('init() requires a new instance');
    try {
      const response = await fetch(this.manifestUrl);
      if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
      this.manifest = await response.json();
      if (!Array.isArray(this.manifest.size) || this.manifest.size.length !== 2
        || !this.manifest.size.every(n => Number.isSafeInteger(n) && n > 0) || !Array.isArray(this.manifest.layers))
        throw new Error('manifest requires size:[positive integer width,height] and layers:[]');
      [this.W, this.H] = this.manifest.size;
      this.K = this.W / REFERENCE.width;
      this.spriteScale = Math.max(1, Math.round(SETTINGS.spriteScale * this.K));
      this.SW = 46 * this.spriteScale; this.SH = 21 * this.spriteScale;
      this.GAP = this.SW + 14 * this.K;
      const { W, H } = this;
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: false, antialias: false,
        premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(1); this.renderer.setSize(W, H, false);
      this.renderer.setClearColor(0x073457, 1);
      this.renderer.sortObjects = true;
      this.renderer.info.autoReset = false;
      this.scene = new THREE.Scene();
      this.camera = new THREE.OrthographicCamera(0, W, 0, H, -10, 10);
      this.backgroundTarget = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false, stencilBuffer: false,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      this.copyScene = new THREE.Scene();
      this.copyScene.add(new THREE.Mesh(quad(W, H), material(imageFragment.replace('texture2D(image,vUv)',
        'texture2D(image,vec2(vUv.x,1.-vUv.y))'),
      { image: { value: this.backgroundTarget.texture }, opacity: { value: 1 } })));
      // Start every image request at once (phones pay a round trip per sequential request).
      this.pending = new Map();
      const spriteBase = new URL(this.manifest.sprites?.base || '../sprites/', this.manifestUrl);
      const names = this.manifest.sprites?.files || ['upa_source.png', 'sprite_calm.png', 'sprite_smile.png', 'sprite_happy.png'];
      for (const spec of this.manifest.layers) if (spec.file && spec.name !== 'open_mask') this.loadTexture(new URL(spec.file, this.manifestUrl));
      for (const file of names) this.loadTexture(new URL(file, spriteBase), true);
      for (const [index, spec] of this.manifest.layers.entries()) {
        if (spec.name === 'open_mask' || spec.name === 'CM_caustic_mask' || spec.kind === 'data' || spec.blend === 'data') continue;
        if (!['normal', 'over', 'add', 'additive'].includes(spec.blend || 'normal'))
          throw new Error(`Unsupported blend: ${spec.blend}`);
        const tex = await this.loadTexture(new URL(spec.file, this.manifestUrl));
        if (spec.name === 'FX_shafts') { this.addShafts(spec, tex, index); continue; }
        const geom = this.backgroundQuad(spec);
        const mesh = new THREE.Mesh(geom, material(imageFragment,
          { image: { value: tex }, opacity: { value: spec.opacity ?? 1 } }, ['add', 'additive'].includes(spec.blend)));
        mesh.renderOrder = index;
        this.scene.add(mesh);
        this.layers.push({ spec, mesh, base: geom.attributes.position.array.slice() });
      }
      const cm = this.manifest.layers.find(l => l.name === 'CM_caustic_mask');
      this.causticMask = cm ? await this.loadTexture(new URL(cm.file, this.manifestUrl)) : null;
      await this.loadMask();
      this.spriteTextures = [];
      for (const file of names) {
        const tex = await this.loadTexture(new URL(file, spriteBase), true);
        if (tex.image.width !== 46 || tex.image.height !== 21) throw new Error('Sprite must be exactly 46×21');
        this.spriteTextures.push(tex);
      }
      if (!this.spriteTextures.length) throw new Error('At least one sprite is required');
      this.addCaustics(); this.addParticles(); this.addDebug();
      this.ready = true;
      // Initial lamps are a settled snapshot; subsequent changes animate.
      if (this.upaEnabled) this.prepareUpa();
      this.update(0); this.render();
      return this;
    } catch (error) { this.dispose(); throw error; }
  }

  loadTexture(url, nearest = false) {
    const key = `${url.href}|${nearest}`;
    if (!this.pending.has(key)) this.pending.set(key, (async () => {
      const b = await bitmap(url); this.bitmaps.push(b);
      const t = texture(b, nearest); this.textures.push(t); return t;
    })());
    return this.pending.get(key);
  }

  backgroundQuad(spec) {
    const {W,H,K}=this, p=spec.parallax||[0,0], a=spec.sway ? (spec.sway.amp||[2,0.6]) : [0,0];
    const motionX=(Math.abs(p[0])+Math.abs(a[0])+(spec.name==='FX_shafts'?8:0))*K;
    const motionY=(Math.abs(p[1])+Math.abs(a[1]))*K;
    // Scale the entire PNG uniformly around the screen center; never extend edge texels.
    const scale=spec.name==='L0_far'||!(motionX||motionY)?1:Math.max(1+2*(motionX+1)/W,1+2*(motionY+1)/H);
    const px=W*(scale-1)/2,py=H*(scale-1)/2;
    const g=quad(W*scale,H*scale,spec.sway?32:1,spec.sway?20:1),pos=g.attributes.position;
    for(let i=0;i<pos.count;i++)pos.setXY(i,pos.getX(i)-px,pos.getY(i)-py);
    g.userData.overscan={scale,motionX,motionY,paddingX:px,paddingY:py};
    return g;
  }

  isVisible(p) { return p.x < this.W && p.x + this.SW > 0 && p.y < this.H && p.y + this.SH > 0; }
  conflicts(a, b) { return this.isVisible(a) && this.isVisible(b) && distance(a, b) < this.GAP; }

  ensureAnchors() {
    const count = COUNT[this.lamps];
    if (this.dense) {
      if (this.crowdAnchors.length < count) this.crowdAnchors = this.findCrowdAnchors(count);
    } else if (this.anchors.length < count) this.anchors = this.findAnchors(count);
  }

  prepareUpa() {
    this.ensureAnchors();
    for (let id = 0; id < COUNT[this.lamps]; id++) if (!this.sprites.some(s => s.id === id)) this.createSprite(id, false);
    this.upaPrepared = true;
  }

  addShafts(spec, tex, order) {
    const { W, H, K } = this;
    if (spec.beamBoundaries !== undefined && !Array.isArray(spec.beamBoundaries))
      throw new Error('FX_shafts.beamBoundaries must be an array of reference px boundaries');
    let boundaries = spec.beamBoundaries?.map(x => x * K);
    if (boundaries) {
      if (!Array.isArray(boundaries) || boundaries.length < 2 || boundaries[0] !== 0 || Math.abs(boundaries.at(-1) - W) > 1e-6
        || boundaries.some((x, i) => !Number.isFinite(x) || (i && x <= boundaries[i - 1])))
        throw new Error(`FX_shafts.beamBoundaries must ascend from 0 to ${REFERENCE.width} reference px`);
    } else {
      // Locate individual beams in a single static PNG from the top-quarter luminance profile.
      const c = surface(W, H), ctx = c.getContext('2d'); ctx.drawImage(tex.image, 0, 0, W, H);
      const pixels = ctx.getImageData(0, 0, W, H).data, profile = new Float64Array(W), smoothed = new Float64Array(W);
      for (let x = 0; x < W; x++) for (let y = 0; y < H / 4; y++) {
        const k = (y * W + x) * 4; profile[x] += (pixels[k] + pixels[k + 1] + pixels[k + 2]) * pixels[k + 3] / 765;
      }
      const radius = Math.max(1, Math.round(6 * K));
      for (let x = 0; x < W; x++) {
        for (let dx = -radius; dx <= radius; dx++) smoothed[x] += profile[Math.max(0, Math.min(W - 1, x + dx))] / (radius * 2 + 1);
      }
      const max = Math.max(...smoothed), candidates = [];
      for (let x = 1; x < W - 1; x++) if (smoothed[x] > max * 0.12 && smoothed[x] >= smoothed[x - 1] && smoothed[x] > smoothed[x + 1]) candidates.push(x);
      const peaks = [];
      for (const x of candidates.sort((a, b) => smoothed[b] - smoothed[a]))
        if (peaks.length < 12 && peaks.every(p => Math.abs(p - x) > 36 * K)) peaks.push(x);
      peaks.sort((a, b) => a - b); boundaries = [0];
      for (let i = 1; i < peaks.length; i++) {
        let valley = Math.round((peaks[i - 1] + peaks[i]) / 2);
        for (let x = peaks[i - 1] + 1; x < peaks[i]; x++) if (smoothed[x] < smoothed[valley]) valley = x;
        boundaries.push(valley);
      }
      boundaries.push(W);
    }
    const fragment = `precision highp float; varying vec2 vUv;
      uniform sampler2D image; uniform vec2 resolution; uniform float imageWidth,pixelScale,time,phase,beamIndex,leftEdge,rightEdge,opacity;
      void main(){float sway=8.*pixelScale*sin(time*6.2831853/(30.+beamIndex*1.3)+phase);
        vec2 uv=vUv-vec2(sway/imageWidth,0.);float feather=6.*pixelScale/imageWidth;
        float gate=(leftEdge<=0.?1.:smoothstep(leftEdge-feather,leftEdge+feather,uv.x))
          *(rightEdge>=1.?1.:1.-smoothstep(rightEdge-feather,rightEdge+feather,uv.x));
        if(uv.x<0.||uv.x>1.)gate=0.;
        vec4 c=texture2D(image,uv);float pulse=1.+0.15*sin(time*6.2831853/(17.+beamIndex*0.9)+phase*1.41);
        gl_FragColor=vec4(c.rgb*pulse,c.a*opacity*gate);}`;
    for (let i = 0; i < boundaries.length - 1; i++) {
      const geom = this.backgroundQuad(spec);
      const mesh = new THREE.Mesh(geom, material(fragment, { image: { value: tex }, opacity: { value: spec.opacity ?? 1 },
        resolution: { value: new THREE.Vector2(W,H) }, pixelScale: { value: K },
        imageWidth: { value: W*geom.userData.overscan.scale },
        time: { value: 0 }, phase: { value: (spec.phase ?? 0) + i * 2.3999632297 }, beamIndex: { value: i },
        leftEdge: { value: boundaries[i] / W }, rightEdge: { value: boundaries[i + 1] / W } }, true));
      mesh.renderOrder = order; this.scene.add(mesh);
      this.layers.push({ spec, mesh, beamIndex: i, base: geom.attributes.position.array.slice() });
    }
  }

  async loadMask() {
    const { W, H } = this;
    const c = surface(W, H), ctx = c.getContext('2d', { willReadFrequently: true });
    const entry = this.manifest.layers.find(l => l.name === 'open_mask');
    const file = this.manifest.open_mask?.file || this.manifest.open_mask || entry?.file;
    this.maskSource = file ? 'manifest' : 'fallback';
    if (file) {
      const b = await bitmap(new URL(file, this.manifestUrl));
      ctx.drawImage(b, 0, 0, W, H); b.close();
    } else {
      // Conservative water silhouette for the supplied temporary L0; no pink canopy.
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H * 92 / REFERENCE.height);
      ctx.fillRect(W * 280 / REFERENCE.width, 0, W * 160 / REFERENCE.width, H * 255 / REFERENCE.height);
    }
    const rgba = ctx.getImageData(0, 0, W, H).data;
    this.mask = new Uint8Array(W * H);
    this.integral = new Uint32Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) {
        const k = y * W + x, ok = rgba[k * 4] >= 128 && rgba[k * 4 + 3] >= 128;
        this.mask[k] = ok ? 1 : 0; row += ok ? 0 : 1;
        this.integral[(y + 1) * (W + 1) + x + 1] = this.integral[y * (W + 1) + x + 1] + row;
      }
    }
  }

  allowed(p, outside = false) {
    const { W, H, SW, SH } = this;
    const x = Math.round(p.x), y = Math.round(p.y);
    if (!outside && (x < 0 || y < 0 || x + SW > W || y + SH > H)) return false;
    const l = Math.max(0, x), t = Math.max(0, y), r = Math.min(W, x + SW), b = Math.min(H, y + SH);
    if (r <= l || b <= t) return outside;
    const s = W + 1, a = this.integral;
    return a[b * s + r] - a[t * s + r] - a[b * s + l] + a[t * s + l] === 0;
  }

  findAnchors(count = 5) {
    const { W, H, K, SW, SH, GAP } = this;
    const preferred = [{ x: 291, y: 177 }, { x: 17, y: 13 }, { x: 608, y: 13 }, { x: 214, y: 13 }, { x: 411, y: 13 }]
      .map(p => ({x:p.x / REFERENCE.width, y:p.y / REFERENCE.height}));
    const found = [];
    for (const point of preferred.slice(0, count)) {
      const target = { x: Math.round(point.x * W), y: Math.round(point.y * H) };
      let best = null, score = Infinity;
      const consider = p => {
        if (!this.allowed(p) || found.some(q => distance(p, q) < GAP + 24 * K)) return;
        const d = distance(p, target); if (d < score) { best = p; score = d; }
      };
      consider(target);
      if (!best) for (let y = Math.ceil(2*K); y <= H - SH - 2*K; y += Math.max(1,Math.round(4*K)))
        for (let x = Math.ceil(2*K); x <= W - SW - 2*K; x += Math.max(1,Math.round(4*K))) consider({ x, y });
      if (!best) throw new Error(`open_mask cannot fit ${count} separated ${SW}×${SH} sprites; enlarge the open water region or leave Upa disabled`);
      found.push(best);
    }
    return found;
  }

  findCrowdAnchors(count = 6) {
    const { W, H, K, SW, SH } = this;
    // Alternate non-crossing depth lanes: adjacent fish overlap but never swap depth.
    const preferred = [{ x: 291, y: 177 }, { x: 135, y: 9 }, { x: 423, y: 21 },
      { x: 231, y: 21 }, { x: 327, y: 9 }, { x: 291, y: 124 }]
      .map(p => ({x:p.x / REFERENCE.width, y:p.y / REFERENCE.height}));
    const found = [];
    for (const point of preferred.slice(0, count)) {
      const target = { x: Math.round(point.x * W), y: Math.round(point.y * H) };
      let best = null, score = Infinity;
      const consider = p => {
        if (!this.allowed(p) || found.some(q => distance(p, q) < 48*K)) return;
        const d = distance(p, target); if (d < score) { best = p; score = d; }
      };
      consider(target);
      if (!best) for (let y = Math.ceil(2*K); y <= H - SH - 2*K; y += Math.max(1,Math.round(4*K)))
        for (let x = Math.ceil(2*K); x <= W - SW - 2*K; x += Math.max(1,Math.round(4*K))) consider({ x, y });
      if (!best) throw new Error(`open_mask cannot fit ${count} crowded ${SW}×${SH} sprites; leave Upa disabled or adjust the mask`);
      found.push(best);
    }
    return found;
  }

  overlapAllowed() { return this.dense || this.time < this.layoutUntil - 1e-8; }

  createSprite(id, enter) {
    const { W, K, SW, SH, GAP } = this;
    const mesh = new THREE.Mesh(quad(SW, SH), material(imageFragment,
      { image: { value: this.spriteTextures[id % this.spriteTextures.length] }, opacity: { value: 1 } }));
    mesh.layers.set(2); mesh.renderOrder = 1000 + id; this.scene.add(mesh);
    const goal = this.orbit(id), s = { id, mesh, ...goal, state: 'steady', elapsed: 0 };
    this.sprites.push(s);
    if (enter) {
      s.x = goal.x + SW / 2 < W / 2 ? -SW - 16*K : W + 16*K;
      s.y = goal.y - (id >= 3 ? GAP + 24*K : 0);
      s.x = Math.round(s.x); s.y = Math.round(s.y);
      this.startRoute(s, 'entering', goal);
    }
    mesh.position.set(s.x, s.y, 0);
    return s;
  }

  orbit(id) {
    const { H, K, GAP } = this;
    const anchors = this.dense || id >= this.anchors.length ? this.crowdAnchors : this.anchors;
    const a = anchors[id], phase = id * 1.73, t = this.time;
    const narrow = a.y > H * 92 / REFERENCE.height;
    const p = {
      x: Math.round(a.x + (narrow ? 4 : this.dense ? 10 : 8) * K * Math.sin(TAU * t / (14 + id * 1.5) + phase)),
      y: Math.round(a.y + (narrow ? 4 : this.dense ? 1 : 5) * K * Math.sin(TAU * t / (18 + id * 0.7) + phase * 0.7)
        + 3 * K * Math.sin(TAU * t / (2.6 + id * 0.27) + phase)),
    };
    return this.allowed(p) && (this.dense || id >= this.anchors.length || anchors.every((q, j) => j === id || distance(p, q) >= GAP + 12*K)) ? p : { ...a };
  }

  setLamps(n) {
    const { W, K, SW } = this;
    if (!Number.isInteger(n) || n < 0 || n > 6) throw new RangeError('lamps must be an integer from 0 to 6');
    const dense = n >= 4 && COUNT[6] > 5;   // 4灯(5匹)は間隔を空けて置ける場所が無く3匹に落ちていたため、4灯から混み合い配置にする(10/17)
    const layoutChanged = this.dense !== dense;
    this.lamps = n; this.dense = dense;
    if (!this.ready || !this.upaEnabled) return;
    if (!this.upaPrepared) { this.prepareUpa(); return; }
    this.ensureAnchors();
    if (layoutChanged) this.layoutUntil = this.time + SETTINGS.transitionSec;
    const count = COUNT[n];
    // IDs encode arrival order. Removing highest IDs implements last in, first out.
    for (const s of [...this.sprites].sort((a, b) => b.id - a.id)) {
      if (s.id >= count && (s.state !== 'exiting' || layoutChanged)) {
        this.startRoute(s, 'exiting', { x: Math.round(s.x + SW / 2 < W / 2 ? -SW - 16*K : W + 16*K), y: s.y });
      } else if (s.id < count && (s.state === 'exiting' || layoutChanged))
        this.startRoute(s, s.state === 'exiting' ? 'entering' : 'reflowing', this.orbit(s.id));
    }
    for (let id = 0; id < count; id++) if (!this.sprites.some(s => s.id === id)) this.createSprite(id, true);
    this.updateSpriteOrder();
  }

  startRoute(s, state, goal) {
    s.route = this.planRoute({ x: s.x, y: s.y }, goal, s.id);
    s.state = state; s.elapsed = 0;
    s.lengths = [0];
    for (let i = 1; i < s.route.length; i++) s.lengths.push(s.lengths[i - 1] + distance(s.route[i - 1], s.route[i]));
  }

  planRoute(start, goal, id) {
    const { W, H, K, SW, SH, GAP } = this;
    const relaxed = this.overlapAllowed();
    const safe = p => this.allowed(p, true) && (relaxed || this.anchors.every((q, j) => j === id || distance(p, q) >= GAP + 14*K));
    const lineSafe = (a, b) => {
      const steps = Math.ceil(distance(a, b) / Math.max(1,3*K));
      for (let i = 1; i <= steps; i++) if (!safe({ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps })) return false;
      return true;
    };
    if (lineSafe(start, goal)) return [start, goal];
    // A* includes an offscreen top corridor, so entrants can pass above occupied slots.
    const step = Math.max(1,Math.round(12*K)), minX = -SW - Math.ceil(24*K), minY = Math.floor(-SH - GAP - 24*K);
    const cols = Math.ceil((W + SW + 48*K) / step) + 1, rows = Math.ceil((H - minY) / step) + 1;
    const point = k => ({ x: minX + (k % cols) * step, y: minY + Math.floor(k / cols) * step });
    const key = p => Math.round((p.y - minY) / step) * cols + Math.round((p.x - minX) / step);
    const first = key(start), open = new Set([first]), parent = new Map(), cost = new Map([[first, 0]]);
    let end = null;
    while (open.size) {
      let current = null, score = Infinity;
      for (const k of open) { const f = cost.get(k) + distance(point(k), goal); if (f < score) { score = f; current = k; } }
      open.delete(current);
      const p = current === first ? start : point(current);
      if (distance(p, goal) < step * 2 && lineSafe(p, goal)) { end = current; break; }
      const cx = current % cols, cy = Math.floor(current / cols);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || cx + dx < 0 || cx + dx >= cols || cy + dy < 0 || cy + dy >= rows) continue;
        const k = current + dy * cols + dx, q = point(k);
        const g = cost.get(current) + distance(p, q);
        if (g >= (cost.get(k) ?? Infinity) || !lineSafe(p, q)) continue;
        cost.set(k, g); parent.set(k, current); open.add(k);
      }
    }
    if (end === null) throw new Error(`No open water route to sprite ${id}; check open_mask connectivity`);
    const path = [goal];
    for (let k = end; k !== first; k = parent.get(k)) path.push(point(k));
    path.push(start); path.reverse();
    // Remove stair steps while retaining mask and separation clearance.
    const result = [start];
    for (let i = 0; i < path.length - 1;) {
      let j = path.length - 1; while (j > i + 1 && !lineSafe(path[i], path[j])) j--;
      result.push(path[j]); i = j;
    }
    return result;
  }

  routePosition(s, dt) {
    const elapsed = Math.min(SETTINGS.transitionSec, s.elapsed + dt);
    const d = smooth(elapsed / SETTINGS.transitionSec) * s.lengths.at(-1);
    let i = 1; while (i < s.lengths.length - 1 && s.lengths[i] < d) i++;
    const a = s.route[i - 1], b = s.route[i], u = (d - s.lengths[i - 1]) / (s.lengths[i] - s.lengths[i - 1] || 1);
    return { x: Math.round(a.x + (b.x - a.x) * u), y: Math.round(a.y + (b.y - a.y) * u), elapsed };
  }

  update(dtSec) {
    if (!this.ready || this.disposed) throw new Error('Call init() before update()');
    if (!Number.isFinite(dtSec) || dtSec < 0) throw new RangeError('dtSec must be finite and nonnegative');
    if (this.upaEnabled && !this.upaPrepared) this.prepareUpa();
    // Fixed substeps protect collision checks even when the host skips frames or seeks.
    const steps = Math.max(1, Math.ceil(dtSec * 60)), dt = dtSec / steps;
    for (let tick = 0; tick < steps; tick++) {
      this.time += dt;
      for (const s of this.upaEnabled ? [...this.sprites].sort((a, b) => b.id - a.id) : []) {
        const p = s.state === 'steady' ? this.orbit(s.id) : s.state === 'settling' ? { x: s.x, y: s.y } : this.routePosition(s, dt);
        // Transition clocks keep real time even if a rounded sample waits for clearance.
        if (s.state === 'entering' || s.state === 'exiting' || s.state === 'reflowing') s.elapsed = p.elapsed;
        if (!this.overlapAllowed() && this.sprites.some(q => q !== s && this.conflicts(p, q))) continue;
        s.x = p.x; s.y = p.y;
        if (s.state === 'entering' || s.state === 'exiting' || s.state === 'reflowing') {
          if (s.elapsed >= SETTINGS.transitionSec - 1e-8) {
            if (s.state === 'exiting') { this.removeSprite(s); continue; }
            s.state = 'settling';
            // Join the currently moving orbit without a discontinuity.
            s.join = { x: s.x, y: s.y }; s.joinTime = this.time;
          }
        }
        if (s.state === 'settling') {
          const goal = this.orbit(s.id), u = smooth(Math.min(1, (this.time - s.joinTime) / 0.5));
          const next = { x: Math.round(s.join.x + (goal.x - s.join.x) * u), y: Math.round(s.join.y + (goal.y - s.join.y) * u) };
          if (this.allowed(next) && (this.overlapAllowed() || !this.sprites.some(q => q !== s && this.conflicts(next, q)))) { s.x = next.x; s.y = next.y; }
          if (u === 1) s.state = 'steady';
        }
      }
    }
    this.updateLayers();
    this.caustics.material.uniforms.time.value = this.time;
    this.caustics.material.uniforms.strength.value = this.causticsStrength;
    for (const p of this.particles) p.material.uniforms.time.value = this.time;
    for (const s of this.sprites) s.mesh.position.set(s.x, s.y, 0);
    this.updateSpriteOrder();
    this.updateDebug();
  }

  updateSpriteOrder() {
    // Explicit unique ranks prevent transparent-material or sort-stability tie flicker.
    const sorted = [...this.sprites].sort((a, b) => a.y - b.y || a.id - b.id);
    sorted.forEach((s, rank) => { s.mesh.renderOrder = 1000 + rank; });
  }

  updateLayers() {
    const { W, H, K } = this;
    for (const { spec, mesh, base } of this.layers) {
      const t = this.time, p = spec.parallax || [0, 0];
      mesh.position.set(p[0] * K * Math.sin(TAU * t / 31), p[1] * K * Math.sin(TAU * t / 37 + 0.3), 0);
      if (mesh.material.uniforms.time) mesh.material.uniforms.time.value = t;
      mesh.material.uniforms.opacity.value = spec.opacity ?? 1;
      if (spec.sway) {
        const { amp = [2, 0.6], period = 8, phase = 0 } = spec.sway;
        if (!(period > 0)) throw new Error('sway.period must be positive');
        const pos = mesh.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const x = base[i * 3], y = base[i * 3 + 1], weight = Math.max(0,Math.min(1,1-y/H)) ** 2;
          const wave = Math.sin(TAU * t / period + phase + x / W * 1.8);
          pos.setXYZ(i, x + amp[0] * K * wave * weight, y + amp[1] * K * wave * weight, 0);
        }
        pos.needsUpdate = true;
      }
    }
  }

  addCaustics() {
    const { W, H, K } = this;
    const fragment = `precision highp float; varying vec2 vUv; uniform float time,strength,masked;
      uniform sampler2D causticMask; uniform vec2 resolution; uniform float fieldScale;
      vec2 hash(vec2 p){p=mod(p,8.);return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);}
      float edge(vec2 p){vec2 cell=floor(p),f=fract(p);float a=10.,b=10.;
        for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
          vec2 o=vec2(float(x),float(y));vec2 r=o+0.15+0.7*hash(cell+o)-f;
          float d=dot(r,r);if(d<a){b=a;a=d;}else if(d<b){b=d;}}
        return 1.-smoothstep(0.015,0.065,b-a);}
      void main(){vec2 uv=vUv*resolution/fieldScale;
        float a=edge((uv+vec2(time*0.065,time*0.051))*8.);
        float b=edge((uv+vec2(-time*0.052,time*0.072))*8.+vec2(2.31,1.74));
        float weight=smoothstep(0.,0.48,vUv.y);
        if(masked>0.5){vec4 m=texture2D(causticMask,vUv);weight=dot(m.rgb,vec3(1./3.))*m.a;}
        gl_FragColor=vec4(vec3(0.45,0.87,1.),(a*0.65+b*0.35)*strength*weight);}`;
    this.caustics = new THREE.Mesh(quad(W, this.causticMask ? H : H / 2), material(fragment,
      { time: { value: 0 }, strength: { value: this.causticsStrength }, masked: { value: this.causticMask ? 1 : 0 },
        resolution: { value: new THREE.Vector2(W,H) }, fieldScale: { value: REFERENCE.height*K },
        causticMask: { value: this.causticMask } }, true));
    this.caustics.position.y = this.causticMask ? 0 : H / 2;
    this.caustics.renderOrder = 800; this.scene.add(this.caustics);
  }

  addParticles() {
    const { W, H, K } = this;
    const random = rng(SETTINGS.seed); this.particles = [];
    const v = `precision highp float; attribute vec3 position; attribute vec2 uv;
      attribute vec4 data, drift; uniform mat4 projectionMatrix,modelViewMatrix; uniform float time,kind,pixelScale; uniform vec2 resolution;
      varying vec2 vUv; varying float depth,angle,diameter;
      void main(){vUv=uv;depth=drift.w;angle=data.w+time*drift.z;diameter=data.z;
        float y=mod(data.y+drift.y*time+24.*pixelScale,resolution.y+48.*pixelScale)-24.*pixelScale;
        float x=mod(data.x+sin(time*drift.x+data.w)*drift.w*12.*pixelScale+time*(kind==1.?2.*pixelScale:0.)+20.*pixelScale,resolution.x+40.*pixelScale)-20.*pixelScale;
        vec2 q=(position.xy-vec2(0.5))*data.z;
        if(kind==1.){q.x*=0.55+0.35*sin(angle);q=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*q;}
        gl_Position=projectionMatrix*modelViewMatrix*vec4(vec2(x,y)+q,0.,1.);}`;
    const f = `precision highp float;varying vec2 vUv;varying float depth,angle,diameter;uniform float kind;
      uniform sampler2D background; uniform vec2 resolution;
      void main(){vec2 p=(vUv-0.5)*2.;float r=length(p);vec3 color;float a;
        if(kind<0.5){
          float disk=1.-smoothstep(0.86,1.,r);
          float ring=disk*smoothstep(0.60,0.87,r);
          // Source coordinates move toward the bubble center: a small magnifying lens.
          vec2 offset=vec2(p.x,-p.y)*diameter*0.5*0.38*max(0.,1.-r*r);
          vec2 texel=0.5/resolution;
          vec2 sampleUV=clamp((gl_FragCoord.xy-offset)/resolution,texel,1.-texel);
          vec3 lens=texture2D(background,sampleUV).rgb;
          float highlight=1.-smoothstep(0.06,0.23,length((p-vec2(-0.36,-0.40))*vec2(0.9,1.15)));
          float reflection=exp(-dot((p-vec2(0.38,0.43))/vec2(0.27,0.15),(p-vec2(0.38,0.43))/vec2(0.27,0.15))*2.)*0.19;
          color=mix(lens,vec3(0.64,0.90,1.),ring*0.35)+vec3(ring*0.24+reflection);
          color=mix(color,vec3(1.),highlight*0.95);
          a=disk*(0.82+0.15*depth);
        }else if(kind<1.5){float shape=length(vec2(p.x*(1.15+0.25*p.y),p.y));
          a=(1.-smoothstep(0.65,1.,shape))*(0.45+0.4*depth);
          color=mix(vec3(0.63,0.71,0.88),mix(vec3(0.93,0.48,0.66),vec3(1.,0.77,0.86),smoothstep(0.,0.75,r)),depth);
        }else{a=(1.-smoothstep(0.4,1.,r))*(0.18+depth*0.35);color=vec3(0.86,0.95,1.);}
        gl_FragColor=vec4(color,a);}`;
    for (const [kind, count] of [SETTINGS.bubbles, SETTINGS.petals, SETTINGS.snow].entries()) {
      const g = new THREE.InstancedBufferGeometry(), q = quad(1, 1);
      g.index = q.index; g.attributes.position = q.attributes.position; g.attributes.uv = q.attributes.uv;
      const data = [], drift = [];
      for (let i = 0; i < count; i++) {
        const depth = random(), size = kind === 0 ? 3 + depth * 11 : kind === 1 ? 5 + depth * 4 : 1 + depth;
        data.push(random() * W, random() * (H+48*K) - 24*K, size*K, random() * TAU);
        drift.push(0.4 + random() * 0.5, (kind === 0 ? -(10 + depth * 20) : kind === 1 ? 5 + depth * 15 : -1 - depth * 3)*K,
          (random() - 0.5) * 1.8, 0.3 + depth * 0.7);
      }
      g.setAttribute('data', new THREE.InstancedBufferAttribute(new Float32Array(data), 4));
      g.setAttribute('drift', new THREE.InstancedBufferAttribute(new Float32Array(drift), 4));
      g.instanceCount = count;
      const mesh = new THREE.Mesh(g, material(f, { time: { value: 0 }, kind: { value: kind },
        resolution: { value: new THREE.Vector2(W,H) }, pixelScale: { value: K },
        background: { value: this.backgroundTarget.texture } }, false, v));
      mesh.layers.set(1); mesh.frustumCulled = false; mesh.renderOrder = 810 + kind;
      this.scene.add(mesh); this.particles.push(mesh);
    }
  }

  addDebug() {
    const { W, H } = this;
    this.debugCanvas = surface(W, H); this.debugTexture = new THREE.CanvasTexture(this.debugCanvas);
    // CanvasTexture is uploaded without Y flip to match screen coordinates.
    this.debugTexture.flipY = false;
    this.debugTexture.generateMipmaps = false; this.debugTexture.minFilter = this.debugTexture.magFilter = THREE.NearestFilter;
    this.textures.push(this.debugTexture);
    this.debugMesh = new THREE.Mesh(quad(W, H), material(imageFragment,
      { image: { value: this.debugTexture }, opacity: { value: 1 } }));
    this.debugMesh.layers.set(1); this.debugMesh.renderOrder = 2000; this.scene.add(this.debugMesh);
  }

  updateDebug() {
    const { W, H, K, SW, SH } = this;
    this.debugMesh.visible = this.debug;
    if (!this.debug) return;
    const ctx = this.debugCanvas.getContext('2d'); ctx.clearRect(0, 0, W, H);
    const image = ctx.createImageData(W, H);
    for (let k = 0; k < this.mask.length; k++) if (this.mask[k]) { image.data[k * 4 + 1] = 240; image.data[k * 4 + 2] = 180; image.data[k * 4 + 3] = 42; }
    ctx.putImageData(image, 0, 0); ctx.font = `${Math.max(8,Math.round(11*K))}px monospace`; ctx.lineWidth = 1;
    for (const s of this.upaEnabled ? this.sprites : []) {
      ctx.strokeStyle = '#8fffd8'; ctx.strokeRect(s.x + 0.5, s.y + 0.5, SW - 1, SH - 1);
      ctx.fillStyle = '#fff'; ctx.fillText(`${s.id}: ${s.state} (${s.x},${s.y})`, s.x, s.y + SH + 12*K);
    }
    this.debugTexture.needsUpdate = true;
  }

  render() {
    if (!this.ready || this.disposed) throw new Error('Call init() before render()');
    this.renderer.info.reset();
    this.camera.layers.set(0);
    this.renderer.setRenderTarget(this.backgroundTarget);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.copyScene, this.camera);
    this.camera.layers.set(1);
    if (this.upaEnabled) this.camera.layers.enable(2);
    this.renderer.autoClear = false;
    try { this.renderer.render(this.scene, this.camera); }
    finally { this.renderer.autoClear = true; this.camera.layers.set(0); }
  }

  /** Plain-data diagnostics, usable in host tests without accessing Three internals. */
  inspect() {
    const { W, H, K, SW, SH, GAP } = this;
    return { time: this.time, lamps: this.lamps, targetCount: COUNT[this.lamps], mask: this.maskSource,
      upaEnabled: this.upaEnabled,
      visibleSprites: this.upaEnabled ? this.sprites.filter(s => s.mesh.visible && this.isVisible(s)).length : 0,
      size: [W, H], spriteSize: [SW, SH], minDistance: this.overlapAllowed() ? 0 : GAP,
      K, spriteScale: this.spriteScale, anchorsPrepared: this.upaPrepared,
      layout: this.dense ? 'crowded' : 'spaced', overlapAllowed: this.overlapAllowed(),
      particles: { bubbles: SETTINGS.bubbles, petals: SETTINGS.petals, snow: SETTINGS.snow },
      causticMask: this.causticMask ? 'manifest' : 'lower-half',
      shaftBeams: this.layers.filter(l => l.beamIndex !== undefined).length,
      sprites: this.sprites.map(s => ({ id: s.id, x: s.x, y: s.y, state: s.state,
        inOpenWater: this.allowed(s, true), rotation: s.mesh.rotation.z, scale: s.mesh.scale.toArray(), renderOrder: s.mesh.renderOrder })),
      drawCalls: this.renderer?.info.render.calls };
  }

  removeSprite(s) {
    this.scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose();
    this.sprites.splice(this.sprites.indexOf(s), 1);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.ready = false;
    this.scene?.traverse(o => { o.geometry?.dispose(); if (o.material) o.material.dispose(); });
    this.copyScene?.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    this.backgroundTarget?.dispose();
    for (const t of this.textures) t.dispose();
    for (const b of this.bitmaps) b.close();
    this.renderer?.dispose(); this.renderer?.forceContextLoss();
    this.sprites = []; this.layers = []; this.textures = []; this.bitmaps = [];
  }
}
