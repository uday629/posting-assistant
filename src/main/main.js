// Posting Assistant - Electron main process.
const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, Notification, nativeImage, powerSaveBlocker } = require('electron');
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

/* keep every app file (cache, browser profile, crash dumps) inside the data folder, off the system drive */
const ROOT = paths.dataRoot();
app.setPath('userData', path.join(ROOT, '.app'));
app.setPath('sessionData', path.join(ROOT, '.app'));
try { app.setPath('crashDumps', path.join(ROOT, '.app', 'crashes')); } catch (_) { /* older electron */ }
try { fs.mkdirSync(path.join(ROOT, '.app', 'temp'), { recursive: true }); app.setPath('temp', path.join(ROOT, '.app', 'temp')); } catch (_) { /* keep default */ }
app.setAppLogsPath(path.join(ROOT, 'logs'));
app.setAppUserModelId('com.bunny.postingassistant');
app.setAboutPanelOptions({ applicationName: 'Posting Assistant', copyright: 'Made by Bunnys Framelab (Instagram: @bunnysframelab)' });

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const store = require('./store');
const engine = require('./agent/engine');
const tools = require('./agent/tools');
const providers = require('./llm/providers');
const ollama = require('./llm/ollama');
const catalog = require('./llm/catalog');
const hardware = require('./llm/hardware');
const whisper = require('./media/whisper');
const analyzer = require('./media/analyze');
const ff = require('./media/ffmpeg');
const styles = require('./caption/styles');
const skills = require('./caption/skills');
const study = require('./caption/study');
const writer = require('./caption/writer');
const kb = require('./knowledge/kb');
const buffer = require('./posting/buffer');
const hosting = require('./posting/hosting');
const browser = require('./posting/browser');
const jobs = require('./posting/jobs');
const sched = require('./posting/schedule');
const accounts = require('./posting/accounts');
const workflows = require('./posting/workflows');
const studio = require('./content/studio');
const studyC = require('./content/study');
const viralC = require('./content/viral');
const formats = require('./content/formats');
const slash = require('./content/slash');
const web = require('./web/search');
const gpu = require('./llm/gpuguard');
const alerts = require('./alerts');
const hub = require('./notify/hub');
const telegram = require('./notify/telegram');
const undo = require('./agent/undo');
const health = require('./agent/health');

let win = null, tray = null, quitting = false, pullAbort = null, whisperAbort = null, blocker = null;
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const DEV = !app.isPackaged;

/* ---------------- logging (secrets are redacted) ---------------- */
const logFile = path.join(paths.sub('logs'), 'app.log');
function log(...a) {
  const line = `[${new Date().toISOString()}] ${store.redact(a.map((x) => (x instanceof Error ? x.stack : typeof x === 'string' ? x : JSON.stringify(x))).join(' '))}\n`;
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, logFile + '.old');
    fs.appendFileSync(logFile, line);
  } catch (_) { /* ignore */ }
}
process.on('uncaughtException', (e) => log('uncaught', e));
process.on('unhandledRejection', (e) => log('unhandled', e));

function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }
const isQuiet = () => alerts.isQuiet(store.get());
function notify(title, body) {
  if (isQuiet()) return; // quiet hours: no Windows notifications
  try { if (Notification.isSupported()) { const n = new Notification({ title, body: String(body || '').slice(0, 200), icon: path.join(ASSETS, 'icon.png') }); n.on('click', () => showWin()); n.show(); } } catch (_) { /* ignore */ }
}
function showWin() { if (!win) createWindow(); else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } }

/* ---------------- window + tray ---------------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1020, minHeight: 640, show: false,
    backgroundColor: '#08080A', title: 'Posting Assistant', icon: path.join(ASSETS, 'icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('console-message', (e) => { const lvl = e.level ?? e; if (lvl === 'error' || lvl === 3) log('renderer', e.message || ''); });
  win.on('close', (e) => {
    if (!quitting && (jobs.isBusy() || engine.isActive() || store.get().closeToTray)) {
      e.preventDefault();
      win.hide();
      if (jobs.isBusy()) tray?.displayBalloon?.({ title: 'Posting Assistant', content: 'Still posting in the background. Use the tray icon to open or quit.' });
    }
  });
  win.on('closed', () => { win = null; });
}
function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, 'tray.png')));
  tray.setToolTip('Posting Assistant');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Open Posting Assistant', click: showWin },
    { type: 'separator' },
    { label: jobs.isBusy() ? 'A posting job is running' : 'No job running', enabled: false },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu());
  tray.on('click', showWin);
  jobs.on('busy', () => tray?.setContextMenu(menu()));
}

/* keep the PC awake only while a job runs (posting continues when the window is minimized or hidden); stopped when idle or switched off */
function syncBlocker(busy) {
  const want = (busy === undefined ? jobs.isBusy() : !!busy) && store.get().keepAwake !== false;
  if (want && blocker == null) { try { blocker = powerSaveBlocker.start('prevent-app-suspension'); } catch (_) { blocker = null; } }
  if (!want && blocker != null) { try { powerSaveBlocker.stop(blocker); } catch (_) { /* gone */ } blocker = null; }
}
jobs.on('busy', (busy) => {
  syncBlocker(busy);
  send('busy', busy);
});

