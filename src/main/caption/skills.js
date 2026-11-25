// Writing skills: Markdown guides that are added to the caption writer (and the chat agent). Built-in skills, skills
// bundled from GitHub (MIT), the user's own, and new ones imported from a GitHub link after a safety review.
// Skills are text only. Scripts inside skill repos are never downloaded or run.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('../store');
const paths = require('../paths');
const providers = require('../llm/providers');
const { stripThink } = require('../agent/json');

const ASSET_DIR = path.join(__dirname, '..', '..', '..', 'assets', 'skills');

const BUILTIN = [
  {
    id: 'bangla-natural', name: 'Natural Bangla captions', appliesTo: ['caption'],
    description: 'Write Bangla that sounds like a real Bangladeshi creator, not a translation.',
    body: `# Natural Bangla captions

- Write in Bengali script (বাংলা) unless the user or style asks for Banglish.
- Use cholito (spoken) Bangla: "করছি", "দেখো", "চলো" instead of formal sadhu forms like "করিতেছি".
- Common English words that Bangladeshi people actually use stay in English or as they are said: video, reel, update, offer, order, link, comment.
- Never translate English idioms word by word. If an idea sounds odd in Bangla, say it the way a person would say it in Dhaka.
- Short lines. One idea per line. Leave a blank line between paragraphs.
- Respectful address: use "আপনি" for business, brand and informative posts; "তুমি" only for youth, fun or personal styles.
- Numbers, prices and dates exactly as given in the notes; use Bangla or English digits consistently in one caption.
- Hashtags: mix 1-2 Bangla hashtags (#বাংলা_টিপস) with English ones people search (#banglatips). No spaces inside a hashtag.
- Banglish (Roman letters) when asked: write how people chat on Messenger ("ki obostha", "dekho", "osthir"), not phonetic textbook spelling.
- For English videos keep the caption in English unless the user asked for Bangla.
- For videos with no speech, describe what is seen and the feeling, do not invent dialogue.`
  },
  {
    id: 'platform-seo', name: 'Platform SEO (YouTube, Instagram, TikTok, Facebook, LinkedIn)', appliesTo: ['caption'],
    description: 'Titles, descriptions, keywords and search terms that each platform reads.',
    body: `# Platform SEO

YouTube
- Title: max 100 characters, main keyword in the first 40-50 characters, specific promise, no ALL CAPS words except one.
- Description: first 2 lines (about 150 characters) carry the keyword and the reason to watch. Then 2-4 short paragraphs, then hashtags (3 max). Shorts: keep it short.
- Tags: 8-15 keyword phrases people type, total under 500 characters, mix Bangla and English search terms for Bangla videos.

Instagram
- Search reads caption text: put the 2-3 search phrases in normal sentences.
- First 125 characters show before "more". That line is the hook (or the ask for Reels with a strong video hook).
- Up to 5 specific hashtags. No #viral #fyp #explorepage.

TikTok
- Caption is a search box: put the keyword phrase people would search in the first line. 3-5 hashtags, at least 2 niche ones.

Facebook
- Conversational, the first line is the hook, 0-3 hashtags, questions that invite comments work well.

LinkedIn
- First 2 lines before "see more" must earn the click. First person, concrete lesson or result, 3 hashtags at the end, no emoji walls.

All platforms
- Never put a clickable link in Instagram or TikTok captions (write "link in bio"). YouTube, Facebook and LinkedIn may have links if the user gave one.
- Never invent facts, prices, dates, names or links that are not in the notes or the video.`
  },
  {
    id: 'caption-craft', name: 'Caption craft: hooks, types and psychology', appliesTo: ['caption', 'chat'],
    description: 'How strong captions are built: hook types, caption types, length and the psychology that makes people stop, read and act.',
    body: `# Caption craft

Hook types for line 1 (pick one that fits the video):
- Curiosity gap: "Nobody noticed this in episode 12..."
- Bold claim or result: "This edit took 4 hours. Here is the 10 second version."
- Relatable moment: "When the opening hits and you replay it 5 times"
- Question that matters to the viewer: "Would you survive this fight?"
- Number or list: "3 scenes that changed the whole series"
- Pattern break: a short, unexpected statement.

Caption types: storytelling, educational, hook plus question, emotional, humorous, promotional, minimal, fan hype. Match the type to the video: an action or anime edit wants hype or curiosity, a tutorial wants educational, a personal clip wants storytelling.

Psychology: curiosity (open loop), relatability (shared experience), identity ("real fans know"), social proof (only real numbers), reward (what they gain), mild controversy (an opinion people want to answer). Use one or two, never all.

Length: short (1-3 lines) for fast edits and memes, medium (3-6 lines) by default, long only for stories and lessons.

Never: invent dialogue, people or events that are not in the video; describe the editing software unless the post is about editing; write generic lines like "This video shows..." or "Watch till the end".`
  },
  {
    id: 'short-video-scripts', name: 'Short video scripts', appliesTo: ['chat'],
    description: 'Scripts for Reels, Shorts and TikTok that keep people watching.',
    body: `# Short video scripts
- First 2 seconds: the hook, spoken and on screen at the same time, different words.
- One idea per video. Cut every sentence that does not move it forward.
- Pattern break every 3-5 seconds (new shot, zoom, text, sound).
- Payoff before the end, then one ask.
- Write: [0-2s] HOOK, [ON SCREEN] text, [B-ROLL] ideas, spoken lines, estimated seconds.`
  },
  {
    id: 'cta-and-structure', name: 'Hook, body, one ask', appliesTo: ['caption'],
    description: 'The shape of a caption that gets read and acted on.',
    body: `# Hook, body, one ask

- Line 1 is the hook: concrete, short, a cliff not a greeting. Never start with a hashtag, emoji or "Hello everyone".
- If the video already hooks in the first 2 seconds, line 1 can be the context or the ask instead of a second hook.
- Body: short paragraphs with white space. Use one real detail from the video (what is seen or said).
- One ask only: comment a word, save, share or DM. Two asks equal none.
- Comment-keyword asks use one word people can type, no spaces: "Comment RECIPE".
- End with hashtags on their own line.`
  }
];

