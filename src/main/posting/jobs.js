// Posting jobs: many files x many targets in one go. Each job analyzes the media, writes captions, asks for approval
// the way the user chose (autopilot / ask every time / ask once), uploads and schedules, and keeps a live log.
// Jobs are saved after every change, so an app restart shows them as "interrupted" with a Resume button.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const store = require('../store');
const paths = require('../paths');
const analyzer = require('../media/analyze');
const writer = require('../caption/writer');
const buffer = require('./buffer');
const hosting = require('./hosting');
const browser = require('./browser');
const sched = require('./schedule');
const accounts = require('./accounts');
const bq = require('./bufferqueue');

const ev = new EventEmitter();
const rid = () => crypto.randomBytes(4).toString('hex');
const jobsDir = () => paths.sub('jobs');
const jfile = (id) => path.join(jobsDir(), `${id}.json`);
const history = store.collection('post-history', []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const jobs = new Map();
let current = null; // {id, abort, paused, resumeWaiters}
const queue = [];
const approvals = new Map(); // key -> resolve

function load() {
  for (const f of fs.readdirSync(jobsDir())) {
    if (!f.endsWith('.json')) continue;
    const j = store.readJson(path.join(jobsDir(), f), null);
    if (!j) continue;
    if (['running', 'preparing', 'paused', 'awaiting_approval', 'queued'].includes(j.status)) {
      j.interruptedFrom = j.status; j.status = 'interrupted';
      j.items.forEach((it) => {
        if (['analyzing', 'writing', 'posting', 'awaiting'].includes(it.stage)) it.stage = it.captions ? 'ready' : 'pending';
        // a post that was in the browser when the app closed may already exist in Buffer: it is checked in the queue before it is posted again
        for (const r of it.results) { if (r.inflight && r.status === 'pending') r.maybePosted = true; delete r.inflight; }
      });
    }
    jobs.set(j.id, j);
  }
}
// continues the jobs that were running (not paused by the user, not waiting for an approval) when the app closed.
// main.js calls this once after load(). Posts that are already done are never touched; unfinished ones are checked in the queue first.
function resumeInterrupted() {
  const ids = [];
  for (const j of jobs.values()) {
    if (j.status !== 'interrupted' || !['running', 'preparing', 'queued'].includes(j.interruptedFrom)) continue;
    j.interruptedFrom = null;
    try { resume(j.id); log(j, 'Continued automatically after the app restarted', 'info'); ids.push(j.id); } catch (_) { /* leave it for the user */ }
  }
  return ids;
}
let saveTimers = {};
function save(j, now = false) {
  j.updatedAt = Date.now();
  const write = () => { delete saveTimers[j.id]; try { store.atomicWrite(jfile(j.id), JSON.stringify(j, null, 1)); } catch (_) { /* disk */ } };
  if (now) { clearTimeout(saveTimers[j.id]); write(); } else if (!saveTimers[j.id]) saveTimers[j.id] = setTimeout(write, 400);
}
function view(j) {
  if (!j) return null;
  const done = j.items.reduce((a, it) => a + it.results.filter((r) => r.status === 'done').length, 0);
  const total = j.items.reduce((a, it) => a + (it.stage === 'skipped' ? 0 : it.results.length), 0);
  return { ...j, log: j.log.slice(-300), stats: { done, total, failed: j.items.reduce((a, it) => a + it.results.filter((r) => r.status === 'failed' || r.status === 'needs_user').length, 0), waiting: j.items.reduce((a, it) => a + it.results.filter((r) => r.status === 'waiting_slot').length, 0), unverified: j.items.reduce((a, it) => a + it.results.filter((r) => r.status === 'done' && r.verified === false).length, 0) }, active: current?.id === j.id, paused: current?.id === j.id && current.paused };
}
function emit(j, type = 'update') { save(j); ev.emit('update', view(j)); if (type !== 'update') ev.emit(type, view(j)); }
function log(j, text, level = 'info', itemId) {
  const e = { t: Date.now(), level, text: store.redact(String(text)).slice(0, 600), itemId };
  j.log.push(e);
  if (j.log.length > 1500) j.log.splice(0, j.log.length - 1200);
  ev.emit('log', { jobId: j.id, entry: e });
  save(j);
}

/* ---------------- creating ---------------- */
function targetKey(t) { return t.type === 'account' ? `acct:${t.accountId}:${t.channelId || '-'}` : t.type === 'buffer' ? `buffer:${t.channelId}` : `browser:${t.platform}`; }
function captionKey(t) {
  if (t.type === 'buffer') return writer.platformKey(t.service);
  if (t.type === 'account') return writer.platformKey(t.service || t.kind);
  return { youtube: 'youtube', meta: 'facebook', facebook: 'facebook', instagram: 'instagram', tiktok: 'tiktok', linkedin: 'linkedin', x: 'twitter', threads: 'threads', pinterest: 'pinterest' }[t.platform] || 'generic';
}
function targetLabel(t) { if (t.type === 'account') return `${t.channelName || t.accountName} (${t.accountName}${t.service ? `, ${t.service}` : ''})`; return t.type === 'buffer' ? `${t.name} (${t.service}, Buffer)` : `${browser.PLATFORMS[t.platform]?.label || t.platform} (browser)`; }

// spec: {title, chatId, files[], targets[], schedule, approval, options:{analysisMode, style, language, instructions, keywords, perFile:{file:{instructions}}, youtubeCategory, youtubePrivacy, igType, draft}, prepared: {file: captions}}
function create(spec) {
  const s = store.get();
  const texts = (spec.texts || []).map((t) => String(t).trim()).filter(Boolean);
  if (!spec.files?.length && !texts.length) throw new Error('Nothing to post: give files or text posts.');
  spec.files = spec.files || [];
  if (!spec.targets?.length) throw new Error('No target account chosen.');
  const times = sched.compute(spec.schedule, spec.files.length + texts.length, { timeSlots: s.timeSlots });
  const j = {
    id: `${Date.now().toString(36)}-${rid()}`, title: String(spec.title || `${spec.files.length} post(s)`).slice(0, 120), chatId: spec.chatId || null,
    createdAt: Date.now(), status: 'queued', approval: ['autopilot', 'every', 'once'].includes(spec.approval) ? spec.approval : s.mode,
    approved: false, schedule: spec.schedule || { mode: 'queue' }, options: spec.options || {}, targets: spec.targets,
    items: spec.files.map((f, i) => ({
      id: rid(), file: f, name: path.basename(f), kind: /\.(jpe?g|png|webp|gif|bmp|heic)$/i.test(f) ? 'image' : 'video', dueAt: times[i] ?? null,
      stage: 'pending', captions: spec.prepared?.[f] || null, analysis: null,
      results: spec.targets.map((t) => ({ target: targetKey(t), label: targetLabel(t), status: 'pending' }))
    })).concat(texts.map((text, i) => ({
      id: rid(), file: null, name: text.split('\n')[0].slice(0, 50) || 'Text post', kind: 'text', text, dueAt: times[spec.files.length + i] ?? null,
      stage: 'pending', captions: null, analysis: null,
      results: spec.targets.map((t) => ({ target: targetKey(t), label: targetLabel(t), status: 'pending' }))
    }))),
    log: [], workflowId: spec.workflowId || null
  };
  jobs.set(j.id, j);
  log(j, `Job created: ${j.items.length} file(s) to ${j.targets.map(targetLabel).join(', ')}. Approval: ${j.approval}.`);
  enqueue(j.id);
  return view(j);
}
// Different caption wishes per channel (a saved channel/account profile, or spec.perTarget typed in the chat) mean
// different jobs: one job per group of targets with identical wishes, even when the network is the same.
// spec.perTarget: {"<channel, account or network name>": {length, tone, structure, boosters, caption_type, language, style, instructions}}
// spec.options uses the normal job option names (captionLength, captionTone, ...). Returns [{targets, options, texts, prepared}].
const WISH_OPT = { length: 'captionLength', tone: 'captionTone', structure: 'captionStructure', boosters: 'captionBoosters', caption_type: 'captionType', language: 'language', style: 'style' };
function splitPlan(spec) {
  const base = spec.options || {};
  const texts = Array.isArray(spec.texts) ? spec.texts : [];
  const prof = (t) => {
    if (t.type !== 'account') return null;
    const ac = accounts.get(t.accountId);
    const c = (ac?.channels || []).find((x) => x.id === t.channelId);
    const cp = c?.caption || ac?.caption;
    return cp ? { ...cp, _p: true } : null;
  };
  const ov = (t) => {
    const k = [t.channelName, t.name, t.accountName, t.service, t.platform].filter(Boolean).map((x) => String(x).toLowerCase());
    for (const [name, v] of Object.entries(spec.perTarget || {})) if (k.includes(String(name).toLowerCase())) return v;
    return prof(t);
  };
  const groups = new Map();
  for (const t of spec.targets || []) {
    const o = ov(t);
    const key = JSON.stringify(o || {});
    if (!groups.has(key)) groups.set(key, { o: o || {}, targets: [] });
    groups.get(key).targets.push(t);
  }
  const first = [...groups.values()][0];
  if (groups.size <= 1 && !Object.keys(first?.o || {}).length) return [{ targets: first ? first.targets : [], options: base, texts, prepared: spec.prepared || {} }];
  return [...groups.values()].map((g, i) => {
    const x = g.o;
    // wishes typed in the chat beat the defaults saved on an account; per_target wishes beat the chat
    const pick = (k) => (x._p ? (base[WISH_OPT[k]] || x[k]) : (x[k] || base[WISH_OPT[k]])) || undefined;
    const options = { ...base };
    for (const k of Object.keys(WISH_OPT)) options[WISH_OPT[k]] = pick(k);
    options.instructions = [x._p ? x.instructions : null, base.instructions, x._p ? null : x.instructions].filter(Boolean).join('\n') || undefined;
    return { targets: g.targets, options, texts: i === 0 ? texts : [], prepared: {} };
  });
}
// creates one job per caption setup; returns an array of job views
function createSplit(spec) {
  return splitPlan(spec).map((g) => create({ ...spec, targets: g.targets, options: g.options, texts: g.texts, prepared: g.prepared, perTarget: undefined }));
}
function enqueue(id) {
  const j = jobs.get(id);
  if (!j) throw new Error('Job not found');
  if (current?.id === id || queue.includes(id)) return view(j);
  j.status = 'queued';
  queue.push(id);
  emit(j);
  pump();
  return view(j);
}
async function pump() {
  if (current || !queue.length) return;
  const id = queue.shift();
  const j = jobs.get(id);
  if (!j) return pump();
  current = { id, abort: new AbortController(), paused: false, waiters: [], blocked: new Map(), attended: new Set() };
  ev.emit('busy', true);
  try { await run(j); } catch (e) {
    if (e.message === 'ABORTED') { j.status = 'stopped'; log(j, 'Stopped by you.', 'warn'); }
    else { j.status = 'failed'; log(j, `Job failed: ${e.message}`, 'err'); }
  } finally {
    for (const [k, a] of approvals) if (k.startsWith(id)) { approvals.delete(k); a({ decision: 'stop' }); }
    current = null;
    // a result still marked "in the browser" was cut short (stop or error): the queue is checked before it is posted again
    for (const it of j.items) for (const r of it.results) if (r.inflight) { r.maybePosted = true; delete r.inflight; }
    save(j, true);
    emit(j, 'finished');
    ev.emit('busy', false);
    setTimeout(pump, 200);
  }
}
const ctl = () => current;
async function waitIfPaused() {
  if (!current?.paused) return;
  await new Promise((r) => current.waiters.push(r));
}
function check() { if (current?.abort.signal.aborted) throw new Error('ABORTED'); }

/* ---------------- running ---------------- */
async function prepareItem(j, it, sig) {
  const o = j.options || {};
  const signal = sig || current.abort.signal;
  if (it.kind === 'text') {
    if (!it.captions) {
      const keys = [...new Set(j.targets.map(captionKey))];
      if (o.polishText) it.captions = await writer.write({ analysis: { name: 'text post', folder: '', brief: `TEXT POST (the user's own words, keep the meaning):\n${it.text}` }, targets: keys, style: o.style, language: o.language, instructions: o.instructions, signal });
      else it.captions = { platforms: Object.fromEntries(keys.map((k) => [k, writer.assemble(k, { caption: it.text, title: it.text.split('\n')[0].slice(0, 90) }, null)])), language: 'as written', at: Date.now() };
    }
    it.stage = 'ready'; emit(j); return;
  }
  if (!it.analysis || it.analysis.mode !== (o.analysisMode || store.get().analysisMode)) {
    it.stage = 'analyzing'; emit(j);
    log(j, `Analyzing ${it.name} (${o.analysisMode || store.get().analysisMode})`, 'info', it.id);
    const a = await analyzer.analyze(it.file, { mode: o.analysisMode, signal, onStep: (t) => { it.step = t; ev.emit('update', view(j)); } });
    it.analysis = { mode: a.mode, brief: a.brief, language: a.language, hasSpeech: a.hasSpeech, duration: a.info?.duration, orientation: a.info?.orientation, notes: a.notes, frame: a.frames?.[0] || null };
    it.kind = a.kind === 'image' ? 'image' : 'video';
    for (const n of a.notes || []) log(j, `${it.name}: ${n}`, 'warn', it.id);
  }
  const needKeys = [...new Set(j.targets.map(captionKey))];
  if (it.captions && needKeys.some((k) => !it.captions.platforms?.[k])) it.captions = null;
  if (!it.captions) {
    it.stage = 'writing'; it.step = 'Writing captions'; emit(j);
    const keys = [...new Set(j.targets.map(captionKey))];
    const per = o.perFile?.[it.file] || o.perFile?.[it.name] || {};
    it.captions = await writer.write({ analysis: it.analysis, targets: keys, style: per.style || o.style, language: per.language || o.language, instructions: [o.instructions, per.instructions].filter(Boolean).join('\n'), keywords: per.keywords || o.keywords, craft: { length: o.captionLength, type: o.captionType, tone: o.captionTone, structure: o.captionStructure, boosters: o.captionBoosters, triggers: o.captionTriggers }, signal });
    log(j, `Captions ready for ${it.name} (${it.captions.language}, ${keys.join(', ')})`, 'ok', it.id);
  }
  it.stage = 'ready'; it.step = '';
  emit(j);
}

function waitApproval(key, j) {
  return new Promise((resolve) => {
    approvals.set(key, resolve);
    current.abort.signal.addEventListener('abort', () => { if (approvals.delete(key)) resolve({ decision: 'stop' }); }, { once: true });
    ev.emit('approval', { key, job: view(j) });
  });
}
function applyEdits(j, edits) {
  for (const e of edits?.items || []) {
    const it = j.items.find((x) => x.id === e.id);
    if (!it) continue;
    if (e.skip) { it.stage = 'skipped'; it.results.forEach((r) => { if (r.status === 'pending') r.status = 'skipped'; }); continue; }
    if (e.dueAt !== undefined) it.dueAt = e.dueAt;
    for (const [k, p] of Object.entries(e.platforms || {})) {
      const cur = it.captions?.platforms?.[k];
      if (!cur) continue;
      if (p.text != null) { try { if (String(p.text) !== cur.text) require('../caption/styles').learnFromEdits({ original: cur.text, edited: String(p.text), platform: k }); } catch (_) { /* learning is optional */ } cur.text = String(p.text); }
      if (p.title != null) cur.title = String(p.title).slice(0, 100);
      if (p.first_comment != null) cur.first_comment = String(p.first_comment);
    }
  }
}
// key = `${jobId}` for whole-job approval, `${jobId}:${itemId}` for one item
function approve(key, decision, edits) {
  const a = approvals.get(key);
  const [jobId] = key.split(':');
  const j = jobs.get(jobId);
  if (j && edits) { applyEdits(j, edits); emit(j); }
  if (!a) return false;
  approvals.delete(key);
  a({ decision, edits });
  return true;
}
function pending() { return [...approvals.keys()]; }

async function mediaUrlFor(j, it) {
  if (it.mediaUrl) return it.mediaUrl;
  it.step = 'Uploading file for Buffer'; emit(j);
  log(j, `Uploading ${it.name} to media hosting`, 'info', it.id);
  const lastDue = it.dueAt && !['now', 'draft'].includes(it.dueAt) ? new Date(it.dueAt).getTime() : Date.now();
  const keepDays = Math.max(store.get().hosting.deleteAfterDays || 10, Math.ceil((lastDue - Date.now()) / 86400000) + 3);
  it.mediaUrl = await hosting.upload(it.file, { keepDays, signal: current.abort.signal, onProgress: (p) => { it.step = `Uploading ${Math.round((p.completed / Math.max(1, p.total)) * 100)}%`; ev.emit('update', view(j)); } });
  save(j);
  return it.mediaUrl;
}

let lastPostAt = 0;
const postTimes = [];
async function rateLimit() {
  const s = store.get();
  const gap = (s.minPostGapSec || 0) * 1000 - (Date.now() - lastPostAt);
  if (gap > 0) await sleep(gap);
  const hourAgo = Date.now() - 3600000;
  while (postTimes.length && postTimes[0] < hourAgo) postTimes.shift();
  if (postTimes.length >= (s.maxPostsPerHour || 60)) await sleep(postTimes[0] + 3600000 - Date.now());
  lastPostAt = Date.now();
  postTimes.push(lastPostAt);
}

function alreadyPosted(file, key) {
  return history.all().some((h) => h.file === file && h.targetKey === key && h.status === 'done');
}
// scheduled posts still waiting in this channel's queue (free Buffer: about 10 per channel)
function queueUsed(key) {
  const now = Date.now();
  return history.all().filter((h) => h.targetKey === key && h.status === 'done' && h.dueAt && h.dueAt !== 'now' && new Date(h.dueAt).getTime() > now).length;
}
/* ---------------- retry, sign-in blocks, verification ---------------- */
let RETRY_WAITS = [20000, 60000]; // two silent retries after 20 s and 60 s
let VERIFY_GAP = 4000; // wait before the second read of a queue
// failures that usually go away on their own (the next attempt opens a fresh browser window)
const TRANSIENT = /timed out|timeout|did not open|not open|could not find|did not appear|composer|upload|stalled|pop-?up|network|net::|ERR_|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|target closed|destroyed|detached|step limit|stuck repeating|too many errors|no usable actions|no confirmation|could not select|could not read|page script error|is gone|did not open with|loading/i;
// failures a retry cannot fix (Buffer or the site said no, or a person is needed)
const NOT_TRANSIENT = /not signed in|captcha|invalid post|limit[^.]*reached|too (large|big)|unsupported|cannot contain|cannot exceed|rejected|was removed|not connected|API key|^Buffer:|does not support/i;
function isTransient(reason) { const s = String(reason || ''); return !NOT_TRANSIENT.test(s) && TRANSIENT.test(s); }
async function pauseSleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { check(); await waitIfPaused(); await sleep(Math.max(0, Math.min(500, end - Date.now()))); }
}
// run() does one posting attempt and returns {ok, reason, needUser, ...}. Transient failures are tried again silently (log lines only).
// precheck() answers "is the post already in Buffer?" and runs before every retry, so a post that was saved but not confirmed is never posted twice.
async function runWithRetry(j, it, t, run, precheck) {
  let r;
  for (let n = 0; ; n++) {
    check(); await waitIfPaused();
    try { r = await run(); } catch (e) { if (e.message === 'ABORTED') throw e; r = { ok: false, reason: e.message }; }
    r = r || { ok: false, reason: 'No result from the browser.' };
    r.attempts = n + 1;
    if (r.ok || r.needUser || r.needFallback || n >= RETRY_WAITS.length || store.get().autoRetry === false || !isTransient(r.reason)) return r;
    log(j, `${it.name} -> ${targetLabel(t)}: ${String(r.reason).slice(0, 160)} (attempt ${n + 1}); trying again in ${Math.round(RETRY_WAITS[n] / 1000)} s with a fresh browser`, 'info', it.id);
    await pauseSleep(RETRY_WAITS[n]);
    if (precheck) {
      let hit = null;
      try { hit = await precheck(); } catch (_) { hit = null; }
      if (hit === true) return { ok: true, note: 'found in Buffer after an unconfirmed attempt', preverified: true, attempts: n + 1 };
    }
  }
}
function announce(j, key, label, reason) {
  if (!current) return;
  current.blocked.set(key, reason);
  if (current.attended.has(key)) return; // one alert per account per job
  current.attended.add(key);
  ev.emit('attention', { job: view(j), reason: `${label}: ${reason}` });
}
const blockAccount = (j, acc, reason) => announce(j, acc.id, acc.name, reason);
const blockPlatform = (j, platform, reason) => announce(j, `browser:${platform}`, browser.PLATFORMS[platform]?.label || platform, reason);
// is this post in the Buffer channel's queue (or drafts)? true / false, or null when it cannot be checked (not Buffer, shared "now", no text, page not readable)
async function findInBuffer(j, t, it, cap) {
  try {
    if (store.get().verifyPosts === false || store.get().autoVerify === false || t.type !== 'account' || it.dueAt === 'now') return null;
    const acc = accounts.get(t.accountId);
    const ch = acc?.kind === 'buffer' ? (acc.channels || []).find((c) => c.id === t.channelId || c.name === t.channelName) : null;
    if (!ch?.bufferId) return null;
    const due = it.dueAt && !['now', 'draft'].includes(it.dueAt) ? it.dueAt : null;
    const r = await bq.verify({ partition: acc.partition, channelId: ch.bufferId, view: it.dueAt === 'draft' ? 'drafts' : 'schedule', text: cap.text, title: cap.title, dueAt: due, gapMs: VERIFY_GAP });
    return r.found;
  } catch (e) {
    if (e.message === 'ABORTED') throw e;
    log(j, `${it.name}: could not read the Buffer queue to confirm (${String(e.message).slice(0, 120)})`, 'info', it.id);
    return null;
  }
}

