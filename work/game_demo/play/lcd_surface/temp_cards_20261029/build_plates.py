"""Temp-card telops: reuse the approved Zen Old Mincho rainbow/silver plates (jp_teacher/08_chain letters8.py). No AI artwork."""
from pathlib import Path
import importlib.util, inspect, json, sys
import numpy as np
from PIL import Image
sys.dont_write_bytecode = True
root = Path.cwd(); here = Path(__file__).parent
source = root / 'work/effects/jp_teacher/08_chain/v3/src/letters8.py'
spec = importlib.util.spec_from_file_location('chain_letters', source)
L = importlib.util.module_from_spec(spec); spec.loader.exec_module(L)
code = inspect.getsource(L.make); code = code[:code.index('    os.makedirs(')] + '    return rgb, A_out\n'
scope = dict(L.__dict__); exec(compile(code, str(source) + ':cards', 'exec'), scope)
def plate(name, chars, pal, W):
    L.SPEC[name] = [[(ch, 1.0)] for ch in chars]; L.COLS[name] = pal
    rgb, a = scope['make'](name, W=W)
    straight = np.clip(rgb / np.maximum(a[..., None], 1e-6), 0, 1) ** (1 / 2.2)
    return Image.fromarray(np.uint8(np.clip(np.dstack([straight, a]), 0, 1) * 255), 'RGBA')
recv = {'source': str(source.relative_to(root)), 'font': L.FONT, 'AI': False, 'plates': {}}
# (file, text, palette, plate width param). Final on-screen width is set at runtime.
TELOPS = [('start_main','スタート！','rainbow',1500),('start_sub','ランプを６つ集めよう','rainbow',1500),
          ('count_main','計数中','rainbow',1300),('count_jp','ＪＰの合計','silver',1100),
          ('more_main','まだまだ！','rainbow',1500),('more_sub','続きを楽しもう！','rainbow',1400),
          ('guard_main','耐えた！','rainbow',1000),
          ('dup_main','重複！','silver',1000),('dup_sub','ランプが消えた…','silver',1300),
          ('timeup_main','時間です！','rainbow',1500),('ballout_main','玉切れ！','rainbow',1300)]
for n, t, p, w in TELOPS:
    im = plate(n, t, p, w); box = im.getbbox(); im = im.crop(box)
    im.save(here / f'{n}.png'); recv['plates'][n] = {'text': t, 'pal': p, 'size': im.size}
# digit atlas: gold, common scale, centered on glyph centre line
CH = '0123456789＋玉秒'; K = 1.0
cells = {}
for i, ch in enumerate(CH):
    n = f'dg{i}'; L.SPEC[n] = [[(ch, 1.0)]]; canvas, _, _ = L.layout(L.SPEC[n])
    s = 230 / canvas.shape[0] if ch not in '玉秒＋' else 230 / canvas.shape[0]
    W = canvas.shape[1] * s / 0.84
    im = plate(n, ch, 'gold', W); cells[ch] = im
cells = {k: v.crop(v.getbbox()) for k, v in cells.items()}
cw = max(im.width for im in cells.values()); chh = max(im.height for im in cells.values())
atlas = Image.new('RGBA', (cw * len(CH), chh)); meta = {}
for i, ch in enumerate(CH):
    im = cells[ch]; atlas.alpha_composite(im, (i * cw + (cw - im.width) // 2, (chh - im.height) // 2))
    meta[ch] = {'x': i * cw, 'w': cw, 'adv': im.width}
atlas.save(here / 'digits_gold.png'); recv['digits'] = {'cell': [cw, chh], 'meta': meta}
(here / 'plates_receipt.json').write_text(json.dumps(recv, ensure_ascii=False, indent=1))
print(recv['plates'], cw, chh)
