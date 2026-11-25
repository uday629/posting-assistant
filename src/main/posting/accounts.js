// Posting accounts: any number of Buffer accounts (and other schedulers, social sites and AI chat sites), each in
// its own private browser profile. The user signs in once per account; the app never sees or stores passwords.
const fs = require('fs');
const crypto = require('crypto');
const store = require('../store');
const browser = require('./browser');
const providers = require('../llm/providers');
const { parseJson } = require('../agent/json');

const col = store.collection('accounts', []);
const rid = () => crypto.randomBytes(4).toString('hex');
const SERVICES = ['instagram', 'facebook', 'youtube', 'tiktok', 'linkedin', 'twitter', 'threads', 'pinterest', 'bluesky', 'mastodon', 'google'];

function list() { return col.all(); }
function get(id) { return list().find((a) => a.id === id) || null; }
function save(a) {
  const all = list();
  const kind = browser.PLATFORMS[a.kind] ? a.kind : 'buffer';
  const cur = all.find((x) => x.id === a.id);
  const next = {
    ...(cur || { id: rid(), createdAt: Date.now(), channels: [], loggedIn: false }),
    kind,
    name: String(a.name ?? cur?.name ?? browser.PLATFORMS[kind].label).trim().slice(0, 60) || browser.PLATFORMS[kind].label,
    defaultFolder: a.defaultFolder !== undefined ? String(a.defaultFolder || '') : cur?.defaultFolder || '',
    queueLimit: a.queueLimit !== undefined ? Math.max(0, Number(a.queueLimit) || 0) : cur?.queueLimit ?? (kind === 'buffer' ? 10 : 0),
    note: a.note !== undefined ? String(a.note).slice(0, 200) : cur?.note || '',
    updatedAt: Date.now()
  };
  if (Array.isArray(a.channels)) next.channels = a.channels.map(cleanChannel).filter(Boolean).slice(0, 60);
  if (a.caption !== undefined) next.caption = cleanCaption(a.caption); // undefined clears it
  next.partition = `persist:acct-${next.id}`;
  if (cur) Object.assign(cur, next); else all.push(next);
  col.save(all);
  return next;
}
// caption wishes saved on an account or one channel (empty = use the Settings defaults)
function cleanCaption(c) {
  if (!c || typeof c !== 'object') return undefined;
  const t = (x, n = 60) => String(x || '').trim().slice(0, n);
  const o = { length: ['short', 'medium', 'long'].includes(c.length) ? c.length : '', tone: t(c.tone), structure: t(c.structure), language: ['en', 'bn', 'banglish', 'bn+en'].includes(c.language) ? c.language : '', style: t(c.style), instructions: t(c.instructions, 400) };
  return Object.values(o).some(Boolean) ? o : undefined;
}
function cleanChannel(c) {
  const name = String(c?.name || '').trim().slice(0, 80);
  if (!name) return null;
  const service = SERVICES.find((s) => String(c.service || '').toLowerCase().includes(s)) || (/^x$/i.test(c.service) ? 'twitter' : 'instagram');
  const caption = cleanCaption(c.caption);
  return { id: c.id || rid(), name, service, ...(caption ? { caption } : {}), ...(c.bufferId && /^[a-f0-9]{10,40}$/i.test(c.bufferId) ? { bufferId: c.bufferId } : {}) };
}
async function remove(id) {
  const a = get(id);
  col.save(list().filter((x) => x.id !== id));
  if (a) await browser.clearProfile(a.partition).catch(() => {});
}
function setState(id, patch) { const all = list(); const a = all.find((x) => x.id === id); if (a) { Object.assign(a, patch); col.save(all); } return a; }

