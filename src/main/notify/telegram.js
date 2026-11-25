// Optional Telegram phone alerts. Talks to api.telegram.org only (sendMessage), with a 5 second timeout.
// The bot token is a store secret (DPAPI): it is read here in the main process and never logged or sent to the renderer.
// Rules: at most 1 message per 30 s (waiting messages are merged into one), the same text is not sent twice in a row,
// and file paths of the user's folders are removed from every message.
const https = require('https');
const store = require('../store');

const MIN_GAP_MS = 30 * 1000;
const DEDUPE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 5000;
const MAX_LEN = 3500;

let lastSentAt = 0;
let timer = null;
let pending = [];            // [{text, silent}]
const recent = new Map();    // text -> time sent

function cfg() { return store.get().telegram || {}; }
function configured() {
  const c = cfg();
  return !!(c.enabled && store.secret('telegramToken') && validChat(c.chatId));
}
function validChat(id) { return /^-?\d{3,20}$/.test(String(id || '').trim()) || /^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(String(id || '').trim()); }

// remove private paths (C:\Users\..., \\server\share\..., /home/...) and anything that looks like a key
function clean(text) {
  let t = store.redact(String(text ?? ''));
  t = t.replace(/[A-Za-z]:[\\/][^\s"'<>|,;]*/g, '[folder]').replace(/\\\\[^\s"'<>|]+/g, '[folder]').replace(/(^|\s)\/(?:home|Users|mnt|media|var|etc)\/[^\s"'<>|]*/g, '$1[folder]');
  return t.replace(/\s+\n/g, '\n').trim().slice(0, MAX_LEN);
}

function post(token, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org', port: 443, method: 'POST', path: `/bot${token}/sendMessage`, timeout: TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (buf.length < 20000) buf += c; });
      res.on('end', () => {
        let j = null; try { j = JSON.parse(buf); } catch (_) { /* not json */ }
        if (res.statusCode === 200 && j?.ok) resolve(true);
        else reject(new Error(`Telegram said: ${String(j?.description || `HTTP ${res.statusCode}`).slice(0, 160)}`));
      });
    });
    req.on('timeout', () => { req.destroy(new Error('Telegram did not answer in 5 seconds.')); });
    req.on('error', (e) => reject(new Error(store.redact(e.message || 'Network error'))));
    req.end(data);
  });
}

async function sendNow(text, silent) {
  const token = store.secret('telegramToken');
  const chat = String(cfg().chatId || '').trim();
  if (!token) throw new Error('Save the bot token first.');
  if (!validChat(chat)) throw new Error('The chat id looks wrong. Use the number from @userinfobot (or @channelname).');
  lastSentAt = Date.now();
  await post(token, { chat_id: chat, text: clean(text), disable_notification: !!silent, disable_web_page_preview: true });
}

function flush() {
  timer = null;
  if (!pending.length) return;
  const wait = MIN_GAP_MS - (Date.now() - lastSentAt);
  if (wait > 0) { timer = setTimeout(flush, wait + 50); return; }
  const batch = pending; pending = [];
  const text = batch.map((b) => b.text).join('\n\n');
  const silent = batch.every((b) => b.silent);
  sendNow(text, silent).catch(() => { /* alerts must never break a job */ });
}

// queue a message (kind only for the log); returns false when it was dropped (off, duplicate)
function send(text, { silent = false } = {}) {
  if (!configured()) return false;
  const t = clean(text);
  if (!t) return false;
  const now = Date.now();
  for (const [k, ts] of recent) if (now - ts > DEDUPE_MS) recent.delete(k);
  if (recent.has(t) || pending.some((p) => p.text === t)) return false;
  recent.set(t, now);
  pending.push({ text: t, silent });
  if (!timer) timer = setTimeout(flush, Math.max(0, MIN_GAP_MS - (now - lastSentAt)) + 50);
  return true;
}

// the "Send test message" button: works even when alerts are off, still obeys the 30 s limit
async function test() {
  const wait = MIN_GAP_MS - (Date.now() - lastSentAt);
  if (wait > 0) throw new Error(`Wait ${Math.ceil(wait / 1000)} seconds before the next message.`);
  await sendNow('Posting Assistant: test message. Phone alerts work.', false);
  return true;
}

module.exports = { send, test, configured, clean, validChat };
