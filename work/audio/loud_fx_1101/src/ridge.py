import sys, numpy as np
from scipy.signal import stft
sys.path.insert(0, '.')
from meas import *
R = '/home/kabatan/work/scratch_1031/audiolift/refs/'
def ridge(name, t0, t1, fmin, fmax, step=0.02, n=2048):
    x = load(R + name + '.wav').mean(1); x = x[int(t0 * SR):int(t1 * SR)]
    f, t, Z = stft(x, SR, nperseg=n, noverlap=n - 240); M = np.abs(Z) ** 2; b = (f >= fmin) & (f <= fmax); fb = f[b]
    out = []
    for k in range(0, M.shape[1], int(step / 0.005)):
        s = M[b, k]; i = int(s.argmax()); 
        if 0 < i < len(s) - 1:
            a_, b_, c_ = np.log(s[i - 1] + 1e-20), np.log(s[i] + 1e-20), np.log(s[i + 1] + 1e-20); d = 0.5 * (a_ - c_) / (a_ - 2 * b_ + c_ + 1e-20); fr = fb[i] + d * (fb[1] - fb[0])
        else: fr = fb[i]
        out.append((t0 + t[k], fr, 10 * np.log10(s[i] / M[:, k].sum() + 1e-12)))
    return out
def harm(name, t0, t1, f0, K=8):
    x = load(R + name + '.wav').mean(1); x = x[int(t0 * SR):int(t1 * SR)]
    F = np.fft.rfftfreq(len(x), 1 / SR); S = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2; r = []
    for k in range(1, K + 1):
        m = (F > k * f0 * 0.985) & (F < k * f0 * 1.015); r.append(round(10 * np.log10(S[m].max() / S.max() + 1e-12)) if m.any() else None)
    return r
if __name__ == '__main__':
    a = sys.argv; name = a[1]; t0, t1, fmin, fmax = map(float, a[2:6]); step = float(a[6]) if len(a) > 6 else 0.02
    for t, f, l in ridge(name, t0, t1, fmin, fmax, step): print(f'{t:6.3f}  {f:7.1f}Hz  {l:6.1f}dB')
