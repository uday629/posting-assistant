// Direct posting through a real browser inside the app (persistent sign-ins, separate from the app UI).
// The user signs in once per site. A small agent loop then uploads the file, fills title/caption/tags, sets the
// platform's own schedule and confirms. Trusted mouse/keyboard input and file picking go through the Chrome
// DevTools protocol. The agent never types passwords and stops on login pages or captchas.
const { BrowserWindow, session } = require('electron');
const store = require('../store');
const providers = require('../llm/providers');
const { parseJson, stripThink } = require('../agent/json');

const PARTITION = 'persist:social';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PLATFORMS = {
  youtube: {
    label: 'YouTube (Studio)', home: 'https://studio.youtube.com/', cookie: { domain: 'youtube.com', names: ['SAPISID', '__Secure-3PAPISID', 'LOGIN_INFO'] },
    hints: `YouTube Studio: click "Create" (top right) > "Upload videos", then upload the file. Fill "Title" and "Description" (they are rich text boxes). Choose "No, it's not made for kids". Open "Show more" for Tags if keywords are given (comma separated). Click "Next" until "Visibility". For a schedule pick "Schedule", set the date and time, then "Schedule". For now choose "Public" then "Publish". Wait for the confirmation dialog ("Video published" or "Video scheduled") and its link.`
  },
  meta: {
    label: 'Meta Business Suite (Facebook + Instagram)', home: 'https://business.facebook.com/latest/composer/', cookie: { domain: 'facebook.com', names: ['c_user'] },
    hints: `Meta Business Suite composer: choose the post placements (Facebook Page and/or Instagram) at the top, "Add photo/video" > upload from computer, write the text in the caption box. For scheduling use "Schedule" (or the arrow next to Publish > Schedule), set the date and time, then confirm "Schedule". For now click "Publish". Reels use "Create reel" instead of post if the file is a vertical video and the task says reel.`
  },
  facebook: {
    label: 'Facebook', home: 'https://business.facebook.com/latest/composer/', cookie: { domain: 'facebook.com', names: ['c_user'] },
    hints: 'Use the Meta Business Suite composer (it supports scheduling). Select only the Facebook Page placement, add the video/photo, write the caption, then Schedule or Publish.'
  },
  instagram: {
    label: 'Instagram', home: 'https://business.facebook.com/latest/composer/', alt: 'https://www.instagram.com/', cookie: { domain: 'instagram.com', names: ['sessionid'] },
    hints: 'For scheduling use the Meta Business Suite composer (Instagram placement only) if the account is linked there. Otherwise instagram.com: "Create" (+) > "Post" > "Select from computer", upload, Next, Next, write the caption, "Share" (instagram.com cannot schedule; tell the user with fail if a schedule time was required).'
  },
  tiktok: {
    label: 'TikTok (Studio)', home: 'https://www.tiktok.com/tiktokstudio/upload', cookie: { domain: 'tiktok.com', names: ['sessionid', 'sessionid_ss'] },
    hints: 'TikTok Studio upload page: "Select video" to upload, wait for processing, write the description (caption + hashtags) in the description box, set "When to post" to "Schedule" with the date and time if required, then "Post" / "Schedule". Accept the content check prompts if asked.'
  },
  linkedin: {
    label: 'LinkedIn', home: 'https://www.linkedin.com/feed/', cookie: { domain: 'linkedin.com', names: ['li_at'] },
    hints: 'LinkedIn feed: "Start a post", then the media (photo/video) button to upload, "Next", write the text. For scheduling click the clock icon next to "Post", set date and time, "Next", then "Schedule". Otherwise "Post".'
  },
  x: {
    label: 'X (Twitter)', home: 'https://x.com/compose/post', cookie: { domain: 'x.com', names: ['auth_token'] },
    hints: 'X compose box: write the text (max 280 chars), add media with the image icon (file input), for a schedule use the calendar/clock "Schedule" icon, set date and time, "Confirm", then "Schedule". Otherwise "Post".'
  },
  threads: {
    label: 'Threads', home: 'https://www.threads.com/', cookie: { domain: 'threads.com', names: ['sessionid'] },
    hints: 'Threads: open the composer ("What\'s new?"), write the text, attach media, use the "..." menu > Schedule if a time is required, then Post.'
  },
  pinterest: {
    label: 'Pinterest', home: 'https://www.pinterest.com/pin-creation-tool/', cookie: { domain: 'pinterest.com', names: ['_auth', '_pinterest_sess'] },
    hints: 'Pinterest pin builder: upload the file, write Title and Description, pick a board, "Publish later" with date/time for a schedule, else "Publish".'
  }
};
// schedulers and AI chat sites (each added account gets its own private browser profile)
Object.assign(PLATFORMS, {
  buffer: {
    label: 'Buffer', group: 'scheduler', home: 'https://publish.buffer.com/',
    hints: 'Buffer web app (publish.buffer.com). Open the composer with "New Post" / "Create Post" (or the "+" button). In the composer make sure ONLY the target channel is selected (click channel avatars at the top to select or deselect; names show on hover or in the list). Attach the file with the media area ("Drag & drop or select a file" / "Upload"), which opens a file picker. Type the caption in the main text box. For YouTube fill the "Title" field (and Category if required). For Instagram pick "Reel" when it asks for the post type. Then open the arrow or menu next to "Add to Queue" and choose "Schedule Post" (or "Customize"), set the date and the time, and confirm "Schedule Post". For "now" choose "Share Now". Wait until the composer closes or a "scheduled" or "added" message appears, then done.'
  },
  hootsuite: { label: 'Hootsuite', group: 'scheduler', home: 'https://hootsuite.com/dashboard', hints: 'Hootsuite: "Create" > "Post", select the social account, add media, write text, "Schedule for later" with date and time, then "Schedule".' },
  publer: { label: 'Publer', group: 'scheduler', home: 'https://app.publer.com/', hints: 'Publer: "Create" post, choose the account, add media, write the caption, pick "Schedule" with date and time, confirm.' },
  later: { label: 'Later', group: 'scheduler', home: 'https://app.later.com/', hints: 'Later: upload media to the library, "Create Post" for the profile, write caption, set date and time, "Save".' },
  metricool: { label: 'Metricool', group: 'scheduler', home: 'https://app.metricool.com/', hints: 'Metricool: Planner > "Create post", select the network, add media, caption, choose date and time, "Schedule".' },
  zoho: { label: 'Zoho Social', group: 'scheduler', home: 'https://social.zoho.com/', hints: 'Zoho Social: "New Post", select the channel, attach media, write text, "Schedule" with date and time.' },
  chatgpt: { label: 'ChatGPT (web)', group: 'ai', home: 'https://chatgpt.com/' },
  gemini: { label: 'Google Gemini (web)', group: 'ai', home: 'https://gemini.google.com/app' },
  claude: { label: 'Claude (web)', group: 'ai', home: 'https://claude.ai/new' }
});
for (const p of Object.values(PLATFORMS)) if (!p.group) p.group = 'social';

function platformId(p) {
  const s = String(p || '').toLowerCase();
  if (/youtube|yt/.test(s)) return 'youtube';
  if (/business|meta/.test(s)) return 'meta';
  if (/insta/.test(s)) return 'instagram';
  if (/facebook|fb/.test(s)) return 'facebook';
  if (/tiktok/.test(s)) return 'tiktok';
  if (/linkedin/.test(s)) return 'linkedin';
  if (/twitter|^x$/.test(s)) return 'x';
  if (/threads/.test(s)) return 'threads';
  if (/pinterest/.test(s)) return 'pinterest';
  if (/buffer/.test(s)) return 'buffer';
  for (const k of ['hootsuite', 'publer', 'later', 'metricool', 'zoho', 'chatgpt', 'gemini', 'claude']) if (s.includes(k)) return k;
  return null;
}

