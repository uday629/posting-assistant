// Caption styles: ready presets, the user's own styles, and styles learned from an account or a creator's captions.
const crypto = require('crypto');
const store = require('../store');

const PRESETS = [
  {
    id: 'bangla-storyteller', name: 'Bangla Storyteller', language: 'bn', tone: 'warm, personal, conversational Bangla like talking to a friend',
    length: 'medium', emoji: 'light', hashtagCount: 5,
    hook: 'Open with a short, curious or emotional first line that makes people tap "more".',
    structure: 'Hook line, 2-4 short paragraphs telling the story or the value, one clear ask, hashtags on the last line.',
    cta: 'One simple ask: comment, save or share.',
    dos: ['Use everyday spoken Bangla (cholito), not textbook Bangla', 'Mention one concrete detail from the video', 'Short lines with white space'],
    donts: ['No machine-translated phrases', 'No more than one ask', 'No generic hype words']
  },
  {
    id: 'viral-hook', name: 'Viral Hook (Reels / Shorts / TikTok)', language: 'auto', tone: 'punchy, high energy, curiosity-driven',
    length: 'short', emoji: 'light', hashtagCount: 4,
    hook: 'First line is a bold claim, a surprising number or an open loop. Max 10 words.',
    structure: 'Hook, one line of payoff or context, one ask, hashtags.',
    cta: 'Comment a keyword, or follow for part 2 only if there is a part 2.',
    dos: ['Front-load the most interesting thing', 'Use numbers and specifics'],
    donts: ['No "stop scrolling"', 'No clickbait that the video does not deliver']
  },
  {
    id: 'educational', name: 'Educational Tips', language: 'auto', tone: 'clear, helpful, expert but friendly',
    length: 'medium', emoji: 'light', hashtagCount: 5,
    hook: 'State the problem the viewer has, or the result they get.',
    structure: 'Hook, 3-5 short numbered or line-broken tips, a save/share ask, hashtags.',
    cta: 'Save this for later / share with someone who needs it.',
    dos: ['Each tip one line', 'Use the search words people type'], donts: ['No vague advice']
  },
  {
    id: 'professional', name: 'Professional (LinkedIn / business)', language: 'en', tone: 'confident, insightful, human, no corporate jargon',
    length: 'long', emoji: 'none', hashtagCount: 3,
    hook: 'A first line that states a lesson, a number or a contrarian point.',
    structure: 'Hook, short story or context, 2-3 takeaways, a question to start discussion, 3 hashtags.',
    cta: 'Ask a real question to invite comments.',
    dos: ['Write in first person', 'Concrete outcomes and numbers'], donts: ['No buzzwords like synergy or leverage', 'No emoji walls']
  },
  {
    id: 'minimal', name: 'Minimal Aesthetic', language: 'auto', tone: 'calm, poetic, minimal',
    length: 'short', emoji: 'light', hashtagCount: 3,
    hook: 'One short evocative line.', structure: 'One or two short lines, then hashtags.', cta: 'Usually none, or a soft one.',
    dos: ['Few words, strong image'], donts: ['No long explanations']
  },
  {
    id: 'banglish-fun', name: 'Funny / Casual Banglish', language: 'banglish', tone: 'funny, relatable, meme-like, Bangla written in English letters',
    length: 'short', emoji: 'medium', hashtagCount: 4,
    hook: 'A relatable situation or punchline.', structure: 'Punchline, one follow-up line, tag-a-friend style ask (sparingly), hashtags.',
    cta: 'Comment or share with a friend.', dos: ['Write Bangla in Roman letters like people chat', 'Keep it light'], donts: ['No offensive jokes']
  },
  {
    id: 'promo', name: 'Sales / Promo', language: 'auto', tone: 'persuasive, benefit-focused, trustworthy',
    length: 'medium', emoji: 'light', hashtagCount: 5,
    hook: 'Lead with the main benefit or the offer.', structure: 'Benefit hook, 2-3 proof points or features, offer details, one clear CTA (DM / order / link in bio), hashtags.',
    cta: 'DM to order / link in bio.', dos: ['Prices, dates and details exactly as given in notes'], donts: ['Never invent prices, discounts or claims']
  }
];