async function postOne(j, it, t, res) {
  const cap = it.captions.platforms[captionKey(t)] || Object.values(it.captions.platforms)[0];
  const o = j.options || {};
  const key = targetKey(t);
  if (!o.allowRepost && it.file && alreadyPosted(it.file, key)) {
    Object.assign(res, { status: 'skipped', error: 'already posted to this channel before', at: Date.now() });
    log(j, `${it.name} -> ${targetLabel(t)}: skipped, it was already posted there`, 'warn', it.id);
    return;
  }
  if (t.type === 'account') {
    const acc = accounts.get(t.accountId);
    if (!acc) throw new Error(`Account "${t.accountName}" was removed.`);
    // this account needs a sign-in (already reported once): the other accounts of the job go on
    if (current?.blocked.has(t.accountId)) {
      Object.assign(res, { status: 'needs_user', error: current.blocked.get(t.accountId), at: Date.now() });
      log(j, `${it.name} -> ${targetLabel(t)}: skipped, ${acc.name} needs a sign-in first`, 'warn', it.id);
      return;
    }
    if (acc.queueLimit && it.dueAt && !['now', 'draft'].includes(it.dueAt) && queueUsed(key) >= acc.queueLimit) {
      Object.assign(res, { status: 'waiting_slot', error: `queue full (${acc.queueLimit} scheduled). Resume when some are published.`, at: Date.now() });
      log(j, `${it.name} -> ${targetLabel(t)}: queue is full, kept for later`, 'warn', it.id);
      return;
    }
  }
  if (t.type === 'browser' && current?.blocked.has(`browser:${t.platform}`)) {
    Object.assign(res, { status: 'needs_user', error: current.blocked.get(`browser:${t.platform}`), at: Date.now() });
    log(j, `${it.name} -> ${targetLabel(t)}: skipped, sign in first`, 'warn', it.id);
    return;
  }
  // the app closed while this post was in the browser: if it is already in Buffer it must not be posted again
  let settled = false;
  if (res.maybePosted) {
    delete res.maybePosted;
    if (t.type === 'account' && it.dueAt === 'now') {
      Object.assign(res, { status: 'done', verified: null, note: 'was being shared when the app closed; not shared again (check Buffer)', at: Date.now() }); settled = true;
      log(j, `${it.name} -> ${targetLabel(t)}: ${res.note}`, 'warn', it.id);
    } else if (t.type === 'account') {
      const v = await findInBuffer(j, t, it, cap);
      if (v === true) {
        Object.assign(res, { status: 'done', verified: true, note: 'found in Buffer after the restart, not posted again', dueAt: it.dueAt && !['now', 'draft'].includes(it.dueAt) ? it.dueAt : null, at: Date.now() }); settled = true;
        log(j, `${it.name} -> ${targetLabel(t)}: ${res.note}`, 'ok', it.id);
      }
    }
  }
  if (!settled) await rateLimit();
  if (t.type === 'account' && !settled) {
    const acc = accounts.get(t.accountId);
    it.step = `Posting via ${acc.name}${t.channelName ? ` to ${t.channelName}` : ''}`; emit(j);
    const due = it.dueAt && !['now', 'draft'].includes(it.dueAt) ? it.dueAt : null;
    const ch = (acc.channels || []).find((c) => c.id === t.channelId || c.name === t.channelName);
    const startUrl = acc.kind === 'buffer' && ch?.bufferId ? `https://publish.buffer.com/channels/${ch.bufferId}/schedule` : undefined;
    const run = () => browser.postTask({ mode: it.dueAt === 'draft' ? 'draft' : it.dueAt === 'now' ? 'now' : '', category: o.youtubeCategoryName || 'Entertainment', startUrl, platform: acc.kind, partition: acc.partition, channel: t.channelName ? { name: t.channelName, service: t.service } : null, allChannels: (acc.channels || []).map((c) => c.name), file: it.file, kind: it.kind, title: cap.title, text: cap.text, tags: cap.keywords, firstComment: cap.first_comment, dueAt: due, dueText: due ? sched.human(due) : '', extra: [it.dueAt === 'draft' ? 'Save it as a draft, do not publish or schedule.' : '', (t.service || '') === 'youtube' ? `If there is a YouTube Category field, set it to "${o.youtubeCategoryName || 'Entertainment'}". Keep Visibility as it is unless told otherwise.` : '', o.browserExtra || ''].filter(Boolean).join(' ') },
      { signal: current.abort.signal, waitIfPaused, onLog: (x) => log(j, `  ${x}`, 'info', it.id), onFrame: (b64) => ev.emit('frame', { jobId: j.id, itemId: it.id, image: b64 }) });
    res.inflight = Date.now(); save(j, true);
    let r = await runWithRetry(j, it, t, run, () => findInBuffer(j, t, it, cap));
    let verified = r.ok ? (r.preverified ? true : await findInBuffer(j, t, it, cap)) : null;
    // saved but not in the queue after two reads: post once more (the queue was just read, so this cannot duplicate)
    if (r.ok && verified === false && !res.verifyRetried) {
      res.verifyRetried = true;
      log(j, `${it.name} -> ${targetLabel(t)}: not found in Buffer after saving, posting it once more`, 'warn', it.id);
      r = await runWithRetry(j, it, t, run, () => findInBuffer(j, t, it, cap));
      verified = r.ok ? (r.preverified ? true : await findInBuffer(j, t, it, cap)) : null;
    }
    delete res.inflight;
    if (r.ok) {
      Object.assign(res, { status: 'done', url: r.url, note: r.note, dueAt: due, verified, attempts: r.attempts, at: Date.now() });
      log(j, `${it.name} -> ${targetLabel(t)}: ${r.note || 'done'}${verified === true ? ' (verified in Buffer)' : ''}`, 'ok', it.id);
      if (verified === false) log(j, `${it.name} -> ${targetLabel(t)}: could not find the post in Buffer to confirm it. Check the channel.`, 'warn', it.id);
    } else {
      Object.assign(res, { status: r.needUser ? 'needs_user' : 'failed', error: r.reason, attempts: r.attempts, at: Date.now() });
      log(j, `${it.name} -> ${targetLabel(t)}: ${r.reason}`, r.needUser ? 'warn' : 'err', it.id);
      if (r.needUser) blockAccount(j, acc, r.reason);
    }
  } else if (t.type === 'buffer') {
    const url = it.file ? await mediaUrlFor(j, it) : null;
    it.step = `Scheduling on ${t.name}`; emit(j);
    const due = it.dueAt === 'draft' ? null : it.dueAt;
    const r = await buffer.createPost({
      channelId: t.channelId, service: t.service, text: cap.text, title: cap.title, kind: it.kind, mediaUrl: url, dueAt: due,
      draft: it.dueAt === 'draft' || !!o.draft, firstComment: cap.first_comment, vertical: it.analysis?.orientation === 'vertical',
      youtubeCategory: o.youtubeCategory, youtubePrivacy: o.youtubePrivacy, igType: o.igType, fbType: o.fbType, aiGenerated: o.aiGenerated
    }, { signal: current.abort.signal });
    Object.assign(res, { status: 'done', postId: r.id, dueAt: r.dueAt || due, at: Date.now(), url: 'https://publish.buffer.com/' });
    log(j, `Buffer: ${it.name} -> ${t.name} ${r.dueAt ? `scheduled for ${sched.human(r.dueAt)}` : due === 'now' ? 'sharing now' : 'added to queue'}`, 'ok', it.id);
  } else if (t.type !== 'account') {
    it.step = `Posting on ${browser.PLATFORMS[t.platform]?.label || t.platform}`; emit(j);
    const due = it.dueAt && !['now', 'draft'].includes(it.dueAt) ? it.dueAt : null;
    const r = await runWithRetry(j, it, t, () => browser.postTask({ platform: t.platform, file: it.file, kind: it.kind, title: cap.title, text: cap.text, tags: cap.keywords, firstComment: cap.first_comment, dueAt: due, dueText: due ? sched.human(due) : '', extra: o.browserExtra },
      { signal: current.abort.signal, waitIfPaused, onLog: (x) => log(j, `  ${x}`, 'info', it.id), onFrame: (b64) => ev.emit('frame', { jobId: j.id, itemId: it.id, image: b64 }) }), null);
    if (r.ok) { Object.assign(res, { status: 'done', url: r.url, note: r.note, dueAt: due, verified: null, attempts: r.attempts, at: Date.now() }); log(j, `${it.name} -> ${targetLabel(t)}: ${r.note || 'done'}`, 'ok', it.id); }
    else { Object.assign(res, { status: r.needUser ? 'needs_user' : 'failed', error: r.reason, attempts: r.attempts, at: Date.now() }); log(j, `${it.name} -> ${targetLabel(t)}: ${r.reason}`, r.needUser ? 'warn' : 'err', it.id); if (r.needUser) blockPlatform(j, t.platform, r.reason); }
  }
  ev.emit('result', { jobId: j.id, workflowId: j.workflowId || null, file: it.file, target: key, label: res.label, status: res.status, dueAt: res.dueAt || it.dueAt || null, url: res.url || '', error: res.error || '', caption: cap.text.slice(0, 200), verified: res.verified ?? null });
  const h = history.all();
  h.unshift({ targetKey: key, at: Date.now(), jobId: j.id, file: it.file, name: it.name, target: res.label, status: res.status, url: res.url || '', postId: res.postId || '', dueAt: res.dueAt || it.dueAt || null, title: cap.title || '', text: cap.text.slice(0, 600), error: res.error || '', verified: res.verified ?? null });
  history.save(h.slice(0, 5000));
}

