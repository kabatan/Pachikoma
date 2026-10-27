"""本番動画の寸法・codec・PNGマスターとの差を確認。PNG比較図も保存（CPUのみ）。"""
from pathlib import Path
import json
import math
import subprocess

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[4]
DEST = ROOT / 'work/game_demo/play/lcd_surface/production1026'
MASTERS = ROOT / 'work/effects/normal_fx/production1026/masters'
OUT = ROOT / 'work/game_demo/play/out/integration1026_quality'
OUT.mkdir(parents=True, exist_ok=True)
man = json.loads((DEST / 'manifest.json').read_text())
rows = []
for name, file in man['files'].items():
    video = DEST / file
    meta = json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames',
        '-show_entries','stream=codec_name,width,height,pix_fmt,r_frame_rate,nb_read_frames,color_space,color_range:format=size,duration,bit_rate',
        '-of','json',str(video)]))
    stream = meta['streams'][0]
    assert (stream['width'],stream['height'],stream['r_frame_rate'],stream['codec_name']) == (1152,1268,'30/1','h264'), (name,stream)
    expected = 228 if man['scenes'][name]['loop'] else man['scenes'][name]['frames']
    assert int(stream['nb_read_frames']) == expected, (name,stream['nb_read_frames'],expected)
    # ループの重ね区間を避け、対応する元PNGと同じフレームで比較する。
    index = min(expected//2, 120)
    master_index = index + 12 if man['scenes'][name]['loop'] else index
    ref = np.asarray(Image.open(MASTERS / name / f'{master_index:04d}.png').convert('RGB'))
    data = subprocess.check_output(['ffmpeg','-v','error','-i',str(video),'-vf',rf'select=eq(n\,{index})',
        '-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'])
    decoded = np.frombuffer(data,np.uint8).reshape(1268,1152,3)
    diff = np.abs(decoded.astype(np.float32)-ref.astype(np.float32))
    mse = float(np.mean(diff**2))
    psnr = 10*math.log10(255**2/max(mse,1e-20))
    rows.append({'name':name,'stream':stream,'format':meta['format'],'sample_frame':index,
        'rgb_psnr_db':round(psnr,3),'rgb_mean_abs_255':round(float(diff.mean()),4),'rgb_p99_abs_255':float(np.quantile(diff,.99))})
    # 色差サブサンプリングを含む比較。数値のみで目視合格を代用しない。
    assert diff.mean()<5.0, (name,'Unexpected source/video mismatch',float(diff.mean()))
    if name in ['idle0','lamp3','lamp4','lamp5','reset4','protect3']:
        # 1:1の切り出しを並べる。縮小版だけで画質を判断しない。
        x,y,w,h=(300,300,552,400) if name.startswith('lamp') else (260,720,630,350)
        a=Image.fromarray(ref).crop((x,y,x+w,y+h));b=Image.fromarray(decoded).crop((x,y,x+w,y+h))
        canvas=Image.new('RGB',(2*w,h+32),'#111827');canvas.paste(a,(0,32));canvas.paste(b,(w,32))
        draw=ImageDraw.Draw(canvas);draw.text((8,8),'PNG master / 1:1',fill='white');draw.text((w+8,8),'H264 CRF12 / 1:1',fill='white')
        canvas.save(OUT / f'{name}_native_comparison.png')
    print(name,'Mbps',round(int(meta['format']['size'])*8/float(meta['format']['duration'])/1e6,3),'RGB PSNR',round(psnr,2),flush=True)
(OUT/'report.json').write_text(json.dumps({'note':'RGB比較には4:2:0の色差も含む。目視比較は別途行う。','clips':rows},ensure_ascii=False,indent=2)+'\n')
print('PASS',len(rows),'native-size videos')
