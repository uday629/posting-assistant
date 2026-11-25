// Ollama lifecycle: find/install the app, start it, model storage folder, import GGUF files or an existing model folder.
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const paths = require('../paths');
const store = require('../store');

const BASE = 'http://127.0.0.1:11434';
const INSTALLER_URL = 'https://ollama.com/download/OllamaSetup.exe';

function run(cmd, args, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || err?.message || '') }));
  });
}

const MAC = process.platform === 'darwin';
function candidates() {
  const list = [];
  const s = store.get();
  if (MAC) return ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', '/Applications/Ollama.app/Contents/Resources/ollama'];
  if (s.ollamaDir) list.push(path.join(s.ollamaDir, 'ollama.exe'));
  if (process.env.LOCALAPPDATA) list.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'));
  list.push('C:\\Program Files\\Ollama\\ollama.exe');
  for (const d of 'DEFGHI') list.push(`${d}:\\Programs\\Ollama\\ollama.exe`, `${d}:\\Ollama\\ollama.exe`);
  return list;
}
async function findExe() {
  for (const c of candidates()) if (fs.existsSync(c)) return c;
  if (MAC) return null;
  const w = await run('where', ['ollama']);
  const first = w.out.split(/\r?\n/).find((l) => l.trim().toLowerCase().endsWith('.exe'));
  return first ? first.trim() : null;
}

async function status() {
  let running = false, version = null;
  try {
    const r = await fetch(`${BASE}/api/version`, { signal: AbortSignal.timeout(2500) });
    if (r.ok) { running = true; version = (await r.json()).version; }
  } catch (_) { /* not running */ }
  const exe = await findExe();
  return { running, version, installed: !!exe || running, exe, modelsDir: await modelsDir() };
}

// OLLAMA_MODELS from the user/machine environment (the running app may have an older copy)
async function modelsDir() {
  if (MAC) return { path: process.env.OLLAMA_MODELS || path.join(require('os').homedir(), '.ollama', 'models'), source: process.env.OLLAMA_MODELS ? 'environment variable' : 'default' };
  for (const hive of ['HKCU\\Environment', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment']) {
    const r = await run('reg', ['query', hive, '/v', 'OLLAMA_MODELS']);
    const m = /OLLAMA_MODELS\s+REG_\w+\s+(.+)/i.exec(r.out);
    if (m) return { path: m[1].trim(), source: 'environment variable' };
  }
  const fromLog = serverLogModels();
  if (fromLog) return { path: fromLog, source: 'set in the Ollama app settings' };
  const def = path.join(require('os').homedir(), '.ollama', 'models');
  return { path: def, source: 'default' };
}
// the Ollama desktop app keeps its own "model location" setting; the server prints the folder it uses in server.log
function serverLogModels() {
  try {
    const f = path.join(process.env.LOCALAPPDATA || '', 'Ollama', 'server.log');
    const st = fs.statSync(f);
    const fd = fs.openSync(f, 'r');
    // the server prints its config once at start (top of the file); a restart may append it again (tail)
    const n = Math.min(st.size, 262144);
    const head = Buffer.alloc(n);
    fs.readSync(fd, head, 0, n, 0);
    const tail = Buffer.alloc(n);
    fs.readSync(fd, tail, 0, n, st.size - n);
    fs.closeSync(fd);
    const all = [...(head.toString('utf8') + '\n' + tail.toString('utf8')).matchAll(/OLLAMA_MODELS:(.*?) OLLAMA_[A-Z_]+:/g)];
    const v = all.length ? all[all.length - 1][1].replace(/\\\\/g, '\\').trim() : '';
    return v || null;
  } catch (_) { return null; }
}

async function start() {
  const st = await status();
  if (st.running) return st;
  const exe = st.exe || (await findExe());
  if (!exe) throw new Error('Ollama is not installed.');
  const appExe = path.join(path.dirname(exe), 'ollama app.exe');
  const child = !MAC && fs.existsSync(appExe)
    ? spawn(appExe, [], { detached: true, stdio: 'ignore', windowsHide: true })
    : spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const s = await status();
    if (s.running) return s;
  }
  throw new Error('Ollama did not start within 30 seconds.');
}
async function stop() {
  if (MAC) { await run('pkill', ['-x', 'ollama']); return; }
  await run('taskkill', ['/F', '/IM', 'ollama app.exe']);
  await run('taskkill', ['/F', '/IM', 'ollama.exe']);
}

