// Decides where every file lives. Nothing is written to the system drive unless no other drive exists.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const t = path.join(dir, `.w${process.pid}`);
    fs.writeFileSync(t, '1');
    fs.unlinkSync(t);
    return true;
  } catch (_) { return false; }
}

function pointerFile() {
  // macOS: never write inside the signed .app bundle
  if (process.platform === 'darwin' && app.isPackaged) return path.join(app.getPath('appData'), 'Posting Assistant', 'location.json');
  const base = app.isPackaged ? path.dirname(app.getPath('exe')) : path.join(__dirname, '..', '..');
  if (writable(base)) return path.join(base, 'posting-assistant.location.json');
  return path.join(app.getPath('appData'), 'Posting Assistant', 'location.json');
}

function defaultRoot() {
  if (process.platform === 'darwin' && app.isPackaged) return path.join(os.homedir(), 'Documents', 'Posting Assistant Data');
  // prefer a "Data" folder next to the app when the app is not on the system drive
  const appBase = app.isPackaged ? path.dirname(app.getPath('exe')) : path.join(__dirname, '..', '..', '..');
  const sysDrive = (process.env.SystemDrive || 'C:').toUpperCase();
  if (process.platform !== 'win32' || !path.resolve(appBase).toUpperCase().startsWith(sysDrive)) {
    const d = path.join(appBase, 'Data');
    if (writable(d)) return d;
  }
  if (process.platform === 'win32') {
    const sys = sysDrive;
    for (const d of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
      const drive = `${d}:`;
      if (drive === sys) continue;
      try { if (fs.existsSync(drive + '\\')) return path.join(drive + '\\', 'Posting Assistant Data'); } catch (_) { /* skip */ }
    }
  }
  return path.join(os.homedir(), 'Documents', 'Posting Assistant Data');
}

let cached = null;
function dataRoot() {
  if (cached) return cached;
  if (!app.isPackaged && process.env.PA_DATA_ROOT) { writable(process.env.PA_DATA_ROOT); cached = process.env.PA_DATA_ROOT; return cached; }
  const pf = pointerFile();
  let root = null;
  try { root = JSON.parse(fs.readFileSync(pf, 'utf8')).dataRoot; } catch (_) { /* first run */ }
  if (!root || !writable(root)) {
    root = defaultRoot();
    writable(root);
    try { fs.mkdirSync(path.dirname(pf), { recursive: true }); fs.writeFileSync(pf, JSON.stringify({ dataRoot: root }, null, 2)); } catch (_) { /* ignore */ }
  }
  cached = root;
  return root;
}
function setDataRoot(root) {
  if (!writable(root)) throw new Error('That folder is not writable.');
  fs.writeFileSync(pointerFile(), JSON.stringify({ dataRoot: root }, null, 2));
  cached = root;
}
function sub(...p) {
  const d = path.join(dataRoot(), ...p);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
// guards against escaping the data folder via crafted paths from the renderer
function inside(p) {
  const root = path.resolve(dataRoot());
  const full = path.resolve(p);
  return full === root || full.startsWith(root + path.sep);
}
module.exports = { dataRoot, setDataRoot, sub, inside, isFirstRun: () => !fs.existsSync(path.join(dataRoot(), 'settings.json')) };