// opens the sign-in window; when the user closes it, checks the login and (for Buffer) reads the channels
async function signIn(id) {
  const a = get(id);
  if (!a) throw new Error('Account not found');
  await browser.openProfile(a.partition, a.kind, `${a.name}: sign in, then close this window`);
  return refresh(id, { channels: a.kind === 'buffer' });
}
async function refresh(id, { channels = false } = {}) {
  const a = get(id);
  if (!a) throw new Error('Account not found');
  const loggedIn = await browser.checkLogin(a.partition, a.kind);
  setState(id, { loggedIn, lastCheck: Date.now() });
  if (loggedIn && channels && a.kind === 'buffer') { try { await syncChannels(id); } catch (_) { /* user can add channels by hand */ } }
  return get(id);
}
// reads the channel list from the Buffer web app (names + network), the user can edit it afterwards
const BUFFER_CHANNELS = `(() => {
  const ul = [...document.querySelectorAll('ul')].find((u) => /^channels$/i.test(u.getAttribute('aria-label') || ''));
  if (!ul) return [];
  const nets = ['instagram', 'facebook', 'youtube', 'tiktok', 'linkedin', 'twitter', 'x', 'threads', 'pinterest', 'bluesky', 'mastodon', 'googlebusiness', 'google'];
  return [...ul.children].map((li) => {
    const drag = li.querySelector('[aria-label^="Drag to reorder"]');
    const link = li.querySelector('a[href*="/channels/"]');
    const name = drag ? drag.getAttribute('aria-label').replace(/^Drag to reorder\\s*/, '') : (link ? link.innerText.split('\\n')[0] : '');
    const icon = [...li.querySelectorAll('svg[data-icon]')].map((s) => s.getAttribute('data-icon')).find((i) => nets.includes(i)) || '';
    const m = link ? /\\/channels\\/([a-f0-9]+)/i.exec(link.getAttribute('href')) : null;
    return { name: name.trim(), service: icon === 'x' ? 'twitter' : icon, bufferId: m ? m[1] : '' };
  }).filter((c) => c.name);
})()`;
async function syncChannels(id) {
  const a = get(id);
  if (a.kind === 'buffer') {
    const dom = await browser.runInProfile(a.partition, 'https://publish.buffer.com/', BUFFER_CHANNELS, { wait: 6000 }).catch(() => []);
    if (dom.length) {
      const prev = a.channels || [];
      save({ id, channels: dom.map((c) => ({ ...(prev.find((p) => p.name.toLowerCase() === c.name.toLowerCase()) || {}), ...cleanChannel(c), bufferId: c.bufferId })) });
      return get(id);
    }
  }
  const page = await browser.pageText(a.partition, 'https://publish.buffer.com/', { wait: 6000 });
  const r = await providers.chat('main', {
    system: 'You read a Buffer dashboard and list the connected social channels. Reply with JSON only.',
    messages: [{ role: 'user', text: `Page labels (image alts, aria-labels):\n${page.labels.join(' | ').slice(0, 6000)}\n\nPage text:\n${page.text.slice(0, 6000)}\n\nReturn {"channels":[{"name":"channel display name","service":"instagram|facebook|youtube|tiktok|linkedin|twitter|threads|pinterest|bluesky|mastodon|google"}]} with every connected channel once. Ignore menu items and buttons.` }],
    json: true, maxTokens: 900, temperature: 0
  });
  const j = parseJson(r.text);
  const found = (j.channels || []).map(cleanChannel).filter(Boolean);
  if (found.length) {
    // keep ids of channels that already existed (jobs and workflows point to them)
    const prev = a.channels || [];
    const merged = found.map((c) => prev.find((p) => p.name.toLowerCase() === c.name.toLowerCase() && p.service === c.service) || c);
    save({ id, channels: merged });
  }
  return get(id);
}

