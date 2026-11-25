// Chat + tool loop (adapted from PC Assistant): builds the model context, runs tools, asks for approval on risky
// tools, saves chats in the data folder.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const store = require('../store');
const paths = require('../paths');
const providers = require('../llm/providers');
const { parseJson, stripThink } = require('./json');
const prompts = require('./prompts');
const tools = require('./tools');
const { TOOLS } = tools;
const slash = require('../content/slash');
const humanize = require('../caption/humanize');

const ev = new EventEmitter();
const rid = () => crypto.randomBytes(5).toString('hex');
const chatsDir = () => paths.sub('chats');
const chatFile = (id) => path.join(chatsDir(), `${id}.json`);

/* ---------------- storage ---------------- */
const cache = new Map();
function load(id) {
  if (!id) return null;
  if (cache.has(id)) return cache.get(id);
  const c = store.readJson(chatFile(id), null);
  if (c) cache.set(id, c);
  return c;
}
function save(c) { c.updatedAt = Date.now(); cache.set(c.id, c); store.atomicWrite(chatFile(c.id), JSON.stringify(c)); }
function list() {
  const out = [];
  for (const f of fs.readdirSync(chatsDir())) {
    if (!f.endsWith('.json')) continue;
    const c = load(f.slice(0, -5));
    if (c) out.push({ id: c.id, title: c.title, updatedAt: c.updatedAt, count: c.items.length });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}
function create(title = 'New chat') {
  const c = { id: `${Date.now().toString(36)}-${rid()}`, title, createdAt: Date.now(), updatedAt: Date.now(), items: [] };
  save(c);
  return c;
}
function remove(id) {
  if (run?.chatId === id) stop();
  cache.delete(id);
  try { fs.unlinkSync(chatFile(id)); } catch (_) { /* gone */ }
}
function rename(id, title) { const c = load(id); if (c) { c.title = String(title).slice(0, 80); save(c); } }

/* ---------------- run state ---------------- */
let run = null;
const approvals = new Map();
function emit(type, data) { ev.emit(type, data); }
function push(c, item) {
  item.id = item.id || rid();
  item.at = Date.now();
  if (item.text) item.text = store.redact(item.text);
  c.items.push(item);
  save(c);
  emit('item', { chatId: c.id, item });
  return item;
}
function patch(c, item, changes) { Object.assign(item, changes); save(c); emit('item', { chatId: c.id, item }); }
function setStatus(s) { if (run) { run.status = s; emit('status', { chatId: run.chatId, status: s, running: true }); } }
// notes from jobs (finished, needs attention) shown inside the chat that started them
function note(chatId, text, kind = 'note') {
  const c = load(chatId);
  if (!c) return;
  push(c, { role: kind, text });
}

// a job waiting for approval: the card with buttons appears in the chat that started it
function approvalCard(chatId, key, job) {
  const c = load(chatId);
  if (!c) return;
  const lines = job.items.filter((it) => it.stage !== 'skipped').slice(0, 12).map((it) => {
    const first = it.captions?.platforms ? Object.values(it.captions.platforms)[0] : null;
    const cap = first ? String(first.text || '').split('\n')[0].slice(0, 110) : '';
    return `- ${it.name}: ${it.dueAt ? require("../posting/schedule").human(it.dueAt) : "queue"}${cap ? `\n  "${cap}"` : ""}`;
  });
  push(c, { role: "jobapproval", key, jobId: job.id, text: `Ready to post "${job.title}" to ${job.targets.length} channel(s). Check and approve:${lines.length ? `\n${lines.join("\n")}` : ""}`, status: "open" });
}
function needsApproval(risk, s) {
  if (risk !== 'high') return false;
  if (run?.allowAll) return false;
  return s.mode !== 'autopilot';
}
function waitApproval(item) {
  return new Promise((resolve) => {
    approvals.set(item.id, { resolve });
    run?.abort.signal.addEventListener('abort', () => { if (approvals.delete(item.id)) resolve({ decision: 'no' }); }, { once: true });
  });
}
function approve(itemId, decision) {
  const a = approvals.get(itemId);
  if (!a) return false;
  approvals.delete(itemId);
  a.resolve({ decision });
  return true;
}

function buildMessages(c, settings) {
  const maxChars = settings.maxOutputChars;
  const msgs = [];
  for (const it of c.items.filter((x) => ['user', 'action', 'result', 'assistant', 'note'].includes(x.role))) {
    let m;
    if (it.role === 'user') m = { role: 'user', text: it.text };
    else if (it.role === 'action') m = { role: 'assistant', text: JSON.stringify({ thought: it.thought, tool: it.tool, args: it.args }) };
    else if (it.role === 'result') m = { role: 'user', text: `RESULT of ${it.tool}${it.ok ? '' : ' (FAILED)'}:\n${String(it.text || '').slice(0, maxChars)}` };
    else if (it.role === 'note') m = { role: 'user', text: `[App note, not from the user] ${it.text}` };
    else m = { role: 'assistant', text: JSON.stringify({ final: it.text }) };
    const last = msgs[msgs.length - 1];
    if (last && last.role === m.role) last.text += `\n\n${m.text}`; else msgs.push(m);
  }
  if (msgs[0]?.role === 'assistant') msgs.unshift({ role: 'user', text: '(continuing)' });
  const budget = Math.max(6000, (settings.roles.main.numCtx || 16384) * 3 - 14000);
  const size = () => msgs.reduce((a, m) => a + m.text.length, 0);
  for (let i = 0; i < msgs.length - 3 && size() > budget; i++) if (msgs[i].text.length > 1200) msgs[i].text = msgs[i].text.slice(0, 800) + '\n...[older output trimmed]';
  while (msgs.length > 3 && size() > budget) { msgs.shift(); if (msgs[0]?.role === 'assistant') msgs.shift(); }
  return msgs;
}

function parseReply(text) {
  const clean = stripThink(text);
  try {
    const j = parseJson(clean);
    if (j && typeof j === 'object') {
      if (j.tool && /^(final|answer|respond|reply|finish|done|final_answer)$/i.test(j.tool)) {
        const a = j.args || j.arguments || {};
        const fin = typeof a === 'string' ? a : a.answer ?? a.final ?? a.text ?? a.message ?? a.content ?? j.thought;
        if (fin != null) return { final: typeof fin === 'string' ? fin : JSON.stringify(fin, null, 2) };
      }
      if (j.tool && TOOLS[j.tool]) return { tool: j.tool, args: j.args || j.arguments || j.parameters || {}, thought: j.thought || '' };
      if (j.tool && !TOOLS[j.tool]) return { badTool: j.tool };
      const fin = j.final ?? j.answer ?? j.response ?? j.message ?? j.reply;
      if (fin != null) return { final: typeof fin === 'string' ? fin : JSON.stringify(fin, null, 2), options: Array.isArray(j.options) ? j.options.map((o) => String(o).slice(0, 80)).filter(Boolean).slice(0, 6) : undefined };
    }
  } catch (_) { /* not json */ }
  if (clean && !/^\s*[{[]/.test(clean)) return { final: clean };
  return { invalid: true };
}

// saved caption wishes of accounts and channels (the agent uses them instead of asking)
function captionSetups() {
  try {
    const fmt = (c) => Object.entries(c || {}).filter(([, v]) => v).map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(', ');
    const lines = [];
    for (const a of require('../posting/accounts').list()) {
      if (fmt(a.caption)) lines.push(`- ${a.name}: ${fmt(a.caption)}`);
      for (const c of a.channels || []) if (fmt(c.caption)) lines.push(`- ${a.name} / ${c.name}: ${fmt(c.caption)}`);
    }
    return lines.length ? `SAVED CAPTION SETUPS (use these, do not ask):\n${lines.slice(0, 60).join('\n')}` : '';
  } catch (_) { return ''; }
}
async function accountsLine() {
  try {
    const setups = captionSetups();
    const acc = `${require('../posting/accounts').summary()}${setups ? `\n${setups}` : ''}`;
    if (acc && !store.hasSecret('bufferKey')) return acc;
    const c = await tools.channels();
    const b = await require('../posting/browser').statusAll();
    const signed = Object.entries(b).filter(([, x]) => x.loggedIn).map(([id]) => id);
    return `${acc ? `${acc}\n` : ''}Buffer API: ${c.list?.length ? c.list.map((x) => `${x.name} [${x.service}]`).join(', ') : store.hasSecret('bufferKey') ? `connected but no channels${c.err ? ` (${c.err})` : ''}` : 'not connected'}. Browser signed in: ${signed.join(', ') || 'none'}.`;
  } catch (_) { return ''; }
}

async function send(chatId, { text }) {
  if (run) throw new Error('The assistant is still working on something. Stop it first.');
  let c = load(chatId) || create();
  if (!c.items.length) c.title = String(text || 'New chat').slice(0, 60);
  push(c, { role: 'user', text: String(text || '') });
  const p = slash.parse(text);
  run = { chatId: c.id, abort: new AbortController(), status: 'Thinking...', allowAll: false, picked: p.any ? slash.context(p, 6000) : '' };
  emit('status', { chatId: c.id, status: 'Thinking...', running: true });
  try { await loop(c); } catch (e) {
    if (e.message !== 'ABORTED' && !run?.abort.signal.aborted) push(c, { role: 'error', text: e.message });
    else push(c, { role: 'error', text: 'Stopped.' });
  } finally {
    const id = c.id;
    run = null;
    emit('status', { chatId: id, status: '', running: false });
  }
  return c.id;
}

async function loop(c) {
  const settings = store.get();
  let invalid = 0, repeats = 0, forceFinal = false, searched = false;
  const seen = new Map();
  const accounts = await accountsLine();
  for (let step = 0; step < settings.maxSteps; step++) {
    if (run.abort.signal.aborted) throw new Error('ABORTED');
    setStatus(step ? 'Working...' : 'Thinking...');
    const sys = prompts.system({ settings: store.get(), accounts, workflows: require('../posting/workflows').describe(), picked: run.picked, query: [...c.items].reverse().find((x) => x.role === 'user')?.text });
    const messages = buildMessages(c, store.get());
    if (step === settings.maxSteps - 1 || forceFinal) messages.push({ role: 'user', text: forceFinal ? 'You are repeating the same actions. STOP using tools now and reply with {"final": ...}.' : 'Step limit reached. Reply now with {"final": ...}.' });
    const r = await providers.chat('main', { system: sys, messages, json: true, maxTokens: 2000, signal: run.abort.signal });
    const p = parseReply(r.text);
    if (p.final != null) { push(c, { role: 'assistant', text: humanize.clean(p.final, { slop: false }), options: p.options?.length ? p.options : undefined }); return; }
    if (forceFinal && p.tool) { push(c, { role: 'assistant', text: 'I kept repeating the same step, so I stopped. Please tell me a bit more, or pick a stronger model in Models.' }); return; }
    if (p.tool) {
      const sig = `${p.tool}:${JSON.stringify(p.args || {})}`;
      const prev = seen.get(sig);
      if (prev && (!prev.ok || prev.count >= 2 || p.tool === 'create_post_job')) {
        prev.count++;
        if (++repeats >= 3) forceFinal = true;
        push(c, { role: 'result', tool: p.tool, ok: false, text: `You already ran exactly this${prev.ok ? '' : ' and it FAILED'}. Do NOT repeat it. Change the approach or give your final answer.`, hidden: true });
        continue;
      }
    }
    if (p.invalid || p.badTool) {
      invalid++;
      // second bad reply in a row: look the user's question up on the web once per turn (web text is data only)
      if (invalid > 1 && !searched && (settings.search || {}).engine !== 'off') {
        searched = true;
        const q = String([...c.items].reverse().find((x) => x.role === 'user')?.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (q) {
          setStatus('Searching the web...');
          try {
            const web = require('../web/search');
            const w = await web.search(q, 5);
            const body = `${w.overview ? `AI overview:\n${w.overview.slice(0, 1500)}\n\n` : ''}${w.results.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${String(x.snippet || '').slice(0, 300)}`).join('\n')}`;
            if (body.trim()) push(c, { role: 'result', tool: 'web_search', ok: true, text: web.asData(`${w.engine} search: ${q}`, body.slice(0, 4000)), hidden: true });
          } catch (_) { /* no web: carry on without it */ }
        }
      }
      if (invalid > 2) { push(c, { role: 'assistant', text: stripThink(r.text) || 'I could not produce a valid answer. Try again or pick a stronger model.' }); return; }
      push(c, { role: 'result', tool: p.badTool || 'format', ok: false, text: p.badTool ? `There is no tool "${p.badTool}". Use one of: ${Object.keys(TOOLS).join(', ')}.` : 'Reply with ONE JSON object: {"tool":...,"args":...} or {"final":...}.', hidden: true });
      continue;
    }
    invalid = 0;
    const tool = TOOLS[p.tool];
    const args = p.args && typeof p.args === 'object' ? p.args : {};
    let risk;
    try { risk = tool.risk(args); } catch (_) { risk = 'high'; }
    const action = push(c, { role: 'action', tool: p.tool, args, thought: p.thought, risk, status: 'running' });
    if (needsApproval(risk, store.get())) {
      patch(c, action, { status: 'approval' });
      setStatus('Waiting for your approval...');
      emit('approval', { chatId: c.id, itemId: action.id, tool: p.tool });
      const ans = await waitApproval(action);
      if (run.abort.signal.aborted) throw new Error('ABORTED');
      if (ans.decision === 'no') { patch(c, action, { status: 'denied' }); push(c, { role: 'result', tool: p.tool, ok: false, text: 'The user DENIED this. Do not retry it.' }); continue; }
      if (ans.decision === 'all') run.allowAll = true;
      patch(c, action, { status: 'running', approved: true });
    }
    setStatus(`Running ${p.tool}...`);
    const ctx = { signal: run.abort.signal, chatId: c.id, onStatus: (s) => setStatus(s), onOutput: () => {} };
    let res;
    try { res = await tool.run(args, ctx); } catch (e) {
      if (run.abort.signal.aborted) throw new Error('ABORTED');
      res = { ok: false, text: `Error: ${e.message}` };
    }
    patch(c, action, { status: res.ok ? 'done' : 'failed' });
    const sig = `${p.tool}:${JSON.stringify(p.args || {})}`;
    const s0 = seen.get(sig);
    seen.set(sig, { count: (s0?.count || 0) + 1, ok: !!res.ok });
    push(c, { role: 'result', tool: p.tool, ok: res.ok, text: res.text, forAction: action.id });
  }
}

function stop() {
  if (!run) return;
  run.abort.abort(new Error('ABORTED'));
  for (const [id, a] of approvals) { approvals.delete(id); a.resolve({ decision: 'no' }); }
}
const isActive = () => !!run;
const state = () => (run ? { chatId: run.chatId, status: run.status, running: true } : { running: false });

module.exports = { on: (e, f) => ev.on(e, f), list, create, remove, rename, load, send, stop, approve, isActive, state, note, approvalCard };
