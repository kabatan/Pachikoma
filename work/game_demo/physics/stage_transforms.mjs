// The only placement data lives in assembly/cfg/stage_transforms.json.
export const STAGE_TRANSFORMS_URL = new URL('../../assembly/cfg/stage_transforms.json', import.meta.url);
export async function loadStageTransforms() {
  let text;
  if (STAGE_TRANSFORMS_URL.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises');
    text = await readFile(STAGE_TRANSFORMS_URL, 'utf8');
  } else {
    const response = await fetch(STAGE_TRANSFORMS_URL);
    if (!response.ok) throw new Error(`stage transforms: HTTP ${response.status}`);
    text = await response.text();
  }
  return new StageTransforms(JSON.parse(text));
}

export class StageTransforms {
  constructor(document) {
    if (document.schema_version !== 1 || document.coordinate_frame !== 'assembly' || !document.revision) throw new Error('Unsupported stage transform document');
    this.document = document; this.frame = document.coordinate_frame; this.revision = document.revision;
    this.stages = new Map();
    for (const name of ['stage1', 'stage2', 'stage3', 'ring', 'cabinet']) {
      const t = document.stages[name];
      if (!t || t.rotation_order !== 'XYZ' || ![t.translation_mm, t.rotation_euler_rad].every(a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite))) throw new Error(`Invalid stage transform: ${name}`);
      const [x, y, z] = t.rotation_euler_rad;
      const cx = Math.cos(x), cy = Math.cos(y), cz = Math.cos(z), sx = Math.sin(x), sy = Math.sin(y), sz = Math.sin(z);
      this.stages.set(name, { translation: t.translation_mm.map(v => v / 1000),
        rotation: [[cz*cy, cz*sy*sx-sz*cx, cz*sy*cx+sz*sx], [sz*cy, sz*sy*sx+cz*cx, sz*sy*cx-cz*sx], [-sy, cy*sx, cy*cx]] });
    }
  }
  get(stage) { const t = this.stages.get(stage); if (!t) throw new Error(`Unknown stage: ${stage}`); return t; }
  vector(stage, p) { return this.get(stage).rotation.map(row => row.reduce((sum, v, i) => sum + v * p[i], 0)); }
  point(stage, p) { const t = this.get(stage); return this.vector(stage, p).map((v, i) => v + t.translation[i]); }
  inverseVector(stage, p) { const { rotation: r } = this.get(stage); return [0, 1, 2].map(i => r.reduce((sum, row, j) => sum + row[i] * p[j], 0)); }
  inversePoint(stage, p) { const t = this.get(stage); return this.inverseVector(stage, p.map((v, i) => v - t.translation[i])); }
  pointBetween(from, to, p) { return this.inversePoint(to, this.point(from, p)); }
  vectorBetween(from, to, p) { return this.inverseVector(to, this.vector(from, p)); }
}
