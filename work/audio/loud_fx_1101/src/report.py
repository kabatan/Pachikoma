# 生成物の実測(ピーク・音量・帯域配分)。python3 report.py
import sys,json,os; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from meas import *
from scipy.signal import welch
HERE=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..')
edges=[20,60,120,250,500,1000,2000,4000,8000,16000]
def bands(x):
    m=x.mean(1); f,P=welch(m,SR,nperseg=8192); tot=P.sum()
    return [round(10*np.log10(P[(f>=a)&(f<b)].sum()/tot+1e-12)) for a,b in zip(edges[:-1],edges[1:])]
meta=json.load(open(HERE+'/meta.json')); G=10**(6.3/20)
print('ref(成功)      -40 -21 -9 -13 -9 -5 -6.5 -11.5 -16  | rms400  chain: peak  M')
for n,m in meta.items():
    x=load(f'{HERE}/sfx_ogg/{n}.ogg'); a=int(m['anchor']*SR); k=int(.4*SR); seg=x[a:a+k]; C=loud(chain(x*G))
    print(f'{n:16s}',*[f'{b:4d}' for b in bands(x)],f"| {db(np.sqrt((seg**2).mean())):5.1f}  {C['peak_dbfs']:5.1f} {C['momentary_max']:5.1f}")
t=load(HERE+'/../jp_start_1031/jp_thunder_new_1031.wav'); C=loud(chain(t*G)); seg=t[:int(.4*SR)]
print(f'{"thunder_new":16s}',*[f'{b:4d}' for b in bands(t)],f"| {db(np.sqrt((seg**2).mean())):5.1f}  {C['peak_dbfs']:5.1f} {C['momentary_max']:5.1f}")
