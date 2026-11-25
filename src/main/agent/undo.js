// Undo a posting job: delete exactly the posts that job created on Buffer, never anything else.
// A post is only deleted when its caption (kept in the post history as a text snapshot) is found in that channel's
// list and no other post with the same text could be mixed up with it. Everything unclear is skipped and reported.
const store = require('../store');
const jobs = require('../posting/jobs');
const accounts = require('../posting/accounts');

const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
const keyOf = (t) => norm(t).slice(0, 40);
const timeNorm = (t) => String(t || '').replace(/\s+/g, '').replace(/^0/, '').toUpperCase();
const clock = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : timeNorm(d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })); };
const undoneLog = () => store.collection('job-undo', {});

// what could be undone, without touching the network
function plan(id) {
  const j = jobs.get(id);
  if (!j) throw new Error('Job not found.');
  const done = new Set(((undoneLog().all() || {})[id]) || []);
  const hist = jobs.history().filter((x) => x.jobId === id && x.status === 'done');
  const items = [];
  for (const x of hist) {
    const row = { at: x.at, name: x.name || '', label: x.target || '', text: String(x.text || ''), dueAt: x.dueAt || null, targetKey: x.targetKey || '' };
    const m = /^acct:([^:]+):(.+)$/.exec(row.targetKey);
    if (done.has(x.at)) Object.assign(row, { action: 'skip', reason: 'already removed by an earlier undo' });
    else if (!m) Object.assign(row, { action: 'skip', reason: 'not made through a Buffer account, remove it by hand' });
    else if (m[2] === '-') Object.assign(row, { action: 'skip', reason: 'no channel is saved for this post' });
    else if (row.dueAt === 'now') Object.assign(row, { action: 'skip', reason: 'it was shared immediately, so it is already public' });
    else if (keyOf(row.text).length < 8) Object.assign(row, { action: 'skip', reason: 'the caption is too short to find it safely' });
    else {
      const acc = accounts.get(m[1]);
      if (!acc || acc.kind !== 'buffer') Object.assign(row, { action: 'skip', reason: 'the account is gone or is not a Buffer account' });
      else Object.assign(row, { action: 'delete', accountId: m[1], channelId: m[2], accountName: acc.name, view: row.dueAt === 'draft' ? 'drafts' : 'schedule' });
    }
    items.push(row);
  }
  return { job: { id: j.id, title: j.title, active: !!j.active }, items };
}
function preview(id) {
  const p = plan(id);
  return { job: p.job, willDelete: p.items.filter((i) => i.action === 'delete').map((i) => ({ name: i.name, label: i.label, view: i.view, dueAt: i.dueAt })), skipped: p.items.filter((i) => i.action === 'skip').map((i) => ({ name: i.name, label: i.label, reason: i.reason })) };
}

async function undo(id, { onStatus } = {}) {
  const p = plan(id);
  if (p.job.active) throw new Error('Stop the job first (or wait until it finishes), then undo it.');
  const results = [];
  for (const i of p.items) if (i.action === 'skip') results.push({ name: i.name, label: i.label, status: 'skipped', reason: i.reason });

  // group by account + channel + view: one page load per group
  const groups = new Map();
  for (const i of p.items.filter((x) => x.action === 'delete')) {
    const k = `${i.accountId}|${i.channelId}|${i.view}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }
  const removed = [];
  for (const [, rows] of groups) {
    const first = rows[0];
    const fail = (r, why) => results.push({ name: r.name, label: r.label, status: 'failed', reason: why });
    let list;
    try { list = await accounts.queueList(first.accountId, first.channelId, first.view); } catch (e) { for (const r of rows) fail(r, store.redact(e.message)); continue; }
    const used = new Set();
    const picks = [];
    for (const r of rows) {
      const k = keyOf(r.text);
      let m = list.filter((x) => !used.has(x.index) && norm(x.text).includes(k));
      const sameJob = rows.filter((o) => keyOf(o.text) === k).length;
      if (m.length > 1 && r.dueAt && !['draft', 'now'].includes(r.dueAt)) { const c = clock(r.dueAt); const byTime = m.filter((x) => timeNorm(x.time) === c); if (byTime.length) m = byTime; }
      if (!m.length) { results.push({ name: r.name, label: r.label, status: 'not_found', reason: 'it is not in the channel any more (already published or deleted)' }); continue; }
      const allSame = list.filter((x) => norm(x.text).includes(k)).length;
      if (allSame > sameJob) { results.push({ name: r.name, label: r.label, status: 'skipped', reason: 'another post with the same text exists that this job did not make, so nothing was deleted' }); continue; }
      used.add(m[0].index);
      picks.push({ row: r, post: m[0] });
    }
    if (!picks.length) continue;
    let rem = { deleted: 0, failed: 0 };
    try { rem = await accounts.queueRemove(first.accountId, first.channelId, first.view, picks.map((x) => x.post), onStatus); } catch (e) { for (const x of picks) fail(x.row, store.redact(e.message)); continue; }
    let stillThere = null;
    if (rem.failed) { try { stillThere = await accounts.queueList(first.accountId, first.channelId, first.view); } catch (_) { stillThere = null; } }
    for (const x of picks) {
      const k = keyOf(x.row.text);
      const gone = rem.failed === 0 ? true : stillThere ? !stillThere.some((s) => norm(s.text).includes(k) && (!x.post.time || timeNorm(s.time) === timeNorm(x.post.time))) : false;
      if (gone) { results.push({ name: x.row.name, label: x.row.label, status: 'deleted', reason: '' }); removed.push(x.row.at); }
      else fail(x.row, 'Buffer did not remove it. Delete it by hand in Accounts > Manage posts.');
    }
  }
  if (removed.length) {
    const log = undoneLog(); const all = log.all() || {};
    all[id] = [...new Set([...(all[id] || []), ...removed])].slice(-2000);
    log.save(all);
  }
  const count = (s) => results.filter((r) => r.status === s).length;
  return { jobId: id, title: p.job.title, deleted: count('deleted'), failed: count('failed'), notFound: count('not_found'), skipped: count('skipped'), results };
}

function describeResult(r) {
  return `Undo of "${r.title}": ${r.deleted} deleted, ${r.failed} failed, ${r.notFound} not found, ${r.skipped} skipped.\n${r.results.map((x) => `- ${x.name} -> ${x.label}: ${x.status}${x.reason ? ` (${x.reason})` : ''}`).join('\n')}`;
}

module.exports = { preview, undo, describeResult };
