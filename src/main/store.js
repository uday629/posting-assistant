// Settings persistence: JSON files in the data folder, atomic writes. Every secret (API keys, Buffer key, media host
// keys) is encrypted with Windows DPAPI through safeStorage and never leaves the main process.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { safeStorage } = require('electron');
const paths = require('./paths');

const DEFAULTS = {
  version: 1,
  setupDone: false,
  // approvals: autopilot = never ask, every = ask before each post, once = ask one time for the whole job
  mode: 'once',
  language: 'auto',            // chat reply language
  captionLanguage: 'auto',     // auto = match the video, bn, en, banglish, bn+en
  captionLength: 'medium',     // short | medium | long
  captionType: 'auto',         // auto | storytelling | educational | hook_question | emotional | humorous | promotional | minimal | hype
  captionTone: 'positive',     // positive | neutral | bold | controversial
  captionTriggers: ['curiosity', 'relatability'],
  captionStructure: 'auto',    // id of a structure template, or auto
  captionBoosters: ['question'], // engagement boosters (ids)
  analysisMode: 'smart',       // name | quick | smart | full
  framesSmart: 4,
  framesFull: 12,
  transcribeMaxSecSmart: 180,
  defaultStyle: 'bangla-storyteller',
  timeSlots: ['19:00'],        // default daily posting times when the user says "schedule" without a time
  maxSteps: 40,
  maxOutputChars: 6000,
  skillBudgetChars: 7000,      // how much skill text goes into a caption prompt
  sound: true,
  volume: 0.7,
  closeToTray: true,
  keepAwake: true,
  notifyDone: true,
  showBrowserWhilePosting: false,
  browserMaxSteps: 45,
  minPostGapSec: 8,
  maxPostsPerHour: 60,
  hosting: { provider: 'none', folder: 'posting-assistant', deleteAfterDays: 10 },
  buffer: { organizationId: '', organizationName: '' },
  transcribe: { engine: 'local', localModel: 'large-v3-turbo-q5_0', variant: 'cpu', provider: '', model: 'whisper-large-v3', threads: 0, dir: '', customModelPath: '' },
  providers: [
    { id: 'ollama', type: 'ollama', preset: 'ollama', name: 'Ollama (local)', baseUrl: 'http://127.0.0.1:11434', enabled: true }
  ],
  roles: {
    main: { provider: 'ollama', model: '', temperature: 0.3, numCtx: 16384, think: false },
    vision: { provider: 'ollama', model: '', temperature: 0.2, numCtx: 16384, think: false },
    writer: { provider: 'ollama', model: '', temperature: 0.8, numCtx: 16384, think: false }
  },
  modelOverrides: {},
  ollamaDir: '',
  browserAccounts: {},         // platform -> {label, lastCheck, loggedIn}
  memory: [],
  // where Writer chats, saved posts and workflow sheets live (empty = inside the data folder)
  writerDir: '',
  draftsDir: '',
  workflowsDir: '',
  defaultMediaFolder: '',
  search: { engine: 'auto', searxngUrl: '' },   // auto = Google (app browser) then Bing then DuckDuckGo
  gpu: { enabled: true, warm: 76, hot: 82, stop: 88, cool: 68, localOneAtATime: true },
  alerts: { popup: true, sound: true },
  // Automation: how much the app does without asking
  planGate: true,              // chat shows the plan and waits for "Start"; false = starts at once when nothing is missing
  autoRetry: true,             // retry a failed post by itself (read by posting/jobs.js)
  autoVerify: true,            // check on Buffer that the post really exists after posting (read by posting/jobs.js)
  askOnlyWhenMissing: true,    // the agent asks only about what is truly missing; uses saved account caption setups and defaults
  quietHours: { enabled: false, start: '22:00', end: '08:00' }, // only sounds, pop-ups and notifications are silenced; jobs keep running
  telegram: { enabled: false, chatId: '', onAttention: true, onFinished: true, daily: true, dailyTime: '20:00', lastDaily: '' },
  webAiFallback: false        // let the agent ask ChatGPT/Gemini/Claude web (signed in under Accounts) when stuck
};

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function merge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = merge(base[k], over[k]);
  return out;
}

