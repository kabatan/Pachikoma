# 11/1 ?jpmix(既定) 用の合成: kind 'j'。r(実機の確定音の書き起こし)と同じ名前(lf_j_*)・同じ出来事表・同じ頭の位置で、
# 「成功時だけ浮く」原因を直した版。原因は NOTES.md の「JP通しの録音」節(数字つき)。直した点:
#   1. 音高: 純音の線が 1000/2000/4000Hz(= B+21セント、JP曲 A=440 に対して半音の約1/5 ずれ)で、JP曲の B と唸る → すべて平均律 A=440、
#      JP曲の主音・属音(D・A)の和音と音階(D長調: RUSH、A長調: 継続)へ。エヴァの階段 A#5/C6 は A5/B5 へ半音下げて調に入れる。
#   2. 帯域: 2〜6kHz の純音が帯域配分の -3.7dB(実機の決め音は -22dB、120Hz〜2kHz に集中)→ 純音の線は 1kHz 台までにして短い減衰にし、
#      主役は 120Hz〜2kHz のブラスの和音(8Hz 前後の揺れ=実機の決め音の縞)。6kHz 以上は絞る。
#   3. 持続: 4kHz の純音を 3秒以上そのまま鳴らして裸になっていた → 線は 0.8〜1.3秒で減衰する。
#   4. 飽和: 純音を hot バス(+6.3dB)と最後の tanh で二重に潰して濁っていた(非線形成分 -16〜-18dB)→ 緩い飽和(drive 1.2)で -25dB 以下を目標。
#   5. 空間: 全部の音に同じ部屋の残響(固定シードのIR・RT 0.9秒・高域減衰)を焼き込んで、同じ空間に置く。
# 音は100%合成。録音・サンプルは使わない。
import numpy as np, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from synth_loud import *
from synth_ref import glide, hold, lines, fall, steps, hzn, poly_f

ROOM_RT, ROOM_WET = 0.9, 0.22

_IR = {}
def room_ir():
    if 'ir' not in _IR:
        r = R('jpmix_room'); n = int(ROOM_RT * 1.5 * SR); t = np.arange(n) / SR
        ir = np.stack([r.g.standard_normal(n), r.g.standard_normal(n)], 1) * np.exp(-6.9 * t / ROOM_RT)[:, None]
        # 高域は早く減衰(2段): 0〜0.25秒は 7kHz まで、以降は 3kHz まで
        early = lp(ir, 7000, 2); late = lp(ir, 3000, 2); w = np.clip(t / 0.35, 0, 1)[:, None]; ir = early * (1 - w) + late * w
        ir = hp(ir, 180, 1); ir[: int(0.014 * SR)] = 0; ir /= np.sqrt((ir ** 2).sum()); _IR['ir'] = ir
    return _IR['ir']

def room(x, wet=ROOM_WET):
    ir = room_ir(); n = len(x) + int(0.5 * SR); xp = pad(x, n)
    w = np.stack([sg.fftconvolve(xp[:, c], ir[:, c])[:n] for c in range(2)], 1)
    k = np.sqrt((xp ** 2).sum() / max((w ** 2).sum(), 1e-9))
    return xp + wet * k * w

from scipy.ndimage import maximum_filter1d, uniform_filter1d
import meas as _meas
HOT = 10 ** (6.3 / 20)

def limiter(x, thr_db=-1.5, look=0.003, rel=0.08):
    """ルックアヘッドのリミッター(飽和ではなく利得を下げる=濁らない)。ピークを thr_db に抑える。"""
    thr = db(thr_db); n = len(x); L = max(2, int(look * SR)); pk = np.abs(x).max(1)
    env = maximum_filter1d(pk, size=2 * L + 1); g = np.minimum(1.0, thr / np.maximum(env, 1e-9)); g = uniform_filter1d(g, size=L)        # 先読みで滑らかに下げる
    a = np.exp(-1.0 / (rel * SR)); out = np.empty(n); cur = 1.0
    for i in range(n):                                                                                                                 # 戻りはゆっくり
        gi = g[i]
        cur = gi if gi < cur else a * cur + (1 - a) * gi
        out[i] = cur
    out = np.minimum(out, g)
    return x * out[:, None]