const configured = new Set();
function ses(partition = PARTITION) {
  const s = session.fromPartition(partition);
  if (!configured.has(partition)) {
    configured.add(partition);
    // look like normal Chrome (some sites refuse "Electron" browsers)
    const ua = s.getUserAgent().replace(/\s(Electron|posting-assistant|Posting Assistant)\/\S+/gi, '');
    s.setUserAgent(ua);
    s.setPermissionRequestHandler((_wc, perm, cb) => cb(['clipboard-sanitized-write', 'fullscreen'].includes(perm)));
    // keep sign-ins: a login cookie without an expiry date dies when the app closes, so give it 90 days
    s.cookies.on('changed', (_e, c, cause, removed) => {
      if (removed || !c.session || cause !== 'explicit') return;
      const host = String(c.domain || '').replace(/^\./, '');
      if (!host) return;
      const o = { url: `http${c.secure ? 's' : ''}://${host}${c.path || '/'}`, name: c.name, value: c.value, path: c.path || '/', secure: !!c.secure, httpOnly: !!c.httpOnly, expirationDate: Math.floor(Date.now() / 1000) + 90 * 86400 };
      if (!c.hostOnly) o.domain = c.domain;
      if (c.sameSite && c.sameSite !== 'unspecified') o.sameSite = c.sameSite;
      s.cookies.set(o).catch(() => { /* a cookie the store refuses stays a session cookie */ });
    });
  }
  return s;
}
async function loginStatus(pid) {
  const P = PLATFORMS[pid];
  if (!P) return false;
  try {
    const cookies = await ses().cookies.get({ domain: P.cookie.domain });
    return cookies.some((c) => P.cookie.names.includes(c.name) && c.value);
  } catch (_) { return false; }
}
async function statusAll() {
  const out = {};
  for (const id of Object.keys(PLATFORMS)) out[id] = { label: PLATFORMS[id].label, loggedIn: await loginStatus(id), home: PLATFORMS[id].home };
  return out;
}

const windows = new Set();
function makeWindow({ show, title, parent, partition = PARTITION } = {}) {
  const w = new BrowserWindow({
    width: 1320, height: 900, show: !!show, title: title || 'Posting Assistant browser', autoHideMenuBar: true, backgroundColor: '#ffffff', parent,
    webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false }
  });
  ses(partition);
  w.removeMenu();
  // only web pages, never local files or app protocols
  w.webContents.on('will-navigate', (e, url) => { if (!/^https?:|^about:blank/i.test(url)) e.preventDefault(); });
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) w.loadURL(url); return { action: 'deny' }; });
  windows.add(w);
  w.on('closed', () => windows.delete(w));
  return w;
}
// visible window for the user to sign in (or check an account)
function openSite(pid, url) {
  const P = PLATFORMS[pid];
  const w = makeWindow({ show: true, title: `Sign in: ${P ? P.label : url}` });
  w.loadURL(url || P?.alt || P?.home || 'about:blank');
  return w;
}
async function logout(pid) {
  const P = PLATFORMS[pid];
  if (!P) return;
  const cookies = await ses().cookies.get({ domain: P.cookie.domain });
  for (const c of cookies) {
    const url = `http${c.secure ? 's' : ''}://${c.domain.replace(/^\./, '')}${c.path}`;
    try { await ses().cookies.remove(url, c.name); } catch (_) { /* ignore */ }
  }
}

/* ---------------- page reading (runs inside the page) ---------------- */
const SNAPSHOT = `(() => {
  const out = [], seen = new Set();
  window.__pa = [];
  const SEL = 'a[href],button,input,textarea,select,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemradio],[role=option],[role=checkbox],[role=radio],[role=switch],[role=combobox],[role=textbox],[role=listbox],[role=spinbutton],[contenteditable=""],[contenteditable=true],[tabindex]:not([tabindex="-1"]),label[for]';
  const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05 && r.bottom > 0 && r.right > 0 && r.top < innerHeight + 2 && r.left < innerWidth + 2; };
  const txt = (e) => (e.getAttribute('aria-label') || e.innerText || e.value || e.getAttribute('title') || e.getAttribute('placeholder') || e.getAttribute('alt') || '').replace(/\\s+/g, ' ').trim().slice(0, 90);
  const walk = (root) => {
    let list = [];
    try { list = root.querySelectorAll(SEL); } catch (_) {}
    for (const e of list) {
      if (seen.has(e)) continue; seen.add(e);
      const file = e.tagName === 'INPUT' && e.type === 'file';
      if (!file && !vis(e)) continue;
      if (e.closest && e.closest('[aria-hidden=true]') && !file) continue;
      const i = window.__pa.push(e) - 1;
      const tag = e.tagName.toLowerCase();
      const role = e.getAttribute('role');
      let kind = file ? 'file-input' : tag === 'input' ? 'input[' + (e.type || 'text') + ']' : e.isContentEditable ? 'textbox(rich)' : role ? role : tag;
      const bits = [];
      const t = txt(e); if (t) bits.push('"' + t + '"');
      if (e.placeholder && !t.includes(e.placeholder)) bits.push('placeholder="' + e.placeholder.slice(0, 60) + '"');
      if ((tag === 'input' || tag === 'textarea') && e.value && e.type !== 'password') bits.push('value="' + String(e.value).slice(0, 60) + '"');
      if (e.isContentEditable && e.innerText.trim()) bits.push('has text');
      if (e.disabled || e.getAttribute('aria-disabled') === 'true') bits.push('disabled');
      const cls = typeof e.className === 'string' ? e.className : '';
      if (e.checked || e.getAttribute('aria-checked') === 'true' || e.getAttribute('aria-selected') === 'true' || e.getAttribute('aria-pressed') === 'true' || /(^|[\\s_-])(selected|is-selected|isSelected|active|checked|sel|chosen)([\\s_-]|$)/.test(cls)) bits.push('SELECTED');
      else if (Number(getComputedStyle(e).opacity) < 0.6 || e.getAttribute('aria-pressed') === 'false') bits.push('not-selected');
      if (e.getAttribute('aria-expanded') === 'true') bits.push('expanded');
      if (file && e.accept) bits.push('accept=' + e.accept.slice(0, 40));
      out.push('[' + i + '] ' + kind + ' ' + bits.join(' '));
      if (out.length > 260) return;
    }
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
  };
  walk(document);
  const dlg = [...document.querySelectorAll('[role=dialog],[aria-modal=true],dialog[open],ytcp-dialog,tp-yt-paper-dialog')].filter(vis).pop();
  const textOf = (n) => (n ? n.innerText : document.body ? document.body.innerText : '').replace(/[\\t ]+/g, ' ').replace(/\\n{2,}/g, '\\n').trim();
  const pw = [...document.querySelectorAll('input[type=password]')].some(vis);
  const cap = !!document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="arkoselabs"],iframe[src*="captcha"],#captcha,[id*=captcha i]');
  return { url: location.href, title: document.title, elements: out.join('\\n'), text: textOf(dlg).slice(0, 2500), dialog: !!dlg, password: pw, captcha: cap, scrollY: Math.round(scrollY), scrollH: document.documentElement.scrollHeight };
})()`;