/* ---------------- events to the UI ---------------- */
engine.on('item', (d) => send('chat:item', d));
engine.on('status', (d) => send('chat:status', d));
engine.on('approval', (d) => { send('chat:approval', d); if (!win?.isFocused()) notify('Approval needed', `The assistant wants to run ${d.tool}`); });
jobs.on('update', (j) => { send('job:update', j); try { hub.onUpdate(j); } catch (_) { /* ignore */ } });
jobs.on('log', (d) => send('job:log', d));
jobs.on('frame', (d) => send('job:frame', d));
/* approvals, attention and finished events go through the notify hub: one alert per job, merged reasons, quiet hours, Telegram */
alerts.setQuietCheck(isQuiet);
hub.init({ alerts, notify, log, isQuiet: (s) => alerts.isQuiet(s), jobs, toRenderer: send, approvalCard: (c, k, j) => engine.approvalCard(c, k, j), windowFocused: () => !!win?.isFocused(), flash: () => { try { win?.flashFrame(true); } catch (_) { /* no window */ } }, brokenAccounts: () => health.broken(), upcomingCount: () => calendarRange(Date.now(), Date.now() + 24 * 3600 * 1000).filter((p) => p.status === 'planned').length });
jobs.on('approval', (d) => hub.onApproval(d));
jobs.on('attention', (d) => hub.onAttention(d));
jobs.on('result', (r) => { try { workflows.onResult(r); } catch (e) { log('workflow sheet', e); } });
studio.on('update', (c) => send('studio:update', c));
studio.on('status', (d) => send('studio:status', d));
gpu.on('reading', (r) => send('gpu:reading', r));
gpu.on('state', (st, r) => {
  send('gpu:state', { state: st, reading: r });
  if (st === 'critical') alerts.show({ title: 'GPU is very hot', text: `${r?.temp ?? '?'}°C. Local AI waits until it cools to ${store.get().gpu.cool}°C, then continues by itself.`, level: 'warn', view: 'settings' });
  if (st === 'lost') alerts.show({ title: 'GPU stopped responding', text: 'The driver reports the GPU as lost. Local AI work is stopped. Save your work and restart the PC.', level: 'error', view: 'models' });
});
jobs.on('finished', (j) => {
  const msg = `Job "${j.title}" ${j.status}: ${j.stats.done} of ${j.stats.total} posts done${j.stats.failed ? `, ${j.stats.failed} need attention` : ''}.`;
  if (j.chatId) {
    const lines = j.items.map((it) => `- ${it.name}: ${it.results.map((r) => `${r.label} ${r.status}${r.dueAt && r.status === 'done' ? ` (${sched.human(r.dueAt)})` : ''}${r.error ? ` - ${r.error}` : ''}`).join('; ')}`).join('\n');
    engine.note(j.chatId, `${msg}\n${lines}`, j.status === 'done' ? 'report' : 'warn');
  }
  try { hub.onFinished(j, msg); } catch (e) { log('finished hook', e); }
});

/* ---------------- API (renderer -> main) ---------------- */
const RUNNABLE = /\.(exe|msi|bat|cmd|com|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|scr|pif|lnk|reg|jar|cpl|dll)$/i;
function okPath(p) { return typeof p === 'string' && p.length < 1000 && path.isAbsolute(p); }
const SECRET_OK = new Set(['bufferKey', 'cloudinaryKey', 'cloudinarySecret', 's3AccessKey', 's3SecretKey', 'githubToken', 'searchKey', 'telegramToken']);
async function progressPull(name) {
  pullAbort = new AbortController();
  try { await providers.ollamaPull('http://127.0.0.1:11434', name, (p) => send('pull:progress', { name, ...p }), pullAbort.signal); }
  catch (e) { send('pull:progress', { name, status: 'error', error: e.message }); throw e; }
  finally { pullAbort = null; }
}

