// One place that decides what the user is told, and how often. Keeps the UI calm when 30-40 accounts run unattended:
// - repeated 'attention' reasons of one job are merged into ONE alert that lists every account
// - a job that already has an open approval card or a recent alert does not get a second pop-up
// - quiet hours silence sounds, pop-ups and Windows notifications (jobs still run)
// - optional Telegram messages (failures needing a human, finished jobs, a daily summary)
const store = require('../store');
const telegram = require('./telegram');

const WINDOW_MS = 3500;                 // collect reasons of one job for this long, then show one alert
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // no second pop-up for the same job within this time
const TOLD_MS = 30 * 60 * 1000;          // the same reason is not announced again within this time

let d = null;                            // injected by main.js
const att = new Map();                   // jobId -> { reasons: [], told: Map(reason -> ts), timer, popupAt, title }
const approvalOpen = new Map();          // jobId -> Set(keys) of approvals the user was already told about

function init(deps) {
  d = deps;
  const t = setInterval(() => { try { dailyTick(); } catch (_) { /* never break the app */ } }, 60 * 1000);
  if (t.unref) t.unref();
}
const quiet = () => { try { return !!d.isQuiet(store.get()); } catch (_) { return false; } };
const tcfg = () => store.get().telegram || {};
const oneLine = (s, n = 240) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

/* ---------- approvals ---------- */
function onApproval(ev) {
  const job = ev.job || {};
  d.toRenderer('job:approval', ev);
  if (job.chatId) { try { d.approvalCard(job.chatId, ev.key, job); } catch (e) { d.log('approval card', e); } }
  const keys = approvalOpen.get(job.id) || new Set();
  const first = keys.size === 0;
  keys.add(ev.key);
  approvalOpen.set(job.id, keys);
  if (!first) return; // the approval for this job is already on screen: no second pop-up
  if (quiet()) return;
  if (store.get().alerts?.popup !== false && !d.windowFocused()) d.alerts.show({ title: 'Approval needed', text: `${job.title}: captions and times are ready for your check.`, level: 'warn' });
  else if (store.get().notifyDone) d.notify('Approve posts', `${job.title}: captions are ready for your check.`);
}
// called on every job update: forget the approval once the job moved on
function onUpdate(j) {
  if (!approvalOpen.has(j.id)) return;
  const waiting = j.status === 'awaiting_approval' || (j.items || []).some((it) => it.stage === 'awaiting');
  if (!waiting) approvalOpen.delete(j.id);
}

/* ---------- attention (something needs the user) ---------- */
function onAttention(ev) {
  const job = ev.job || {};
  const id = job.id || '_';
  const reason = oneLine(ev.reason);
  if (!reason) return;
  let e = att.get(id);
  if (!e) { e = { reasons: [], told: new Map(), timer: null, popupAt: 0, title: job.title || '' }; att.set(id, e); }
  const now = Date.now();
  for (const [k, ts] of e.told) if (now - ts > TOLD_MS) e.told.delete(k);
  if (e.told.has(reason) || e.reasons.includes(reason)) return;
  e.reasons.push(reason);
  if (job.title) e.title = job.title;
  if (!e.timer) e.timer = setTimeout(() => flush(id), WINDOW_MS);
}
function flush(id) {
  const e = att.get(id);
  if (!e) return;
  e.timer = null;
  const list = e.reasons.splice(0);
  if (!list.length) return;
  const now = Date.now();
  for (const r of list) e.told.set(r, now);
  const title = e.title || 'a posting job';
  const text = list.length === 1 ? list[0] : `${list.length} problems in "${title}": ${list.join('; ')}`;
  d.toRenderer('job:attention', { job: { id, title }, reason: text, reasons: list, quiet: quiet() });
  const approvalShown = approvalOpen.has(id);
  const recentPopup = now - e.popupAt < ALERT_COOLDOWN_MS;
  if (!quiet() && !approvalShown && !recentPopup) {
    e.popupAt = now;
    if (store.get().alerts?.popup !== false) d.alerts.show({ title: 'Posting needs you', text, level: 'error' });
    else d.notify('Posting needs you', text);
    d.flash();
  }
  if (tcfg().onAttention) telegram.send(`Needs you: "${title}"\n${list.map((r) => `- ${r}`).join('\n')}`, { silent: quiet() });
}

/* ---------- finished jobs ---------- */
function problems(j) {
  const out = [];
  for (const it of j.items || []) for (const r of it.results || []) if (['failed', 'needs_user'].includes(r.status)) out.push(`${r.label}: ${oneLine(r.error || r.status, 120)}`);
  return out;
}
function onFinished(j, msg) {
  const bad = ['failed', 'partial'].includes(j.status);
  const e = att.get(j.id);
  const alertedRecently = e && Date.now() - e.popupAt < ALERT_COOLDOWN_MS;
  if (!quiet()) {
    if (bad && store.get().alerts?.popup !== false) { if (!alertedRecently) d.alerts.show({ title: j.status === 'failed' ? 'Posting job failed' : 'Some posts need attention', text: msg, level: j.status === 'failed' ? 'error' : 'warn' }); }
    else if (store.get().notifyDone) d.notify('Posting Assistant', msg);
  }
  if (tcfg().onFinished) {
    const p = problems(j);
    telegram.send(`${bad ? 'Job needs a look' : 'Job finished'}: "${j.title}" is ${j.status}. ${j.stats.done} of ${j.stats.total} posts done${j.stats.failed ? `, ${j.stats.failed} need attention` : ''}.${p.length ? `\n${p.slice(0, 8).map((x) => `- ${x}`).join('\n')}${p.length > 8 ? `\n...and ${p.length - 8} more` : ''}` : ''}`, { silent: quiet() || !bad });
  }
  att.delete(j.id);
}

/* ---------- daily summary ---------- */
function digest() {
  const since = Date.now() - 24 * 3600 * 1000;
  const h = d.jobs.history().filter((x) => x.at >= since);
  const done = h.filter((x) => x.status === 'done').length;
  const bad = h.filter((x) => ['failed', 'needs_user'].includes(x.status));
  const chans = [...new Set(bad.map((x) => x.target))].slice(0, 6);
  const broken = d.brokenAccounts().slice(0, 8);
  const up = d.upcomingCount();
  return `Daily summary\nLast 24 hours: ${done} post(s) done, ${bad.length} need attention.${chans.length ? `\nProblem channels: ${chans.join(', ')}` : ''}\nScheduled for the next 24 hours: ${up}.${broken.length ? `\nAccounts to check: ${broken.map((b) => `${b.name} (${b.reason})`).join('; ')}` : '\nAll accounts look fine.'}`;
}
function dailyTick() {
  const c = tcfg();
  if (!c.enabled || !c.daily || !telegram.configured()) return;
  const now = new Date();
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(c.dailyTime || '20:00'));
  if (!m) return;
  const at = Number(m[1]) * 60 + Number(m[2]);
  const n = now.getHours() * 60 + now.getMinutes();
  const key = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  if (n < at || n > at + 240 || c.lastDaily === key) return;
  store.update({ telegram: { lastDaily: key } });
  telegram.send(digest(), { silent: quiet() });
}

module.exports = { init, onApproval, onUpdate, onAttention, onFinished, digest };
