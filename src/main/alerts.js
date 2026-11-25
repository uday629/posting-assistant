// Red pop-up in the corner of the screen (also when the app is minimized or in the tray) for problems that need the
// user: a failed post, a login or captcha page, a GPU that is too hot. Orange for approvals.
const path = require('path');
const { BrowserWindow, screen, ipcMain } = require('electron');

let win = null;
let queue = [];
let onOpen = null;
let ready = false;

function ensure() {
  if (win && !win.isDestroyed()) return win;
  const wa = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width: 400, height: 168, x: wa.x + wa.width - 416, y: wa.y + wa.height - 184, frame: false, resizable: false, movable: true,
    alwaysOnTop: true, skipTaskbar: true, show: false, transparent: false, backgroundColor: '#1a0b10', focusable: true,
    webPreferences: { preload: path.join(__dirname, 'alert-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'alert.html'));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  ready = false;
  win.on('closed', () => { win = null; ready = false; });
  win.webContents.once('did-finish-load', () => { ready = true; flush(); });
  return win;
}
function flush() {
  if (!win || win.isDestroyed() || !ready || !queue.length) return;
  const a = queue.shift();
  win.webContents.send('alert:show', a);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.showInactive();
  win.moveTop();
}
// quiet hours: only sounds, pop-ups and notifications are silenced, jobs keep running
function isQuiet(settings, now = new Date()) {
  const q = settings && settings.quietHours;
  if (!q || !q.enabled) return false;
  const mins = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const a = mins(q.start), b = mins(q.end);
  if (a == null || b == null || a === b) return false;
  const n = now.getHours() * 60 + now.getMinutes();
  return a < b ? n >= a && n < b : n >= a || n < b;
}
let quietFn = null; // set by main.js: () => boolean
function setQuietCheck(fn) { quietFn = fn; }

// level: 'error' (red) | 'warn' (orange) | 'ok'
function show({ title, text, level = 'error', view = 'monitor' }) {
  if (quietFn) { try { if (quietFn()) return; } catch (_) { /* show it */ } }
  queue = queue.filter((q) => q.text !== text).slice(-4);
  queue.push({ title: String(title).slice(0, 80), text: String(text || '').slice(0, 300), level, view, at: Date.now() });
  ensure();
  flush();
}
function init(openApp) {
  onOpen = openApp;
  ipcMain.on('alert:close', () => { if (queue.length) flush(); else if (win && !win.isDestroyed()) win.hide(); });
  ipcMain.on('alert:open', (_e, view) => { if (win && !win.isDestroyed()) win.hide(); queue = []; onOpen?.(typeof view === 'string' ? view : 'monitor'); });
}

module.exports = { init, show, isQuiet, setQuietCheck };
