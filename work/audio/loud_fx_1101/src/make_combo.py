# 雷(基準)の1クリップと、雷 → RUSH新 → カットイン新 → 継続新 を続けて聞き比べる1本を作る。 python3 make_combo.py <rec.npy> <recStart> <thunderOnsetSearchFrom>
# 音量は build_videos.py と同じ -6dB(AAC に戻したとき 0dBFS を超えて割れないように全部いっしょに下げる。比較の差は変わらない)
import numpy as np, subprocess, sys
from scipy.io import wavfile
REC, RS, FROM = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]); SR = 48000
W = '/home/kabatan/work/scratch_1031/loud_sfx/'; S = '/tmp/claude-1000/-home-kabatan-work-----/c6e84b4b-95eb-4c93-830f-bbc8089d3bb4/scratchpad/w/'
F = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
LCD = '/home/kabatan/work/pachikoma_release/work/game_demo/play/lcd_surface/'
a = np.load(REC); i0 = int((FROM - RS) * SR); x = a[i0:i0 + 3 * SR]; t = FROM + np.argmax(np.abs(x).max(1) > 0.3) / SR
wavfile.write(S + 'thunder.wav', SR, a[int((t - RS) * SR):int((t + 2.6 - RS) * SR)].astype(np.float32))
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', LCD + 'jp1029/production_20261028/jp_intro_lightning_approved_color.mp4', '-i', S + 'thunder.wav', '-vf',
                f"scale=1152:1268,fps=30,tpad=stop_mode=clone:stop_duration=1.7,drawtext=fontfile={F}:text='雷(基準・既存)':x=24:y=140:fontsize=44:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=14,format=yuv420p",
                '-af', 'volume=-6dB', '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', '-t', '2.6', W + 'thunder_ref.mp4'], check=True)
clips = ['thunder_ref', 'rush_new', 'cutin_new', 'chain_land_success_new']; n = len(clips); inputs = []; fc = []
for c in clips: inputs += ['-i', W + c + '.mp4']
inputs += ['-f', 'lavfi', '-t', '0.6', '-i', 'color=c=black:s=1152x1268:r=30', '-f', 'lavfi', '-t', '0.6', '-i', 'anullsrc=r=48000:cl=stereo']
for i in range(n): fc.append(f'[{i}:v]setsar=1,fps=30,format=yuv420p[v{i}];[{i}:a]aresample=48000,aformat=channel_layouts=stereo[a{i}]')
fc.append(f'[{n}:v]format=yuv420p,split={n-1}' + ''.join(f'[g{i}]' for i in range(n - 1))); fc.append(f'[{n+1}:a]aformat=channel_layouts=stereo,asplit={n-1}' + ''.join(f'[ga{i}]' for i in range(n - 1)))
seq = ''
for i in range(n):
    seq += f'[v{i}][a{i}]'
    if i < n - 1: seq += f'[g{i}][ga{i}]'
fc.append(seq + f'concat=n={2*n-1}:v=1:a=1[vo][ao]')
subprocess.run(['ffmpeg', '-v', 'error', '-y'] + inputs + ['-filter_complex', ';'.join(fc), '-map', '[vo]', '-map', '[ao]', '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', W + '00_thunder_then_new_rush_cutin_chain.mp4'], check=True)
print('thunder onset', t)