// summaries of the bundled GitHub skills (full text stays available in the Skills page)
const GITHUB = [
  {
    id: 'humanizer', file: 'humanizer.SKILL.md', license: 'humanizer.LICENSE.txt', url: 'https://github.com/blader/humanizer', name: 'Humanizer (remove AI writing patterns)', appliesTo: ['caption', 'chat'],
    description: 'Removes signs of AI-generated writing. MIT, by Siqi Chen (blader/humanizer).',
    summary: `Write like a person, not a model:
- No "not X but Y" or "it's not just X, it's Y" staging. Say the one thing.
- No dramatic one-line closers, no fake-deep sayings, no run-up before the point, no arguing with nobody.
- No forced lists of three, no repeated sentence openings, no stacked qualifiers, no hyphenated pair after pair.
- Do not use dashes as the universal connector (no em dashes). Use commas, periods or "and".
- Cut AI words: delve, leverage, robust, seamless, crucial, pivotal, testament, landscape, tapestry, elevate, unlock, game-changer, in today's fast-paced world.
- No inflated significance, no vague "plays a key role", no shallow -ing tails ("..., highlighting its importance").
- No sales language or borrowed authority unless real. Prefer "is/are/has" over fancy verbs.
- No decorative bold or headings, straight quotes only, no chatbot residue ("Here is your caption", "I hope this helps").
- Vary sentence length. Use concrete nouns, numbers and names.`
  },
  {
    id: 'ig-human', file: 'ig-human.SKILL.md', license: 'instagram-agent-skill.LICENSE.txt', url: 'https://github.com/Jakeschincariol/instagram-agent-skill', name: 'IG Human (de-slop captions)', appliesTo: ['caption'],
    description: 'Strip machine fingerprints from captions and scripts. MIT, by Jake Schincariol.',
    summary: `Captions are short, so slop is loud:
- No em dashes, no invisible characters, no curly quotes (the app also cleans these automatically).
- Cut Instagram slop: "stop scrolling", "in today's video", "follow for more", "tag someone who needs this", "the algorithm loves", "run don't walk", "double tap if".
- No rhetorical one-word question lines ("The result?"), no emoji bullet lists, no 3+ shouted words in a row, no hashtag walls.
- Use contractions and a real voice, specific numbers and names, varied sentence length.`
  },
  {
    id: 'ig-caption', file: 'ig-caption.SKILL.md', license: 'instagram-agent-skill.LICENSE.txt', url: 'https://github.com/Jakeschincariol/instagram-agent-skill', name: 'IG Caption (hook, ask, search terms)', appliesTo: ['caption'],
    description: 'Caption shape, one ask, search terms and up to five hashtags. MIT, by Jake Schincariol.',
    summary: `Instagram caption rules:
- Decide the job: A) the Reel already hooks, so the caption gives context, the ask and search words; B) the caption is the content (photo/carousel), so line 1 is the hook.
- First 125 characters are visible: never a greeting, hashtag or emoji first.
- Body 2-6 short paragraphs with white space; the search phrases live here as normal words.
- Exactly one ask (comment a one-word keyword, save, or DM).
- Up to 5 specific hashtags on the last line, or none. No #viral #fyp #explorepage #foryou.
- No links in the caption; say "link in bio" or put it in the first comment.
- Emoji as punctuation, not decoration (max about 4 per 100 characters).
- 2,200 characters is the limit; 300-700 is usually better.`
  },
  {
    id: 'ig-reel', file: 'ig-reel.SKILL.md', license: 'instagram-agent-skill.LICENSE.txt', url: 'https://github.com/Jakeschincariol/instagram-agent-skill', name: 'IG Reel hooks', appliesTo: ['caption'],
    description: 'Hook formulas for short videos. MIT, by Jake Schincariol.',
    summary: `Short video hooks:
- A Reel has two hooks: the first spoken line (about 2 seconds) and the first on-screen text (about 1 second). The caption should not repeat them word for word.
- Strong hook types: a specific number or result, a mistake to avoid, a before/after, a bold opinion, an open question the video answers, a "how I..." story.
- The hook must be paid off by the video. No clickbait the video does not deliver.`
  }
];

