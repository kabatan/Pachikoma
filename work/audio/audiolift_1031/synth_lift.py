#!/usr/bin/env python3
# 10/31 JPチャンス・配当ルーレット・JP成功の「迫力」用の音を全部合成する(外部素材・AI生成なし。numpy/scipy のみ)。
# 出力: sfx/*.ogg(48kHz ステレオ, Vorbis q7)。 python3 synth_lift.py [名前...]  (省略で全部)
import numpy as np, subprocess, sys, os
from scipy.signal import butter, sosfilt, fftconvolve
SR = 48000; HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, 'sfx'); os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(1031)
T = lambda d: np.arange(int(d * SR)) / SR
def noise(d, seed=None): return (np.random.default_rng(seed) if seed is not None else rng).standard_normal(int(d * SR))
def lp(x, fc, o=2): return sosfilt(butter(o, min(fc, SR * .45) / (SR / 2), 'low', output='sos'), x)
def hp(x, fc, o=2): return sosfilt(butter(o, fc / (SR / 2), 'high', output='sos'), x)
def bp(x, a, b, o=2): return sosfilt(butter(o, [a / (SR / 2), min(b, SR * .45) / (SR / 2)], 'band', output='sos'), x)
def env(n, att=.002, dec=.2, curve=1.0):
    t = np.arange(n) / SR; e = np.exp(-t / max(dec, 1e-4)) ** curve; a = np.minimum(1, t / max(att, 1e-4)); return e * a
def sat(x, k=1.0): return np.tanh(k * x) / np.tanh(k)
def sweep(f0, f1, d, tau=None):
    f1 = max(f1, 46); f0 = max(f0, f1 + 4)   # 小さな筐体のスピーカーでも出る下限(46Hz)
    t = T(d); tau = tau or d / 3; f = f1 + (f0 - f1) * np.exp(-t / tau); ph = 2 * np.pi * np.cumsum(f) / SR; return np.sin(ph)
def add(dst, src, at=0.0, g=1.0):
    i = int(at * SR); n = min(len(src), len(dst) - i)
    if n > 0: dst[i:i + n] += src[:n] * g
def st(m, wide=.0, seed=0):
    # モノ→ステレオ(広がり: 左右でわずかに時間差・位相差)
    if wide <= 0: return np.stack([m, m])
    d = int(.0006 * SR + wide * .0009 * SR); r = np.concatenate([np.zeros(d), m[:-d]]) if d > 0 else m
    s = hp(noise(len(m) / SR, seed + 7), 800) * 0; return np.stack([m, r * (1 - .1 * wide) + s])
def rev(x2, t60=1.2, wet=.25, seed=3):
    n = int(t60 * 1.2 * SR); t = np.arange(n) / SR
    out = []
    for c in range(2):
        ir = np.random.default_rng(seed + c).standard_normal(n) * np.exp(-6.9 * t / t60); ir = lp(ir, 7000); ir[0] = 0
        out.append(fftconvolve(x2[c], ir)[:x2.shape[1]])
    return x2 + wet * np.stack(out) / (np.abs(np.stack(out)).max() + 1e-9) * np.abs(x2).max()
def brass(f, d, att=.03, rel=.25, bright=3500, g=1.0, n_voices=5):
    t = T(d + rel); y = np.zeros(len(t))
    for v in range(n_voices):
        det = 1 + (v - (n_voices - 1) / 2) * .0035; ff = f * det; nh = int(min(24, 9000 / ff))
        for k in range(1, nh + 1): y += np.sin(2 * np.pi * ff * k * t + v * 1.7) / k * (1 if k < 18 else .5)
    y /= n_voices
    e = np.minimum(1, t / att) * np.where(t < d, 1, np.exp(-(t - d) / (rel / 4)))
    # 音量が立ち上がる間に明るさも開く(ブラスの吹き込み)
    y1 = lp(y, bright * .35); y2 = lp(y, bright); o = np.minimum(1, t / (att * 3)); y = y1 * (1 - o) + y2 * o
    return y * e * g
def bell(f, d, g=1.0, ratios=(1, 2.76, 5.4, 8.93), amps=(1, .6, .35, .2)):
    t = T(d); y = np.zeros(len(t))
    for r, a in zip(ratios, amps): y += a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / (d / (3 + r * .6)))
    return y * g
