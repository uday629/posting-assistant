// Local speech-to-text with whisper.cpp. Downloads the official Windows build from GitHub releases and a ggml model
// from Hugging Face into the data folder (never the system drive). Auto-detects the spoken language (Bangla, English...).
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const os = require('os');
const paths = require('../paths');

const MODELS = {
  'tiny': { file: 'ggml-tiny.bin', mb: 78, note: 'Fastest, weak for Bangla' },
  'base': { file: 'ggml-base.bin', mb: 148, note: 'Fast, weak for Bangla' },
  'small': { file: 'ggml-small.bin', mb: 488, note: 'Good balance' },
  'medium': { file: 'ggml-medium.bin', mb: 1530, note: 'Better accuracy, slower' },
  'large-v3-turbo-q5_0': { file: 'ggml-large-v3-turbo-q5_0.bin', mb: 574, note: 'Recommended: best for Bangla per MB, fast' },
  'large-v3-turbo': { file: 'ggml-large-v3-turbo.bin', mb: 1620, note: 'Full precision turbo' },
  'large-v3': { file: 'ggml-large-v3.bin', mb: 3100, note: 'Most accurate, slow on CPU' }
};
const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
const ASSET = { cpu: /^whisper-blas-bin-x64\.zip$|^whisper-bin-x64\.zip$/i, cuda: /^whisper-bin-win-cuda-12[\d.]*-x64\.zip$|cublas-12.*x64\.zip$/i };

// the user can move the speech engine and its models to any folder (Models > Speech to text)
const custom = () => require('../store').get().transcribe || {};
const dir = () => { const d = custom().dir; if (d) { require('fs').mkdirSync(d, { recursive: true }); return d; } return paths.sub('tools', 'whisper'); };
const modelsDir = () => { const d = require('path').join(dir(), 'models'); require('fs').mkdirSync(d, { recursive: true }); return d; };

function findExe(root = dir()) {
  if (process.platform !== 'win32') {
    // macOS/Linux: whisper.cpp is installed by the user (brew install whisper.cpp), the binary is whisper-cli
    for (const c of ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli']) if (fs.existsSync(c)) return c;
    return null;
  }
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (e.isDirectory() && e.name !== 'models') stack.push(full);
      else if (/^whisper-cli\.exe$/i.test(e.name)) return full;
    }
  }
  // older builds name it main.exe
  const stack2 = [root];
  while (stack2.length) {
    const d = stack2.pop();
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (e.isDirectory() && e.name !== 'models') stack2.push(full);
      else if (/^main\.exe$/i.test(e.name)) return full;
    }
  }
  return null;
}
function variantOf(exe) { try { return fs.readFileSync(path.join(dir(), 'variant.txt'), 'utf8').trim(); } catch (_) { return exe ? 'cpu' : null; } }
function modelPath(name) {
  if (name === 'custom') return custom().customModelPath || null;
  const m = MODELS[name];
  return m ? path.join(modelsDir(), m.file) : null;
}

function status() {
  const exe = findExe();
  const installed = Object.keys(MODELS).filter((k) => { try { return fs.statSync(modelPath(k)).size > 1e6; } catch (_) { return false; } });
  const cm = custom().customModelPath;
  const models = Object.entries(MODELS).map(([id, m]) => ({ id, ...m, installed: installed.includes(id) }));
  if (cm) models.push({ id: 'custom', file: path.basename(cm), mb: Math.round((fs.existsSync(cm) ? fs.statSync(cm).size : 0) / 1048576), note: `your file: ${cm}`, installed: fs.existsSync(cm) });
  return { exe, ready: !!exe, variant: variantOf(exe), models, dir: dir(), modelsDir: modelsDir() };
}

async function download(url, dest, onProgress, label, signal) {
  const res = await fetch(url, { redirect: 'follow', signal, headers: { 'user-agent': 'PostingAssistant' } });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${label}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const tmp = `${dest}.part`;
  const out = fs.createWriteStream(tmp);
  let done = 0, last = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      done += value.length;
      if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
      if (Date.now() - last > 300) { last = Date.now(); onProgress?.({ status: `Downloading ${label}`, total, completed: done }); }
    }
  } catch (e) { out.destroy(); try { fs.unlinkSync(tmp); } catch (_) { /* gone */ } throw e; }
  await new Promise((r) => out.end(r));
  fs.renameSync(tmp, dest);
}

