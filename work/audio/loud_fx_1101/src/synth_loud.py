# 超つくこまRUSH・継続まわりの「決め」の音(10/31〜11/1 loud_fx)。声なし・全部合成(numpy/scipy)。外部の素材・録音は使っていない。
# 作りの手本(実機パチンコの大当たり/RUSH突入/継続の決めの音の「構成」。音そのものは写していない):
#   ① 頭に低音の衝撃(キック+サブの落下。120Hz前後〜が主で、20-60Hzはほぼ作らない=実機の測定どおり)
#   ② 同時に金属の打撃(ゴング/アンビルの非整数倍音の鳴り)とスネア状のひび(1.5-8kHzのノイズ)
#   ③ ブラスの和音(長三和音をオクターブ重ね、明るさが頭で開く)+ティンパニ
#   ④ 直後にシンバルのクラッシュ(逆回転の吸い込みを頭の前に)と、金属の雨(きらめき)
#   ⑤ 決めの前は「溜め」: 上昇音(ライザー)で詰めて、決めの1コマ手前は静かにする(静かにする側はランタイムのダッキング)
#   ⑥ 全体を強く飽和させて音の密度を上げる(実機は RMS-8dB前後・ピークは0dBFSに張り付く)
# 生成: python3 synth_loud.py [名前...]   出力: ../sfx_wav/*.wav(確認用) と ../sfx_ogg/*.ogg(実行時に読むもの)、../meta.json(頭=アンカー秒)
import sys, os, json, subprocess
import numpy as np
from scipy import signal as sg

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_WAV = os.path.join(HERE, '..', 'sfx_wav'); OUT_OGG = os.path.join(HERE, '..', 'sfx_ogg')
FPS = 30


def seed_of(name):
    return abs(hash(name)) % 1000 if False else sum(ord(c) * (i + 1) for i, c in enumerate(name)) % 100000


class R:  # 乱数(名前ごとに固定)
    def __init__(self, name): self.g = np.random.default_rng(seed_of(name))


def T(d): return np.arange(int(round(d * SR))) / SR
def db(x): return 10 ** (x / 20)


def stereo(m, s=None):
    return np.stack([m, m if s is None else s], 1)


def bp(x, lo, hi, order=3):
    sos = sg.butter(order, [lo, min(hi, SR / 2 - 100)], btype='band', fs=SR, output='sos'); return sg.sosfilt(sos, x, axis=0)


def hp(x, f, order=3): return sg.sosfilt(sg.butter(order, f, 'hp', fs=SR, output='sos'), x, axis=0)
def lp(x, f, order=3): return sg.sosfilt(sg.butter(order, min(f, SR / 2 - 100), 'lp', fs=SR, output='sos'), x, axis=0)


def pad(x, n):
    if len(x) >= n: return x[:n]
    return np.concatenate([x, np.zeros((n - len(x),) + x.shape[1:])])


def place(buf, x, at, g=1.0):
    i = int(round(at * SR))
    if i < 0: x = x[-i:]; i = 0
    n = min(len(x), len(buf) - i)
    if n > 0: buf[i:i + n] += x[:n] * g
    return buf


def noise2(r, n):
    return np.stack([r.g.standard_normal(n), r.g.standard_normal(n)], 1)


def env_ad(n, a, tau, hold=0.0):
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-4), 1.0)
    e = e * np.where(t < a + hold, 1.0, np.exp(-(t - a - hold) / tau))
    return e


# ---- 部品 ----
def sub_boom(r, dur=0.8, f0=130.0, f1=46.0, tau=0.28, click=True):
    """低音の衝撃。周波数が落ちるサイン+2倍音の軽い飽和。実機に倣い 45Hz 以下は切る。"""
    t = T(dur); f = f1 + (f0 - f1) * np.exp(-t / 0.07); ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) + 0.35 * np.sin(2 * ph + 0.4)
    x = np.tanh(1.6 * x) * env_ad(len(t), 0.002, tau)
    if click:
        c = bp(r.g.standard_normal(len(t)), 800, 5000) * env_ad(len(t), 0.0005, 0.012) * 0.5; x = x + c
    return stereo(hp(x, 45))


def timpani(r, f=98.0, dur=0.9, tau=0.32):
    t = T(dur); fr = f * (1 + 0.45 * np.exp(-t / 0.05)); ph = 2 * np.pi * np.cumsum(fr) / SR
    x = (np.sin(ph) + 0.5 * np.sin(1.5 * ph) * np.exp(-t / 0.2) + 0.3 * np.sin(2.0 * ph)) * env_ad(len(t), 0.001, tau)
    x = x + bp(r.g.standard_normal(len(t)), 500, 3500) * env_ad(len(t), 0.0005, 0.02) * 0.6
    return stereo(hp(np.tanh(1.4 * x), 50))


def crack(r, dur=0.35, lo=1500, hi=9000, tau=0.05, a=0.0006):
    n = int(dur * SR); x = noise2(r, n)
    return bp(x, lo, hi) * env_ad(n, a, tau)[:, None]


def metal_hit(r, base=520.0, dur=1.6, bright=1.0, tau0=0.7):
    """ゴング/アンビルの打撃: 非整数倍音(各々が別の減衰)+打撃のノイズ。左右で少しずらす。"""
    ratios = [1.0, 1.593, 2.136, 2.295, 2.653, 3.156, 3.50, 4.07, 4.86, 5.43, 6.21, 7.33]
    n = int(dur * SR); t = np.arange(n) / SR; out = np.zeros((n, 2))
    for k, rt in enumerate(ratios):
        for c, dtn in ((0, 1.0), (1, 1.0035)):
            f = base * rt * dtn * (1 + 0.002 * r.g.standard_normal())
            if f > 14000: continue
            tau = tau0 / (1 + 0.55 * k) + 0.05
            amp = (1.0 / (1 + 0.25 * k)) * (bright if k >= 4 else 1.0)
            out[:, c] += amp * np.sin(2 * np.pi * f * t + r.g.uniform(0, 6.28)) * np.exp(-t / tau)
    out *= env_ad(n, 0.0008, 10.0)[:, None]
    out += crack(r, dur, 2500, 12000, 0.03)[:n] * 0.6
    return out / np.abs(out).max()


