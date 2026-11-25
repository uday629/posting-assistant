// Caption tones, structure templates and engagement boosters. Ready-made ones plus the user's own (saved on disk).
// Used by the caption writer, Settings, per job ("make them aggressive, use AIDA"), /name in chats and the Library.
const crypto = require('crypto');
const store = require('../store');

// Every prompt is short on purpose: only the chosen tone, structure and boosters go to the model (cheap and fast).
const SAFE = 'Never insult people or groups, never threaten, never claim false facts.';
const TONES = [
  { id: 'positive', name: 'Positive', prompt: 'Upbeat and encouraging. Point at what is great.' },
  { id: 'optimistic', name: 'Optimistic', prompt: 'Hopeful and forward looking. Frame setbacks as steps forward.' },
  { id: 'neutral', name: 'Neutral', prompt: 'Calm, factual and clear. No hype.' },
  { id: 'hooking', name: 'Hooking', prompt: 'Built to stop the scroll: open loops, a surprising first line, a reason to keep reading or watching.' },
  { id: 'bold', name: 'Bold', prompt: 'Confident, direct, a clear stance. Short punchy lines.' },
  { id: 'aggressive', name: 'Aggressive (high energy)', prompt: `Intense, blunt and high energy, like a coach shouting. Attack the problem, the excuse or the status quo, not people. ${SAFE}` },
  { id: 'negative', name: 'Negative (call-out)', prompt: `Critical and honest about what is wrong or wasted. Name the mistake plainly, then give a way out. ${SAFE}` },
  { id: 'pessimistic', name: 'Pessimistic (reality check)', prompt: `Dry, realistic, expects the worst case, then shows the one thing that still works. ${SAFE}` },
  { id: 'controversial', name: 'Debate-starting', prompt: `Takes a clear side that people want to argue with, backed by one real reason. ${SAFE}` },
  { id: 'sarcastic', name: 'Sarcastic', prompt: `Dry wit and light sarcasm aimed at a situation, never at a person. ${SAFE}` },
  { id: 'urgent', name: 'Urgent', prompt: 'Time-sensitive feel. Only use real deadlines or limits from the notes.' },
  { id: 'emotional', name: 'Emotional', prompt: 'Warm and personal. Speak to a feeling the viewer knows (nostalgia, pride, struggle).' },
  { id: 'humorous', name: 'Funny', prompt: 'A relatable joke or twist, light and short.' },
  { id: 'mysterious', name: 'Mysterious', prompt: 'Hint, do not explain. Short lines, an unanswered question, a reason to watch.' },
  { id: 'motivational', name: 'Motivational', prompt: 'Push the viewer to act today. Concrete, no empty slogans.' },
  { id: 'hype', name: 'Hype / fan', prompt: 'Energetic fan voice. Name what makes the moment epic, use the fandom words.' },
  { id: 'calm', name: 'Calm / aesthetic', prompt: 'Quiet, minimal, poetic. Few words.' }
];

const STRUCTURES = [
  { id: 'hook-story-cta', name: 'Hook, story, CTA', steps: ['Line 1: a hook (result, tension or surprise)', '2-3 short lines: what happened, with one concrete detail', 'Last line: one ask (comment a word, save or share)'] },
  { id: 'aida', name: 'AIDA', steps: ['Attention: a bold first line', 'Interest: one fact or detail that makes them lean in', 'Desire: what they get or feel', 'Action: one clear ask'] },
  { id: 'pas', name: 'Problem, agitate, solve', steps: ['Problem: name what the viewer struggles with', 'Agitate: why it hurts, one example', 'Solve: the fix shown in the video', 'Ask: one action'] },
  { id: 'bab', name: 'Before, after, bridge', steps: ['Before: where it started', 'After: where it ended up', 'Bridge: how the video gets them there', 'Ask: one action'] },
  { id: 'question-answer', name: 'Question then answer', steps: ['Line 1: a question the viewer cares about', 'Line 2-3: the short answer (the video proves it)', 'Last line: a second question for the comments'] },
  { id: 'tips-list', name: 'Quick tips list', steps: ['Line 1: "3 things..." style promise', '3 short numbered lines, one tip each', 'Last line: save this for later'] },
  { id: 'cliffhanger', name: 'Cliffhanger', steps: ['Line 1: set up the moment', 'Line 2: hint at the twist without saying it', 'Line 3: "Watch to the end" style reason, in your own words'] },
  { id: 'one-liner', name: 'One-liner punch', steps: ['One strong line, 12 words or fewer', 'Optional: a short second line', 'Hashtags only'] },
  { id: 'fan-hype', name: 'Fan hype (3 lines)', steps: ['Line 1: the epic claim', 'Line 2: the exact moment or detail fans love', 'Line 3: ask fans to name their favourite or tag the series'] },
  { id: 'myth-truth', name: 'Myth vs truth', steps: ['Line 1: the common belief', 'Line 2: what is actually true', 'Line 3: what to do about it'] }
];