def shelf(x, f, gain_db):
    return x + (db(gain_db) - 1.0) * hp(x, f, 1)

def chain_M(y): return _meas.loud(_meas.chain(y * HOT, .45))['momentary_max']

def fin_j(x, peak_db=-1.5, drive=0.0, lpf=9000, tail=0.04, rev=ROOM_WET, keep=False, m_target=None, tilt=4.0, sat=2.4):
    """高域を 9kHz で落とす → 共通の残響 → リミッター(利得を下げる方式・飽和しない)。
    m_target(実機チェーン master→天井 を通した momentary 最大 LUFS)があれば、そこへ届くまで入力利得を上げてリミッターに詰める(密度で大きく、ピークは peak_db)。"""
    x = np.nan_to_num(x); x = lp(x, lpf, 2); n0 = len(x)
    if tilt: x = shelf(x, 1500, tilt)
    if rev: x = room(x, rev)
    if keep: x = x[:n0]      # 上昇音(pre:true)は終わりが出来事の時刻なので残響の尾は付けない
    x = x / np.abs(x).max()
    if sat: x = softclip(x, sat)            # 控えめな飽和(drive 2.4: 実機チェーンの非線形成分を増やさない範囲で密度を足す。旧 r は drive 3〜3.4 + 純音)
    x = x / np.abs(x).max() * db(peak_db)
    if m_target is not None:
        lo, hi = 0.0, 24.0
        for _ in range(7):
            mid = (lo + hi) / 2; y = limiter(x * db(mid), peak_db)
            if chain_M(y) < m_target: lo = mid
            else: hi = mid
        x = limiter(x * db(hi), peak_db)
    else: x = limiter(x, peak_db)
    nf = int(tail * SR); x[-nf:] *= np.linspace(1, 0, nf)[:, None]; return x

def trem(x, hz=7.6, depth=0.22, phase=0.0):
    t = np.arange(len(x)) / SR; return x * (1 + depth * np.sin(2 * np.pi * hz * t + phase))[:, None] / (1 + depth * 0.5)

def chord(r, notes, dur, tau=0.9, hold_s=0.15, bright=(0.52, 0.74), tr=0.22, a=0.006, vib=0.0):
    """ブラス/オルガン風の和音。bright は倍音の開き(小さいほど柔らかい=120Hz〜2kHz に集中)。揺れ(トレモロ)で実機の縞に似せる。"""
    y = brass(r, notes, dur, a=a, tau=tau, hold=hold_s, bright0=bright[0], bright1=bright[1], bright_t=0.05, vib=vib)
    return trem(y, 7.6, tr) if tr else y

def hi(r, root, dur, tau=0.7, g=1.0, o=5):
    """上の層: 同じ和音の高いオクターブ(明るいブラス・倍音は 4kHz 台まで)。2〜6kHz を調の音で厚くする(純音の線ではなく和音の倍音で)。"""
    ks = {'D': ('D', 'F#', 'A'), 'A': ('A', 'C#', 'E'), 'E': ('E', 'G#', 'B')}[root]
    notes = [hz(ks[0], o), hz(ks[2], o), hz(ks[0], o + 1), hz(ks[1], o + 1), hz(ks[2], o + 1)]
    return chord(r, notes, dur, tau=tau, hold_s=0.1, bright=(0.78, 0.9), tr=0.2) * g

def bell(r, f, dur=1.2, tau=0.5, amp=1.0, parts=((1, 1.0), (2.0, 0.35), (3.01, 0.12), (4.2, 0.05))):
    """鐘/チャイム: 平均律の基音に近い倍音。減衰する(持続しっぱなしの純音にしない)。"""
    n = int(dur * SR); t = np.arange(n) / SR; x = np.zeros(n)
    for k, a in parts: x += a * np.sin(2 * np.pi * f * k * t) * np.exp(-t / (tau / (0.6 + 0.4 * k)))
    x *= np.minimum(1, t / 0.002) * amp; return np.stack([x, x], 1)

