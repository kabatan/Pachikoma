"""試作14を実ゲーム状態ごとの本番動画へ。PNGマスターを残し、古い試作は変更しない。

実行: OPENBLAS_NUM_THREADS=2 python3 .../export_normal_1026.py [idle0,lamp1,...]
GPUレンダーは render_sources_1026.py / gpu_run.py。こちらはCPU合成とx264のみ。
"""
from pathlib import Path
import argparse
from concurrent.futures import ProcessPoolExecutor
import importlib.util
import json
import math
import multiprocessing
import os
import subprocess
import sys
import time

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[4]
NF = ROOT / 'work/effects/normal_fx'
SOURCES = NF / 'production1026'
DEST = ROOT / 'work/game_demo/play/lcd_surface/production1026'
cv2.setNumThreads(2)

def prepare_sources():
    for name, count in [('bg_raw', 240), ('upper', 240), ('fx_pet', 72)]:
        files = sorted((SOURCES / name).glob('f_*.png'))
        if len(files) != count:
            raise RuntimeError(f'{name}: {len(files)}/{count}, native render is not finished')
        for p in files:
            im = cv2.imread(str(p), cv2.IMREAD_UNCHANGED)
            if im.shape[:2] != (1268, 1152):
                raise RuntimeError(f'not native: {p} {im.shape}')
    bg = SOURCES / 'bg'
    if len(list(bg.glob('f_*.png'))) != 240:
        subprocess.run([sys.executable, str(NF / 'comp/post_bg.py'), str(SOURCES / 'bg_raw'), str(bg)], check=True)
    # 試作で1/3に縮めた雲も、元の1152x1268・16bitから作り直す。
    vfx = SOURCES / 'vfx13'
    for name in ['burst_white', 'lamp_ignite', 'stream_gold', 'debris', 'debris_loop',
                 'lightning_crack', 'cloud_volume_far', 'cloud_volume_near']:
        out = vfx / name
        out.mkdir(parents=True, exist_ok=True)
        for p in sorted((ROOT / 'work/effects/jp_film/tmp/v5/vfx' / name).glob('*.png')):
            dst = out / p.name
            if dst.exists():
                continue
            im = cv2.imread(str(p), cv2.IMREAD_UNCHANGED)
            if im.shape[:2] != (1268, 1152):
                raise RuntimeError(f'VFX source is not native: {p}, {im.shape}')
            if im.dtype == np.uint16:
                im = ((im.astype(np.uint32) + 128) // 257).astype(np.uint8)
            cv2.imwrite(str(dst), im, [cv2.IMWRITE_PNG_COMPRESSION, 2])

def load_p14(probe=False):
    # モジュールの引数と出力先を隔離する。元ファイルのmain()は呼ばない。
    oldargv = sys.argv[:]
    sys.argv = ['normal_comp_p14', f'bg={SOURCES / ("bg_raw" if probe else "bg")}',
                f'up={SOURCES / "upper"}', 'cab=0']
    spec = importlib.util.spec_from_file_location('normal_p14_1026', NF / 'comp/normal_comp_p14.py')
    p = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(p)
    sys.argv = oldargv
    p.X.V13 = str(SOURCES / 'vfx13')
    p.X._files.clear(); p.X._cache.clear()
    def native_fx(name, f):
        path = SOURCES / name / f'f_{f + 1:04d}.png'
        if not path.exists():
            return None
        im = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
        assert im.shape[:2] == (1268, 1152)
        return im[..., [2, 1, 0, 3]]
    p.fx_frame = native_fx
    p.T6 = math.inf      # 未来の6灯到達を予知する固定台本の助走は使わない。
    return p

def scenes(p):
    kinds = [('lamp1', 'lamp123', 1), ('lamp2', 'lamp2', 2), ('lamp3', 'bub3', 3),
             ('lamp3b', 'lamp3b', 3), ('lamp4', 'lamp4', 4), ('lamp4b', 'lamp4b', 4),
             ('lamp5', 'lamp5', 5), ('lamp6', 'lamp6', 6)]
    result = {f'idle{n}': {'type': 'idle', 'n': n, 'frames': 240, 'loop': True} for n in range(7)}
    for name, kind, n in kinds:
        result[name] = {'type': 'lamp', 'kind': kind, 'n': n,
                        'frames': math.ceil(p.DUR[kind] * 30), 'loop': False}
    for n in range(1, 6):
        result[f'protect{n}'] = {'type': 'protect', 'n': n, 'frames': 33, 'loop': False}
    for n in [4, 5]:
        result[f'reset{n}'] = {'type': 'reset', 'n': n, 'frames': math.ceil(p.ASC_LIFE * 30), 'loop': False}
    return result

def configure(p, scene):
    n, typ = scene['n'], scene['type']
    p.EVENTS = []
    p.SHOTS = []       # 偽の球・偽の発射タイミングを焼き込まない。
    p.LOSS = []
    p.FREEZE = []
    p.dup_list = lambda t: []
    p.HOLE_ORDER = lambda t=None: list(range(1, n + 1))
    p.seats_at = lambda t: list(range(1, n + 1))
    p.state_at = lambda t: (n, None)
    if typ == 'lamp':
        ev = (0, scene['kind'], n, n - 1, n)
        p.EVENTS = [ev]
        p.state_at = lambda t: (n, ev if t < p.DUR[scene['kind']] else None)
        k = p.KT[scene['kind']]
        if k['hs']:
            p.FREEZE.append((k['land'], k['hs']))
        if scene['kind'] == 'lamp5':
            p.FREEZE.append((p.SCH_END, p.PAUSE))
    elif typ in ['reset', 'protect']:
        asc = typ == 'reset'
        p.dup_list = lambda t: [(n - 1, t, 0, asc, 11)] if 0 <= t < (p.ASC_LIFE if asc else p.P_LIFE) else []
        if asc:
            p.LOSS = [(p.A_SHATTER, n - 1, n, 0)]
            p.seats_at = lambda t: list(range(1, n + (0 if t < p.A_SHATTER else -1) + 1))
            p.state_at = lambda t: (n if t < p.A_SHATTER else n - 1, None)
    # 場面ごとの不要な巨大キャッシュを持ち越さない。
    p.BG_CACHE.clear(); p.UP_CACHE.clear(); p.FX_CACHE.clear(); p.UPA_CACHE.clear()

def encode(name, scene, folder):
    target = DEST / f'{name}.mp4'
    if target.exists():
        return
    cmd = ['ffmpeg', '-v', 'error', '-n', '-framerate', '30', '-i', str(folder / '%04d.png')]
    # 8秒の絵を12コマ重ねてつなぐ。マスターPNGは未変更のまま残す。
    if scene['loop']:
        graph = ('[0:v]split=3[a][b][c];[a]trim=start_frame=12:end_frame=228,setpts=PTS-STARTPTS[body];'
                 '[b]trim=start_frame=228:end_frame=240,setpts=PTS-STARTPTS[tail];'
                 '[c]trim=start_frame=0:end_frame=12,setpts=PTS-STARTPTS[head];'
                 "[tail][head]blend=all_expr='A*(1-N/12)+B*(N/12)'[join];"
                 '[body][join]concat=n=2:v=1:a=0,scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p[v]')
        cmd += ['-filter_complex', graph, '-map', '[v]']
    else:
        cmd += ['-vf', 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p']
    cmd += ['-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-threads', '4',
            '-g', '30', '-keyint_min', '1', '-color_range', 'tv', '-colorspace', 'bt709',
            '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', str(target)]
    subprocess.run(cmd, check=True)

_worker_p = None
_worker_scene = None
def render_native(task):
    """CPU計算だけを最大2プロセスで行う。ファイルへの書込は親で順番に行う。"""
    global _worker_p, _worker_scene
    scene, f = task
    if _worker_p is None:
        _worker_p = load_p14()
    if _worker_scene != scene:
        configure(_worker_p, scene)
        _worker_scene = scene.copy()
    im = _worker_p.lcd_frame(f)
    ok, data = cv2.imencode('.png', (im[..., ::-1] * 255 + .5).astype(np.uint8),
                            [cv2.IMWRITE_PNG_COMPRESSION, 2])
    if not ok:
        raise RuntimeError('PNG encoding failed')
    return f, data.tobytes()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('only', nargs='?', default='')
    ap.add_argument('--probe', action='store_true')
    a = ap.parse_args()
    if not a.probe:
        prepare_sources()
    p = load_p14(a.probe)
    definitions = scenes(p)
    light_data = {}
    DEST.mkdir(parents=True, exist_ok=True)
    executor = None if a.probe else ProcessPoolExecutor(max_workers=2, mp_context=multiprocessing.get_context('spawn'))
    for name, scene in definitions.items():
        if a.only and name not in a.only.split(','):
            continue
        folder = SOURCES / ('probes' if a.probe else 'masters') / name
        folder.mkdir(parents=True, exist_ok=True)
        configure(p, scene)
        lights = []
        for f in range(scene['frames']):
            k, kc, _hole, _pillar, wash, ring, zone = p.lights(f / 30)
            lights.append({key: np.round(value, 4).tolist() for key, value in
                           [('K', k), ('Kc', kc), ('wash', wash), ('ring', ring), ('zone', zone)]})
        if scene['loop']:
            joins = [{key: np.round(np.asarray(lights[228 + i][key]) * (1 - (i + 1) / 12) +
                                    np.asarray(lights[i][key]) * ((i + 1) / 12), 4).tolist()
                      for key in lights[i]} for i in range(12)]
            lights = lights[12:228] + joins
        light_data[name] = lights
        t0 = time.time()
        pending = []
        for f in range(1 if a.probe else scene['frames']):
            target = folder / f'{f:04d}.png'
            if target.exists() and not target.with_name(target.stem + '_pre1026' + target.suffix).exists():
                continue
            pending.append(f)
        if a.probe:
            computed = []
            for f in pending:
                im = p.lcd_frame(f)
                ok, data = cv2.imencode('.png', (im[..., ::-1]*255+.5).astype(np.uint8), [cv2.IMWRITE_PNG_COMPRESSION,2])
                computed.append((f, data.tobytes()))
        else:
            computed = executor.map(render_native, ((scene, f) for f in pending), chunksize=1)
        for f, data in computed:
            (folder / f'{f:04d}.png').write_bytes(data)
            if f % 30 == 0:
                print(name, f, '/', scene['frames'], 'elapsed', round(time.time() - t0, 2), flush=True)
        if a.probe:
            continue
        encode(name, scene, folder)
        print('done', name, round(time.time() - t0, 2), flush=True)
    if executor:
        executor.shutdown()
    if not a.probe:
        manifest = {'version': 1026, 'source': 'normal_comp_p14 + R3 state split; native PNG masters; no jp_film playback',
                    'width': 1152, 'height': 1268, 'fps': 30,
                    'codec': 'h264', 'crf': 12, 'pixelFormat': 'yuv420p', 'color': 'bt709 limited',
                    'files': {n: f'{n}.mp4' for n in definitions}, 'scenes': definitions,
                    'lights': 'lights.json',
                    'temporary': ['attract', 'howto', 'ticket', 'jp', 'chain', 'timeup', 'count', 'result']}
        (DEST / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        light_path = DEST / 'lights.json'
        if light_path.exists():
            light_data = {**json.loads(light_path.read_text()), **light_data}
        light_path.write_text(json.dumps(light_data, ensure_ascii=False, separators=(',', ':')) + '\n')

if __name__ == '__main__':
    main()