/* posts in a time range: finished/failed ones from the history, still-planned ones from job items (no network) */
function calendarRange(from, to) {
  const out = [];
  const validTs = (d) => { if (!d || d === 'now' || d === 'draft') return 0; const t = new Date(d).getTime(); return Number.isFinite(t) ? t : 0; };
  for (const x of jobs.history()) {
    const ts = validTs(x.dueAt) || x.at;
    if (!ts || ts < from || ts > to) continue;
    out.push({ ts, status: x.status === 'done' ? 'done' : ['failed', 'needs_user'].includes(x.status) ? 'failed' : 'planned', channel: x.target || '', name: x.name || '', text: String(x.text || x.title || '').slice(0, 140), jobId: x.jobId || '' });
  }
  for (const j of jobs.list()) {
    for (const it of j.items) {
      if (it.stage === 'skipped') continue;
      const ts = validTs(it.dueAt);
      if (!ts || ts < from || ts > to) continue;
      const cap = it.captions?.platforms ? Object.values(it.captions.platforms)[0] : null;
      const text = String(cap?.text || it.text || it.name || '').slice(0, 140);
      for (const r of it.results || []) {
        if (['done', 'failed', 'needs_user', 'skipped'].includes(r.status)) continue; // already in the history
        out.push({ ts, status: 'planned', channel: r.label || '', name: it.name || '', text, jobId: j.id });
      }
    }
  }
  return out.sort((a, b) => a.ts - b.ts).slice(0, 5000);
}