def low_j(r, size=1.0, dur=1.2, sub=(130, 46), timp_f=73.42):
    """低い衝撃(サブ+ティンパニ+ひび)。ティンパニは JP曲の主音 D(D2=73.42Hz)。ひびは 6kHz までに抑える。"""
    n = int(dur * SR); b = np.zeros((n, 2)); sz = size ** 0.5
    place(b, sub_boom(r, 0.8, sub[0], sub[1], 0.26 * sz), 0, 0.9 * sz); place(b, timpani(r, timp_f, 0.9, 0.34), 0, 0.5 * sz)
    place(b, lp(crack(r, 0.12, 1800, 6000, 0.025), 6500, 2), 0, 0.35 * sz); return b

def D(note, o): return hz(note, o)

# D長調(RUSH)の和音・A長調(継続)の和音
def maj(root, o, big=True):
    ks = {'D': ('D', 'F#', 'A'), 'A': ('A', 'C#', 'E'), 'E': ('E', 'G#', 'B')}[root]
    n = [hz(root, o), hz(root, o + 1), hz(ks[2], o + 1), hz(root, o + 2), hz(ks[1], o + 2), hz(ks[2], o + 2)]
    if big: n += [hz(root, o + 3)]
    return n
def minr(root, o):     # F#m: F#, A, C#
    return [hz(root, o), hz(root, o + 1), hz('C#', o + 2), hz(root, o + 2), hz('A', o + 2)]

# ---------- 超つくこまRUSH(D長調: D → F#m → A → D(上)) ----------
KY = [(0.0, 1.0), (0.05, 1.86), (0.17, 2.29), (0.23, 2.61), (0.29, 3.0), (0.35, 3.5), (0.38, 4.0)]    # エヴァのキュインの曲線(比。0→280Hz 相当を 1.0 として 4.0 倍=2オクターブ)
def J_rush_build(name):          # 11コマ(0.367秒)で D4(293.66)→D6(1174.66) の上昇(後半が速い曲線)。重なる短い上昇チャープは調の音(A6→D7)
    r = R(name); dur = 11 / FPS; k = dur / 0.38; f0 = hz('D', 4)
    sw = glide([(t * k, f0 * m) for t, m in KY], dur, 1.0, harm=(1.0, 0.18, 0.05), att=0.002, rel=0.002)
    sw2 = glide([(t * k, f0 * m / 2) for t, m in KY], dur, 0.55, harm=(1.0, 0.3), att=0.002, rel=0.002)
    c1 = glide([(0.0, hz('A', 6)), (0.2 * k, hz('D', 7))], dur, 0.35, att=0.004, rel=0.004); c1[int(0.2 * k * SR):] = 0
    y = sw + sw2 + c1; place(y, sub_boom(r, 0.3, 110, 55, 0.08), 0, 0.6)
    return fin_j(y, -1.5, 0, 8000, rev=0.12, keep=True), 0.0
def J_rush_chou(name):           # f11 「超」: D長調の和音(D2〜F#5)+ D6 の鐘(減衰)
    r = R(name); d = 1.4; y = low_j(r, 1.0, d)
    place(y, chord(r, maj('D', 2, False), d, tau=0.55, tr=0.2), 0, 0.85); place(y, bell(r, hz('D', 6), 1.2, 0.5), 0.0, 0.35); place(y, bell(r, hz('A', 5), 1.0, 0.4), 0.03, 0.2)
    place(y, hi(r, 'D', 1.2, 0.5), 0, 0.5)
    return fin_j(y, m_target=-5.0), 0.0