BUILTIN.push(...require('./skillpack'));
const indexCol = store.collection('skills', null);
const bodyFile = (id) => path.join(paths.sub('skills'), `${id.replace(/[^a-z0-9_-]/gi, '_')}.md`);

function seed() {
  let idx = indexCol.all();
  if (idx) {
    // add skills that newer versions of the app ship
    let changed = false;
    for (const b of [...BUILTIN, ...GITHUB]) if (!idx.find((s) => s.id === b.id)) { idx.push(entryFor(b)); changed = true; }
    if (changed) indexCol.save(idx);
    return idx;
  }
  idx = [...BUILTIN, ...GITHUB].map(entryFor);
  indexCol.save(idx);
  return idx;
}
function entryFor(b) {
  let body = b.body || '';
  if (b.file) { try { body = fs.readFileSync(path.join(ASSET_DIR, 'github', b.file), 'utf8'); } catch (_) { body = b.summary || ''; } }
  fs.writeFileSync(bodyFile(b.id), body);
  return { id: b.id, name: b.name, description: b.description, summary: b.summary || '', source: b.file ? 'github' : 'builtin', url: b.url || '', license: b.license ? 'MIT' : '', appliesTo: b.appliesTo || ['caption'], enabled: true, addedAt: Date.now() };
}
function list() { return seed(); }
function body(id) { try { return fs.readFileSync(bodyFile(id), 'utf8'); } catch (_) { return ''; } }
function full(id) { const s = list().find((x) => x.id === id); return s ? { ...s, body: body(id) } : null; }
function save(s) {
  const idx = list();
  const id = s.id || `skill-${crypto.randomBytes(3).toString('hex')}`;
  const cur = idx.find((x) => x.id === id);
  const next = {
    ...(cur || { source: 'custom', addedAt: Date.now(), enabled: true }), id,
    name: String(s.name || cur?.name || 'My skill').slice(0, 100), description: String(s.description ?? cur?.description ?? '').slice(0, 300),
    summary: String(s.summary ?? cur?.summary ?? '').slice(0, 3000),
    appliesTo: Array.isArray(s.appliesTo) && s.appliesTo.length ? s.appliesTo.filter((x) => ['caption', 'chat'].includes(x)) : cur?.appliesTo || ['caption'],
    enabled: s.enabled ?? cur?.enabled ?? true, url: s.url ?? cur?.url ?? '', license: s.license ?? cur?.license ?? '', updatedAt: Date.now()
  };
  if (s.source && !cur) next.source = s.source;
  if (s.body != null) fs.writeFileSync(bodyFile(id), sanitize(String(s.body)));
  if (cur) Object.assign(cur, next); else idx.push(next);
  indexCol.save(idx);
  return next;
}
function setEnabled(id, enabled) { return save({ id, enabled: !!enabled }); }
function remove(id) {
  indexCol.save(list().filter((s) => s.id !== id));
  try { fs.unlinkSync(bodyFile(id)); } catch (_) { /* gone */ }
}

