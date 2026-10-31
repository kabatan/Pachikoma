# 11/1 配当獲得(reward_30/40/100/200/500)の効果音。RUSH(lf_r_rush_*)と同じ系統: 純音の線(1kHz/4kHz/8kHz)・キュインの上昇・矩形波の階段・7kHz台のチップ+低音の衝撃。
# 段(tier 0..4 = 30/40/100/200/500)が上がるほど: 低音の衝撃が大きく、線が長く、上昇が増え、金属の雨(コイン)が長く多く、最後は RUSH と同じ最大。録音は使わない。
# 実機の配当獲得(出玉獲得)の書き起こしは NOTES.md の「配当獲得の実機」節。
import numpy as np, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from synth_loud import *
from synth_ref import glide, hold, lines, steps, low_base, fin, poly_f, mix_at, fall

SW = [(0.0, 400), (0.1, 900), (0.25, 1700), (0.42, 2800), (0.55, 3600), (0.62, 4000)]      # 上昇(キュイン): 約0.6秒で 4kHz の線へ

def coin_rain(r, dur, density, lo=5200, hi=8200, g=0.7):
    """7kHz台のチップ(RUSH の glitter と同じ)の雨。density=1秒あたりの数"""
    y = np.zeros((int(dur * SR), 2)); n = int(dur * density)
    for k in range(n):
        t = (k / max(1, n - 1)) ** 0.8 * (dur - 0.08); f = lo + (hi - lo) * r.g.random()
        place(y, hold(f, 0.04 + 0.03 * r.g.random(), 0.5, att=0.001, rel=0.012), t, g * (1 - 0.5 * t / dur))
    return y

def P_open(name):                 # f3: 配当画面の頭。短い上昇+1kHzの線(RUSH の「超」の頭と同じ形)
    r = R(name); y = low_base(r, 0.6, None, 0, 1.0)
    place(y, glide([(0, 600), (0.12, 1000)], 0.14, 1.0, harm=(1.0, 0.1)), 0, 1.0); place(y, lines(0.9, [(1000, -6)], tau=0.5), 0.1, 0.7)
    place(y, hold(7200, 0.1, 0.4), 0.05, 0.7)
    return fin(y, -9.5, 3.0), 0.0

def P_hit(tier):                  # f46: 配当の大きな一撃。tier が上がるほど大きく長い
    def f(name):
        r = R(name); d = 1.4 + 0.45 * tier; sz = 0.9 + 0.14 * tier; y = low_base(r, sz, 'D', 0.3 + 0.03 * tier, d)
        spec = [(1000, -6), (4000, 0)] + ([(8000, -22)] if tier >= 2 else [])
        place(y, lines(d, spec, dips=(0.25,) if tier >= 2 else (), tau=0.9 + 0.35 * tier), 0, 1.0)
        place(y, glide([(0, 3500), (0.1, 4000)], 0.1, 0.8), 0, 0.8)
        for k in range(2 + tier): place(y, hold(7000 + 220 * k, 0.1, 0.4), 0.02 + 0.09 * k, 0.8)
        if tier >= 3: place(y, glide(SW, 0.62, 0.7, harm=(1.0, 0.1)), 0.35, 0.8)
        return fin(y, -8.8 + 0.25 * tier, 3.0 + 0.1 * tier), 0.0
    return f

def P_full(tier):                 # f109: 全景。上昇(キュイン)→ 線の持続 → 階段のメロディ → コインの雨(段が上がるほど長く多く)
    def f(name):
        r = R(name); d = 2.2 + 0.5 * tier; y = np.zeros((int(d * SR), 2))
        place(y, low_base(r, 0.7 + 0.17 * tier, 'D', 0.25, 1.2), 0.62, 1.0)
        place(y, glide(SW, 0.62, 1.0, harm=(1.0, 0.1)), 0, 1.0)
        place(y, lines(d - 0.62, [(1000, -6), (4000, 0)], tau=1.0 + 0.5 * tier, dips=(0.5,)), 0.62, 0.85)
        seq = [('A#5', .09), ('C6', .08), ('C6', .09), ('A#5', .08), ('C6', .06), ('A#5', .08), ('C6', .30)]
        place(y, steps(seq), 0.62 + 0.2, 0.9)
        if tier >= 1: place(y, steps(seq[::-1][:5]), 0.62 + 0.9, 0.8)
        # 実機(ユニコーン3000発Fever 23.7〜41.7秒)の書き起こしから: 220〜440Hz の矩形波の階段(約8音/秒)・2kHz→500Hz の下降チャープ(ピュン)・110Hz→1.3kHz の大きな上昇(約2秒)
        if tier >= 1:
            bass = [(220, .12), (293.7, .12), (370, .12), (440, .12), (370, .12), (293.7, .12), (220, .12), (440, .24)]
            t = 0.62 + 0.15
            for rep in range(1 + (tier >= 3)):
                for f0, du in bass: place(y, hold(f0, du - .01, 0.8, att=0.002, rel=0.006, pw=0.25), t, 0.55); t += du
        if tier >= 2:
            for k in range(2 + tier - 2): place(y, fall(2000, 500, 0.25, 1.0, (1.0, .2)), 0.9 + 0.5 * k, 0.55)
        if tier >= 3: place(y, glide([(0, 110), (0.8, 330), (1.4, 800), (1.8, 1300)], 1.8, 0.8, harm=(1.0, 0.15)), 0.5 + 0.3 * (tier - 3), 0.7)
        place(y, coin_rain(r, d - 0.7, 8 + 7 * tier), 0.7, 0.9)
        return fin(y, -8.8 + 0.2 * tier, 3.0), 0.0
    return f