def J_rush_chou2(name):          # f16 「超」が定位置へ: F#m(F#3 A3 C#4…)
    r = R(name); d = 0.9; y = low_j(r, 0.5, d, sub=(110, 50), timp_f=92.5)
    place(y, chord(r, minr('F#', 2), d, tau=0.4, tr=0.15), 0, 0.85); place(y, bell(r, hz('F#', 6), 0.8, 0.35), 0, 0.3)
    place(y, hi(r, 'D', 0.8, 0.35), 0, 0.3)
    return fin_j(y, m_target=-5.5), 0.0
def J_rush_tsuku(name):          # f21 「つくこま」: A長調の和音(D の属)+ A5 の鐘
    r = R(name); d = 1.0; y = low_j(r, 0.7, d, sub=(120, 50), timp_f=110.0)
    place(y, chord(r, maj('A', 2, False), d, tau=0.45, tr=0.18), 0, 0.85); place(y, bell(r, hz('A', 5), 0.9, 0.45), 0, 0.3); place(y, bell(r, hz('E', 6), 0.7, 0.3), 0.04, 0.2)
    place(y, hi(r, 'A', 0.9, 0.4), 0, 0.4)
    return fin_j(y, m_target=-4.7), 0.0
def J_rush_rush(name):           # f26 「RUSH」(最大・頭 0.16秒前から逆回転の吸い込み): D長調の大和音(D2〜D5)・揺れ・D6 の線(1.3秒で減衰)・シンバルは 6kHz まで
    r = R(name); d = 3.4; pre = 0.16; y = np.zeros((int(d * SR), 2))
    place(y, lp(reverse_swell(r, pre, 2500), 7000, 2), 0, 0.4)
    place(y, low_j(r, 1.5, d - pre, sub=(150, 42)), pre, 1.0)
    place(y, chord(r, maj('D', 2, True), d - pre, tau=1.5, hold_s=0.5, tr=0.24, bright=(0.55, 0.80)), pre, 0.95)
    place(y, chord(r, [hz('D', 5), hz('A', 5), hz('D', 6)], 1.6, tau=0.9, tr=0.2, bright=(0.4, 0.5)), pre, 0.35)
    place(y, hi(r, 'D', 2.4, 0.9), pre, 0.7)
    place(y, lp(cymbal(r, 2.2, 0.8, lo=3000), 6500, 2), pre, 0.28)
    x = lines(1.8, [(hz('D', 6), -3), (hz('D', 7), -10)], att=0.003, rel=0.1, tau=0.7); place(y, x, pre, 0.22)
    return fin_j(y, m_target=-4.0), pre
def J_rush_glitter(name):        # f28 金属の雨: D長調の五音(D6 E6 F#6 A6 B6)の鐘を 0.05〜0.1秒おきに、まばらに減衰
    r = R(name); d = 1.5; y = np.zeros((int(d * SR), 2)); sc = [hz('D', 6), hz('E', 6), hz('F#', 6), hz('A', 6), hz('B', 6), hz('D', 7)]
    t = 0.0; k = 0
    while t < 1.1:
        f = sc[int(r.g.integers(0, len(sc)))]; place(y, bell(r, f, 0.45, 0.2, parts=((1, 1.0), (2.0, 0.2))), t, 0.55 * np.exp(-t / 0.8)); t += 0.04 + 0.05 * r.g.random() + 0.05 * (t / 1.1); k += 1
    return fin_j(y, -1.5, 0, 8000, rev=0.2, m_target=-9.0), 0.0

# ---------- 継続(A長調: A → E → A) ----------
def J_cs_sweep1(name):           # 0.6秒 110Hz → A6(1760) の上昇(曲線は前半急・後半ゆるい)。pre
    r = R(name); dur = 0.6
    E = [(0.0, 110), (0.04, 440), (0.14, 880), (0.28, 1320), (0.42, 1620), (0.52, 1740), (0.6, hz('A', 6))]
    y = glide(E, dur, 1.0, harm=(1.0, 0.15), att=0.002, rel=0.002) + 0.5 * glide([(t, f / 2) for t, f in E], dur, 1.0, att=0.002, rel=0.002)
    return fin_j(y, -1.5, 0, 8000, rev=0.1, keep=True), 0.0
