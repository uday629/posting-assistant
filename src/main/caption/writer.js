// Writes the title, caption, description, hashtags and keywords for every target platform in one model call,
// using the chosen style, enabled skills, the Info/Docs knowledge and what the media analysis found.
const store = require('../store');
const providers = require('../llm/providers');
const styles = require('./styles');
const craft = require('./craft');
const skills = require('./skills');
const humanize = require('./humanize');
const kb = require('../knowledge/kb');
const { parseJson } = require('../agent/json');
const { LANG_NAMES } = require('../media/analyze');

const PLATFORMS = {
  youtube: { label: 'YouTube', fields: 'title (max 100 chars), description (max 5000 chars, first 150 chars carry the keyword), keywords (8-15 search phrases, under 500 chars total), hashtags (max 3)', title: 100, text: 5000, tags: 3 },
  instagram: { label: 'Instagram', fields: 'caption (max 2200 chars, first 125 chars are the hook), hashtags (max 5), first_comment (optional)', text: 2200, tags: 5 },
  tiktok: { label: 'TikTok', fields: 'caption (max 2200 chars, search phrase in line 1), hashtags (3-5)', text: 2200, tags: 6 },
  facebook: { label: 'Facebook', fields: 'caption (conversational, first line is the hook), hashtags (0-3)', text: 5000, tags: 3 },
  linkedin: { label: 'LinkedIn', fields: 'caption (max 3000 chars, first person, first 2 lines earn "see more"), hashtags (3)', text: 3000, tags: 3 },
  twitter: { label: 'X (Twitter)', fields: 'caption (max 270 chars INCLUDING hashtags), hashtags (0-2)', text: 280, tags: 2 },
  threads: { label: 'Threads', fields: 'caption (max 480 chars), hashtags (0-1)', text: 500, tags: 1 },
  bluesky: { label: 'Bluesky', fields: 'caption (max 290 chars), hashtags (0-2)', text: 300, tags: 2 },
  pinterest: { label: 'Pinterest', fields: 'title (max 100 chars), caption (max 480 chars, keyword rich), hashtags (0-3)', title: 100, text: 500, tags: 3 },
  google: { label: 'Google Business', fields: 'caption (max 1400 chars), no hashtags', text: 1500, tags: 0 },
  mastodon: { label: 'Mastodon', fields: 'caption (max 480 chars), hashtags (2-4)', text: 500, tags: 4 },
  generic: { label: 'Other', fields: 'caption, hashtags (3-5)', text: 2200, tags: 5 }
};
function platformKey(service) {
  const s = String(service || '').toLowerCase();
  if (/youtube|yt/.test(s)) return 'youtube';
  if (/insta|ig\b/.test(s)) return 'instagram';
  if (/tiktok|tik tok/.test(s)) return 'tiktok';
  if (/facebook|fb\b|meta/.test(s)) return 'facebook';
  if (/linkedin/.test(s)) return 'linkedin';
  if (/twitter|^x$|x\.com/.test(s)) return 'twitter';
  if (/threads/.test(s)) return 'threads';
  if (/bluesky|bsky/.test(s)) return 'bluesky';
  if (/pinterest/.test(s)) return 'pinterest';
  if (/google|gbp/.test(s)) return 'google';
  if (/mastodon/.test(s)) return 'mastodon';
  return 'generic';
}

const LANG_RULE = {
  bn: 'Write in Bangla, in Bengali script (বাংলা). Natural spoken Bangla as used in Bangladesh.',
  en: 'Write in English.',
  banglish: 'Write Bangla in Roman/English letters (Banglish) the way people chat, e.g. "ajke dekhabo kivabe..."',
  'bn+en': 'Write the main caption in Bangla (Bengali script), then a short English version below it.'
};
function chooseLanguage(requested, style, analysis) {
  const s = store.get();
  // order: what the user asked now > the app setting > the language heard/seen in the video > the style > Bangla
  if (requested && requested !== 'auto') return requested;
  if (s.captionLanguage && s.captionLanguage !== 'auto') return s.captionLanguage;
  const a = analysis?.language;
  if (a === 'bn' || a === 'en') {
    // a Banglish style keeps Roman letters for Bangla videos
    if (a === 'bn' && style?.language === 'banglish') return 'banglish';
    if (a === 'bn' && style?.language === 'bn+en') return 'bn+en';
    return a;
  }
  if (a === 'mixed') return style?.language && style.language !== 'auto' ? style.language : 'bn';
  if (a && LANG_NAMES[a]) return a;
  if (style?.language && style.language !== 'auto') return style.language;
  return 'bn'; // most of this user's content is Bangla
}