// text that goes into prompts, within a character budget (summaries first, they are compact)
// skills that belong to one network are only used when that network is a target (or is named in the chat message)
const NETWORK_SKILL = { 'linkedin-posts': 'linkedin', 'tiktok-captions': 'tiktok', 'instagram-captions': 'instagram', 'facebook-posts': 'facebook', 'x-threads': 'x', 'youtube-seo': 'youtube', 'shorts-reels-script': null };
const ALWAYS = new Set(['ask-first']);
function promptText(kind = 'caption', budget = store.get().skillBudgetChars, { exclude = [], platforms, query } = {}) {
  const out = [];
  let used = 0;
  const q = String(query || '').toLowerCase();
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const score = (s) => (ALWAYS.has(s.id) ? 100 : 0) + words.filter((w) => `${s.id} ${s.name} ${s.description}`.toLowerCase().includes(w)).length;
  const ok = (x) => {
    if (!x.enabled || !x.appliesTo.includes(kind) || exclude.includes(x.id)) return false;
    const net = NETWORK_SKILL[x.id];
    if (!net) return true;
    if (platforms) return platforms.some((p) => String(p).toLowerCase().startsWith(net));
    if (q) return q.includes(net) || (net === 'x' && /\btwitter\b/.test(q));
    return true;
  };
  const pool = list().filter(ok);
  if (q) pool.sort((a, b) => score(b) - score(a));
  for (const s of pool) {
    const t = (s.summary || body(s.id)).trim();
    if (!t) continue;
    const chunk = `## ${s.name}\n${t}`;
    const sep = out.length ? 2 : 0; // the blank line between skills counts too
    if (used + sep + chunk.length > budget) { const room = budget - used - sep - 4; if (room > 400) out.push(chunk.slice(0, room) + '\n...'); break; }
    out.push(chunk);
    used += sep + chunk.length;
  }
  return out.join('\n\n');
}

/* ---------------- import from GitHub ---------------- */
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u00ad]|[\u{E0000}-\u{E007F}]/gu;
function sanitize(t) { return String(t).replace(INVISIBLE, '').replace(/\r\n/g, '\n'); }