def J_cs_kei(name):              # f18 「継」: A長調の和音+A5の鐘(減衰)
    r = R(name); d = 1.8; y = low_j(r, 1.1, d, timp_f=110.0)
    place(y, chord(r, maj('A', 2, True), d, tau=0.9, hold_s=0.2, tr=0.22), 0, 0.9); place(y, bell(r, hz('A', 5), 1.5, 0.6), 0, 0.35); place(y, bell(r, hz('E', 6), 1.2, 0.5), 0.0, 0.2)
    place(y, hi(r, 'A', 1.5, 0.7), 0, 0.6)
    return fin_j(y, m_target=-4.1), 0.0
STEP_J = [('A5', .09), ('B5', .08), ('B5', .09), ('A5', .08), ('B5', .06), ('A5', .08), ('B5', .30)]       # エヴァ10 の階段(A#5 C6…)を半音下げて A長調の音へ
def J_cs_zoku(name):             # f42 「続」: 階段メロディ(矩形波風・A5/B5)+ E長調の和音(Aの属)
    r = R(name); d = 1.9; y = low_j(r, 1.2, d, timp_f=82.41)
    place(y, chord(r, maj('E', 2, False), d, tau=0.7, tr=0.2), 0, 0.8)
    st = steps(STEP_J, pw=0.25, amp=1.0); st = lp(st, 4500, 2); place(y, st, 0.0, 0.55)
    return fin_j(y, m_target=-4.8), 0.0
def J_cs_ignite(name):           # f6/f14: A5→C#6→E6 の短い立ち上がり
    r = R(name); y = np.zeros((int(.55 * SR), 2)); place(y, glide([(0, hz('A', 5)), (0.1, hz('C#', 6)), (0.2, hz('E', 6))], 0.2, 1.0, harm=(1.0, 0.15)), 0, 1.0); place(y, sub_boom(r, 0.3, 95, 50, .1), 0, .6)
    return fin_j(y, -1.5, 0, 8000, rev=0.12, m_target=-8.5), 0.0
def J_cs_ring(name):             # f11 輪の閃光: A5 B5 の2音+和音の薄い下支え
    r = R(name); d = 1.0; y = low_j(r, 0.5, d, timp_f=110.0)
    st = lp(steps([('A5', .08), ('B5', .09), ('B5', .2)], pw=0.25), 4500, 2); place(y, st, 0, 0.6); place(y, chord(r, maj('A', 3, False), d, tau=0.35, tr=0.15), 0, 0.5)
    return fin_j(y, m_target=-6.5), 0.0
def J_cs_build_a(name):          # f96 まで(9コマ): 110Hz → E6(1318.5)の上昇
    dur = 9 / FPS; k = dur / 0.5
    E = [(0.0, 110), (0.03, 600), (0.12, 1000), (0.25, 1150), (0.4, 1250), (0.5, hz('E', 6))]
    y = glide([(t * k, f) for t, f in E], dur, 1.0, harm=(1.0, 0.15), att=0.002, rel=0.002)
    return fin_j(y, -1.5, 0, 8000, rev=0.08, keep=True), 0.0
def J_cs_build_b(name):          # f126 まで(8コマ・ストロボ): A5 → C#6(15Hzで刻む)
    dur = 8 / FPS; y = steps([('A5', .13), ('C#6', dur - .13)], pw=0.25)[:int(dur * SR)]; t = np.arange(len(y)) / SR
    y = lp(y, 4500, 2) * (0.3 + 0.7 * (np.sin(2 * np.pi * 15 * t + np.pi / 2) > -0.2))[:, None]
    return fin_j(y, -1.5, 0, 8000, rev=0.06, keep=True), 0.0
