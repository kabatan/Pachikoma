"""統括適用用。現在のゲームを読むだけ。対象正本へ書き込まない。"""
from pathlib import Path
import difflib,hashlib,json
root=Path(__file__).resolve().parents[3]
changes={}
p=root/'work/game_demo/play/index.html';before=p.read_text()
old='<label id="audio-panel" hidden>音量 <input id="audio-master" aria-label="音量" type="range" min="0" max="1" step=".01" value=".45"></label>'
new='''<div id="audio-panel" hidden>
 <label>音量 <input id="audio-master" aria-label="音量" type="range" min="0" max="1" step=".01" value=".45"></label>
 <label><input data-bgm-enable type="checkbox"> BGM有効</label>
 <label>BGM音量 <input data-bgm-volume aria-label="BGM音量" type="range" min="0" max="1" step=".01" value=".65"></label>
 <label><input data-bgm-mute type="checkbox"> BGMミュート</label>
 <button data-bgm-reload type="button">BGM再読込</button><span data-bgm-status role="status"></span>
</div>'''
assert before.count(old)==1,'audio-panel baseline changed; regenerate against current game'
after=before.replace(old,new).replace('#audio-panel{position:', '#audio-panel{max-width:calc(100vw - 32px);display:flex;flex-wrap:wrap;align-items:center;gap:4px;position:')
changes[str(p.relative_to(root))]=(before,after)
p=root/'work/game_demo/play/play.mjs';before=p.read_text()
old='r2Audio = await connectAudio({ pa, bus: effects });'
new="""r2Audio = await connectAudio({ pa, bus: effects, bgmEnabled: q.get('bgm') === '1', getPhase: () => ctrl.game.phase });
    const { bindBgmControls } = await import('../../audio/runtime/bgm_controls.mjs');
    bindBgmControls(r2Audio.engine, document.getElementById('audio-panel'));"""
assert before.count(old)==1,'connectAudio baseline changed'
changes[str(p.relative_to(root))]=(before,before.replace(old,new))
out=Path(__file__).parent
(out/'INTEGRATION_S4.patch').write_text(''.join(''.join(difflib.unified_diff(a.splitlines(True),b.splitlines(True),fromfile='a/'+p,tofile='b/'+p)) for p,(a,b) in changes.items()))
(out/'INTEGRATION_S4_BASE.json').write_text(json.dumps({p:hashlib.sha256(a.encode()).hexdigest() for p,(a,b) in changes.items()},indent=2)+'\n')
