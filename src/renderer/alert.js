/* global alertApi */
let view = 'monitor';
let actx = null;
function beep(level) {
  try {
    const ctx = actx || (actx = new AudioContext());
    const tones = level === 'error' ? [880, 660, 880] : [660, 990];
    tones.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.type = level === 'error' ? 'square' : 'sine';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.22);
      g.gain.linearRampToValueAtTime(0.08, ctx.currentTime + i * 0.22 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.22 + 0.2);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + i * 0.22); o.stop(ctx.currentTime + i * 0.22 + 0.25);
    });
  } catch (_) { /* no audio */ }
}
alertApi.onShow((a) => {
  document.body.className = a.level || 'error';
  document.getElementById('t').textContent = a.title || 'Posting Assistant';
  document.getElementById('x').textContent = a.text || '';
  view = a.view || 'monitor';
  if (a.sound !== false) beep(a.level);
});
document.getElementById('d').onclick = () => alertApi.close();
document.getElementById('o').onclick = () => alertApi.open(view);