// one composer for all pending channels of the same Buffer account (one upload instead of one per channel)
async function postBufferGroup(j, it, members) {
  const o = j.options || {};
  const acc = accounts.get(members[0].t.accountId);
  if (!acc || acc.kind !== 'buffer' || current?.blocked.has(acc.id)) return;
  const ok = [];
  for (const m of members) {
    const key = targetKey(m.t);
    if (!o.allowRepost && it.file && alreadyPosted(it.file, key)) continue; // the single path reports it
    if (acc.queueLimit && it.dueAt && !['now', 'draft'].includes(it.dueAt) && queueUsed(key) >= acc.queueLimit) continue;
    const ch = (acc.channels || []).find((c) => c.id === m.t.channelId || c.name === m.t.channelName);
    if (!ch?.bufferId) continue;
    ok.push({ ...m, ch });
  }
  if (ok.length < 2) return;
  if (ok.some((m) => it.results[m.ti].maybePosted)) return; // interrupted earlier: the single path checks the queue before posting
  await rateLimit();
  const due = it.dueAt && !['now', 'draft'].includes(it.dueAt) ? it.dueAt : null;
  const captions = {};
  for (const m of ok) captions[m.t.service] = it.captions.platforms[captionKey(m.t)] || Object.values(it.captions.platforms)[0];
  it.step = `Posting to ${ok.length} channels of ${acc.name} in one go`; emit(j);
  log(j, `${it.name} -> ${ok.map((m) => m.t.channelName).join(', ')}: one composer, one upload`, 'info', it.id);
  const capOf = (m) => captions[m.t.service];
  const run = () => browser.postTask({ mode: it.dueAt === 'draft' ? 'draft' : it.dueAt === 'now' ? 'now' : '', category: o.youtubeCategoryName || 'Entertainment', startUrl: `https://publish.buffer.com/channels/${ok[0].ch.bufferId}/schedule`, platform: 'buffer', partition: acc.partition, channels: ok.map((m) => ({ name: m.t.channelName, service: m.t.service })), captions, file: it.file, kind: it.kind, dueAt: due, dueText: due ? sched.human(due) : '' },
    { signal: current.abort.signal, waitIfPaused, onLog: (x) => log(j, `  ${x}`, 'info', it.id), onFrame: (b64) => ev.emit('frame', { jobId: j.id, itemId: it.id, image: b64 }) });
  const allThere = async () => { for (const m of ok) if ((await findInBuffer(j, m.t, it, capOf(m))) !== true) return false; return true; };
  for (const m of ok) it.results[m.ti].inflight = Date.now();
  save(j, true);
  const r = await runWithRetry(j, it, ok[0].t, run, allThere);
  for (const m of ok) delete it.results[m.ti].inflight;
  if (r.needFallback) { log(j, `${it.name}: falling back to one channel at a time`, 'warn', it.id); return; }
  if (!r.ok && !r.needUser) {
    // the group did not work: the channels go one at a time, and each one checks the queue first (the group may have saved some)
    if (it.dueAt !== 'now') for (const m of ok) it.results[m.ti].maybePosted = true;
    log(j, `${it.name}: group post failed (${r.reason}); posting one channel at a time`, 'warn', it.id);
    return;
  }
  for (const m of ok) {
    const res = it.results[m.ti];
    const cap = capOf(m);
    let verified = null;
    if (r.ok) {
      verified = r.preverified ? true : await findInBuffer(j, m.t, it, cap);
      // saved but not found: this channel is posted again on its own (the queue was just read twice, so this cannot duplicate)
      if (verified === false && !res.verifyRetried) {
        res.verifyRetried = true; res.status = 'pending'; res.verified = false;
        log(j, `${it.name} -> ${targetLabel(m.t)}: not found in Buffer after saving, posting this channel again`, 'warn', it.id);
        continue;
      }
      Object.assign(res, { status: 'done', note: r.note, dueAt: due, verified, attempts: r.attempts, at: Date.now(), url: 'https://publish.buffer.com/' });
    } else Object.assign(res, { status: 'needs_user', error: r.reason, attempts: r.attempts, at: Date.now() });
    ev.emit('result', { jobId: j.id, workflowId: j.workflowId || null, file: it.file, target: targetKey(m.t), label: res.label, status: res.status, dueAt: res.dueAt || it.dueAt || null, url: res.url || '', error: res.error || '', caption: cap.text.slice(0, 200), verified: res.verified ?? null });
    const h = history.all();
    h.unshift({ targetKey: targetKey(m.t), at: Date.now(), jobId: j.id, file: it.file, name: it.name, target: res.label, status: res.status, url: res.url || '', postId: '', dueAt: res.dueAt || it.dueAt || null, title: cap.title || '', text: cap.text.slice(0, 600), error: res.error || '', verified: res.verified ?? null });
    history.save(h.slice(0, 5000));
  }
  log(j, r.ok ? `${it.name}: ${ok.length} channels done (${r.note || 'ok'})` : `${it.name}: ${r.reason}`, r.ok ? 'ok' : 'warn', it.id);
  if (!r.ok && r.needUser) blockAccount(j, acc, r.reason);
}

