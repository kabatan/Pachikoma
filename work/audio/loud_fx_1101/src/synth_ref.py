# 実機の確定音・当たり音の「書き起こし」どおりに合成する(kind 'r')。録音は使わない。手元の手本(非公開・リポジトリ外)をスペクトログラムとリッジ追跡で解析し、
# 音ごとの音高の動き・長さ・音色を下の表にした。数字は ridge.py / transcribe.py の出力(2026-11-01)。
#
# 手本1: エヴァ確定音(YouTube F2IMn6JDnbk「エヴァ確定音」)。0〜1.7秒と、3.8秒で同じ形の繰り返し。ほぼ純音(正弦波)が飽和で張り付く。
#   a) 上昇スイープ(キュイン): 0.30秒 280Hz → 0.35 520 → 0.47 642 → 0.53 732 → 0.59 840 → 0.65 981 → 0.68秒 1040Hz(約0.38秒、後半ほど速い)
#   b) 重なる短いチャープ(各約0.13〜0.2秒の上昇): 1500→2100Hz(0.32〜0.52) / 2130→2700(0.65〜0.78) / 1850→2540(0.85〜0.96) / 3215→3520→3.8k(1.05〜1.3、そのまま4kHzへ入る)
#          と、その上のオクターブ付近の 7.2kHz のチップ(0.42〜0.55、0.7〜0.95、1.1〜1.3 に 6.8〜7.8k)
#   c) 持続: 1000Hz の純音が 0.68秒から数秒、4000Hz の線が 1.35秒から(8kHz の線も薄く)。1k と 4k が同レベル(-6dB/0dB)、2k は -28dB、3k は -37dB(=1・4・8 の線)
#   d) 1.25秒と 1.55秒に約40msの欠け(持続音が一瞬切れる)
# 手本2: エヴァ10 確定音(IYX-qefiUWw「エヴァ10　確定音」)。
#   a) 上昇スイープ1: 2.55秒 約110Hz から急に上がり 3.15秒で 4000Hz の水平線へ(曲線は前半急・後半ゆるい。約0.6秒)。同時に 2000Hz の線が 3.0〜6.4秒続く
#   b) 矩形波系の階段メロディ(各0.08〜0.1秒): A#5(932) C6(1046) | C6 A#5 | C6 A#5 | C6(長0.3) | 上昇グリス 988→1250 | A5(880 0.17) | C6(長0.48) | D6(1175 長く持続 5.14〜6.4秒)
#   c) 上昇スイープ2: 4.0秒 約110Hz から 4.6秒で 2300Hz の水平線へ(1.2倍音の4.6kも)
# 手本3: シンフォギア当たり音(GF4bCyltSHw)。
#   a) 大きな上昇スイープ: 0.6秒 117Hz → 0.77 313 → 0.93 464 → 1.09 568 → 1.25 825 → 1.41 1479 → 1.65秒 1650〜2300Hz(下に凸、約1.1秒で約4オクターブ)
#   b) 下降チャープ(ピュン): 1.35kHz → 400Hz へ約0.17秒で指数的に落ちる。0.25〜0.3秒ごと(2.0秒から)
#   c) 7秒以降: 2.7kHz 前後のピ連打(約0.12秒周期: 2711→2600→2390→2090 と下がる4音)と 7〜8kHz の同じ刻み
import numpy as np, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from synth_loud import *

# ---- 部品(書き起こしの形を鳴らす) ----
def poly_f(pts, n):
    """pts=[(t秒,Hz)...] を対数補間した周波数列(長さ n)。範囲外は端の値。"""
    t = np.arange(n) / SR; ts = [p[0] for p in pts]; fs = np.log([p[1] for p in pts]); return np.exp(np.interp(t, ts, fs))

def glide(pts, dur, amp=1.0, harm=(1.0, 0.0, 0.0), att=0.003, rel=0.01, sat=0.0, pan=0.0):
    n = int(dur * SR); f = poly_f(pts, n); ph = 2 * np.pi * np.cumsum(f) / SR
    x = sum(h * np.sin((k + 1) * ph) for k, h in enumerate(harm))
    if sat: x = np.tanh(sat * x)
    t = np.arange(n) / SR; e = np.minimum(1, t / att) * np.minimum(1, (dur - t) / rel)
    x = x * e * amp; return np.stack([x * (1 - max(0, pan) * .5), x * (1 + min(0, pan) * .5)], 1)

