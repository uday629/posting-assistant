/* Posting Assistant - renderer: viral posts, journey and one-post study (inside Competitor study). */
'use strict';
/* global pa, h, $, call, toast, modal, closeModal, confirmBox, sel, seg, md, icon, S, RENDER, studySel:writable, drawStudy:writable */

const NS = 'http://www.w3.org/2000/svg';
function sv(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, v);
  for (const kid of kids.flat(3)) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
}
const fmtN = (n) => (n >= 1e9 ? `${+(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : String(Math.round(n)));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = (t, exact) => {
  if (t == null) return 'unknown date';
  const d = new Date(t);
  return exact ? `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` : `~${MON[d.getMonth()]} ${d.getFullYear()}`;
};
const monthLabel = (k) => { const [y, m] = k.split('-'); return `${MON[+m - 1]} ${y.slice(2)}`; };
const openLink = (url) => { if (/^https:\/\//.test(url)) call('shell.external', url); };

/* ---------------------------------------------------------------- charts */
function emptyChart(text) { return h('div', { class: 'dim small', style: { padding: '10px 0' }, text }); }

// every post on a log scale: viral posts big and orange, game changers numbered, take-off as a dashed line
function scatterChart(posts, { marks = [], takeoff = null, w = 900, hgt = 300 } = {}) {
  const pts = posts.filter((p) => p.t != null && p.views > 0);
  if (pts.length < 3) return emptyChart('Not enough dated posts for this chart.');
  const m = { l: 54, r: 14, t: 12, b: 28 };
  const t0 = Math.min(...pts.map((p) => p.t));
  const t1 = Math.max(Math.max(...pts.map((p) => p.t)), t0 + 86400000);
  const lv = pts.map((p) => Math.log10(p.views));
  const lo = Math.floor(Math.min(...lv));
  const hi = Math.max(Math.ceil(Math.max(...lv)), lo + 1);
  const X = (t) => m.l + ((t - t0) / (t1 - t0)) * (w - m.l - m.r);
  const Y = (v) => m.t + (1 - (Math.log10(Math.max(v, 1)) - lo) / (hi - lo)) * (hgt - m.t - m.b);
  const svg = sv('svg', { viewBox: `0 0 ${w} ${hgt}`, class: 'vchart', role: 'img', 'aria-label': 'Views of every post over time' });
  for (let e = lo; e <= hi; e++) {
    svg.append(sv('line', { x1: m.l, x2: w - m.r, y1: Y(10 ** e), y2: Y(10 ** e), class: 'vgrid' }), sv('text', { x: m.l - 6, y: Y(10 ** e) + 4, class: 'vax', 'text-anchor': 'end' }, fmtN(10 ** e)));
  }
  for (let i = 0; i <= 5; i++) {
    const t = t0 + ((t1 - t0) * i) / 5, d = new Date(t);
    svg.append(sv('text', { x: X(t), y: hgt - 8, class: 'vax', 'text-anchor': i === 0 ? 'start' : i === 5 ? 'end' : 'middle' }, `${MON[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`));
  }
  if (takeoff?.t != null && takeoff.t >= t0 && takeoff.t <= t1) {
    svg.append(sv('line', { x1: X(takeoff.t), x2: X(takeoff.t), y1: m.t, y2: hgt - m.b, class: 'vtake' }), sv('text', { x: X(takeoff.t) + 4, y: m.t + 10, class: 'vax vtakel' }, 'take-off'));
  }
  const dot = (p) => {
    const c = sv('circle', { cx: X(p.t), cy: Y(p.views), r: p.viral ? 5 : 3, class: p.viral ? 'vdot vir' : 'vdot' }, sv('title', {}, `${p.title}\n${fmtN(p.views)} views, ${p.score}x typical\n${fmtD(p.t, p.exact)}`));
    c.style.cursor = 'pointer';
    c.addEventListener('click', () => openLink(p.url));
    return c;
  };
  pts.filter((p) => !p.viral).forEach((p) => svg.append(dot(p)));
  pts.filter((p) => p.viral).forEach((p) => svg.append(dot(p)));
  marks.forEach((g) => {
    if (g.t == null) return;
    svg.append(sv('circle', { cx: X(g.t), cy: Y(g.views), r: 11, class: 'vgc' }), sv('text', { x: X(g.t), y: Y(g.views) + 4, class: 'vgcn', 'text-anchor': 'middle' }, g.n));
  });
  return svg;
}

function barChart(items, { w = 900, hgt = 150, color = 'vbar', fmt = (n) => String(n), labelEvery = 1 } = {}) {
  if (!items.length) return emptyChart('No data.');
  const m = { l: 40, r: 10, t: 10, b: 24 };
  const max = Math.max(...items.map((i) => i.v), 1);
  const bw = (w - m.l - m.r) / items.length;
  const svg = sv('svg', { viewBox: `0 0 ${w} ${hgt}`, class: 'vchart', role: 'img' });
  svg.append(sv('line', { x1: m.l, x2: w - m.r, y1: hgt - m.b, y2: hgt - m.b, class: 'vgrid' }), sv('text', { x: m.l - 6, y: m.t + 8, class: 'vax', 'text-anchor': 'end' }, fmt(max)), sv('text', { x: m.l - 6, y: hgt - m.b, class: 'vax', 'text-anchor': 'end' }, '0'));
  items.forEach((it, i) => {
    const bh = ((hgt - m.t - m.b) * it.v) / max;
    svg.append(sv('rect', { x: m.l + i * bw + bw * 0.12, y: hgt - m.b - bh, width: Math.max(bw * 0.76, 1), height: bh, class: color }, sv('title', {}, `${it.label}: ${fmt(it.v)}`)));
    if (i % labelEvery === 0) svg.append(sv('text', { x: m.l + i * bw + bw / 2, y: hgt - 8, class: 'vax', 'text-anchor': 'middle' }, it.label));
  });
  return svg;
}

function lineChart(items, { w = 900, hgt = 170, fmt = fmtN, area = false, labelEvery = 1 } = {}) {
  if (items.length < 2) return emptyChart('Not enough data.');
  const m = { l: 52, r: 14, t: 12, b: 24 };
  const max = Math.max(...items.map((i) => i.v), 1);
  const X = (i) => m.l + (i / (items.length - 1)) * (w - m.l - m.r);
  const Y = (v) => m.t + (1 - v / max) * (hgt - m.t - m.b);
  const svg = sv('svg', { viewBox: `0 0 ${w} ${hgt}`, class: 'vchart', role: 'img' });
  svg.append(sv('line', { x1: m.l, x2: w - m.r, y1: hgt - m.b, y2: hgt - m.b, class: 'vgrid' }), sv('text', { x: m.l - 6, y: m.t + 8, class: 'vax', 'text-anchor': 'end' }, fmt(max)), sv('text', { x: m.l - 6, y: hgt - m.b, class: 'vax', 'text-anchor': 'end' }, '0'));
  const pts = items.map((it, i) => `${X(i).toFixed(1)},${Y(it.v).toFixed(1)}`);
  if (area) svg.append(sv('polygon', { points: `${X(0)},${hgt - m.b} ${pts.join(' ')} ${X(items.length - 1)},${hgt - m.b}`, class: 'varea' }));
  svg.append(sv('polyline', { points: pts.join(' '), class: 'vline' }));
  items.forEach((it, i) => {
    if (items.length <= 60) svg.append(sv('circle', { cx: X(i), cy: Y(it.v), r: 2.5, class: 'vlinedot' }, sv('title', {}, `${it.label}: ${fmt(it.v)}`)));
    if (it.label && i % labelEvery === 0) svg.append(sv('text', { x: X(i), y: hgt - 8, class: 'vax', 'text-anchor': i === 0 ? 'start' : i === items.length - 1 ? 'end' : 'middle' }, it.label));
  });
  return svg;
}

// horizontal bars for weekday / hour / length (each with how many posts it is based on)
function hbars(rows, valueOf, unit) {
  const max = Math.max(...rows.map(valueOf), 0.0001);
  return h('div', { class: 'hbars' }, ...rows.map((r) => h('div', { class: 'hb' },
    h('span', { class: 'hbl', text: r.key || r.label }),
    h('span', { class: 'hbt' }, h('span', { class: 'hbf', style: { width: `${Math.round((valueOf(r) / max) * 100)}%` } })),
    h('span', { class: 'hbv small dim', text: `${valueOf(r)}${unit} · ${r.n} posts` }))));
}

/* ---------------------------------------------------------------- start card */
let vMode = 'viral';
function injectViralCard() {
  const left = $('#view-study .left');
  if (!left || left.querySelector('#viralCard')) return;
  const urlIn = h('input', { type: 'text', style: { width: '100%' } });
  const content = sel([['videos', 'Long videos'], ['shorts', 'Shorts only'], ['both', 'Videos and Shorts']], 'videos');
  const maxIn = h('input', { type: 'number', min: 20, max: 500, value: 120, style: { width: '80px' } });
  const level = sel([['2', 'Viral = 2x typical'], ['3', 'Viral = 3x typical'], ['5', 'Viral = 5x typical'], ['10', 'Viral = 10x typical']], '3');
  const viewWith = sel([['', 'View with: default browser']], '');
  call('accounts.list', null, { quiet: true }).then((a) => { for (const x of (a || []).filter((y) => !['chatgpt', 'gemini', 'claude'].includes(y.kind))) viewWith.append(h('option', { value: x.id }, `View with: ${x.name}`)); }).catch(() => {});
  const opts = h('div', { class: 'col', style: { gap: '8px' } });
  const hint = h('div', { class: 'dim small' });
  const go1 = h('button', { class: 'btn p', onclick: (e) => start(e.target) }, 'Start');
  const modes = h('div');
  function setMode(m) {
    vMode = m;
    modes.replaceChildren(seg([['viral', 'Viral posts'], ['journey', 'Full journey'], ['post', 'One post']], vMode, setMode));
    urlIn.placeholder = m === 'post' ? 'Link of one video (YouTube or TikTok)' : 'Channel or profile link (YouTube, TikTok, Instagram)';
    maxIn.value = m === 'journey' ? 300 : 120;
    opts.replaceChildren(...(m === 'post' ? [viewWith] : [h('div', { class: 'row small' }, content, 'Posts', maxIn), level, viewWith]));
    hint.textContent = m === 'viral' ? 'Finds posts with far more views than usual for that channel (recent and all time), and why they worked.'
      : m === 'journey' ? 'Reads the whole channel: when it started, when views took off, which videos were game changers. Reads more posts, so it takes longer.'
        : 'Breaks down one video: hook, topic, structure, why it spread, and how unusual it is for that channel.';
  }
  async function start(btn) {
    const url = urlIn.value.trim();
    if (!/^https:\/\//.test(url)) { toast('Paste a full link (https://...)', 'warn'); return; }
    btn.disabled = true;
    const right = $('#studyRight');
    right.replaceChildren(h('div', { class: 'col' }, h('div', { class: 'dim', id: 'studyStep', text: 'Starting...' }), h('div', { class: 'liveframe', id: 'studyFrame', style: { maxWidth: '760px' } }, 'The page shows here while it is read.')));
    try {
      const r = await call('viral.run', { url, mode: vMode, content: content.value, max: Number(maxIn.value), factor: Number(level.value), accountId: viewWith.value || undefined });
      studySel = r.id;
      RENDER.study();
    } catch (err) { right.replaceChildren(h('div', { class: 'fi err', text: err.message })); }
    btn.disabled = false;
  }
  const card = h('div', { class: 'card col', id: 'viralCard' }, h('b', { text: 'Viral posts and journey' }), modes, urlIn, opts, hint, go1);
  setMode(vMode);
  const first = left.querySelector('.card');
  if (first) first.after(card); else left.prepend(card);
}

/* ---------------------------------------------------------------- the result */
let vTab = 'viral', vScope = 'recent', vKind = null, vLast = null;

function drawViral(s) {
  const r = $('#studyRight');
  const st = s.stats || {};
  const reload = async () => { const f = await call('study.get', s.id); drawViral(f); };
  if (vLast !== s.id) { // a different study was opened: start on the tab that fits it
    vLast = s.id; vKind = null;
    vTab = s.mode === 'journey' ? 'journey' : 'viral';
    vScope = s.sets.recent.length || !s.sets.all.length ? 'recent' : 'all';
    const u = s.mode === 'post' ? Object.keys(s.breakdowns || {})[0] : null;
    const focus = u ? s.posts.find((p) => p.url === u) : null;
    if (focus) setTimeout(() => studyOne(s, focus, h('button'), reload), 50);
  }
  const kinds = Object.keys(s.journeys || {});
  if (!vKind || !kinds.includes(vKind)) vKind = (s.journey && s.journey.kind) || kinds[0];
  const tabs = [['viral', 'Viral posts'], ['journey', 'Journey'], ['patterns', 'What they share'], ['ideas', 'Ideas']];
  const body = h('div', { class: 'col', style: { gap: '12px' } });
  const draw = () => {
    body.replaceChildren(vTab === 'viral' ? viralTab(s, reload) : vTab === 'journey' ? journeyTab(s, reload) : vTab === 'patterns' ? patternsTab(s, reload) : ideasTab(s, reload));
    tabBar.replaceChildren(seg(tabs, vTab, (t) => { vTab = t; draw(); }));
  };
  const tabBar = h('div');
  r.replaceChildren(h('div', { class: 'col', style: { maxWidth: '1000px', gap: '12px' } },
    h('div', { class: 'row' }, h('h2', { style: { margin: 0, flex: 1 }, text: s.title }),
      h('button', { class: 'btn', onclick: async (e) => {
        const b = e.target; b.disabled = true; b.textContent = 'Making skill...';
        try {
          if (!s.report) await call('viral.report', { id: s.id, which: 'viral' });
          const k = await call('study.toSkill', s.id);
          toast(`Skill "${k.name}" saved and turned on (Library > Skills).`, 'ok', 7000);
        } catch (err) { toast(err.message, 'warn', 8000); }
        b.disabled = false; b.textContent = 'Make a skill';
      } }, 'Make a skill'),
      h('button', { class: 'btn ghost', onclick: async () => { if (await confirmBox('Delete this study?', '', 'Delete', true)) { await call('study.remove', s.id); studySel = null; RENDER.study(); } } }, icon('trash', 15))),
    h('div', { class: 'dim small', text: `${s.url} · ${new Date(s.createdAt).toLocaleDateString()} · ${s.platform}${s.profile?.subscribers ? ` · ${fmtN(s.profile.subscribers)} followers` : ''}` }),
    h('div', { class: 'stats', style: { gridTemplateColumns: 'repeat(5,1fr)' } },
      h('div', { class: 'stat' }, h('b', { text: String(st.posts ?? '-') }), h('span', { text: 'posts read' })),
      h('div', { class: 'stat' }, h('b', { text: fmtN(st.medianViews || 0) }), h('span', { text: 'typical views' })),
      h('div', { class: 'stat' }, h('b', { text: `${st.viral ?? 0}` }), h('span', { text: `viral (${st.hitRate ?? 0}% of posts)` })),
      h('div', { class: 'stat' }, h('b', { text: fmtN(st.maxViews || 0) }), h('span', { text: 'best post' })),
      h('div', { class: 'stat' }, h('b', { text: String(st.postsPerWeekRecent ?? 0) }), h('span', { text: 'posts per week (90 days)' }))),
    tabBar, body));
  draw();
}

function postRow(p, s, reload) {
  return h('div', { class: 'vrow' },
    h('span', { class: 'vrank', text: `#${p.rank}` }),
    h('div', { class: 'vmain' },
      h('a', { href: '#', class: 'vtitle', onclick: (e) => { e.preventDefault(); openLink(p.url); }, text: p.title || p.url }),
      h('div', { class: 'row small dim', style: { gap: '6px', flexWrap: 'wrap' } },
        h('span', { class: 'tag', text: `${fmtN(p.views)} views` }),
        h('span', { class: `tag ${p.viral ? 'fits' : ''}`, text: `${p.score}x typical (${fmtN(p.typical)})` }),
        h('span', { class: 'tag', text: fmtD(p.t, p.exact) }),
        h('span', { class: 'tag', text: p.kind === 'short' ? 'short' : 'video' }),
        p.durationSec ? h('span', { class: 'tag', text: `${Math.floor(p.durationSec / 60)}:${String(Math.round(p.durationSec % 60)).padStart(2, '0')}` }) : null,
        p.likes != null ? h('span', { class: 'tag', text: `${fmtN(p.likes)} likes` }) : null)),
    h('button', { class: 'btn s', onclick: (e) => studyOne(s, p, e.target, reload) }, s.breakdowns?.[p.url] ? 'Open breakdown' : 'Study this post'));
}

async function studyOne(s, p, btn, reload) {
  const cached = s.breakdowns?.[p.url];
  const show = (text) => modal([h('h2', { text: p.title || 'Post' }), h('div', { class: 'dim small', text: `${fmtN(p.views)} views, ${p.score}x typical, ${fmtD(p.t, p.exact)}` }), h('div', { class: 'card report', style: { marginTop: '10px' } }, md(text)),
    h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn', onclick: () => openLink(p.url) }, 'Open the post'), h('button', { class: 'btn', onclick: async () => { closeModal(); const b = await run(); void b; } }, 'Run again'), h('button', { class: 'btn p', onclick: closeModal }, 'Close'))], { wide: true });
  async function run() {
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = 'Reading the post and thinking...';
    try {
      const r = await call('viral.post', { id: s.id, url: p.url });
      await reload();
      show(r.text);
    } catch (err) { toast(err.message, 'warn', 8000); btn.disabled = false; btn.textContent = orig; }
  }
  if (cached) show(cached.text); else await run();
}

function aiBox(s, which, reload, label) {
  const text = which === 'journey' ? s.journeyReport : s.report;
  const box = h('div', { class: 'col', style: { gap: '8px' } });
  const btn = h('button', { class: 'btn p', onclick: async (e) => {
    const b = e.target; b.disabled = true; b.textContent = 'Writing... this can take a minute';
    try { await call('viral.report', { id: s.id, which, kind: vKind }); await reload(); } catch (err) { b.disabled = false; b.textContent = label; box.prepend(h('div', { class: 'fi err', text: err.message })); }
  } }, text ? `${label} (again)` : label);
  box.append(h('div', { class: 'row' }, btn, h('span', { class: 'dim small', text: 'The numbers above come from the app. The AI only explains them.' })));
  if (text) box.append(h('div', { class: 'card report' }, md(text)));
  return box;
}

function levelSelect(s, reload) {
  const vals = [2, 3, 5, 10];
  if (!vals.includes(s.factor)) vals.push(s.factor);
  return sel(vals.sort((a, b) => a - b).map((v) => [String(v), `${v}x typical`]), String(s.factor), async (v) => {
    try { await call('viral.regroup', { id: s.id, factor: Number(v), recentDays: s.recentDays }); await reload(); } catch (err) { toast(err.message, 'warn'); }
  });
}

function viralTab(s, reload) {
  const by = new Map((s.posts || []).map((p) => [p.url, p]));
  const urls = vScope === 'recent' ? s.sets.recent : s.sets.all;
  const list = urls.map((u) => by.get(u)).filter(Boolean);
  const days = sel([[30, 'last 30 days'], [60, 'last 60 days'], [90, 'last 90 days'], [180, 'last 6 months'], [365, 'last year']], s.recentDays, async (v) => {
    try { await call('viral.regroup', { id: s.id, factor: s.factor, recentDays: Number(v) }); await reload(); } catch (err) { toast(err.message, 'warn'); }
  });
  const dated = (s.posts || []).filter((p) => p.t != null).length;
  return h('div', { class: 'col', style: { gap: '12px' } },
    h('div', { class: 'card col' },
      h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '8px' } },
        seg([['recent', `Recent viral (${s.sets.recent.length})`], ['all', `All-time viral (${s.sets.all.length})`]], vScope, (v) => { vScope = v; reload(); }),
        vScope === 'recent' ? days : null, levelSelect(s, reload)),
      h('div', { class: 'dim small', text: `Viral means at least ${s.factor}x the typical views of the posts around it in time (the middle value of up to 20 neighbours, same kind). Every post is a dot below; orange dots are viral. Click a dot to open it.` }),
      dated >= 3 ? scatterChart(s.posts, {}) : emptyChart('Dates could not be read, so no chart.')),
    h('div', { class: 'card' }, h('h3', { text: vScope === 'recent' ? `Recent viral posts (last ${s.recentDays} days)` : 'All-time viral posts' }),
      list.length ? list.map((p) => postRow(p, s, reload)) : h('div', { class: 'dim small', text: vScope === 'recent' ? 'No viral post in this period. Try a longer period or a lower viral level.' : `No post reached ${s.factor}x typical views. Try a lower level (2x) or read more posts.` })),
    aiBox(s, 'viral', reload, 'Explain why they went viral'));
}