function system() {
  return `You are an expert social media copywriter and SEO specialist for Bangladeshi and international creators. You write captions that sound human, are specific to the actual video, and are optimized for each platform's search and feed.
Hard rules:
- Use ONLY facts from the media analysis, the user's notes, the knowledge snippets and the instructions. Never invent prices, dates, names, offers, links or claims.
- Do not use em dashes or en dashes. Do not use the words: delve, leverage, seamless, robust, elevate, unlock, game-changer, tapestry, testament.
- Hashtags: no spaces, specific, no #viral #fyp #foryou #explorepage.
- Use real line breaks (\n) between the hook, each short paragraph, and the ask. Never one long block.
- Exactly one call to action.
- Put hashtags ONLY in the "hashtags" array, not inside the caption text.
- Return exactly one JSON object, no prose around it.`;
}

// caption craft: the shape of the caption (length, type, tone, psychology), from the job, the style or Settings
const CRAFT = {
  length: { short: 'SHORT: 1-3 lines, under 150 characters before hashtags.', medium: 'MEDIUM: 3-6 short lines, about 250-500 characters.', long: 'LONG: a mini story or lesson, 600-1200 characters, short paragraphs.' },
  type: {
    auto: 'Pick the caption type that best fits this video.',
    storytelling: 'STORYTELLING: open with a moment or tension, tell what happened in 2-4 lines, end with the takeaway.',
    educational: 'EDUCATIONAL: state the problem, give 2-4 clear tips or steps, end with a save/share ask.',
    hook_question: 'HOOK + QUESTION: a bold first line, one line of context, end with a real question people want to answer.',
    emotional: 'EMOTIONAL: speak to a feeling the viewer knows (nostalgia, pride, struggle), personal and warm.',
    humorous: 'HUMOROUS: a relatable joke or twist in line 1, light and short.',
    promotional: 'PROMOTIONAL: benefit first, proof, the offer exactly as given in the notes, one clear CTA.',
    minimal: 'MINIMAL: one strong line, maybe two. No explanation.',
    hype: 'HYPE / FAN: energetic, for fans of the topic (anime, gaming, sports), name what makes the moment epic.'
  },
  tone: { positive: 'Tone: positive and encouraging.', neutral: 'Tone: neutral and informative.', bold: 'Tone: bold and opinionated (a clear stance), still respectful.', controversial: 'Tone: provocative angle that invites debate, never offensive or false.' }
};
const TRIGGERS = { curiosity: 'curiosity gap (hint at something the viewer only gets by watching)', fomo: 'FOMO / urgency (only when real)', social_proof: 'social proof (only real numbers from the notes)', relatability: 'relatability ("we all did this")', authority: 'authority (show you know the craft)', controversy: 'mild controversy (an unpopular opinion)', reward: 'reward (what they gain by watching)' };
function craftText(c = {}) {
  const L = ['CAPTION CRAFT (follow exactly):'];
  L.push(CRAFT.length[c.length] || CRAFT.length.medium);
  L.push(CRAFT.type[c.type] || CRAFT.type.auto);
  L.push(craft.toneText(c.tone || 'positive') || CRAFT.tone[c.tone] || CRAFT.tone.positive);
  const stx = craft.structureText(c.structure);
  if (stx) L.push(stx);
  const bst = craft.boosterText(c.boosters);
  if (bst) L.push(bst);
  const t = (c.triggers || []).filter((x) => TRIGGERS[x]);
  if (t.length) L.push(`Psychological triggers to use: ${t.map((x) => TRIGGERS[x]).join('; ')}.`);
  L.push('The first line must be a scroll-stopping hook that fits the video (not a greeting, not a hashtag). Describe only what is really in the video and the notes; never invent people, events or dialogue.');
  return L.join('\n');
}