def hold(f, dur, amp=1.0, harm=(1.0,), att=0.003, rel=0.02, dips=(), dip_len=0.04, pw=None, f2=None):
    """持続音。harm は倍音の相対振幅。dips=[秒...] で約40msの欠け。pw があればパルス幅の矩形波(階段メロディ)。"""
    n = int(dur * SR); t = np.arange(n) / SR; ph = 2 * np.pi * f * t
    if pw is not None: x = np.tanh(6 * (np.sin(ph) - np.cos(np.pi * pw)))
    else: x = sum(h * np.sin((k + 1) * ph) for k, h in enumerate(harm))
    e = np.minimum(1, t / att) * np.minimum(1, (dur - t) / rel)
    for d in dips: e = e * (1 - np.exp(-((t - d) / (dip_len * 0.5)) ** 8))
    x = x * e * amp; return np.stack([x, x], 1)

def lines(dur, spec, att=0.003, rel=0.03, dips=(), tau=None):
    """水平な線の束: spec=[(Hz, 相対振幅dB)]。(エヴァ確定: 1000Hz -6dB, 4000Hz 0dB, 8000Hz -27dB)"""
    n = int(dur * SR); t = np.arange(n) / SR; x = np.zeros(n)
    for f, d in spec: x += 10 ** (d / 20) * np.sin(2 * np.pi * f * t)
    e = np.minimum(1, t / att) * np.minimum(1, (dur - t) / rel)
    if tau: e = e * np.exp(-t / tau)
    for dp in dips: e = e * (1 - np.exp(-((t - dp) / 0.02) ** 8))
    return np.stack([x * e, x * e], 1)

def fall(f0, f1, dur, amp=1.0, harm=(1.0, 0.25)):
    """下降チャープ(シンフォギア): 指数的に落ちる。"""
    n = int(dur * SR); t = np.arange(n) / SR; f = f1 + (f0 - f1) * np.exp(-t / (dur * 0.35)); ph = 2 * np.pi * np.cumsum(f) / SR
    x = sum(h * np.sin((k + 1) * ph) for k, h in enumerate(harm)) * np.minimum(1, t / 0.002) * np.exp(-t / (dur * 1.5)) * amp
    return np.stack([x, x], 1)

def mix_at(n_s, items):
    buf = np.zeros((int(n_s * SR), 2))
    for at, x, g in items: place(buf, x, at, g)
    return buf

def low_base(r, size=1.0, brass_root=None, brass_g=0.3, dur=1.2):
    """低音の衝撃は土台に残す(サブの落下+ティンパニ+ひび)。ブラスは薄く(手本は純音主体)。"""
    n = int(dur * SR); b = np.zeros((n, 2)); sz = size ** 0.5
    place(b, sub_boom(r, 0.8, 130, 46, 0.26 * sz), 0, 0.95 * sz); place(b, timpani(r, 98, 0.8, 0.3), 0, 0.45 * sz); place(b, crack(r, 0.12, 2000, 9000, 0.025), 0, 0.5 * sz)
    if brass_root: place(b, brass(r, major_stack(brass_root, 2, True), min(dur, 1.0), a=0.008, tau=0.5, hold=0.08, bright0=.6, bright1=.95), 0, brass_g * sz)
    return b

def fin(x, rms=-8.0, drive=3.0):
    """手本は純音を飽和して詰めている: 飽和→ピーク -0.6dBFS。帯域整形(match_eq)はしない(純音の線を崩さない)。"""
    x = np.nan_to_num(x); n = int(0.4 * SR)
    def go(dv): y = softclip(x / np.abs(x).max(), dv); return y / np.abs(y).max() * db(-0.6)
    y = go(1.0)
    for dv in (1.0, 1.6, 2.2, 3.0, 4.0, 5.5, 7.0, 9.0):
        y = go(dv)
        if 20 * np.log10(np.sqrt((y[:n] ** 2).mean()) + 1e-12) >= rms: break
    nf = int(0.03 * SR); y[-nf:] *= np.linspace(1, 0, nf)[:, None]; return y