const BOOSTERS = [
  { id: 'question', name: 'Ask a real question', prompt: 'End with one real question people want to answer in the comments.' },
  { id: 'comment_keyword', name: 'Comment-a-word CTA', prompt: 'Ask viewers to comment one easy keyword (a single word, no spaces).' },
  { id: 'save_share', name: 'Save or share ask', prompt: 'Include one line asking people to save it for later or send it to someone who needs it.' },
  { id: 'a_or_b', name: 'This or that poll', prompt: 'Give two options (A or B) and ask people to pick one in the comments.' },
  { id: 'cliff', name: 'Open loop', prompt: 'Leave one thing unanswered so people watch or read to the end.' },
  { id: 'challenge', name: 'Challenge', prompt: 'Dare the viewer to try or beat something, tied to the video.' },
  { id: 'tag_friend', name: 'Tag a friend', prompt: 'Ask people to tag the friend this fits best (use once, not in every post).' }
];

const KINDS = { tone: { presets: TONES, file: 'caption-tones' }, structure: { presets: STRUCTURES, file: 'caption-structures' }, booster: { presets: BOOSTERS, file: 'caption-boosters' } };
const col = (kind) => store.collection(KINDS[kind].file, []);
const slug = (n) => String(n).toLowerCase().replace(/[^a-z0-9ঀ-৿]+/g, '-').replace(/^-|-$/g, '');

function list(kind) {
  const own = col(kind).all();
  const ids = new Set(own.map((x) => x.id));
  return [...own.map((x) => ({ ...x, source: 'custom' })), ...KINDS[kind].presets.filter((p) => !ids.has(p.id)).map((p) => ({ ...p, source: 'preset' }))];
}
function get(kind, q) {
  if (!q || q === 'auto') return null;
  const s = String(q).toLowerCase().trim().replace(/^\//, '');
  const all = list(kind);
  return all.find((x) => x.id === s) || all.find((x) => slug(x.name) === s || x.name.toLowerCase() === s) || all.find((x) => x.name.toLowerCase().includes(s) || x.id.startsWith(s)) || null;
}
function save(kind, item) {
  const all = col(kind).all();
  const name = String(item.name || '').trim().slice(0, 60);
  if (!name) throw new Error('Give it a name.');
  const c = { id: item.id && item.source !== 'preset' ? item.id : `${slug(name) || 'item'}-${crypto.randomBytes(2).toString('hex')}`, name };
  if (kind === 'structure') {
    c.steps = (Array.isArray(item.steps) ? item.steps : String(item.steps || '').split('\n')).map((x) => String(x).trim()).filter(Boolean).slice(0, 10).map((x) => x.slice(0, 200));
    if (!c.steps.length) throw new Error('Add at least one step.');
  } else {
    c.prompt = String(item.prompt || '').trim().slice(0, 400);
    if (!c.prompt) throw new Error('Describe how it should sound.');
  }
  const i = all.findIndex((x) => x.id === c.id);
  if (i >= 0) all[i] = c; else all.push(c);
  col(kind).save(all);
  return c;
}
function remove(kind, id) { col(kind).save(col(kind).all().filter((x) => x.id !== id)); }

// text for the caption prompt
function toneText(q) { const t = get('tone', q); return t ? `Tone: ${t.name}. ${t.prompt}` : ''; }
function structureText(q) { const s = get('structure', q); return s ? `Structure, in this order (keep each part short):\n${s.steps.map((x, i) => `${i + 1}. ${x}`).join('\n')}` : ''; }
function boosterText(ids) { const l = (ids || []).map((x) => get('booster', x)).filter(Boolean); return l.length ? `Engagement (use these, never more than one ask in total unless they are the same ask): ${l.map((b) => b.prompt).join(' ')}` : ''; }

module.exports = { list, get, save, remove, toneText, structureText, boosterText, slug };
