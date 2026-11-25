// Viral and journey math. Pure functions (no browser, no model) so everything here is testable.
// A post: { id, url, title, views, likes, comments, t (ms or null), exact (bool), durationSec, kind: 'video'|'short' }
'use strict';

const DAY = 86400000;
const median = (a) => {
  const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!s.length) return 0;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// "102M", "36M views", "1,234 views", "1.2K", "No views"  ->  number (or null if there is no count)
function parseCount(text) {
  const s = String(text == null ? '' : text).replace(/ /g, ' ').trim();
  if (/^no\s+views?\b/i.test(s)) return 0;
  const m = /(\d[\d,]*(?:\.\d+)?)\s*([KMB])?(?![\p{L}\d])/iu.exec(s);
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * mult) : null;
}

// "3 weeks ago", "10d ago", "2y ago", "Streamed 5 hours ago"  ->  { lo, hi, label } in days (the real age is lo <= age < hi)
function parseAge(text) {
  const m = /(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|mos?|years?|yrs?|[smhdwy])\s+ago/i.exec(String(text || ''));
  if (!m) return null;
  const n = +m[1], u = m[2].toLowerCase();
  let per;
  if (/^(s|sec)/.test(u)) per = 1 / 86400;
  else if (/^(min|minute)/.test(u) || u === 'm') per = 1 / 1440;
  else if (/^(h|hr)/.test(u)) per = 1 / 24;
  else if (/^d/.test(u)) per = 1;
  else if (/^w/.test(u)) per = 7;
  else if (/^(mo|month)/.test(u)) per = 30;
  else per = 365;
  return { lo: n * per, hi: (n + 1) * per, label: `${n}${u}` };
}

// "33:58" or "1:02:03" -> seconds
function parseDuration(text) {
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
  if (!m) return null;
  return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]);
}
// ISO 8601 "PT1M4S"
function parseIsoDuration(text) {
  const m = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)$/.exec(String(text || ''));
  return m ? (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) : null;
}

// TikTok video ids are snowflakes: the top bits are the upload time in seconds
function tiktokTime(id) {
  try {
    const t = Number(BigInt(String(id)) >> 32n) * 1000;
    return t > Date.UTC(2016, 0, 1) && t < Date.now() + DAY ? t : null;
  } catch (_) { return null; }
}

// posts (newest first) that only have a rough age label get dates: runs with the same label are spread evenly
// over that label's range, then the order is forced to stay newest -> oldest.
function ageToDates(posts, now = Date.now()) {
  let i = 0;
  while (i < posts.length) {
    const a = posts[i].age;
    if (!a || posts[i].t != null) { i++; continue; }
    let j = i;
    while (j < posts.length && posts[j].age && posts[j].age.label === a.label && posts[j].t == null) j++;
    const k = j - i;
    for (let x = 0; x < k; x++) posts[i + x].daysAgo = a.lo + (a.hi - a.lo) * ((x + 0.5) / k);
    i = j;
  }
  let prev = 0;
  for (const p of posts) {
    if (p.daysAgo == null) continue;
    p.daysAgo = Math.max(p.daysAgo, prev);
    prev = p.daysAgo;
    p.t = Math.round(now - p.daysAgo * DAY);
    p.exact = false;
  }
  return posts;
}

