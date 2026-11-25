// Learns a caption style from real captions: the user's own Buffer posts, a profile/channel page opened in the
// app browser (the user's account or a big creator), or pasted text. It saves the PATTERN (tone, hook, structure,
// hashtag habits), never copies someone else's words into posts.
const providers = require('../llm/providers');
const styles = require('./styles');
const buffer = require('../posting/buffer');
const browser = require('../posting/browser');
const { parseJson } = require('../agent/json');

async function analyzeTexts(texts, { name, source, signal } = {}) {
  const sample = texts.map((t) => String(t).trim()).filter((t) => t.length > 15).slice(0, 60);
  if (sample.length < 2) throw new Error('Not enough captions found to learn a style (need at least 2).');
  let joined = '';
  for (const [i, t] of sample.entries()) { const piece = `--- caption ${i + 1}\n${t.slice(0, 1500)}\n`; if (joined.length + piece.length > 26000) break; joined += piece; }
  const r = await providers.chat('writer', {
    system: 'You are a social media strategist. You study captions and describe the writing style precisely so another writer can reproduce the style with new content. Reply with one JSON object only.',
    messages: [{ role: 'user', text: `Study these captions${source ? ` from ${source}` : ''}:

${joined}

Return JSON:
{"name": "short style name", "language": "bn|en|banglish|bn+en|auto", "tone": "...", "length": "short|medium|long", "emoji": "none|light|medium|heavy", "hashtagCount": number,
 "hook": "how the first line works", "structure": "how the caption is built from top to bottom", "cta": "the usual call to action",
 "dos": ["specific habits to copy"], "donts": ["things this creator never does"], "fixedHashtags": ["hashtags used in almost every post"],
 "signature": "a sign-off line used in most posts, or empty",
 "examples": ["2-3 NEW example captions written in this style about a neutral topic (do not copy the originals)"],
 "insights": "3-5 sentences on why these captions work"}` }],
    json: true, maxTokens: 2200, signal, temperature: 0.3
  });
  const j = parseJson(r.text);
  const saved = styles.save({ ...j, name: name || j.name || 'Learned style', source: 'study', learnedFrom: source });
  return { style: saved, insights: Array.isArray(j.insights) ? j.insights.join(' ') : String(j.insights || ''), count: sample.length };
}

// picks the caption-like texts out of a page dump
async function captionsFromPage(page, signal) {
  const raw = page.texts.join('\n@@\n').slice(0, 30000);
  const r = await providers.chat('main', {
    system: 'You extract social media post captions or video titles from scraped page text. Reply with JSON only.',
    messages: [{ role: 'user', text: `Page: ${page.title} (${page.url}). The text blocks are separated by @@. Return {"captions": ["..."]} with only the real post captions, descriptions or video titles (skip menus, buttons, comments by others, ads, counters).\n\n${raw}` }],
    json: true, maxTokens: 3500, signal, temperature: 0
  });
  const j = parseJson(r.text);
  return (j.captions || []).map(String);
}

async function fromBuffer({ channelId, name, signal } = {}) {
  const posts = await buffer.sentPosts({ channelId, limit: 60 });
  if (!posts.length) throw new Error('No sent posts found in Buffer for that account.');
  return analyzeTexts(posts.map((p) => p.text), { name, source: 'your Buffer posts', signal });
}
async function fromUrl({ url, name, scrolls = 8, signal, onFrame } = {}) {
  if (!/^https?:\/\//i.test(url || '')) throw new Error('Give a full profile or channel link (https://...).');
  const page = await browser.collectText(url, { scrolls, signal, onFrame });
  const caps = await captionsFromPage(page, signal);
  return analyzeTexts(caps, { name, source: url, signal });
}
async function fromText({ text, name, signal } = {}) {
  const parts = String(text || '').split(/\n\s*(?:---+|===+|\*\*\*+)\s*\n|\n{3,}/).map((s) => s.trim()).filter(Boolean);
  return analyzeTexts(parts.length > 1 ? parts : String(text).split(/\n{2,}/), { name, source: 'pasted captions', signal });
}

module.exports = { fromBuffer, fromUrl, fromText, analyzeTexts };