async function run(j) {
  const signal = current.abort.signal;
  j.status = 'preparing';
  j.startedAt = j.startedAt || Date.now();
  log(j, 'Started');
  emit(j);
  // live sign-in check of every account this job posts through (a saved "Signed in" flag can be old)
  try {
    const ids = [...new Set((j.targets || []).filter((t) => t.type === 'account').map((t) => t.accountId))];
    for (const id of ids) {
      const a = accounts.get(id);
      if (!a || a.kind !== 'buffer' || (a.lastCheck && Date.now() - a.lastCheck < 120000 && a.loggedIn)) continue;
      log(j, `Checking the sign-in of ${a.name}`);
      const r = await accounts.refresh(id);
      if (!r.loggedIn) announce(j, id, a.name, `${a.name} is not signed in. Accounts > ${a.name} > Open, sign in once, then retry.`);
    }
  } catch (_) { /* the post itself reports a missing sign-in */ }
  const needsWork = (it) => !(it.stage === 'skipped' || it.results.every((r) => r.status === 'done' || r.status === 'skipped'));
  // Pipeline: when nobody has to approve anything first (autopilot, or approved already), item i+1 is analyzed and captioned
  // in the background while item i is in the browser (one item ahead at most). Otherwise every item is prepared first.
  const pipelined = () => j.approval === 'autopilot' || (j.approval === 'once' && j.approved);
  const prep = new Map(); // item id -> promise of {aborted?, error?}; never rejects
  const startPrep = (it) => {
    if (!prep.has(it.id)) {
      prep.set(it.id, (async () => {
        try { check(); await waitIfPaused(); await prepareItem(j, it, signal); return {}; } catch (e) {
          if (e.message === 'ABORTED') { it.stage = it.captions ? 'ready' : 'pending'; return { aborted: true }; }
          // a failed prefetch is recorded on this item only; the post that is running is not affected
          it.stage = 'failed'; it.error = e.message; it.results.forEach((r) => { if (r.status === 'pending') { r.status = 'failed'; r.error = e.message; } });
          log(j, `${it.name}: ${e.message}`, 'err', it.id); emit(j);
          return { error: e.message };
        }
      })());
    }
    return prep.get(it.id);
  };
  const ensure = async (it) => { const r = await startPrep(it); if (r.aborted) throw new Error('ABORTED'); return r; };
  const nextIdx = (from) => { for (let k = from; k < j.items.length; k++) if (needsWork(j.items[k]) && j.items[k].stage !== 'failed') return k; return -1; };
  try {
  // 1. analyze + captions for every item (when the order does not allow overlapping)
  if (!pipelined()) for (const it of j.items) {
    if (!needsWork(it)) continue;
    check(); await waitIfPaused();
    await ensure(it);
  }
  // 2. approval for the whole job
  if (j.approval === 'once' && !j.approved && j.items.some((it) => it.stage === 'ready')) {
    j.status = 'awaiting_approval';
    log(j, 'Waiting for your approval of all captions and times', 'warn');
    emit(j, 'needs_approval');
    const a = await waitApproval(j.id, j);
    if (a.decision === 'stop' || a.decision === 'no') throw new Error('ABORTED');
    j.approved = true;
    log(j, 'Approved', 'ok');
  }
  // 3. post
  j.status = 'running';
  emit(j);
  for (let idx = 0; idx < j.items.length; idx++) {
    const it = j.items[idx];
    if (it.stage === 'skipped' || it.stage === 'failed') continue;
    if (it.results.every((r) => r.status === 'done' || r.status === 'skipped')) { it.stage = 'done'; continue; }
    check(); await waitIfPaused();
    if (pipelined()) {
      await ensure(it); // this item's own preparation (already running when it was prefetched)
      if (it.stage === 'failed') continue;
      const nx = nextIdx(idx + 1);
      if (nx >= 0) startPrep(j.items[nx]); // the next item is prepared while this one is posting
    }
    if (j.approval === 'every' && !it.approved) {
      it.stage = 'awaiting'; j.status = 'awaiting_approval';
      emit(j, 'needs_approval');
      const a = await waitApproval(`${j.id}:${it.id}`, j);
      if (a.decision === 'stop') throw new Error('ABORTED');
      j.status = 'running';
      if (a.decision === 'skip' || a.decision === 'no' || it.stage === 'skipped') { it.stage = 'skipped'; it.results.forEach((r) => { if (r.status === 'pending') r.status = 'skipped'; }); log(j, `${it.name}: skipped`, 'warn', it.id); emit(j); continue; }
      if (a.decision === 'all') { j.approval = 'autopilot'; log(j, 'Approved this and all remaining posts', 'ok'); }
      it.approved = true;
    }
    it.stage = 'posting'; emit(j);
    // channels of the same Buffer account go together (one composer, one upload)
    const groups = new Map();
    for (const [ti, t] of j.targets.entries()) if (t.type === 'account' && it.results[ti].status === 'pending') { const k = t.accountId; if (!groups.has(k)) groups.set(k, []); groups.get(k).push({ t, ti }); }
    for (const members of groups.values()) {
      if (members.length < 2 || j.options?.noGroup) continue;
      check(); await waitIfPaused();
      try { await postBufferGroup(j, it, members); } catch (e) {
        if (e.message === 'ABORTED') throw e;
        log(j, `${it.name}: group post stopped (${e.message}); posting one channel at a time`, 'warn', it.id);
      }
      emit(j);
    }
    for (const [ti, t] of j.targets.entries()) {
      const res = it.results[ti];
      if (res.status === 'done' || res.status === 'skipped') continue;
      check(); await waitIfPaused();
      try { await postOne(j, it, t, res); } catch (e) {
        if (e.message === 'ABORTED') throw e;
        Object.assign(res, { status: 'failed', error: e.message, at: Date.now() });
        log(j, `${it.name} -> ${targetLabel(t)}: ${e.message}`, 'err', it.id);
        // configuration problems will fail for every item: stop early
        if (/not connected|API key|media hosting|publicly reachable|Buffer rejected|was removed/i.test(e.message)) {
          for (const it2 of j.items) for (const r2 of it2.results) if (r2.status === 'pending' && r2.target === res.target) { r2.status = 'failed'; r2.error = e.message; }
        }
      }
      emit(j);
    }
    it.step = '';
    it.stage = it.results.every((r) => r.status === 'done' || r.status === 'skipped') ? 'done' : it.results.some((r) => r.status === 'done') ? 'partial' : 'failed';
    emit(j);
  }
  } finally {
    await Promise.all([...prep.values()]); // no background preparation outlives the job
  }
  const all = j.items.flatMap((it) => it.results);
  const ok = all.filter((r) => r.status === 'done').length;
  j.status = ok === all.filter((r) => r.status !== 'skipped').length ? 'done' : ok ? 'partial' : 'failed';
  j.finishedAt = Date.now();
  log(j, `Finished: ${ok} of ${all.length} posts done.`, j.status === 'done' ? 'ok' : 'warn');
  hosting.cleanup().catch(() => {});
}

