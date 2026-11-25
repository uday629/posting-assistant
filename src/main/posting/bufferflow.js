// Scripted Buffer composer (no AI): opens the channel's composer, uploads, writes, sets the exact date and time and
// verifies them before pressing the final button. Built from the real publish.buffer.com structure (Nov 2026).
// Throws ScriptError when the page does not look as expected, so the caller can fall back to the AI agent.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class ScriptError extends Error {}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ord = (d) => (d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th');

// closes things that block the work: surveys, upgrade/feature pop-ups, cookie banners, the "unfinished post" question.
// The composer itself is never closed. Returns what it closed.
const DISMISS = `(() => {
  const closed = [];
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  const press = (b, why) => { b.click(); closed.push(why); };
  for (const d of [...document.querySelectorAll('[role=dialog],[role=alertdialog],[aria-modal=true]')].filter(vis)) {
    const t = (d.innerText || '').slice(0, 800);
    if (/Post Composer|Create Post|Select channels/i.test(t) && !/unfinished|where you left|continue (editing|where)|restore (your )?(post|draft)/i.test(t)) continue;
    const btns = [...d.querySelectorAll('button,[role=button],a')].filter(vis);
    if (/unfinished|where you left|continue (editing|where)|restore (your )?(post|draft)/i.test(t)) {
      const b = btns.find((x) => /^(discard|start (new|fresh|over)|no|new post|don.?t restore)/i.test((x.innerText || x.getAttribute('aria-label') || '').trim()));
      if (b) { press(b, 'unfinished-post question'); continue; }
    }
    // only pop-ups that are clearly ads, surveys, upgrades, tips or sign-up nags; never a working dialog
    if (!/recommend|survey|rate (us|your)|feedback|upgrade|new feature|what.?s new|try (it|now|for free)|limited time|special offer|discount|sign up|log ?in to (continue|see)|join now|subscribe|tour|tip:|did you know|notifications?|cookie/i.test(t)) continue;
    const b = btns.find((x) => /^(close|dismiss|not now|no,? thanks|maybe later|skip|later|got it|×|✕)$/i.test((x.innerText || x.getAttribute('aria-label') || '').trim()));
    if (b) press(b, t.split('\\n')[0].slice(0, 60) || 'pop-up');
  }
  // cookie banners: prefer declining
  const c = [...document.querySelectorAll('button')].filter(vis).find((x) => /^(reject all|decline|only necessary|necessary only|reject)$/i.test((x.innerText || '').trim()));
  if (c && /cookie/i.test((c.closest('div') || document.body).innerText.slice(0, 400))) press(c, 'cookie banner');
  return closed;
})()`;