def brass(r, notes, dur=1.0, a=0.012, tau=0.55, hold=0.1, bright0=0.55, bright1=0.92, bright_t=0.05, vib=0.0, detune=0.004):
    """ブラスの和音: 倍音を足し合わせ、明るさ(高次倍音の量)が頭で開く。各音を左右へ少し振る。"""
    n = int(dur * SR); t = np.arange(n) / SR; out = np.zeros((n, 2))
    b = bright0 + (bright1 - bright0) * np.minimum(1, t / max(bright_t, 1e-3)); b = np.where(t > bright_t + 0.4, bright1 - 0.12 * np.minimum(1, (t - bright_t - 0.4) / 0.8), b)
    amp_env = env_ad(n, a, tau, hold)
    for vi, f in enumerate(notes):
        pan = (vi % 3 - 1) * 0.3
        for c, dtn in ((0, 1 - detune), (1, 1 + detune)):
            ff = f * dtn * (1 + vib * np.sin(2 * np.pi * 5.2 * t + vi))
            ph = 2 * np.pi * np.cumsum(np.broadcast_to(ff, (n,))) / SR
            v = np.zeros(n)
            kmax = int(min(40, 11000 / f))
            for k in range(1, kmax + 1):
                v += (k ** -0.85) * (b ** (k - 1)) * np.sin(k * ph + 0.3 * k)
            gl, gr = 1 - max(0, pan), 1 + min(0, pan)
            out[:, c] += v * (gl if c == 0 else gr)
    out *= amp_env[:, None]
    return out / np.abs(out).max()


def cymbal(r, dur=2.0, tau=0.9, a=0.004, lo=4500):
    n = int(dur * SR); x = noise2(r, n); x = hp(x, lo, 2)
    # 金属らしさ: 数本の帯域を鳴らす
    comb = sum(bp(x, f, f * 1.25, 2) * (0.6 + 0.4 * r.g.random()) for f in (5200, 6800, 8300, 10100))
    return comb / np.abs(comb).max() * env_ad(n, a, tau)[:, None]


def reverse_swell(r, dur=0.35, lo=3500):
    n = int(dur * SR); x = noise2(r, n); x = hp(x, lo, 2); e = (np.arange(n) / n) ** 2.2
    return x * e[:, None]


def sparkle(r, dur=1.6, density=22, f_lo=2500, f_hi=9000, tau=0.25, decay_dens=0.5):
    """金属の雨(きらめき): ランダムな高いチンを時間とともにまばらに。"""
    n = int(dur * SR); out = np.zeros((n, 2))
    for _ in range(int(density * dur)):
        u = r.g.random() ** (1 + decay_dens * 2); at = u * dur * 0.98
        f = np.exp(r.g.uniform(np.log(f_lo), np.log(f_hi))); d = 0.18 + 0.25 * r.g.random()
        tt = np.arange(int(d * SR)) / SR
        x = np.sin(2 * np.pi * f * tt) + 0.4 * np.sin(2 * np.pi * f * 2.76 * tt) * np.exp(-tt / 0.05)
        x *= np.exp(-tt / (tau * 0.4)) * (0.35 + 0.65 * r.g.random()) * (1 - 0.6 * at / dur)
        p = r.g.random(); i = int(at * SR); m = min(len(x), n - i)
        out[i:i + m, 0] += x[:m] * (1 - p); out[i:i + m, 1] += x[:m] * p
    return out


def crackle(r, dur=0.4, rate=70, lo=1200, hi=7000):
    """雷/稲妻のひび割れ: 不規則な間隔の短いノイズ破裂。"""
    n = int(dur * SR); out = np.zeros((n, 2))
    k = int(rate * dur)
    for _ in range(k):
        at = r.g.random() ** 0.8 * dur * 0.98; d = 0.004 + 0.02 * r.g.random(); m = int(d * SR); i = int(at * SR); m = min(m, n - i)
        x = r.g.standard_normal((m, 2)) * np.exp(-np.arange(m) / SR / (d * 0.4))[:, None] * (0.3 + 0.7 * r.g.random())
        out[i:i + m] += x
    return bp(out, lo, hi)


def riser(r, dur, f0=140.0, f1=1100.0, gate_from=None, gate_hz=15.0, noise_lo=(400, 800), noise_hi=(5000, 11000)):
    """上昇音: ノコギリの滑り上がり(2オクターブ+)+上がる帯域ノイズ。尾は音量が最大のまま切る(決めの頭で止める)。"""
    n = int(dur * SR); t = np.arange(n) / SR; u = t / dur
    f = f0 * (f1 / f0) ** (u ** 1.3); ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.zeros(n)
    for k in range(1, 14): x += (k ** -1.0) * np.sin(k * ph) * (f * k < 11000)
    x2 = np.zeros(n)
    for k in range(1, 14): x2 += (k ** -1.0) * np.sin(k * ph * 1.007) * (f * k < 11000)
    sweep = noise2(r, n)
    # 時間とともに帯域を上げたノイズ: 区間ごとに通過帯域を変えて足す
    nz = np.zeros((n, 2)); segs = 8
    for s in range(segs):
        a, b = int(n * s / segs), int(n * (s + 1) / segs); w = s / (segs - 1)
        lo = noise_lo[0] + (noise_hi[0] - noise_lo[0]) * w; hi = noise_lo[1] + (noise_hi[1] - noise_lo[1]) * w
        seg = bp(sweep[a:b], lo, hi, 2); nz[a:b] = seg
    e = (0.25 + 0.75 * u ** 1.5)
    m = np.stack([x * 0.8, x2 * 0.8], 1) + nz * 1.1
    m *= e[:, None]
    if gate_from is not None:   # 最後の数コマはストロボの点滅に合わせて刻む(液晶の白黒の点滅)
        g = np.ones(n); i0 = int(gate_from * SR)
        gate = (np.sin(2 * np.pi * gate_hz * (t[i0:] - gate_from) + np.pi / 2) > -0.2).astype(float)
        g[i0:] = 0.3 + 0.7 * gate; m *= g[:, None]
    # 頭と尾の処理: 頭は短く立ち上げ、尾は最大のまま(クリックを避けるため 3ms だけ)
    f_in = np.minimum(1, t / 0.004); f_out = np.minimum(1, (dur - t) / 0.003)
    return m * (f_in * f_out)[:, None]


