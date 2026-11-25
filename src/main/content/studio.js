// Writer studio: many chats for scripts, LinkedIn posts, newsletters and captions. Chats and saved posts are plain
// files in a folder the user picks. Each message can use /skills, /formats, /styles, a competitor study, attached
// files, the Info knowledge and (when asked) a web search. Every reply is cleaned of AI typography (no em dashes).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const store = require('../store');
const paths = require('../paths');
const providers = require('../llm/providers');
const humanize = require('../caption/humanize');
const skills = require('../caption/skills');
const kb = require('../knowledge/kb');
const slash = require('./slash');
const formats = require('./formats');
const styles = require('../caption/styles');
const study = require('./study');
const analyzer = require('../media/analyze');
const web = require('../web/search');
const { stripThink, parseJson } = require('../agent/json');

const ev = new EventEmitter();
const rid = () => crypto.randomBytes(4).toString('hex');
function chatDir() { const d = store.get().writerDir || paths.sub('writer'); fs.mkdirSync(d, { recursive: true }); return d; }
function draftDir() { const d = store.get().draftsDir || paths.sub('drafts'); fs.mkdirSync(d, { recursive: true }); return d; }
const cfile = (id) => path.join(chatDir(), `${String(id).replace(/[^\w-]/g, '')}.chat.json`);

const MODES = {
  script: 'a short-form video script (Reels, Shorts, TikTok). Give: title, hook (first 2 seconds, spoken + on-screen text), the script as numbered lines with [ON SCREEN] text and [B-ROLL] ideas, and an ending CTA. Mark estimated seconds.',
  longscript: 'a long YouTube video script with intro hook, chapters with timestamps, talking points and B-roll notes, and an outro.',
  linkedin: 'a LinkedIn post: strong first 2 lines before "see more", short paragraphs, first person, concrete, ends with a real question. 3 hashtags at the end.',
  newsletter: 'a newsletter issue: subject line options, preview text, then the body with short headings, one big idea and clear takeaways, and a sign-off.',
  caption: 'social media captions for the platform the user names (or Instagram), with hashtags on the last line.',
  facebook: 'a Facebook post: conversational, hook in line 1, short paragraphs, one question or CTA.',
  thread: 'an X/Threads thread: numbered posts, each under 270 characters, first post is the hook.',
  free: 'whatever the user asks for.'
};

function system(c) {
  return `You are a senior content writer and strategist for a Bangladeshi creator who also posts in English. You are writing ${MODES[c.mode] || MODES.free}
Voice rules (always):
- Sound human: direct, specific, plain words, varied sentence length, contractions where natural.
- Never use em dashes or en dashes, never decorative emoji lists, no "In today's world", "delve", "unlock", "elevate", "game-changer".
- Do not agree with everything. If the user's idea is weak, say so in one line and offer a better angle.
- Keep chat answers short; long only when the deliverable needs it. No filler before or after the deliverable.
- Use only facts from the user, the knowledge, the attached material or the web data. Never invent statistics, prices, quotes or links.
- Language: ${c.language && c.language !== 'auto' ? { bn: 'Bangla in Bengali script', en: 'English', banglish: 'Banglish (Bangla in Roman letters)', 'bn+en': 'Bangla, then a short English version' }[c.language] || c.language : 'the language the user writes in or asks for; Bangla content in Bengali script'}.`;
}

function list() {
  return fs.readdirSync(chatDir()).filter((f) => f.endsWith('.chat.json')).map((f) => store.readJson(path.join(chatDir(), f), null)).filter(Boolean)
    .map(({ id, title, mode, updatedAt, messages }) => ({ id, title, mode, updatedAt, count: messages.length })).sort((a, b) => b.updatedAt - a.updatedAt);
}
function load(id) { return store.readJson(cfile(id), null); }
function save(c) { c.updatedAt = Date.now(); store.atomicWrite(cfile(c.id), JSON.stringify(c, null, 1)); return c; }
function create(opts = {}) {
  return save({ id: `${Date.now().toString(36)}-${rid()}`, title: opts.title || 'New writing', mode: MODES[opts.mode] ? opts.mode : 'script', language: opts.language || 'auto', formatId: opts.formatId || '', styleId: opts.styleId || '', studyId: opts.studyId || '', research: false, attachments: [], messages: [], createdAt: Date.now() });
}
// a new chat that already holds some material (e.g. a video kit) to keep working on it
function createWith(opts, attachment) {
  const c = create(opts);
  if (attachment) { c.attachments.push({ file: attachment.file || '', name: String(attachment.name || 'Material').slice(0, 80), brief: String(attachment.brief || '').slice(0, 12000), at: Date.now() }); save(c); }
  return c;
}
function update(id, patch) {
  const c = load(id);
  if (!c) throw new Error('Chat not found');
  for (const k of ['title', 'mode', 'language', 'formatId', 'styleId', 'studyId', 'research']) if (patch[k] !== undefined) c[k] = patch[k];
  return save(c);
}
function remove(id) { try { fs.unlinkSync(cfile(id)); } catch (_) { /* gone */ } }