def S4(r): return hold(4000, 1.0, 1.0)   # (未使用)

# ---- 手本1 エヴァ確定 → 超つくこまRUSH ----
EVA_SWEEP = [(0.0, 280), (0.05, 520), (0.17, 642), (0.23, 732), (0.29, 840), (0.35, 981), (0.38, 1040)]      # 0.30秒起点からの相対
def E_rush_build(name):
    r = R(name); dur = 11 / FPS; k = dur / 0.38
    sw = glide([(t * k, f) for t, f in EVA_SWEEP], dur, 1.0, harm=(1.0, 0.12), att=0.002, rel=0.002)
    c1 = glide([(0.0, 1500), (0.2 * k, 2100)], dur, 0.6, att=0.004, rel=0.004); c1[int(0.2 * k * SR):] = 0
    ch7 = hold(7200, 0.13, 0.35)
    y = sw + pad(c1, len(sw)) * 0.8; place(y, ch7, 0.09, 0.8); place(y, ch7, 0.2, 0.7)
    place(y, sub_boom(r, 0.3, 110, 55, 0.08), 0, 0.8)
    return fin(y, -8.5, 3.0), 0.0
def E_rush_chou(name):          # f11: 1kHz 持続の入り + チャープ2(2130→2700)
    r = R(name); y = low_base(r, 1.0, 'D', 0.3, 1.4); d = 1.4
    place(y, lines(d, [(1000, -6)], dips=()), 0, 0.8)
    place(y, glide([(0, 2130), (0.13, 2700)], 0.13, 0.9), 0.0, 1.0)
    place(y, hold(7200, 0.12, 0.4), 0.02, 0.8); place(y, hold(7200, 0.12, 0.4), 0.12, 0.7)
    return fin(y, -8.0, 3.0), 0.0
def E_rush_chou2(name):         # f16: チャープ3(1850→2540)
    r = R(name); y = low_base(r, 0.5, None, 0, 0.9)
    place(y, glide([(0, 1850), (0.13, 2540)], 0.13, 1.0), 0, 1.0); place(y, lines(0.9, [(1000, -6)], tau=0.5), 0, 0.7)
    return fin(y, -9.5, 3.0), 0.0
def E_rush_tsuku(name):         # f21: チャープ4(3215→3520→3.8k)
    r = R(name); y = low_base(r, 0.7, None, 0, 1.0)
    place(y, glide([(0, 3215), (0.08, 3520), (0.2, 3800)], 0.2, 1.0), 0, 1.0); place(y, lines(1.0, [(1000, -6)], tau=0.6), 0, 0.7); place(y, hold(7300, 0.12, .4), 0.03, .8)
    return fin(y, -9.0, 3.0), 0.0
def E_rush_rush(name):          # f26 RUSH: 4kHz+1kHz+8kHz の持続(1.25秒と1.55秒相当の欠け)、最大の低音
    r = R(name); d = 3.0; y = low_base(r, 1.45, 'D', 0.35, d)
    place(y, lines(d, [(1000, -6), (4000, 0), (8000, -22)], dips=(0.25, 0.55), tau=2.0), 0, 1.0)
    place(y, glide([(0, 3800), (0.1, 4000)], 0.1, 0.8), 0, 0.8)
    for k, t in enumerate((0.0, 0.1, 0.2, 0.34)): place(y, hold(7000 + 250 * k, 0.1, 0.4), t, 0.8)
    return fin(y, -8.2, 3.4), 0.0
def E_rush_glitter(name):       # f28: 7〜8kHz のチップ連打(手本 1.1〜1.3秒)
    r = R(name); d = 1.5; y = np.zeros((int(d * SR), 2))
    for k in range(14): place(y, hold(7100 + 60 * (k % 5) + 40 * k, 0.045, 0.5, att=0.001, rel=0.01), k * 0.05, 1.0)
    place(y, lines(d, [(4000, -3), (1000, -9)], tau=0.8), 0, 0.5)
    return fin(y, -10, 2.0), 0.0