def P_flash(name):                # f139/163/187: 閃光ごとの短い鳴り(チャープ+1kHz)
    r = R(name); y = np.zeros((int(0.9 * SR), 2))
    place(y, glide([(0, 1850), (0.13, 2540)], 0.13, 1.0), 0, 1.0); place(y, glide([(0, 3215), (0.08, 3800)], 0.1, 0.9), 0.1, 0.9); place(y, lines(0.8, [(1000, -6), (4000, -3)], tau=0.4), 0.05, 0.7)
    place(y, sub_boom(r, 0.3, 100, 52, 0.09), 0, 0.7)
    return fin(y, -10, 3.0), 0.0


# ---- JPチャンス(封印が1枚切れるごとの上昇・題字) : RUSH と同じ系統 ----
def P_up(step):                   # step 0,1,2: 1kHz → 2kHz → 4kHz(最後は RUSH と同じ 1k+4k の線)へキュインで上がる。段ごとに低音の衝撃が大きくなる
    def f(name):
        r = R(name); d = 1.0 + 0.3 * step; end = (1000, 2000, 4000)[step]; y = low_base(r, 0.5 + 0.35 * step, None, 0, d)
        place(y, glide([(0, end * 0.35), (0.07, end * 0.6), (0.14, end)], 0.16, 1.0, harm=(1.0, 0.1)), 0, 1.0)
        spec = [(1000, -6)] + ([(2000, -4)] if step == 1 else []) + ([(4000, 0), (8000, -24)] if step == 2 else [])
        place(y, lines(d - 0.1, spec, tau=0.5 + 0.35 * step), 0.12, 0.8)
        for k in range(1 + 2 * step): place(y, hold(7000 + 250 * k, 0.08, 0.4), 0.1 + 0.07 * k, 0.7)
        return fin(y, -9.5 + 0.8 * step, 3.0), 0.0
    return f
def P_chance(name):               # JACKPOT CHANCE の題字: 上昇(キュイン)+1k/4k の線+低音の衝撃(RUSH の「超」より小さい)
    r = R(name); d = 1.6; y = low_base(r, 1.0, 'D', 0.25, d)
    place(y, glide([(0, 280), (0.1, 640), (0.2, 840), (0.28, 1040)], 0.3, 1.0, harm=(1.0, 0.12)), 0, 1.0)
    place(y, lines(d, [(1000, -6), (4000, 0)], tau=0.8, dips=(0.5,)), 0.2, 0.85); place(y, hold(7200, 0.1, 0.4), 0.2, 0.7)
    return fin(y, -8.8, 3.0), 0.0

def SPECS_PAY():
    S = {'lf_r_pay_open': lambda: P_open('lf_r_pay_open'), 'lf_r_pay_flash': lambda: P_flash('lf_r_pay_flash')}
    S['lf_r_chance'] = lambda: P_chance('lf_r_chance')
    for k in range(3):
        S[f'lf_r_up{k+1}'] = (lambda k=k: P_up(k)(f'lf_r_up{k+1}'))
    for t in range(5):
        S[f'lf_r_pay_hit{t}'] = (lambda t=t: P_hit(t)(f'lf_r_pay_hit{t}')); S[f'lf_r_pay_full{t}'] = (lambda t=t: P_full(t)(f'lf_r_pay_full{t}'))
    return S
