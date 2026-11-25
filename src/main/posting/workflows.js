// Workflows: a saved posting plan for a folder (e.g. 100 videos, one per day). "Next 10" schedules the next files in
// order, continuing the time pattern after the last scheduled post. Progress lives in a CSV sheet on disk (opens in
// Excel), read only when needed, so nothing stays in RAM or GPU between runs.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('../store');
const paths = require('../paths');
const sched = require('./schedule');

const rid = () => crypto.randomBytes(4).toString('hex');
const MEDIA = /\.(mp4|mov|m4v|mkv|webm|avi|wmv|jpe?g|png|webp|gif|heic)$/i;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
// sheet times are local (readable in Excel); ISO strings from older rows still parse
const localTime = (iso) => { const d = new Date(iso); if (isNaN(d)) return ''; const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const COLS = ['no', 'file', 'status', 'targets', 'scheduled_for', 'job_id', 'links', 'note', 'updated'];

function dir() {
  const d = store.get().workflowsDir || paths.sub('workflows');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const metaFile = (id) => path.join(dir(), `${id}.workflow.json`);

function csvCell(v) { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function readSheet(wf) {
  try {
    const rows = parseCsv(fs.readFileSync(wf.sheet, 'utf8').replace(/^\ufeff/, ''));
    const head = rows.shift() || COLS;
    return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
  } catch (_) { return []; }
}
function writeSheet(wf, rows) {
  const text = '\ufeff' + [COLS.join(','), ...rows.map((r) => COLS.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';
  store.atomicWrite(wf.sheet, text);
}

function list() {
  return fs.readdirSync(dir()).filter((f) => f.endsWith('.workflow.json')).map((f) => store.readJson(path.join(dir(), f), null)).filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt).map((w) => ({ ...w, stats: stats(w) }));
}
function get(idOrName) {
  const q = String(idOrName || '').toLowerCase();
  const all = list();
  return all.find((w) => w.id === idOrName) || all.find((w) => w.name.toLowerCase() === q) || all.find((w) => w.name.toLowerCase().includes(q)) || null;
}
function stats(w) {
  const rows = readSheet(w);
  const by = (s) => rows.filter((r) => r.status === s).length;
  return { total: rows.length, pending: by('pending'), scheduled: by('scheduled'), failed: by('failed'), skipped: by('skipped'), waiting: by('waiting') };
}
function scanFolder(folder, filter) {
  if (!folder || !fs.existsSync(folder)) throw new Error(`Folder not found: ${folder}`);
  let files = fs.readdirSync(folder).filter((f) => MEDIA.test(f)).sort(collator.compare).map((f) => path.join(folder, f));
  if (filter?.match) files = files.filter((f) => path.basename(f).toLowerCase().includes(String(filter.match).toLowerCase()));
  if (filter?.range) {
    const m = /(\d+)\s*(?:-|to|\.\.)\s*(\d+)/.exec(String(filter.range));
    if (m) { const lo = Math.min(+m[1], +m[2]), hi = Math.max(+m[1], +m[2]); files = files.filter((f) => { const n = /(\d+)/.exec(path.basename(f)); return n && +n[1] >= lo && +n[1] <= hi; }); }
  }
  return files;
}

// spec: {name, folder, filter, targets[] (strings), cadence {times[], every}, startDate, batchSize, options{style, language, analysisMode, instructions}, approval, chatId}
function create(spec) {
  const files = scanFolder(spec.folder, spec.filter);
  if (!files.length) throw new Error('No videos or images found in that folder.');
  const id = `${Date.now().toString(36)}-${rid()}`;
  const name = String(spec.name || path.basename(spec.folder)).slice(0, 80);
  const safe = name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
  const w = {
    id, name, folder: spec.folder, filter: spec.filter || {}, targets: spec.targets || [],
    cadence: { times: spec.cadence?.times?.length ? spec.cadence.times : store.get().timeSlots, every: spec.cadence?.every || '1d' },
    startDate: spec.startDate || '', batchSize: Math.max(1, Math.min(100, Number(spec.batchSize) || 10)),
    options: spec.options || {}, approval: spec.approval || null, chatId: spec.chatId || null,
    sheet: path.join(dir(), `${safe}-${id.slice(-4)}.csv`), lastDue: null, createdAt: Date.now(), updatedAt: Date.now()
  };
  writeSheet(w, files.map((f, i) => ({ no: i + 1, file: f, status: 'pending', targets: '', scheduled_for: '', job_id: '', links: '', note: '', updated: '' })));
  store.atomicWrite(metaFile(id), JSON.stringify(w, null, 2));
  return { ...w, stats: stats(w) };
}
function update(id, patch) {
  const w = get(id);
  if (!w) throw new Error('Workflow not found');
  for (const k of ['name', 'targets', 'cadence', 'batchSize', 'options', 'approval', 'startDate']) if (patch[k] !== undefined) w[k] = patch[k];
  w.updatedAt = Date.now();
  const { stats: _s, ...save } = w;
  store.atomicWrite(metaFile(w.id), JSON.stringify(save, null, 2));
  return { ...w, stats: stats(w) };
}
function remove(id, { keepSheet = true } = {}) {
  const w = get(id);
  if (!w) return;
  try { fs.unlinkSync(metaFile(w.id)); } catch (_) { /* gone */ }
  if (!keepSheet) try { fs.unlinkSync(w.sheet); } catch (_) { /* gone */ }
}
// new files added to the folder later are appended to the sheet
function syncFolder(w) {
  const rows = readSheet(w);
  const have = new Set(rows.map((r) => r.file.toLowerCase()));
  let n = rows.length;
  for (const f of scanFolder(w.folder, w.filter)) if (!have.has(f.toLowerCase())) rows.push({ no: ++n, file: f, status: 'pending', targets: '', scheduled_for: '', job_id: '', links: '', note: 'added later', updated: '' });
  writeSheet(w, rows);
  return rows;
}

// picks the next N pending files and the times for them (continuing after the last scheduled one)
function planNext(idOrName, count) {
  const w = get(idOrName);
  if (!w) throw new Error('Workflow not found');
  const rows = syncFolder(w);
  const n = Math.max(1, Math.min(200, Number(count) || w.batchSize));
  const next = rows.filter((r) => r.status === 'pending' || r.status === 'failed' || r.status === 'waiting').slice(0, n);
  if (!next.length) return { workflow: w, files: [], times: [], done: true };
  const lastScheduled = rows.map((r) => r.scheduled_for).filter(Boolean).map((t) => sched.parseLocal(t)).filter(Boolean).filter((d) => !isNaN(d) && d.getTime() > Date.now()).sort((a, b) => b - a)[0];
  let start = w.startDate || '';
  if (lastScheduled) {
    // the next slot after the last scheduled post
    const t = sched.compute({ mode: 'custom', start: new Date(lastScheduled.getTime() + 60000).toISOString(), times: w.cadence.times, every: w.cadence.every }, 1)[0];
    start = t;
  }
  const times = sched.compute({ mode: 'custom', start: start || undefined, times: w.cadence.times, every: w.cadence.every }, next.length, { timeSlots: store.get().timeSlots });
  return { workflow: w, files: next.map((r) => r.file), times, done: false };
}
function markJob(idOrName, files, jobId, times) {
  const w = get(idOrName);
  const rows = readSheet(w);
  files.forEach((f, i) => { const r = rows.find((x) => x.file === f); if (r) Object.assign(r, { status: 'queued', job_id: jobId, scheduled_for: times[i] ? localTime(times[i]) : '', updated: localTime(Date.now()) }); });
  writeSheet(w, rows);
  w.updatedAt = Date.now();
  const { stats: _s, ...save } = w;
  store.atomicWrite(metaFile(w.id), JSON.stringify(save, null, 2));
}
// called for every posting result of a job that belongs to a workflow
function onResult(ev) {
  if (!ev.workflowId) return;
  const w = get(ev.workflowId);
  if (!w) return;
  const rows = readSheet(w);
  const r = rows.find((x) => x.file === ev.file);
  if (!r) return;
  const targets = new Map(String(r.targets || '').split(' | ').filter(Boolean).map((x) => { const i = x.lastIndexOf(': '); return [x.slice(0, i), x.slice(i + 2)]; }));
  targets.set(ev.label, ev.status);
  r.targets = [...targets].map(([k, v]) => `${k}: ${v}`).join(' | ');
  const st = [...targets.values()];
  r.status = st.every((x) => x === 'done' || x === 'skipped') ? 'scheduled' : st.some((x) => x === 'waiting_slot') ? 'waiting' : st.some((x) => x === 'failed' || x === 'needs_user') ? 'failed' : r.status;
  if (ev.dueAt && !['now', 'draft'].includes(ev.dueAt)) r.scheduled_for = localTime(ev.dueAt);
  if (ev.url) r.links = [...new Set([...String(r.links || '').split(' ').filter(Boolean), ev.url])].join(' ');
  if (ev.error) r.note = ev.error.slice(0, 200);
  r.updated = localTime(Date.now());
  writeSheet(w, rows);
}
function rows(idOrName) { const w = get(idOrName); return w ? readSheet(w) : []; }
function describe() { return list().map((w) => `"${w.name}" (id ${w.id}): ${w.stats.total} files, ${w.stats.scheduled} scheduled, ${w.stats.pending} pending${w.stats.failed ? `, ${w.stats.failed} failed` : ''}${w.stats.waiting ? `, ${w.stats.waiting} waiting for queue space` : ''}; targets ${w.targets.join(', ')}; times ${w.cadence.times.join(', ')} every ${w.cadence.every}`).join('\n'); }

module.exports = { list, get, create, update, remove, planNext, markJob, onResult, rows, describe, readSheet, parseCsv };