const API = {
  'app.info': () => ({ brand: 'Bunnys Framelab', instagram: 'https://www.instagram.com/bunnysframelab/', version: app.getVersion(), dataRoot: paths.dataRoot(), ffmpeg: ff.ffmpegPath(), dev: DEV, platform: process.platform, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, busy: jobs.isBusy() }),
  'settings.get': () => store.publicView(),
  'settings.update': (patch) => {
    const t = patch?.telegram;
    if (t && t.chatId !== undefined && String(t.chatId).trim() && !telegram.validChat(String(t.chatId).trim())) throw new Error('The chat id looks wrong. Use the number from @userinfobot (or @channelname).');
    if (t && typeof t.chatId === 'string') t.chatId = t.chatId.trim();
    const r = store.update(patch); send('settings:changed', r); syncBlocker(); return r;
  },
  'telegram.test': async () => { await telegram.test(); return true; },
  'settings.setDataRoot': async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose the data folder', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    paths.setDataRoot(r.filePaths[0]);
    return { restart: true, dataRoot: r.filePaths[0] };
  },
  'secrets.set': ({ name, value }) => {
    if (!SECRET_OK.has(name)) throw new Error('Unknown secret');
    if (name === 'telegramToken' && value && value !== '__keep__' && !/^\d{6,12}:[A-Za-z0-9_-]{30,60}$/.test(String(value).trim())) throw new Error('That does not look like a Telegram bot token (it looks like 123456789:AAxxxx...).');
    store.setSecret(name, typeof value === 'string' && name === 'telegramToken' ? value.trim() : value); if (name === 'bufferKey') tools.invalidateChannels(); return store.publicView(); },

  /* models */
  'providers.presets': () => providers.PRESETS,
  'providers.upsert': (p) => { const id = store.upsertProvider(p); return id; },
  'providers.remove': (id) => store.removeProvider(id),
  'providers.models': (id) => providers.listModels(id),
  'providers.test': (id) => providers.testProvider(id),
  'hw.detect': () => hardware.detect(),
  'models.catalog': async () => {
    const hw = await hardware.detect();
    let installed = [];
    try { installed = (await providers.listModels('ollama')).map((m) => ({ id: m.id, size: m.size, vision: m.vision })); } catch (_) { /* ollama off */ }
    return { hw, catalog: catalog.withFit(hw, installed.map((i) => i.id)), installed };
  },
  'models.pull': (name) => progressPull(String(name)),
  'models.cancelPull': () => { pullAbort?.abort(); },
  'models.delete': (name) => providers.ollamaDelete('http://127.0.0.1:11434', String(name)),
  'ollama.status': () => ollama.status(),
  'ollama.start': () => ollama.start(),
  'ollama.install': (dir) => ollama.install(okPath(dir) ? dir : null, (p) => send('ollama:progress', p)),
  'ollama.setDir': (dir) => { if (!okPath(dir)) throw new Error('Bad folder'); return ollama.setModelsDir(dir); },
  'ollama.scan': (dir) => { if (!okPath(dir)) throw new Error('Bad folder'); return ollama.scanFolder(dir); },
  'ollama.import': ({ file, name }) => { if (!okPath(file)) throw new Error('Bad file'); return ollama.importGguf(file, name, (p) => send('ollama:progress', p)); },
  'whisper.status': () => whisper.status(),
  'whisper.install': async (o = {}) => {
    whisperAbort = new AbortController();
    try { const r = await whisper.install({ variant: o.variant === 'cuda' ? 'cuda' : 'cpu', model: o.model || store.get().transcribe.localModel }, (p) => send('whisper:progress', p), whisperAbort.signal); store.update({ transcribe: { engine: 'local', variant: o.variant === 'cuda' ? 'cuda' : 'cpu', localModel: o.model || store.get().transcribe.localModel } }); return r; }
    finally { whisperAbort = null; }
  },
  'whisper.installModel': async (model) => { whisperAbort = new AbortController(); try { await whisper.installModel(model, (p) => send('whisper:progress', p), whisperAbort.signal); send('whisper:progress', { status: 'success' }); return whisper.status(); } finally { whisperAbort = null; } },
  'whisper.cancel': () => whisperAbort?.abort(),
  'whisper.removeModel': (m) => whisper.removeModel(m),
  'whisper.useModelFile': async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose a whisper.cpp model file (ggml-*.bin)', properties: ['openFile'], filters: [{ name: 'Whisper models', extensions: ['bin'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    store.update({ transcribe: { customModelPath: r.filePaths[0], localModel: 'custom' } });
    return whisper.status();
  },
  'whisper.chooseDir': async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Folder for the speech engine and its models (an existing whisper folder works too)', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    store.update({ transcribe: { dir: r.filePaths[0] } });
    return whisper.status();
  },

  /* chat */
  'chat.list': () => engine.list(),
  'chat.create': () => engine.create(),
  'chat.load': (id) => engine.load(id),
  'chat.send': ({ chatId, text }) => { engine.send(chatId, { text }).catch((e) => log('chat', e)); return true; },
  'chat.stop': () => engine.stop(),
  'chat.remove': (id) => engine.remove(id),
  'chat.rename': ({ id, title }) => engine.rename(id, title),
  'chat.approve': ({ itemId, decision }) => engine.approve(itemId, decision),
  'chat.state': () => engine.state(),

  /* jobs */
  'jobs.list': () => jobs.list(),
  'jobs.get': (id) => jobs.get(id),
  'jobs.pause': (id) => jobs.pause(id),
  'jobs.takeover': ({ id, on }) => { if (on) jobs.pause(id); const shown = browser.takeover(!!on); if (!on) jobs.resume(id); return shown; },
  'jobs.resume': (id) => jobs.resume(id),
  'jobs.stop': (id) => jobs.stop(id),
  'jobs.remove': (id) => jobs.remove(id),
  'jobs.undoPreview': (id) => undo.preview(String(id)),
  'jobs.undo': async (id) => { const r = await undo.undo(String(id)); log('undo job', id, `${r.deleted} deleted, ${r.failed} failed, ${r.skipped} skipped`); return r; },
  'jobs.approve': ({ key, decision, edits }) => jobs.approve(key, decision, edits),
  'jobs.pending': () => jobs.pending(),
  'jobs.updateItem': ({ id, itemId, patch }) => jobs.updateItem(id, itemId, patch),
  'jobs.create': async (spec) => {
    const files = (spec.files || []).filter((f) => okPath(f) && fs.existsSync(f));
    const { targets } = await tools.resolveTargets(spec.targets);
    const made = jobs.createSplit({ ...spec, files, targets });
    return Array.isArray(made) ? made[0] : made;
  },
  'jobs.previewTimes': ({ schedule, count }) => sched.compute(schedule, Math.min(500, Number(count) || 1), { timeSlots: store.get().timeSlots }).map((t) => ({ iso: t, text: sched.human(t) })),
  'history.list': () => jobs.history(),
  'history.clear': () => jobs.clearHistory(),
  'calendar.range': ({ from, to }) => calendarRange(Number(from) || 0, Number(to) || 0),
  'home.summary': () => {
    const now = Date.now();
    const accs = accounts.list().filter((a) => browser.PLATFORMS[a.kind]?.group !== 'ai');
    const list = jobs.list();
    const byStatus = {};
    for (const j of list) byStatus[j.status] = (byStatus[j.status] || 0) + 1;
    const waiting = list.filter((j) => j.status === 'awaiting_approval' || j.items.some((it) => it.stage === 'awaiting')).map((j) => ({ id: j.id, title: j.title }));
    const bad = list.reduce((a, j) => a + j.stats.failed, 0);
    return {
      accountsTotal: accs.length,
      needSignIn: accs.filter((a) => !a.loggedIn).map((a) => ({ id: a.id, name: a.name })),
      brokenAccounts: (() => { try { return health.broken().filter((b) => b.signedIn); } catch (_) { return []; } })(),
      jobsByStatus: byStatus, jobsTotal: list.length, awaitingApproval: waiting, failedPosts: bad,
      upcoming: calendarRange(now - 3600 * 1000, now + 8 * 86400 * 1000).filter((p) => p.ts >= new Date().setHours(0, 0, 0, 0) && p.status !== 'failed').map((p) => ({ ts: p.ts, channel: p.channel, status: p.status }))
    };
  },

  /* accounts */
  'buffer.test': async () => { const r = await buffer.test(); tools.invalidateChannels(); return r; },
  'buffer.channels': async () => (await tools.channels(true)),
  'buffer.setOrg': ({ id, name }) => { store.update({ buffer: { organizationId: id, organizationName: name } }); tools.invalidateChannels(); return true; },
  'hosting.test': () => hosting.test(),
  'browser.status': () => browser.statusAll(),
  'browser.open': (pid) => { browser.openSite(pid); return true; },
  'browser.logout': (pid) => browser.logout(pid),

  /* styles, skills, knowledge */
  'styles.list': () => styles.list(),
  'styles.save': (s) => styles.save(s),
  'styles.remove': (id) => styles.remove(id),
  'styles.learn': async (o) => (o.source === 'buffer' ? study.fromBuffer(o) : o.source === 'url' ? study.fromUrl(o) : study.fromText(o)),
  'styles.sample': async ({ style, file, platform, language }) => {
    if (!okPath(file)) throw new Error('Pick a video or image to test with.');
    const a = await analyzer.analyze(file, { mode: 'quick' });
    return writer.write({ analysis: a, targets: [platform || 'instagram'], style, language });
  },
  'skills.list': () => skills.list(),
  'skills.get': (id) => skills.full(id),
  'skills.save': (s) => skills.save(s),
  'skills.remove': (id) => skills.remove(id),
  'skills.toggle': ({ id, enabled }) => skills.setEnabled(id, enabled),
  'skills.discover': (url) => skills.discover(url),
  'skills.review': (o) => skills.fetchForReview(o),
  'skills.import': (o) => skills.importReviewed(o),
  'skills.resummarize': async (id) => { const s = skills.full(id); const summary = await skills.summarize(s.body); return skills.save({ id, summary }); },
  'kb.notes': () => kb.notes(),
  'kb.saveNote': (n) => kb.saveNote(n),
  'kb.removeNote': (id) => kb.removeNote(id),
  'kb.docs': () => kb.docs(),
  'kb.addDocPaths': (files) => kb.addDocs((Array.isArray(files) ? files : []).filter((f) => okPath(f) && fs.existsSync(f))),
  'kb.addDocs': async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Add documents', properties: ['openFile', 'multiSelections'] });
    return r.canceled ? [] : kb.addDocs(r.filePaths);
  },
  'kb.readDoc': (name) => kb.readDoc(name),
  'kb.writeDoc': ({ name, text }) => kb.writeDoc(name, text),
  'kb.removeDoc': (name) => kb.removeDoc(name),
  'kb.openDoc': (name) => { const p = kb.docPath(name); if (RUNNABLE.test(p)) { shell.showItemInFolder(p); return; } return shell.openPath(p); },
  'kb.locations': () => kb.locations(),
  'kb.saveLocation': (l) => kb.saveLocation(l),
  'kb.removeLocation': (id) => kb.removeLocation(id),

  /* posting accounts (Buffer and others, each a private browser profile) */
  'accounts.platforms': () => Object.entries(browser.PLATFORMS).map(([id, p]) => ({ id, label: p.label, group: p.group })),
  'accounts.list': () => accounts.list(),
  'accounts.save': (a) => { if (a.defaultFolder && !accounts.folderOk(a.defaultFolder)) throw new Error('That folder does not exist.'); return accounts.save(a); },
  'accounts.remove': (id) => accounts.remove(id),
  'accounts.signIn': (id) => accounts.signIn(id),
  'accounts.refresh': (id) => accounts.refresh(id, { channels: true }),
  'accounts.syncChannels': (id) => accounts.syncChannels(id),
  'accounts.health': () => health.all(),
  'besttime.suggest': ({ service }) => require('./caption/besttime').suggest(String(service || 'instagram'), jobs.history()),
  'research.run': ({ topic, platform }) => require('./content/research').research(String(topic || '').slice(0, 120), String(platform || 'instagram')),
  'accounts.healthRun': (id) => health.run(String(id)),
  'queue.list': ({ id, channel, view }) => accounts.queueList(id, channel, view),
  'queue.remove': ({ id, channel, view, posts }) => accounts.queueRemove(id, channel, view, posts),

  /* workflows */
  'workflows.list': () => workflows.list(),
  'workflows.create': (spec) => workflows.create(spec),
  'workflows.update': ({ id, patch }) => workflows.update(id, patch),
  'workflows.remove': ({ id, keepSheet }) => workflows.remove(id, { keepSheet: keepSheet !== false }),
  'workflows.rows': (id) => workflows.rows(id),
  'workflows.next': async ({ id, count, approval }) => {
    const plan = workflows.planNext(id, count);
    if (plan.done) throw new Error('No pending files left in this workflow.');
    const { targets } = await tools.resolveTargets(plan.workflow.targets);
    const j = jobs.create({ title: `${plan.workflow.name}: next ${plan.files.length}`, workflowId: plan.workflow.id, files: plan.files, targets, schedule: { mode: 'custom', dates: plan.times }, approval: approval || plan.workflow.approval || store.get().mode, options: { ...plan.workflow.options } });
    workflows.markJob(plan.workflow.id, plan.files, j.id, plan.times);
    return j;
  },
  'workflows.openSheet': (id) => { const w = workflows.get(id); if (w) shell.openPath(w.sheet); },

  /* writer studio */
  'studio.modes': () => Object.keys(studio.MODES),
  'studio.list': () => studio.list(),
  'studio.create': (o) => studio.create(o),
  'studio.load': (id) => studio.load(id),
  'studio.update': ({ id, patch }) => studio.update(id, patch),
  'studio.remove': (id) => studio.remove(id),
  'studio.send': ({ id, text }) => { studio.send(id, text).catch((e) => send('studio:status', { id, status: '', error: store.redact(e.message) })); return true; },
  'studio.stop': () => studio.stop(),
  'studio.attach': ({ id, file, mode }) => { if (!okPath(file)) throw new Error('Bad file'); return studio.attach(id, file, { mode }); },
  'studio.detach': ({ id, name }) => studio.detach(id, name),
  'studio.drafts': () => studio.drafts(),
  'studio.saveDraft': (d) => studio.saveDraft(d),
  'studio.readDraft': (n) => studio.readDraft(n),
  'studio.writeDraft': ({ name, text }) => studio.writeDraft(name, text),
  'studio.removeDraft': (n) => studio.removeDraft(n),
  'studio.fromKit': ({ kit }) => studio.createWith({ mode: 'free', title: `Video kit: ${String(kit?.name || '').slice(0, 40)}` }, { file: kit?.file, name: `Video kit of ${kit?.name}`, brief: ['titles', 'thumbnail_texts', 'keywords', 'youtube_description', 'linkedin_post', 'facebook_status', 'instagram_caption', 'x_post'].map((k) => `${k.toUpperCase()}:\n${Array.isArray(kit?.[k]) ? kit[k].join('\n') : kit?.[k] || ''}`).join('\n\n') + (kit?.transcript ? `\n\nTRANSCRIPT:\n${kit.transcript.slice(0, 5000)}` : '') }),
  'jobs.fromKit': async ({ kit, targets, schedule, approval }) => {
    if (!okPath(kit?.file) || !fs.existsSync(kit.file)) throw new Error('The video file is missing.');
    const { targets: t } = await tools.resolveTargets(targets);
    const P = { youtube: { title: kit.titles?.[0], caption: kit.youtube_description, keywords: kit.keywords }, instagram: { caption: kit.instagram_caption }, tiktok: { caption: kit.instagram_caption }, facebook: { caption: kit.facebook_status }, linkedin: { caption: kit.linkedin_post }, twitter: { caption: kit.x_post }, threads: { caption: kit.x_post }, bluesky: { caption: kit.x_post }, pinterest: { title: kit.titles?.[0], caption: kit.instagram_caption }, google: { caption: kit.facebook_status }, mastodon: { caption: kit.x_post }, generic: { caption: kit.instagram_caption } };
    const platforms = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, writer.assemble(k, { ...v, caption: v.caption || kit.instagram_caption || '', hashtags: kit.hashtags || [] }, null)]));
    return jobs.create({ title: `Video kit: ${kit.name}`, files: [kit.file], targets: t, schedule: schedule || { mode: 'queue' }, approval: approval || store.get().mode, prepared: { [kit.file]: { platforms, language: kit.language, at: Date.now() } }, options: {} });
  },
  'studio.videoKit': ({ file, language, mode }) => { if (!okPath(file)) throw new Error('Bad file'); return studio.videoKit(file, { language, mode, onStep: (t) => send('studio:status', { id: 'kit', status: t }) }); },
  'studio.chooseDir': async (kind) => {
    const r = await dialog.showOpenDialog(win, { title: kind === 'drafts' ? 'Folder for saved posts' : kind === 'workflows' ? 'Folder for workflow sheets' : 'Folder for Writer chats', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const key = kind === 'drafts' ? 'draftsDir' : kind === 'workflows' ? 'workflowsDir' : 'writerDir';
    return store.update({ [key]: r.filePaths[0] });
  },

  /* study and formats */
  'study.list': () => studyC.list(),
  'study.get': (id) => studyC.get(id),
  // viral posts, journey and one-post breakdowns (no model needed until a report button is pressed)
  'viral.run': (o) => { web.safeUrl(o.url); return viralC.run({ ...o, onStep: (t) => send('study:step', t), onFrame: (b64) => send('study:frame', b64) }); },
  'viral.regroup': (o) => viralC.regroup(o.id, o),
  'viral.report': (o) => (o.which === 'journey' ? viralC.journeyReport(o.id, { kind: o.kind }) : viralC.viralReport(o.id)),
  'viral.post': (o) => viralC.postBreakdown(o.id, o.url),
  'viral.ideas': (o) => viralC.ideas(o.id, { niche: o.niche }),
  'study.remove': (id) => studyC.remove(id),
  'study.profile': (o) => { web.safeUrl(o.url); return studyC.studyProfile({ ...o, onStep: (t) => send('study:step', t), onFrame: (b64) => send('study:frame', b64) }); },
  'study.clip': ({ file, name }) => { if (!okPath(file)) throw new Error('Bad file'); return studyC.studyClip(file, { name, onStep: (t) => send('study:step', t) }); },
  'study.toFormat': (id) => studyC.formatFromStudy(id),
  'study.toStyle': (id) => studyC.styleFromStudy(id),
  'study.toSkill': (id) => studyC.skillFromStudy(id),
  'formats.list': () => formats.list(),
  'formats.save': (f) => formats.save(f),
  'formats.remove': (id) => formats.remove(id),
  'slash.catalog': () => slash.catalog(),
  'craft.list': (kind) => require('./caption/craft').list(String(kind)),
  'craft.save': ({ kind, item }) => require('./caption/craft').save(String(kind), item),
  'craft.remove': ({ kind, id }) => require('./caption/craft').remove(String(kind), String(id)),
  'skills.inspectZip': (file) => { if (!okPath(file) || !/\.zip$/i.test(file)) throw new Error('Choose a .zip file'); return skills.inspectZip(file); },
  'web.search': (q) => web.search(String(q).slice(0, 200), 8),
  'gpu.state': () => ({ state: gpu.state, reading: gpu.last }),

  /* storage cleanup */
  'storage.preview': (o) => require('./maintenance').preview(o || {}),
  'storage.clean': ({ range, cats }) => { if (jobs.isBusy()) throw new Error('Wait until the running job finishes.'); return require('./maintenance').clean(range || {}, Array.isArray(cats) ? cats : []); },

  /* files */
  'files.list': ({ folder, range, match }) => { const hits = kb.findFolder(folder); if (!hits.length) throw new Error('Folder not found'); return { folder: hits[0].path, files: tools.listMedia(hits[0].path, { range, match }) }; },
  'media.analyze': ({ file, mode, force }) => { if (!okPath(file)) throw new Error('Bad file'); return analyzer.analyze(file, { mode, force }); },
  'media.cached': (file) => (okPath(file) ? analyzer.cached(file) : null),
  'media.image': (p) => { if (!okPath(p) || !paths.inside(p) || !/\.jpe?g$/i.test(p)) return null; try { return `data:image/jpeg;base64,${fs.readFileSync(p).toString('base64')}`; } catch (_) { return null; } },
  'dialog.folder': async (title) => { const r = await dialog.showOpenDialog(win, { title: String(title || 'Choose a folder'), properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; },
  'dialog.files': async (o = {}) => { const r = await dialog.showOpenDialog(win, { title: o.title || 'Choose files', properties: ['openFile', ...(o.multi === false ? [] : ['multiSelections'])], filters: o.filters }); return r.canceled ? [] : r.filePaths; },
  'dialog.file': async (o = {}) => { const r = await dialog.showOpenDialog(win, { title: o.title || 'Choose a file', properties: ['openFile'], filters: o.filters }); return r.canceled ? null : r.filePaths[0]; },
  'shell.showItem': (p) => { if (okPath(p) && fs.existsSync(p)) shell.showItemInFolder(p); },
  // opens folders only (opening a file with openPath would run it if it were a program)
  'shell.openFolder': (p) => { if (okPath(p) && fs.existsSync(p) && fs.statSync(p).isDirectory()) shell.openPath(p); },
  'shell.external': (u) => { if (/^https:\/\//i.test(String(u))) shell.openExternal(String(u)); }
};

ipcMain.handle('api', async (e, method, arg) => {
  if (e.senderFrame?.url && !e.senderFrame.url.startsWith('file://')) throw new Error('Not allowed');
  const fn = API[method];
  if (!fn) throw new Error(`Unknown method ${method}`);
  try { return await fn(arg); } catch (err) {
    const msg = store.redact(err?.message || String(err));
    if (msg !== 'ABORTED') log('api', method, msg);
    throw new Error(msg);
  }
});

/* ---------------- dev-only test hooks (ignored in the installed app) ---------------- */
async function devHooks() {
  if (!DEV) return;
  if (process.env.PA_TEST_ALERT) alerts.show({ title: 'Test alert', text: 'Cooking IG: Not signed in to Buffer. Open Accounts and sign in once.', level: 'error' });
  if (process.env.PA_SHOTS) {
    const dir = process.env.PA_SHOTS;
    fs.mkdirSync(dir, { recursive: true });
    const views = (process.env.PA_SHOT_VIEWS || 'chat,monitor,posts,styles,skills,knowledge,accounts,models,settings').split(',');
    await new Promise((r) => setTimeout(r, 2500));
    for (const v of views) {
      await win.webContents.executeJavaScript(`window.__go && window.__go(${JSON.stringify(v)})`);
      await new Promise((r) => setTimeout(r, 1600));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(dir, `${v}.png`), img.toPNG());
    }
    if (process.env.PA_SHOTS_QUIT) { quitting = true; app.quit(); }
  }
}

app.whenReady().then(async () => {
  store.load();
  jobs.load();
  try { jobs.resumeInterrupted(); } catch (e) { log('resume', e); }
  skills.list();
  createWindow();
  createTray();
  alerts.init((view) => { showWin(); send('nav', view); });
  hardware.detect().catch(() => {});
  // the posting module may run its own periodic account health checks (optional)
  try { if (typeof accounts.scheduleHealth === 'function') accounts.scheduleHealth(); } catch (e) { log('scheduleHealth', e); }
  hosting.cleanup().catch(() => {});
  setInterval(() => hosting.cleanup().catch(() => {}), 6 * 3600 * 1000);
  win.webContents.once('did-finish-load', () => devHooks().catch((e) => log('devhooks', e)));
});
app.on('second-instance', showWin);
app.on('activate', () => { if (app.isReady()) showWin(); }); // macOS: Dock icon click
app.on('before-quit', () => { quitting = true; try { for (const a of accounts.list()) require('electron').session.fromPartition(a.partition).cookies.flushStore(); } catch (_) { /* nothing to flush */ } browser.closeAll(); gpu.stop(); });
app.on('window-all-closed', () => { if (quitting) app.quit(); });
