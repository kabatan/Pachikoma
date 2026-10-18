// Event-only display control. Never resize the canvas or touch the game/serial lifecycle.
const MODES = ['normal', 'portrait', 'portrait-flip'];
const STORAGE_KEY = 'pachikoma.display';
const root = document.documentElement;
let saved;
try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* Private/blocked storage. */ }
const requested = new URLSearchParams(location.search).get('display');
let mode = MODES.includes(requested) ? requested : MODES.includes(saved) ? saved : 'normal';
let entering = false;

function apply() {
  root.dataset.display = mode;
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* Keep the in-memory mode. */ }
}

async function leaveFullscreen() {
  try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* Browser policy. */ }
}

async function enterFullscreen() {
  if (mode === 'normal' || document.fullscreenElement || entering || !root.requestFullscreen) return;
  entering = true;
  try {
    // Called synchronously from a trusted gesture; restored modes wait for that gesture.
    await root.requestFullscreen({ navigationUI: 'hide' });
    if (mode === 'normal') await leaveFullscreen(); // A rapid K cycle may have finished meanwhile.
  } catch { /* Retry on the next gesture when fullscreen is denied/unavailable. */ }
  finally { entering = false; }
}

apply();
window.addEventListener('keydown', event => {
  if (!event.isTrusted || event.repeat || event.isComposing) return;
  const editing = event.target?.closest?.('input:not([type="range"]):not([type="checkbox"]):not([type="radio"]),textarea,select,[contenteditable]:not([contenteditable="false"])');
  if (event.code === 'KeyK' && !editing && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
    event.preventDefault();
    mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    apply();
    if (mode === 'normal') { void leaveFullscreen(); return; }
  }
  // play.mjs already handles F. Avoid two fullscreen requests from one gesture.
  if (event.code !== 'Escape' && event.code !== 'KeyF') void enterFullscreen();
}, { capture: true });
window.addEventListener('pointerdown', event => {
  if (event.isTrusted) void enterFullscreen();
}, { capture: true });