function buildPrompt({ analysis, targets, style, lang, instructions, knowledge, keywords, craft, skillBudget, briefMax, learned, query }) {
  const short = craft?.length === 'short';
  // a SHORT job must not be told that the platform allows thousands of characters, and needs fewer search phrases
  const fieldsOf = (k) => (short ? PLATFORMS[k].fields.replace(/max \d{4} chars/g, 'short, under 200 chars').replace('8-15 search phrases', '8-10 search phrases') : PLATFORMS[k].fields);
  const want = targets.map((k) => `"${k}": {${fieldsOf(k)}}`).join('\n');
  const langRule = LANG_RULE[lang] || `Write in ${LANG_NAMES[lang] || lang}.`;
  let brief = String(analysis.brief || analysis);
  if (briefMax && brief.length > briefMax) brief = brief.slice(0, briefMax).replace(/\s+\S*$/, '') + ' ...';
  return `MEDIA ANALYSIS
${brief}

LANGUAGE
${langRule}${analysis.hasSpeech === false ? '\nThe video has no speech: write from what is seen and the notes.' : ''}

${styles.describe(style)}

${craftText(craft)}

${instructions ? `USER INSTRUCTIONS FOR THIS POST (highest priority)\n${instructions}\n` : ''}${keywords ? `SEARCH KEYWORDS TO USE NATURALLY\n${keywords}\n` : ''}${learned ? `${learned}\n` : ''}${knowledge ? `KNOWLEDGE (brand info and documents, use only if relevant)\n${knowledge}\n` : ''}
WRITING SKILLS (follow these)
${skills.promptText('caption', skillBudget, { platforms: targets, query, exclude: ['bn', 'banglish', 'bn+en'].includes(lang) ? [] : ['bangla-natural'] }) || '- Write clearly and naturally.'}

OUTPUT
Return JSON with one key per platform and these fields (strings, hashtags and keywords as arrays of strings):
{
${want}
}
Also add "summary": one line describing the post in English for the user's log.${craft?.length === 'short' ? '\nLength check: every caption or description body is 1 to 3 short lines, under 200 characters, before hashtags.' : ''}`;
}