def reverb(x, rt=1.1, wet=0.18, pre=0.012, lo=250, r=None):
    n = int(rt * 1.6 * SR); t = np.arange(n) / SR
    ir = np.stack([r.g.standard_normal(n), r.g.standard_normal(n)], 1) * np.exp(-6.9 * t / rt)[:, None]
    ir = hp(ir, lo, 1); ir[: int(pre * SR)] = 0; ir = ir / np.sqrt((ir ** 2).sum())
    wetx = np.stack([sg.fftconvolve(x[:, c], ir[:, c])[: len(x)] for c in range(2)], 1)
    return x + wet * wetx * np.sqrt((x ** 2).sum() / max((wetx ** 2).sum(), 1e-9)) * 1.0


BANDS = [(20, 60), (60, 120), (120, 250), (250, 500), (500, 1000), (1000, 2000), (2000, 4000), (4000, 8000), (8000, 16000)]
TARGET_WIN = [-40, -21, -9, -13, -9, -5, -6.5, -11.5, -16]      # 実機の成功・配当獲得音4本の帯域配分の平均(work/audio/audiolift_1031/REFERENCE.md の測定値)


def match_eq(x, target=TARGET_WIN, strength=0.85, lim=18):
    """帯域配分を実機の測定値へ寄せる(音そのものは写さない。配分の数字だけ)。"""
    x2 = x.T; n = x2.shape[1]; N = 1 << int(np.ceil(np.log2(n + 1))); X = np.fft.rfft(x2, N, axis=1); f = np.fft.rfftfreq(N, 1 / SR)
    P = (np.abs(X) ** 2).sum(axis=0); tot = P.sum() + 1e-20
    cur = np.array([10 * np.log10(P[(f >= a) & (f < b)].sum() / tot + 1e-12) for a, b in BANDS]); d = np.clip((np.array(target) - cur) * strength, -lim, lim)
    cf = np.array([np.sqrt(a * b) for a, b in BANDS]); g = np.interp(np.log(np.maximum(f, 1)), np.log(cf), d); g[f < 20] = d[0]
    X *= (10 ** (g / 20))[None]; return np.fft.irfft(X, N, axis=1)[:, :n].T


def softclip(x, drive=2.2):
    return np.tanh(drive * x) / np.tanh(drive)


def finish(x, drive=2.2, peak_db=-0.6, tail_fade=0.03, rms_target=None, eq=True):
    """飽和して音の密度を上げ、天井(peak_db)へ。rms_target[dB] があれば、最初の0.4秒の RMS がそれに近づくよう駆動を探す。"""
    x = np.nan_to_num(x)
    if eq: x = match_eq(hp(x, 50, 2))
    def go(dv):
        y = softclip(x / np.abs(x).max(), dv); return y / np.abs(y).max() * db(peak_db)
    if rms_target is not None:
        n = int(0.4 * SR)
        for dv in (1.0, 1.4, 1.8, 2.2, 2.8, 3.4, 4.2, 5.0, 6.5, 8.0):
            y = go(dv); r_ = 20 * np.log10(np.sqrt((y[:n] ** 2).mean()) + 1e-12)
            if r_ >= rms_target: break
    else:
        y = go(drive)
    # 末尾のフェード
    nf = int(tail_fade * SR); y[-nf:] *= np.linspace(1, 0, nf)[:, None]
    return y


# ---- 和音(Hz) ----
def N(name):
    names = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}
    return names


def hz(note, octv):
    k = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}[note]
    return 440.0 * 2 ** ((k - 9 + 12 * (octv - 4)) / 12)


def major_stack(root, oct0, big=True):
    ks = {'D': ('D', 'F#', 'A'), 'A': ('A', 'C#', 'E'), 'E': ('E', 'G#', 'B'), 'F#': ('F#', 'A#', 'C#'), 'B': ('B', 'D#', 'F#')}[root]
    notes = [hz(root, oct0), hz(root, oct0 + 1), hz(ks[2], oct0 + 1), hz(root, oct0 + 2), hz(ks[1], oct0 + 2), hz(ks[2], oct0 + 2)]
    if big: notes += [hz(root, oct0 + 3), hz(ks[1], oct0 + 3)]
    return notes


# ---- 決めの音(作り) ----
def HIT(name, root='D', oct0=2, size=1.0, dur=2.0, brass_dur=1.3, metal_base=520, sub=(130, 46), timp=True, cym=0.0, glitter=0.0, preroll=0.0,
        brass_g=1.0, metal_g=0.8, crack_g=0.7, sub_g=1.0, big=True, rms=None, drive=2.4, rev=0.12, brass_tau=0.55, bright=(0.55, 0.92), reverse=0.0):
    r = R(name); n = int((dur + preroll) * SR); buf = np.zeros((n, 2)); t0 = preroll
    place(buf, sub_boom(r, 0.9, sub[0], sub[1], 0.30 * size ** 0.5) * sub_g, t0, 1.0 * size ** 0.5)
    if timp: place(buf, timpani(r, hz(root, 2), 1.0, 0.4), t0, 0.7 * size ** 0.5)
    place(buf, metal_hit(r, metal_base, min(dur, 2.2), 1.0, 0.9 * size ** 0.5), t0, metal_g * size ** 0.5)
    place(buf, crack(r, 0.3, 1500, 9000, 0.045), t0, crack_g * size ** 0.5)
    place(buf, brass(r, major_stack(root, oct0, big), brass_dur, a=0.010, tau=brass_tau, hold=0.12, bright0=bright[0], bright1=bright[1]), t0, brass_g * size ** 0.5)
    if cym > 0: place(buf, cymbal(r, min(dur, 2.4), 1.0 * size ** 0.5), t0 + 0.004, cym)
    if glitter > 0: place(buf, sparkle(r, min(dur - 0.05, 1.8), 26, 2600, 9500, 0.3), t0 + 0.05, glitter)
    if reverse > 0 and preroll > 0:
        rs = reverse_swell(r, preroll, 3000); place(buf, rs, 0, reverse)
    y = reverb(buf, 1.0 + 0.4 * size, rev, r=r)
    return finish(y, drive, rms_target=rms), preroll


