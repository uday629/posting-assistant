// Best time to post. Pure function: suggest(channelService, history) ranks posting hours.
//   history: the post-history.json list (jobs.history()): {targetKey, at, dueAt, status, target, ...}
//   Returns {service, basis: 'your history' | 'default', sample, hours:[{hour, time, score}], days:[{day, name}], times:['19:00',...], note}
// Honesty: the history has no likes or views, so "your history" means the hours you scheduled most often
// (posts that went through), not measured engagement. With fewer than MIN_POSTS usable posts the defaults are used.
const MIN_POSTS = 6;

// Documented defaults (local time of the person posting). General guidance from widely published social media
// timing studies: evenings and lunch for short video, working hours for LinkedIn. Not measured for this account.
const DEFAULT_HOURS = {
  instagram: [19, 12, 21],
  tiktok: [20, 12, 22],
  youtube: [17, 20, 12],
  facebook: [13, 9, 19],
  linkedin: [8, 12, 17],
  twitter: [9, 12, 18],
  threads: [12, 18, 20],
  pinterest: [20, 21, 14],
  bluesky: [9, 12, 18],
  generic: [12, 18, 20]
};
const DEFAULT_DAYS = { linkedin: [2, 3, 4], youtube: [4, 5, 6], generic: [3, 5, 6] }; // 0 = Sunday
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function normalize(service) {
  const s = String(service || '').toLowerCase();
  if (/youtube/.test(s)) return 'youtube';
  if (/insta/.test(s)) return 'instagram';
  if (/tiktok|tik tok/.test(s)) return 'tiktok';
  if (/facebook|meta/.test(s)) return 'facebook';
  if (/linkedin/.test(s)) return 'linkedin';
  if (/twitter|^x$|x\.com/.test(s)) return 'twitter';
  if (/threads/.test(s)) return 'threads';
  if (/bluesky|bsky/.test(s)) return 'bluesky';
  if (/pinterest/.test(s)) return 'pinterest';
  return 'generic';
}
// the history entry has no service field: it is in the target label, e.g. "My channel (Acct, instagram)"
function entryService(h) {
  if (h.service) return normalize(h.service);
  const m = /,\s*([a-z ]+?)(?:,|\))/i.exec(String(h.target || ''));
  if (m) return normalize(m[1]);
  return normalize(`${h.target || ''} ${h.targetKey || ''}`);
}
const fmt = (hr) => `${String(hr).padStart(2, '0')}:00`;

function suggest(channelService, history) {
  const svc = normalize(channelService);
  const list = Array.isArray(history) ? history : [];
  const hourScore = new Array(24).fill(0), dayScore = new Array(7).fill(0);
  let n = 0;
  for (const h of list) {
    if (!h || h.status !== 'done') continue;
    if (svc !== 'generic' && entryService(h) !== svc) continue;
    // the time the post was set to go out; "now" and drafts have no slot, so use the moment it was posted
    const t = h.dueAt && !['now', 'draft'].includes(h.dueAt) ? new Date(h.dueAt) : h.dueAt === 'draft' ? null : new Date(h.at);
    if (!t || Number.isNaN(t.getTime())) continue;
    hourScore[t.getHours()] += 1;
    dayScore[t.getDay()] += 1;
    n++;
  }
  if (n < MIN_POSTS) {
    const hrs = DEFAULT_HOURS[svc] || DEFAULT_HOURS.generic;
    const days = DEFAULT_DAYS[svc] || DEFAULT_DAYS.generic;
    return {
      service: svc, basis: 'default', sample: n,
      hours: hrs.map((hour, i) => ({ hour, time: fmt(hour), score: hrs.length - i })),
      days: days.map((day) => ({ day, name: DAY_NAMES[day] })),
      times: hrs.map(fmt),
      note: `Default suggestion for ${svc}: general guidance from public social media studies, not measured for your account. Only ${n} usable ${svc} post${n === 1 ? '' : 's'} in your history (need ${MIN_POSTS}).`
    };
  }
  const hours = hourScore.map((score, hour) => ({ hour, time: fmt(hour), score })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.hour - b.hour).slice(0, 3);
  const days = dayScore.map((score, day) => ({ day, name: DAY_NAMES[day], score })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.day - b.day).slice(0, 3);
  return {
    service: svc, basis: 'your history', sample: n, hours, days,
    times: hours.map((x) => x.time),
    note: `Based on ${n} of your ${svc} posts: the hours you posted most often. It does not include likes or views, so it shows your habit, not proven best results.`
  };
}

module.exports = { suggest, DEFAULT_HOURS, MIN_POSTS };
