// 11/1 最終合成シェーダの整理（内蔵GPU／ANGLE-D3D11 向け、画は同じ）
//
// (1) lodTextures: texture(s, uv) を textureLod(s, uv, 0.0) に替える。素材はどれもミップなし・縮小なしの読みなので結果は同じ。
//     HLSL は「暗黙の微分を使う読み込み」を分岐の中に置けない。texture() は分岐の外へ出されて毎画素実行されることがあり、
//     「不透明な枠は計算を省く」などの分岐省略が内蔵GPUで効かない恐れがある。textureLod は微分を使わないので分岐の中に残り、省略が実際に効く。
// (2) buildRegions: 画面を 16×16 のタイルに分け、枠の alpha（uMA の層0）で「全部不透明」「全部透明」「混在」に分類する。
//     全部不透明のタイル＝枠の計算だけ、全部透明のタイル＝内側の計算だけ、の専用シェーダで描く（混在・得点板の外周は従来の全部入り）。
//     分岐でなくコンパイル時に不要部分を消すので、レジスタ数が減り、分岐の中のテクスチャ読みが残る心配もない。
//     タイルの境界は余白（alpha は 4 画素、得点板は 3 画素）を取って分類するので、各タイルの画素は従来と同じ式で同じ値になる。

const W = 1440, H = 2560, T = 16, MARGIN = 4, SCORE = [750.64, 122.41, 1240.64, 505.41];