// "@Figment", "@Figment youtube", "Figment [Buffer]", "Cooking IG", "client a instagram", "all" -> [{account, channel}]
// An account name always wins: every channel of that account (one composer), or the channel named after it.
function normalizeTarget(text) {
  return String(text || '').toLowerCase().trim().replace(/^@/, '').replace(/^buffer:/, '').replace(/\s*[\[(][^\])]*[\])]\s*$/, '').replace(/[\u200b\s]+/g, ' ').trim();
}
function resolve(text) {
  const q = normalizeTarget(text);
  const all = list().filter((a) => browser.PLATFORMS[a.kind]?.group !== 'ai');
  const out = [];
  const add = (a, c) => { if (!out.some((o) => o.account.id === a.id && o.channel?.id === c?.id)) out.push({ account: a, channel: c }); };
  const allOf = (a) => { if (a.channels?.length) a.channels.forEach((c) => add(a, c)); else add(a, null); };
  if (q === 'all' || q === 'all buffer' || q === 'all accounts') { for (const a of all) allOf(a); return out; }
  const svc = SERVICES.find((s) => q === s || q === `${s} all` || (s === 'twitter' && q === 'x'));
  // "<account>", "<account> all", "<account> <channel or network>", "<account>:<channel>"
  const byName = [...all].sort((x, y) => y.name.length - x.name.length);
  for (const a of byName) {
    const an = a.name.toLowerCase();
    if (q === an || q === `${an} all`) { allOf(a); return out; }
    if (q.startsWith(an) && /^[\s:/\-]/.test(q.slice(an.length))) {
      const rest = q.slice(an.length).replace(/^[\s:/\-]+/, '').trim();
      const rs = SERVICES.find((s) => rest === s || (s === 'twitter' && rest === 'x')) || (/^(yt)$/.test(rest) ? 'youtube' : /^(ig|insta)$/.test(rest) ? 'instagram' : /^(fb)$/.test(rest) ? 'facebook' : '');
      for (const c of a.channels || []) {
        const cn = c.name.toLowerCase();
        if (rest === cn || cn.includes(rest) || (rs && c.service === rs)) add(a, c);
      }
      if (out.length) return out;
    }
  }
  for (const a of all) for (const c of a.channels || []) if (q === c.name.toLowerCase()) add(a, c);
  if (out.length) return out;
  if (svc) for (const a of all) for (const c of a.channels || []) if (c.service === svc) add(a, c);
  if (out.length) return out;
  const starts = all.filter((a) => a.name.toLowerCase().startsWith(q) && q.length >= 2);
  if (starts.length === 1) { allOf(starts[0]); return out; }
  for (const a of all) for (const c of a.channels || []) if (c.name.toLowerCase().includes(q) || `${a.name} ${c.name}`.toLowerCase().includes(q)) add(a, c);
  return out;
}
// accounts whose name starts with the typed text (for the @ suggestions)
function suggest(prefix) {
  const q = String(prefix || '').toLowerCase().replace(/^@/, '').trim();
  return list().filter((a) => browser.PLATFORMS[a.kind]?.group !== 'ai' && (!q || a.name.toLowerCase().includes(q)))
    .map((a) => ({ id: a.id, name: a.name, kind: a.kind, loggedIn: !!a.loggedIn, channels: (a.channels || []).map((c) => ({ name: c.name, service: c.service })) }));
}
function summary() {
  return list().map((a) => `@${a.name} (${browser.PLATFORMS[a.kind]?.label || a.kind}${a.loggedIn ? '' : ', not signed in'})${a.channels?.length ? ` channels: ${a.channels.map((c) => `${c.name} (${c.service})`).join(', ')}` : ''}${a.defaultFolder ? ` folder=${a.defaultFolder}` : ''}`).join('\n');
}
function aiAccounts() { return list().filter((a) => browser.PLATFORMS[a.kind]?.group === 'ai'); }
function folderOk(p) { try { return !p || fs.statSync(p).isDirectory(); } catch (_) { return false; } }