class BufferFlow {
  constructor(drv, { log = () => {}, signal, waitIfPaused } = {}) { this.drv = drv; this.log = log; this.signal = signal; this.waitIfPaused = waitIfPaused; }
  async check() { if (this.signal?.aborted) throw new Error('ABORTED'); if (this.waitIfPaused) await this.waitIfPaused(); this.shot(); }
  // a picture for the Monitor's live browser, at most one every 2 seconds
  shot() { const t = Date.now(); if (t - (this._shot || 0) < 2000) return; this._shot = t; Promise.resolve(this.drv.frame?.()).catch(() => {}); }
  js(code) { return this.drv.js(code); }
  async dismiss() { const c = await this.js(DISMISS).catch(() => []); if (c?.length) { this.log(`closed: ${c.join(', ')}`); await sleep(800); } return c || []; }
  // marks the element found by a JS expression (returning an element) and clicks its centre with a real mouse event
  async clickJs(finder, what) {
    const r = await this.js(`(() => { const e = (${finder}); if (!e) return null; e.scrollIntoView({ block: 'center', inline: 'center' }); const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`);
    if (!r) throw new ScriptError(`Could not find ${what}.`);
    await sleep(150);
    await this.drv.mouseClick(r[0], r[1]);
    this.shot();
    return true;
  }
  async waitFor(cond, ms, what) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { await this.check(); if (await this.js(cond).catch(() => false)) return true; await sleep(500); }
    throw new ScriptError(`Timed out waiting for ${what}.`);
  }
  // the open composer: a visible dialog that has the composer text (a hidden or removed one does not count)
  dlg() { const V = "[...document.querySelectorAll('[role=dialog]')].filter((d) => d.getBoundingClientRect().width > 50)"; return `(${V}.find((d) => /Post Composer|Create Post/.test(d.innerText || '')) || ${V}.find((d) => d.querySelector('[contenteditable=true],input[type=file]')))`; }
  async typeInto(finder, text, what, { lines = true } = {}) {
    await this.clickJs(finder, what);
    await sleep(200);
    await this.drv.key('a', 2); await sleep(50); await this.drv.key('Backspace'); await sleep(100);
    const parts = lines ? String(text).split('\n') : [String(text)];
    for (const [i, line] of parts.entries()) {
      if (line) await this.drv.cmd('Input.insertText', { text: line });
      if (i < parts.length - 1) { await this.drv.key('Enter'); await sleep(20); }
    }
    await sleep(250);
  }

  async openComposer() {
    await this.dismiss();
    const NEW = "[...document.querySelectorAll('button')].find((e) => /^New Post$/.test((e.innerText || '').trim()) && !e.closest('nav,aside,ul'))";
    await this.waitFor(`!!(${NEW})`, 20000, 'the "New Post" button');
    // a plain click opens the composer; the real mouse click is the fallback
    await this.js(`(${NEW}).click()`);
    await sleep(2500);
    if (!(await this.js(`!!(${this.dlg()})`))) { await this.clickJs(NEW, 'the "New Post" button'); await sleep(2500); }
    this.log(`composer ${(await this.js(`!!(${this.dlg()})`)) ? 'open' : 'not open yet'}`);
    await this.dismiss();
    await this.waitFor(`!!(${this.dlg()})`, 15000, 'the composer');
  }
  // only the target channel stays selected
  async channels(target) {
    // the channel avatars render a moment after the composer itself
    await this.waitFor(`!!(${this.dlg()}) && !!(${this.dlg()}).querySelector('button') && [...(${this.dlg()}).querySelectorAll('button')].some((b) => /^Deselect /.test((b.innerText || b.getAttribute('aria-label') || '').trim()))`, 15000, 'the selected channel in the composer').catch(() => {});
    const sel = await this.js(`(() => { const d = ${this.dlg()} || document.body; return [...d.querySelectorAll('button')].map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim()).filter((t) => /^Deselect /.test(t)).map((t) => t.slice(9)); })()`);
    if (!sel.some((n) => n.toLowerCase() === target.toLowerCase())) throw new ScriptError(`The composer did not open with "${target}" selected (it has: ${sel.join(', ') || 'none'}).`);
    for (const n of sel) if (n.toLowerCase() !== target.toLowerCase()) {
      await this.clickJs(`[...(${this.dlg()}).querySelectorAll('button')].find((b) => (b.innerText || b.getAttribute('aria-label') || '').trim() === ${JSON.stringify('Deselect ' + n)})`, `the deselect button of ${n}`);
      await sleep(600);
      this.log(`deselected ${n}`);
    }
  }
  async postType(service, kind) {
    const value = service === 'instagram' ? (kind === 'image' ? 'post' : 'reels') : null;
    if (!value) return;
    const has = await this.js(`!!(${this.dlg()}).querySelector('input[type=radio][value="${value}"]')`);
    if (!has) return;
    await this.clickJs(`(() => { const i = (${this.dlg()}).querySelector('input[type=radio][value="${value}"]'); return i.closest('label') || i.parentElement || i; })()`, `the ${value} option`);
    await sleep(500);
  }
  async upload(file) {
    const r = await this.drv.cmd('Runtime.evaluate', { expression: `(${this.dlg()}).querySelector('input[type=file]')` });
    if (!r.result?.objectId) throw new ScriptError('No file upload field in the composer.');
    await this.drv.cmd('DOM.setFileInputFiles', { files: [file], objectId: r.result.objectId });
    this.log('file given to Buffer, uploading');
    await sleep(3000);
    // done when the warning about missing media is gone and nothing says uploading/processing
    const t0 = Date.now();
    for (;;) {
      await this.check();
      const st = await this.js(`(() => { const d = ${this.dlg()} || document.body; const t = d.innerText; return { busy: /please include an image or video|finishing up|uploading|processing (your )?(video|media)|\\b\\d{1,3}%/i.test(t.replace(/\\d{1,4}\\s*$/m, '')), media: !!d.querySelector('video, img[src^="blob:"], img[src*="buffer"], img[src*="cloudfront"], [class*="thumbnail"], [class*="Thumbnail"]'), err: (t.match(/(invalid post[^\\n]*|file (is )?too (large|big)[^\\n]*|unsupported[^\\n]*|could not upload[^\\n]*)/i) || [''])[0] }; })()`);
      if (st.err) throw new Error(`Buffer: ${st.err}`);
      if (!st.busy && (st.media || Date.now() - t0 > 20000)) break;
      if (Date.now() - t0 > 15 * 60000) throw new Error('The video upload did not finish in 15 minutes.');
      await sleep(2500);
    }
    this.log(`upload finished (${Math.round((Date.now() - t0) / 1000) + 3} s)`);
  }
  async caption(text) {
    await this.typeInto(`(${this.dlg()}).querySelector('[contenteditable="true"]')`, text, 'the caption box');
    const got = await this.js(`((${this.dlg()}).querySelector('[contenteditable="true"]').innerText || '').trim().slice(0, 40)`);
    if (!got || !text.trim().startsWith(got.slice(0, 15))) throw new ScriptError('The caption did not appear in the composer.');
  }
  async youtube({ title, category }) {
    if (title) {
      const has = await this.js(`!!(${this.dlg()}).querySelector('input[aria-label="Video title"], input[placeholder*="title" i]')`);
      if (has) await this.typeInto(`(${this.dlg()}).querySelector('input[aria-label="Video title"], input[placeholder*="title" i]')`, title.replace(/[<>]/g, '').slice(0, 100), 'the video title', { lines: false });
    }
    if (category) {
      try {
        await this.clickJs(`(() => { const d = ${this.dlg()} || document.body; const lab = [...d.querySelectorAll('*')].find((e) => !e.children.length && (e.innerText || '').trim() === 'Category'); const row = lab && lab.parentElement; return row ? row.querySelector('button[role=combobox]') || row.parentElement.querySelector('button[role=combobox]') : null; })()`, 'the category field');
        await sleep(700);
        await this.clickJs(`[...document.querySelectorAll('[role=option]')].find((o) => (o.innerText || '').trim().toLowerCase() === ${JSON.stringify(category.toLowerCase())})`, `the "${category}" category`);
        await sleep(500);
      } catch (e) { this.log(`category not set (${e.message})`); await this.drv.key('Escape'); }
      await this.closePopups();
    }
  }
  // a dropdown list that stays open (Buffer keeps the category list open) covers the other sections: close it
  async closePopups() {
    const open = () => this.js("[...document.querySelectorAll('[role=listbox],[role=menu]')].some((l) => l.getBoundingClientRect().width > 20)");
    for (let i = 0; i < 3 && (await open()); i++) {
      await this.drv.key('Escape'); await sleep(500);
      if (await open()) { await this.clickJs(`[...(${this.dlg()}).querySelectorAll('h1,h2,h3,[role=heading]')].find((e) => /Create Post/.test(e.innerText || '')) || (${this.dlg()})`, 'the composer title'); await sleep(400); }
    }
    if (!(await this.js(`!!(${this.dlg()})`))) throw new ScriptError('The composer closed while closing a dropdown.');
  }
  // the scheduling button next to "Schedule Post" (shows "Next Available", "Now" or a date like "Nov 25, 7:00 PM")
  trigger() { return `(() => { const d = ${this.dlg()} || document.body; const b = [...d.querySelectorAll('button')]; const i = b.findIndex((x) => /^(Schedule Posts?|Add to Queue|Share Now|Publish Now|Post Now)$/i.test((x.innerText || '').trim())); return i > 0 ? b[i - 1] : null; })()`; }
  async pickMenu(label) {
    await this.clickJs(this.trigger(), 'the scheduling menu');
    await this.waitFor("!!document.querySelector('[role=menu]')", 5000, 'the scheduling menu');
    const items = await this.js("[...document.querySelector('[role=menu]').querySelectorAll('[role=menuitem]')].map((e) => (e.innerText || '').split('\\n')[0].trim())");
    const idx = items.findIndex((t) => t.toLowerCase() === label.toLowerCase());
    if (idx < 0) throw new ScriptError(`The scheduling menu has no "${label}" (it has ${items.join(', ')}).`);
    await this.drv.key('Home'); await sleep(150);
    for (let k = 0; k < idx; k++) { await this.drv.key('ArrowDown'); await sleep(120); }
    await this.drv.key('Enter');
    await sleep(1200);
  }
  async setDateTime(iso) {
    const d = new Date(iso);
    await this.pickMenu('Set Date and Time');
    await this.waitFor("!!document.querySelector('button[aria-label=\"Go to the Next Month\"]')", 6000, 'the calendar');
    // move to the right month
    for (let k = 0; k < 72; k++) {
      const head = await this.js("(() => { const s = [...document.querySelectorAll('[role=status]')].map((e) => e.innerText.trim()).find((t) => /^[A-Z][a-z]+ \\d{4}$/.test(t)); return s || ''; })()");
      const m = /^([A-Za-z]+) (\d{4})$/.exec(head);
      if (!m) throw new ScriptError('Could not read the calendar month.');
      const diff = (d.getFullYear() - Number(m[2])) * 12 + (d.getMonth() - MONTHS.indexOf(m[1]));
      if (diff === 0) break;
      await this.clickJs(`document.querySelector('button[aria-label="Go to the ${diff > 0 ? 'Next' : 'Previous'} Month"]')`, 'the month arrow');
      await sleep(400);
    }
    const day = `${MONTHS[d.getMonth()]} ${d.getDate()}${ord(d.getDate())}, ${d.getFullYear()}`;
    await this.clickJs(`[...document.querySelectorAll('button[aria-label]')].find((b) => b.getAttribute('aria-label').endsWith(${JSON.stringify(day)}))`, `the day ${day}`);
    await sleep(600);
    const h12 = d.getHours() % 12 || 12, mm = String(d.getMinutes()).padStart(2, '0'), ap = d.getHours() < 12 ? 'AM' : 'PM';
    const time = `${h12}:${mm} ${ap}`;
    const timeInput = "[...document.querySelectorAll('[data-radix-popper-content-wrapper] input[role=combobox], [data-radix-popper-content-wrapper] input[type=text]')].pop()";
    await this.typeInto(timeInput, time, 'the time field', { lines: false });
    await this.drv.key('Enter');
    await sleep(700);
    const val = await this.js(`(${timeInput} || {}).value || ''`);
    if (val.replace(/\s+/g, ' ').trim().toUpperCase() !== time) this.log(`time field shows "${val}" after typing ${time}`);
    // "Done" closes the picker (it may already be closed after Enter)
    const doneBtn = "[...document.querySelectorAll('[data-radix-popper-content-wrapper] button')].find((b) => /^Done$/.test((b.innerText || '').trim()))";
    if (await this.js(`!!(${doneBtn})`)) { await this.clickJs(doneBtn, 'Done'); await sleep(700); }
    // verify on the button: e.g. "Nov 25, 7:00 PM"
    const shown = await this.js(`((${this.trigger()}) || {}).innerText || ''`);
    const want = `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${time}`;
    // Buffer adds the year when it is not this year: "Jan 15, 2027, 7:30 PM"
    if (!shown.replace(/\s+/g, ' ').replace(/, \d{4},/, ',').includes(want)) throw new ScriptError(`Buffer shows "${shown.trim()}" instead of ${want}.`);
    this.log(`time set: ${want}`);
  }
  async finish(mode) {
    // dev only: picture of the composer right before the final click
    if (process.env.PA_DEBUG_SHOTS && !require('electron').app.isPackaged) { try { const img = await this.drv.wc.capturePage(); require('fs').mkdirSync(process.env.PA_DEBUG_SHOTS, { recursive: true }); require('fs').writeFileSync(require('path').join(process.env.PA_DEBUG_SHOTS, `final-${Date.now()}.png`), img.toPNG()); } catch (_) { /* ignore */ } }
    const label = mode === 'draft' ? /^Save Drafts?$/ : /^(Schedule Posts?|Add to Queue|Share Now|Publish Now|Post Now)$/i;
    // the final button stays disabled until Buffer accepts every network (title, caption, media)
    await this.waitFor(`[...(${this.dlg()}).querySelectorAll('button')].some((b) => ${label}.test((b.innerText || '').trim()) && !b.disabled)`, 25000, 'the final button to become active (Buffer may be asking for a missing field)');
    await this.clickJs(`[...(${this.dlg()}).querySelectorAll('button')].find((b) => ${label}.test((b.innerText || '').trim()) && !b.disabled)`, mode === 'draft' ? 'Save Draft' : 'the final button');
    const t0 = Date.now();
    while (Date.now() - t0 < 45000) {
      await this.check();
      await sleep(1000);
      const st = await this.js(`(() => { const d = ${this.dlg()}; const toast = [...document.querySelectorAll('[role=status],[role=alert],[data-sonner-toast],li[data-type]')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()).filter((t) => /scheduled|saved|added|shared|published|queue/i.test(t) && t.length < 160).join(' '); return { open: !!d, err: d ? ((d.innerText.match(/(invalid post[^\\n]*|cannot[^\\n]*|error[^\\n]*|limit[^\\n]*reached[^\\n]*)/i) || [''])[0]) : '', toast: toast.slice(0, 200) }; })()`);
      if (st.err) throw new Error(`Buffer: ${st.err}`);
      if (/scheduled|draft is saved|saved|added|shared|published/i.test(st.toast) || !st.open) return st.toast.trim() || 'composer closed';
    }
    const e = new ScriptError('No confirmation after the final click. Check the Buffer queue before retrying.');
    e.afterFinal = true;
    throw e;
  }

  // task: {file, kind, service, channelName, text, title, dueAt (ISO) | 'now' | 'draft' | null, category}
  async post(task) {
    await this.openComposer();
    await this.channels(task.channelName);
    await this.postType(task.service, task.kind);
    if (task.file) await this.upload(task.file);
    await this.caption(task.text);
    if (task.service === 'youtube') await this.youtube({ title: task.title, category: task.category || 'Entertainment' });
    await this.dismiss();
    let mode = 'queue';
    if (task.dueAt === 'draft') mode = 'draft';
    else if (task.dueAt === 'now') { await this.pickMenu('Now'); mode = 'now'; }
    else if (task.dueAt) { await this.setDateTime(task.dueAt); mode = 'schedule'; }
    // dev check: set and verify the time, then save as a draft instead of scheduling
    if (task.verifyOnly) mode = 'draft';
    const note = await this.finish(mode);
    return { ok: true, note: mode === 'schedule' ? `scheduled (${note})` : note };
  }

  /* ---------- several channels of one account: ONE composer, ONE upload ---------- */
  async selected() {
    return this.js(`(() => { const d = ${this.dlg()} || document.body; return [...d.querySelectorAll('button')].map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim()).filter((t) => /^Deselect /.test(t) && t !== 'Deselect all').map((t) => t.slice(9)); })()`);
  }
  async selectChannels(names) {
    await this.waitFor(`(${this.dlg()}) && [...(${this.dlg()}).querySelectorAll('button')].some((b) => /^Deselect /.test((b.innerText || b.getAttribute('aria-label') || '').trim()))`, 15000, 'the selected channel in the composer').catch(() => {});
    const low = (a) => a.map((x) => x.toLowerCase());
    let cur = await this.selected();
    const missing = names.filter((n) => !low(cur).includes(n.toLowerCase()));
    if (missing.length) {
      await this.clickJs(`[...(${this.dlg()}).querySelectorAll('button')].find((b) => /^Add channel$/i.test((b.innerText || b.getAttribute('aria-label') || '').trim()))`, 'the Add channel button');
      await this.waitFor("document.querySelectorAll('[role=option]').length > 0", 8000, 'the channel list');
      for (const n of missing) {
        await this.clickJs(`[...document.querySelectorAll('[role=option]')].find((o) => (o.innerText || '').split(String.fromCharCode(10))[0].trim().toLowerCase() === ${JSON.stringify(n.toLowerCase())})`, `the channel ${n}`);
        await sleep(900);
      }
      await this.drv.key('Escape'); await sleep(800);
    }
    cur = await this.selected();
    for (const n of cur) if (!low(names).includes(n.toLowerCase())) {
      await this.clickJs(`[...(${this.dlg()}).querySelectorAll('button')].find((b) => (b.innerText || b.getAttribute('aria-label') || '').trim() === ${JSON.stringify('Deselect ' + n)})`, `the deselect button of ${n}`);
      await sleep(600);
    }
    cur = await this.selected();
    const lack = names.filter((n) => !low(cur).includes(n.toLowerCase()));
    const extra = cur.filter((n) => !low(names).includes(n.toLowerCase()));
    if (extra.length) throw new ScriptError(`Channels that were not asked for are still selected: ${extra.join(', ')}.`);
    if (lack.length) throw new ScriptError(`Could not select the channels: ${lack.join(', ')}.`);
    this.log(`channels selected: ${cur.join(', ')}`);
  }
  // with 2+ channels Buffer first shows a shared composer; "Customize for each network" opens one section per network
  async customize() {
    const has = await this.js(`[...(${this.dlg()}).querySelectorAll('button')].some((b) => /Customize for each network/i.test(b.innerText || ''))`);
    if (!has) return;
    await this.clickJs(`[...(${this.dlg()}).querySelectorAll('button')].find((b) => /Customize for each network/i.test(b.innerText || ''))`, 'Customize for each network');
    await this.waitFor(`[...(${this.dlg()}).querySelectorAll('button')].some((b) => /^Schedule Posts?$|^Save Drafts?$/i.test((b.innerText || '').trim()))`, 10000, 'the per-network composer');
    await sleep(800);
  }
  async collapsed() {
    return this.js(`(() => { const d = ${this.dlg()} || document.body; return [...d.querySelectorAll('button')].filter((b) => /What would you like to share/i.test(b.innerText || '')).map((b) => (b.innerText || '').split(String.fromCharCode(10))[0].trim()); })()`);
  }
  // makes this network's section the open one (a collapsed section shows as "<Network> What would you like to share?")
  async openSection(service) {
    const names = { youtube: ['youtube'], tiktok: ['tiktok'], instagram: ['instagram'], facebook: ['facebook'], linkedin: ['linkedin'], twitter: ['x', 'twitter'], threads: ['threads'], pinterest: ['pinterest'], bluesky: ['bluesky'], mastodon: ['mastodon'], google: ['google business', 'google'] }[service] || [service];
    await this.closePopups();
    const col = await this.collapsed();
    const hit = col.find((c) => names.includes(c.toLowerCase()));
    if (!hit) return; // already open
    await this.clickJs(`[...(${this.dlg()}).querySelectorAll('button')].find((b) => /What would you like to share/i.test(b.innerText || '') && (b.innerText || '').split(String.fromCharCode(10))[0].trim() === ${JSON.stringify(hit)})`, `the ${hit} section`);
    await sleep(1200);
    const after = await this.collapsed();
    if (after.includes(hit)) throw new ScriptError(`The ${hit} section did not open.`);
  }
  async editorText(text, what) {
    const VIS = `[...(${this.dlg()}).querySelectorAll('[contenteditable="true"]')].find((e) => { const r = e.getBoundingClientRect(); return r.width > 20 && r.height > 10; })`;
    await this.typeInto(VIS, text, what);
    const got = await this.js(`((${VIS}) || { innerText: '' }).innerText.trim().slice(0, 40)`);
    if (!got || !text.trim().startsWith(got.slice(0, 15))) throw new ScriptError(`The caption did not appear in ${what}.`);
  }

  // task: {file, kind, channels:[{name, service}] (first = the channel whose page opened the composer), captions:{service:{text,title}}, dueAt, category}
  async postMulti(task) {
    const names = task.channels.map((c) => c.name);
    await this.openComposer();
    await this.selectChannels(names);
    // upload while the composer is still shared: the media then belongs to every network (after "Customize" it only attaches to one)
    if (task.file) await this.upload(task.file);
    await this.customize();
    for (const c of task.channels) {
      const cap = task.captions[c.service] || Object.values(task.captions)[0];
      await this.openSection(c.service);
      if (c.service === 'instagram') await this.postType('instagram', task.kind);
      await this.editorText(cap.text, `the ${c.service} caption`);
      if (c.service === 'youtube') await this.youtube({ title: cap.title || cap.text.split('\n')[0], category: task.category || 'Entertainment' });
      // Buffer shows the problem of the open network right in its section
      const warn = await this.js(`(() => { const d = ${this.dlg()} || document.body; const lines = d.innerText.split(String.fromCharCode(10)); return lines.find((l) => /please include|add the video title|invalid post|cannot contain|cannot exceed/i.test(l)) || ''; })()`);
      if (warn) throw new ScriptError(`Buffer says for ${c.service}: ${warn}`);
      this.log(`${c.service} filled`);
    }
    await this.dismiss();
    let mode = 'queue';
    if (task.dueAt === 'draft') mode = 'draft';
    else if (task.dueAt === 'now') { await this.pickMenu('Now'); mode = 'now'; }
    else if (task.dueAt) { await this.setDateTime(task.dueAt); mode = 'schedule'; }
    if (task.verifyOnly) mode = 'draft';
    const note = await this.finish(mode);
    return { ok: true, note: mode === 'schedule' ? `scheduled ${names.length} channels (${note})` : note };
  }
}



module.exports = { BufferFlow, ScriptError, DISMISS };
