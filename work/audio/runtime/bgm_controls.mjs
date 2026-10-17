// audio-panel内でのみ使う。公開の初期値はAudioEngine側のBGM OFFに従う。
export function bindBgmControls(engine,root) {
  const enable=root.querySelector('[data-bgm-enable]'),volume=root.querySelector('[data-bgm-volume]'),mute=root.querySelector('[data-bgm-mute]'),reload=root.querySelector('[data-bgm-reload]'),status=root.querySelector('[data-bgm-status]');
  const show=message=>{status.textContent=message;};
  const sync=()=>{enable.checked=engine.bgm.enabled;mute.checked=engine.bgm.muted;volume.value=engine.bgm.volume;};
  const enabled=async()=>{try {show('BGM読込中…');await engine.setBgmEnabled(enable.checked);sync();show(engine.bgm.enabled?'BGM有効':'BGM無効');}catch(error){sync();show('BGM読込失敗：'+error.message);}};
  const level=()=>engine.setBgmVolume(volume.value),muted=()=>engine.setBgmMuted(mute.checked);
  const refresh=async()=>{reload.disabled=true;try{show('BGM再読込中…');await engine.reloadBgmManifest();show(engine.bgm.pendingBank?'再読込済み・曲の復帰点で交換':'BGM再読込済み');}catch(error){show('BGM差替え失敗（既存素材を維持）：'+error.message);}finally{reload.disabled=false;sync();}};
  enable.addEventListener('change',enabled);volume.addEventListener('input',level);mute.addEventListener('change',muted);reload.addEventListener('click',refresh);sync();show(engine.bgm.enabled?'BGM有効':'BGM無効');
  return ()=>{enable.removeEventListener('change',enabled);volume.removeEventListener('input',level);mute.removeEventListener('change',muted);reload.removeEventListener('click',refresh);};
}