def kick(d=.5, f0=140, f1=42, g=1.0, click=.6):
    y = sweep(f0, f1, d, tau=.045) * env(int(d * SR), .001, d / 3.5)
    c = hp(noise(.012, 5), 1500) * env(int(.012 * SR), .0003, .003) * click
    out = y.copy(); out[:len(c)] += c; return out * g
def snare(d=.25, g=1.0):
    n = int(d * SR); body = np.sin(2 * np.pi * 190 * T(d)) * env(n, .0005, .045)
    nz = bp(noise(d), 1800, 9000) * env(n, .0005, .07); return (body * .5 + nz) * g
def crash(d=3.0, g=1.0, seed=11):
    n = int(d * SR); y = hp(noise(d, seed), 2500) * env(n, .002, d / 4.5)
    sh = bp(noise(d, seed + 1), 5000, 14000) * env(n, .02, d / 3) * .5; return (y + sh) * g
BANDS = [(20, 60), (60, 120), (120, 250), (250, 500), (500, 1000), (1000, 2000), (2000, 4000), (4000, 8000), (8000, 16000)]
# 実機の動画の音の帯域配分(全エネルギーに対する各帯域の割合 dB)。work/audio/audiolift_1031/REFERENCE.md の測定。実機は 60Hz 以下がほぼ無く、250Hz〜4kHz に壁がある
TARGET_WIN = [-40, -21, -9, -13, -9, -5, -6.5, -11.5, -16]       # 成功・配当獲得(02_success/04_reward の手本4本の平均)
TARGET_CHANCE = [-33, -18, -7, -10, -9, -7, -5, -12, -17]        # チャンス・ルーレット(01_chance/03_roulette の手本)
def match_eq(x2, target, strength=.75, lim=12):
    n = x2.shape[1]; N = 1 << int(np.ceil(np.log2(n + 1))); X = np.fft.rfft(x2, N, axis=1); f = np.fft.rfftfreq(N, 1 / SR)
    m = X[0] if True else None; P = (np.abs(X) ** 2).sum(axis=0); tot = P.sum() + 1e-20
    cur = np.array([10 * np.log10(P[(f >= a) & (f < b)].sum() / tot + 1e-12) for a, b in BANDS]); d = np.clip((np.array(target) - cur) * strength, -lim, lim)
    cf = np.array([np.sqrt(a * b) for a, b in BANDS]); g = np.interp(np.log(np.maximum(f, 1)), np.log(cf), d); g[f < 20] = d[0]
    X *= (10 ** (g / 20))[None]; return np.fft.irfft(X, N, axis=1)[:, :n]
def norm(x2, peak=.97, k=1.15, target=None):
    x2 = np.stack([hp(c, 50) for c in x2]); x2 = x2 - .6 * np.stack([lp(c, 100) for c in x2])   # 100Hz以下を約8dB絞る(実機の音は60Hz以下がほぼ無い。小さな筐体で出ない帯域に余裕を食わせない)
    if target is not None: x2 = match_eq(x2, target)
    x2 = sat(x2 / (np.abs(x2).max() + 1e-9), k); return x2 / np.abs(x2).max() * peak
def hz(note):  # 'D4' 等 → Hz
    names = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}
    if note[1] in '#b': n, o = note[:2], int(note[2:])
    else: n, o = note[0], int(note[1:])
    return 440 * 2 ** ((names[n] + 12 * (o + 1) - 69) / 12)
def write(name, x2, fade=.01):
    n = x2.shape[1]; f = int(fade * SR); x2 = x2.copy(); x2[:, -f:] *= np.linspace(1, 0, f)
    raw = (np.clip(x2.T, -1, 1) * 32767).astype('<i2').tobytes()
    p = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(SR), '-ac', '2', '-i', '-', '-c:a', 'libvorbis', '-q:a', '7', os.path.join(OUT, name + '.ogg')], input=raw, capture_output=True)
    if p.returncode: raise RuntimeError(p.stderr.decode())
    print(name, f'{n / SR:.2f}s peak {20 * np.log10(np.abs(x2).max()):.1f}dB')

