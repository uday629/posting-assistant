// Storage cleanup: removes caches and app data from a time range (last 15 days, last month, last 6 months, all, or
// custom dates). Never touches settings, keys, account sign-ins, skills, styles, formats, knowledge or speech models.
// Caches are deleted; your own content (chats, saved posts, studies) goes to the Recycle Bin.
const fs = require('fs');
const path = require('path');
const { shell, session } = require('electron');
const store = require('./store');
const paths = require('./paths');

const DAY = 86400000;
function range({ preset, from, to }) {
  const now = Date.now();
  if (preset === '15d') return [now - 15 * DAY, now + DAY];
  if (preset === '30d') return [now - 30 * DAY, now + DAY];
  if (preset === '6m') return [now - 182 * DAY, now + DAY];
  if (preset === 'all') return [0, now + DAY];
  const a = from ? new Date(`${from}T00:00:00`).getTime() : 0;
  const b = to ? new Date(`${to}T23:59:59`).getTime() : now + DAY;
  if (isNaN(a) || isNaN(b) || a > b) throw new Error('Pick a valid date range.');
  return [a, b];
}
function sizeOf(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isDirectory()) return st.size;
    let n = 0;
    for (const e of fs.readdirSync(p)) n += sizeOf(path.join(p, e));
    return n;
  } catch (_) { return 0; }
}
function entries(dir, filter = () => true) {
  try { return fs.readdirSync(dir).filter(filter).map((n) => { const p = path.join(dir, n); const st = fs.statSync(p); return { p, t: st.mtimeMs }; }); } catch (_) { return []; }
}
const inRange = (t, [a, b]) => t >= a && t <= b;

// each category lists the files/folders it would remove in the range
const CATS = {
  mediaCache: { label: 'Video analysis cache (transcripts, frames)', trash: false, list: (r) => entries(paths.sub('media-cache')).filter((e) => inRange(e.t, r)) },
  temp: { label: 'Temporary files, downloads, old logs', trash: false, list: (r) => [
    ...entries(paths.sub('tmp')), ...entries(paths.sub('downloads')), ...entries(path.join(paths.dataRoot(), '.app', 'temp')),
    ...entries(paths.sub('logs'), (n) => /\.old$|\.log\.\d+$/.test(n))
  ].filter((e) => inRange(e.t, r)) },
  browserCache: { label: 'Browser cache (sign-ins are kept)', trash: false, special: true, list: () => [] },
  chats: { label: 'Assistant chats', trash: true, list: (r) => entries(paths.sub('chats'), (n) => n.endsWith('.json')).filter((e) => inRange(e.t, r)) },
  writer: { label: 'Writer chats', trash: true, list: (r) => entries(store.get().writerDir || paths.sub('writer'), (n) => n.endsWith('.chat.json')).filter((e) => inRange(e.t, r)) },
  jobs: { label: 'Finished posting jobs (scheduled posts stay scheduled)', trash: false, list: (r) => entries(paths.sub('jobs'), (n) => n.endsWith('.json')).filter((e) => inRange(e.t, r) && !/"status":\s*"(running|preparing|queued|paused|awaiting_approval)"/.test(fs.readFileSync(e.p, 'utf8').slice(0, 4000))) },
  history: { label: 'Post history list', trash: false, special: true, list: () => [] },
  studies: { label: 'Competitor studies', trash: true, list: (r) => entries(paths.sub('studies')).filter((e) => inRange(e.t, r)) },
  drafts: { label: 'Saved posts', trash: true, list: (r) => entries(store.get().draftsDir || paths.sub('drafts'), (n) => /\.(md|txt)$/i.test(n)).filter((e) => inRange(e.t, r)) }
};

async function browserCacheSize() {
  let n = 0;
  const base = path.join(paths.dataRoot(), '.app');
  const walk = (d, depth) => {
    if (depth > 4) return;
    for (const e of entries(d)) {
      const name = path.basename(e.p);
      if (/^(Cache|Code Cache|GPUCache|DawnGraphiteCache|DawnWebGPUCache|Service Worker)$/i.test(name)) n += sizeOf(e.p);
      else { try { if (fs.statSync(e.p).isDirectory()) walk(e.p, depth + 1); } catch (_) { /* skip */ } }
    }
  };
  walk(base, 0);
  return n;
}
function historyCount(r) { return store.collection('post-history', []).all().filter((h) => inRange(h.at, r)).length; }

async function preview(opts) {
  const r = range(opts);
  const out = {};
  for (const [k, c] of Object.entries(CATS)) {
    if (k === 'browserCache') { out[k] = { label: c.label, count: null, bytes: await browserCacheSize() }; continue; }
    if (k === 'history') { out[k] = { label: c.label, count: historyCount(r), bytes: 0 }; continue; }
    const items = c.list(r);
    out[k] = { label: c.label, count: items.length, bytes: items.reduce((a, e) => a + sizeOf(e.p), 0), trash: c.trash };
  }
  return out;
}

// cats: array of category keys chosen by the user
async function clean(opts, cats) {
  const r = range(opts);
  const done = {};
  for (const k of cats || []) {
    const c = CATS[k];
    if (!c) continue;
    if (k === 'browserCache') {
      const parts = ['persist:social', 'persist:search', ...require('./posting/accounts').list().map((a) => a.partition)];
      for (const p of parts) { try { await session.fromPartition(p).clearCache(); } catch (_) { /* skip */ } }
      try { await session.defaultSession.clearCache(); } catch (_) { /* skip */ }
      done[k] = 'cleared';
      continue;
    }
    if (k === 'history') {
      const col = store.collection('post-history', []);
      const all = col.all();
      const keep = all.filter((h) => !inRange(h.at, r));
      col.save(keep);
      done[k] = all.length - keep.length;
      continue;
    }
    let n = 0;
    for (const e of c.list(r)) {
      // only inside folders this app owns or the user picked for it
      try {
        if (c.trash) await shell.trashItem(e.p);
        else fs.rmSync(e.p, { recursive: true, force: true });
        n++;
      } catch (_) { /* in use */ }
    }
    done[k] = n;
  }
  return done;
}

module.exports = { preview, clean, CATS };
