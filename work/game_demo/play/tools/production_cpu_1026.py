"""GPUの元レイヤ完成を待ち、本番合成を続ける（CPUのみ）。"""
from pathlib import Path
import os
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[4]
SRC = ROOT / 'work/effects/normal_fx/production1026'
OUT = SRC / 'export.log'
while True:
    progress = {name: len(list((SRC/name).glob('f_*.png'))) for name in ['bg_raw','upper','fx_pet']}
    if progress == {'bg_raw':240,'upper':240,'fx_pet':72}:
        break
    print('native source progress', progress, flush=True)
    time.sleep(30)
env = {**os.environ, 'OPENBLAS_NUM_THREADS':'2', 'OMP_NUM_THREADS':'2'}
with OUT.open('a') as log:
    result = subprocess.run([sys.executable, str(Path(__file__).with_name('export_normal_1026.py'))],
                            cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
print('production export exit', result.returncode, flush=True)
raise SystemExit(result.returncode)