# ---------- 入賞の衝撃(1..4: 満タンへ向かうほど重く厚く) ----------
def hit(stage):
    d = [1.0, 1.2, 1.5, 2.2][stage - 1]; n = int(d * SR); y = np.zeros(n)
    add(y, kick(.7, 150, 40 + 2 * stage, click=.8), 0, 1.0)                                   # 低い衝撃
    add(y, sweep(70, 34, 1.0, .18) * env(int(1.0 * SR), .003, .35) , 0, .7 + .1 * stage)     # 重低音の尾
    add(y, snare(.3), 0, .75)                                                                 # 割れ
    root = [hz('D4'), hz('F#4'), hz('A4'), hz('D5')][stage - 1]
    add(y, bell(root, .9, 1), 0, .30); add(y, bell(root * 1.5, .9), .02, .18)                 # 金属の響き
    if stage >= 2: add(y, brass(hz('D3'), .22, .008, .25, 3600), 0, .45); add(y, brass(hz('A3'), .22, .008, .25, 3600), 0, .35)
    if stage >= 3: add(y, brass(hz('F#4'), .3, .01, .3, 4200), 0, .4); add(y, crash(1.4, .6, 20 + stage), 0.0, .5)
    if stage >= 4: add(y, brass(hz('D4'), .5, .01, .5, 5200), 0, .5); add(y, brass(hz('A4'), .5, .01, .5, 5200), 0, .35); add(y, crash(2.2, .9, 29), 0, .6)
    x = st(y, .6); x = rev(x, 1.0 + .3 * stage, .18 + .04 * stage); return norm(x, .97, 1.4, TARGET_CHANCE)
# ---------- 鎖が切れる(重低音の爆発) ----------
def chain_break(big=False):
    d = 3.0 if big else 2.2; n = int(d * SR); y = np.zeros(n)
    nz = noise(d, 40); lo = np.zeros(n)
    for i, (a, b) in enumerate([(9000, 4000), (4000, 1500), (1500, 500), (500, 220)]):
        seg = slice(int(i * .12 * SR), int((i * .12 + 0.5) * SR)); w = nz[seg]; lo[seg] += lp(w, (a + b) / 2) * env(len(w), .004, .22)
    y += lo * .8                                                                         # 爆発(降りてゆく帯域ノイズ)
    add(y, kick(1.0, 130, 30, click=.9), 0, 1.2)                                         # 重低音
    add(y, sweep(60, 22, 1.8, .4) * env(int(1.8 * SR), .01, .7), 0.02, 1.0)              # 地鳴り
    add(y, sat(sweep(95, 40, .7, .1), 3) * env(int(.7 * SR), .002, .2), 0, .6)           # 歪んだ低域(小スピーカーでも聞こえる)
    for k in range(26):                                                                  # 鎖の千切れる金属音
        at = .02 + k * .026 * (1 + k * .04) + rng.random() * .02; f = 1800 + rng.random() * 4200
        c = bp(noise(.25, 100 + k), f * .6, f * 1.5) * env(int(.25 * SR), .0004, .012) + bell(f * .5, .25, .12, (1, 2.4, 5.1), (1, .5, .2))
        add(y, c, at, .55 * np.exp(-k * .06))
    add(y, crash(1.8 if big else 1.2, .9 if big else .5, 33), 0, .55)
    if big: add(y, brass(hz('D3'), .7, .01, .6, 3000), .05, .6); add(y, brass(hz('A3'), .7, .01, .6, 3000), .05, .45)
    x = st(y, .8); x = rev(x, 1.6 if big else 1.0, .22); return norm(x, .98, 1.6, TARGET_CHANCE)
# ---------- 封印の扉が開く(最大) ----------
def door_open():
    d = 4.5; n = int(d * SR); y = np.zeros(n)
    r = hp(noise(1.0, 51), 300) * (np.linspace(0, 1, int(SR)) ** 2.2); add(y, lp(r, 9000), 0, .5)      # 迫り上がるノイズ
    add(y, sweep(40, 90, 1.0, 1.0) * np.linspace(0, 1, int(SR)) * .6, 0, .5)
    t0 = 1.0
    add(y, kick(1.6, 120, 28, click=1.0), t0, 1.5); add(y, sweep(70, 24, 2.5, .6) * env(int(2.5 * SR), .01, 1.0), t0, 1.2)
    add(y, crash(3.4, 1.0, 61), t0, .7); add(y, snare(.4), t0, .8)
    for i, nt in enumerate(['D3', 'A3', 'D4', 'F#4', 'A4']): add(y, brass(hz(nt), 1.6, .02, .9, 5200), t0 + .03 * i, .42)
    for k in range(18): add(y, bell(hz('D6') * (1 + .5 * (k % 3 == 1) + (k % 3 == 2) * .25), .8, 1.0), t0 + .3 + k * .11, .1 * np.exp(-k * .08))
    x = rev(st(y, .7), 2.4, .25); return norm(x, .98, 1.5, TARGET_WIN)