// posts (newest first) where only some have a real date (anchors): the others are placed by position between anchors
function fillByIndex(posts) {
  const all = posts.map((p, i) => (p.t != null ? i : -1)).filter((i) => i >= 0);
  if (!all.length) return posts;
  // keep the longest newest -> oldest run of real dates (a pinned old post at the top must not drag the rest)
  const L = all.map(() => 1), from = all.map(() => -1);
  for (let a = 0; a < all.length; a++) for (let b = 0; b < a; b++) if (posts[all[b]].t >= posts[all[a]].t && L[b] + 1 > L[a]) { L[a] = L[b] + 1; from[a] = b; }
  let at = L.indexOf(Math.max(...L));
  const keep = new Set();
  while (at >= 0) { keep.add(all[at]); at = from[at]; }
  for (const i of all) if (!keep.has(i)) { posts[i].t = null; posts[i].exact = false; }
  const known = [...keep].sort((a, b) => a - b);
  const out = posts.map((p) => p.t);
  for (let i = 0; i < posts.length; i++) {
    if (posts[i].t != null) continue;
    const before = known.filter((k) => k < i).pop();
    const after = known.find((k) => k > i);
    if (before == null) out[i] = posts[after].t;
    else if (after == null) out[i] = posts[before].t;
    else out[i] = Math.round(posts[before].t + (posts[after].t - posts[before].t) * ((i - before) / (after - before)));
  }
  let prev = Infinity;
  posts.forEach((p, i) => {
    out[i] = Math.min(out[i], prev);
    prev = out[i];
    if (p.t == null) { p.t = out[i]; p.exact = false; }
  });
  return posts;
}

function pickAnchors(n, count) {
  if (n <= count) return [...Array(n).keys()];
  const s = new Set();
  for (let i = 0; i < count; i++) s.add(Math.round((i * (n - 1)) / (count - 1)));
  return [...s];
}

// ---------------------------------------------------------------- viral scoring
// typical views of a post = the middle value of up to 20 posts of the same kind posted around the same time (not counting the post itself)
function annotate(rawPosts, { factor = 3, minPosts = 8, window = 10 } = {}) {
  const posts = rawPosts.filter((p) => Number.isFinite(p.views)).map((p) => ({ ...p }));
  const kinds = [...new Set(posts.map((p) => p.kind || 'video'))];
  for (const kind of kinds) {
    const g = posts.filter((p) => (p.kind || 'video') === kind);
    const hasT = g.every((p) => p.t != null);
    const ord = hasT ? [...g].sort((a, b) => a.t - b.t) : g;
    const all = median(g.map((p) => p.views));
    ord.forEach((p, i) => {
      let others;
      if (g.length < minPosts) others = g.filter((x) => x !== p).map((x) => x.views);
      else if (hasT) others = ord.slice(Math.max(0, i - window), i).concat(ord.slice(i + 1, i + 1 + window)).map((x) => x.views);
      else others = g.filter((x) => x !== p).map((x) => x.views);
      p.typical = Math.max(median(others), 1);
      p.overall = all;
      p.score = +(p.views / p.typical).toFixed(2);
      p.viral = g.length >= minPosts && p.score >= factor;
    });
  }
  const ranked = [...posts].sort((a, b) => b.views - a.views);
  ranked.forEach((p, i) => { p.rank = i + 1; });
  return posts;
}

function summarize(posts, now = Date.now()) {
  const withT = posts.filter((p) => p.t != null);
  const ts = withT.map((p) => p.t).sort((a, b) => a - b);
  const views = posts.map((p) => p.views);
  const viral = posts.filter((p) => p.viral);
  const recent = withT.filter((p) => p.t >= now - 90 * DAY);
  const best = [...posts].sort((a, b) => b.views - a.views)[0] || null;
  return {
    posts: posts.length,
    medianViews: Math.round(median(views)),
    meanViews: views.length ? Math.round(views.reduce((a, b) => a + b, 0) / views.length) : 0,
    maxViews: best ? best.views : 0,
    totalViews: views.reduce((a, b) => a + b, 0),
    viral: viral.length,
    hitRate: posts.length ? +(viral.length / posts.length * 100).toFixed(1) : 0,
    firstAt: ts[0] || null, lastAt: ts[ts.length - 1] || null,
    postsPerWeekRecent: recent.length ? +(recent.length / (90 / 7)).toFixed(1) : 0,
    postsPerWeekAll: ts.length > 1 ? +(ts.length / Math.max((ts[ts.length - 1] - ts[0]) / (7 * DAY), 1)).toFixed(1) : 0,
    exactDates: withT.filter((p) => p.exact).length,
    bestUrl: best ? best.url : null
  };
}

