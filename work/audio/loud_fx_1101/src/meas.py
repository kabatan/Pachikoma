# 音の実測道具(10/31 loud_fx)。ogg/wav を 48kHz ステレオ float で読み、ミキサー(ゲイン・時刻)で合成し、実機チェーン(master .45 -> 天井 .8*tanh(2x))を通して
# ピーク・ラウドネス(BS.1770 K特性: 400ms momentary 最大 / short-term 3s 最大 / 積算)を測る。
import subprocess, numpy as np, json, sys
from scipy.signal import lfilter
SR = 48000
def load(path):
    out = subprocess.run(['ffmpeg','-v','error','-i',str(path),'-f','f32le','-ac','2','-ar',str(SR),'-'],capture_output=True,check=True).stdout
    return np.frombuffer(out,dtype=np.float32).reshape(-1,2).astype(np.float64)
def db(x): return 20*np.log10(np.maximum(x,1e-12))
def kw(x):   # K特性(48kHz)
    b1=[1.53512485958697,-2.69169618940638,1.19839281085285]; a1=[1,-1.69065929318241,0.73248077421585]
    b2=[1,-2,1]; a2=[1,-1.99004745483398,0.99007225036621]
    return np.stack([lfilter(b2,a2,lfilter(b1,a1,x[:,c])) for c in range(x.shape[1])],1)
def loud(x):   # -> dict
    k=kw(x); z=(k**2).sum(1)   # 2ch合計の2乗
    def win(sec):
        n=int(sec*SR); 
        if len(z)<n: return -99.
        c=np.concatenate([[0],np.cumsum(z)]); m=(c[n:]-c[:-n])/n
        return float(-0.691+10*np.log10(max(m.max(),1e-12)))
    ig=-0.691+10*np.log10(max(z.mean(),1e-12))
    return dict(peak_dbfs=float(db(np.abs(x).max())), momentary_max=win(.4), short_max=win(3.0), mean=ig)
class Mix:
    def __init__(s, dur): s.b=np.zeros((int(dur*SR),2))
    def add(s, x, t, gdb=0.0, mono_to=None):
        i=int(round(t*SR)); g=10**(gdb/20)
        if i<0: x=x[-i:]; i=0
        n=min(len(x),len(s.b)-i)
        if n>0: s.b[i:i+n]+=x[:n]*g
def chain(x, master=.45):   # 圧縮機の後(hot出口)の経路の最終段: master -> ceiling
    return .8*np.tanh(2*np.clip(x*master,-1,1))