export function lodTextures(src) {
  let out = '', i = 0, n = 0;
  const re = /\btexture\s*\(/g;
  for (;;) {
    re.lastIndex = i; const m = re.exec(src);
    if (!m) { out += src.slice(i); break; }
    out += src.slice(i, m.index);
    // 対応する ')' を探し、最上位のカンマで引数に分ける
    let d = 1, j = m.index + m[0].length, start = j; const args = [];
    for (; j < src.length && d > 0; j++) {
      const c = src[j];
      if (c === '(' || c === '[') d++;
      else if (c === ')' || c === ']') { d--; if (d === 0) break; }
      else if (c === ',' && d === 1) { args.push(src.slice(start, j)); start = j + 1; }
    }
    args.push(src.slice(start, j));
    if (d !== 0) throw Error('lodTextures: unbalanced parentheses');
    if (args.length === 2) { out += 'textureLod(' + args[0] + ',' + args[1] + ', 0.0)'; n++; }
    else out += src.slice(m.index, j + 1);   // バイアス付きなどはそのまま
    i = j + 1;
  }
  return { src: out, count: n };
}

function once(src, a, b) {
  const k = src.split(a).length - 1;
  if (k !== 1) throw Error('final_region: marker x' + k + ': ' + a.slice(0, 70));
  return src.replace(a, () => b);
}

const MARK = {
  f0: 'vec4 f0 = uM3Off == 0 ? texture(uMA, vec3(uvA, 0.0)) : vec4(0.0);',
  interior: 'if (f0.a < 1.0 || uM3Off != 0) {',
  strip: 'bool strip = sy > 0.0 && sy < 1.0;',
  upper: 'if (uM3Off == 0 && px.y < 2215.0) {',
  glow: 'if (uGlowK > 0.0 && px.y > 1928.0 - 190.0 && px.y < 1928.0 + 60.0) {',
  tray: 'if (ut.x > 0.0 && ut.y > 0.0 && ut.x < 1.0 && ut.y < 1.0) {',
  mouth: 'if (uM3Off == 0 && uMouthK > 0.0',
  frameOrScore: 'if (f0.a > 0.001 || (scoreUv.x > 0.0 && scoreUv.y > 0.0 && scoreUv.x < 1.0 && scoreUv.y < 1.0)) {',
  frame: 'if (f0.a > 0.001) {',
  score: 'if (ud.x > 0.0 && ud.y > 0.0 && ud.x < 1.0 && ud.y < 1.0) {',
  m3off: 'uniform int uM3Off;',
};

// 変形の種類。生成するのは片方向の書き換えだけで、不要な部分を定数で消す。
export function variantSource(src, kind) {
  let s = once(src, MARK.m3off, 'const int uM3Off = 0;');
  if (kind === 'frame' || kind === 'framescore') {
    s = once(s, MARK.f0, 'vec4 f0 = vec4(0.0, 0.0, 0.0, 1.0);');
    s = once(s, MARK.interior, 'if (false) {');
    if (kind === 'frame') s = once(s, MARK.score, 'if (false) {');
  } else if (kind === 'interior' || kind === 'interiorA' || kind === 'interiorT') {
    s = once(s, MARK.f0, 'vec4 f0 = vec4(0.0);');
    s = once(s, MARK.frameOrScore, 'if (false) {');
    if (kind === 'interiorT') {   // 皿の高さ（y ≥ 2215）：上の大きな塊（ガラス・電飾・穴の帯・釘）は丸ごと不要
      s = once(s, MARK.upper, 'if (false) {');
      const k = s.indexOf(MARK.mouth); if (k < 0) throw Error('final_region: mouth marker');
    }
    if (kind === 'interiorA') {
      s = once(s, MARK.strip, 'bool strip = false;');
      s = once(s, MARK.glow, 'if (false) {');
      s = once(s, MARK.tray, 'if (false) {');
      const k = s.indexOf(MARK.mouth); if (k < 0) throw Error('final_region: mouth marker');
      s = s.slice(0, k) + 'if (false && uM3Off == 0 && uMouthK > 0.0' + s.slice(k + MARK.mouth.length);
    }
  } else if (kind !== 'generic') throw Error('final_region: kind ' + kind);
  return s;
}

// uMA の層0（枠の絵）の alpha でタイルを分類
function classify(alphaOf, mouthTop) {
  const tx = W / T, ty = H / T, cls = new Uint8Array(tx * ty);   // 0 generic, 1 frame, 2 framescore, 3 interior, 4 interiorA
  const yA = Math.min(1738, mouthTop - 9) - 3;                    // これより上なら穴の帯・光のにじみ・皿・庇のどれにも掛からない
  for (let j = 0; j < ty; j++) for (let i = 0; i < tx; i++) {
    const x0 = Math.max(0, i * T - MARGIN), x1 = Math.min(W, (i + 1) * T + MARGIN), y0 = Math.max(0, j * T - MARGIN), y1 = Math.min(H, (j + 1) * T + MARGIN);
    let mn = 255, mx = 0;
    for (let y = y0; y < y1 && !(mn < 255 && mx > 0); y++) { const o = y * W; for (let x = x0; x < x1; x++) { const v = alphaOf(o + x); if (v < mn) mn = v; if (v > mx) mx = v; } }
    const sc = (i + 1) * T + 3 > SCORE[0] && i * T - 3 < SCORE[2] && (j + 1) * T + 3 > SCORE[1] && j * T - 3 < SCORE[3];
    let c = 0;
    if (mn === 255) c = sc ? 2 : 1;
    else if (mx === 0 && !sc) c = (j + 1) * T <= yA ? 4 : j * T - 3 >= 2215 ? 5 : 3;
    cls[j * tx + i] = c;
  }
  return cls;
}

// タイルを横にまとめ、同じ幅の行を縦にまとめて長方形にする
function rects(cls, id) {
  const tx = W / T, ty = H / T, out = [], open = new Map();
  for (let j = 0; j < ty; j++) {
    const now = new Map();
    for (let i = 0; i < tx;) {
      if (cls[j * tx + i] !== id) { i++; continue; }
      let e = i; while (e < tx && cls[j * tx + e] === id) e++;
      const key = i + ':' + e, prev = open.get(key);
      if (prev) { prev.j1 = j + 1; now.set(key, prev); } else { const r = { i0: i, i1: e, j0: j, j1: j + 1 }; out.push(r); now.set(key, r); }
      i = e;
    }
    open.clear(); for (const [k, v] of now) open.set(k, v);
  }
  return out;
}

const KINDS = ['generic', 'frame', 'framescore', 'interior', 'interiorA', 'interiorT'];

export function buildRegions({ THREE, vertexShader, shader, uniforms, alphaOf, mouthTop, post = (x) => x }) {
  const cls = classify(alphaOf, mouthTop);
  const scene = new THREE.Scene(), materials = [], geometries = [], info = { tile: T, margin: MARGIN, variants: {} };
  const total = cls.length;
  for (let id = 0; id < KINDS.length; id++) {
    const rs = rects(cls, id); if (!rs.length) continue;
    const kind = KINDS[id];
    const pos = new Float32Array(rs.length * 18);
    let o = 0;
    for (const r of rs) {
      const xl = r.i0 * T / W * 2 - 1, xr = r.i1 * T / W * 2 - 1, yt = 1 - r.j0 * T / H * 2, yb = 1 - r.j1 * T / H * 2;
      const v = [xl, yb, 0, xr, yb, 0, xr, yt, 0, xl, yb, 0, xr, yt, 0, xl, yt, 0]; pos.set(v, o); o += 18;
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geometries.push(geo);
    const mat = new THREE.ShaderMaterial({ vertexShader, fragmentShader: post(variantSource(shader, kind)), uniforms, depthTest: false, depthWrite: false, blending: THREE.NoBlending, side: THREE.DoubleSide });
    materials.push(mat);
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.name = 'final_' + kind; scene.add(mesh);
    let tiles = 0; for (const c of cls) if (c === id) tiles++;
    info.variants[kind] = { rects: rs.length, tiles, pct: +(tiles / total * 100).toFixed(1) };
  }
  return { scene, material: materials[0], materials, geometries, info };
}

// (3) トーンマップ（Khronos PBR Neutral）の 3D LUT を解析式に。LUT は同じ式を格子点で標本化したもの（格子点では 0.04/255 以内で一致、確認は
//     scratch_1031/radical/lut_fit.py）。LUT の入力範囲 [2^-9, 1024] への clamp も真似る。
//   mode 1（閉じた式）：式をそのまま画素に当てる。LUT の読み 8 回・log2 3 回・6 方向の分岐が、掛け算と割り算だけになる。
//     ただし LUT は 57 格子の対数補間なので、格子の間では式との差がある（彩度の高い色で最大 ΔE76 約 4、普通の色の平均は 0.15〜0.2）。
//   mode 2（格子点だけ式）：LUT と同じ「対数 57 格子の四面体補間」をそのままに、4 つの角の値を LUT の読みでなく式で出す。
//     LUT と同じ値（格子点で 0.04/255 以内）になり、LUT の画像・サンプラーが不要になる。ただし式の評価が 4 回になる（掛け算は増える）。
function pbrNode(name) {
  return `vec3 ${name}(vec3 c) {
  float x = min(c.r, min(c.g, c.b));
  c -= x < 0.08 ? x - 6.25 * x * x : 0.04;
  float pk = max(c.r, max(c.g, c.b));
  float np = pk < 0.76 ? pk : 1.0 - 0.0576 / (pk - 0.52);
  c *= np / pk;
  return mix(c, vec3(np), 1.0 - 1.0 / (0.15 * (pk - np) + 1.0));
}
`;
}
export function lutAnalytic(src, mode = 1) {
  const head = 'vec3 lutPbrNeutral(vec3 c) {';
  const k = src.split(head).length - 1;
  if (k !== 1) throw Error('lutAnalytic: marker x' + k);
  let fn;
  if (mode === 2) {
    fn = pbrNode('pbrNode') + `vec3 lutPbrNeutral(vec3 c) {
  c = vec3(isnan(c.x) ? 0.0 : c.x, isnan(c.y) ? 0.0 : c.y, isnan(c.z) ? 0.0 : c.z);
  c = clamp(c, 0.0, 1024.0);
  vec3 u = vec3(shaperU(c.x), shaperU(c.y), shaperU(c.z)) * (uLutN - 1.0);
  vec3 i0f = min(floor(u), vec3(uLutN - 2.0));
  vec3 f = u - i0f;
  float st = 19.0 / (uLutN - 1.0);
  vec3 lo = exp2(i0f * st - 9.0), d = exp2((i0f + 1.0) * st - 9.0) - lo;
  bool xy = f.x >= f.y, yz = f.y >= f.z, xz = f.x >= f.z;
  vec3 m1 = (xy && xz) ? vec3(1.0, 0.0, 0.0) : (!xy && yz) ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
  vec3 m2 = (xy && xz) ? (yz ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0)) : (!xy && yz) ? (xz ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0)) : (xy ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0));
  float f1 = dot(f, m1), f2 = dot(f, m2), f3 = f.x + f.y + f.z - f1 - f2;
  vec3 cA = lo + d * m1, cB = cA + d * m2;
  vec3 r = (1.0 - f1) * pbrNode(lo) + (f1 - f2) * pbrNode(cA) + (f2 - f3) * pbrNode(cB) + f3 * pbrNode(lo + d);
  return lutPost(r);
}
`;
  } else {
    fn = `vec3 lutPbrNeutral(vec3 c) {
  c = vec3(isnan(c.x) ? 0.0 : c.x, isnan(c.y) ? 0.0 : c.y, isnan(c.z) ? 0.0 : c.z);
  c = clamp(c, 0.001953125, 1024.0);
  float x = min(c.r, min(c.g, c.b));
  c -= x < 0.08 ? x - 6.25 * x * x : 0.04;
  float pk = max(c.r, max(c.g, c.b));
  float np = pk < 0.76 ? pk : 1.0 - 0.0576 / (pk - 0.52);
  c *= np / pk;
  return lutPost(mix(c, vec3(np), 1.0 - 1.0 / (0.15 * (pk - np) + 1.0)));
}
`;
  }
  return src.replace(head, () => fn + 'vec3 lutPbrNeutralLUT(vec3 c) {');
}