function milestone(title, big, small, url) {
  return h('div', { class: 'stat vm', style: { textAlign: 'left', cursor: url ? 'pointer' : 'default' }, onclick: url ? () => openLink(url) : null },
    h('span', { text: title }), h('b', { style: { fontSize: '16px' }, text: big }), h('span', { class: 'dim small', text: small }));
}

function journeyTab(s, reload) {
  const j = (s.journeys && s.journeys[vKind]) || s.journey;
  if (!j || !j.ok) return h('div', { class: 'card' }, h('div', { class: 'fi err', text: j?.reason || 'Not enough dated posts for a journey. Read more posts.' }));
  const posts = s.posts.filter((p) => (p.kind || 'video') === (j.kind || 'video'));
  const kinds = Object.keys(s.journeys || {}).filter((k) => s.journeys[k].ok);
  const every = Math.max(1, Math.ceil(j.months.length / 14));
  return h('div', { class: 'col', style: { gap: '12px' } },
    kinds.length > 1 ? h('div', { class: 'row' }, seg(kinds.map((k) => [k, k === 'short' ? 'Shorts' : 'Long videos']), j.kind, (k) => { vKind = k; reload(); })) : null,
    h('div', { class: 'stats', style: { gridTemplateColumns: 'repeat(4,1fr)' } },
      milestone('Started', fmtD(j.start.t, j.start.exact), `first post read: ${j.start.title.slice(0, 40)}`, j.start.url),
      milestone('First viral post', j.firstViral ? fmtD(j.firstViral.t, false) : 'none yet', j.firstViral ? `post number ${j.firstViral.postNumber}, ${fmtN(j.firstViral.views)} views` : `nothing reached ${s.factor}x`, j.firstViral?.url),
      milestone('Take-off', j.takeoff ? fmtD(j.takeoff.t, false) : 'not clear', j.takeoff ? `${j.takeoff.kind}: ${j.takeoff.title.slice(0, 40)}` : 'no sudden jump found', j.takeoff?.url),
      milestone('Growth', `${j.growthX}x`, `typical views ${fmtN(j.earlyMedian)} then, ${fmtN(j.lateMedian)} now`, null)),
    h('div', { class: 'card col' }, h('h3', { text: 'Every post, views on a log scale' }),
      h('div', { class: 'dim small', text: 'Orange = viral. Numbered rings = game changers. Dashed line = take-off. Dates marked ~ are estimates from labels like "2 years ago".' }),
      scatterChart(posts, { marks: j.gameChangers, takeoff: j.takeoff })),
    h('div', { class: 'card col' }, h('h3', { text: 'Posts per month' }), barChart(j.months.map((m) => ({ label: monthLabel(m.month), v: m.posts })), { labelEvery: every })),
    h('div', { class: 'card col' }, h('h3', { text: 'Typical views per month (middle value of that month)' }), lineChart(j.months.map((m) => ({ label: monthLabel(m.month), v: m.medianViews })), { labelEvery: every })),
    h('div', { class: 'card col' }, h('h3', { text: 'Total views over time' }),
      lineChart(sampleCum(j.cumulative), { area: true, labelEvery: 1 })),
    h('div', { class: 'card' }, h('h3', { text: 'Game changers' }),
      h('div', { class: 'dim small', style: { marginBottom: '6px' }, text: `A viral post after which the typical views of the next ${j.K} posts were at least 1.8x higher than before it.` }),
      j.gameChangers.length ? j.gameChangers.map((g) => h('div', { class: 'vrow' },
        h('span', { class: 'vrank', text: `#${g.n}` }),
        h('div', { class: 'vmain' }, h('a', { href: '#', class: 'vtitle', onclick: (e) => { e.preventDefault(); openLink(g.url); }, text: g.title }),
          h('div', { class: 'row small dim', style: { gap: '6px', flexWrap: 'wrap' } }, h('span', { class: 'tag', text: fmtD(g.t, g.exact) }), h('span', { class: 'tag', text: `${fmtN(g.views)} views` }), h('span', { class: 'tag fits', text: `next posts ${g.lift}x higher` }), h('span', { class: 'tag', text: `typical ${fmtN(g.medBefore)} then ${fmtN(g.medAfter)}` }))))) : h('div', { class: 'dim small', text: 'No single video clearly changed the channel. Growth looks gradual or the viral posts did not lift what came after.' })),
    h('div', { class: 'card' }, h('h3', { text: 'Phases' }),
      h('div', { class: 'vtable' },
        h('div', { class: 'vth' }, h('span', { text: 'Phase' }), h('span', { text: 'Period' }), h('span', { text: 'Posts' }), h('span', { text: 'Per week' }), h('span', { text: 'Typical views' }), h('span', { text: 'Viral' })),
        ...j.phases.map((p) => h('div', { class: 'vtr' }, h('span', { text: p.name }), h('span', { text: `${fmtD(p.from, false)} to ${fmtD(p.to, false)}` }), h('span', { text: String(p.posts) }), h('span', { text: String(p.perWeek) }), h('span', { text: fmtN(p.medianViews) }), h('span', { text: String(p.viral) })))),
      j.gaps.length ? h('div', { class: 'dim small', style: { marginTop: '8px' }, text: `Quiet periods: ${j.gaps.map((g) => `${g.days} days after ${fmtD(g.from, false)}`).join(', ')}` }) : null),
    aiBox(s, 'journey', reload, 'Tell the story of this channel'));
}
function sampleCum(c) {
  const n = Math.min(40, c.length);
  const out = [];
  for (let i = 0; i < n; i++) { const p = c[Math.round((i * (c.length - 1)) / Math.max(n - 1, 1))]; const d = new Date(p.t); out.push({ label: i % 8 === 0 || i === n - 1 ? `${MON[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` : '', v: p.cum }); }
  return out;
}

