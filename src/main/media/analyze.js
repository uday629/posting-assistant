// Understands a video or image without watching all of it. Levels (the user can pick any, per job or per chat):
//   name  - file name + folder/sidecar notes only (instant)
//   quick - + metadata + 1 frame seen by the vision model
//   smart - + speech-to-text of the first minutes + 4 frames (default)
//   full  - + full speech-to-text + 12 frames
// Results are cached per file (path + size + mtime), so the second time is instant.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ff = require('./ffmpeg');
const whisper = require('./whisper');
const store = require('../store');
const paths = require('../paths');
const providers = require('../llm/providers');
const { parseJson, stripThink } = require('../agent/json');

const LEVEL = { name: 0, quick: 1, smart: 2, full: 3 };
const NOTE_FILES = ['notes.txt', '_notes.txt', 'about.txt', 'info.txt', 'readme.txt', 'series.txt', 'posting.md', '.posting.md', 'notes.md', 'caption.txt'];
const LANG_NAMES = { bn: 'Bangla', en: 'English', hi: 'Hindi', ur: 'Urdu', ar: 'Arabic', es: 'Spanish', fr: 'French', de: 'German', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', id: 'Indonesian', ms: 'Malay', tr: 'Turkish', pt: 'Portuguese', ru: 'Russian', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', ne: 'Nepali', as: 'Assamese' };