function arr(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return String(v || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
}
function fixTags(list, max) {
  const out = [];
  for (let t of list) {
    t = String(t).replace(/^#+/, '').replace(/[\s.,!?;:'"()\[\]{}]+/g, '');
    if (!t || /^(viral|fyp|foryou|foryoupage|explorepage|explore|trending|reels?)$/i.test(t)) continue;
    const tag = `#${t}`;
    if (!out.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out.slice(0, max);
}
function cut(s, max) {
  s = String(s || '').trim();
  if (s.length <= max) return s;
  const c = s.slice(0, max);
  const i = Math.max(c.lastIndexOf('\n'), c.lastIndexOf('. '), c.lastIndexOf('। '));
  return (i > max * 0.6 ? c.slice(0, i + 1) : c.slice(0, max - 3) + '...').trim();
}

// final text per platform as it will be posted
function assemble(key, p, style) {
  const R = PLATFORMS[key];
  const fixed = style?.fixedHashtags || [];
  const tags = fixTags([...fixed, ...arr(p.hashtags)], R.tags || 0);
  // hashtags go on their own last line: drop the ones the model put at the end of the body
  let body = humanize.clean(p.caption || p.description || p.text || '');
  body = body.replace(/(\s*#[\p{L}\p{M}\p{N}_]+)+\s*$/u, '').trim();
  // YouTube rejects < and > in titles and descriptions
  if (key === 'youtube') body = body.replace(/[<>]/g, '');
  const out = { platform: key, hashtags: tags, keywords: arr(p.keywords).slice(0, 20), first_comment: p.first_comment ? humanize.clean(p.first_comment) : '' };
  if (R.title) out.title = cut(humanize.clean(p.title || body.split('\n')[0]).replace(key === 'youtube' ? /[<>]/g : /(?!)/g, ''), R.title);
  const tagLine = tags.join(' ');
  const room = R.text - (tagLine ? tagLine.length + 2 : 0);
  out.text = cut(body, Math.max(50, room)) + (tagLine ? `\n\n${tagLine}` : '');
  if (key === 'youtube') {
    let total = 0;
    out.keywords = out.keywords.filter((k) => { total += k.length + 1; return total <= 480; });
  }
  out.flags = humanize.flags(body);
  return out;
}

// targets: platform keys (youtube, instagram ...). Returns {platforms: {key: {title?, text, hashtags, keywords, first_comment}}, language, summary}
async function write({ analysis, targets, style: styleId, language, instructions, keywords, craft: craftArg, signal }) {
  const keys = [...new Set((targets || []).map(platformKey))];
  if (!keys.length) keys.push('instagram');
  const style = styles.get(styleId || store.get().defaultStyle);
  const lang = chooseLanguage(language, style, analysis);
  const T0 = Date.now();
  const dbg = (...a) => { if (process.env.PA_DEBUG_WRITER) console.log('[writer]', ...a); };
  const perf = { calls: 0, promptChars: 0, ms: {} };
  const q = `${analysis.name} ${analysis.folder} ${analysis.fileNotes || ''} ${analysis.folderNotes || ''} ${analysis.visual?.topic || ''} ${(analysis.audio?.text || '').slice(0, 400)} ${instructions || ''}`;
  const st = store.get();
  const cr = { length: craftArg?.length || style?.length || st.captionLength, type: craftArg?.type || st.captionType, tone: craftArg?.tone || st.captionTone, structure: craftArg?.structure || st.captionStructure, boosters: craftArg?.boosters || st.captionBoosters, triggers: craftArg?.triggers || st.captionTriggers };
  // routing: a SHORT caption needs a smaller prompt and fewer output tokens. One call still covers every platform.
  const lean = cr.length === 'short';
  let skillBudget = lean ? Math.min(2200, st.skillBudgetChars || 2200) : undefined;
  let kbBudget = lean ? 900 : 2500;
  const promptCap = lean ? 9000 : 22000;
  const learned = styles.learnedRules(600);
  // the chosen length wins over a style that was written for a longer caption (its structure and examples would pull the text long)
  const styleForPrompt = lean && style ? { ...style, length: 'short', structure: 'Hook line, one short line of payoff, one ask.', examples: [] } : style;
  const mk = () => buildPrompt({ analysis, targets: keys, style: styleForPrompt, lang, instructions, knowledge: kbBudget ? kb.search(q, { budget: kbBudget }) : '', keywords, craft: cr, skillBudget, briefMax: lean ? 2500 : 4500, learned, query: `${analysis.visual?.topic || ''} ${instructions || ''} ${analysis.name}` });
  let prompt = mk();
  // total size cap: drop knowledge first, then halve the skill text (most relevant skills come first)
  for (let i = 0; i < 4 && prompt.length > promptCap; i++) {
    if (kbBudget > 0) kbBudget = i === 0 ? Math.floor(kbBudget / 2) : 0;
    else skillBudget = Math.max(600, Math.floor((skillBudget || st.skillBudgetChars || 7000) / 2));
    prompt = mk();
  }
  perf.promptChars = prompt.length;  dbg(`prompt ${prompt.length} chars (lean=${lean}, skills=${skillBudget ?? 'default'}, kb=${kbBudget}) built in ${Date.now() - T0} ms`);
  // output budget by length setting: legacy size is kept for retries so a cut-off reply is not repeated
  const perKey = { short: { youtube: 520, _: 340 }, medium: { youtube: 750, _: 520 }, long: { youtube: 1000, _: 900 } }[cr.length] || { youtube: 1000, _: 900 };
  const leanTokens = 260 + keys.reduce((s, k) => s + (perKey[k] || perKey._), 0);
  const fullTokens = 900 + keys.length * 700;
  let j = null, lastErr = null, lastRaw = '';
  // the reply must be a JSON object that has one entry per platform; otherwise ask again (up to 3 tries, lower temperature)
  const entry = (o, k) => o[k] || o[PLATFORMS[k].label] || o[PLATFORMS[k].label.toLowerCase()];
  const hasKeys = (o) => o && typeof o === 'object' && keys.some((k) => { const e = entry(o, k); return e && typeof e === 'object' && Object.keys(e).length; });
  for (let attempt = 0; attempt < 3 && !j; attempt++) {
    try {
      const retry = attempt ? `\n\nYour previous reply was not usable. Reply with ONE JSON object whose keys are exactly: ${keys.join(', ')}. Each value is an object with the fields listed above.` : '';
      // a retry changes the very start of the prompt, so a local model cannot reuse a bad cached state of the first try
      const tc = Date.now();
      const r = await providers.chat('writer', { system: (attempt ? `[retry ${attempt}] ` : '') + system(), messages: [{ role: 'user', text: prompt + retry }], json: true, maxTokens: attempt ? fullTokens : Math.min(fullTokens, leanTokens), signal, temperature: attempt ? 0.4 : undefined });
      perf.calls++; perf.ms[`main${attempt || ''}`] = Date.now() - tc;
      dbg(`main call attempt ${attempt}: ${Date.now() - tc} ms, reply ${r.text.length} chars`);
      lastRaw = r.text;
      // local models sometimes glitch (letters missing everywhere): English text without a single "s" is not real
      const letters = r.text.replace(/[^A-Za-z]/g, '');
      const glitch = letters.length > 120 && (letters.match(/s/gi) || []).length / letters.length < 0.012;
      if (glitch) { lastErr = new Error('the model output was garbled'); continue; }
      const parsed = parseJson(r.text);
      if (hasKeys(parsed) || (keys.length === 1 && (parsed.caption || parsed.text))) j = parsed;
      else lastErr = new Error('the reply had no entry for the requested platforms');
    } catch (e) { if (e.message === 'ABORTED' || signal?.aborted) throw new Error('ABORTED'); lastErr = e; }
  }
  if (!j) throw new Error(`Caption writer failed: ${lastErr?.message || 'no reply'}`);
  const platforms = {};
  for (const k of keys) {
    const p = j[k] || j[PLATFORMS[k].label] || j[PLATFORMS[k].label.toLowerCase()] || (keys.length === 1 ? j : null);
    if (!p || typeof p !== 'object') continue;
    platforms[k] = assemble(k, p, style);
  }
  // a platform the model skipped: reuse the closest one
  for (const k of keys) if (!platforms[k]) { const any = Object.values(platforms)[0]; if (any) platforms[k] = assemble(k, { caption: any.text.replace(/\n\n#.*$/s, ''), title: any.title, hashtags: any.hashtags, keywords: any.keywords }, style); }
  if (!Object.keys(platforms).length) { if (process.env.PA_DEBUG_WRITER) console.log('RAW REPLY:', lastRaw.slice(0, 1500)); throw new Error(`Caption writer returned nothing usable. The model answered: ${String(lastRaw).replace(/\s+/g, ' ').slice(0, 160)}`); }
  // wrong script for the chosen language (small models drift): one rewrite pass
  const scriptOf = (t) => { const b = (t.match(/[\u0980-\u09FF]/g) || []).length, l = (t.match(/[A-Za-z]/g) || []).length; return b > l * 0.5 ? 'bn' : 'latin'; };
  const wantScript = lang === 'bn' || lang === 'bn+en' ? 'bn' : ['en', 'banglish'].includes(lang) ? 'latin' : null;
  const wrong = wantScript ? Object.keys(platforms).filter((k) => scriptOf(platforms[k].text.replace(/#\S+/g, '')) !== wantScript) : [];
  if (wrong.length) {
    try {
      perf.calls++;
      const r = await providers.chat('writer', { system: 'You rewrite social media captions into another language. Keep the meaning, line breaks, hook and call to action. Reply with JSON only.', messages: [{ role: 'user', text: `${LANG_RULE[lang] || `Write in ${lang}.`}\nRewrite each caption (and title if given). Return {"<platform>": {"title": "...", "caption": "..."}}\n\n${JSON.stringify(Object.fromEntries(wrong.map((k) => [k, { title: platforms[k].title, caption: platforms[k].text.replace(/\n\n#.*$/s, '') }])))}` }], json: true, maxTokens: 600 + wrong.length * 600, signal, temperature: 0.3 });
      const t = parseJson(r.text);
      for (const k of wrong) if (t[k]?.caption) platforms[k] = assemble(k, { ...t[k], hashtags: platforms[k].hashtags, keywords: platforms[k].keywords, first_comment: platforms[k].first_comment }, style);
    } catch (e) { if (e.message === 'ABORTED') throw e; }
  }
  // the length the user chose is a rule: one tightening pass for captions that run over
  const cap = { short: 220, medium: 800 }[cr.length];
  if (cap) {
    const body = (t) => t.replace(/\n\n#.*$/s, '');
    const over = Object.keys(platforms).filter((k) => body(platforms[k].text).length > cap && k !== 'youtube_title');
    if (over.length) {
      try {
        perf.calls++;
        const r = await providers.chat('writer', { system: 'You shorten social media captions. Keep the language, the hook and the tone. Same facts, fewer words. Reply with JSON only.', messages: [{ role: 'user', text: `Shorten each caption to at most ${cap} characters (${cr.length === 'short' ? '1 to 3 short lines' : 'a few short lines'}). Keep line breaks. Return {"<platform>": {"caption": "..."}}\n\n${JSON.stringify(Object.fromEntries(over.map((k) => [k, { caption: body(platforms[k].text) }])))}` }], json: true, maxTokens: 400 + over.length * 400, signal, temperature: 0.3 });
        const t = parseJson(r.text);
        for (const k of over) { const c = t[k]?.caption; if (typeof c === 'string' && c.trim() && c.length < body(platforms[k].text).length) platforms[k] = assemble(k, { title: platforms[k].title, caption: c, hashtags: platforms[k].hashtags, keywords: platforms[k].keywords, first_comment: platforms[k].first_comment }, style); }
      } catch (e) { if (e.message === 'ABORTED') throw e; }
    }
  }
  perf.totalMs = Date.now() - T0;
  dbg(`done in ${perf.totalMs} ms, ${perf.calls} model call(s), prompt ${perf.promptChars} chars`);
  return { platforms, language: lang, style: style?.id || null, summary: String(j.summary || '').slice(0, 200), at: Date.now(), perf };
}

module.exports = { write, PLATFORMS, platformKey, assemble, chooseLanguage };