function patternsTab(s, reload) {
  const pt = s.patterns || {};
  if (!pt.compare || !pt.compare.length) return h('div', { class: 'card' }, h('div', { class: 'dim', text: `Not enough viral posts to compare (found ${pt.viral || 0}). Lower the viral level or read more posts.` }), levelSelect(s, reload));
  return h('div', { class: 'col', style: { gap: '12px' } },
    h('div', { class: 'card' }, h('h3', { text: `Viral posts (${pt.viral}) compared with the rest (${pt.rest})` }),
      h('div', { class: 'vtable' }, h('div', { class: 'vth three' }, h('span', { text: 'What' }), h('span', { text: 'Viral' }), h('span', { text: 'The rest' })),
        ...pt.compare.map(([k, a, b]) => h('div', { class: 'vtr three' }, h('span', { text: k }), h('span', { text: String(a) }), h('span', { text: String(b) }))))),
    pt.words?.length ? h('div', { class: 'card' }, h('h3', { text: 'Words that show up much more in viral titles' }), h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px' } }, ...pt.words.map((w) => h('span', { class: 'tag', title: `${w.viral} viral posts, ${w.rest} other posts`, text: `${w.word}  ${w.lift}x` })))) : null,
    pt.duration?.length ? h('div', { class: 'card' }, h('h3', { text: 'Length and how often it goes viral' }), hbars(pt.duration, (b) => b.viralShare, '% viral')) : null,
    pt.weekday ? h('div', { class: 'card' }, h('h3', { text: 'Weekday (posts with an exact upload time)' }), hbars(pt.weekday.filter((d) => d.n), (d) => d.viralShare, '% viral'), h('div', { class: 'dim small', style: { marginTop: '6px' }, text: 'Small samples: use it as a hint, not a rule.' })) : null,
    pt.hours ? h('div', { class: 'card' }, h('h3', { text: `Time of day (${pt.timezone || 'your time'})` }), hbars(pt.hours.filter((d) => d.n), (d) => d.viralShare, '% viral')) : h('div', { class: 'dim small', text: 'Upload times are not shown: YouTube lists only rough ages like "2 years ago", so only the exact dates that were read could be used and there were too few.' }),
    aiBox(s, 'viral', reload, 'Explain why they went viral'));
}

function ideasTab(s, reload) {
  const niche = h('input', { type: 'text', placeholder: 'Your niche or topic (optional), for example: street food travel', style: { width: '100%' }, value: s.ideas?.niche || '' });
  const box = h('div', { class: 'col' });
  const btn = h('button', { class: 'btn p', onclick: async (e) => {
    const b = e.target; b.disabled = true; b.textContent = 'Thinking... this can take a minute';
    try { await call('viral.ideas', { id: s.id, niche: niche.value.trim() }); await reload(); } catch (err) { b.disabled = false; b.textContent = 'Make 12 ideas'; box.prepend(h('div', { class: 'fi err', text: err.message })); }
  } }, s.ideas ? 'Make new ideas' : 'Make 12 ideas');
  return h('div', { class: 'card col' }, h('h3', { text: 'Post ideas from these viral patterns' }), h('div', { class: 'dim small', text: 'Uses the patterns of the viral posts, never their titles. If there is no AI explanation yet, it is written first.' }), niche, h('div', { class: 'row' }, btn), box, s.ideas ? h('div', { class: 'card report' }, md(s.ideas.text)) : null);
}

/* ---------------------------------------------------------------- hook into the study page */
(() => {
  const baseRender = RENDER.study;
  RENDER.study = async () => { await baseRender(); injectViralCard(); };
  const baseDraw = drawStudy;
  drawStudy = (s) => (s && s.kind === 'viral' ? drawViral(s) : baseDraw(s));
})();
