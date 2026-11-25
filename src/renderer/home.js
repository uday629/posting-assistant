/* Posting Assistant - renderer: Home page and Monitor calendar. */
'use strict';
/* global S, RENDER, h, $, call, go, icon, pill, fmtDue, openChat, workflowModal */

let gpuNow = null;
pa.on('gpu:state', (s) => { gpuNow = s; });

const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const timeOf = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/* ================= HOME ================= */
RENDER.home = async () => {
  const v = $('#view-home');
  const sum = await call('home.summary').catch(() => null);
  const m = S.settings?.roles?.main;
  const attn = [];
  if (sum) {
    if (sum.awaitingApproval.length) attn.push(['wait', `${sum.awaitingApproval.length} job(s) waiting for your approval`, sum.awaitingApproval.map((j) => j.title).slice(0, 3).join(', '), 'Review', () => { S.jobSel = sum.awaitingApproval[0].id; S.monitorTab = 'jobs'; go('monitor'); }]);
    if (sum.failedPosts) attn.push(['err', `${sum.failedPosts} post(s) failed or need you`, 'Open the job to retry or fix them.', 'Open Monitor', () => { S.monitorTab = 'jobs'; go('monitor'); }]);
    if (sum.brokenAccounts?.length) attn.push(['err', `${sum.brokenAccounts.length} account(s) with a problem`, sum.brokenAccounts.map((a) => `${a.name} (${a.reason})`).slice(0, 3).join('; '), 'Open Accounts', () => go('accounts')]);
    if (sum.needSignIn.length) attn.push(['warn', `${sum.needSignIn.length} account(s) not signed in`, sum.needSignIn.map((a) => a.name).slice(0, 4).join(', '), 'Open Accounts', () => go('accounts')]);
  }
  const attnCard = h('div', { class: 'card hcard' }, h('h3', { text: 'Needs attention' }),
    ...(attn.length ? attn.map(([kind, title, sub, label, fn]) => h('div', { class: 'hrow' }, h('span', { class: `dot ${kind}` }), h('div', { class: 'hgrow' }, h('div', { class: 'tt', text: title }), sub ? h('div', { class: 'dim small', text: sub }) : null), h('button', { class: 'btn s', onclick: fn }, label)))
      : [h('div', { class: 'dim', text: sum ? (sum.accountsTotal ? 'All clear. Nothing needs you right now.' : 'No accounts yet. Add one to start posting.') : 'Could not load the summary.' }),
        sum && !sum.accountsTotal ? h('div', null, h('button', { class: 'btn s', onclick: () => go('accounts') }, 'Open Accounts')) : null]));

  // today + next 7 days, per channel
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 8 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return dayKey(d); });
  const per = new Map();
  for (const p of sum?.upcoming || []) {
    const k = dayKey(p.ts); const i = days.indexOf(k);
    if (i < 0) continue;
    const row = per.get(p.channel || 'Buffer queue') || Array(8).fill(0);
    row[i]++; per.set(p.channel || 'Buffer queue', row);
  }
  const total = [...per.values()].reduce((a, r) => a + r.reduce((x, y) => x + y, 0), 0);
  const upCard = h('div', { class: 'card hcard wide' }, h('h3', { text: 'Today and next 7 days' }),
    per.size ? h('div', { class: 'hup' },
      h('div', { class: 'hupr hupH' }, h('span', { class: 'hch' }), ...days.map((k, i) => h('span', { class: 'hc', text: i === 0 ? 'Today' : new Date(`${k}T12:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) }))),
      ...[...per.entries()].map(([ch, r]) => h('div', { class: 'hupr' }, h('span', { class: 'hch', title: ch, text: ch }), ...r.map((n) => h('span', { class: `hc ${n ? 'has' : ''}`, text: n || '-' })))))
      : h('div', { class: 'dim', text: 'Nothing scheduled in the next 7 days.' }),
    h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'dim small', text: `${total} scheduled post(s)` }), h('div', { style: { flex: 1 } }), h('button', { class: 'btn s', onclick: () => { S.monitorTab = 'calendar'; go('monitor'); } }, 'Open calendar')));

  const qa = (label, ic, fn) => h('button', { class: 'btn hq', onclick: fn }, icon(ic, 18), label);
  const quick = h('div', { class: 'card hcard' }, h('h3', { text: 'Quick actions' }),
    h('div', { class: 'hqs' },
      qa('New chat', 'chat', async () => { go('chat'); await openChat(null); }),
      qa('Write a post', 'writer', () => go('writer')),
      qa('Study a profile', 'study', () => go('study')),
      qa('New workflow', 'workflows', async () => { go('workflows'); setTimeout(() => workflowModal(), 150); }),
      qa('Manage posts', 'posts', () => go('accounts')),
      qa('Open Chat', 'chat', () => go('chat'))));

  const jobsRun = sum ? Object.entries(sum.jobsByStatus).filter(([k]) => ['running', 'preparing', 'posting', 'queued'].includes(k)).reduce((a, [, n]) => a + n, 0) : 0;
  const statusBits = [
    h('span', null, h('span', { class: `dot ${m?.model ? 'ok' : 'err'}` }), m?.model ? `AI: ${m.model}` : 'AI model not chosen'),
    h('span', null, h('span', { class: `dot ${S.whisperReady ? 'ok' : ''}` }), S.whisperReady ? 'Speech ready' : 'Speech not set up'),
    h('span', null, h('span', { class: `dot ${gpuNow?.state && gpuNow.state !== 'ok' && gpuNow.state !== 'normal' ? 'warn' : gpuNow ? 'ok' : ''}` }), gpuNow?.reading ? `GPU ${gpuNow.reading.temp}°C (${gpuNow.state})` : 'GPU: no reading yet'),
    h('span', null, h('span', { class: `dot ${jobsRun ? 'run' : ''}` }), jobsRun ? `${jobsRun} job(s) active` : 'No job running')];
  v.replaceChildren(h('div', { class: 'head' }, h('h1', { text: 'Home' }), h('span', { class: 'muted small', text: 'What needs you and what is coming up.' })),
    h('div', { class: 'scroll hscroll' }, h('div', { class: 'hgrid' }, attnCard, upCard, quick), h('div', { class: 'hstatus' }, ...statusBits, h('a', { class: 'small', onclick: () => go('models') }, 'AI models'))));
};

/* ================= CALENDAR (Monitor tab) ================= */
RENDER.calendar = async (target) => {
  const v = target || $('#view-monitor');
  const now = new Date();
  const cm = S.calMonth || (S.calMonth = { y: now.getFullYear(), m: now.getMonth() });
  const first = new Date(cm.y, cm.m, 1);
  const gridStart = new Date(first); gridStart.setDate(1 - ((first.getDay() + 6) % 7)); // weeks start on Monday
  const gridEnd = new Date(gridStart); gridEnd.setDate(gridEnd.getDate() + 42); gridEnd.setMilliseconds(-1);
  const posts = await call('calendar.range', { from: gridStart.getTime(), to: gridEnd.getTime() }).catch(() => []);
  const byDay = new Map();
  for (const p of posts) { const k = dayKey(p.ts); (byDay.get(k) || byDay.set(k, []).get(k)).push(p); }
  const sel = S.calDay || dayKey(now);
  const shift = (n) => { const d = new Date(cm.y, cm.m + n, 1); S.calMonth = { y: d.getFullYear(), m: d.getMonth() }; RENDER.monitor(); };
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart); d.setDate(d.getDate() + i);
    const k = dayKey(d); const list = byDay.get(k) || [];
    const cnt = (s) => list.filter((p) => p.status === s).length;
    cells.push(h('div', { class: `cday ${d.getMonth() !== cm.m ? 'out' : ''} ${k === dayKey(now) ? 'today' : ''} ${k === sel ? 'sel' : ''}`, onclick: () => { S.calDay = k; RENDER.monitor(); } },
      h('div', { class: 'cnum', text: String(d.getDate()) }),
      h('div', { class: 'cbadges' }, ...[['done', 'ok'], ['planned', 'plan'], ['failed', 'bad']].map(([s, c]) => cnt(s) ? h('span', { class: `cb ${c}`, title: `${cnt(s)} ${s}`, text: String(cnt(s)) }) : null))));
  }
  const selList = byDay.get(sel) || [];
  const selDate = new Date(`${sel}T12:00`);
  const detail = h('div', { class: 'cdetail' }, h('div', { class: 'sect', text: selDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) }),
    ...(selList.length ? selList.map((p) => h('div', { class: 'crow' }, h('span', { class: `cb ${p.status === 'done' ? 'ok' : p.status === 'failed' ? 'bad' : 'plan'}`, text: p.status }), h('span', { class: 'small', text: timeOf(p.ts) }), h('b', { class: 'small', text: p.channel || 'Channel' }), h('span', { class: 'dim small cap', text: p.text || p.name })))
      : [h('div', { class: 'dim small', style: { padding: '6px' }, text: 'No posts on this day.' })]));
  v.replaceChildren(h('div', { class: 'head' }, h('h1', { text: 'Calendar' }), h('span', { class: 'muted small', text: 'Planned and finished posts by day.' }), h('div', { class: 'sp' }),
    h('button', { class: 'btn s', onclick: () => shift(-1) }, '<'),
    h('b', { style: { minWidth: '150px', textAlign: 'center' }, text: first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }),
    h('button', { class: 'btn s', onclick: () => shift(1) }, '>'),
    h('button', { class: 'btn s', onclick: () => { S.calMonth = null; S.calDay = null; RENDER.monitor(); } }, 'Today')),
  h('div', { class: 'scroll calwrap' },
    h('div', { class: 'clegend small dim' }, h('span', { class: 'cb ok', text: 'done' }), h('span', { class: 'cb plan', text: 'planned' }), h('span', { class: 'cb bad', text: 'failed' })),
    h('div', { class: 'cgrid' }, ...['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => h('div', { class: 'chead', text: d })), ...cells), detail));
};
