/* Posting Assistant - renderer core: helpers, navigation, Chat, Monitor, Posts. Vanilla JS, no build step. */
'use strict';
/* global pa, MD */

/* ================= helpers ================= */
// let replaceChildren/append skip null/false children (conditional UI parts)
for (const fn of ['replaceChildren', 'append']) {
  const orig = Element.prototype[fn];
  Element.prototype[fn] = function (...kids) { return orig.apply(this, kids.flat(3).filter((k) => k != null && k !== false)); };
}
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'selected') el.selected = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(3)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const $ = (s, r = document) => r.querySelector(s);
const ICON = {
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  home: 'M3 11l9-8 9 8 M5 10v10h5v-6h4v6h5V10',
  monitor: 'M3 5h18v12H3z M8 21h8 M12 17v4 M7 13l3-3 3 2 4-4',
  posts: 'M4 5h16v14H4z M4 9h16 M9 13h6 M9 16h4',
  styles: 'M12 20h9 M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z',
  skills: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z',
  knowledge: 'M4 19.5A2.5 2.5 0 016.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z',
  accounts: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2 M9 11a4 4 0 100-8 4 4 0 000 8z M23 21v-2a4 4 0 00-3-3.9 M16 3.1a4 4 0 010 7.8',
  models: 'M7 7h10v10H7z M10 2v3 M14 2v3 M10 19v3 M14 19v3 M2 10h3 M2 14h3 M19 10h3 M19 14h3',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  writer: 'M4 20h4L19 9l-4-4L4 16z M14 6l4 4',
  study: 'M11 4a7 7 0 100 14 7 7 0 000-14z M21 21l-5-5',
  workflows: 'M4 6h6v4H4z M14 14h6v4h-6z M7 10v4h10',
  library: 'M4 4h4v16H4z M10 4h4v16h-4z M16 5l3.5-1 3 15-3.5 1z',
  plus: 'M12 5v14 M5 12h14', trash: 'M3 6h18 M8 6V4h8v2 M6 6l1 14h10l1-14', folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  play: 'M6 4l14 8-14 8z', pause: 'M7 4h3v16H7z M14 4h3v16h-3z', stop: 'M6 6h12v12H6z', send: 'M22 2L11 13 M22 2l-7 20-4-9-9-4z'
};
function icon(name, size = 18) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) s.setAttribute(k, v);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICON[name] || ICON.posts);
  s.append(p);
  return s;
}
function toast(text, kind = 'info', ms = 4500) {
  const t = h('div', { class: `toast ${kind}`, text });
  $('#toasts').append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 8000 : ms);
}
async function call(method, arg, { quiet = false } = {}) {
  try { return await pa.call(method, arg); } catch (e) {
    const msg = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    if (!quiet) toast(msg, 'err');
    throw new Error(msg);
  }
}
let modalClose = null;
function modal(content, { onClose, wide } = {}) {
  const back = $('#modal');
  back.replaceChildren(h('div', { class: 'modal', style: wide ? { width: 'min(900px,94vw)' } : null }, content));
  back.classList.remove('hidden');
  back.onmousedown = (e) => { if (e.target === back) closeModal(); };
  modalClose = () => { back.classList.add('hidden'); back.replaceChildren(); modalClose = null; onClose && onClose(); };
  return modalClose;
}
function closeModal() { modalClose && modalClose(); }
function confirmBox(title, body, okText = 'Yes', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; closeModal(); resolve(v); } };
    modal([h('h2', { text: title }), h('div', { class: 'muted', style: { whiteSpace: 'pre-wrap' }, text: body }),
      h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: () => fin(false) }, 'Cancel'), h('button', { class: `btn ${danger ? 'd' : 'p'}`, onclick: () => fin(true) }, okText))], { onClose: () => fin(false) });
  });
}
function promptBox(title, value = '', { password = false, multiline = false, hint = '' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const inp = multiline ? h('textarea', { rows: 8, style: { width: '100%' } }) : h('input', { type: password ? 'password' : 'text', style: { width: '100%' } });
    inp.value = value;
    const fin = (v) => { if (!done) { done = true; closeModal(); resolve(v); } };
    inp.onkeydown = (e) => { if (e.key === 'Enter' && !multiline) fin(inp.value.trim()); };
    modal([h('h2', { text: title }), hint ? h('div', { class: 'muted small', style: { marginBottom: '8px' }, text: hint }) : null, inp,
      h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: () => fin(null) }, 'Cancel'), h('button', { class: 'btn p', onclick: () => fin(inp.value.trim()) }, 'OK'))], { onClose: () => fin(null) });
    setTimeout(() => inp.focus(), 30);
  });
}
const fmtBytes = (n) => { if (!n) return '0 B'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return `${n.toFixed(i ? 1 : 0)} ${u[i]}`; };
const fmtDate = (t) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDue = (d) => (d === 'now' ? 'now' : d === 'draft' ? 'draft' : !d ? 'Buffer queue' : new Date(d).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
const base = (p) => String(p).split(/[\\/]/).pop();
function pill(st) {
  const cls = { running: 'run', preparing: 'run', posting: 'run', analyzing: 'run', writing: 'run', queued: 'wait', awaiting_approval: 'wait', awaiting: 'wait', paused: 'wait', interrupted: 'wait', needs_user: 'wait', pending: '', ready: '', done: 'ok', partial: 'wait', failed: 'err', stopped: '', skipped: '' }[st] || '';
  const label = { awaiting_approval: 'needs approval', needs_user: 'needs you', awaiting: 'needs approval' }[st] || st || 'idle';
  return h('span', { class: `pill ${cls}` }, h('span', { class: `dot ${cls === 'run' ? 'run' : cls === 'wait' ? 'warn' : cls === 'ok' ? 'ok' : cls === 'err' ? 'err' : ''}` }), label);
}
// MD.toHtml escapes every character of the text and only allows http(s)/mailto links (model output is untrusted)
function md(text) { const d = h('div', { class: 'md' }); d.innerHTML = /* security-ignore: XSS-INNERHTML */ MD.toHtml(String(text || '')); d.querySelectorAll('a').forEach((a) => { const u = a.getAttribute('href'); a.onclick = (e) => { e.preventDefault(); if (/^https:/.test(u)) call('shell.external', u); }; }); return d; }
function field(label, input, hint) { return h('label', { class: 'f' }, label, input, hint ? h('span', { class: 'dim small', style: { fontWeight: 400 } }, hint) : null); }
function sel(options, value, onchange) {
  const s = h('select', { onchange: onchange ? (e) => onchange(e.target.value) : null });
  for (const o of options) { const [v, l] = Array.isArray(o) ? o : [o, o]; s.append(h('option', { value: v, selected: String(v) === String(value) }, l)); }
  return s;
}
function seg(options, value, onchange) {
  const wrap = h('div', { class: 'seg' });
  for (const [v, l, cls] of options) wrap.append(h('button', { class: `${v === value ? 'on' : ''} ${cls || ''}`, onclick: () => onchange(v) }, l));
  return wrap;
}

/* ================= sound ================= */
let actx = null;
function tone(freq, start, dur, vol) {
  const ctx = actx || (actx = new AudioContext());
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, ctx.currentTime + start);
  g.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start); o.stop(ctx.currentTime + start + dur + 0.05);
}
// quiet hours (Settings > Automation): sounds are silenced, jobs keep running
function quietNow() {
  const q = S.settings?.quietHours;
  if (!q?.enabled) return false;
  const mins = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const a = mins(q.start), b = mins(q.end);
  if (a == null || b == null || a === b) return false;
  const d = new Date(), n = d.getHours() * 60 + d.getMinutes();
  return a < b ? n >= a && n < b : n >= a || n < b;
}
function sound(kind) {
  if (!S.settings?.sound || quietNow()) return;
  const v = Math.max(0.02, Math.min(1, S.settings.volume ?? 0.7)) * 0.3;
  if (kind === 'approval' || kind === 'attention') { tone(660, 0, 0.18, v); tone(990, 0.16, 0.28, v); }
  else if (kind === 'done') { tone(523, 0, 0.18, v); tone(659, 0.15, 0.18, v); tone(784, 0.3, 0.35, v); }
  else if (kind === 'failed') tone(330, 0, 0.4, v);
}