// flags anything in a skill that tries to do more than give writing advice
function review(text) {
  const flags = [];
  const t = String(text);
  const add = (level, what, re) => { const m = t.match(re); if (m) flags.push({ level, what, sample: m[0].slice(0, 120) }); };
  if (INVISIBLE.test(t)) flags.push({ level: 'high', what: 'Hidden invisible characters (removed on import)', sample: '' });
  INVISIBLE.lastIndex = 0;
  add('high', 'Tries to override instructions', /ignore (all |any )?(previous|prior|above|earlier) (instructions|rules|prompts)|disregard (the )?(system|previous)|you are no longer|new system prompt/i);
  add('high', 'Mentions keys, passwords or tokens', /\b(api[_ -]?key|password|passwd|secret key|access token|private key|seed phrase|credential)s?\b/i);
  add('high', 'Asks to send or upload data somewhere', /\b(send|post|upload|exfiltrate|forward|transmit)\b[^.\n]{0,60}\b(to|at)\s+(https?:\/\/|[a-z0-9.-]+\.(com|net|io|xyz|ru))/i);
  add('medium', 'Contains shell commands or scripts', /```(bash|sh|powershell|ps1|cmd|python|js|javascript)|\b(curl|wget|Invoke-WebRequest|iwr|rm -rf|del \/|powershell -)\b/i);
  add('medium', 'Contains HTML or script tags', /<\s*(script|iframe|img|object|embed)\b/i);
  add('medium', 'Long encoded blob', /[A-Za-z0-9+/]{220,}={0,2}/);
  add('low', 'Contains links', /https?:\/\/[^\s)]+/i);
  return flags;
}

function ghHeaders() {
  const h = { 'user-agent': 'PostingAssistant', accept: 'application/vnd.github+json' };
  const tok = store.secret('githubToken');
  if (tok) h.authorization = `Bearer ${tok}`;
  return h;
}
function parseGithub(url) {
  const u = new URL(String(url).trim());
  if (u.hostname === 'raw.githubusercontent.com') {
    const [owner, repo, branch, ...rest] = u.pathname.split('/').filter(Boolean);
    return { owner, repo, branch, path: rest.join('/'), kind: 'file' };
  }
  if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') throw new Error('Only github.com links are supported.');
  const [owner, repo, kind, branch, ...rest] = u.pathname.split('/').filter(Boolean);
  if (!owner || !repo) throw new Error('That is not a GitHub repository link.');
  return { owner, repo: repo.replace(/\.git$/, ''), branch: branch || null, path: rest.join('/'), kind: kind === 'blob' ? 'file' : 'tree' };
}
async function ghJson(url) {
  const r = await fetch(url, { headers: ghHeaders() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${j.message || ''}${r.status === 403 ? ' (rate limit: add a GitHub token in Settings, or wait an hour)' : ''}`);
  return j;
}
async function rawText(owner, repo, branch, p) {
  const r = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${p.split('/').map(encodeURIComponent).join('/')}`, { headers: { 'user-agent': 'PostingAssistant' } });
  if (!r.ok) throw new Error(`Could not download ${p} (${r.status})`);
  const t = await r.text();
  if (t.length > 300000) throw new Error('That file is too large to be a skill.');
  return t;
}
// returns the list of skill files found behind a link
async function discover(url) {
  const g = parseGithub(url);
  let branch = g.branch;
  let license = '';
  if (!branch || g.kind === 'tree') {
    const repo = await ghJson(`https://api.github.com/repos/${g.owner}/${g.repo}`);
    branch = branch || repo.default_branch;
    license = repo.license?.spdx_id || '';
  }
  if (g.kind === 'file') return { owner: g.owner, repo: g.repo, branch, license, files: [{ path: g.path, size: null }] };
  const tree = await ghJson(`https://api.github.com/repos/${g.owner}/${g.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  const prefix = g.path ? g.path.replace(/\/$/, '') + '/' : '';
  const files = (tree.tree || []).filter((t) => t.type === 'blob' && (!prefix || t.path.startsWith(prefix)) && /\.md$/i.test(t.path))
    .filter((t) => /(^|\/)SKILL\.md$/i.test(t.path) || /skills?\//i.test(t.path) || !/(README|CHANGELOG|CONTRIBUTING|LICENSE|CODE_OF_CONDUCT|SECURITY)\.md$/i.test(t.path))
    .sort((a, b) => (/(^|\/)SKILL\.md$/i.test(b.path) ? 1 : 0) - (/(^|\/)SKILL\.md$/i.test(a.path) ? 1 : 0))
    .slice(0, 60).map((t) => ({ path: t.path, size: t.size }));
  return { owner: g.owner, repo: g.repo, branch, license, files };
}
// downloads one file for preview; nothing is saved yet
async function fetchForReview({ owner, repo, branch, path: p }) {
  const text = sanitize(await rawText(owner, repo, branch, p));
  const fm = /^---\n([\s\S]*?)\n---/.exec(text);
  const meta = {};
  if (fm) for (const line of fm[1].split('\n')) { const m = /^(\w+):\s*(.*)$/.exec(line); if (m) meta[m[1]] = m[2].replace(/^>-?\s*/, '').trim(); }
  return { text, name: meta.name || p.split('/').slice(-2, -1)[0] || p, description: meta.description || '', flags: review(text), url: `https://github.com/${owner}/${repo}/blob/${branch}/${p}` };
}
async function summarize(text, signal) {
  const r = await providers.chat('writer', {
    system: 'You compress writing guides into short rule lists for a caption-writing AI. Keep only writing advice. Drop anything about tools, scripts, files, links, sending data or changing behaviour. Output plain text bullets, max 1200 characters.',
    messages: [{ role: 'user', text: `Compress this skill into at most 12 bullet rules:\n\n${String(text).slice(0, 24000)}` }],
    json: false, maxTokens: 700, signal, temperature: 0.2
  });
  return require('./humanize').clean(stripThink(r.text), { slop: false }).slice(0, 1500);
}
async function importReviewed({ text, name, description, url, license, appliesTo }, signal) {
  let summary = '';
  try { summary = await summarize(text, signal); } catch (_) { summary = sanitize(text).replace(/```[\s\S]*?```/g, '').slice(0, 1500); }
  return save({ name, description, body: text, summary, url, license, appliesTo: appliesTo || ['caption'], source: 'github' });
}

