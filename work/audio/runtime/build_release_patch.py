"""公開音響の未適用パッチを生成。本体は読み取りのみ。S4差分を内包する。"""
from pathlib import Path
import difflib,hashlib,json
ROOT=Path(__file__).resolve().parents[3];OUT=Path(__file__).parent
changes={}
p=ROOT/'work/game_demo/play/index.html';before=p.read_text()
old='<label id="audio-panel" hidden>音量 <input id="audio-master" aria-label="音量" type="range" min="0" max="1" step=".01" value=".45"></label>'
new='''<div id="audio-panel" hidden>
 <label>音量 <input id="audio-master" aria-label="音量" type="range" min="0" max="1" step=".01" value=".45"></label>
 <label><input data-bgm-enable type="checkbox"> BGM有効</label>
 <label>BGM音量 <input data-bgm-volume aria-label="BGM音量" type="range" min="0" max="1" step=".01" value=".65"></label>
 <label><input data-bgm-mute type="checkbox"> BGMミュート</label>
 <button data-bgm-reload type="button">BGM再読込</button><span data-bgm-status role="status"></span>
</div>
<details id="audio-credits" hidden><summary>音声クレジット</summary><p id="audio-voice-credit"></p></details>'''
assert before.count(old)==1,'audio-panel changed: rebuild from current baseline'
after=before.replace(old,new).replace('#audio-panel{position:', '#audio-panel{max-width:calc(100vw - 32px);display:flex;flex-wrap:wrap;align-items:center;gap:4px;position:')
after=after.replace(' #audio-panel[hidden]{display:none}', ' #audio-panel[hidden]{display:none}\n #audio-credits{position:fixed;right:8px;bottom:40px;z-index:9;max-width:320px;background:#111e;color:#fff;padding:6px 10px;font:12px sans-serif}\n #audio-credits[hidden]{display:none}')
changes[str(p.relative_to(ROOT))]=(before,after)
p=ROOT/'work/game_demo/play/play.mjs';before=p.read_text()
old="// 音響試作は ?audio=r2 で選択。読込失敗時は従来音響を維持する。"
assert before.count(old)==1 and before.count("if (q.get('audio') === 'r2') {")==1
before_connect='    r2Audio = await connectAudio({ pa, bus: effects });'
assert before.count(before_connect)==1,'audio connection changed: rebuild from current baseline'
new_connect='''    const bgmManifest = new URL('../../audio/bgm/manifest.json', import.meta.url);
    const bgmOverride = q.get('bgm');
    let releaseBgmOn = false;
    if (bgmOverride !== '1' && bgmOverride !== '0') {
      try {
        const response = await fetch(bgmManifest, { cache: 'no-store' });
        if (!response.ok) throw new Error(`BGM manifest HTTP ${response.status}`);
        releaseBgmOn = (await response.json()).release_default_on === true;
      } catch (error) { console.warn('[r2-bgm-default]', error); }
    }
    r2Audio = await connectAudio({ pa, bus: effects,
      voiceProvider: q.get('voice') ?? 'off',
      bgmEnabled: bgmOverride === '1' || (bgmOverride !== '0' && releaseBgmOn),
      bgmManifest, getPhase: () => ctrl.game.phase,
    });
    const { bindBgmControls } = await import('../../audio/runtime/bgm_controls.mjs');
    bindBgmControls(r2Audio.engine, document.getElementById('audio-panel'));
    const { VOICE_CREDITS } = await import('../../audio/runtime/voice_catalog.mjs');
    const voiceCredit = VOICE_CREDITS[r2Audio.engine.voiceProvider];
    document.getElementById('audio-credits').hidden = r2Audio.engine.voiceProvider === 'off' || !voiceCredit;
    document.getElementById('audio-voice-credit').textContent = voiceCredit ?? '';'''
after=before.replace(old,'// 公開音響はr2既定。?audio=legacyで従来音響。声は明示指定時のみ。読込失敗時は従来音響を維持する。').replace("if (q.get('audio') === 'r2') {", "if (q.get('audio') !== 'legacy') {").replace(before_connect,new_connect)
# R2-R/皿を含む音響ブロック以外はバイト単位で維持。
marker='const runtime = createRuntime({ ctrl, presenter, pa, log: app.log, effects });'
assert before.split(marker,1)[1]==after.split(marker,1)[1]
assert before.split(old,1)[0]==after.split('// 公開音響',1)[0]
changes[str(p.relative_to(ROOT))]=(before,after)
(OUT/'INTEGRATION_RELEASE.patch').write_text(''.join(''.join(difflib.unified_diff(a.splitlines(True),b.splitlines(True),fromfile='a/'+p,tofile='b/'+p)) for p,(a,b) in changes.items()))
(OUT/'INTEGRATION_RELEASE_BASE.json').write_text(json.dumps({p:hashlib.sha256(a.encode()).hexdigest() for p,(a,b) in changes.items()},indent=2)+'\n')
print('Built release patch for',', '.join(changes))
