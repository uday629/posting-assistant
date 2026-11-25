// Formats: reusable structures for scripts and posts (viral clip beats, LinkedIn post shapes, newsletters).
// Made by hand, learned from a viral clip (study.js) or from a competitor study. Used with /name in chats.
const crypto = require('crypto');
const store = require('../store');

const PRESETS = [
  { id: 'hook-story-lesson', name: 'Hook, story, lesson', kind: 'post', summary: 'LinkedIn and Facebook storytelling post.',
    beats: [{ name: 'Hook', purpose: 'One line result or tension that earns "see more"' }, { name: 'Story', purpose: '3-6 short lines: what happened, with one concrete detail' }, { name: 'Turn', purpose: 'The moment it changed or what was learned' }, { name: 'Lesson', purpose: '2-3 takeaways the reader can use' }, { name: 'Question', purpose: 'One real question to start comments' }],
    rules: ['First person', 'Short lines with white space', 'No hashtags inside the text'] },
  { id: 'short-video-pas', name: 'Short video: problem, agitate, solve', kind: 'script', summary: '30-60 s Reel/Short/TikTok script.',
    beats: [{ name: 'Hook', seconds: '0-3', purpose: 'Name the problem or a surprising claim, on screen and spoken' }, { name: 'Agitate', seconds: '3-10', purpose: 'Why it hurts, one relatable example' }, { name: 'Solve', seconds: '10-40', purpose: '2-3 clear steps, one idea per line' }, { name: 'Proof', seconds: '40-50', purpose: 'Result, number or quick demo' }, { name: 'CTA', seconds: '50-60', purpose: 'One ask: comment a word, follow for part 2, save' }],
    rules: ['Write spoken lines plus [ON SCREEN] text plus [B-ROLL] ideas', 'Pattern break every 3-5 seconds'] },
  { id: 'listicle-reel', name: 'List reel (3-5 tips)', kind: 'script', summary: 'Fast list format for tips.',
    beats: [{ name: 'Hook', seconds: '0-2', purpose: '"3 X that Y" with a specific promise' }, { name: 'Items', seconds: '2-45', purpose: 'Each tip: name it, one line why, one visual' }, { name: 'Best last', purpose: 'Strongest tip at the end to keep watch time' }, { name: 'CTA', purpose: 'Save or comment' }], rules: ['Number every item on screen'] },
  { id: 'before-after', name: 'Before / after transformation', kind: 'script', summary: 'Show the result first, then how.',
    beats: [{ name: 'After first', seconds: '0-2', purpose: 'Show the final result' }, { name: 'Before', purpose: 'Where it started' }, { name: 'Process', purpose: '3-4 quick steps' }, { name: 'Reveal again', purpose: 'Result with one number' }, { name: 'CTA', purpose: 'One ask' }], rules: [] },
  { id: 'myth-buster', name: 'Myth vs truth', kind: 'script', summary: 'Correct a common belief.',
    beats: [{ name: 'Myth', purpose: 'State the common belief people repeat' }, { name: 'Truth', purpose: 'What is actually true, with a reason' }, { name: 'Example', purpose: 'Concrete case or number' }, { name: 'What to do', purpose: 'One action' }], rules: ['Never invent statistics'] },
  { id: 'newsletter-classic', name: 'Newsletter: one big idea', kind: 'newsletter', summary: 'Weekly email or LinkedIn newsletter.',
    beats: [{ name: 'Subject line', purpose: 'Specific, under 50 characters, plus a preview line' }, { name: 'Opening', purpose: 'Why this matters this week' }, { name: 'Big idea', purpose: 'One idea explained with an example' }, { name: '3 takeaways', purpose: 'Bullets the reader can use' }, { name: 'Links or resources', purpose: 'Only real links from the notes' }, { name: 'Sign-off', purpose: 'Personal line plus one ask' }], rules: ['Headings allowed', 'No filler intro'] }
];

const col = store.collection('formats', []);
function list() {
  const own = col.all();
  const ids = new Set(own.map((f) => f.id));
  return [...own, ...PRESETS.filter((p) => !ids.has(p.id)).map((p) => ({ ...p, source: 'preset' }))];
}
function get(q) {
  if (!q) return null;
  const s = String(q).toLowerCase().trim().replace(/^\//, '');
  const all = list();
  return all.find((f) => f.id === q) || all.find((f) => f.name.toLowerCase() === s) || all.find((f) => slug(f.name) === s) || all.find((f) => f.name.toLowerCase().includes(s)) || null;
}
const slug = (n) => String(n).toLowerCase().replace(/[^a-z0-9ঀ-৿]+/g, '-').replace(/^-|-$/g, '');
function save(f) {
  const all = col.all();
  const arr = (v) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => (typeof x === 'string' ? x.trim() : x)).filter(Boolean);
  const c = {
    id: f.id && f.source !== 'preset' ? f.id : `fmt-${crypto.randomBytes(3).toString('hex')}`,
    name: String(f.name || 'My format').slice(0, 80), kind: ['script', 'post', 'newsletter', 'caption', 'clip'].includes(f.kind) ? f.kind : 'script',
    summary: String(f.summary || '').slice(0, 400),
    beats: arr(f.beats).map((b) => (typeof b === 'string' ? { name: b.split(':')[0].trim(), purpose: b.split(':').slice(1).join(':').trim() } : { name: String(b.name || '').slice(0, 60), seconds: b.seconds ? String(b.seconds).slice(0, 20) : undefined, purpose: String(b.purpose || '').slice(0, 300), pattern: b.pattern ? String(b.pattern).slice(0, 300) : undefined })).slice(0, 15),
    rules: arr(f.rules).slice(0, 12).map((x) => String(x).slice(0, 200)),
    pacing: f.pacing ? String(f.pacing).slice(0, 300) : undefined,
    example: f.example ? String(f.example).slice(0, 3000) : undefined,
    source: f.source && f.source !== 'preset' ? f.source : 'custom', learnedFrom: f.learnedFrom || undefined, updatedAt: Date.now()
  };
  const i = all.findIndex((x) => x.id === c.id);
  if (i >= 0) all[i] = c; else all.push(c);
  col.save(all);
  return c;
}
function remove(id) { col.save(col.all().filter((f) => f.id !== id)); }
function describe(f) {
  if (!f) return '';
  return `FORMAT "${f.name}" (${f.kind})${f.summary ? `: ${f.summary}` : ''}
Structure, in order:
${f.beats.map((b, i) => `${i + 1}. ${b.name}${b.seconds ? ` [${b.seconds}s]` : ''}: ${b.purpose}${b.pattern ? ` (pattern: ${b.pattern})` : ''}`).join('\n')}${f.pacing ? `\nPacing: ${f.pacing}` : ''}${f.rules?.length ? `\nRules: ${f.rules.join('; ')}` : ''}${f.example ? `\nReference example (copy the shape, never the words):\n${f.example.slice(0, 1500)}` : ''}`;
}

module.exports = { PRESETS, list, get, save, remove, describe, slug };