// scheduled posts and drafts of one Buffer channel: read them, delete the ones the user picks
function chanOf(id, chId) {
  const a = get(id);
  if (!a || a.kind !== 'buffer') throw new Error('Pick a Buffer account.');
  const c = (a.channels || []).find((x) => x.id === chId || String(x.name).toLowerCase() === String(chId).toLowerCase());
  if (!c) throw new Error('Channel not found in this account.');
  if (!c.bufferId) throw new Error('Open Accounts and press "Check + read channels" first.');
  return { a, c };
}
async function queueList(id, chId, view) { const { a, c } = chanOf(id, chId); return require('./bufferqueue').list({ partition: a.partition, channelId: c.bufferId, view }); }
async function queueRemove(id, chId, view, posts, onStep) { const { a, c } = chanOf(id, chId); return require('./bufferqueue').remove({ partition: a.partition, channelId: c.bufferId, view, posts, onStep }); }
/* ---------------- selector health check (read only) ---------------- */
// the page anchors the scripted Buffer flow, the queue reader and the channel reader rely on
const HEALTH_SCRIPT = `(() => {
  const txt = (e) => (e.innerText || e.getAttribute('aria-label') || '').trim();
  const tabs = [...document.querySelectorAll('[role=tab],a,button')].map(txt);
  const cards = [...document.querySelectorAll('article[data-testid=post-card]')];
  return {
    newPost: !!([...document.querySelectorAll('button')].find((e) => /^New Post$/.test((e.innerText || '').trim()) && !e.closest('nav,aside,ul'))),
    channels: !!([...document.querySelectorAll('ul')].find((u) => /^channels$/i.test(u.getAttribute('aria-label') || '') && u.querySelector('a[href*="/channels/"]'))),
    queueTab: tabs.some((t) => /^Queue\\b/i.test(t)),
    draftsTab: tabs.some((t) => /^Drafts?\\b/i.test(t)),
    cards: cards.length,
    moreActions: cards.length ? cards.some((c) => [...c.querySelectorAll('button')].some((b) => /More actions/i.test(b.getAttribute('aria-label') || b.innerText || ''))) : null
  };
})()`;
// Opens the account's first Buffer channel (hidden window, nothing is clicked, posted or deleted) and checks the anchors.
// Returns [{name, ok, note?}]. A check that needs a post in the list ("More actions") is ok with a note when no post exists.
async function healthCheck(id) {
  const a = get(id);
  if (!a || a.kind !== 'buffer') throw new Error('Pick a Buffer account.');
  const ch = (a.channels || []).find((c) => c.bufferId);
  if (!ch) return [{ name: 'Channel list read', ok: false, note: 'Open Accounts and press "Check + read channels".' }];
  const bq = require('./bufferqueue');
  let r;
  try { r = await bq.probe({ partition: a.partition, channelId: ch.bufferId, view: 'schedule' }, HEALTH_SCRIPT); } catch (e) {
    const out = [{ name: 'Signed in', ok: !/not signed in/i.test(e.message), note: String(e.message).slice(0, 160) }];
    setState(id, { health: { at: Date.now(), ok: false, results: out } });
    if (!out[0].ok) setState(id, { loggedIn: false });
    return out;
  }
  let cardInfo = { cards: r.cards, moreActions: r.moreActions };
  if (!r.cards) { // no scheduled post: look at the drafts tab for a card
    try { const d = await bq.probe({ partition: a.partition, channelId: ch.bufferId, view: 'drafts' }, HEALTH_SCRIPT); cardInfo = { cards: d.cards, moreActions: d.moreActions }; } catch (_) { /* keep the queue result */ }
  }
  const none = !cardInfo.cards;
  const out = [
    { name: 'Signed in', ok: true },
    { name: 'New Post button', ok: r.newPost },
    { name: 'Channel list', ok: r.channels },
    { name: 'Queue tab', ok: r.queueTab },
    { name: 'Drafts tab', ok: r.draftsTab },
    { name: 'Post cards', ok: true, ...(none ? { note: 'no posts to check' } : { note: `${cardInfo.cards} found` }) },
    { name: 'More actions menu', ok: none ? true : !!cardInfo.moreActions, ...(none ? { note: 'no posts to check' } : {}) }
  ];
  setState(id, { health: { at: Date.now(), ok: out.every((x) => x.ok), results: out } });
  return out;
}
// Runs healthCheck once a day for every signed-in Buffer account, one at a time, only while no job is running or waiting.
// main.js calls scheduleHealth() once after the app is ready. onResult({account, results, ok}) lets main.js alert (e.g. when "Signed in" fails).
// Returns a stop function.
function scheduleHealth({ onResult, everyMs = 24 * 3600 * 1000, tickMs = 10 * 60 * 1000, firstMs = 3 * 60 * 1000 } = {}) {
  let busy = false, stopped = false;
  const idle = () => { try { const jobs = require('./jobs'); return !jobs.isBusy() && !jobs.queued?.(); } catch (_) { return false; } };
  const tick = async () => {
    if (busy || stopped || !idle()) return;
    busy = true;
    try {
      for (const a of list()) {
        if (stopped || !idle()) break; // a job started: leave the rest for the next tick
        if (a.kind !== 'buffer' || !a.loggedIn || !(a.channels || []).some((c) => c.bufferId)) continue;
        if (a.health?.at && Date.now() - a.health.at < everyMs) continue;
        try { const results = await healthCheck(a.id); onResult?.({ account: get(a.id), results, ok: results.every((x) => x.ok) }); } catch (_) { /* next tick */ }
      }
    } finally { busy = false; }
  };
  const first = setTimeout(tick, firstMs);
  const iv = setInterval(tick, tickMs);
  first.unref?.(); iv.unref?.();
  return () => { stopped = true; clearTimeout(first); clearInterval(iv); };
}
module.exports = { suggest, normalizeTarget, healthCheck, scheduleHealth, queueList, queueRemove, list, get, save, remove, signIn, refresh, syncChannels, resolve, summary, aiAccounts, folderOk, SERVICES };