// Downloads the official installer into the data folder and runs it silently into the chosen folder.
async function install(dir, onProgress) {
  if (MAC) throw new Error('Automatic install is Windows only. On a Mac, download Ollama from https://ollama.com/download, open it once, then press Refresh here.');
  const dl = paths.sub('downloads');
  const file = path.join(dl, 'OllamaSetup.exe');
  onProgress?.({ status: 'Downloading Ollama installer...' });
  const res = await fetch(INSTALLER_URL);
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(file);
  let done = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    done += value.length;
    if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
    onProgress?.({ status: 'Downloading Ollama installer...', total, completed: done });
  }
  await new Promise((r) => out.end(r));
  onProgress?.({ status: 'Installing Ollama...' });
  const args = ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'];
  if (dir) { fs.mkdirSync(dir, { recursive: true }); args.push(`/DIR=${dir}`); }
  await new Promise((resolve, reject) => {
    const p = spawn(file, args, { windowsHide: true });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Installer exited with code ${code}`))));
  });
  if (dir) store.update({ ollamaDir: dir });
  onProgress?.({ status: 'Starting Ollama...' });
  try { await start(); } catch (_) { /* user can start it manually */ }
  onProgress?.({ status: 'success' });
  return status();
}

// Points Ollama at a folder of models (new empty folder, or an existing Ollama "models" folder from another drive/PC)
async function setModelsDir(dir) {
  if (!dir) throw new Error('Choose a folder.');
  fs.mkdirSync(dir, { recursive: true });
  if (!MAC) {
    const r = await run('setx', ['OLLAMA_MODELS', dir]);
    if (!r.ok) throw new Error(r.err || 'Could not set OLLAMA_MODELS');
  }
  process.env.OLLAMA_MODELS = dir;
  const was = (await status()).running;
  if (was) {
    await stop();
    await new Promise((res) => setTimeout(res, 1500));
    // start with the new variable (child inherits our env)
    try { await start(); } catch (_) { /* ignore */ }
    await new Promise((res) => setTimeout(res, 1500));
    const used = serverLogModels();
    if (used && path.resolve(used).toLowerCase() !== path.resolve(dir).toLowerCase()) {
      throw new Error(`The Ollama app has its own "Model location" setting and still uses ${used}. Open Ollama from the tray > Settings and set the model location to ${dir}.`);
    }
  }
  return status();
}

function looksLikeOllamaStore(dir) {
  return fs.existsSync(path.join(dir, 'manifests')) && fs.existsSync(path.join(dir, 'blobs'));
}
// Scans a folder for things that can be used: an Ollama store, .gguf files, LM Studio style folders.
function scanFolder(dir, maxDepth = 4) {
  const found = { ollamaStore: null, gguf: [] };
  const walk = (d, depth) => {
    if (depth > maxDepth || found.gguf.length > 200) return;
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    if (!found.ollamaStore && looksLikeOllamaStore(d)) found.ollamaStore = d;
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (!/^(blobs|node_modules|\$Recycle\.Bin|Windows)$/i.test(e.name)) walk(full, depth + 1); }
      else if (/\.gguf$/i.test(e.name) && !/mmproj/i.test(e.name)) {
        let size = 0;
        try { size = fs.statSync(full).size; } catch (_) { /* skip */ }
        const dirFiles = ents.filter((x) => /mmproj.*\.gguf$/i.test(x.name)).map((x) => path.join(d, x.name));
        found.gguf.push({ path: full, size, mmproj: dirFiles[0] || null });
      }
    }
  };
  walk(dir, 0);
  return found;
}

// Registers a .gguf file in Ollama under a name (Ollama copies it into its store).
async function importGguf(file, name, onProgress) {
  const st = await status();
  if (!st.running) await start();
  const exe = st.exe || (await findExe());
  if (!exe) throw new Error('Ollama is not installed.');
  const clean = String(name || path.basename(file, '.gguf')).toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').slice(0, 60);
  const mf = path.join(paths.sub('modelfiles'), `${clean.replace(/:/g, '_')}.Modelfile`);
  fs.writeFileSync(mf, `FROM "${file}"\n`);
  onProgress?.({ status: `Importing ${path.basename(file)} as ${clean}...` });
  await new Promise((resolve, reject) => {
    const p = spawn(exe, ['create', clean, '-f', mf], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; onProgress?.({ status: String(d).trim().split(/\r?\n/).pop() }); });
    p.stdout.on('data', (d) => onProgress?.({ status: String(d).trim().split(/\r?\n/).pop() }));
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split(/\r?\n/).pop() || `ollama create failed (${code})`))));
  });
  onProgress?.({ status: 'success' });
  return clean;
}

module.exports = { BASE, status, start, stop, install, setModelsDir, scanFolder, importGguf, findExe };
