"""本番1152x1268の元レイヤを新しい場所へ描く。GPU実行はgpu_run.pyから呼ぶ。"""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[4]
NF = ROOT / 'work/effects/normal_fx'
OUT = NF / 'production1026'
BLENDER = Path('/home/kabatan/opt/blender-5.0.1/blender')

def run(name, script, args, expected):
    folder = OUT / name
    folder.mkdir(parents=True, exist_ok=True)
    if all((folder / f'f_{i:04d}.png').exists() for i in range(1, expected + 1)):
        print('already rendered', name, flush=True)
        return
    command = [str(BLENDER), '-b', '--threads', '8', '--python', str(NF / script), '--',
               f'out={folder}', 'scale=1', 'spp=96', 'f0=1', f'f1={expected}', *args]
    # 新規の本番ディレクトリだけに書く。古い試作・レビューは触らない。
    t0 = time.time()
    with (OUT / f'{name}.log').open('a') as log:
        subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=True)
    print('rendered', name, round(time.time() - t0, 2), flush=True)

OUT.mkdir(parents=True, exist_ok=True)
requested = sys.argv[1:] or ['bg_raw', 'upper', 'fx_pet']
for name in requested:
    if name == 'bg_raw':
        run(name, 'blender/normal_bg.py', [], 240)
    elif name == 'upper':
        run(name, 'blender/normal_bg.py', ['upper=1', 'only=upper'], 240)
    elif name == 'fx_pet':
        run(name, 'blender/normal_fx.py', ['mode=petals'], 72)
    else:
        raise ValueError(name)
print('native sources ready', flush=True)
