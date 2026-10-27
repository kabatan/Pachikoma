"""既存の高品質m3穴部品の表面をR3物理の口・のどの位置へ写す。

新しいintegrationを生成する。元の部品は保存。上の口だけ拡幅し、7番の
漏斗は物理ののどへ向けて元の幅へ戻す。CPUの可逆PNG処理（GPU不要）。
"""
from pathlib import Path
import json
import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
WORK = HERE.parents[2]
OLD = WORK / 'upa_frame3d/m3/integration/holes_B2'
OUT = HERE / 'holes_r3_1026'
old = json.loads((WORK / 'upa_frame3d/m3/data/holes_phys.json').read_text())
new = json.loads((HERE / 'data/holes_r3_1026.json').read_text())
man = json.loads((OLD / 'manifest.json').read_text())
H, W, Y = man['h'], man['w'], man['y']
OUT.mkdir(parents=True, exist_ok=True)
source_x, target_x = [0.0], [0.0]
for a, b in zip(old['cups'], new['cups']):
    source_x.extend(a['mouth']); target_x.extend(b['mouth'])
source_x.append(float(W - 1)); target_x.append(float(W - 1))
X, YY = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
MX = np.empty_like(X)
for row in range(H):
    anchors = target_x.copy()
    for i, (a, b) in enumerate(zip(old['cups'], new['cups'])):
        if b['throat']:
            top = max(a['topL'], a['topR']) + 31.1
            bottom = b['funnel_bot']
            k = np.clip((Y + row - top) / (bottom - top), 0, 1)
            for side in range(2):
                idx = 1 + i * 2 + side
                anchors[idx] = b['mouth'][side] * (1 - k) + a['mouth'][side] * k
    MX[row] = np.interp(X[row], anchors, source_x)

def warp(im):
    # premultiplied alphaで縁を補間し、色の黒い縁を作らない。
    f = im.astype(np.float32) / 255
    f[..., :3] *= f[..., 3:]
    f = cv2.remap(f, MX, YY, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    f[..., :3] /= np.maximum(f[..., 3:], 1e-8)
    return np.clip(f * 255 + .5, 0, 255).astype(np.uint8)

for st in ['0', '4']:
    for prefix in ['front_off', 'back_off']:
        file = f'{prefix}_{st}.png'
        cv2.imwrite(str(OUT / file), warp(cv2.imread(str(OLD / file), cv2.IMREAD_UNCHANGED)))
    for group, key, field, prefix in [('holes', 'n', 'hole', 'hole'), ('pillars', 'j', 'pillar', 'pillar')]:
        for item in man[group]:
            ident, x, w = item[key], item['x'], item['w']
            for state in item['states']:
                for back in (['', 'back_'] if group == 'holes' else ['']):
                    file = f'{back}{prefix}{ident}_{state}_{st}.png'
                    im = np.zeros((H, W, 4), np.uint8)
                    im[:, x:x + w] = cv2.imread(str(OLD / file), cv2.IMREAD_UNCHANGED)
                    warped = warp(im)
                    x0 = max(0, int(np.floor(np.interp(x, source_x, target_x))) - 2)
                    x1 = min(W, int(np.ceil(np.interp(x + w, source_x, target_x))) + 2)
                    cv2.imwrite(str(OUT / file), warped[:, x0:x1])
                    if st == '0' and state == item['states'][0] and back == '':
                        item['r3_x'], item['r3_w'] = x0, x1 - x0
for group in ['holes', 'pillars']:
    for item in man[group]:
        item['x'], item['w'] = item.pop('r3_x'), item.pop('r3_w')
man['note'] += ' 1026: R3物理の口を正として表面を再配置（元部品は保存）。'
man['physics'] = new
(OUT / 'manifest.json').write_text(json.dumps(man, ensure_ascii=False, indent=2) + '\n')
(OUT / 'mapping.json').write_text(json.dumps({'source_x': source_x, 'target_x': target_x}, indent=2) + '\n')
print('R3 hole surfaces ready', OUT)