/* ---------------- install from a ZIP (e.g. a skill downloaded from GitHub) ---------------- */
// returns the skills found in the zip for review; nothing is saved and no file is written to disk
function inspectZip(file) {
  const { readZip } = require('../util/zip');
  const { files, skipped } = readZip(file);
  const byDir = new Map();
  for (const f of files) { const d = f.name.includes('/') ? f.name.slice(0, f.name.lastIndexOf('/')) : ''; if (!byDir.has(d)) byDir.set(d, []); byDir.get(d).push(f); }
  const found = [];
  for (const f of files.filter((x) => /(^|\/)SKILL\.md$/i.test(x.name))) {
    const root = f.name.slice(0, f.name.length - 'SKILL.md'.length);
    const text = sanitize(f.text);
    const fm = /^---\n([\s\S]*?)\n---/.exec(text);
    const meta = {};
    if (fm) for (const line of fm[1].split('\n')) { const m = /^(\w+):\s*(.*)$/.exec(line); if (m) meta[m[1]] = m[2].replace(/^>-?\s*/, '').trim(); }
    // reference documents of the skill (Markdown only) are kept with it
    const refs = files.filter((x) => x !== f && x.name.startsWith(root) && /\.(md|markdown|txt)$/i.test(x.name)).slice(0, 20);
    let body = text;
    for (const r of refs) body += `\n\n<!-- reference: ${r.name.slice(root.length)} -->\n${sanitize(r.text)}`;
    found.push({ name: meta.name || root.replace(/\/$/, '').split('/').pop() || 'Imported skill', description: meta.description || '', text: body.slice(0, 400000), refs: refs.map((r) => r.name.slice(root.length)), flags: review(body) });
  }
  // a zip with plain .md files and no SKILL.md: offer each Markdown file as a skill
  if (!found.length) for (const f of files.filter((x) => /\.(md|markdown)$/i.test(x.name) && !/readme|changelog|license/i.test(x.name)).slice(0, 10)) {
    const text = sanitize(f.text);
    found.push({ name: f.name.split('/').pop().replace(/\.(md|markdown)$/i, ''), description: '', text, refs: [], flags: review(text) });
  }
  return { skills: found, skipped: skipped.filter((n) => !/\/$/.test(n)).slice(0, 50) };
}

/* ---------------- /name commands ---------------- */
const slugOf = (n) => String(n).toLowerCase().replace(/[^a-z0-9ঀ-৿]+/g, '-').replace(/^-|-$/g, '');
function find(q) {
  const s = slugOf(String(q).replace(/^\//, ''));
  const all = list();
  return all.find((x) => x.id === s || slugOf(x.id) === s) || all.find((x) => slugOf(x.name) === s) || all.find((x) => slugOf(x.name).startsWith(s)) || null;
}
// full text of one skill for a prompt (summary + as much of the body as the budget allows)
function fullPrompt(id, budget = 9000) {
  const s = list().find((x) => x.id === id);
  if (!s) return '';
  const b = body(id).replace(/^---[\s\S]*?---\n/, '').replace(/```[\s\S]*?```/g, (m) => (m.length > 1500 ? '[code example omitted]' : m));
  return `## Skill: ${s.name}\n${s.summary ? `${s.summary}\n\n` : ''}${b.slice(0, budget)}`;
}

module.exports = { list, body, full, save, setEnabled, remove, promptText, discover, fetchForReview, importReviewed, review, sanitize, summarize, inspectZip, find, fullPrompt, slugOf };