/* ================= state ================= */
const S = {
  view: 'chat', settings: null, info: null,
  chats: [], chatId: null, chat: null, chatStatus: { running: false, status: '' },
  jobs: [], jobSel: null, jobDetail: null, frames: {}, pendingApprovals: new Set(), busy: false
};
async function loadSettings() { S.settings = await call('settings.get'); renderSide(); return S.settings; }
async function setSetting(patch) { S.settings = await call('settings.update', patch); renderSide(); return S.settings; }

/* ================= navigation ================= */
const GROUPS = [['Create', [['home', 'Home'], ['chat', 'Chat'], ['writer', 'Writer']]], ['Post', [['workflows', 'Workflows'], ['monitor', 'Monitor'], ['accounts', 'Accounts']]], ['Learn', [['study', 'Competitor study'], ['library', 'Library']]], ['System', [['models', 'AI models'], ['settings', 'Settings']]]];
const VIEWS = GROUPS.flatMap((g) => g[1]);
const NAV_HELP = {
  home: 'Overview: what needs you, what is scheduled, and quick shortcuts.',
  chat: 'Tell the assistant what to post, in plain words.',
  writer: 'Write scripts, captions and ideas with the AI.',
  workflows: 'Automatic posting plans for a whole folder of videos.',
  monitor: 'Live progress of jobs, the calendar, and the post history.',
  accounts: 'Sign in to Buffer and other accounts, and set up channels.',
  study: 'Analyze a competitor profile or a viral clip.',
  library: 'Your saved styles, skills and knowledge.',
  models: 'Choose and manage the AI models this app uses.',
  settings: 'App behavior, alerts, GPU heat guard and keys.'
};
const RENDER = {};
function renderNav() {
  $('#nav').replaceChildren(...GROUPS.flatMap(([g, items]) => [h('div', { class: 'navhead', text: g }), ...items.map(([id, label]) => h('button', { class: `nav ${S.view === id ? 'on' : ''}`, title: NAV_HELP[id] || null, onclick: () => go(id) }, icon(id), label,
    id === 'monitor' && S.pendingApprovals.size ? h('span', { class: 'badge', text: String(S.pendingApprovals.size) }) : null))]));
}
function go(view) {
  // old page names now live inside Library or Monitor
  if (['styles', 'skills', 'knowledge'].includes(view)) { S.libTab = view; view = 'library'; }
  if (view === 'posts') { S.monitorTab = 'history'; view = 'monitor'; }
  S.view = view;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === `view-${view}`));
  renderNav();
  RENDER[view]?.();
}
window.__go = go;
$('#refreshBtn')?.addEventListener('click', async () => {
  const b = $('#refreshBtn'); b.classList.add('spin');
  try { await loadSettings(); await refreshJobs(); await RENDER[S.view]?.(); toast('Refreshed', 'ok', 1500); } catch (_) { toast('Could not refresh', 'err'); } finally { b.classList.remove('spin'); }
});
function renderSide() {
  const s = S.settings;
  if (!s) return;
  const m = s.roles.main;
  const p = s.providers.find((x) => x.id === m.provider);
  $('#sideModels').replaceChildren(h('div', null, h('span', { class: `dot ${m.model ? 'ok' : 'err'}` }), h('b', { text: 'AI: ' }), m.model ? `${m.model}` : 'not chosen'), h('div', { class: 'dim small' }, p ? p.name : ''));
  $('#sideModels').onclick = () => go('models');
  const active = S.jobs.find((j) => j.active);
  $('#sideJob').replaceChildren(h('div', null, h('span', { class: `dot ${active ? 'run' : ''}` }), h('b', { text: active ? 'Posting: ' : 'No job running' }), active ? `${active.stats.done}/${active.stats.total}` : ''), active ? h('div', { class: 'dim small', text: active.title }) : null);
  $('#sideJob').onclick = () => go('monitor');
  if (!$('#credit').childNodes.length) $('#credit').append('Made by ', h('b', { text: 'Bunnys Framelab' }), h('br'), h('a', { onclick: () => call('shell.external', 'https://www.instagram.com/bunnysframelab/') }, 'Instagram: @bunnysframelab'));
}

