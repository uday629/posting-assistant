// Read and clean up a Buffer channel's queue or drafts through the account's own browser profile.
// list() only reads. remove() deletes the posts the user picked (by their position in a fresh list and the text snapshot).
const browser = require('./browser');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const urlFor = (channelId, view) => `https://publish.buffer.com/channels/${encodeURIComponent(String(channelId))}/schedule?tab=${view === 'drafts' ? 'drafts' : 'queue'}`;

// every post card with its day, time and text
const READ = `(() => {
  const heads = [...document.querySelectorAll('h1,h2,h3,h4,[role=heading]')].filter((h) => /(Today|Tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/.test(h.innerText || ''));
  const clean = (t) => String(t || '').replace(/\\s+/g, ' ').trim();
  return [...document.querySelectorAll('article[data-testid=post-card]')].map((c, i) => {
    let day = '';
    for (const h of heads) if (h.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) day = clean(h.innerText); else break;
    const entry = c.closest('[data-testid=queue-entry]');
    let time = '';
    for (let x = c.parentElement, k = 0; x && k < 5 && !time; x = x.parentElement, k++) { const m = /^\\s*(\\d{1,2}:\\d{2}\\s?[AP]M)/i.exec(x.innerText || ''); if (m) time = m[1]; }
    const text = clean((c.innerText || '').replace(/Add Note|Drag to reschedule|Publish Now|Edit post|More actions|View|Add tags|see more/g, ' ')).slice(0, 220);
    return { index: i, day, time, text };
  });
})()`;

async function withPage(partition, channelId, view, fn) {
  const win = browser.makeWindow({ show: false, partition });
  const drv = new browser.Driver(win);
  try {
    await drv.attach();
    await browser.loadUrl(win, urlFor(channelId, view));
    for (let i = 0; i < 20; i++) { // wait for the cards or the empty state
      await sleep(900);
      const st = await drv.js("({ n: document.querySelectorAll('article[data-testid=post-card]').length, url: location.href, pw: !!document.querySelector('input[type=password]') })");
      if (st.pw || /\/login|signin/i.test(st.url)) throw new Error('Not signed in to Buffer. Open Accounts and sign in once.');
      if (st.n || i > 8) break;
    }
    return await fn(drv, win);
  } finally {
    try { win.webContents.debugger.detach(); } catch (_) { /* detached */ }
    if (!win.isDestroyed()) win.destroy();
  }
}

async function list({ partition, channelId, view = 'schedule' }) {
  return withPage(partition, channelId, view, async (drv) => {
    // load the lazy list: scroll to the bottom a few times
    for (let i = 0; i < 4; i++) { await drv.js('window.scrollTo(0, document.body.scrollHeight); document.querySelectorAll("main,div").forEach((e) => { if (e.scrollHeight > e.clientHeight + 200) e.scrollTop = e.scrollHeight; })'); await sleep(700); }
    return drv.js(READ);
  });
}