def LIGHT(name, dur=0.5, g_thump=0.7, rate=90, size=1.0):
    r = R(name); n = int(dur * SR); buf = np.zeros((n, 2))
    place(buf, crackle(r, dur, rate), 0, 1.0)
    place(buf, sub_boom(r, 0.35, 95, 50, 0.1), 0, g_thump)
    place(buf, crack(r, 0.15, 2500, 10000, 0.02), 0, 0.5)
    return finish(buf, 3.0), 0.0


def build(name, dur, gate_from=None, f0=140, f1=1100, with_crackle=None, ignite=True, gate_hz=15.0, g_ign=1.0):
    r = R(name); y = riser(r, dur, f0, f1, gate_from, gate_hz); n = len(y)
    if with_crackle is not None:
        for at, d in with_crackle:
            c = crackle(r, d, 110); place(y, c, at, 1.3)
    if ignite:
        place(y, sub_boom(r, 0.3, 110, 55, 0.08), 0, 0.9 * g_ign); place(y, crack(r, 0.12, 2000, 9000, 0.02), 0, 0.7 * g_ign)
    return finish(y, 3.2, rms_target=None), 0.0


def GLITTER(name, dur=1.8, density=34, g=1.0):
    r = R(name); y = sparkle(r, dur, density, 2600, 10000, 0.35)
    y = y + 0.35 * cymbal(r, dur, 0.5, lo=6500)[:len(y)]
    return finish(y, 2.0, peak_db=-1.5, eq=False), 0.0


def GLASS(name, dur=1.2, g=1.0):
    """継続カットインの水晶の砕け散り: 明るい小さな衝突の群れ+高域のひび。"""
    r = R(name); n = int(dur * SR); buf = np.zeros((n, 2))
    place(buf, sub_boom(r, 0.5, 120, 48, 0.16), 0, 0.9)
    place(buf, crack(r, 0.25, 2500, 11000, 0.04), 0, 0.9)
    for _ in range(46):
        at = (r.g.random() ** 1.6) * (dur - 0.3); f = np.exp(r.g.uniform(np.log(2800), np.log(10500))); d = 0.1 + 0.22 * r.g.random()
        tt = np.arange(int(d * SR)) / SR; x = (np.sin(2 * np.pi * f * tt) + 0.5 * np.sin(2 * np.pi * f * 1.5 * tt)) * np.exp(-tt / (d * 0.3)) * (0.3 + 0.7 * r.g.random())
        p = r.g.random(); i = int(at * SR); m = min(len(x), n - i); buf[i:i + m, 0] += x[:m] * (1 - p); buf[i:i + m, 1] += x[:m] * p
    place(buf, metal_hit(r, 1180, min(dur, 1.0), 1.2, 0.35), 0, 0.6)
    place(buf, brass(r, major_stack('A', 3, False), 0.7, a=0.01, tau=0.4), 0, 0.7)
    return finish(reverb(buf, 0.8, 0.1, r=r), 2.6, eq=False), 0.0



# ================= 11/1 夜: 高音で刺さる版(案A: キュイン+高速アルペジオ / 案B: サイレン+高音の持続) =================
# 手本(手元の実機成功音を再生→スペクトル・音高の追跡で分析。サンプルは使わない。数字は NOTES.md):
#   エヴァ確定(eva_kakutei): 3-6kHz が全体の -9/-8dB(従来の自作は 4-8k が -11)。2kHz 前後の単音+1.5k→2kHz の速い上昇グリッサンド+6.9kHz のチップ。
#   エヴァ10確定: 約1kHz(B5前後)の単音を長く保ち、2k・4k の倍音の梯子で刺さる(矩形波系)。
#   北斗16R確定・シンフォギア: 2.2〜2.7kHz の高音と低音の交互(ピピピ)、5〜7kHz のチップを約12回/秒で連打。
TARGET_A = [-40, -22, -11, -14, -10, -5, -4.5, -8, -14]       # 2-6kHz を前へ(従来の -6.5/-11.5 から +2/+3.5dB)
TARGET_B = [-40, -22, -11, -14, -9, -5, -5, -8.5, -14]


def sqr(ph, soft=5.0): return np.tanh(soft * np.sin(ph))


def note_seq(r, notes, t_start, step, n_dur, wave='sq', amp_fn=None, total=None, pan_alt=True, fm=0.0, atk=0.0015):
    """高速の電子音の連なり。notes[Hz] を step 秒おきに鳴らす(各音 n_dur 秒で減衰)。矩形波(任意でFM)。左右へ交互に振る。"""
    total = total or (t_start + step * len(notes) + n_dur + 0.05); n = int(total * SR); out = np.zeros((n, 2))
    for k, f in enumerate(notes):
        at = t_start + k * step; i = int(at * SR); m = int(n_dur * SR); m = min(m, n - i)
        if m <= 0: continue
        tt = np.arange(m) / SR; ph = 2 * np.pi * f * tt
        if fm: ph = ph + fm * np.sin(2 * np.pi * f * 2.0 * tt) * np.exp(-tt / (n_dur * 0.3))
        x = sqr(ph) if wave == 'sq' else np.sin(ph) + 0.4 * np.sin(2 * ph)
        x = x * np.minimum(1, tt / atk) * np.exp(-tt / (n_dur * 0.45)) * (amp_fn(k, len(notes)) if amp_fn else 1.0)
        p = (k % 2) if pan_alt else 0.5
        out[i:i + m, 0] += x * (1.0 - 0.45 * p); out[i:i + m, 1] += x * (0.55 + 0.45 * p)
    return out


def kyuin(r, dur, f0=900.0, f1=4800.0, ping=True, power=1.6):
    """キュイン: FM の上昇スイープ(指数)。上がるほどFMの深さを減らし、最後は純音に近い高いピン(2〜6kHz)で止める。"""
    n = int(dur * SR); t = np.arange(n) / SR; u = t / dur
    f = f0 * (f1 / f0) ** (u ** (1 / power * 1.0 + 0.0)); ph = 2 * np.pi * np.cumsum(f) / SR
    idx = 3.5 * (1 - u) + 0.4; x = np.sin(ph + idx * np.sin(2 * ph * 1.0)) + 0.5 * sqr(ph * 2.0, 3.0) * (u > 0.3)
    e = (0.35 + 0.65 * u ** 1.2) * np.minimum(1, t / 0.004) * np.minimum(1, (dur - t) / 0.003)
    y = np.stack([x, np.roll(x, 40)], 1) * e[:, None]
    return y