/* ================= CHAT ================= */
const MODES = [['autopilot', 'Autopilot', 'm-auto'], ['every', 'Ask every time'], ['once', 'Ask once']];
async function refreshChats() { S.chats = await call('chat.list'); }
RENDER.chat = async () => {
  await refreshChats();
  S.accountCount = (await call('accounts.list', null, { quiet: true }).catch(() => [])).length;
  const v = $('#view-chat');
  const list = h('div', { class: 'chatlist' },
    h('button', { class: 'btn p', style: { justifyContent: 'center', marginBottom: '8px' }, onclick: () => openChat(null) }, icon('plus', 16), 'New chat'),
    ...S.chats.map((c) => h('div', { class: `litem ${c.id === S.chatId ? 'on' : ''}`, onclick: () => openChat(c.id) },
      h('span', { class: 'tt', text: c.title || 'Chat' }),
      h('button', { class: 'btn ghost s', title: 'Delete', onclick: async (e) => { e.stopPropagation(); if (await confirmBox('Delete chat?', c.title, 'Delete', true)) { await call('chat.remove', c.id); if (S.chatId === c.id) { S.chatId = null; S.chat = null; } RENDER.chat(); } } }, icon('trash', 14)))));
  const m = S.settings.roles.main;
  const top = h('div', { class: 'topbar' },
    seg(MODES, S.settings.mode, async (mode) => { await setSetting({ mode }); RENDER.chat(); toast(`Approval: ${MODES.find((x) => x[0] === mode)[1]}`, 'ok'); }),
    h('span', { class: 'dim small', text: S.settings.mode === 'autopilot' ? 'Posts go out without asking.' : S.settings.mode === 'every' ? 'You approve each post.' : 'You approve each job once.' }),
    h('div', { style: { flex: 1 } }),
    h('span', { class: 'modelpill', title: 'Change model', onclick: () => go('models') }, m.model ? `AI: ${m.model}` : 'No AI model chosen. Click to set up'));
  const feed = h('div', { class: 'feed', id: 'feed' });
  const ta = h('textarea', { id: 'input', rows: 2, placeholder: 'Tell me what to do, e.g. "Schedule videos 01-10 from the Reels folder to Cooking IG and Cooking YT, every day at 8 PM starting tomorrow". Type / for skills and styles, @ to pick an account. Drop files here.' });
  ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } };
  ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(200, ta.scrollHeight) + 'px'; };
  const composer = h('div', { class: 'composer' },
    h('div', { class: 'box' }, ta,
      h('button', { class: 'btn d', id: 'stopBtn', style: { display: S.chatStatus.running ? '' : 'none' }, onclick: () => call('chat.stop') }, icon('stop', 15), 'Stop'),
      h('button', { class: 'btn p', id: 'sendBtn', onclick: () => sendChat() }, icon('send', 15), 'Send')),
    h('div', { class: 'row small dim' },
      h('button', { class: 'btn ghost s', onclick: async () => { const f = await call('dialog.folder', 'Choose a folder with videos'); if (f) insert(`"${f}"`); } }, icon('folder', 14), 'Folder'),
      h('button', { class: 'btn ghost s', onclick: async () => { const fs = await call('dialog.files', { title: 'Choose videos or images' }); if (fs.length) insert(fs.map((x) => `"${x}"`).join(' ')); } }, icon('plus', 14), 'Files'),
      h('span', null, 'Enter to send, Shift+Enter for a new line')));
  v.replaceChildren(h('div', { class: 'chatwrap' }, list, h('div', { class: 'chatmain' }, top, feed, h('div', { class: 'statusline', id: 'chatStatus' }), composer)));
  attachSlash(ta);
  renderFeed();
};
function insert(t) { const ta = $('#input'); ta.value = `${ta.value}${ta.value && !/\s$/.test(ta.value) ? ' ' : ''}${t} `; ta.focus(); }
async function openChat(id) {
  S.chatId = id;
  S.chat = id ? await call('chat.load', id) : null;
  RENDER.chat();
}
function welcome() {
  const s = S.settings;
  const steps = [
    ['AI model', 'Pick a local model or add an API key', !!s.roles.main.model, 'models'],
    ['Buffer accounts', 'Add your Buffer account(s) and sign in once', (S.accountCount || 0) > 0, 'accounts'],
    ['Speech to text', 'Understand Bangla/English speech', s.transcribe.engine !== 'local' || S.whisperReady, 'models'],
    ['Caption style', 'Pick or learn your style', true, 'styles']
  ];
  const ex = ['Schedule videos 01-05 from the Reels folder to Instagram tomorrow at 8 PM', 'Post every video in E:\\Videos\\Shorts to YouTube and TikTok daily at 10 AM and 7 PM', 'Learn my caption style from my past Buffer posts', 'Show me captions for these videos first, do not post yet'];
  return h('div', { class: 'welcome' },
    h('img', { src: '../../assets/icon.png', alt: '' }), h('h2', { class: 'gtext', text: 'Posting Assistant' }),
    h('div', { class: 'muted', text: 'Tell me which videos or posts to take from your PC, where to post them and when. I write the captions in your style and schedule everything in one go.' }),
    h('div', { class: 'chips' }, ...ex.map((e) => h('button', { class: 'chip', onclick: () => { $('#input').value = e; $('#input').focus(); } }, e))),
    h('div', { class: 'setup' }, ...steps.map(([t, d, done, view]) => h('div', { class: `card ${done ? 'done' : ''}`, onclick: () => go(view) }, h('div', { class: 'row' }, h('span', { class: `dot ${done ? 'ok' : 'warn'}` }), h('b', { text: t })), h('div', { class: 'dim small', text: d })))));
}
function renderFeed() {
  const feed = $('#feed');
  if (!feed) return;
  if (!S.chat || !S.chat.items.length) { feed.replaceChildren(welcome()); return; }
  feed.replaceChildren(...S.chat.items.filter((it) => !it.hidden).map(itemEl).filter(Boolean));
  feed.scrollTop = feed.scrollHeight;
  updateChatStatus();
}
function itemEl(it) {
  if (it.role === 'user') return h('div', { class: 'fi user', 'data-id': it.id, text: it.text });
  if (it.role === 'assistant') {
    const last = S.chat.items.filter((x) => !x.hidden).slice(-1)[0] === it;
    return h('div', { class: 'fi msg', 'data-id': it.id }, md(it.text), it.options?.length && last ? h('div', { class: 'chips opts' }, ...it.options.map((o) => h('button', { class: 'chip', onclick: () => { $('#input').value = o; sendChat(); } }, o))) : null);
  }
  if (it.role === 'jobapproval') {
    const open = it.status === 'open' && S.pendingApprovals.has(it.key);
    return h('div', { class: 'fi appr-card', 'data-id': it.id }, md(it.text),
      open ? h('div', { class: 'row', style: { marginTop: '8px' } },
        h('button', { class: 'btn p s', onclick: async () => { await call('jobs.approve', { key: it.key, decision: 'yes', edits: { items: [] } }); S.pendingApprovals.delete(it.key); it.status = 'done'; renderFeed(); } }, 'Approve and post'),
        h('button', { class: 'btn s', onclick: () => { S.jobSel = it.jobId; go('monitor'); } }, 'Edit in Monitor'),
        h('button', { class: 'btn d s', onclick: async () => { await call('jobs.approve', { key: it.key, decision: 'no' }); S.pendingApprovals.delete(it.key); it.status = 'done'; renderFeed(); } }, 'Cancel job')) : h('div', { class: 'dim small', text: 'Answered.' }));
  }
  if (it.role === 'error') return h('div', { class: 'fi err', 'data-id': it.id, text: it.text });
  if (['note', 'report', 'warn'].includes(it.role)) return h('div', { class: `fi ${it.role === 'warn' ? 'warn' : 'note'}`, 'data-id': it.id }, md(it.text), h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn s', onclick: () => go('monitor') }, 'Open Monitor')));
  if (it.role === 'action') {
    const res = S.chat.items.find((x) => x.role === 'result' && x.forAction === it.id);
    const el = h('div', { class: `fi act ${it.status}`, 'data-id': it.id },
      h('div', null, h('span', { class: 'tn', text: it.tool }), it.thought ? h('span', { class: 'th', text: `  ${it.thought}` }) : null, ' ', it.status === 'running' ? h('span', { class: 'dot run' }) : null));
    if (it.status === 'approval') {
      el.append(h('div', { class: 'appr', style: { marginTop: '8px' } }, h('b', { text: 'Approve this action?' }), h('pre', { text: JSON.stringify(it.args, null, 1) }),
        h('div', { class: 'row' }, h('button', { class: 'btn p s', onclick: () => call('chat.approve', { itemId: it.id, decision: 'yes' }) }, 'Approve'), h('button', { class: 'btn s', onclick: () => call('chat.approve', { itemId: it.id, decision: 'all' }) }, 'Approve all in this task'), h('button', { class: 'btn d s', onclick: () => call('chat.approve', { itemId: it.id, decision: 'no' }) }, 'Deny'))));
    }
    if (res) {
      const pre = h('pre', { class: 'hidden', text: `${JSON.stringify(it.args, null, 1)}\n\n${res.text || ''}` });
      el.onclick = (e) => { if (e.target.closest('button')) return; pre.classList.toggle('hidden'); };
      el.append(pre);
    }
    return el;
  }
  return null;
}
function updateChatStatus() {
  const st = $('#chatStatus');
  if (st) st.textContent = S.chatStatus.running && (!S.chatStatus.chatId || S.chatStatus.chatId === S.chatId) ? S.chatStatus.status : '';
  const sb = $('#stopBtn'); if (sb) sb.style.display = S.chatStatus.running ? '' : 'none';
  const se = $('#sendBtn'); if (se) se.disabled = S.chatStatus.running;
}
async function sendChat() {
  const ta = $('#input');
  const text = ta.value.trim();
  if (!text || S.chatStatus.running) return;
  if (!S.settings.roles.main.model) { toast('Choose an AI model first (AI models page).', 'warn'); go('models'); return; }
  if (!S.chatId) { const c = await call('chat.create'); S.chatId = c.id; S.chat = c; }
  ta.value = ''; ta.style.height = 'auto';
  await call('chat.send', { chatId: S.chatId, text });
}
pa.on('chat:item', ({ chatId, item }) => {
  if (chatId !== S.chatId || !S.chat) return;
  const i = S.chat.items.findIndex((x) => x.id === item.id);
  if (i >= 0) S.chat.items[i] = item; else S.chat.items.push(item);
  if (S.view !== 'chat') return;
  const feed = $('#feed');
  if (!feed) return;
  if (S.chat.items.length === 1) { renderFeed(); return; }
  // results re-render their action
  const target = item.role === 'result' ? S.chat.items.find((x) => x.id === item.forAction) : item;
  if (!target || target.hidden) return;
  const el = itemEl(target);
  if (!el) return;
  const old = feed.querySelector(`[data-id="${target.id}"]`);
  if (old) old.replaceWith(el); else feed.append(el);
  feed.scrollTop = feed.scrollHeight;
  if (['report'].includes(item.role)) sound('done');
});
pa.on('chat:status', (s) => { S.chatStatus = s; updateChatStatus(); if (!s.running) refreshChats().then(() => { if (S.view === 'chat') { const l = document.querySelectorAll('.chatlist .litem'); if (l.length !== S.chats.length) RENDER.chat(); } }); });
pa.on('chat:approval', () => sound('approval'));

/* ================= MONITOR ================= */
async function refreshJobs() { S.jobs = await call('jobs.list'); renderSide(); }
function monitorTabs(active) {
  return h('div', { class: 'subtabs' }, ...[['jobs', 'Jobs'], ['calendar', 'Calendar'], ['history', 'Post history']].map(([id, label]) => h('button', { class: active === id ? 'on' : '', onclick: active === id ? null : () => { S.monitorTab = id; RENDER.monitor(); } }, label)));
}
RENDER.monitor = async () => {
  if (S.monitorTab === 'history' || S.monitorTab === 'calendar') {
    const v = $('#view-monitor');
    const body = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } });
    v.replaceChildren(monitorTabs(S.monitorTab), body);
    return S.monitorTab === 'calendar' ? RENDER.calendar(body) : RENDER.posts(body);
  }
  await refreshJobs();
  if (!S.jobSel && S.jobs[0]) S.jobSel = (S.jobs.find((j) => j.active) || S.jobs[0]).id;
  const v = $('#view-monitor');
  v.replaceChildren(
    monitorTabs('jobs'),
    h('div', { class: 'head' }, h('h1', { text: 'Monitor' }), h('span', { class: 'muted small', text: 'Live progress of every posting job. Work continues when the window is minimized or closed to the tray.' }), h('div', { class: 'sp' }),
      h('button', { class: 'btn p', onclick: () => newJobModal() }, icon('plus', 16), 'New posting job')),
    h('div', { class: 'jobs' }, h('div', { class: 'left', id: 'jobList' }), h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0 }, id: 'jobPane' })));
  drawJobList();
  await drawJob();
};
function jobCard(j) {
  const pct = j.stats.total ? Math.round((j.stats.done / j.stats.total) * 100) : 0;
  return h('div', { class: `jcard ${j.id === S.jobSel ? 'on' : ''}`, onclick: () => { S.jobSel = j.id; drawJobList(); drawJob(); } },
    h('div', { class: 'row' }, h('span', { class: 'tt', style: { flex: 1 }, text: j.title }), pill(j.paused ? 'paused' : j.status)),
    h('div', { class: 'dim small', text: `${fmtDate(j.createdAt)} · ${j.items.length} file(s) · ${j.stats.done}/${j.stats.total} done${j.stats.failed ? ` · ${j.stats.failed} failed` : ''}` }),
    h('div', { class: 'bar' }, h('div', { style: { width: `${pct}%` } })));
}
function drawJobList() {
  const el = $('#jobList');
  if (!el) return;
  el.replaceChildren(...(S.jobs.length ? S.jobs.map(jobCard) : [h('div', { class: 'empty', text: 'No jobs yet. Ask in Chat or click "New posting job".' })]));
}
async function drawJob() {
  const pane = $('#jobPane');
  if (!pane) return;
  if (!S.jobSel) { pane.replaceChildren(h('div', { class: 'empty', text: 'Select a job.' })); return; }
  const j = await call('jobs.get', S.jobSel, { quiet: true }).catch(() => null);
  if (!j) { pane.replaceChildren(h('div', { class: 'empty', text: 'Job not found.' })); return; }
  S.jobDetail = j;
  const ctrls = h('div', { class: 'row' },
    j.active && !j.paused ? h('button', { class: 'btn', onclick: () => call('jobs.pause', j.id) }, icon('pause', 15), 'Pause') : null,
    j.active && j.paused ? h('button', { class: 'btn p', onclick: () => call('jobs.resume', j.id) }, icon('play', 15), 'Resume') : null,
    !j.active && ['interrupted', 'stopped', 'failed', 'partial'].includes(j.status) ? h('button', { class: 'btn p', onclick: () => call('jobs.resume', j.id) }, icon('play', 15), j.status === 'interrupted' ? 'Resume' : 'Retry failed') : null,
    j.active || j.status === 'queued' ? h('button', { class: 'btn d', onclick: async () => { if (await confirmBox('Stop this job?', 'Posts that are already scheduled stay scheduled.', 'Stop', true)) call('jobs.stop', j.id); } }, icon('stop', 15), 'Stop') : null,
    !j.active && j.stats.done > 0 ? h('button', { class: 'btn d', title: 'Delete the posts and drafts this job created on Buffer', onclick: () => undoJob(j) }, 'Undo job') : null,
    !j.active ? h('button', { class: 'btn ghost', onclick: async () => { if (await confirmBox('Remove this job from the list?', 'Scheduled posts are not affected.', 'Remove', true)) { await call('jobs.remove', j.id); S.jobSel = null; RENDER.monitor(); } } }, icon('trash', 15)) : null);
  const approvalKey = j.approval === 'once' && j.status === 'awaiting_approval' ? j.id : null;
  const itemKey = (it) => (j.approval === 'every' && it.stage === 'awaiting' ? `${j.id}:${it.id}` : null);
  const mid = h('div', { class: 'mid' },
    h('div', { class: 'row' }, h('h2', { style: { margin: 0, fontSize: '18px' }, text: j.title }), pill(j.paused ? 'paused' : j.status), h('div', { style: { flex: 1 } }), ctrls),
    h('div', { class: 'dim small', text: `Targets: ${j.targets.map((t) => (t.type === 'account' ? `${t.channelName || t.accountName}${t.service ? ` (${t.service})` : ''}` : t.type === 'buffer' ? `${t.name} (${t.service})` : `${t.platform} (browser)`)).join(', ')} · Approval: ${MODES.find((m) => m[0] === j.approval)?.[1] || j.approval}` }),
    approvalKey ? h('div', { class: 'appr' }, h('b', { text: 'Check the captions and times below, edit anything, then approve.' }),
      h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn p', onclick: () => approveJob(j, approvalKey, 'yes') }, 'Approve and post all'), h('button', { class: 'btn d', onclick: () => approveJob(j, approvalKey, 'no') }, 'Cancel job'))) : null,
    ...j.items.map((it) => itemCard(j, it, approvalKey || itemKey(it), itemKey(it))));
  const lastFrame = S.frames[j.id];
  const rt = h('div', { class: 'rt' },
    h('div', { class: 'row' }, h('div', { class: 'sect', style: { flex: 1, margin: 0 }, text: 'Live browser' }),
      j.active ? h('button', { class: 'btn s', title: 'Pause the job and use the browser yourself', onclick: async (e) => {
        const on = !S.takeover;
        const shown = await call('jobs.takeover', { id: j.id, on });
        if (on && !shown) { toast('No browser window is open right now (the app is analyzing or writing).', 'warn'); return; }
        S.takeover = on; e.target.textContent = on ? 'Give control back' : 'Take control';
        toast(on ? 'Job paused. The browser window is yours; click "Give control back" when done.' : 'The agent continues.', 'ok', 6000);
      } }, S.takeover ? 'Give control back' : 'Take control') : null),
    h('div', { class: 'liveframe', id: 'liveFrame', title: 'Click to enlarge', onclick: () => bigLive(j.id) }, lastFrame ? h('img', { src: `data:image/jpeg;base64,${lastFrame}` }) : 'Shows the page while the app posts in the browser.'),
    h('div', { class: 'stats' }, h('div', { class: 'stat' }, h('b', { text: `${j.stats.done}/${j.stats.total}` }), h('span', { text: 'posts done' })), h('div', { class: 'stat' }, h('b', { text: String(j.stats.failed) }), h('span', { text: 'need attention' }))),
    h('div', { class: 'sect', text: 'Log' }),
    h('div', { class: 'logbox', id: 'logBox' }, ...j.log.slice(-200).map(logLine)));
  pane.replaceChildren(h('div', { class: 'jdetail' }, mid, rt));
  const lb = $('#logBox'); if (lb) lb.scrollTop = lb.scrollHeight;
}
// undo a job: delete only the posts this job created, after one confirmation, then show the result of every post
async function undoJob(j) {
  const pv = await call('jobs.undoPreview', j.id).catch(() => null);
  if (!pv) return;
  if (!pv.willDelete.length) { await confirmBox('Nothing to undo', pv.skipped.length ? `This job has no post that can be removed here:\n${pv.skipped.slice(0, 8).map((s) => `- ${s.name} -> ${s.label}: ${s.reason}`).join('\n')}` : 'This job has no finished posts.', 'OK'); return; }
  const lines = pv.willDelete.slice(0, 12).map((p) => `- ${p.name} -> ${p.label} (${p.view === 'drafts' ? 'draft' : 'scheduled'})`).join('\n');
  const more = pv.willDelete.length > 12 ? `\n...and ${pv.willDelete.length - 12} more` : '';
  const skip = pv.skipped.length ? `\n\n${pv.skipped.length} post(s) cannot be removed here (already public, or not found safely).` : '';
  if (!(await confirmBox(`Undo "${j.title}"?`, `This deletes ${pv.willDelete.length} post(s) this job created on Buffer. Other posts are never touched. It cannot be brought back.\n\n${lines}${more}${skip}`, 'Delete these posts', true))) return;
  toast('Undoing the job. This opens Buffer in the background and can take a minute.', 'info', 7000);
  let r;
  try { r = await call('jobs.undo', j.id); } catch (_) { return; }
  const mark = { deleted: 'Deleted', failed: 'Failed', not_found: 'Not found', skipped: 'Skipped' };
  modal([h('h2', { text: `Undo result: ${r.deleted} deleted` }), h('div', { class: 'dim small', style: { marginBottom: '8px' }, text: `${r.failed} failed, ${r.notFound} not found, ${r.skipped} skipped` }),
    h('div', { class: 'col', style: { maxHeight: '50vh', overflow: 'auto', gap: '4px' } }, ...r.results.map((x) => h('div', { class: 'row small' }, h('span', { class: `dot ${x.status === 'deleted' ? 'ok' : x.status === 'failed' ? 'err' : 'warn'}` }), h('span', { style: { flex: 1 }, text: `${x.name} -> ${x.label}` }), h('b', { text: mark[x.status] || x.status }), x.reason ? h('span', { class: 'dim', text: x.reason }) : null))),
    h('div', { class: 'acts' }, h('button', { class: 'btn p', onclick: closeModal }, 'Close'))], { wide: true });
}
// big live view of the browser the job is using (updates live)
function bigLive(jobId) {
  const img = h('img', { id: 'bigLive', style: { width: '100%', borderRadius: '12px', background: '#000' }, src: S.frames[jobId] ? `data:image/jpeg;base64,${S.frames[jobId]}` : '' });
  modal([h('div', { class: 'row', style: { marginBottom: '10px' } }, h('h2', { style: { margin: 0, flex: 1 }, text: 'Live browser' }), h('button', { class: 'btn s', onclick: closeModal }, 'Close')), S.frames[jobId] ? img : h('div', { class: 'empty', text: 'Nothing on screen yet.' })], { wide: true });
  $('#modal .modal').style.width = 'min(1300px,96vw)';
}
function logLine(e) { return h('div', { class: `l ${e.level}`, text: `${new Date(e.t).toLocaleTimeString()}  ${e.text}` }); }
const edits = {}; // itemId -> {platforms:{k:{text,title}}, dueAt, skip}
function itemCard(j, it, approveKey, singleKey) {
  const th = h('div', { class: 'th', text: it.kind });
  if (it.analysis?.frame) call('media.image', it.analysis.frame, { quiet: true }).then((src) => { if (src) th.replaceChildren(h('img', { src })); }).catch(() => {});
  const editable = !!approveKey || ['ready', 'pending', 'failed'].includes(it.stage) && !j.active;
  const plats = it.captions ? Object.keys(it.captions.platforms) : [];
  let cur = plats[0];
  const box = h('div', { class: 'capbox' });
  const drawCap = () => {
    if (!it.captions) { box.replaceChildren(h('div', { class: 'dim small', text: it.step || (it.stage === 'pending' ? 'Waiting to be analyzed' : '') })); return; }
    const p = it.captions.platforms[cur];
    const e = (edits[it.id] = edits[it.id] || { platforms: {} });
    const pe = (e.platforms[cur] = e.platforms[cur] || {});
    const kids = [h('div', { class: 'ptab' }, ...plats.map((k) => h('button', { class: k === cur ? 'on' : '', onclick: () => { cur = k; drawCap(); } }, k)), h('span', { class: 'dim small', style: { marginLeft: '8px' }, text: `${it.captions.language}${it.analysis ? ` · ${it.analysis.hasSpeech ? 'speech' : 'no speech'}` : ''}` }))];
    if (p.title != null) kids.push(editable ? h('input', { type: 'text', value: pe.title ?? p.title, oninput: (ev) => { pe.title = ev.target.value; } }) : h('div', null, h('b', { text: p.title })));
    kids.push(editable ? h('textarea', { value: pe.text ?? p.text, oninput: (ev) => { pe.text = ev.target.value; } }) : h('div', { class: 'small', style: { whiteSpace: 'pre-wrap', maxHeight: '160px', overflow: 'auto' }, text: p.text }));
    if (p.keywords?.length && cur === 'youtube') kids.push(h('div', { class: 'dim small', text: `Tags: ${p.keywords.join(', ')}` }));
    if (p.flags?.length) kids.push(h('div', { class: 'dim small', text: `Style notes: ${p.flags.join('; ')}` }));
    if (editable && !approveKey) kids.push(h('div', { class: 'row' }, h('button', { class: 'btn s', onclick: async () => { await call('jobs.updateItem', { id: j.id, itemId: it.id, patch: edits[it.id] }); toast('Saved', 'ok'); } }, 'Save edits'), h('button', { class: 'btn s ghost', onclick: async () => { await call('jobs.updateItem', { id: j.id, itemId: it.id, patch: { rewrite: true } }); toast('Captions will be rewritten when you resume.', 'ok'); } }, 'Rewrite captions')));
    box.replaceChildren(...kids);
  };
  drawCap();
  const due = h('span', { class: 'small muted', text: `When: ${fmtDue(it.dueAt)}` });
  return h('div', { class: 'item' }, th, h('div', null,
    h('div', { class: 'row' }, h('span', { class: 'nm', text: it.name }), pill(it.stage), it.step ? h('span', { class: 'dim small', text: it.step }) : null, h('div', { style: { flex: 1 } }), due,
      editable ? h('button', { class: 'btn ghost s', onclick: async () => { const v = await promptBox('New date and time', it.dueAt && !['now', 'draft'].includes(it.dueAt) ? toLocalInput(it.dueAt) : '', { hint: 'Format: YYYY-MM-DD HH:mm (your local time). Leave empty for the Buffer queue, or type "now".' }); if (v == null) return; const d = v === '' ? null : v === 'now' ? 'now' : new Date(v.replace(' ', 'T')); if (d && d !== 'now' && isNaN(d)) { toast('Bad date', 'err'); return; } const iso = d && d !== 'now' ? d.toISOString() : d; (edits[it.id] = edits[it.id] || { platforms: {} }).dueAt = iso; it.dueAt = iso; due.textContent = `When: ${fmtDue(iso)}`; if (!approveKey) await call('jobs.updateItem', { id: j.id, itemId: it.id, patch: { dueAt: iso } }); } }, 'Change time') : null,
      approveKey && !singleKey ? h('label', { class: 'chk small' }, h('input', { type: 'checkbox', onchange: (e) => { (edits[it.id] = edits[it.id] || { platforms: {} }).skip = e.target.checked; } }), 'skip') : null,
      h('button', { class: 'btn ghost s', title: 'Show in folder', onclick: () => call('shell.showItem', it.file) }, icon('folder', 14))),
    h('div', { class: 'res' }, ...it.results.map((r) => h('span', { class: `tag ${r.status === 'done' ? 'fits' : r.status === 'failed' ? 'too-big' : r.status === 'needs_user' ? 'tight' : ''}`, title: r.error || r.note || '', style: { cursor: r.url ? 'pointer' : 'default' }, onclick: () => r.url && call('shell.external', r.url) }, `${r.label}: ${r.status}${r.error ? ` (${r.error.slice(0, 60)})` : ''}`))),
    box,
    singleKey ? h('div', { class: 'appr', style: { marginTop: '8px' } }, h('b', { text: 'Approve this post?' }),
      h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn p s', onclick: () => approveJob(j, singleKey, 'yes', it.id) }, 'Post this'), h('button', { class: 'btn s', onclick: () => approveJob(j, singleKey, 'all', it.id) }, 'Post this and all the rest'), h('button', { class: 'btn s', onclick: () => approveJob(j, singleKey, 'skip', it.id) }, 'Skip'), h('button', { class: 'btn d s', onclick: () => approveJob(j, singleKey, 'stop', it.id) }, 'Stop job'))) : null));
}
function toLocalInput(iso) { const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
async function approveJob(j, key, decision, onlyItem) {
  const items = Object.entries(edits).filter(([id]) => !onlyItem || id === onlyItem).map(([id, e]) => ({ id, ...e }));
  await call('jobs.approve', { key, decision, edits: { items } });
  for (const it of items) delete edits[it.id];
  S.pendingApprovals.delete(key);
  renderNav();
}
let drawT = null;
pa.on('job:update', (j) => {
  const i = S.jobs.findIndex((x) => x.id === j.id);
  const slim = { ...j, log: undefined };
  if (i >= 0) S.jobs[i] = slim; else S.jobs.unshift(slim);
  if (!['awaiting_approval'].includes(j.status)) for (const k of [...S.pendingApprovals]) if (k.startsWith(j.id)) S.pendingApprovals.delete(k);
  renderSide(); renderNav();
  if (S.view !== 'monitor') return;
  drawJobList();
  if (j.id === S.jobSel) {
    // do not wipe text the user is editing
    if (document.activeElement?.closest?.('.capbox')) return;
    clearTimeout(drawT); drawT = setTimeout(drawJob, 250);
  }
});
pa.on('job:log', ({ jobId, entry }) => { if (S.view === 'monitor' && jobId === S.jobSel) { const lb = $('#logBox'); if (lb) { lb.append(logLine(entry)); lb.scrollTop = lb.scrollHeight; } } });
pa.on('job:frame', ({ jobId, image }) => { S.frames[jobId] = image; const big = $('#bigLive'); if (big) big.src = `data:image/jpeg;base64,${image}`; if (S.view === 'monitor' && jobId === S.jobSel) { const f = $('#liveFrame'); if (f) f.replaceChildren(h('img', { src: `data:image/jpeg;base64,${image}` })); } });
// one toast and one sound per job while its approval card or alert is already on screen
const shownFor = new Map();
function firstTime(kind, id, ms) { const k = `${kind}:${id}`; const now = Date.now(); if (now - (shownFor.get(k) || 0) < ms) return false; shownFor.set(k, now); return true; }
pa.on('job:approval', ({ key, job }) => {
  const first = ![...S.pendingApprovals].some((k) => k !== key && k.startsWith(job.id));
  S.pendingApprovals.add(key); renderNav();
  if (first && firstTime('appr', job.id, 60000)) { sound('approval'); toast(`"${job.title}" is waiting for your approval (Monitor).`, 'warn', 7000); }
  if (S.view === 'monitor' && S.jobSel === job.id) drawJob();
});
pa.on('job:attention', ({ job, reason }) => {
  const waiting = job && [...S.pendingApprovals].some((k) => k.startsWith(job.id));
  if (!waiting || firstTime('attn', job.id, 120000)) { sound('attention'); toast(reason, 'warn', 9000); }
});
pa.on('busy', (b) => { S.busy = b; if (!b) { refreshJobs().then(() => { const last = S.jobs[0]; if (last) sound(last.status === 'done' ? 'done' : last.status === 'failed' ? 'failed' : 'done'); }); } });

/* ---------- new job form (same as asking in chat, but with clicks) ---------- */
// newJobModal lives in views2.js (shared target and time picker)
function scheduleSpec(s) {
  if (s.mode !== 'custom') return { mode: s.mode };
  return { mode: 'custom', start: s.start || undefined, times: String(s.times || '').split(/[,\s]+/).filter(Boolean), every: s.every || '1d' };
}

/* ================= POSTS (history) ================= */
RENDER.posts = async (target) => {
  const hist = await call('history.list');
  const v = target || $('#view-monitor');
  const q = h('input', { type: 'text', placeholder: 'Search posts', style: { width: '260px' } });
  const statusSel = sel([['', 'All'], ['done', 'Done'], ['failed', 'Failed'], ['needs_user', 'Needs you']], '');
  const body = h('tbody');
  const draw = () => {
    const t = q.value.toLowerCase();
    const rows = hist.filter((x) => (!statusSel.value || x.status === statusSel.value) && (!t || `${x.name} ${x.target} ${x.text} ${x.title}`.toLowerCase().includes(t)));
    body.replaceChildren(...rows.slice(0, 500).map((x) => h('tr', null,
      h('td', { class: 'small', text: fmtDate(x.at) }),
      h('td', null, h('div', { text: x.name }), h('div', { class: 'dim small', text: x.title || '' })),
      h('td', { class: 'small', text: x.target }),
      h('td', null, pill(x.status), x.error ? h('div', { class: 'dim small', text: x.error }) : null),
      h('td', { class: 'small', text: x.dueAt ? fmtDue(x.dueAt) : '' }),
      h('td', { class: 'small', style: { maxWidth: '420px', whiteSpace: 'pre-wrap' }, text: x.text.slice(0, 260) }),
      h('td', null, x.url ? h('button', { class: 'btn s', onclick: () => call('shell.external', x.url) }, 'Open') : null))));
    if (!rows.length) body.replaceChildren(h('tr', null, h('td', { colspan: 7, class: 'empty', text: 'No posts yet.' })));
  };
  q.oninput = draw; statusSel.onchange = draw;
  v.replaceChildren(h('div', { class: 'head' }, h('h1', { text: 'Posts' }), h('span', { class: 'muted small', text: `${hist.length} post(s) made by the app` }), h('div', { class: 'sp' }), q, statusSel,
    h('button', { class: 'btn ghost', onclick: async () => { if (await confirmBox('Clear the post history?', 'Only the list in this app is cleared. Posts stay on the platforms.', 'Clear', true)) { await call('history.clear'); RENDER.posts(); } } }, 'Clear')),
  h('div', { class: 'scroll' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ...['Time', 'File', 'Account', 'Status', 'Scheduled for', 'Caption', ''].map((x) => h('th', { text: x })))), body)));
  draw();
};

/* ================= boot ================= */
(async function boot() {
  S.info = await call('app.info');
  await loadSettings();
  try { S.whisperReady = (await call('whisper.status', null, { quiet: true })).ready; } catch (_) { /* ignore */ }
  await refreshJobs();
  S.pendingApprovals = new Set(await call('jobs.pending'));
  const st = await call('chat.state');
  S.chatStatus = st;
  if (st.running) S.chatId = st.chatId;
  const chats = await call('chat.list');
  if (!S.chatId && chats[0] && Date.now() - chats[0].updatedAt < 6 * 3600 * 1000) S.chatId = chats[0].id;
  if (S.chatId) S.chat = await call('chat.load', S.chatId);
  go(S.pendingApprovals.size ? 'monitor' : 'home');
})();
pa.on('settings:changed', (s) => { S.settings = s; renderSide(); });
pa.on('nav', (v) => go(v));

/* ================= "/" menu: skills, formats, styles ================= */
let slashCat = null;
async function catalogList() { if (!slashCat || Date.now() - slashCat.at > 30000) slashCat = { at: Date.now(), list: await call('slash.catalog', null, { quiet: true }).catch(() => []) }; return slashCat.list; }
// @account / @account channel entries for the chat box (accounts come from the Accounts page)
let acctCat = null;
async function acctList() { if (!acctCat || Date.now() - acctCat.at > 8000) acctCat = { at: Date.now(), list: await call('accounts.list', null, { quiet: true }).catch(() => []) }; return acctCat.list; }
function mentionItems(accs, q) {
  const out = [];
  const ai = (a) => a.kind === 'buffer' || a.channels?.length;
  const all = accs.filter(ai);
  if (all.length > 1) out.push({ type: 'all', name: 'all', insert: '@all ', label: `every channel of every account (${all.length} accounts)` });
  for (const a of all) {
    const chs = a.channels || [];
    out.push({ type: a.loggedIn ? 'account' : 'sign in', name: a.name, insert: `@${a.name} `, label: chs.length ? `all ${chs.length} channels in one post: ${chs.map((c) => c.service).join(', ')}` : 'account' });
    if (chs.length > 1) for (const c of chs) out.push({ type: 'channel', name: `${a.name} ${c.service}`, insert: `@${a.name} ${c.service} `, label: c.name });
  }
  return out.filter((it) => !q || it.name.toLowerCase().includes(q) || it.label.toLowerCase().includes(q));
}
function attachSlash(ta) {
  const pop = $('#slashPop');
  let items = [], sel = 0, tokenStart = -1, mention = false;
  const close = () => { pop.classList.add('hidden'); items = []; };
  const pick = (it) => {
    const v = ta.value, pos = ta.selectionStart;
    const ins = it.insert || `/${it.name} `;
    ta.value = `${v.slice(0, tokenStart)}${ins}${v.slice(pos)}`;
    const np = tokenStart + ins.length;
    ta.setSelectionRange(np, np); ta.focus(); close();
  };
  const draw = () => {
    pop.replaceChildren(...items.map((it, i) => h('div', { class: `si ${i === sel ? 'on' : ''}`, onmousedown: (e) => { e.preventDefault(); pick(it); } }, h('span', { class: 'ty', text: it.type }), h('b', { text: it.insert ? it.insert.trim() : `/${it.name}` }), h('span', { class: 'hi', text: it.label }))));
    const r = ta.getBoundingClientRect();
    pop.style.left = `${r.left}px`; pop.style.bottom = `${window.innerHeight - r.top + 6}px`; pop.style.top = 'auto';
    pop.classList.toggle('hidden', !items.length);
  };
  ta.addEventListener('input', async () => {
    const pos = ta.selectionStart, before = ta.value.slice(0, pos);
    const mm = /(^|\s)@([^\s@]*)$/.exec(before);
    if (mm) {
      tokenStart = pos - mm[2].length - 1; mention = true;
      items = mentionItems(await acctList(), mm[2].toLowerCase()).slice(0, 14);
      sel = 0; draw(); return;
    }
    mention = false;
    const m = /(^|\s)\/([\w\-\u0980-\u09ff]*)$/.exec(before);
    if (!m) { close(); return; }
    tokenStart = pos - m[2].length - 1;
    const q = m[2].toLowerCase();
    items = (await catalogList()).filter((it) => !q || it.name.includes(q) || it.label.toLowerCase().includes(q)).slice(0, 12);
    sel = 0; draw();
  });
  ta.addEventListener('keydown', (e) => {
    if (pop.classList.contains('hidden') || !items.length) return;
    if (e.key === 'ArrowDown') { sel = (sel + 1) % items.length; draw(); e.preventDefault(); e.stopImmediatePropagation(); }
    else if (e.key === 'ArrowUp') { sel = (sel - 1 + items.length) % items.length; draw(); e.preventDefault(); e.stopImmediatePropagation(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { pick(items[sel]); e.preventDefault(); e.stopImmediatePropagation(); }
    else if (e.key === 'Escape') { close(); e.stopImmediatePropagation(); }
  }, true);
  ta.addEventListener('blur', () => setTimeout(close, 150));
}

/* ================= drag and drop ================= */
const DROP = {}; // view -> handler(paths)
let dragDepth = 0;
document.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; $('#dropHint').classList.remove('hidden'); } });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropHint').classList.add('hidden'); } });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0; $('#dropHint').classList.add('hidden');
  const paths = [...(e.dataTransfer?.files || [])].map((f) => pa.pathFor(f)).filter(Boolean);
  if (!paths.length) return;
  const fn = DROP[S.view] || DROP.chat;
  try { await fn(paths); } catch (err) { toast(err.message, 'err'); }
});
DROP.chat = (paths) => { if (S.view !== 'chat') go('chat'); setTimeout(() => insert(paths.map((p) => `"${p}"`).join(' ')), 50); };
