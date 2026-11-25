// ffmpeg helpers: probe a media file, measure loudness, pull frames and a 16 kHz mono WAV for speech-to-text.
// ffmpeg ships inside the app (ffmpeg-static), so nothing has to be installed.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let bin = null;
function ffmpegPath() {
  if (bin) return bin;
  let p = null;
  try { p = require('ffmpeg-static'); } catch (_) { /* not bundled */ }
  if (p) p = p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  bin = p && fs.existsSync(p) ? p : 'ffmpeg';
  return bin;
}

function run(args, { signal, timeout = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', ...args], { windowsHide: true });
    let err = '';
    const t = setTimeout(() => { p.kill(); reject(new Error('ffmpeg timed out')); }, timeout);
    const onAbort = () => { p.kill(); reject(new Error('ABORTED')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    p.stderr.on('data', (d) => { if (err.length < 400000) err += d; });
    p.stdout.on('data', () => {});
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); signal?.removeEventListener('abort', onAbort); resolve({ code, err }); });
  });
}

const VIDEO = /\.(mp4|mov|m4v|mkv|webm|avi|wmv|flv|mpg|mpeg|3gp|ts)$/i;
const IMAGE = /\.(jpe?g|png|webp|gif|bmp|heic|heif|tiff?)$/i;
const kindOf = (f) => (VIDEO.test(f) ? 'video' : IMAGE.test(f) ? 'image' : 'other');

// reads duration, size, fps, audio presence and container tags from ffmpeg's banner
async function probe(file, opts) {
  const { err } = await run(['-i', file], opts);
  const info = { kind: kindOf(file), duration: 0, width: 0, height: 0, fps: 0, hasAudio: false, tags: {} };
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
  if (d) info.duration = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
  const v = /Stream #\S+.*?Video:.*?(\d{2,5})x(\d{2,5})/.exec(err);
  if (v) { info.width = Number(v[1]); info.height = Number(v[2]); }
  const rot = /rotate\s*:\s*(-?\d+)|displaymatrix: rotation of (-?[\d.]+)/.exec(err);
  if (rot && Math.abs(Number(rot[1] || rot[2])) % 180 === 90) [info.width, info.height] = [info.height, info.width];
  const f = /(\d+(?:\.\d+)?)\s*fps/.exec(err);
  if (f) info.fps = Number(f[1]);
  info.hasAudio = /Stream #\S+.*?Audio:/.test(err);
  for (const m of err.matchAll(/^\s{4}(title|comment|description|artist|album|genre|keywords|synopsis)\s*:\s*(.+)$/gim)) {
    if (!info.tags[m[1].toLowerCase()]) info.tags[m[1].toLowerCase()] = m[2].trim().slice(0, 500);
  }
  if (info.kind === 'video' && !info.width && !info.duration) throw new Error('This file could not be read as a video.');
  info.orientation = info.width && info.height ? (info.height > info.width * 1.1 ? 'vertical' : info.width > info.height * 1.1 ? 'horizontal' : 'square') : 'unknown';
  return info;
}

// mean/max volume in dB over the first part of the audio, used to tell "no speech, only silence/music" quickly
async function loudness(file, seconds = 90, opts) {
  const { err } = await run(['-t', String(seconds), '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], opts);
  const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(err);
  const max = /max_volume:\s*(-?[\d.]+) dB/.exec(err);
  return { mean: mean ? Number(mean[1]) : null, max: max ? Number(max[1]) : null };
}

async function extractAudio(file, out, maxSec, opts) {
  const args = ['-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le'];
  if (maxSec) args.unshift('-t', String(maxSec));
  args.push(out);
  const r = await run(args, opts);
  if (!fs.existsSync(out) || fs.statSync(out).size < 2000) throw new Error(`Could not extract audio (${r.err.split(/\r?\n/).filter(Boolean).pop() || 'unknown error'})`);
  return out;
}

// n evenly spaced frames (skipping the very start/end), 640 px wide JPEGs
async function frames(file, n, outDir, duration, opts) {
  fs.mkdirSync(outDir, { recursive: true });
  const out = [];
  if (kindOf(file) === 'image') {
    const f = path.join(outDir, 'img.jpg');
    await run(['-y', '-i', file, '-frames:v', '1', '-vf', 'scale=w=min(960\\,iw):h=-2', '-q:v', '4', f], opts);
    if (fs.existsSync(f)) out.push({ t: 0, file: f });
    return out;
  }
  const dur = Math.max(0.5, duration || 1);
  const times = [];
  for (let i = 0; i < n; i++) times.push(Math.max(0, Math.min(dur - 0.2, dur * (0.06 + (0.88 * i) / Math.max(1, n - 1)))));
  if (n === 1) times[0] = Math.min(dur * 0.3, dur - 0.2);
  for (const [i, t] of times.entries()) {
    const f = path.join(outDir, `f${String(i).padStart(2, '0')}.jpg`);
    await run(['-y', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-vf', 'scale=w=min(640\\,iw):h=-2', '-q:v', '5', f], opts);
    if (fs.existsSync(f)) out.push({ t, file: f });
  }
  return out;
}

// times (seconds) where the picture changes a lot: cut points, used to measure the pacing of a clip
async function sceneCuts(file, threshold = 0.32, opts) {
  const { err } = await run(['-i', file, '-an', '-vf', `select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-'], opts);
  return [...err.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1])).filter((t) => !isNaN(t));
}

module.exports = { sceneCuts, ffmpegPath, probe, loudness, extractAudio, frames, kindOf, VIDEO, IMAGE, run };