def siren(r, dur, lo=1500.0, hi=3000.0, period=0.30, rise=0.0, tri=True):
    """高いサイレン: 三角波のウェイル。period 秒で lo↔hi。rise>0 なら中心音が時間とともに上がる。"""
    n = int(dur * SR); t = np.arange(n) / SR; u = t / dur
    lfo = np.abs(2 * ((t / period) % 1.0) - 1.0)           # 0..1..0 三角
    c = (1 + rise * u); f = lo * c * (hi / lo) ** lfo
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.25 * np.sin(3 * ph)
    e = np.minimum(1, t / 0.008) * np.minimum(1, (dur - t) / 0.02)
    return np.stack([x, np.roll(x, 30)], 1) * e[:, None]


def sustain_high(r, f=1760.0, dur=2.2, a=0.004, tau=1.3, vib=0.006):
    """高音の単音の長いキメ(耳に残る持続音)。基音+奇数倍音の梯子(2k・4k・6k に線を立てる)+ゆっくりした微かな揺れ+きらめき。"""
    n = int(dur * SR); t = np.arange(n) / SR
    vv = 1 + vib * np.sin(2 * np.pi * 5.5 * t) * np.minimum(1, t / 0.3)
    out = np.zeros((n, 2))
    for c, d in ((0, 0.998), (1, 1.002)):
        ph = 2 * np.pi * np.cumsum(f * d * vv) / SR
        v = sqr(ph, 4.0) * 0.8 + 0.4 * np.sin(2 * ph) + 0.2 * np.sin(3 * ph + 1.0)
        out[:, c] = v
    e = env_ad(n, a, tau, 0.35)
    return out * e[:, None]


def pipi(r, dur, f_lo=3000.0, f_hi=5200.0, rate=22.0, gate=0.5, rising=True):
    """ピピピピ: 高速連打の電子チップ(2〜6kHz)。"""
    steps = int(dur * rate); notes = [f_lo + (f_hi - f_lo) * (k / max(1, steps - 1) if rising else (k % 2)) for k in range(steps)]
    return note_seq(r, notes, 0.0, 1.0 / rate, gate / rate, total=dur + 0.05, atk=0.0008)


def HITK(name, kind, root='D', oct0=2, size=1.0, dur=2.0, brass_dur=1.0, sub=(130, 46), timp=True, rms=-8.5, drive=2.6, preroll=0.0, rev=0.1, hi=1.0,
         arp=None, arp_rate=24.0, siren_dur=0.0, sus=None, sus_dur=2.0, chips=0.0, metal=0.12, cym=0.1, glitter=0.0, tail_bell=0.0):
    """決め(高音版): 低音の衝撃は土台に残し、金属打撃は大きく下げ、2〜6kHz の電子音を主役にする。"""
    r = R(name); n = int((dur + preroll) * SR); buf = np.zeros((n, 2)); t0 = preroll; sz = size ** 0.5
    place(buf, sub_boom(r, 0.8, sub[0], sub[1], 0.26 * sz), t0, 0.95 * sz)
    if timp: place(buf, timpani(r, hz(root, 2), 0.8, 0.3), t0, 0.5 * sz)
    place(buf, crack(r, 0.18, 2200, 9500, 0.03), t0, 0.7 * sz)
    place(buf, brass(r, major_stack(root, oct0, True), brass_dur, a=0.008, tau=0.5, hold=0.08, bright0=0.6, bright1=0.95), t0, 0.55 * sz)
    if metal > 0: place(buf, metal_hit(r, 900, min(dur, 1.0), 1.0, 0.25), t0, metal)            # 金属の打撃は大きく下げる
    if cym > 0: place(buf, cymbal(r, min(dur, 1.2), 0.35, lo=6000), t0, cym)
    H = 1.0 * hi
    if kind == 'a':
        if arp:   # 速い上昇アルペジオ(矩形波・FM少し)。根音の長三和音を2オクターブ上へ
            place(buf, note_seq(r, arp, 0.0, 1.0 / arp_rate, 1.6 / arp_rate, fm=0.8, total=len(arp) / arp_rate + 0.15), t0 + 0.012, 0.9 * H)
        place(buf, kyuin(r, 0.16, 2200, 5200), t0 + 0.0, 0.55 * H)                              # 打撃の頭の「キュイン」(短い高い一発)
        if chips > 0: place(buf, pipi(r, 0.7, 3400, 5600, 26.0), t0 + 0.12, chips)
    else:
        if siren_dur > 0: place(buf, siren(r, siren_dur, 1700, 3300, 0.34, 0.0), t0 + 0.02, 0.75 * H)
        if sus: place(buf, sustain_high(r, sus, sus_dur, tau=1.2), t0 + 0.0, 0.95 * H)
        place(buf, kyuin(r, 0.1, 3000, 5800), t0, 0.45 * H)
        if chips > 0: place(buf, pipi(r, 0.5, 4200, 5800, 20.0, rising=False), t0 + 0.1, chips)
    if glitter > 0: place(buf, sparkle(r, min(dur - 0.05, 1.6), 30, 3200, 8500, 0.3), t0 + 0.05, glitter)
    if tail_bell > 0:  # 高い鐘(2〜6kHz)の余韻
        for k, f in enumerate([hz('A', 6), hz('E', 7), hz('A', 7)]): place(buf, sustain_high(r, f, 1.2, tau=0.5, vib=0.0)[:, :] * 0.5, t0 + 0.05 * k, tail_bell)
    y = reverb(buf, 0.8 + 0.3 * size, rev, lo=400, r=r)
    return finish_hi(y, kind, drive, rms), preroll


