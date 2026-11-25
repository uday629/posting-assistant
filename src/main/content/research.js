// Hashtag and keyword research from ONE web search, extracted in code (no model call).
// research(topic, platform) -> { hashtags: [{tag, count}], keywords: [{phrase, count}], engine, basis }
// A failed or empty search returns empty lists and never throws. `opts.search` lets tests stub the search.
const STOP = new Set(('the a an and or but if of to in on at for with from by as is are was were be been it its this that these those you your we our they their i me my he she his her not no yes do does did can will just so than then too very more most how what why when where who which about into out up down over under again also get got make made use used using video videos new best top').split(' '));

const SITE = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', linkedin: 'LinkedIn', twitter: 'X Twitter', threads: 'Threads', pinterest: 'Pinterest', bluesky: 'Bluesky' };

function tally(map, key, label) {
  const e = map.get(key);
  if (e) e.count++; else map.set(key, { label, count: 1 });
}

function extract(results, topic) {
  const tags = new Map(), grams = new Map();
  const topicWords = new Set(String(topic || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  for (const r of results) {
    const text = `${r.title || ''}. ${r.snippet || ''}`;
    for (const m of text.matchAll(/#([\p{L}\p{N}_]{2,40})/gu)) tally(tags, m[1].toLowerCase(), `#${m[1]}`);
    // sentence-like chunks split on punctuation, then 2 and 3 word phrases from them
    for (const chunk of text.split(/[.,;:!?|()\[\]{}"“”–—\-\/\n]+/)) {
      const words = chunk.toLowerCase().replace(/#/g, '').split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
      for (let n = 2; n <= 3; n++) {
        for (let i = 0; i + n <= words.length; i++) {
          const g = words.slice(i, i + n);
          if (STOP.has(g[0]) || STOP.has(g[n - 1]) || g.some((w) => w.length < 2 || /^\d+$/.test(w))) continue;
          const phrase = g.join(' ');
          if (phrase.length > 40) continue;
          tally(grams, phrase, phrase);
        }
      }
    }
  }
  const byCount = (a, b) => b.count - a.count || a.label.length - b.label.length;
  // hashtags: every distinct tag seen, most repeated first; if the page text had few, build tags from the best phrases
  let hashtags = [...tags.values()].sort(byCount).map((e) => ({ tag: e.label, count: e.count }));
  const phrases = [...grams.values()].filter((e) => e.count >= 2 || topicWords.size === 0 || e.label.split(' ').some((w) => topicWords.has(w))).sort(byCount);
  // drop a phrase that is a part of a longer phrase with the same count (keeps the more specific one)
  const keywords = [];
  for (const e of phrases) {
    if (keywords.some((k) => k.phrase.includes(e.label) && k.count >= e.count)) continue;
    keywords.push({ phrase: e.label, count: e.count });
    if (keywords.length >= 8) break;
  }
  if (hashtags.length < 8) {
    for (const k of keywords) {
      const t = `#${k.phrase.replace(/\s+/g, '')}`;
      if (t.length <= 30 && !hashtags.some((h) => h.tag.toLowerCase() === t.toLowerCase())) hashtags.push({ tag: t, count: k.count });
      if (hashtags.length >= 8) break;
    }
  }
  return { hashtags: hashtags.slice(0, 8), keywords };
}

async function research(topic, platform, opts = {}) {
  const empty = { hashtags: [], keywords: [], engine: '', basis: 'none' };
  try {
    const t = String(topic || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!t) return empty;
    const site = SITE[String(platform || '').toLowerCase()] || '';
    const query = `${t} ${site} popular hashtags keywords`.replace(/\s+/g, ' ').trim();
    const search = opts.search || require('../web/search').search;
    const res = await search(query, 8);
    const list = [...(res?.results || [])];
    if (res?.overview) list.unshift({ title: '', snippet: String(res.overview).slice(0, 3000) });
    if (!list.length) return { ...empty, engine: res?.engine || '' };
    const out = extract(list, t);
    return { ...out, engine: res?.engine || '', basis: `counted in ${list.length} web results` };
  } catch (_) {
    return empty;
  }
}

module.exports = { research, extract };