# ---------- 緊張(時間が減るほど高まる層) ----------
def drone(f=hz('D2'), L=3.2):
    t = T(L); f = round(f * L) / L; lfo = lambda r, ph=0: .5 + .5 * np.sin(2 * np.pi * round(r * L) / L * t + ph)
    ch = []
    for det in (-1, 1):
        y = np.zeros(len(t)); ff = round((f * (1 + det * .004)) * L) / L
        for k in range(1, 14): y += np.sin(2 * np.pi * ff * k * t + det) / k * (lfo(.625 * 1, k) * .6 + .4 if k > 3 else 1)
        ch.append(y)
    y = np.stack(ch); y = np.stack([lp(y[0], 420, 3), lp(y[1], 420, 3)]); y *= (0.6 + .4 * lfo(1.25))[None]
    return y / np.abs(y).max() * .9
def pulse(double=True):
    d = .55; y = np.zeros(int(d * SR)); add(y, kick(.4, 110, 52, click=.2), 0, 1.0)
    if double: add(y, kick(.4, 100, 48, click=.2), .17, .7)
    return norm(st(lp(y, 600, 2), .0), .9, 1.1)
def riser(d=4.0):
    n = int(d * SR); t = T(d); u = (t / d); y = np.zeros(n)
    s = sosfilt(butter(2, [200 / 24000, 3000 / 24000], 'band', output='sos'), noise(d, 70)); y += s * u ** 2.5 * 1.0
    y += np.sin(2 * np.pi * np.cumsum(80 + 900 * u ** 2.2) / SR) * u ** 2 * .35
    x = st(y, .5); return norm(x, .9, 1.1)
# ---------- ルーレット ----------
def roll(L=2.0):
    n = int(L * SR); y = np.zeros(n); step = L / 40
    for k in range(40): add(y, snare(.12, 1.0), k * step, (.7 + .3 * (k % 2 == 0)))
    z = lp(y, 9000); return norm(st(z, .3), .9, 1.2, TARGET_CHANCE)
def press():
    y = np.zeros(int(.8 * SR)); add(y, kick(.5, 170, 50, click=1.0), 0, 1.0); add(y, snare(.25), 0, .8); add(y, bell(hz('A5'), .6), 0, .25)
    return norm(rev(st(y, .5), .8, .15), .95, 1.4, TARGET_CHANCE)
def slam():
    d = 3.4; y = np.zeros(int(d * SR))
    add(y, kick(1.3, 135, 32, click=1.0), 0, 1.4); add(y, sweep(66, 24, 2.2, .5) * env(int(2.2 * SR), .006, .8), 0, 1.0)
    add(y, snare(.4), 0, 1.0); add(y, crash(3.0, 1.0, 81), 0, .75)
    for nt, a in (('D3', 0), ('A3', 0), ('D4', 0), ('F#4', .02), ('A4', .02)): add(y, brass(hz(nt), .5, .008, .6, 4800), a, .5)
    add(y, bell(hz('D5'), 2.0), 0, .3); add(y, bell(hz('A5'), 1.8), .02, .22)
    return norm(rev(st(y, .8), 1.8, .22), .99, 1.6, TARGET_WIN)
def promo(t):  # 昇格(0..4):上がるほど長く高く厚く
    notes = ['D5', 'F#5', 'A5', 'D6', 'F#6'][:t + 1]; d = .5 + .35 * (t + 1); y = np.zeros(int(d * SR))
    for i, nt in enumerate(notes):
        at = .085 * i; add(y, bell(hz(nt), .9, 1.0), at, .6); add(y, brass(hz(nt) / 2, .22, .006, .2, 5000), at, .32); add(y, kick(.25, 120, 60, click=.3), at, .5 + .08 * i)
    add(y, crash(1.2 + .3 * t, .6, 90 + t), .085 * t, .35 + .08 * t)
    return norm(rev(st(y, .6), 1.0 + .2 * t, .2), .96, 1.4, TARGET_WIN)