def finish_hi(x, kind, drive, rms):
    global match_eq
    tgt = TARGET_A if kind == 'a' else TARGET_B
    x = np.nan_to_num(x); x = match_eq(hp(x, 50, 2), tgt)
    def go(dv):
        y = softclip(x / np.abs(x).max(), dv); return y / np.abs(y).max() * db(-0.6)
    n = int(0.4 * SR); y = go(1.0)
    for dv in (1.0, 1.4, 1.8, 2.2, 2.8, 3.4, 4.2, 5.0, 6.5, 8.0):
        y = go(dv)
        if 20 * np.log10(np.sqrt((y[:n] ** 2).mean()) + 1e-12) >= rms: break
    nf = int(0.03 * SR); y[-nf:] *= np.linspace(1, 0, nf)[:, None]; return y


def BUILDK(name, kind, dur, f0, f1, gate=False, ignite=True, crack_at=None):
    r = R(name)
    if kind == 'a':
        y = kyuin(r, dur, f0, f1) * 1.0
        if gate:
            n = len(y); t = np.arange(n) / SR; y *= (0.25 + 0.75 * (np.sin(2 * np.pi * 15 * t + np.pi / 2) > -0.2))[:, None]
        y = y + 0.5 * pad(pipi(r, dur, f1 * 0.6, f1 * 1.1, 28.0), len(y))
    else:
        y = siren(r, dur, f0 * 0.9, f0 * 2.1, max(0.11, dur / 2.6), rise=(f1 / f0 - 1) * 0.5)
        if gate:
            n = len(y); t = np.arange(n) / SR; y *= (0.25 + 0.75 * (np.sin(2 * np.pi * 15 * t + np.pi / 2) > -0.2))[:, None]
        y = y + 0.35 * pad(sustain_high(r, f1 * 0.5, dur, tau=5.0), len(y))
    if crack_at is not None: place(y, crackle(r, dur - crack_at, 110), crack_at, 0.8)
    if ignite: place(y, sub_boom(r, 0.3, 110, 55, 0.08), 0, 0.9); place(y, crack(r, 0.1, 2500, 9500, 0.02), 0, 0.6)
    nf = int(0.003 * SR); y[-nf:] *= np.linspace(1, 0, nf)[:, None]
    y = match_eq(hp(np.nan_to_num(y), 50, 2), TARGET_A if kind == 'a' else TARGET_B)
    y = softclip(y / np.abs(y).max(), 3.0); return y / np.abs(y).max() * db(-0.6), 0.0


def arp_notes(root, lo_oct, n_notes=14):
    ks = {'D': ('D', 'F#', 'A'), 'A': ('A', 'C#', 'E'), 'E': ('E', 'G#', 'B'), 'F#': ('F#', 'A#', 'C#')}[root]; out = []; o = lo_oct
    while len(out) < n_notes:
        for k in (root, ks[1], ks[2]):
            out.append(hz(k, o + (1 if k < root and False else 0)))
        o += 1
    return sorted(out)[:n_notes]