/* ---------------- controls ---------------- */
function pause(id) { if (current?.id === id && !current.paused) { current.paused = true; const j = jobs.get(id); j.status = 'paused'; log(j, 'Paused', 'warn'); emit(j); } return view(jobs.get(id)); }
function resume(id) {
  const j = jobs.get(id);
  if (!j) throw new Error('Job not found');
  if (current?.id === id && current.paused) {
    current.paused = false; j.status = j.approved || j.approval !== 'once' ? 'running' : 'preparing'; log(j, 'Resumed', 'ok');
    const w = current.waiters.splice(0); w.forEach((f) => f()); emit(j);
    return view(j);
  }
  if (['interrupted', 'stopped', 'failed', 'partial'].includes(j.status)) {
    // retry what is not done
    for (const it of j.items) {
      if (it.stage === 'failed' && !it.captions) { it.stage = 'pending'; it.error = null; }
      for (const r of it.results) if (['failed', 'needs_user', 'waiting_slot'].includes(r.status)) { r.status = 'pending'; r.error = null; }
      if (['failed', 'partial'].includes(it.stage)) it.stage = it.captions ? 'ready' : 'pending';
    }
    log(j, 'Retrying the posts that are not done', 'info');
    return enqueue(id);
  }
  return view(j);
}
function stop(id) {
  if (current?.id === id) { current.abort.abort(new Error('ABORTED')); const w = current.waiters.splice(0); w.forEach((f) => f()); }
  const qi = queue.indexOf(id);
  if (qi >= 0) { queue.splice(qi, 1); const j = jobs.get(id); j.status = 'stopped'; emit(j); }
  return view(jobs.get(id));
}
function remove(id) {
  if (current?.id === id) throw new Error('Stop the job first.');
  const qi = queue.indexOf(id); if (qi >= 0) queue.splice(qi, 1);
  jobs.delete(id);
  try { fs.unlinkSync(jfile(id)); } catch (_) { /* gone */ }
}
function updateItem(id, itemId, patch) {
  const j = jobs.get(id);
  const it = j?.items.find((x) => x.id === itemId);
  if (!it) throw new Error('Item not found');
  applyEdits(j, { items: [{ id: itemId, ...patch }] });
  if (patch.rewrite) { it.captions = null; it.stage = 'pending'; }
  emit(j);
  return view(j);
}
function list() { return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map((j) => { const v = view(j); return { ...v, log: undefined, items: v.items.map(({ analysis, ...it }) => ({ ...it, analysis: analysis ? { language: analysis.language, hasSpeech: analysis.hasSpeech, frame: analysis.frame } : null })) }; }); }
function get(id) { return view(jobs.get(id)); }
const isBusy = () => !!current;

// test hooks: short waits instead of 20 s / 60 s
function _tune({ retryWaits, verifyGap } = {}) { if (retryWaits) RETRY_WAITS = retryWaits; if (verifyGap != null) VERIFY_GAP = verifyGap; }
module.exports = { _tune, resumeInterrupted, queued: () => queue.length > 0, on: (e, f) => ev.on(e, f), load, create, createSplit, splitPlan, list, get, pause, resume, stop, remove, approve, pending, updateItem, isBusy, history: () => history.all(), clearHistory: () => history.save([]), captionKey, targetLabel, ctl };