def J_cs_final(name):            # f126 「継続」完成(最大): A長調の大和音+揺れ+A6 の線(1.3秒で減衰)。頭 0.16秒前から吸い込み
    r = R(name); d = 3.4; pre = 0.16; y = np.zeros((int(d * SR), 2))
    place(y, lp(reverse_swell(r, pre, 2500), 7000, 2), 0, 0.4); place(y, low_j(r, 1.5, d - pre, sub=(150, 42), timp_f=110.0), pre, 1.0)
    place(y, chord(r, maj('A', 2, True), d - pre, tau=1.5, hold_s=0.5, tr=0.24, bright=(0.55, 0.80)), pre, 0.95)
    place(y, chord(r, [hz('A', 4), hz('E', 5), hz('A', 5), hz('C#', 6)], 1.6, tau=0.9, tr=0.2, bright=(0.4, 0.5)), pre, 0.35)
    place(y, hi(r, 'A', 2.4, 0.9), pre, 0.7)
    place(y, lp(cymbal(r, 2.2, 0.8, lo=3000), 6500, 2), pre, 0.28)
    place(y, lines(1.8, [(hz('A', 6), -3), (hz('A', 5), -6)], att=0.003, rel=0.1, tau=0.7), pre, 0.22)
    return fin_j(y, m_target=-4.4), pre
def J_cs_nirenme(name):          # f148 「2連目」: A5 B5 の短い2音 + 和音 + E6 の鐘の持続(減衰)
    r = R(name); d = 2.0; y = low_j(r, 1.0, d, timp_f=110.0)
    place(y, lp(steps([('A5', .1), ('B5', .1)], pw=0.25), 4500, 2), 0, 0.5); place(y, chord(r, maj('A', 3, True), d, tau=0.8, tr=0.2), 0.15, 0.8); place(y, bell(r, hz('E', 6), 1.6, 0.7), 0.2, 0.35)
    place(y, hi(r, 'A', 1.5, 0.6), 0.15, 0.4)
    return fin_j(y, m_target=-5.5), 0.0

# ---------- 継続カットイン(A長調) ----------
def J_ci_title(name):            # f4: 下降チャープ(E6→A4)+A長調の和音+低音の衝撃
    r = R(name); y = low_j(r, 1.1, 1.6, timp_f=110.0)
    place(y, chord(r, maj('A', 2, False), 1.6, tau=0.8, tr=0.2), 0, 0.9)
    place(y, hi(r, 'A', 1.2, 0.6), 0, 0.4)
    place(y, fall(hz('E', 6), hz('A', 4), 0.22, 1.0, (1.0, .3)), 0, 0.7)
    return fin_j(y, m_target=-5.9), 0.0
def J_ci_burst(name):            # f9: 下降チャープ2連+ピ連打(E7 D7 C#7 B6 の下行。矩形波・4.5kHzまで)
    r = R(name); y = low_j(r, 0.8, 1.4, sub=(120, 48), timp_f=110.0)
    place(y, fall(hz('E', 6), hz('A', 4), 0.2, 1.0), 0, 0.8); place(y, fall(hz('E', 6), hz('A', 4), 0.2, 0.9), 0.12, 0.8)
    pips = [hz('E', 7), hz('D', 7), hz('C#', 7), hz('B', 6)] * 2
    for k, f in enumerate(pips): place(y, lp(hold(f, 0.05, 0.6, att=0.001, rel=0.01, pw=0.25), 4500, 2), 0.25 + k * 0.05, 0.6 * np.exp(-k * 0.08))
    place(y, chord(r, maj('A', 3, False), 1.2, tau=0.5, tr=0.15), 0.1, 0.45)
    return fin_j(y, m_target=-5.6), 0.0
def J_ci_zap(name):
    r = R(name); y = np.zeros((int(.5 * SR), 2))
    for k, f in enumerate([hz('E', 7), hz('D', 7), hz('C#', 7), hz('B', 6), hz('E', 7), hz('C#', 7)]): place(y, lp(hold(f, 0.05, 0.9, att=0.001, rel=0.01, pw=0.25), 4500, 2), k * 0.05, 1.0)
    return fin_j(y, -1.5, 0, 8000, rev=0.15, m_target=-8.5), 0.0