const col = store.collection('styles', []);
function list() {
  const own = col.all();
  const ids = new Set(own.map((s) => s.id));
  return [...own, ...PRESETS.filter((p) => !ids.has(p.id)).map((p) => ({ ...p, source: 'preset' }))];
}
function get(idOrName) {
  if (!idOrName) return null;
  const q = String(idOrName).toLowerCase().trim();
  const all = list();
  return all.find((s) => s.id === idOrName) || all.find((s) => s.name.toLowerCase() === q) || all.find((s) => s.name.toLowerCase().includes(q) || s.id.includes(q)) || null;
}
function clean(s) {
  const arr = (v) => (Array.isArray(v) ? v : String(v || '').split(/\n|;/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 20);
  return {
    id: s.id || `style-${crypto.randomBytes(3).toString('hex')}`,
    name: String(s.name || 'My style').slice(0, 80),
    language: ['auto', 'bn', 'en', 'banglish', 'bn+en'].includes(s.language) ? s.language : 'auto',
    tone: String(s.tone || '').slice(0, 400), length: ['short', 'medium', 'long'].includes(s.length) ? s.length : 'medium',
    emoji: ['none', 'light', 'medium', 'heavy'].includes(s.emoji) ? s.emoji : 'light',
    hashtagCount: Math.max(0, Math.min(30, Number(s.hashtagCount ?? 5) || 0)),
    hook: String(s.hook || '').slice(0, 500), structure: String(s.structure || '').slice(0, 700), cta: String(s.cta || '').slice(0, 300),
    dos: arr(s.dos), donts: arr(s.donts), examples: arr(s.examples).map((x) => x.slice(0, 1200)).slice(0, 6),
    fixedHashtags: arr(s.fixedHashtags).map((x) => x.replace(/^#?/, '#').replace(/\s+/g, '')).slice(0, 10),
    signature: String(s.signature || '').slice(0, 300),
    learnedFrom: s.learnedFrom ? String(s.learnedFrom).slice(0, 300) : undefined,
    source: s.source === 'study' ? 'study' : 'custom', updatedAt: Date.now()
  };
}
function save(s) {
  const all = col.all();
  const c = clean(s);
  const i = all.findIndex((x) => x.id === c.id);
  if (i >= 0) all[i] = c; else all.push(c);
  col.save(all);
  return c;
}
function remove(id) { col.save(col.all().filter((s) => s.id !== id)); }

function describe(s) {
  if (!s) return 'No style chosen: write natural, engaging captions that fit the platform.';
  const L = [`STYLE "${s.name}"`];
  if (s.tone) L.push(`Tone: ${s.tone}`);
  L.push(`Length: ${s.length}. Emoji: ${s.emoji}. Hashtags: about ${s.hashtagCount}.`);
  if (s.hook) L.push(`Hook: ${s.hook}`);
  if (s.structure) L.push(`Structure: ${s.structure}`);
  if (s.cta) L.push(`Call to action: ${s.cta}`);
  if (s.dos?.length) L.push(`Do: ${s.dos.join('; ')}`);
  if (s.donts?.length) L.push(`Avoid: ${s.donts.join('; ')}`);
  if (s.fixedHashtags?.length) L.push(`Always include these hashtags: ${s.fixedHashtags.join(' ')}`);
  if (s.signature) L.push(`End the caption with this signature line: ${s.signature}`);
  if (s.examples?.length) L.push(`Examples of the wanted style (copy the feel and structure, never the words):\n${s.examples.map((e, i) => `--- example ${i + 1}\n${e}`).join('\n')}`);
  return L.join('\n');
}

/* ---------------- style auto-learn: small rules from how the user edits a written caption (pure code, no model) ---------------- */
const rulesCol = store.collection('learned-rules', []);
const MAX_RULES = 20;
const RULE_TEXT = {
  shorter_first: 'The user shortens the first line: keep the hook very short.',
  longer_first: 'The user lengthens the first line: give the hook more context.',
  no_emoji: 'The user removes emojis: write without emojis.',
  add_emoji: 'The user adds emojis: use a few fitting emojis.',
  add_question: 'The user adds a question at the end: finish with a question.',
  drop_question: 'The user removes the closing question: do not end with a question.',
  shorter: 'The user shortens captions: keep the whole caption tighter.',
  longer: 'The user expands captions: add a little more detail.',
  more_breaks: 'The user adds line breaks: use shorter lines with white space.',
  fewer_breaks: 'The user joins lines: use fewer, longer lines.',
  fewer_tags: 'The user removes hashtags: use fewer hashtags.',
  more_tags: 'The user adds hashtags: use a few more hashtags.',
  no_exclaim: 'The user removes exclamation marks: keep a calm tone.'
};
const OPPOSITE = { shorter_first: 'longer_first', longer_first: 'shorter_first', no_emoji: 'add_emoji', add_emoji: 'no_emoji', add_question: 'drop_question', drop_question: 'add_question', shorter: 'longer', longer: 'shorter', more_breaks: 'fewer_breaks', fewer_breaks: 'more_breaks', fewer_tags: 'more_tags', more_tags: 'fewer_tags' };
const EMOJI = /\p{Extended_Pictographic}/gu;
function splitTags(t) {
  const s = String(t || '').trim();
  const tags = s.match(/#[\p{L}\p{M}\p{N}_]+/gu) || [];
  const body = s.replace(/(\s*#[\p{L}\p{M}\p{N}_]+)+\s*$/u, '').trim();
  return { body, tags };
}
// returns rule ids describing what changed between the written and the edited caption
function diffRules(original, edited) {
  const a = splitTags(original), b = splitTags(edited);
  if (!a.body || !b.body || String(original).trim() === String(edited).trim()) return [];
  const ids = [];
  const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  const la = lines(a.body), lb = lines(b.body);
  const fa = (la[0] || '').length, fb = (lb[0] || '').length;
  if (fa >= 20 && fb < fa * 0.8) ids.push('shorter_first');
  else if (fa >= 5 && fb > fa * 1.3 + 5) ids.push('longer_first');
  const ea = (a.body.match(EMOJI) || []).length, eb = (b.body.match(EMOJI) || []).length;
  if (ea > 0 && eb === 0) ids.push('no_emoji'); else if (ea === 0 && eb > 0) ids.push('add_emoji');
  const qa = /[?؟;]\s*$/.test(a.body), qb = /[?؟;]\s*$/.test(b.body);
  if (!qa && qb) ids.push('add_question'); else if (qa && !qb) ids.push('drop_question');
  if (b.body.length < a.body.length * 0.75) ids.push('shorter'); else if (b.body.length > a.body.length * 1.3 + 15) ids.push('longer');
  if (lb.length >= la.length + 2) ids.push('more_breaks'); else if (la.length >= lb.length + 2) ids.push('fewer_breaks');
  if (a.tags.length > b.tags.length) ids.push('fewer_tags'); else if (b.tags.length > a.tags.length) ids.push('more_tags');
  if ((a.body.match(/!/g) || []).length > 0 && (b.body.match(/!/g) || []).length === 0) ids.push('no_exclaim');
  return ids;
}
// stores the rules (max 20, no duplicates; a new rule replaces its opposite). Returns the rule ids found.
function learnFromEdits({ original, edited, platform } = {}) {
  const ids = diffRules(original, edited);
  if (!ids.length) return [];
  let rules = rulesCol.all();
  for (const id of ids) {
    rules = rules.filter((r) => r.id !== OPPOSITE[id]);
    const have = rules.find((r) => r.id === id);
    if (have) { have.count = (have.count || 1) + 1; have.at = Date.now(); if (platform && !(have.platforms || []).includes(platform)) have.platforms = [...(have.platforms || []), platform].slice(0, 12); }
    else rules.push({ id, text: RULE_TEXT[id], count: 1, at: Date.now(), platforms: platform ? [platform] : [] });
  }
  rules.sort((x, y) => (y.count - x.count) || (y.at - x.at));
  rulesCol.save(rules.slice(0, MAX_RULES));
  return ids;
}
function learnedRules(budget = 600) {
  const rules = rulesCol.all().filter((r) => r && RULE_TEXT[r.id]);
  if (!rules.length) return '';
  const head = 'LEARNED FROM THE USER\'S EDITS (apply these):';
  let out = head;
  for (const r of rules) {
    const line = `\n- ${RULE_TEXT[r.id]}`;
    if (out.length + line.length > budget) break;
    out += line;
  }
  return out === head ? '' : out;
}
function clearLearned() { rulesCol.save([]); }

module.exports = { PRESETS, list, get, save, remove, describe, clean, learnFromEdits, learnedRules, learnedRuleList: () => rulesCol.all(), clearLearned, diffRules };