const encOk = () => { try { return safeStorage.isEncryptionAvailable(); } catch (_) { return false; } };
function encrypt(s) {
  if (!s) return '';
  return encOk() ? 'enc:' + safeStorage.encryptString(s).toString('base64') : 'b64:' + Buffer.from(s).toString('base64');
}
function decrypt(s) {
  if (!s) return '';
  try {
    if (s.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'));
    if (s.startsWith('b64:')) return Buffer.from(s.slice(4), 'base64').toString();
  } catch (_) { /* unreadable */ }
  return '';
}

let settings = null;
const file = () => path.join(paths.dataRoot(), 'settings.json');
const secretsFile = () => path.join(paths.dataRoot(), 'secrets.json');

function load() {
  settings = merge(DEFAULTS, readJson(file(), {}));
  if (!settings.providers.some((p) => p.id === 'ollama')) settings.providers.unshift({ ...DEFAULTS.providers[0] });
  return settings;
}
function get() { return settings || load(); }
function save() { atomicWrite(file(), JSON.stringify(settings, null, 2)); }

/* ---------------- secrets (never sent to the renderer) ---------------- */
let secrets = null;
function sec() { if (!secrets) secrets = readJson(secretsFile(), {}); return secrets; }
function setSecret(name, value) {
  const s = sec();
  if (value === '__keep__' || value === undefined) return;
  if (!value) delete s[name]; else s[name] = encrypt(String(value));
  atomicWrite(secretsFile(), JSON.stringify(s, null, 2));
}
function secret(name) { return decrypt(sec()[name]); }
function hasSecret(name) { return !!sec()[name]; }
// values that must never appear in logs, chats or anything shown in the UI
function allSecretValues() {
  const out = [];
  for (const v of Object.values(sec())) { const d = decrypt(v); if (d && d.length >= 6) out.push(d); }
  for (const p of get().providers) { const d = decrypt(p.apiKeyEnc); if (d && d.length >= 6) out.push(d); }
  return out;
}
function redact(text) {
  let t = String(text ?? '');
  for (const v of allSecretValues()) t = t.split(v).join('[hidden]');
  return t.replace(/(Bearer\s+)[A-Za-z0-9._\-]{12,}/g, '$1[hidden]').replace(/\b(sk-[A-Za-z0-9_\-]{16,})/g, '[hidden]');
}

// Public view for the renderer: never send keys, only whether one is set
const SECRET_NAMES = ['bufferKey', 'cloudinaryKey', 'cloudinarySecret', 's3AccessKey', 's3SecretKey', 'githubToken', 'searchKey', 'telegramToken'];
function publicView() {
  const s = JSON.parse(JSON.stringify(get()));
  s.providers = s.providers.map(({ apiKeyEnc, ...p }) => ({ ...p, hasKey: !!apiKeyEnc }));
  s.secrets = Object.fromEntries(SECRET_NAMES.map((n) => [n, hasSecret(n)]));
  s.dataRoot = paths.dataRoot();
  return s;
}
const OBJECT_KEYS = new Set(['roles', 'modelOverrides', 'hosting', 'buffer', 'transcribe', 'browserAccounts', 'search', 'gpu', 'alerts', 'quietHours', 'telegram']);
function update(patch) {
  const s = get();
  const blocked = new Set(['providers', 'version', 'dataRoot', 'secrets']);
  for (const [k, v] of Object.entries(patch || {})) {
    if (blocked.has(k) || !(k in DEFAULTS)) continue;
    s[k] = OBJECT_KEYS.has(k) ? merge(s[k], v) : v;
  }
  save();
  return publicView();
}
function upsertProvider(p) {
  const s = get();
  const id = p.id || `${p.preset || 'custom'}-${crypto.randomBytes(3).toString('hex')}`;
  const cur = s.providers.find((x) => x.id === id);
  const next = { ...(cur || {}), id, type: p.type, preset: p.preset, name: String(p.name || p.preset || 'Provider').slice(0, 60), baseUrl: (p.baseUrl || '').replace(/\/+$/, ''), enabled: p.enabled !== false };
  if (p.apiKey !== undefined && p.apiKey !== null && p.apiKey !== '__keep__') next.apiKeyEnc = encrypt(p.apiKey);
  if (cur) Object.assign(cur, next); else s.providers.push(next);
  save();
  return id;
}
function removeProvider(id) {
  const s = get();
  if (id === 'ollama') throw new Error('The built-in Ollama provider cannot be removed (you can disable it).');
  s.providers = s.providers.filter((p) => p.id !== id);
  for (const r of Object.values(s.roles)) if (r.provider === id) { r.provider = 'ollama'; r.model = ''; }
  save();
}
function provider(id) {
  const p = get().providers.find((x) => x.id === id);
  if (!p) return null;
  return { ...p, apiKey: decrypt(p.apiKeyEnc) };
}

/* ---------------- small JSON collections (styles, notes, history ...) ---------------- */
function collection(name, fallback = []) {
  const f = () => path.join(paths.dataRoot(), `${name}.json`);
  return {
    all: () => readJson(f(), fallback),
    save: (data) => atomicWrite(f(), JSON.stringify(data, null, 2))
  };
}

module.exports = {
  DEFAULTS, load, get, save, update, publicView, upsertProvider, removeProvider, provider,
  setSecret, secret, hasSecret, redact, atomicWrite, readJson, collection
};
