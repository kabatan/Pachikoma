# 実機の確定音・当たり音の書き起こし(解析のみ。音は保存しない)。スペクトログラム画像と、音ごとの表(開始・音高・強さ・長さ・倍音)を出す。
# python3 transcribe.py <name> [t0 t1]    refs: /home/kabatan/work/scratch_1031/audiolift/refs/<name>.wav(非公開。リポジトリに入れない)
import sys, numpy as np
from scipy.signal import stft, find_peaks
sys.path.insert(0, '.')
from meas import *
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
R = '/home/kabatan/work/scratch_1031/audiolift/refs/'
OUT = '/tmp/claude-1000/-home-kabatan-work-----/c6e84b4b-95eb-4c93-830f-bbc8089d3bb4/scratchpad/w/'
NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
def nn(f): m = 69 + 12 * np.log2(f / 440); k = int(round(m)); return f'{NAMES[k % 12]}{k // 12 - 1}{(m - k) * 100:+.0f}c'
def main(name, t0=0, t1=None):
    x = load(R + name + '.wav').mean(1); t1 = t1 or len(x) / SR; x = x[int(t0 * SR):int(t1 * SR)]
    f, t, Z = stft(x, SR, nperseg=4096, noverlap=3584); M = np.abs(Z) + 1e-9; dbm = 20 * np.log10(M)
    fig, ax = plt.subplots(2, 1, figsize=(16, 9), gridspec_kw={'height_ratios': [3, 1]})
    sel = f < 12000; ax[0].pcolormesh(t + t0, f[sel], np.clip(dbm[sel] - dbm.max(), -70, 0), shading='auto', cmap='magma'); ax[0].set_yscale('symlog', linthresh=1000); ax[0].set_ylim(100, 12000)
    for fr in (500, 1000, 2000, 4000, 8000): ax[0].axhline(fr, color='w', lw=.3)
    tt = np.arange(len(x)) / SR + t0; ax[1].plot(tt, x, lw=.3); ax[1].set_xlim(t0, t1)
    ax[0].set_title(f'{name} {t0}-{t1}s'); plt.tight_layout(); plt.savefig(OUT + f'spec_{name}.png', dpi=70); plt.close()
    # 音の書き起こし: 全帯域エネルギーの立ち上がりで開始、直後の短時間平均スペクトルの強いピーク
    band = (f > 250) & (f < 9000); en = (M[band] ** 2).sum(0); d = np.diff(10 * np.log10(en)); d = np.r_[0, d]
    on, _ = find_peaks(d, height=4, distance=4)
    print(f'--- {name}: {len(on)} onsets; hop {t[1]-t[0]:.4f}s')
    for i in on:
        j0, j1 = i + 1, min(i + 5, M.shape[1]); S = (M[:, j0:j1] ** 2).mean(1); lev = 10 * np.log10(S[band].sum() + 1e-12)
        pk, pr = find_peaks(10 * np.log10(S + 1e-18), prominence=10)
        top = sorted(pk, key=lambda k: -S[k])[:4]
        # 減衰: エネルギーが開始の -20dB へ落ちるまで
        e0 = en[j0]; k = j0
        while k < len(en) - 1 and en[k] > e0 * 0.01: k += 1
        cen = (f[band] * S[band]).sum() / S[band].sum()
        print(f't={t[i]+t0:6.3f}  lvl {lev:6.1f}  decay-to-20dB {t[k]-t[j0]:5.2f}s  centroid {cen:5.0f}Hz  peaks ' + ', '.join(f'{f[p]:.0f}Hz({nn(f[p])})/{10*np.log10(S[p]/S[top[0]]):+.0f}dB' for p in top))
if __name__ == '__main__':
    a = sys.argv; main(a[1], float(a[2]) if len(a) > 2 else 0, float(a[3]) if len(a) > 3 else None)