function keyFor(file) {
  const st = fs.statSync(file);
  return crypto.createHash('sha1').update(`${path.resolve(file).toLowerCase()}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 20);
}
const cacheDir = (key) => paths.sub('media-cache', key);
function cached(file) {
  try { return store.readJson(path.join(cacheDir(keyFor(file)), 'analysis.json'), null); } catch (_) { return null; }
}
// cache entries not used for 30 days are deleted (checked at most once an hour per run of the app)
const CACHE_DAYS = 30;
let lastPrune = 0;
function pruneCache(now = Date.now(), maxAgeMs = CACHE_DAYS * 86400000, throttle = false) {
  if (throttle && now - lastPrune < 3600000) return 0;
  lastPrune = now;
  let removed = 0;
  try {
    const root = paths.sub('media-cache');
    for (const d of fs.readdirSync(root)) {
      const dir = path.join(root, d);
      try {
        const jf = path.join(dir, 'analysis.json');
        const m = fs.existsSync(jf) ? fs.statSync(jf).mtimeMs : fs.statSync(dir).mtimeMs;
        if (now - m > maxAgeMs) { fs.rmSync(dir, { recursive: true, force: true }); removed++; }
      } catch (_) { /* skip an entry that cannot be read */ }
    }
  } catch (_) { /* no cache folder yet */ }
  return removed;
}
function readSmall(f, max = 4000) { try { const s = fs.readFileSync(f, 'utf8'); return s.slice(0, max).trim(); } catch (_) { return ''; } }

// text that sits next to the file: "<name>.txt/.md", subtitles "<name>.srt/.vtt", and folder notes
function sidecars(file) {
  const dir = path.dirname(file), base = path.basename(file, path.extname(file));
  const out = { fileNotes: '', folderNotes: '', subtitles: '' };
  for (const ext of ['.txt', '.md', '.caption.txt', '.notes.txt']) { const t = readSmall(path.join(dir, base + ext)); if (t) { out.fileNotes = t; break; } }
  for (const ext of ['.srt', '.vtt', '.bn.srt', '.en.srt']) {
    const t = readSmall(path.join(dir, base + ext), 20000);
    if (t) { out.subtitles = t.replace(/^\d+\s*$/gm, '').replace(/^[\d:.,]+\s*-->\s*[\d:.,]+.*$/gm, '').replace(/^WEBVTT.*$/m, '').replace(/<[^>]+>/g, '').replace(/\n{2,}/g, '\n').trim(); break; }
  }
  try {
    const names = fs.readdirSync(dir);
    for (const n of NOTE_FILES) { const hit = names.find((x) => x.toLowerCase() === n); if (hit) { out.folderNotes = readSmall(path.join(dir, hit)); break; } }
  } catch (_) { /* unreadable folder */ }
  return out;
}

const bnRe = /[ঀ-৿]/;
function scriptLang(text) {
  const t = String(text || '');
  const bn = (t.match(/[ঀ-৿]/g) || []).length, lat = (t.match(/[A-Za-z]/g) || []).length;
  if (bn > 5 && bn >= lat * 0.3) return 'bn';
  if (lat > 10) return 'en';
  return null;
}
// whisper prints things like "[Music]" or repeats one line on music-only audio
function cleanTranscript(t) {
  let s = String(t || '').replace(/\[[^\]]{1,40}\]|\([^)]{1,30}\)|♪+/g, ' ').replace(/\s+/g, ' ').trim();
  const words = s.split(' ');
  if (words.length >= 8) {
    const uniq = new Set(words.map((w) => w.toLowerCase()));
    if (uniq.size / words.length < 0.2) return '';
  }
  return s;
}

async function describeFrames(frames, ctx) {
  if (!frames.length) return null;
  if (!providers.roleCanSee('vision')) return { note: 'No vision model set (Models > Vision), frames were not looked at.' };
  const imgs = frames.map((f) => fs.readFileSync(f.file).toString('base64'));
  const batches = [];
  for (let i = 0; i < imgs.length; i += 4) batches.push(imgs.slice(i, i + 4));
  const parts = [];
  for (const [bi, b] of batches.entries()) {
    if (ctx.signal?.aborted) throw new Error('ABORTED');
    ctx.onStep?.(`Looking at frames ${bi * 4 + 1}-${bi * 4 + b.length} of ${imgs.length}`);
    const r = await providers.chat('vision', {
      system: 'You are a precise video analyst for a social media team. Reply with one JSON object only.',
      messages: [{ role: 'user', images: b, text: `These are ${b.length} frames in time order from one ${ctx.kind === 'image' ? 'image post' : 'short video'} named "${ctx.name}".
Return JSON: {"scene": "what is happening, 1-3 sentences", "on_screen_text": "ALL readable text exactly as written (keep Bangla script as Bangla)", "subjects": ["people/objects/products"], "setting": "place", "mood": "tone", "topic": "best guess of the post topic", "text_language": "bn|en|mixed|none"}` }],
      json: true, maxTokens: 700, signal: ctx.signal, temperature: 0.1
    });
    try { parts.push(parseJson(r.text)); } catch (_) { parts.push({ scene: stripThink(r.text).slice(0, 600) }); }
  }
  if (parts.length === 1) return parts[0];
  return {
    scene: parts.map((p, i) => `(${i + 1}) ${p.scene || ''}`).join(' '),
    on_screen_text: [...new Set(parts.map((p) => p.on_screen_text).filter((x) => x && !/^none$/i.test(x)))].join(' | '),
    subjects: [...new Set(parts.flatMap((p) => p.subjects || []))].slice(0, 15),
    setting: parts.map((p) => p.setting).filter(Boolean)[0] || '',
    mood: parts.map((p) => p.mood).filter(Boolean)[0] || '',
    topic: parts.map((p) => p.topic).filter(Boolean)[0] || '',
    text_language: parts.map((p) => p.text_language).filter(Boolean)[0] || ''
  };
}

async function speech(file, info, maxSec, ctx, dir) {
  const s = store.get().transcribe;
  if (s.engine === 'off') return { skipped: 'Speech-to-text is turned off in Settings.' };
  if (!info.hasAudio) return { speech: false, reason: 'no audio track' };
  const loud = await ff.loudness(file, Math.min(120, maxSec || 120), ctx);
  if (loud.max != null && loud.max < -42) return { speech: false, reason: 'silent audio', loudness: loud };
  ctx.onStep?.('Extracting audio');
  const wav = path.join(dir, 'audio.wav');
  await ff.extractAudio(file, wav, maxSec, ctx);
  let r;
  try {
    if (s.engine === 'api') {
      if (!s.provider) return { skipped: 'Pick a speech-to-text API in Models > Speech to text.' };
      ctx.onStep?.('Transcribing speech (API)');
      r = await providers.transcribe(s.provider, s.model, wav, { signal: ctx.signal });
    } else {
      const st = whisper.status();
      if (!st.ready || !st.models.find((m) => m.id === s.localModel && m.installed)) return { skipped: 'Local speech-to-text is not installed yet (Models > Speech to text). Used file name and frames instead.' };
      ctx.onStep?.('Transcribing speech (local whisper)');
      // the GPU build heats the card too: same heat guard as the AI models
      const gpu = require('../llm/gpuguard');
      gpu.acquire();
      try { await gpu.gate(ctx.signal); r = await whisper.transcribe(wav, { model: s.localModel, threads: s.threads, signal: ctx.signal, onProgress: (p) => ctx.onStep?.(`Transcribing speech ${p}%`) }); } finally { gpu.release(); }
    }
  } finally { try { fs.unlinkSync(wav); } catch (_) { /* gone */ } }
  const text = cleanTranscript(r.text);
  const words = text ? text.split(/\s+/).length : 0;
  const lang = (r.language && r.language.length <= 3 ? r.language : null) || scriptLang(text);
  if (words < 3) return { speech: false, reason: 'music or no clear speech', loudness: loud, language: null };
  const segments = (r.segments || []).slice(0, 400).map((g) => ({ t0: Number(g.t0 ?? g.start ?? 0), t1: Number(g.t1 ?? g.end ?? 0), text: String(g.text || '').trim() })).filter((g) => g.text);
  return { speech: true, text: text.slice(0, 12000), language: lang, words, segments, partial: !!maxSec && info.duration > maxSec + 1 };
}

// main entry. opts: {mode, signal, onStep, force}
async function analyze(file, opts = {}) {
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  const settings = store.get();
  const mode = LEVEL[opts.mode] != null ? opts.mode : settings.analysisMode;
  pruneCache(Date.now(), undefined, true);
  // key = path + size + mtime, so an edited or replaced file is a new entry; a cached result is used when it was made
  // at the same or a deeper mode (a deeper brief covers a shallower request), a deeper request re-analyzes
  const key = keyFor(file);
  const dir = cacheDir(key);
  const jf = path.join(dir, 'analysis.json');
  const prev = store.readJson(jf, null);
  if (prev && !opts.force && LEVEL[prev.mode] >= LEVEL[mode] && !prev.incomplete) {
    try { const n = new Date(); fs.utimesSync(jf, n, n); } catch (_) { /* keeps the 30 day clock fresh */ }
    prev.fromCache = true;
    // notes next to the file may have changed since: re-read them (cheap), keep the expensive parts
    Object.assign(prev, sidecars(file));
    prev.language = languageOf(prev, path.basename(file));
    prev.brief = brief(prev);
    return prev;
  }
  const name = path.basename(file);
  const ctx = { ...opts, name, kind: ff.kindOf(file) };
  const res = { file, name, folder: path.basename(path.dirname(file)), mode, analyzedAt: Date.now(), kind: ctx.kind, notes: [] };
  Object.assign(res, sidecars(file));
  const st = fs.statSync(file);
  res.sizeBytes = st.size;
  if (LEVEL[mode] >= LEVEL.quick) {
    opts.onStep?.('Reading file info');
    try { res.info = await ff.probe(file, ctx); } catch (e) { res.notes.push(`Could not read media info: ${e.message}`); res.info = { kind: ctx.kind }; }
    const nFrames = ctx.kind === 'image' ? 1 : mode === 'quick' ? 1 : mode === 'smart' ? settings.framesSmart : settings.framesFull;
    if (ctx.kind !== 'other') {
      try {
        const fr = await ff.frames(file, nFrames, path.join(dir, 'frames'), res.info.duration, ctx);
        res.frames = fr.map((f) => f.file);
        res.visual = await describeFrames(fr, ctx);
      } catch (e) { if (e.message === 'ABORTED') throw e; res.notes.push(`Frames: ${e.message}`); res.incomplete = true; }
    }
    if (LEVEL[mode] >= LEVEL.smart && ctx.kind === 'video') {
      if (res.subtitles) res.audio = { speech: true, text: res.subtitles.slice(0, 12000), language: scriptLang(res.subtitles), source: 'subtitle file' };
      else {
        try { res.audio = await speech(file, res.info, mode === 'full' ? 0 : settings.transcribeMaxSecSmart, ctx, dir); }
        catch (e) { if (e.message === 'ABORTED') throw e; res.notes.push(`Speech: ${e.message}`); res.incomplete = true; }
        if (res.audio?.skipped) res.notes.push(res.audio.skipped);
      }
    }
  }
  // language of the post: speech first, then on-screen text, then file name / notes
  res.language = languageOf(res, name);
  res.hasSpeech = !!res.audio?.speech;
  res.brief = brief(res);
  store.atomicWrite(jf, JSON.stringify(res, null, 2));
  return res;
}

// speech first, then the user's notes, then on-screen text, then a Bangla file name. Unknown -> null (writer defaults to Bangla)
function languageOf(res, name) {
  if (res.audio?.speech && res.audio.language) return res.audio.language;
  const notes = scriptLang(`${res.fileNotes} ${res.folderNotes}`);
  if (notes === 'bn') return 'bn';
  const vt = res.visual?.text_language;
  if (vt && vt !== 'none' && res.visual?.on_screen_text && res.visual.on_screen_text.replace(/[\d\s:.,]/g, '').length > 6) return vt;
  if (scriptLang(name) === 'bn') return 'bn';
  // notes written in Banglish (Bangla in Roman letters) still mean a Bangla post
  const words = `${res.fileNotes} ${res.folderNotes}`.toLowerCase().match(/[a-z]+/g) || [];
  const BANGLISH = new Set(['ami', 'amar', 'amra', 'apni', 'tumi', 'ei', 'oi', 'ki', 'kore', 'korte', 'korchi', 'koro', 'hobe', 'theke', 'jonno', 'ar', 'na', 'dekhacchi', 'dekho', 'bhai', 'video', 'r', 'er', 'e', 'te', 'kivabe', 'koto', 'valo', 'bhalo', 'shob', 'sob', 'ache', 'nai', 'diye', 'niye']);
  const hits = words.filter((w) => BANGLISH.has(w) && !['video', 'e', 'r'].includes(w)).length;
  if (words.length && hits >= Math.max(2, words.length * 0.12)) return 'bn';
  return notes || null;
}

// compact text for prompts
function brief(a) {
  const L = [];
  L.push(`File: ${a.name} (folder "${a.folder}")${a.info?.duration ? `, ${Math.round(a.info.duration)} s` : ''}${a.info?.orientation && a.info.orientation !== 'unknown' ? `, ${a.info.orientation}` : ''}${a.kind === 'image' ? ', image' : ''}`);
  if (a.info?.tags && Object.keys(a.info.tags).length) L.push(`Embedded tags: ${Object.entries(a.info.tags).map(([k, v]) => `${k}=${v}`).join('; ')}`);
  if (a.fileNotes) L.push(`Notes for this file (from the user, follow them): ${a.fileNotes}`);
  if (a.folderNotes) L.push(`Folder notes (from the user): ${a.folderNotes}`);
  if (a.visual && !a.visual.note) {
    const v = a.visual;
    L.push(`What is seen: ${v.scene || ''}${v.setting ? ` Setting: ${v.setting}.` : ''}${v.mood ? ` Mood: ${v.mood}.` : ''}${v.subjects?.length ? ` Subjects: ${v.subjects.join(', ')}.` : ''}${v.topic ? ` Topic guess: ${v.topic}.` : ''}`);
    if (v.on_screen_text && !/^none$/i.test(v.on_screen_text)) L.push(`On-screen text: ${v.on_screen_text}`);
  }
  if (a.audio?.speech) L.push(`Speech (${LANG_NAMES[a.audio.language] || a.audio.language || 'unknown language'}${a.audio.partial ? ', first part only' : ''}${a.audio.source ? `, from ${a.audio.source}` : ''}): ${a.audio.text.slice(0, 3500)}`);
  else if (a.audio && !a.audio.skipped) L.push(`Audio: no speech (${a.audio.reason || 'none'}). Write the caption from visuals and notes.`);
  L.push(`Detected post language: ${a.language ? LANG_NAMES[a.language] || a.language : 'unknown'}`);
  return L.join('\n');
}

module.exports = { analyze, cached, pruneCache, brief, LEVEL, LANG_NAMES, scriptLang, keyFor, bnRe };