// attach a file: videos/images are analyzed (scan level chosen by the user), text files are read
async function attach(id, file, { mode = 'smart', signal } = {}) {
  const c = load(id);
  if (!c) throw new Error('Chat not found');
  if (!fs.existsSync(file)) throw new Error('File not found');
  let brief = '';
  if (/\.(mp4|mov|m4v|mkv|webm|avi|jpe?g|png|webp)$/i.test(file)) brief = (await analyzer.analyze(file, { mode, signal })).brief;
  else if (/\.(txt|md|csv|json|srt|vtt|html?)$/i.test(file) && fs.statSync(file).size < 3e6) brief = fs.readFileSync(file, 'utf8').slice(0, 12000);
  else throw new Error('Attach videos, images or text files (txt, md, csv, srt).');
  c.attachments.push({ file, name: path.basename(file), brief: brief.slice(0, 12000), at: Date.now() });
  save(c);
  return c;
}
function detach(id, name) { const c = load(id); c.attachments = c.attachments.filter((a) => a.name !== name); return save(c); }

let running = null;
async function send(id, text) {
  if (running) throw new Error('The writer is still working. Wait or press Stop.');
  const c = load(id);
  if (!c) throw new Error('Chat not found');
  running = { id, abort: new AbortController() };
  const signal = running.abort.signal;
  try {
    const p = slash.parse(text);
    if (!c.messages.length) c.title = (p.text || text).slice(0, 60);
    c.messages.push({ role: 'user', text: String(text), at: Date.now() });
    save(c);
    ev.emit('update', c);
    const ctx = [];
    const fmt = formats.get(c.formatId);
    if (fmt && !p.formats.length) ctx.push(formats.describe(fmt));
    const st = styles.get(c.styleId);
    if (st && !p.styles.length) ctx.push(styles.describe(st));
    if (p.any) ctx.push(slash.context(p));
    const sk = skills.promptText('caption', Math.min(5000, store.get().skillBudgetChars));
    if (sk) ctx.push(`WRITING SKILLS (always on):\n${sk}`);
    if (c.studyId) { const s = study.get(c.studyId); if (s) ctx.push(`COMPETITOR STUDY (learn the patterns, never copy their words):\n${s.report.slice(0, 6000)}`); }
    for (const a of c.attachments.slice(-4)) ctx.push(`ATTACHED: ${a.name}\n${a.brief.slice(0, 5000)}`);
    const know = kb.search(`${p.text} ${c.title}`, { budget: 2500 });
    if (know) ctx.push(`KNOWLEDGE (the user's own info):\n${know}`);
    if (c.research || /(^|\s)\/(research|web)\b/i.test(text)) {
      ev.emit('status', { id, status: 'Searching the web...' });
      const q = await searchQuery(c, p.text, signal);
      const r = await web.search(q, 6).catch(() => null);
      if (r) ctx.push(web.asData(`search: ${q}`, `${r.overview ? `AI overview: ${r.overview}\n\n` : ''}${r.results.map((x) => `- ${x.title} (${x.url}): ${x.snippet}`).join('\n')}`));
    }
    ev.emit('status', { id, status: 'Writing...' });
    const history = c.messages.slice(-12).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', text: m.text.slice(0, 6000) }));
    const last = history[history.length - 1];
    last.text = `${ctx.length ? `${ctx.join('\n\n')}\n\n---\n` : ''}MY REQUEST: ${p.text || text}`;
    const r = await providers.chat('writer', { system: system(c), messages: history, json: false, maxTokens: 3000, signal, temperature: 0.7 });
    const out = humanize.clean(stripThink(r.text));
    c.messages.push({ role: 'assistant', text: out, at: Date.now(), used: [...p.skills.map((s) => s.name), ...p.formats.map((f) => f.name), ...p.styles.map((s) => s.name)] });
    save(c);
    ev.emit('update', c);
    return c;
  } finally { running = null; ev.emit('status', { id, status: '' }); }
}
async function searchQuery(c, text, signal) {
  try {
    const r = await providers.chat('main', { system: 'Write one short web search query (max 10 words) for the request. Reply with the query only.', messages: [{ role: 'user', text: String(text).slice(0, 1500) }], json: false, maxTokens: 40, signal, temperature: 0 });
    return stripThink(r.text).replace(/["\n]/g, ' ').trim().slice(0, 120) || String(text).slice(0, 100);
  } catch (_) { return String(text).slice(0, 100); }
}
function stop() { running?.abort.abort(new Error('ABORTED')); }

/* ---------------- saved posts (drafts) ---------------- */
function safeName(n) { return String(n).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim().slice(0, 80) || 'post'; }
function drafts() {
  return fs.readdirSync(draftDir()).filter((f) => /\.(md|txt)$/i.test(f)).map((f) => {
    const p = path.join(draftDir(), f);
    const st = fs.statSync(p);
    const head = fs.readFileSync(p, 'utf8').slice(0, 400);
    const tags = /^tags:\s*(.*)$/m.exec(head);
    return { name: f, path: p, updatedAt: st.mtimeMs, size: st.size, tags: tags ? tags[1] : '', preview: head.replace(/^---[\s\S]*?---\s*/, '').slice(0, 160) };
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}
function saveDraft({ title, text, kind = 'post', tags = '' }) {
  let name = `${safeName(title || text.split('\n')[0])}.md`;
  if (fs.existsSync(path.join(draftDir(), name))) name = name.replace(/\.md$/, `-${rid()}.md`);
  fs.writeFileSync(path.join(draftDir(), name), `---\ntitle: ${String(title || '').replace(/\n/g, ' ')}\nkind: ${kind}\ntags: ${tags}\nsaved: ${new Date().toISOString()}\n---\n\n${text}\n`);
  return name;
}
function draftPath(name) {
  const p = path.resolve(draftDir(), path.basename(String(name)));
  if (!p.startsWith(path.resolve(draftDir()))) throw new Error('Bad name');
  return p;
}
function readDraft(name) { return fs.readFileSync(draftPath(name), 'utf8'); }
function writeDraft(name, text) { fs.writeFileSync(draftPath(name), String(text)); return name; }
function removeDraft(name) { try { fs.unlinkSync(draftPath(name)); } catch (_) { /* gone */ } }

/* ---------------- video kit: everything from one video ---------------- */
async function videoKit(file, { language = 'auto', mode = 'full', signal, onStep } = {}) {
  onStep?.('Reading the video');
  const a = await analyzer.analyze(file, { mode, signal, onStep });
  onStep?.('Writing titles, descriptions and posts');
  const lang = language !== 'auto' ? language : a.language === 'en' ? 'en' : 'bn';
  const r = await providers.chat('writer', {
    system: `You are a YouTube and social media SEO writer. Human, specific, no em dashes, no hype words. Use only facts from the video. Write in ${lang === 'en' ? 'English' : lang === 'banglish' ? 'Banglish' : 'Bangla (Bengali script), keep common English words people use'}. Reply with JSON only.`,
    messages: [{ role: 'user', text: `${a.brief}\n\n${skills.promptText('caption', 3500)}\n\nReturn {"titles": ["5 YouTube titles under 70 characters"], "thumbnail_texts": ["5 thumbnail texts of 2-5 words"], "keywords": ["15 search phrases"], "youtube_description": "with a 2 line hook, summary, chapters only if speech timing allows, 3 hashtags", "linkedin_post": "...", "facebook_status": "...", "instagram_caption": "... with up to 5 hashtags at the end", "x_post": "under 270 characters", "hashtags": ["8"]}` }],
    json: true, maxTokens: 3000, signal, temperature: 0.6
  });
  const j = parseJson(r.text);
  const clean = (v) => (Array.isArray(v) ? v.map((x) => humanize.clean(String(x))) : humanize.clean(String(v || '')));
  const kit = { file, name: path.basename(file), language: lang, transcript: a.audio?.text || '', segments: a.audio?.segments || [], hasSpeech: a.hasSpeech };
  for (const k of ['titles', 'thumbnail_texts', 'keywords', 'youtube_description', 'linkedin_post', 'facebook_status', 'instagram_caption', 'x_post', 'hashtags']) kit[k] = clean(j[k] ?? '');
  const md = `# ${kit.name}\n\n## Titles\n${kit.titles.map((t) => `- ${t}`).join('\n')}\n\n## Thumbnail text\n${kit.thumbnail_texts.map((t) => `- ${t}`).join('\n')}\n\n## Keywords\n${kit.keywords.join(', ')}\n\n## YouTube description\n${kit.youtube_description}\n\n## LinkedIn\n${kit.linkedin_post}\n\n## Facebook\n${kit.facebook_status}\n\n## Instagram\n${kit.instagram_caption}\n\n## X\n${kit.x_post}\n\n## Transcript\n${kit.transcript || '(no speech)'}\n`;
  kit.saved = saveDraft({ title: `Video kit - ${kit.name}`, text: md, kind: 'video-kit' });
  return kit;
}

module.exports = { createWith, on: (e, f) => ev.on(e, f), MODES, list, load, create, update, remove, attach, detach, send, stop, drafts, saveDraft, readDraft, writeDraft, removeDraft, videoKit, isBusy: () => !!running };
