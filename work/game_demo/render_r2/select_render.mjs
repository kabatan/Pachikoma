// Keep the play entry point small so audio/tray integration stays independent.
import { connectLayerPack } from '../play/render_bridge.mjs';
import { Gen } from '../web/src/dummy.mjs';

export async function connectRender(hr, query, legacyUrl) {
  const r2Url = new URL('./data/pack/manifest.json', import.meta.url).href;
  const requestedR2 = query.get('render') !== 'legacy';
  const packUrl = query.has('pack') ? query.get('pack') : requestedR2 ? r2Url : legacyUrl;
  const nativePack = !!packUrl && new URL(packUrl, location.href).href === r2Url;
  const options = { dummyEntries: Gen.makeLayerManifest(12, { seed: 1 }) };
  let pack, manifest, mode = requestedR2 ? 'r2' : 'legacy';
  try {
    if (nativePack) {
      const response = await fetch(r2Url);
      if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
      manifest = await response.json();
    }
    pack = await connectLayerPack(hr, packUrl, options);
    if (requestedR2) await (await import('./profile.mjs')).installRenderR2(hr, { nativePack, trimBox:manifest?.render_r2?.trim?.box });
  } catch (error) {
    if (!requestedR2 || !nativePack) throw error;
    // Missing manifest/layers/detail/probes must not leave a half-loaded pack.
    pack = await connectLayerPack(hr, legacyUrl, options);
    mode = 'legacy-fallback';
    console.warn(`[render] R2 pack unavailable; using stage2c: ${String(error.message).replace(/\s+/g, ' ')}`);
  }
  pack.info.render = { mode, nativePack: mode === 'r2' && nativePack };
  return pack;
}
