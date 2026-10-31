# 監督の試聴用動画(映像+新しい音)を作る。音は実機のゲームを動かして最終段(ceiling)を録ったもの(scratch_1031/loud_sfx/lab の cmd_full.js)をそのまま使う。
# 映像は各場面の元の mp4(fx_trim の skip を差し引いたコマ)。各コマは「実際に映っていた時刻」(w.time のサンプル)で並べるので、音と映像がずれない
# (録画機は映像の飛び先の読み込みで止まることがあり、止まりも含めてそのまま保持する)。 python3 build_videos.py <rec.npy> <res.json> <recStart> [outdir]
import numpy as np, json, os, subprocess, sys, shutil, glob
from scipy.io import wavfile
REC, RES, RS = sys.argv[1], sys.argv[2], float(sys.argv[3]); OUT = sys.argv[4] if len(sys.argv) > 4 else '/home/kabatan/work/scratch_1031/loud_sfx'
TMP = '/tmp/claude-1000/-home-kabatan-work-----/c6e84b4b-95eb-4c93-830f-bbc8089d3bb4/scratchpad/w/vid'; os.makedirs(TMP, exist_ok=True)
SR = 48000; FPS = 30
LCD = '/home/kabatan/work/pachikoma_release/work/game_demo/play/lcd_surface/'
a = np.load(REC); v = json.load(open(RES))['v']
FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
VID = {'jp_rush': LCD + 'jp1029/production_20261028/jp_rush.mp4', 'cutin': LCD + 'chain_announce_v09/announce_cutin_1152.mp4',
       'land': LCD + 'jp1029/production_20261028/jp_land_d4_foreground_bg2f_bt709_v2.mp4', 'success': '/home/kabatan/work/pachikoma_release/work/effects/jp_teacher/08_chain/v4/chain_success_v4.mp4',
       'thunder': LCD + 'jp1029/production_20261028/jp_intro_lightning_approved_color.mp4'}
SUC = list(range(0, 24)) + list(range(40, 54)) + list(range(84, 96)) + list(range(118, 176))
SEQ = {'jp_rush': [('jp_rush', 'jp_rush', list(range(0, 48)))],
       'chain_announce_cutin': [('cutin', 'chain_announce_cutin', list(range(0, 50)))],
       'chain_jp_land_d4': [('land', 'chain_jp_land_d4', list(range(0, 17))), ('success', 'chain_success', SUC)]}
TAIL = 1.8


def run_of(scene, en): return [r for r in v['runs'] if r['scene'] == scene and r['enabled'] == en][0]


def frames_png(vid, frames, tag):
    d = f'{TMP}/{tag}'; shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
    sel = '+'.join(f'eq(n,{f})' for f in frames)
    crop = 'crop=1152:1268:0:0,' if vid == 'land' else ''
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', VID[vid], '-vf', f"{crop}scale=1152:1268,select='{sel}'", '-vsync', '0', '-compression_level', '1', f'{d}/%04d.png'], check=True)
    return sorted(glob.glob(d + '/*.png'))


def mk(scene, en, label, outname, extra_tail=TAIL):
    run = run_of(scene, en); files = []; taus = []
    for vid, name, frames in SEQ[scene]:
        S = np.array([(s[0], s[3] * FPS) for s in run['samples'] if s[1] == name])
        pngs = frames_png(vid, frames, f'{outname}_{vid}')
        for o, p in zip(frames, pngs):
            m = S[:, 1] >= o - 0.01
            if not m.any(): continue
            j = int(np.argmax(m)); taus.append(S[j, 0]); files.append(p)
    taus = np.array(taus); durs = np.diff(taus).tolist() + [1 / FPS]
    # 時刻が戻る/同時のコマはなし(単調)。0長は最低1ms
    durs = [max(0.001, d) for d in durs]
    t0 = taus[0]; total = sum(durs) + extra_tail
    x = a[int((t0 - RS) * SR):int((t0 + total - RS) * SR)]
    wav = f'{TMP}/{outname}.wav'; wavfile.write(wav, SR, x.astype(np.float32))
    lst = f'{TMP}/{outname}.txt'
    with open(lst, 'w') as f:
        for p, d in zip(files, durs): f.write(f"file '{p}'\nduration {d:.5f}\n")
        f.write(f"file '{files[-1]}'\nduration {extra_tail:.5f}\nfile '{files[-1]}'\n")
    vf = f"fps=30,drawtext=fontfile={FONT}:text='{label}':x=24:y=140:fontsize=44:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=14,format=yuv420p"
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-i', wav, '-vf', vf, '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '21',
                    '-af', 'volume=-6dB', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', '-t', f'{total:.3f}', '-shortest', f'{OUT}/{outname}.mp4'], check=True)
    print(outname, 'frames', len(files), 'dur', round(total, 2), 'maxhold(ms)', round(max(durs[:-1]) * 1000))


if __name__ == '__main__':
    for scene, nm in [('jp_rush', 'rush'), ('chain_announce_cutin', 'cutin'), ('chain_jp_land_d4', 'chain_land_success')]:
        mk(scene, True, f'新 {nm}', f'{nm}_new'); mk(scene, False, f'旧 {nm}', f'{nm}_old')