# ---------- JP成功(最大) ----------
def win(root='D'):
    r = {'D': 0, 'A': 7}[root]; sh = lambda nt: hz(nt) * 2 ** (r / 12)
    d = 8.0; n = int(d * SR); y = np.zeros(n)
    # 0: 溜めなしの全開の一撃
    add(y, kick(1.8, 140, 28, click=1.0), 0, 1.6); add(y, sweep(70, 22, 3.0, .7) * env(int(3.0 * SR), .008, 1.2), 0, 1.3)
    add(y, sat(sweep(100, 42, .9, .12), 3) * env(int(.9 * SR), .002, .3), 0, .7)
    add(y, snare(.5), 0, 1.0); add(y, crash(4.5, 1.0, 101), 0, .85)
    # ファンファーレ(ブラスのコード → 上昇 → 保持)
    chords = [(0, ['D3', 'A3', 'D4', 'F#4', 'A4']), (.42, ['D3', 'A3', 'D4', 'F#4', 'A4']), (.84, ['E3', 'B3', 'E4', 'G#4', 'B4']), (1.26, ['F#3', 'C#4', 'F#4', 'A#4', 'C#5']), (1.68, ['D3', 'A3', 'D4', 'F#4', 'A4', 'D5'])]
    for at, ch in chords:
        dur = .34 if at < 1.68 else 3.6
        for nt in ch: add(y, brass(sh(nt), dur, .012, .5 if at >= 1.68 else .12, 5600), at, .42)
        if at < 1.68: add(y, kick(.3, 110, 60, click=.4), at, .8); add(y, snare(.2), at, .5)
    add(y, crash(4.0, 1.0, 111), 1.68, .8); add(y, kick(1.4, 130, 30, click=1.0), 1.68, 1.4)
    # ティンパニ風の連打 → 金属の雨(コインとベル)
    for k in range(10): add(y, kick(.35, 90, 55, click=.1), 2.0 + k * .25, .6)
    for k in range(150):
        at = 1.9 + rng.random() * 5.2; f = 1800 * 2 ** (rng.random() * 2.3); a = .20 * np.exp(-(at - 1.9) / 3.6)
        add(y, bell(f, .5 + rng.random() * .4, 1.0, (1, 2.4, 4.1), (1, .4, .2)), at, a)
    for k in range(60): add(y, bp(noise(.04, 300 + k), 3000, 9000) * env(int(.04 * SR), .0003, .01), 1.9 + rng.random() * 4.5, .35)
    # ベルの上昇アルペジオ(輝き)
    for k, nt in enumerate(['D5', 'F#5', 'A5', 'D6', 'F#6', 'A6', 'D7']): add(y, bell(sh(nt), 1.2, 1.0), 2.4 + k * .09, .22)
    x = st(y, 1.0)
    # 左右に散らす雨(広がり): 高域だけ別に遅らせて足す
    x[1] += np.roll(hp(y, 3500), int(.011 * SR)) * .4
    x = rev(x, 3.2, .3); return norm(x, .99, 1.7, TARGET_WIN)

JOBS = {'al_hit_1': lambda: hit(1), 'al_hit_2': lambda: hit(2), 'al_hit_3': lambda: hit(3), 'al_hit_4': lambda: hit(4),
        'al_break': lambda: chain_break(False), 'al_break_big': lambda: chain_break(True), 'al_door': door_open,
        'al_drone': drone, 'al_pulse1': lambda: pulse(False), 'al_pulse2': lambda: pulse(True), 'al_riser': riser,
        'al_roll': roll, 'al_press': press, 'al_slam': slam, 'al_promo_0': lambda: promo(0), 'al_promo_1': lambda: promo(1), 'al_promo_2': lambda: promo(2), 'al_promo_3': lambda: promo(3), 'al_promo_4': lambda: promo(4),
        'al_win_first': lambda: win('D'), 'al_win_chain': lambda: win('A')}
if __name__ == '__main__':
    want = sys.argv[1:] or list(JOBS)
    for k in want: write(k, JOBS[k]())