function viralSets(posts, { recentDays = 90, now = Date.now() } = {}) {
  const v = posts.filter((p) => p.viral);
  const byViews = (a, b) => b.views - a.views;
  return {
    all: [...v].sort(byViews),
    recent: v.filter((p) => p.t != null && p.t >= now - recentDays * DAY).sort(byViews),
    recentDays
  };
}

// ---------------------------------------------------------------- what viral posts have in common
const STOP = new Set('the a an and or of to in on for with is are was were be this that it you your my our i we they he she at as by from not but so if do does just can will have has had me more most what how why when about into out up all one new get got like very really also only then than them their there here which who been being https http www com'.split(' '));
const wordsOf = (t) => [...new Set(String(t || '').toLowerCase().normalize('NFC').split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)))];
const pct = (n, d) => (d ? Math.round(n / d * 100) : 0);
const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);

function patterns(posts) {
  const V = posts.filter((p) => p.viral), R = posts.filter((p) => !p.viral);
  const out = { viral: V.length, rest: R.length, compare: [], words: [], weekday: null, hours: null, duration: null };
  if (V.length < 2 || R.length < 2) return out;
  const feat = (list) => ({
    titleLen: avg(list.map((p) => (p.title || '').length)),
    number: pct(list.filter((p) => /\d/.test(p.title || '')).length, list.length),
    question: pct(list.filter((p) => /\?/.test(p.title || '')).length, list.length),
    caps: pct(list.filter((p) => /\b[A-Z]{3,}\b/.test(p.title || '')).length, list.length),
    hashtags: +(list.reduce((a, p) => a + ((p.title || '').match(/#[\p{L}\p{N}_]+/gu) || []).length, 0) / list.length).toFixed(1),
    durationSec: avg(list.map((p) => p.durationSec).filter(Boolean)),
    shorts: pct(list.filter((p) => p.kind === 'short').length, list.length)
  });
  const fv = feat(V), fr = feat(R);
  out.compare = [
    ['Title length (characters)', fv.titleLen, fr.titleLen],
    ['Titles with a number (%)', fv.number, fr.number],
    ['Titles with a question (%)', fv.question, fr.question],
    ['Titles with ALL CAPS words (%)', fv.caps, fr.caps],
    ['Hashtags per title', fv.hashtags, fr.hashtags],
    ['Average length (seconds)', fv.durationSec, fr.durationSec],
    ['Shorts (%)', fv.shorts, fr.shorts]
  ].filter((r) => r[1] || r[2]);
  // words that show up much more in viral titles than in the rest
  const cV = new Map(), cR = new Map();
  for (const p of V) for (const w of wordsOf(p.title)) cV.set(w, (cV.get(w) || 0) + 1);
  for (const p of R) for (const w of wordsOf(p.title)) cR.set(w, (cR.get(w) || 0) + 1);
  const minV = V.length >= 5 ? 2 : 2;
  out.words = [...cV].filter(([, n]) => n >= minV).map(([w, n]) => {
    const r = cR.get(w) || 0;
    return { word: w, viral: n, rest: r, lift: +(((n / V.length) / ((r + 1) / (R.length + 2))).toFixed(1)) };
  }).filter((x) => x.lift >= 1.5).sort((a, b) => b.lift * Math.log2(b.viral + 1) - a.lift * Math.log2(a.viral + 1)).slice(0, 14);
  // timing only from exact dates (rough dates have no time of day)
  const ex = posts.filter((p) => p.exact && p.t != null);
  if (ex.length >= 12) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const mk = (keyOf, keys) => keys.map((k) => {
      const g = ex.filter((p) => keyOf(p) === k);
      return { key: k, n: g.length, medianScore: g.length ? +median(g.map((p) => p.score)).toFixed(2) : 0, viralShare: pct(g.filter((p) => p.viral).length, g.length) };
    });
    out.weekday = mk((p) => days[new Date(p.t).getDay()], days);
    const blocks = ['00-04', '04-08', '08-12', '12-16', '16-20', '20-24'];
    out.hours = mk((p) => blocks[Math.floor(new Date(p.t).getHours() / 4)], blocks);
    out.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
  const withDur = posts.filter((p) => p.durationSec);
  if (withDur.length >= 10) {
    const edges = [[0, 30, 'under 30 s'], [30, 60, '30-60 s'], [60, 180, '1-3 min'], [180, 600, '3-10 min'], [600, 1200, '10-20 min'], [1200, 1e9, 'over 20 min']];
    out.duration = edges.map(([lo, hi, label]) => {
      const g = withDur.filter((p) => p.durationSec >= lo && p.durationSec < hi);
      return { label, n: g.length, medianScore: g.length ? +median(g.map((p) => p.score)).toFixed(2) : 0, viralShare: pct(g.filter((p) => p.viral).length, g.length) };
    }).filter((b) => b.n >= 2);
  }
  return out;
}

// ---------------------------------------------------------------- the full journey
const monthKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

function journey(posts, { factor = 3 } = {}) {
  const dated = posts.filter((p) => p.t != null && Number.isFinite(p.views)).sort((a, b) => a.t - b.t);
  if (dated.length < 10) return { ok: false, reason: `Only ${dated.length} posts with a date were read (at least 10 are needed).` };
  const n = dated.length;
  // months, including empty ones so gaps show
  const by = new Map();
  for (const p of dated) { const k = monthKey(p.t); if (!by.has(k)) by.set(k, []); by.get(k).push(p); }
  const months = [];
  const first = new Date(dated[0].t), last = new Date(dated[n - 1].t);
  for (let y = first.getFullYear(), m = first.getMonth(); y < last.getFullYear() || (y === last.getFullYear() && m <= last.getMonth());) {
    const k = `${y}-${String(m + 1).padStart(2, '0')}`;
    const g = by.get(k) || [];
    months.push({ month: k, posts: g.length, medianViews: Math.round(median(g.map((p) => p.views))), totalViews: g.reduce((a, p) => a + p.views, 0), maxViews: g.reduce((a, p) => Math.max(a, p.views), 0), viral: g.filter((p) => p.viral).length });
    if (++m > 11) { m = 0; y++; }
  }
  // cumulative views
  let cum = 0;
  const cumulative = dated.map((p) => ({ t: p.t, cum: (cum += p.views) }));
  // game changers: a viral post after which the typical views of the next K posts are far higher than before it
  const K = Math.max(4, Math.min(8, Math.round(n / 12)));
  const cands = [];
  dated.forEach((p, i) => {
    if (!p.viral) return;
    const after = dated.slice(i + 1, i + 1 + K).map((x) => x.views);
    if (after.length < 3) return;
    const beforeArr = dated.slice(Math.max(0, i - K), i).map((x) => x.views);
    const medBefore = beforeArr.length >= 3 ? median(beforeArr) : null;
    if (medBefore == null) return;
    const medAfter = median(after);
    const lift = medAfter / Math.max(medBefore, 1);
    cands.push({ i, p, medBefore: Math.round(medBefore), medAfter: Math.round(medAfter), lift: +lift.toFixed(2) });
  });
  const strong = cands.filter((c) => c.lift >= 1.8).sort((a, b) => b.lift - a.lift);
  const gameChangers = [];
  for (const c of strong) {
    if (gameChangers.every((g) => Math.abs(g.i - c.i) >= K)) gameChangers.push(c);
    if (gameChangers.length >= 3) break;
  }
  gameChangers.sort((a, b) => a.p.t - b.p.t);
  const gc = gameChangers.map((c, k) => ({ n: k + 1, url: c.p.url, title: c.p.title, t: c.p.t, exact: !!c.p.exact, views: c.p.views, score: c.p.score, medBefore: c.medBefore, medAfter: c.medAfter, lift: c.lift }));
  const firstViral = dated.find((p) => p.viral) || null;
  const peak = [...dated].sort((a, b) => b.views - a.views)[0];
  const takeoff = gc[0] ? { kind: 'game changer', t: gc[0].t, url: gc[0].url, title: gc[0].title } : (firstViral ? { kind: 'first viral post', t: firstViral.t, url: firstViral.url, title: firstViral.title } : null);
  // phases split at the game changers
  const cuts = [dated[0].t, ...gc.map((g) => g.t), dated[n - 1].t + 1];
  const phases = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const g = dated.filter((p) => p.t >= cuts[k] && (k === cuts.length - 2 ? true : p.t < cuts[k + 1]));
    if (!g.length) continue;
    const span = Math.max((g[g.length - 1].t - g[0].t) / (7 * DAY), 1);
    const best = [...g].sort((a, b) => b.views - a.views)[0];
    phases.push({ name: k === 0 ? 'Start' : `After game changer ${k}`, from: g[0].t, to: g[g.length - 1].t, posts: g.length, medianViews: Math.round(median(g.map((p) => p.views))), perWeek: +(g.length / span).toFixed(1), viral: g.filter((p) => p.viral).length, best: { title: best.title, views: best.views, url: best.url } });
  }
  const third = Math.max(3, Math.floor(n / 3));
  const early = median(dated.slice(0, third).map((p) => p.views)), late = median(dated.slice(-third).map((p) => p.views));
  const ageMonths = Math.max(1, Math.round((dated[n - 1].t - dated[0].t) / (30.4 * DAY)));
  const gaps = [];
  for (let i = 1; i < n; i++) { const d = (dated[i].t - dated[i - 1].t) / DAY; if (d > 60) gaps.push({ from: dated[i - 1].t, to: dated[i].t, days: Math.round(d) }); }
  return {
    ok: true, posts: n, ageMonths,
    start: { t: dated[0].t, exact: !!dated[0].exact, title: dated[0].title, views: dated[0].views, url: dated[0].url },
    firstViral: firstViral ? { t: firstViral.t, title: firstViral.title, views: firstViral.views, url: firstViral.url, score: firstViral.score, postNumber: dated.indexOf(firstViral) + 1 } : null,
    takeoff, peak: { t: peak.t, title: peak.title, views: peak.views, url: peak.url, score: peak.score },
    gameChangers: gc, candidates: cands.length, K, phases, months, cumulative, gaps: gaps.slice(0, 6),
    growthX: +(late / Math.max(early, 1)).toFixed(2), earlyMedian: Math.round(early), lateMedian: Math.round(late), factor
  };
}

// everything the screens need, from raw posts
function analyzeAll(rawPosts, opts = {}) {
  const { factor = 3, recentDays = 90, now = Date.now() } = opts;
  const posts = annotate(rawPosts, { factor });
  const sets = viralSets(posts, { recentDays, now });
  // the journey is told per kind (long videos and shorts have very different views); the main one is the kind with more posts
  const kinds = [...new Set(posts.map((p) => p.kind || 'video'))].sort((a, b) => posts.filter((p) => (p.kind || 'video') === b).length - posts.filter((p) => (p.kind || 'video') === a).length);
  const journeys = {};
  for (const k of kinds) journeys[k] = { ...journey(posts.filter((p) => (p.kind || 'video') === k), { factor }), kind: k };
  const main = kinds.find((k) => journeys[k].ok) || kinds[0];
  return { factor, recentDays, posts, stats: summarize(posts, now), sets: { all: sets.all.map((p) => p.url), recent: sets.recent.map((p) => p.url) }, patterns: patterns(posts), journey: main ? journeys[main] : journey([], { factor }), journeys };
}

module.exports = { median, parseCount, parseAge, parseDuration, parseIsoDuration, tiktokTime, ageToDates, fillByIndex, pickAnchors, annotate, summarize, viralSets, patterns, journey, analyzeAll, wordsOf };