# ---- 手本2 エヴァ10 確定 → 継続成功 ----
E10_S1 = [(0.0, 110), (0.04, 700), (0.14, 1500), (0.28, 2600), (0.42, 3600), (0.52, 3980), (0.6, 4000)]
def N_sweep1(name):             # 継(f18)の頭へ: 約0.6秒。終わりは 4kHz の線へ(pre:true)
    r = R(name); dur = 0.6; y = glide(E10_S1, dur, 1.0, harm=(1.0, 0.1), att=0.002, rel=0.002) + 0.5 * glide([(t * 1, f / 2) for t, f in E10_S1], dur, 1.0, att=0.002, rel=0.002)
    return fin(y, -9.0, 3.0), 0.0
def N_kei(name):                # f18: 4kHz+2kHz+1kHz の水平線(手本 3.15秒〜)+低音
    r = R(name); d = 1.8; y = low_base(r, 1.1, 'A', 0.3, d)
    place(y, lines(d, [(4000, 0), (2000, -3), (1000, -6)], tau=1.2), 0, 1.0)
    return fin(y, -9.3, 3.0), 0.0
STEP = [('A#5', .09), ('C6', .08), ('C6', .09), ('A#5', .08), ('C6', .06), ('A#5', .08), ('C6', .30)]   # 手本 3.34〜4.34 の矩形波の階段(音名, 長さ)
def hzn(n):
    names = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}
    k = names[n[:-1]]; o = int(n[-1]); return 440.0 * 2 ** ((k - 9 + 12 * (o - 4)) / 12)
def steps(seq, pw=0.25, gap=0.01, amp=1.0):
    tot = sum(d for _, d in seq) + 0.05; y = np.zeros((int(tot * SR), 2)); t = 0.0
    for n, d in seq: place(y, hold(hzn(n), d - gap, amp, att=0.0015, rel=0.004, pw=pw), t, 1.0); t += d
    return y
def N_zoku(name):               # f42: 階段メロディ(A#5 C6 C6 A#5 C6 A#5 C6長) + 2kHz の線
    r = R(name); d = 1.9; y = low_base(r, 1.2, 'E', 0.3, d)
    place(y, steps(STEP), 0.0, 1.0); place(y, lines(d, [(2000, -4), (4000, -8)], att=0.1, tau=1.0), 0.45, 0.6)
    return fin(y, -8.2, 3.0), 0.0
def N_ignite(name):             # f6/f14: 手本 2.45〜2.57 の 1.08k→1.23k の短い立ち上がり
    r = R(name); y = np.zeros((int(.55 * SR), 2)); place(y, glide([(0, 1080), (0.1, 1230), (0.2, 1600)], 0.2, 1.0), 0, 1.0); place(y, sub_boom(r, 0.3, 95, 50, .1), 0, .8)
    return fin(y, -10, 3.0), 0.0
def N_ring(name):               # f11: A#5 C6 の2音(0.17秒)
    r = R(name); y = low_base(r, 0.5, None, 0, 1.0); place(y, steps([('A#5', .08), ('C6', .09), ('C6', .2)]), 0, 1.0); place(y, lines(1.0, [(2000, -6)], tau=.5), 0.05, .5)
    return fin(y, -10.0, 3.0), 0.0
E10_S2 = [(0.0, 110), (0.03, 600), (0.12, 1300), (0.25, 1900), (0.4, 2250), (0.5, 2300)]
def N_build_a(name):            # f96 まで(9コマ): スイープ2(→2.3kHz)
    dur = 9 / FPS; k = dur / 0.5; y = glide([(t * k, f) for t, f in E10_S2], dur, 1.0, harm=(1.0, .1), att=0.002, rel=0.002)
    return fin(y, -9, 3.0), 0.0
def N_build_b(name):            # f126 まで(8コマ・ストロボ): A5 → C6(手本 4.46〜5.12)。15Hzで刻む
    dur = 8 / FPS; y = steps([('A5', .13), ('C6', dur - .13)]); y = y[:int(dur * SR)]; t = np.arange(len(y)) / SR
    y = y * (0.3 + 0.7 * (np.sin(2 * np.pi * 15 * t + np.pi / 2) > -0.2))[:, None]
    return fin(y, -9, 3.0), 0.0