def SPECS_HI(kind):
    S = {}; k = kind; p = f'lf_{k}_'
    A = (lambda root, o, nn: arp_notes(root, o, nn))
    if k == 'a':
        S[p + 'rush_build'] = lambda: BUILDK(p + 'rush_build', k, 11 / FPS, 900, 4800, ignite=True, crack_at=6 / FPS)
        S[p + 'rush_chou'] = lambda: HITK(p + 'rush_chou', k, 'D', 2, 1.0, 2.0, arp=A('D', 5, 14), rms=-8.3, chips=0.6)
        S[p + 'rush_chou2'] = lambda: HITK(p + 'rush_chou2', k, 'F#', 2, 0.55, 1.0, 0.5, sub=(110, 50), timp=False, arp=A('F#', 5, 8), rms=-10.0, metal=0.06, cym=0.05)
        S[p + 'rush_tsuku'] = lambda: HITK(p + 'rush_tsuku', k, 'A', 2, 0.75, 1.2, 0.6, timp=False, arp=A('A', 5, 10), glitter=0.5, rms=-9.5, metal=0.08)
        S[p + 'rush_rush'] = lambda: HITK(p + 'rush_rush', k, 'D', 3, 1.45, 3.2, 2.0, sub=(150, 42), arp=A('D', 5, 20), arp_rate=28.0, chips=0.7, glitter=0.4, tail_bell=0.5, rms=-7.6, drive=3.2, preroll=0.0)
        S[p + 'rush_glitter'] = lambda: (finish_hi(np.nan_to_num(pad(pipi(R('g'), 1.6, 3000, 6000, 30.0), int(1.9 * SR)) + sparkle(R('gg'), 1.9, 34, 3200, 9000, 0.35)), 'a', 2.0, -10), 0.0)
        S[p + 'ci_title'] = lambda: HITK(p + 'ci_title', k, 'A', 2, 1.1, 1.6, arp=A('A', 5, 12), chips=0.5, rms=-8.3)
        S[p + 'ci_burst'] = lambda: HITK(p + 'ci_burst', k, 'A', 3, 0.8, 1.4, 0.6, timp=False, arp=A('E', 5, 12), arp_rate=30.0, glitter=0.8, rms=-9.5)
        S[p + 'ci_zap'] = lambda: (finish_hi(np.nan_to_num(pad(note_seq(R('z'), [hz('A', 7), hz('E', 7), hz('A', 6), hz('E', 7), hz('A', 7)], 0, 0.035, 0.05, fm=1.0), int(.5 * SR)) + pad(crackle(R('zz'), .4, 90), int(.5 * SR)) * 0.6), 'a', 3.0, -10), 0.0)
        S[p + 'cs_ignite'] = lambda: (finish_hi(np.nan_to_num(pad(kyuin(R('i'), .3, 1500, 5200), int(.55 * SR)) * 0.9 + pad(crackle(R('ii'), .5, 120), int(.55 * SR)) * 0.7 + pad(sub_boom(R('s'), .3, 95, 50, .1), int(.55 * SR)) * 0.8), 'a', 3.0, -10), 0.0)
        S[p + 'cs_ring'] = lambda: HITK(p + 'cs_ring', k, 'A', 2, 0.7, 1.2, 0.6, timp=False, arp=A('A', 5, 9), glitter=0.4, rms=-10.0, metal=0.05)
        S[p + 'cs_kei'] = lambda: HITK(p + 'cs_kei', k, 'A', 2, 1.1, 1.8, arp=A('A', 5, 14), chips=0.5, rms=-8.4)
        S[p + 'cs_zoku'] = lambda: HITK(p + 'cs_zoku', k, 'E', 2, 1.2, 1.9, arp=A('E', 5, 16), chips=0.5, rms=-8.2)
        S[p + 'cs_build_a'] = lambda: BUILDK(p + 'cs_build_a', k, 9 / FPS, 1000, 3600, ignite=False, crack_at=0.0)
        S[p + 'cs_build_b'] = lambda: BUILDK(p + 'cs_build_b', k, 8 / FPS, 3000, 5600, gate=True, ignite=False, crack_at=0.0)
        S[p + 'cs_final'] = lambda: HITK(p + 'cs_final', k, 'A', 3, 1.5, 3.4, 2.1, sub=(150, 42), arp=A('A', 5, 22), arp_rate=28.0, chips=0.7, glitter=0.4, tail_bell=0.5, rms=-7.6, drive=3.2)
        S[p + 'cs_nirenme'] = lambda: HITK(p + 'cs_nirenme', k, 'E', 3, 1.05, 2.0, 1.0, timp=False, arp=A('E', 5, 14), glitter=0.6, rms=-9.0)
        S[p + 'land'] = lambda: HITK(p + 'land', k, 'A', 2, 1.25, 2.0, arp=A('A', 5, 14), chips=0.5, rms=-8.2)
    else:
        S[p + 'rush_build'] = lambda: BUILDK(p + 'rush_build', k, 11 / FPS, 1300, 3600, ignite=True, crack_at=6 / FPS)
        S[p + 'rush_chou'] = lambda: HITK(p + 'rush_chou', k, 'D', 2, 1.0, 2.0, siren_dur=1.2, sus=hz('D', 6), sus_dur=1.8, chips=0.4, rms=-8.3)
        S[p + 'rush_chou2'] = lambda: HITK(p + 'rush_chou2', k, 'F#', 2, 0.55, 1.0, 0.5, sub=(110, 50), timp=False, sus=hz('F#', 6), sus_dur=0.8, rms=-10.0, metal=0.06, cym=0.05)
        S[p + 'rush_tsuku'] = lambda: HITK(p + 'rush_tsuku', k, 'A', 2, 0.75, 1.2, 0.6, timp=False, sus=hz('A', 6), sus_dur=1.0, chips=0.4, glitter=0.5, rms=-9.5, metal=0.08)
        S[p + 'rush_rush'] = lambda: HITK(p + 'rush_rush', k, 'D', 3, 1.45, 3.4, 2.0, sub=(150, 42), siren_dur=1.5, sus=hz('D', 7), sus_dur=3.2, chips=0.5, glitter=0.4, tail_bell=0.5, rms=-7.6, drive=3.2)
        S[p + 'rush_glitter'] = lambda: (finish_hi(np.nan_to_num(pad(sustain_high(R('g'), hz('A', 7), 1.8, tau=0.9, vib=0.01), int(1.9 * SR)) * 0.6 + sparkle(R('gg'), 1.9, 34, 3200, 9000, 0.35)), 'b', 2.0, -10), 0.0)
        S[p + 'ci_title'] = lambda: HITK(p + 'ci_title', k, 'A', 2, 1.1, 1.6, siren_dur=0.9, sus=hz('A', 6), sus_dur=1.4, chips=0.4, rms=-8.3)
        S[p + 'ci_burst'] = lambda: HITK(p + 'ci_burst', k, 'A', 3, 0.8, 1.4, 0.6, timp=False, sus=hz('E', 7), sus_dur=1.1, glitter=0.8, rms=-9.5)
        S[p + 'ci_zap'] = lambda: (finish_hi(np.nan_to_num(pad(siren(R('z'), .3, 2200, 4200, .1), int(.5 * SR)) * 0.8 + pad(crackle(R('zz'), .4, 90), int(.5 * SR)) * 0.6), 'b', 3.0, -10), 0.0)
        S[p + 'cs_ignite'] = lambda: (finish_hi(np.nan_to_num(pad(siren(R('i'), .3, 1800, 3600, .15), int(.55 * SR)) * 0.8 + pad(crackle(R('ii'), .5, 120), int(.55 * SR)) * 0.7 + pad(sub_boom(R('s'), .3, 95, 50, .1), int(.55 * SR)) * 0.8), 'b', 3.0, -10), 0.0)
        S[p + 'cs_ring'] = lambda: HITK(p + 'cs_ring', k, 'A', 2, 0.7, 1.2, 0.6, timp=False, sus=hz('E', 6), sus_dur=0.9, glitter=0.4, rms=-10.0, metal=0.05)
        S[p + 'cs_kei'] = lambda: HITK(p + 'cs_kei', k, 'A', 2, 1.1, 1.8, siren_dur=0.9, sus=hz('A', 6), sus_dur=1.5, rms=-8.4)
        S[p + 'cs_zoku'] = lambda: HITK(p + 'cs_zoku', k, 'E', 2, 1.2, 1.9, siren_dur=1.0, sus=hz('E', 6), sus_dur=1.6, rms=-8.2)
        S[p + 'cs_build_a'] = lambda: BUILDK(p + 'cs_build_a', k, 9 / FPS, 1200, 3000, ignite=False, crack_at=0.0)
        S[p + 'cs_build_b'] = lambda: BUILDK(p + 'cs_build_b', k, 8 / FPS, 2200, 4500, gate=True, ignite=False, crack_at=0.0)
        S[p + 'cs_final'] = lambda: HITK(p + 'cs_final', k, 'A', 3, 1.5, 3.6, 2.1, sub=(150, 42), siren_dur=1.5, sus=hz('A', 7), sus_dur=3.4, chips=0.5, glitter=0.4, tail_bell=0.5, rms=-7.6, drive=3.2)
        S[p + 'cs_nirenme'] = lambda: HITK(p + 'cs_nirenme', k, 'E', 3, 1.05, 2.0, 1.0, timp=False, sus=hz('E', 7), sus_dur=1.7, glitter=0.6, rms=-9.0)
        S[p + 'land'] = lambda: HITK(p + 'land', k, 'A', 2, 1.25, 2.0, siren_dur=0.9, sus=hz('A', 6), sus_dur=1.5, rms=-8.2)
    return S