class Driver {
  constructor(win, onFrame) { this.win = win; this.wc = win.webContents; this.onFrame = onFrame; this.pendingFiles = null; this.autoFiles = null; this.chooser = null; }
  async attach() {
    // the debugger needs a document: commands sent to a window that never loaded anything wait forever
    if (!this.wc.getURL()) await loadUrl(this.win, 'about:blank');
    const d = this.wc.debugger;
    if (!d.isAttached()) d.attach('1.3');
    await d.sendCommand('Page.enable');
    await d.sendCommand('DOM.enable');
    await d.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });
    d.on('message', (_e, method, params) => {
      if (method === 'Page.fileChooserOpened') {
        // any file dialog opened while the file is not uploaded yet gets the post's file (the model often just clicks "Select files")
        const files = this.pendingFiles || this.autoFiles;
        if (files) {
          d.sendCommand('DOM.setFileInputFiles', { files, backendNodeId: params.backendNodeId }).then(() => { this.chooser = 'set'; }).catch((e) => { this.chooser = `error: ${e.message}`; });
        } else this.chooser = 'opened-without-file';
      }
    });
    await d.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  }
  cmd(m, p) { return this.wc.debugger.sendCommand(m, p); }
  // runs app-written code in the remote page through the DevTools protocol (values are passed with JSON.stringify)
  async js(expr) {
    const r = await this.cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] || 'page script error');
    return r.result.value;
  }
  async snapshot() { return this.js(SNAPSHOT); }
  async frame(width = 1024) {
    try {
      const img = await this.wc.capturePage();
      const sz = img.getSize();
      const jpg = (sz.width > width ? img.resize({ width }) : img).toJPEG(62);
      const b64 = jpg.toString('base64');
      this.onFrame?.(b64);
      return b64;
    } catch (_) { return null; }
  }
  async center(i) {
    const r = await this.js(`(() => { const e = window.__pa && window.__pa[${Number(i)}]; if (!e || !e.isConnected) return null; e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, e.tagName, e.type || '', !!e.isContentEditable]; })()`);
    if (!r) throw new Error(`Element [${i}] is gone. Read the page again.`);
    await sleep(120);
    const r2 = await this.js(`(() => { const e = window.__pa[${Number(i)}]; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    return { x: r2[0], y: r2[1], tag: r[2], type: r[3], editable: r[4] };
  }
  async mouseClick(x, y, count = 1) {
    await this.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await sleep(40 + Math.random() * 60);
    await this.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: count });
    await sleep(30 + Math.random() * 50);
    await this.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: count });
  }
  async click(i) { const c = await this.center(i); await this.mouseClick(c.x, c.y); return c; }
  async key(key, modifiers = 0) {
    const K = { Enter: [13, '\r'], Tab: [9, ''], Escape: [27, ''], Backspace: [8, ''], Delete: [46, ''], ArrowDown: [40, ''], ArrowUp: [38, ''], ArrowLeft: [37, ''], ArrowRight: [39, ''], Space: [32, ' '], a: [65, 'a'], End: [35, ''], Home: [36, ''], PageDown: [34, ''], PageUp: [33, ''] };
    const [code, text] = K[key] || [0, key.length === 1 ? key : ''];
    const base = { key: key === 'Space' ? ' ' : key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: code, modifiers };
    await this.cmd('Input.dispatchKeyEvent', { type: modifiers ? 'rawKeyDown' : 'keyDown', ...base, ...(text && !modifiers ? { text } : {}) });
    await this.cmd('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }
  // native date/time pickers ignore typed text: set the value the way the page expects and fire input/change
  async setNative(i, type, text) {
    const t = String(text).trim();
    let v = t;
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(t) ? `${t}T00:00` : t);
    const tm = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(t.replace(/^\d{4}-\d{2}-\d{2}[T ]?/, ''));
    const p = (n) => String(n).padStart(2, '0');
    const hhmm = () => { if (!tm) return t; let h = Number(tm[1]); if (tm[3]) { const pm = /pm/i.test(tm[3]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; } return `${p(h)}:${p(tm[2] || 0)}`; };
    if (type === 'date') v = /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : !isNaN(d) ? `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` : t;
    else if (type === 'time') v = hhmm();
    else if (type === 'datetime-local') v = !isNaN(d) ? `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` : t.replace(' ', 'T');
    else if (type === 'month') v = t.slice(0, 7);
    const r = await this.js(`(() => { const e = window.__pa[${Number(i)}]; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, ${JSON.stringify(v)}); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); e.blur && e.blur(); return e.value; })()`);
    if (!r) throw new Error(`The ${type} field did not accept "${v}" (format ${type === 'date' ? 'YYYY-MM-DD' : type === 'time' ? 'HH:mm' : type}).`);
    return r;
  }
  async type(i, text, { clear = true } = {}) {
    const kind = await this.js(`(() => { const e = window.__pa && window.__pa[${Number(i)}]; return e && e.tagName === 'INPUT' ? (e.type || 'text') : ''; })()`);
    if (/^(date|time|datetime-local|month|week|color|range)$/i.test(kind)) { await this.setNative(i, kind.toLowerCase(), text); await sleep(200); return; }
    const c = await this.click(i);
    if (/^password$/i.test(c.type)) throw new Error('Refusing to type into a password field. The user must sign in.');
    await sleep(150);
    if (clear) { await this.key('a', 2); await sleep(40); await this.key('Backspace'); await sleep(60); }
    const s = String(text);
    if (c.editable) {
      const lines = s.split('\n');
      for (const [n, line] of lines.entries()) {
        if (line) await this.cmd('Input.insertText', { text: line });
        if (n < lines.length - 1) { await this.key('Enter'); await sleep(25); }
      }
    } else await this.cmd('Input.insertText', { text: /^input$/i.test(c.tag) ? s.replace(/\n+/g, ' ') : s });
    await sleep(200);
  }
  // sets the file on a file input directly, or clicks a button and catches the file chooser
  async upload(i, files) {
    this.pendingFiles = files;
    this.chooser = null;
    try {
      if (i != null && i !== '') {
        const isFile = await this.js(`(() => { const e = window.__pa[${Number(i)}]; return !!e && e.tagName === 'INPUT' && e.type === 'file'; })()`);
        if (isFile) { await this.setOnInput(`window.__pa[${Number(i)}]`, files); return 'file set on the file input'; }
        await this.click(i);
        for (let k = 0; k < 30 && !this.chooser; k++) await sleep(200);
        if (this.chooser === 'set') return 'file chosen in the file dialog';
        if (this.chooser) throw new Error(`File dialog: ${this.chooser}`);
      }
      // fall back: any file input on the page (shadow DOM included)
      const found = await this.js(`(() => { const all = []; const walk = (r) => { for (const e of r.querySelectorAll('input[type=file]')) all.push(e); for (const el of r.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot); }; walk(document); window.__paFile = all.find((e) => !e.disabled) || all[0] || null; return all.length; })()`);
      if (!found) throw new Error('No file upload field found. Click the upload/select button first.');
      await this.setOnInput('window.__paFile', files);
      return 'file set on the page file input';
    } finally { this.autoFiles = null; setTimeout(() => { this.pendingFiles = null; }, 4000); }
  }
  async setOnInput(expr, files) {
    const r = await this.cmd('Runtime.evaluate', { expression: expr });
    if (!r.result?.objectId) throw new Error('File input not found.');
    await this.cmd('DOM.setFileInputFiles', { files, objectId: r.result.objectId });
  }
  // finds the channel toggles of a scheduler composer (by the channel names we know) with their on/off state
  async channelToggles(names) {
    return this.js(`(() => {
      const names = ${JSON.stringify(names)}.map((n) => n.toLowerCase());
      // inside the open composer dialog only (the page sidebar lists the same channel names)
      const dlg = [...document.querySelectorAll('[role=dialog],[aria-modal=true]')].filter((d) => d.getBoundingClientRect().width > 50).pop();
      if (!dlg) return [];
      const els = (window.__pa || []).filter((e) => dlg.contains(e) || (e.getRootNode && dlg.contains(e.getRootNode().host)));
      const label = (e) => ((e.getAttribute('aria-label') || '') + ' ' + (e.innerText || '') + ' ' + [...e.querySelectorAll('img[alt]')].map((i) => i.alt).join(' ')).toLowerCase();
      const isOn = (e) => { const c = typeof e.className === 'string' ? e.className : ''; return e.checked || e.getAttribute('aria-checked') === 'true' || e.getAttribute('aria-selected') === 'true' || e.getAttribute('aria-pressed') === 'true' || /(^|[\\s_-])(selected|is-selected|isSelected|active|checked|sel|chosen)([\\s_-]|$)/.test(c); };
      const out = [];
      for (const n of names) {
        let best = -1, bestLen = 1e9;
        els.forEach((e, i) => { if (!e.isConnected) return; const t = label(e); if (t.includes(n) && t.length < bestLen && t.length < n.length + 80) { best = i; bestLen = t.length; } });
        if (best >= 0) out.push({ name: n, i: best, on: isOn(els[best]) });
      }
      return out;
    })()`);
  }
  async scroll(dir = 'down') {
    await this.cmd('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 450, deltaX: 0, deltaY: dir === 'up' ? -650 : 650 });
    await sleep(500);
  }
  async select(i, value) {
    return this.js(`(() => { const e = window.__pa[${Number(i)}]; if (!e || e.tagName !== 'SELECT') return 'not a select'; const v = ${JSON.stringify(String(value))}.toLowerCase(); const o = [...e.options].find((o) => o.text.toLowerCase().includes(v) || o.value.toLowerCase() === v); if (!o) return 'option not found'; e.value = o.value; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return 'selected ' + o.text; })()`);
  }
}

function loadUrl(win, url) {
  return new Promise((resolve) => {
    let done = false;
    const wc = win.webContents;
    const fin = () => {
      if (done) return;
      done = true;
      try { wc.removeListener('did-finish-load', fin); wc.removeListener('did-fail-load', fin); } catch (_) { /* window gone */ }
      resolve();
    };
    wc.once('did-finish-load', fin);
    wc.once('did-fail-load', fin);
    setTimeout(fin, 30000);
    win.loadURL(url).catch(fin);
  });
}
function localParts(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  const h12 = d.getHours() % 12 || 12;
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time24: `${p(d.getHours())}:${p(d.getMinutes())}`, time12: `${h12}:${p(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`, long: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) };
}
// confirmation texts after publishing/scheduling (English and Bangla UIs)
const CONFIRM = /\b(video|post|reel|pin|short|tweet|thread)s?\b[^.\n]{0,40}\b(has been |was |is |got )?(scheduled|published|posted|shared|uploaded and scheduled)\b|\b(scheduled|published) (for|on)\b|your (post|video|reel|pin) is (live|scheduled|now live)|\b(saved|added) (as|to) (a |your )?drafts?\b|\bdraft (saved|created|added)\b|নির্ধারিত (হয়েছে|করা হয়েছে)|প্রকাশিত হয়েছে|পোস্ট করা হয়েছে|শেয়ার করা হয়েছে/i;
const POST_LINK = /youtu\.be\/|youtube\.com\/(watch|shorts)|instagram\.com\/(p|reel)\/|facebook\.com\/.+\/(posts|videos|reel)|tiktok\.com\/@.+\/video|linkedin\.com\/(feed\/update|posts)|x\.com\/.+\/status|pinterest\.[a-z.]+\/pin\//;
const LOGIN_URL = /accounts\.google\.com|\/login|\/signin|\/sign-in|\/accounts\/login|checkpoint|\/uas\/login|\/i\/flow\/login|auth\.tiktok/i;

function agentSystem() {
  return `You operate a web browser to publish or schedule ONE social media post exactly as specified. You see a numbered list of the page's interactive elements (and sometimes a screenshot).
Reply with ONE JSON object: {"thought": "short", "action": "...", ...}
Actions:
- {"action":"click","id":N}
- {"action":"fill","id":N,"field":"title|caption|tags|first_comment"}  (the app types that exact text into element N; ALWAYS use this for title, caption/description, tags)
- {"action":"type","id":N,"text":"..."}  (replaces the field content; only for other inputs such as dates, times, search boxes)
- {"action":"upload","id":N}  (N = a file-input element or the button that opens the file picker; the app provides the file)
- {"action":"select","id":N,"value":"..."}  (only for <select> elements)
- {"action":"press","key":"Enter|Tab|Escape|ArrowDown|ArrowUp"}
- {"action":"scroll","direction":"down|up"}
- {"action":"wait","seconds":N}  (max 20, e.g. while a video uploads or processes)
- {"action":"navigate","url":"https://..."}  (only to the platform's own pages)
- {"action":"done","url":"link of the post if shown","note":"what the page confirmed"}
- {"action":"fail","reason":"why it cannot be done"}
- {"action":"need_user","reason":"what the user must do (sign in, solve a check, connect an account)"}
Rules:
- Paste the given title/caption/description/tags EXACTLY, do not rewrite them.
- Never type passwords, codes or personal data. If a sign-in page, 2-step check or captcha appears, use need_user.
- Use the platform's own scheduler when a schedule time is given. Do not publish immediately when a schedule was asked.
- Elements marked SELECTED are switched on, not-selected are off. Clicking a channel avatar toggles it. When a target channel is given, make sure it is SELECTED and every other channel is not-selected before writing.
- Do not change account settings, do not follow, like, comment or message anyone.
- After the final Publish/Schedule click, wait until the page confirms, then use done IMMEDIATELY.
- NEVER start the upload again and never post the same file twice. If any confirmation like "scheduled" or "published" is visible, reply done.
- If something does not work twice, try another element or approach. If stuck, fail with a clear reason.`;
}

// when a scripted Buffer flow stops: what the page showed (dialog text), so the failure can be understood from the log
async function diagDump(drv, log, e) {
  try {
    const t = await drv.js("(() => { const ds = [...document.querySelectorAll('[role=dialog]')].filter((d) => d.getBoundingClientRect().width > 50); return { dialogs: ds.length, text: (ds[0] ? ds[0].innerText : document.body.innerText).replace(/\\s+/g, ' ').slice(0, 260), url: location.pathname }; })()");
    log(`  page at the failure: ${t.dialogs} dialog(s), ${t.url}, "${t.text}" (${String(e.message).slice(0, 80)})`);
  } catch (_) { /* page gone */ }
}
// task: {platform, file, kind, title, text, tags[], dueAt(ISO|null), dueText, firstComment, extra}
async function postTask(task, ctx = {}) {
  const pid = platformId(task.platform);
  const P = PLATFORMS[pid];
  if (!P) throw new Error(`Direct browser posting does not support "${task.platform}".`);
  const s = store.get();
  const win = makeWindow({ show: s.showBrowserWhilePosting || ctx.show, title: `Posting to ${P.label}`, partition: task.partition || PARTITION });
  const drv = new Driver(win, ctx.onFrame);
  const log = (t) => ctx.onLog?.(t);
  active = { win, hidden: !(s.showBrowserWhilePosting || ctx.show) };
  win.on('closed', () => { if (active?.win === win) active = null; });
  try {
    await drv.attach();
    log(`Opening ${P.label}`);
    await loadUrl(win, task.startUrl || P.home);
    await sleep(2500);
    // Buffer: the scripted composer first (exact, fast); the AI agent only if the page looks different
    if (pid === 'buffer' && task.channels?.length > 1 && !task.noScript) {
      const { BufferFlow, ScriptError } = require('./bufferflow');
      try {
        return await new BufferFlow(drv, { log, signal: ctx.signal, waitIfPaused: ctx.waitIfPaused }).postMulti({ file: task.file, kind: task.kind, channels: task.channels, captions: task.captions, dueAt: task.mode === 'draft' ? 'draft' : task.dueAt || (task.mode === 'now' ? 'now' : null), category: task.category, verifyOnly: task.verifyOnly && !require('electron').app.isPackaged });
      } catch (e) {
        if (e.message === 'ABORTED') throw e; await diagDump(drv, log, e);
        // nothing was posted yet: the caller falls back to one channel at a time
        if (e instanceof ScriptError && !e.afterFinal) { log(`one-composer flow stopped (${e.message}); posting channel by channel instead`); return { ok: false, needFallback: true, reason: e.message }; }
        return { ok: false, reason: e.message };
      }
    }
    if (pid === 'buffer' && task.channel && !task.noScript) {
      const { BufferFlow, ScriptError } = require('./bufferflow');
      try {
        return await new BufferFlow(drv, { log, signal: ctx.signal, waitIfPaused: ctx.waitIfPaused }).post({ file: task.file, kind: task.kind, service: task.channel.service, channelName: task.channel.name, text: task.text, title: task.title, dueAt: task.mode === 'draft' ? 'draft' : task.dueAt || (task.mode === 'now' ? 'now' : null), category: task.category, verifyOnly: task.verifyOnly && !require('electron').app.isPackaged });
      } catch (e) {
        if (e.message === 'ABORTED') throw e; await diagDump(drv, log, e);
        if (!(e instanceof ScriptError) || e.afterFinal) return { ok: false, reason: e.message };
        log(`scripted Buffer flow stopped (${e.message}); the AI agent takes over`);
        await drv.key('Escape').catch(() => {});
        await loadUrl(win, task.startUrl || P.home);
        await sleep(3000);
        await drv.js(require('./bufferflow').DISMISS).catch(() => {});
      }
    }
    const canSee = providers.roleCanSee('main');
    const history = [];
    const goal = `PLATFORM: ${P.label}${task.channel ? `\nTARGET CHANNEL INSIDE ${P.label.toUpperCase()}: "${task.channel.name}" (${task.channel.service}). Select only this channel.` : ''}
${task.file ? `FILE TO UPLOAD: ${task.file} (${task.kind || 'video'})` : 'NO FILE: this is a text-only post, do not upload anything.'}
TEXT TO FILL (the app types it exactly; you only point at the field with the "fill" action):
${task.title ? `- field "title": ${task.title}\n` : ''}- field "caption": ${task.text.split('\n')[0].slice(0, 120)}... (${task.text.length} characters)
${task.tags?.length ? `- field "tags": ${task.tags.join(', ')}\n` : ''}${task.firstComment ? `- field "first_comment" (only if the site offers a first comment)\n` : ''}WHEN: ${task.dueAt ? `SCHEDULE (local time of this PC): date ${localParts(task.dueAt).date}, time ${localParts(task.dueAt).time24} (= ${localParts(task.dueAt).time12}), ${localParts(task.dueAt).long}. Use the site's scheduler with exactly this local date and time.` : 'Publish now.'}
${task.extra ? `EXTRA: ${task.extra}\n` : ''}HOW THIS SITE WORKS (may be slightly outdated): ${P.hints}`;
    let fails = 0, uploaded = false, lastSig = '', same = 0, finalClicked = false, channelsOk = false, finalFromDialog = false, lastDialog = false;
    drv.autoFiles = [task.file];
    for (let step = 0; step < (s.browserMaxSteps || 45); step++) {
      if (ctx.signal?.aborted) throw new Error('ABORTED');
      await ctx.waitIfPaused?.();
      // close ads, surveys, upgrade and sign-up pop-ups before looking at the page
      const closed = await drv.js(require('./bufferflow').DISMISS).catch(() => []);
      if (closed?.length) { log(`  closed pop-up: ${closed.join(', ')}`); history.push(`the app closed a pop-up (${closed.join(', ')})`); await sleep(700); }
      let snap;
      try { snap = await drv.snapshot(); } catch (e) { await sleep(1500); continue; }
      lastDialog = !!snap.dialog;
      const img = await drv.frame();
      // dev only: keep every step's screenshot to see what the agent saw
      if (process.env.PA_DEBUG_SHOTS && img && !require('electron').app.isPackaged) { try { require('fs').mkdirSync(process.env.PA_DEBUG_SHOTS, { recursive: true }); require('fs').writeFileSync(require('path').join(process.env.PA_DEBUG_SHOTS, `step-${String(step).padStart(2, '0')}.jpg`), Buffer.from(img, 'base64')); } catch (_) { /* ignore */ } }
      // the page confirms the post: finish here (never start a second upload)
      // done when the page confirms it, or when the composer closed right after the final button
      if (uploaded && finalClicked && (CONFIRM.test(`${snap.title}
${snap.text}`) || (finalFromDialog && !snap.dialog && !snap.password))) {
        const link = await drv.js(`(() => { const re = new RegExp(${JSON.stringify(POST_LINK.source)}); return [...document.querySelectorAll('a[href^="http"]')].map((x) => x.href).find((h) => re.test(h)) || ''; })()`).catch(() => '');
        log('Confirmation seen on the page');
        return { ok: true, url: link, note: (`${snap.title}\n${snap.text}`.match(CONFIRM) || [''])[0].slice(0, 200) };
      }
      // schedulers: the app itself switches on only the target channel (the model often forgets to switch the others off)
      if (task.channel && task.allChannels?.length > 1 && !channelsOk) {
        const t = await drv.channelToggles(task.allChannels).catch(() => []);
        const tgt = t.find((x) => x.name === task.channel.name.toLowerCase());
        if (tgt && t.length > 1) {
          for (const x of t) if ((x.name === tgt.name) !== x.on) { await drv.click(x.i).catch(() => {}); await sleep(500); }
          await drv.snapshot();
          const v = await drv.channelToggles(task.allChannels).catch(() => []);
          channelsOk = v.length > 1 && v.every((x) => (x.name === tgt.name) === x.on);
          log(channelsOk ? `  app selected only ${task.channel.name}` : '  app could not confirm the channel selection');
          history.push(channelsOk ? `the app selected only the channel "${task.channel.name}" (others are off). Do not click channel avatars again.` : 'the app tried to set the channels; check that only the target channel is SELECTED');
          snap = await drv.snapshot();
        }
      }
      if (!uploaded && drv.chooser === 'set') { uploaded = true; drv.autoFiles = null; history.push('the file dialog opened and the app chose the file: UPLOADED'); }
      // the same action on an unchanged page again and again: tell the model to change course
      const pageSig = `${snap.url}|${snap.text.length}|${snap.elements.length}`;
      if (snap.captcha) return { ok: false, needUser: true, reason: 'A captcha / security check is on the page. Open the browser and solve it, then retry.' };
      if ((snap.password || LOGIN_URL.test(snap.url)) && step < 3 && (task.partition || !(await loginStatus(pid)))) return { ok: false, needUser: true, reason: `Not signed in to ${P.label}. Open Accounts and sign in once.` };
      const msg = `${step === 0 ? `${goal}\n\n` : ''}STEP ${step + 1}. ${uploaded ? 'The file was already given to the page.' : 'The file is not uploaded yet.'}
URL: ${snap.url}
TITLE: ${snap.title}
${snap.dialog ? 'A DIALOG IS OPEN. Its text:' : 'PAGE TEXT:'}
${snap.text.slice(0, 1800)}
ELEMENTS:
${snap.elements.slice(0, 9000)}
Last actions: ${history.slice(-6).join(' | ') || 'none'}`;
      const messages = [{ role: 'user', text: msg, ...(canSee && img ? { images: [img] } : {}) }];
      // keep the goal visible after step 1
      if (step > 0) messages[0].text = `${goal}\n\n${msg}`;
      const r = await providers.chat('main', { system: agentSystem(), messages, json: true, maxTokens: 700, signal: ctx.signal, temperature: 0.1 });
      let a;
      try { a = parseJson(r.text); } catch (_) { history.push('invalid reply'); if (++fails > 4) return { ok: false, reason: 'The model gave no usable actions.' }; continue; }
      const act = String(a.action || '').toLowerCase();
      const sig = `${pageSig}|${act}|${a.id}|${a.text || ''}`;
      same = sig === lastSig ? same + 1 : 0;
      lastSig = sig;
      if (same >= 2) { history.push(`REPEATED "${act} [${a.id}]" ${same + 1} times and the page did not change. Do something different.`); if (same >= 5) return { ok: false, reason: `Stuck repeating ${act} on the same page.` }; }
      log(`${act}${a.id != null ? ` [${a.id}]` : ''}${a.thought ? `: ${String(a.thought).slice(0, 140)}` : ''}`);
      try {
        if (act === 'done') { await drv.frame(); return { ok: true, url: a.url && /^https?:/.test(a.url) ? a.url : '', note: String(a.note || '').slice(0, 300) }; }
        if (act === 'fail') return { ok: false, reason: String(a.reason || 'failed').slice(0, 400) };
        if (act === 'need_user') return { ok: false, needUser: true, reason: String(a.reason || 'needs the user').slice(0, 400) };
        if (act === 'click') {
          const label = await drv.js(`(() => { const e = window.__pa[${Number(a.id)}]; return e ? (e.getAttribute('aria-label') || e.innerText || e.value || '').trim().slice(0, 40) : ''; })()`).catch(() => '');
          // a schedule was asked: never press a button that publishes now or drops the post into the default queue
          if (task.dueAt && /^(share now|publish now|post now|add to queue|publish|post|share|tweet|পোস্ট করুন|এখনই)$/i.test(label.replace(/\s+/g, ' '))) {
            history.push(`BLOCKED clicking "${label}": the post must be SCHEDULED for ${localParts(task.dueAt).date} ${localParts(task.dueAt).time24}. Open the schedule option (often an arrow or menu next to this button) and set the date and time.`);
            log(`  blocked "${label}" (schedule required)`);
            continue;
          }
          if (pid === 'buffer' && task.dueAt && /^schedule post$/i.test(label.trim())) {
            const d = new Date(task.dueAt), M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const want = `${M[d.getMonth()]} ${d.getDate()}, ${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
            const shown = await drv.js(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].find((x) => /Create Post/.test(x.innerText || '')); if (!d) return ''; const b = [...d.querySelectorAll('button')]; const i = b.findIndex((x) => /^Schedule Post$/i.test((x.innerText || '').trim())); return i > 0 ? b[i - 1].innerText : ''; })()`).catch(() => '');
            if (!String(shown).replace(/\s+/g, ' ').replace(/, \d{4},/, ',').includes(want)) {
              history.push(`BLOCKED "Schedule Post": the scheduling button shows "${String(shown).trim()}" but it must show ${want}. Click the button left of "Schedule Post", choose "Set Date and Time", pick the day, type the time ${want.split(', ')[1]} and press Done.`);
              log(`  blocked Schedule Post (shows "${String(shown).trim()}", needs ${want})`);
              continue;
            }
          }
          const isFinal = /^(publish|schedule|schedule post|post|share|share now|done|confirm|tweet|pin it|publish now|add to queue|save draft|save as draft|প্রকাশ|শেয়ার|পোস্ট)\b/i.test(label) && !/^(new|create|upload)/i.test(label);
          if (isFinal && task.channel && task.allChannels?.length > 1) {
            const v = await drv.channelToggles(task.allChannels).catch(() => []);
            const wrong = v.filter((x) => (x.name === task.channel.name.toLowerCase()) !== x.on);
            if (v.length > 1 && wrong.length) {
              for (const x of wrong) { await drv.click(x.i).catch(() => {}); await sleep(400); }
              log(`  app fixed channels before the final click: ${wrong.map((x) => `${x.name}=${x.on ? 'on' : 'off'}`).join(', ')}`);
              history.push(`the app fixed the channel selection (${wrong.map((x) => x.name).join(', ')}) before the final click. Check it, then click again.`);
              continue;
            }
          }
          // never press the final button while the video is still uploading or processing
          if (isFinal && uploaded) {
            const busyRe = /please include an image or video|uploading|processing (your )?(video|media)|upload\w*[^.\n]{0,20}\d{1,3}%|\d{1,3}%[^.\n]{0,20}upload|still uploading|wait for (the )?upload/i;
            let waited = 0;
            while (waited < 600) {
              const txt = await drv.js(`(() => { const d = [...document.querySelectorAll('[role=dialog],[aria-modal=true]')].pop() || document.body; return d.innerText.slice(0, 6000); })()`).catch(() => '');
              if (!busyRe.test(txt)) break;
              if (!waited) log('  waiting for the video upload to finish');
              if (ctx.signal?.aborted) throw new Error('ABORTED');
              await sleep(3000); waited += 3;
            }
            if (waited >= 600) { history.push('the upload did not finish in 10 minutes'); return { ok: false, reason: 'The video upload did not finish in 10 minutes.' }; }
            if (waited) history.push(`waited ${waited}s for the upload to finish`);
          }
          if (isFinal) { finalClicked = true; finalFromDialog = lastDialog; }
          await drv.click(a.id); await sleep(1500); history.push(`clicked [${a.id}] "${label}"`);
        }
        else if ((act === 'fill' || act === 'type') && !/^(title|caption|description|tags|first_comment)$/i.test(String(a.field || '')) && (act === 'type' || a.text != null || await drv.js(`(() => { const e = window.__pa[${Number(a.id)}]; return !!e && e.tagName === 'INPUT' && /^(date|time|datetime-local|month|week|number)$/i.test(e.type); })()`).catch(() => false))) {
          // plain typing (dates, times, other inputs); a date/time field without text gets the scheduled value
          let t = String(a.text ?? '').replace(/^<<<\s*|\s*>>>$/g, '');
          if (!t && task.dueAt) { const kind = await drv.js(`(window.__pa[${Number(a.id)}] || {}).type || ''`).catch(() => ''); t = /time/i.test(kind) && !/date/i.test(kind) ? localParts(task.dueAt).time24 : /datetime/i.test(kind) ? `${localParts(task.dueAt).date} ${localParts(task.dueAt).time24}` : localParts(task.dueAt).date; }
          await drv.type(a.id, t.length > 200 && task.text.includes(t.slice(0, 60)) ? task.text : t);
          history.push(`typed into [${a.id}]`);
        }
        else if (act === 'fill' || act === 'type') {
          const f = String(a.field || 'caption').toLowerCase().replace('description', 'caption');
          const val = f === 'title' ? task.title : f === 'tags' ? (task.tags || []).join(', ') : f === 'first_comment' ? task.firstComment : task.text;
          if (!val) { history.push(`there is no ${f} text for this post; skip that field`); }
          else { await drv.type(a.id, val); history.push(`filled ${f} into [${a.id}]`); }
        }
        else if (act === 'upload') { const m = await drv.upload(a.id, [task.file]); uploaded = true; history.push(`upload: ${m}`); await sleep(3000); }
        else if (act === 'select') { history.push(`select [${a.id}]: ${await drv.select(a.id, a.value)}`); }
        else if (act === 'press') { await drv.key(String(a.key || 'Enter')); history.push(`pressed ${a.key}`); await sleep(600); }
        else if (act === 'scroll') { await drv.scroll(a.direction); history.push(`scrolled ${a.direction || 'down'}`); }
        else if (act === 'wait') { const sec = Math.max(1, Math.min(20, Number(a.seconds) || 5)); history.push(`waited ${sec}s`); for (let k = 0; k < sec * 2; k++) { if (ctx.signal?.aborted) throw new Error('ABORTED'); await sleep(500); } }
        else if (act === 'navigate') {
          const u = new URL(String(a.url));
          if (!(P.cookie && u.hostname.endsWith(P.cookie.domain)) && !u.hostname.endsWith(new URL(P.home).hostname.split('.').slice(-2).join('.')) && !/facebook\.com|instagram\.com|google\.com|youtube\.com|threads\.(net|com)/.test(u.hostname)) throw new Error('Navigation outside the platform is not allowed.');
          await loadUrl(win, u.href); await sleep(2000); history.push(`opened ${u.pathname}`);
        } else { history.push(`unknown action ${act}`); fails++; }
        fails = Math.max(0, fails - 1);
      } catch (e) {
        if (e.message === 'ABORTED') throw e;
        history.push(`${act} FAILED: ${e.message.slice(0, 120)}`);
        log(`  error: ${e.message}`);
        if (++fails > 6) return { ok: false, reason: `Too many errors: ${e.message}` };
      }
    }
    return { ok: false, reason: 'Step limit reached before the post was confirmed. Check the platform.' };
  } finally {
    try { win.webContents.debugger.detach(); } catch (_) { /* detached */ }
    setTimeout(() => { if (!win.isDestroyed()) win.destroy(); }, ctx.keepOpenMs || 1500);
  }
}

// opens a page (logged in) and collects the visible text while scrolling: used to learn a creator's caption style
// closes login walls, cookie banners, pop-ups and hides sponsored posts so a page can be read
const CLEAR_PAGE = `(() => {
  const norm = (e) => ((e.getAttribute('aria-label') || e.innerText || '') + '').replace(/\s+/g, ' ').trim();
  const BAD = /^(accept|allow all|agree|sign up|log in|login|create account|install|get the app|subscribe)/i;
  const GOOD = /^(close|dismiss|not now|no thanks|maybe later|skip|decline|reject( all)?|only allow essential cookies|decline optional cookies|continue without|got it)/i;
  let n = 0;
  document.querySelectorAll('[role=dialog],[aria-modal=true],div[class*=modal],div[class*=cookie],div[class*=consent],div[id*=cookie],div[id*=consent]').forEach((d) => {
    const b = [...d.querySelectorAll('button,[role=button],a,svg[aria-label]')].find((x) => { const t = norm(x.closest('button,[role=button],a') || x); return GOOD.test(t) && !BAD.test(t); });
    if (b) { (b.closest('button,[role=button],a') || b).click(); n++; return; }
    d.remove(); n++;
  });
  document.querySelectorAll('div').forEach((d) => { const s = getComputedStyle(d); if (s.position === 'fixed' && d.offsetWidth >= innerWidth * 0.9 && d.offsetHeight >= innerHeight * 0.9 && Number(s.zIndex) > 5) { d.remove(); n++; } });
  document.querySelectorAll('article,[role=article],ytd-ad-slot-renderer,ytd-promoted-sparkles-web-renderer').forEach((a) => { if (/^ytd-/i.test(a.tagName) || /(^|\n)\s*(Sponsored|Promoted|Paid partnership)\s*(\n|$)/i.test((a.innerText || '').slice(0, 300))) { a.setAttribute('data-pa-ad', '1'); a.style.display = 'none'; } });
  document.documentElement.style.overflow = 'auto'; document.body && (document.body.style.overflow = 'auto');
  return n;
})()`;
async function collectText(url, { scrolls = 6, signal, onFrame } = {}) {
  const win = makeWindow({ show: false, title: 'Reading page' });
  const drv = new Driver(win, onFrame);
  try {
    await drv.attach();
    await loadUrl(win, url);
    await sleep(3000);
    const texts = new Set();
    for (let i = 0; i <= scrolls; i++) {
      if (signal?.aborted) throw new Error('ABORTED');
      try { await drv.js(CLEAR_PAGE); } catch (_) { /* page busy */ }
      const t = await drv.js(`(() => { const out = []; document.querySelectorAll('h1,h2,h3,h4,span,div,p,a,img,yt-formatted-string').forEach((e) => { if (e.closest('[data-pa-ad]')) return; const s = (e.tagName === 'IMG' ? e.alt : (e.children.length ? '' : e.innerText)) || e.getAttribute('aria-label') || ''; const c = s.replace(/\\s+/g, ' ').trim(); if (c.length > 25 && c.length < 2500) out.push(c); }); return out; })()`);
      for (const x of t) texts.add(x);
      await drv.frame();
      await drv.scroll('down');
      await sleep(1500);
    }
    return { url: win.webContents.getURL(), title: win.webContents.getTitle(), texts: [...texts].slice(0, 400) };
  } finally {
    try { win.webContents.debugger.detach(); } catch (_) { /* detached */ }
    if (!win.isDestroyed()) win.destroy();
  }
}

// is this private profile signed in? (opens the site hidden and looks for a login page)
async function checkLogin(partition, pid) {
  const P = PLATFORMS[pid];
  const win = makeWindow({ show: false, partition });
  try {
    if (pid === 'buffer') {
      // signed in only when the Buffer app itself shows (the channel list), not a login or marketing page
      await loadUrl(win, 'https://publish.buffer.com/');
      for (let i = 0; i < 14; i++) {
        await sleep(1000);
        const r = await win.webContents.executeJavaScript("({ url: location.href, app: !!document.querySelector('ul[aria-label], [data-testid=post-card], nav a[href*=\"/channels/\"]'), pw: !!document.querySelector('input[type=password]') })").catch(() => null);
        if (!r) continue;
        if (r.pw || /\/login|signin|sign-in|\/oauth/i.test(r.url)) return false;
        if (r.app && /publish\.buffer\.com/i.test(r.url)) return true;
      }
      return false;
    }
    await loadUrl(win, P.home);
    await sleep(3500);
    const r = await win.webContents.executeJavaScript("({ url: location.href, pw: !!document.querySelector('input[type=password]'), email: !!document.querySelector('input[type=email]') })");
    return !(LOGIN_URL.test(r.url) || r.pw || (r.email && /login|signin|auth/i.test(r.url)));
  } catch (_) { return false; } finally { if (!win.isDestroyed()) win.destroy(); }
}
// visible window of one account profile, for signing in (resolves when the user closes it)
function openProfile(partition, pid, title) {
  const P = PLATFORMS[pid];
  const w = makeWindow({ show: true, partition, title: title || `Sign in: ${P ? P.label : pid}` });
  w.loadURL(P ? P.home : 'about:blank');
  return new Promise((resolve) => w.on('closed', resolve));
}
async function clearProfile(partition) {
  const s = ses(partition);
  await s.clearStorageData();
  await s.clearCache();
}
// text and labels of a page inside a profile (used to read the channel list of a Buffer account)
const PAGE_TEXT = `(() => {
  const out = new Set();
  document.querySelectorAll('img[alt],[aria-label],[title]').forEach((e) => {
    const t = (e.getAttribute('alt') || e.getAttribute('aria-label') || e.getAttribute('title') || '').trim();
    if (t && t.length < 120) out.add(t);
  });
  return { url: location.href, title: document.title, text: document.body ? document.body.innerText.slice(0, 15000) : '', labels: [...out].slice(0, 400) };
})()`;
async function runInProfile(partition, url, script, { wait = 5000 } = {}) {
  const win = makeWindow({ show: false, partition });
  try {
    await loadUrl(win, url);
    await sleep(wait);
    return await win.webContents.executeJavaScript(script);
  } finally { if (!win.isDestroyed()) win.destroy(); }
}
async function pageText(partition, url, { wait = 5000 } = {}) {
  const win = makeWindow({ show: false, partition });
  try {
    await loadUrl(win, url);
    await sleep(wait);
    return await win.webContents.executeJavaScript(PAGE_TEXT);
  } finally { if (!win.isDestroyed()) win.destroy(); }
}

// Google results (and the AI overview when shown), read in a hidden window of a separate profile
const GOOGLE_READ = `(() => {
  if (/sorry\\/index|recaptcha/i.test(location.href) || document.querySelector('#captcha-form,iframe[src*="recaptcha"]')) return { results: [], overview: '', blocked: true };
  const results = [];
  document.querySelectorAll('#search a h3').forEach((h) => {
    const a = h.closest('a');
    if (!a || !/^https?:/.test(a.href)) return;
    try { if (/(^|\\.)google\\./.test(new URL(a.href).hostname)) return; } catch (_) { return; }
    const box = a.closest('div[data-hveid]') || a.parentElement;
    const sn = box ? box.innerText.replace(h.innerText, '').replace(/\\s+/g, ' ').trim().slice(0, 300) : '';
    results.push({ title: h.innerText.trim(), url: a.href, snippet: sn });
  });
  let overview = '';
  const head = [...document.querySelectorAll('h1,h2,div,span')].find((e) => /^AI Overview$/i.test((e.innerText || '').trim()));
  if (head) {
    let box = head;
    for (let i = 0; i < 6 && box.parentElement; i++) { box = box.parentElement; if (box.innerText.length > 400) break; }
    overview = box.innerText.slice(0, 4000);
  }
  return { results, overview };
})()`;
async function readGoogle(query) {
  const win = makeWindow({ show: false, partition: 'persist:search' });
  try {
    await loadUrl(win, `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`);
    await sleep(2500);
    return await win.webContents.executeJavaScript(GOOGLE_READ);
  } finally { if (!win.isDestroyed()) win.destroy(); }
}

// asks ChatGPT / Gemini / Claude on their own websites (signed-in profile) and returns the reply text.
// The prompt never contains keys or passwords; replies are treated as untrusted text by the caller.
const AI_SITES = {
  chatgpt: { input: '#prompt-textarea, div[contenteditable="true"]', answer: '[data-message-author-role="assistant"]', busy: 'button[data-testid="stop-button"], button[aria-label*="Stop"]' },
  gemini: { input: 'rich-textarea div[contenteditable="true"], div.ql-editor[contenteditable="true"]', answer: 'message-content, model-response', busy: 'button[aria-label*="Stop"]' },
  claude: { input: 'div[contenteditable="true"].ProseMirror, div[contenteditable="true"]', answer: '.font-claude-message, .font-claude-response, [data-is-streaming]', busy: 'button[aria-label*="Stop"]' }
};
async function askWebAi(pid, partition, prompt, { signal, timeoutMs = 180000, onFrame } = {}) {
  const site = AI_SITES[pid];
  if (!site) throw new Error(`Unknown AI site ${pid}`);
  const win = makeWindow({ show: false, partition, title: PLATFORMS[pid].label });
  const drv = new Driver(win, onFrame);
  const q = (x) => JSON.stringify(x);
  try {
    await drv.attach();
    await loadUrl(win, PLATFORMS[pid].home);
    await sleep(4000);
    const url = win.webContents.getURL();
    if (LOGIN_URL.test(url) || /auth|login/i.test(url)) throw new Error(`Not signed in to ${PLATFORMS[pid].label}. Open Accounts and sign in to this AI account.`);
    const before = await drv.js(`document.querySelectorAll(${q(site.answer)}).length`);
    const ok = await drv.js(`(() => { const e = document.querySelector(${q(site.input)}); if (!e) return false; e.focus(); return true; })()`);
    if (!ok) throw new Error(`Could not find the message box on ${PLATFORMS[pid].label}.`);
    for (const [i, line] of String(prompt).split('\n').entries()) { if (i) await drv.key('Enter', 8); if (line) await drv.cmd('Input.insertText', { text: line }); }
    await sleep(300);
    await drv.key('Enter');
    const t0 = Date.now();
    let last = '', stable = 0;
    while (Date.now() - t0 < timeoutMs) {
      if (signal && signal.aborted) throw new Error('ABORTED');
      await sleep(1500);
      const r = await drv.js(`(() => { const all = document.querySelectorAll(${q(site.answer)}); return { n: all.length, text: all.length ? all[all.length - 1].innerText : '', busy: !!document.querySelector(${q(site.busy)}) }; })()`);
      await drv.frame();
      if (r.n > before && r.text && !r.busy) { stable = r.text === last ? stable + 1 : 0; last = r.text; if (stable >= 2) return last.trim(); }
      else last = r.text;
    }
    if (last) return last.trim();
    throw new Error(`${PLATFORMS[pid].label} did not answer in time.`);
  } finally {
    try { win.webContents.debugger.detach(); } catch (_) { /* detached */ }
    if (!win.isDestroyed()) win.destroy();
  }
}

// "Take control": shows the window the app is posting in (the job is paused meanwhile)
let active = null;
function takeover(on) {
  if (!active || active.win.isDestroyed()) return false;
  if (on) { active.win.show(); active.win.focus(); } else if (active.hidden) active.win.hide();
  return true;
}

function closeAll() { for (const w of windows) if (!w.isDestroyed()) w.destroy(); }

module.exports = { takeover, runInProfile, checkLogin, openProfile, clearProfile, pageText, readGoogle, askWebAi, PLATFORMS, PARTITION, platformId, loginStatus, statusAll, openSite, logout, postTask, collectText, closeAll, Driver, makeWindow, loadUrl };