def J_ci_sweep(name):            # (未配置) 117Hz → A6 の大きな上昇
    dur = 1.05; SG = [(0.0, 117), (0.17, 313), (0.33, 464), (0.49, 568), (0.65, 825), (0.81, 1479), (1.05, hz('A', 6))]
    y = glide(SG, dur, 1.0, harm=(1.0, 0.25), att=0.01, rel=0.002); return fin_j(y, -1.5, 0, 8000, rev=0.1, keep=True), 0.0
def J_land(name):                # chain_jp_land f0: A長調の和音+鐘(継の別録り)
    r = R(name); d = 1.8; y = low_j(r, 1.25, d, timp_f=110.0)
    place(y, chord(r, maj('A', 2, True), d, tau=0.85, hold_s=0.2, tr=0.22), 0, 0.9); place(y, bell(r, hz('A', 5), 1.4, 0.55), 0, 0.3)
    place(y, hi(r, 'A', 1.5, 0.7), 0, 0.6)
    return fin_j(y, m_target=-4.4), 0.0

# ---------- メーターの進み(新設・調の音階が上がる)。シールが1枚切れるごと(jp_aim_seal_dN_b1 / b2 / open) ----------
def J_ladder(root, step):        # step 0,1,2: 3和音が上がる。D長調: D5 → F#5 → A5 の和音を重ねる
    def f(name):
        r = R(name); d = 1.2 + 0.2 * step; y = low_j(r, 0.55 + 0.25 * step, d, sub=(110, 50), timp_f=hz(root, 2) * (1 + 0.0))
        o = 3 + step // 2   # 段が進むほどオクターブが上がる
        tones = {'D': [('D', 'A', 'F#'), ('F#', 'C#', 'A'), ('A', 'E', 'D')], 'A': [('A', 'E', 'C#'), ('C#', 'G#', 'E'), ('E', 'B', 'A')]}[root][step]
        notes = [hz(tones[0], 3 + (1 if step else 0)), hz(tones[1], 4 + (1 if step == 2 else 0)), hz(tones[2], 4 + (1 if step else 0)), hz(tones[0], 5 + (1 if step == 2 else 0))]
        place(y, chord(r, notes, d, tau=0.5 + 0.1 * step, tr=0.18, bright=(0.42, 0.55 + 0.04 * step)), 0, 0.9)
        place(y, bell(r, notes[-1] * 2, 0.9, 0.4), 0.0, 0.25 + 0.05 * step)
        return fin_j(y, -1.5, 0, 9000, m_target={0:-8.0,1:-7.0,2:-6.0}[step]), 0.0
    return f

def SPECS_J():
    p = 'lf_j_'; S = {}
    pairs = {'rush_build': J_rush_build, 'rush_chou': J_rush_chou, 'rush_chou2': J_rush_chou2, 'rush_tsuku': J_rush_tsuku, 'rush_rush': J_rush_rush, 'rush_glitter': J_rush_glitter,
             'cs_sweep1': J_cs_sweep1, 'cs_kei': J_cs_kei, 'cs_zoku': J_cs_zoku, 'cs_ignite': J_cs_ignite, 'cs_ring': J_cs_ring, 'cs_build_a': J_cs_build_a, 'cs_build_b': J_cs_build_b,
             'cs_final': J_cs_final, 'cs_nirenme': J_cs_nirenme, 'ci_title': J_ci_title, 'ci_burst': J_ci_burst, 'ci_zap': J_ci_zap, 'ci_sweep': J_ci_sweep, 'land': J_land,
             'up1': J_ladder('D', 0), 'up2': J_ladder('D', 1), 'up3': J_ladder('D', 2), 'cup1': J_ladder('A', 0), 'cup2': J_ladder('A', 1), 'cup3': J_ladder('A', 2)}
    for k, fn in pairs.items(): S[p + k] = (lambda fn=fn, k=k: fn(p + k))
    return S