def N_final(name):              # f126 継続完成: D6(1175)の長い持続+2349・4698の線(手本 5.14〜6.4秒)+最大の低音
    r = R(name); d = 3.4; y = low_base(r, 1.5, 'A', 0.35, d)
    place(y, lines(d, [(1174.7, 0), (2349.4, -6), (4698.8, -12)], tau=2.2, dips=(0.9,)), 0, 1.0)
    place(y, lines(d, [(2000, -4)], tau=1.5), 0, 0.5)
    return fin(y, -8.0, 3.4), 0.0
def N_nirenme(name):            # f148 2連目: A5 C6 D6(短い3音)+D6 の持続
    r = R(name); d = 2.0; y = low_base(r, 1.0, None, 0, d); place(y, steps([('A5', .1), ('C6', .1)]), 0, 1.0)
    place(y, lines(d, [(1174.7, 0), (2349.4, -6)], tau=1.2), 0.2, 1.0)
    return fin(y, -9.0, 3.0), 0.0

# ---- 手本3 シンフォギア → 継続カットイン ----
SG_UP = [(0.0, 117), (0.17, 313), (0.33, 464), (0.49, 568), (0.65, 825), (0.81, 1479), (1.05, 1800)]
def G_ci_title(name):           # f4: 下降チャープ(1350→400)+低音の衝撃
    r = R(name); y = low_base(r, 1.1, 'A', 0.25, 1.6)
    place(y, fall(1350, 400, 0.22, 1.0, (1.0, .35)), 0, 1.0); place(y, fall(2700, 800, 0.22, 0.5), 0, 0.7)
    return fin(y, -6.8, 3.0), 0.0
def G_ci_burst(name):           # f9: 下降チャープ2連+ピ連打(2711 2600 2390 2090)
    r = R(name); y = low_base(r, 0.8, None, 0, 1.4)
    place(y, fall(1350, 400, 0.2, 1.0), 0, 1.0); place(y, fall(1350, 400, 0.2, 0.9), 0.12, 1.0)
    for k, f in enumerate([2711, 2600, 2390, 2090, 2711, 2600, 2390, 2090]): place(y, hold(f, 0.045, 0.6, att=0.001, rel=0.01, pw=0.25), 0.25 + k * 0.03, 1.0)
    return fin(y, -8.5, 3.0), 0.0
def G_ci_zap(name):
    r = R(name); y = np.zeros((int(.5 * SR), 2))
    for k, f in enumerate([2711, 2600, 2390, 2090, 2711, 2390]): place(y, hold(f, 0.05, 0.9, att=0.001, rel=0.01, pw=0.25), k * 0.04, 1.0)
    return fin(y, -10, 3.0), 0.0
def G_ci_sweep(name):           # カットインの終わりへ向かう大きな上昇スイープ(手本 0.6〜1.65秒)。pre:true
    dur = 1.05; y = glide(SG_UP, dur, 1.0, harm=(1.0, 0.3), att=0.01, rel=0.002); y2 = glide([(t, f * 2) for t, f in SG_UP], dur, 0.5, att=0.01, rel=0.002)
    return fin(y + y2, -10, 3.0), 0.0

def SPECS_R():
    p = 'lf_r_'; S = {}
    pairs = {'rush_build': E_rush_build, 'rush_chou': E_rush_chou, 'rush_chou2': E_rush_chou2, 'rush_tsuku': E_rush_tsuku, 'rush_rush': E_rush_rush, 'rush_glitter': E_rush_glitter,
             'cs_sweep1': N_sweep1, 'cs_kei': N_kei, 'cs_zoku': N_zoku, 'cs_ignite': N_ignite, 'cs_ring': N_ring, 'cs_build_a': N_build_a, 'cs_build_b': N_build_b, 'cs_final': N_final, 'cs_nirenme': N_nirenme,
             'ci_title': G_ci_title, 'ci_burst': G_ci_burst, 'ci_zap': G_ci_zap, 'ci_sweep': G_ci_sweep, 'land': N_kei}
    for k, fn in pairs.items(): S[p + k] = (lambda fn=fn, k=k: fn(p + k))
    return S