def SPECS():
    S = {}
    # ===== 超つくこまRUSH(映像 jp_rush。コマは元の映像) =====
    S['lf_rush_build'] = lambda: build('lf_rush_build', 11 / FPS, gate_from=None, f0=150, f1=1500, with_crackle=[(6 / FPS, 5 / FPS)], ignite=True)                    # f0〜f11(頭の白い閃光で一撃、f6から稲妻のひび)
    S['lf_rush_chou'] = lambda: HIT('lf_rush_chou', 'D', 2, size=1.0, dur=2.0, metal_base=520, cym=0.55, rms=-8.5)                                               # f11 金の「超」
    S['lf_rush_chou2'] = lambda: HIT('lf_rush_chou2', 'F#', 2, size=0.55, dur=1.0, brass_dur=0.6, metal_base=700, timp=False, sub=(110, 50), big=False, rms=-10.5, rev=0.08)   # f16 「超」が定位置へ
    S['lf_rush_tsuku'] = lambda: HIT('lf_rush_tsuku', 'A', 2, size=0.75, dur=1.2, brass_dur=0.7, metal_base=860, glitter=0.5, timp=False, rms=-10, rev=0.1)          # f21 「つくこま」(虹)
    S['lf_rush_rush'] = lambda: HIT('lf_rush_rush', 'D', 3, size=1.45, dur=3.2, brass_dur=2.4, metal_base=330, cym=0.85, glitter=0.35, preroll=0.16, reverse=0.6,        # f26 「RUSH」(最大)
                                    sub=(150, 42), brass_tau=1.1, rms=-7.6, drive=3.2, rev=0.16)
    S['lf_rush_glitter'] = lambda: GLITTER('lf_rush_glitter', 1.9, 36)                                                                                            # f28〜 ロゴ全体の金属の雨
    # ===== 継続カットイン(映像 announce_cutin 50コマ) =====
    S['lf_ci_title'] = lambda: HIT('lf_ci_title', 'A', 2, size=1.1, dur=1.6, brass_dur=1.0, metal_base=470, cym=0.4, rms=-8.5)                                    # f4 題字の閃光
    S['lf_ci_burst'] = lambda: GLASS('lf_ci_burst', 1.4)                                                                                                           # f9 十字の光→水晶が砕ける
    S['lf_ci_zap'] = lambda: LIGHT('lf_ci_zap', 0.5, 0.5, 80)                                                                                                       # f13/f26 雷
    # ===== 継続成功(映像 chain_success v4。コマは元の映像) =====
    S['lf_cs_ignite'] = lambda: LIGHT('lf_cs_ignite', 0.55, 0.9, 120)                                                                                               # f6 虹の稲妻が点く
    S['lf_cs_ring'] = lambda: HIT('lf_cs_ring', 'A', 2, size=0.7, dur=1.2, brass_dur=0.6, metal_base=640, timp=False, glitter=0.4, rms=-10.5, rev=0.1)           # f11 輪の閃光
    S['lf_cs_kei'] = lambda: HIT('lf_cs_kei', 'A', 2, size=1.1, dur=1.8, brass_dur=1.1, metal_base=420, cym=0.5, rms=-8.5)                                         # f18 「継」叩きつけ
    S['lf_cs_zoku'] = lambda: HIT('lf_cs_zoku', 'E', 2, size=1.2, dur=1.9, brass_dur=1.2, metal_base=500, cym=0.6, rms=-8.2)                                        # f42 「続」叩きつけ
    S['lf_cs_build_a'] = lambda: build('lf_cs_build_a', 9 / FPS, gate_from=None, f0=200, f1=1000, ignite=False, with_crackle=[(0.0, 9 / FPS)])                 # f87〜f96 白い爆発の溜め(f96〜118 は映像が飛ぶので、ここで切る)
    S['lf_cs_build_b'] = lambda: build('lf_cs_build_b', 8 / FPS, gate_from=0.0, f0=1000, f1=2300, ignite=False, with_crackle=[(0.0, 8 / FPS)], gate_hz=15.0)   # f118〜f126 ストロボ(白黒の点滅)に合わせて刻み、最大で切る
    S['lf_cs_final'] = lambda: HIT('lf_cs_final', 'A', 3, size=1.5, dur=3.4, brass_dur=2.5, metal_base=300, cym=0.9, glitter=0.4, preroll=0.16, reverse=0.6,           # f126 「継続」完成(最大)
                                   sub=(150, 42), brass_tau=1.15, rms=-7.6, drive=3.2, rev=0.16)
    S['lf_cs_nirenme'] = lambda: HIT('lf_cs_nirenme', 'E', 3, size=1.05, dur=2.0, brass_dur=1.2, metal_base=700, glitter=0.6, timp=False, rms=-9, rev=0.12)       # f148 「2連目」
    # ===== 継続の着地(chain_jp_land 17コマ)・単発 =====
    S['lf_land'] = lambda: HIT('lf_land', 'A', 2, size=1.25, dur=2.0, brass_dur=1.2, metal_base=380, cym=0.6, rms=-8.2)                                           # f0 着地
    return S


def main(names):
    os.makedirs(OUT_WAV, exist_ok=True); os.makedirs(OUT_OGG, exist_ok=True)
    S = SPECS(); S.update(SPECS_HI('a')); S.update(SPECS_HI('b'))
    try:
        import synth_ref; S.update(synth_ref.SPECS_R())
    except ImportError: pass
    meta_path = os.path.join(HERE, '..', 'meta.json')
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    for nm in (names or list(S)):
        y, anchor = S[nm](); y = y.astype(np.float32)
        wav = os.path.join(OUT_WAV, nm + '.wav')
        from scipy.io import wavfile
        wavfile.write(wav, SR, y)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-c:a', 'libvorbis', '-q:a', '6', '-ar', str(SR), os.path.join(OUT_OGG, nm + '.ogg')], check=True)
        meta[nm] = {'anchor': round(float(anchor), 4), 'dur': round(len(y) / SR, 3)}
        print(nm, 'dur %.2f anchor %.2f peak %.2f dBFS' % (len(y) / SR, anchor, 20 * np.log10(np.abs(y).max())))
    json.dump(meta, open(meta_path, 'w'), indent=1, ensure_ascii=False)


if __name__ == '__main__':
    main(sys.argv[1:])