async function clickAt(drv, js) {
  const p = await drv.js(`(() => { const e = (${js}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  if (!p) return false;
  await drv.mouseClick(p[0], p[1]);
  return true;
}

// delete the posts whose text starts with one of the given snapshots (taken from list())
async function remove({ partition, channelId, view = 'schedule', posts, onStep }) {
  const want = (posts || []).map((p) => ({ text: String(p.text || '').slice(0, 60), day: p.day || '', time: p.time || '' })).slice(0, 50);
  if (!want.length) return { deleted: 0, failed: 0 };
  return withPage(partition, channelId, view, async (drv) => {
    let deleted = 0, failed = 0;
    for (const w of want) {
      onStep?.(`Deleting: ${w.text.slice(0, 40)}`);
      const sig = JSON.stringify(w);
      const card = `(() => { const w = ${sig}; const clean = (t) => String(t || '').replace(/\\s+/g, ' ').trim(); return [...document.querySelectorAll('article[data-testid=post-card]')].find((c) => { const t = clean(c.innerText); let tm = ''; for (let x = c.parentElement, k = 0; x && k < 5 && !tm; x = x.parentElement, k++) { const m = /^\\s*(\\d{1,2}:\\d{2}\\s?[AP]M)/i.exec(x.innerText || ''); if (m) tm = m[1]; } return t.includes(w.text.slice(0, 40).trim()) && (!w.time || tm === w.time); }); })()`;
      const before = await drv.js("document.querySelectorAll('article[data-testid=post-card]').length");
      const opened = await clickAt(drv, `(() => { const c = ${card}; return c && [...c.querySelectorAll('button')].find((b) => /More actions/i.test(b.getAttribute('aria-label') || b.innerText || '')); })()`);
      if (!opened) { failed++; continue; }
      await sleep(700);
      const item = await clickAt(drv, "[...document.querySelectorAll('[role=menuitem]')].find((m) => /^Delete Post/i.test((m.innerText || '').trim()))");
      if (!item) { await drv.key('Escape'); failed++; continue; }
      await sleep(900);
      // a confirmation dialog, when Buffer asks for one
      await clickAt(drv, "[...document.querySelectorAll('[role=dialog] button,[role=alertdialog] button')].find((b) => /^(Delete( Post)?|Yes, delete|Confirm)$/i.test((b.innerText || '').trim()))");
      let gone = false;
      for (let i = 0; i < 8 && !gone; i++) { await sleep(700); gone = (await drv.js("document.querySelectorAll('article[data-testid=post-card]').length")) < before; }
      if (gone) deleted++; else failed++;
    }
    return { deleted, failed };
  });
}

/* ---------------- verification (read only) ---------------- */
const norm = (s) => String(s || '').toLowerCase().replace(/[#@\u200b]/g, '').replace(/\s+/g, ' ').trim();
const timeLabel = (iso) => { const d = new Date(iso); return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`; };
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// null = the heading says nothing usable about the day, true/false = it does
function dayMatches(heading, iso) {
  const h = String(heading || '').toLowerCase();
  const d = new Date(iso), now = new Date();
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (/\btoday\b/.test(h) && !MON.some((m) => h.includes(m))) return same(d, now);
  if (/\btomorrow\b/.test(h) && !MON.some((m) => h.includes(m))) return same(d, new Date(now.getTime() + 86400000));
  const m = new RegExp(`(${MON.join('|')})[a-z]*\\.?\\s+(\\d{1,2})\\b`).exec(h) || null;
  if (m) return MON.indexOf(m[1]) === d.getMonth() && Number(m[2]) === d.getDate();
  return null;
}
// finds the post we just saved in a list() result. Returns {post, weak} or null.
// Match: the caption (or title) start is in the card text and, when a time was set, the card time is the same.
// weak = same day and time but another text: counted as found, so an unreadable card never causes a duplicate post.
function matchPost(posts, { text, title, dueAt } = {}) {
  const keys = [text, title].map((s) => norm(s).slice(0, 30)).filter((k) => k.length >= 4);
  const timed = dueAt && !['now', 'draft'].includes(dueAt);
  const want = timed ? timeLabel(dueAt) : '';
  let weak = null;
  for (const p of posts || []) {
    const timeOk = !timed || !p.time || String(p.time).toUpperCase().replace(/\s+/g, ' ') === want;
    const day = timed ? dayMatches(p.day, dueAt) : null;
    if (!timeOk || day === false) continue;
    const t = norm(p.text);
    if (keys.some((k) => t.includes(k))) return { post: p, weak: false };
    if (timed && p.time && day === true && !weak) weak = { post: p, weak: true };
  }
  return weak;
}
// is the post in the channel's queue (view 'schedule') or drafts (view 'drafts')? One page load, a second one only when it is missing.
// Returns {found: true|false|null (nothing to match on), weak, count}. Throws when the page cannot be read (not signed in).
async function verify({ partition, channelId, view = 'schedule', text, title, dueAt, gapMs = 4000 }) {
  if (!norm(text).slice(0, 30) && !norm(title).slice(0, 30)) return { found: null, count: 0 };
  let count = 0;
  for (let n = 0; n < 2; n++) {
    if (n) await sleep(gapMs);
    const posts = await module.exports.list({ partition, channelId, view });
    count = posts.length;
    const m = matchPost(posts, { text, title, dueAt });
    if (m) return { found: true, weak: m.weak, count };
  }
  return { found: false, count };
}
// opens the channel page read only and runs one page script (used by the health check)
async function probe({ partition, channelId, view = 'schedule' }, script) {
  return withPage(partition, channelId, view, (drv) => drv.js(script));
}

module.exports = { list, remove, matchPost, verify, probe };