function unzip(zip, to) {
  return new Promise((resolve, reject) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${to.replace(/'/g, "''")}' -Force`],
      { windowsHide: true, timeout: 300000 }, (err, _o, se) => (err ? reject(new Error(String(se || err.message).slice(0, 300))) : resolve()));
  });
}

// finds the newest GitHub release that has the wanted Windows asset (recent tags sometimes ship no binaries)
async function findAsset(variant) {
  const res = await fetch('https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=15', { headers: { 'user-agent': 'PostingAssistant', accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub releases: ${res.status} ${res.status === 403 ? '(rate limited, try again in an hour)' : ''}`);
  const list = await res.json();
  const re = ASSET[variant] || ASSET.cpu;
  for (const r of list) {
    const assets = r.assets || [];
    // prefer the BLAS build for CPU (faster), else the plain one
    const a = variant === 'cpu' ? assets.find((x) => /^whisper-blas-bin-x64\.zip$/i.test(x.name)) || assets.find((x) => /^whisper-bin-x64\.zip$/i.test(x.name)) : assets.find((x) => re.test(x.name));
    if (a) return { url: a.browser_download_url, name: a.name, tag: r.tag_name, size: a.size };
  }
  throw new Error('No Windows whisper.cpp build found in recent releases.');
}

async function install({ variant = 'cpu', model = 'large-v3-turbo-q5_0' } = {}, onProgress, signal) {
  const st = status();
  if (process.platform !== 'win32' && !st.exe) throw new Error('On a Mac, install the speech engine first: open Terminal and run "brew install whisper.cpp", then press Refresh here.');
  if (process.platform === 'win32' && (!st.exe || (variant !== st.variant))) {
    const a = await findAsset(variant);
    const zip = path.join(paths.sub('downloads'), a.name);
    await download(a.url, zip, onProgress, `whisper.cpp ${a.tag} (${variant.toUpperCase()})`, signal);
    onProgress?.({ status: 'Unpacking whisper.cpp...' });
    const binDir = path.join(dir(), 'bin');
    try { fs.rmSync(binDir, { recursive: true, force: true }); } catch (_) { /* fresh */ }
    await unzip(zip, binDir);
    try { fs.unlinkSync(zip); } catch (_) { /* keep */ }
    fs.writeFileSync(path.join(dir(), 'variant.txt'), variant);
    if (!findExe()) throw new Error('whisper.cpp was downloaded but whisper-cli.exe was not found in it.');
  }
  await installModel(model, onProgress, signal);
  onProgress?.({ status: 'success' });
  return status();
}
async function installModel(model, onProgress, signal) {
  const m = MODELS[model];
  if (!m) throw new Error(`Unknown whisper model ${model}`);
  const dest = modelPath(model);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1e6) return;
  await download(HF + m.file, dest, onProgress, `speech model ${model} (${m.mb} MB)`, signal);
}
function removeModel(model) { const p = modelPath(model); if (p && fs.existsSync(p)) fs.unlinkSync(p); return status(); }

// returns {text, language, segments:[{t0,t1,text}]}
async function transcribe(wav, { model = 'large-v3-turbo-q5_0', language = 'auto', threads = 0, signal, onProgress } = {}) {
  const exe = findExe();
  if (!exe) throw new Error('Local speech-to-text is not installed. Open Models > Speech to text and click Install.');
  const mp = modelPath(model);
  if (!mp || !fs.existsSync(mp)) throw new Error(`Speech model "${model}" is not downloaded. Open Models > Speech to text.`);
  const outBase = wav.replace(/\.wav$/i, '');
  const th = threads || Math.max(2, Math.min(8, os.cpus().length - 2));
  const args = ['-m', mp, '-f', wav, '-l', language || 'auto', '-oj', '-of', outBase, '-t', String(th), '-pp'];
  const runOnce = (extra = []) => new Promise((resolve, reject) => {
    const p = spawn(exe, [...args, ...extra], { windowsHide: true, cwd: path.dirname(exe) });
    let err = '';
    const onAbort = () => { p.kill(); reject(new Error('ABORTED')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    const onData = (d) => {
      const s = String(d);
      if (err.length < 200000) err += s;
      const m = /progress\s*=\s*(\d+)%/.exec(s);
      if (m) onProgress?.(Number(m[1]));
    };
    p.stderr.on('data', onData);
    p.stdout.on('data', onData);
    p.on('error', reject);
    p.on('close', (code) => { signal?.removeEventListener('abort', onAbort); resolve({ code, err }); });
  });
  let r = await runOnce();
  // a GPU build that cannot start on this card: retry on the CPU
  if (r.code !== 0 && /cuda|gpu|ggml_cuda|no kernel image/i.test(r.err)) r = await runOnce(['-ng']);
  if (r.code !== 0) throw new Error(`whisper.cpp failed: ${r.err.split(/\r?\n/).filter(Boolean).slice(-2).join(' ').slice(0, 300)}`);
  let json = null;
  try { json = JSON.parse(fs.readFileSync(`${outBase}.json`, 'utf8')); } catch (_) { /* fall back to stderr */ }
  const segs = (json?.transcription || []).map((s) => ({ t0: (s.offsets?.from || 0) / 1000, t1: (s.offsets?.to || 0) / 1000, text: String(s.text || '').trim() }));
  const det = /auto-detected language:\s*([a-z]{2,3})\s*\(p\s*=\s*([\d.]+)\)/i.exec(r.err);
  const language2 = json?.result?.language || (det ? det[1] : null);
  try { fs.unlinkSync(`${outBase}.json`); } catch (_) { /* gone */ }
  return { text: segs.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim(), language: language2, confidence: det ? Number(det[2]) : null, segments: segs };
}

module.exports = { MODELS, status, install, installModel, removeModel, transcribe, findAsset };
