// Tools the chat agent can call. Each: {desc, args, risk(args) -> 'read'|'low'|'high', run(args, ctx)}.
const fs = require('fs');
const path = require('path');
const store = require('../store');
const kb = require('../knowledge/kb');
const analyzer = require('../media/analyze');
const writer = require('../caption/writer');
const styles = require('../caption/styles');
const skills = require('../caption/skills');
const study = require('../caption/study');
const buffer = require('../posting/buffer');
const browser = require('../posting/browser');
const jobs = require('../posting/jobs');
const sched = require('../posting/schedule');
const ff = require('../media/ffmpeg');
const accounts = require('../posting/accounts');
const workflows = require('../posting/workflows');
const web = require('../web/search');
const studyC = require('../content/study');
const viralC = require('../content/viral');
const formats = require('../content/formats');
const studio = require('../content/studio');

const MEDIA = /\.(mp4|mov|m4v|mkv|webm|avi|wmv|jpe?g|png|webp|gif|heic)$/i;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const ok = (text, extra) => ({ ok: true, text: typeof text === 'string' ? text : JSON.stringify(text, null, 1), ...extra });
const bad = (text) => ({ ok: false, text });

/* ---------------- Buffer channel cache ---------------- */
let chCache = { at: 0, list: null, err: null };
async function channels(force) {
  if (!store.hasSecret('bufferKey')) return { list: [], err: 'Buffer not connected' };
  if (!force && chCache.list && Date.now() - chCache.at < 300000) return chCache;
  try { chCache = { at: Date.now(), list: await buffer.channels(), err: null }; } catch (e) { chCache = { at: Date.now(), list: chCache.list || [], err: e.message }; }
  return chCache;
}
function invalidateChannels() { chCache = { at: 0, list: null, err: null }; }

/* ---------------- file helpers ---------------- */
function resolveFolder(f) {
  if (!f) throw new Error('Which folder? Give a folder name or path.');
  let hits = kb.findFolder(f);
  // an account name ("Client A") means that account's default folder
  if (!hits.length) { const acc = accounts.resolve(f)[0]?.account; if (acc?.defaultFolder) hits = [{ path: acc.defaultFolder, via: `default folder of ${acc.name}` }]; }
  if (!hits.length && store.get().defaultMediaFolder && /^(default|my|amar|pc)/i.test(f)) hits = [{ path: store.get().defaultMediaFolder, via: 'default media folder' }];
  if (!hits.length) throw new Error(`Folder "${f}" not found. Give the full path (e.g. E:\\Videos\\${f}) or save it in Knowledge > Locations.`);
  return hits;
}
function numberIn(name) { const m = /(\d+)/.exec(path.basename(name, path.extname(name))); return m ? Number(m[1]) : null; }
function listMedia(dir, { match, range, names, kinds = 'all', recursive = false, limit = 500 } = {}) {
  const out = [];
  const walk = (d, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { throw new Error(`Cannot read ${d}: ${e.message}`); }
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (recursive && depth < 3) walk(full, depth + 1); continue; }
      if (!MEDIA.test(e.name)) continue;
      const k = ff.kindOf(e.name);
      if (kinds !== 'all' && k !== kinds) continue;
      out.push(full);
    }
  };
  walk(dir, 0);
  let files = out.sort((a, b) => collator.compare(path.basename(a), path.basename(b)));
  if (match) { const q = String(match).toLowerCase(); files = files.filter((f) => path.basename(f).toLowerCase().includes(q)); }
  if (names?.length) {
    const want = names.map((n) => String(n).toLowerCase().replace(/\.[a-z0-9]{2,4}$/, ''));
    files = files.filter((f) => { const b = path.basename(f).toLowerCase(); return want.some((w) => b.includes(w)); });
  }
  if (range) {
    const m = /(\d+)\s*(?:-|to|theke|থেকে|\.\.)\s*(\d+)/i.exec(String(range));
    if (m) { const a = Number(m[1]), b = Number(m[2]); const lo = Math.min(a, b), hi = Math.max(a, b); files = files.filter((f) => { const n = numberIn(f); return n != null && n >= lo && n <= hi; }); }
  }
  return files.slice(0, limit);
}
function checkFiles(files) {
  if (!Array.isArray(files) || !files.length) throw new Error('Give "files": a list of full file paths (use list_files first).');
  const missing = files.filter((f) => !fs.existsSync(f));
  if (missing.length) throw new Error(`These files do not exist: ${missing.slice(0, 5).join(', ')}. Use list_files to get exact paths.`);
  return files.map((f) => path.resolve(f));
}

/* ---------------- targets ---------------- */
async function resolveTargets(list) {
  const want = (Array.isArray(list) ? list : [list]).map((x) => String(x || '').trim()).filter(Boolean);
  if (!want.length) throw new Error('Say where to post: e.g. ["instagram"] or ["buffer:My Page"] or ["browser:linkedin"].');
  const { list: chs } = await channels();
  const out = [], notes = [];
  for (const w of want) {
    const lw = w.toLowerCase();
    if (/^(browser|direct|web):/.test(lw)) {
      const pid = browser.platformId(lw.split(':')[1]);
      if (!pid) throw new Error(`Unknown platform for browser posting: ${w}`);
      if (accounts.list().some((a) => a.kind === pid)) throw new Error(`Do not use "${w}": it is the shared browser, not one of the saved accounts. Use an account name (the @name from list_accounts), e.g. "${accounts.list().find((a) => a.kind === pid).name}".`);
      out.push({ type: 'browser', platform: pid });
      if (!(await browser.loginStatus(pid))) notes.push(`Not signed in to ${browser.PLATFORMS[pid].label} in the app browser yet (Accounts > Sign in).`);
      continue;
    }
    // posting accounts (Buffer and other schedulers in the app browser) come first
    const acc = accounts.resolve(w.replace(/^buffer:/i, ''));
    if (acc.length) {
      for (const { account: a, channel: c } of acc) {
        if (!a.loggedIn) notes.push(`${a.name} is not signed in yet (Accounts > Sign in).`);
        out.push({ type: 'account', accountId: a.id, accountName: a.name, kind: a.kind, channelId: c?.id || null, channelName: c?.name || null, service: c?.service || null });
      }
      continue;
    }
    const q = lw.replace(/^buffer:/, '');
    if (q === 'all') { for (const c of chs) out.push({ type: 'buffer', channelId: c.id, service: c.service, name: c.name }); continue; }
    const hits = chs.filter((c) => c.id === w || c.name.toLowerCase() === q || c.handle?.toLowerCase() === q.replace(/^@/, ''));
    const byService = hits.length ? hits : chs.filter((c) => c.service.includes(writer.platformKey(q) === 'twitter' ? 'twitter' : writer.platformKey(q)) && writer.platformKey(q) !== 'generic');
    const byName = byService.length ? byService : chs.filter((c) => c.name.toLowerCase().includes(q));
    if (byName.length) { for (const c of byName) if (!out.some((o) => o.channelId === c.id)) out.push({ type: 'buffer', channelId: c.id, service: c.service, name: c.name }); continue; }
    // no Buffer channel: fall back to the app browser if that platform exists there
    const pid = browser.platformId(q);
    if (pid && accounts.list().some((a) => a.kind === pid)) throw new Error(`No account named "${w}". Saved accounts: ${accounts.list().map((a) => a.name).join(', ')}. Ask the user which one (use the exact name).`);
    if (pid) { out.push({ type: 'browser', platform: pid }); notes.push(`No Buffer channel for "${w}", so it will be posted with the app browser${(await browser.loginStatus(pid)) ? '' : ' (sign in first in Accounts)'}.`); continue; }
    throw new Error(`No account or channel matches "${w}". Use list_accounts to see the names.`);
  }
  return { targets: out, notes };
}

const prepared = new Map(); // file -> captions written in this chat (reused by create_post_job)

const TOOLS = {
  find_folder: {
    desc: 'Find a folder on the PC by name (saved Locations first, then Videos/Desktop/Downloads/Drive and drive roots).', args: '{"name": "folder name or path"}',
    risk: () => 'read',
    run: async (a) => { const h = kb.findFolder(a.name); return h.length ? ok(h.map((x) => `${x.path}  (${x.via})`).join('\n')) : bad(`No folder named "${a.name}" found. Ask the user for the full path.`); }
  },
  list_files: {
    desc: 'List videos/images in a folder (natural order). Filter by number range ("01-10"), name parts, or kind.', args: '{"folder": "name or path", "range": "1-10"?, "names": ["part of name"]?, "match": "text"?, "kinds": "video|image|all"?, "recursive": false?}',
    risk: () => 'read',
    run: async (a) => {
      const hits = resolveFolder(a.folder);
      const dir = hits[0].path;
      const files = listMedia(dir, a);
      const more = hits.length > 1 ? `\n(Other folders with that name: ${hits.slice(1, 4).map((h) => h.path).join('; ')})` : '';
      if (!files.length) return bad(`No matching media files in ${dir}.${more}`);
      return ok(`Folder: ${dir}\n${files.length} file(s):\n${files.map((f) => { let sz = ''; try { sz = ` (${(fs.statSync(f).size / 1048576).toFixed(1)} MB)`; } catch (_) { /* skip */ } return `${f}${sz}`; }).join('\n')}${more}`);
    }
  },
  analyze_media: {
    desc: 'Understand videos/images (speech in Bangla/English, frames, notes). mode: name (instant, file name only) | quick | smart (default) | full (whole video, slow).', args: '{"files": ["full path"], "mode": "name|quick|smart|full"?}',
    risk: () => 'read',
    run: async (a, ctx) => {
      const files = checkFiles(a.files).slice(0, 30);
      const out = [];
      for (const f of files) {
        ctx.onOutput?.(`Analyzing ${path.basename(f)}...\n`);
        try { const r = await analyzer.analyze(f, { mode: a.mode, signal: ctx.signal, onStep: (s) => ctx.onStatus?.(`${path.basename(f)}: ${s}`) }); out.push(r.brief); }
        catch (e) { if (e.message === 'ABORTED') throw e; out.push(`${path.basename(f)}: ERROR ${e.message}`); }
      }
      return ok(out.join('\n\n'));
    }
  },
  write_captions: {
    desc: 'Write captions/titles/descriptions/hashtags for files and platforms so the user can preview them (they are reused when posting).', args: '{"files": [...], "platforms": ["instagram","youtube", or channel names], "style"?: "...", "language"?: "auto|bn|en|banglish|bn+en", "length"?: "short|medium|long", "caption_type"?: "auto|storytelling|educational|hook_question|emotional|humorous|promotional|minimal|hype", "tone"?: "positive|neutral|bold|controversial", "instructions"?: "...", "mode"?: "name|quick|smart|full"}',
    risk: () => 'read',
    run: async (a, ctx) => {
      const files = checkFiles(a.files).slice(0, 20);
      const out = [];
      for (const f of files) {
        ctx.onStatus?.(`Writing for ${path.basename(f)}`);
        const an = await analyzer.analyze(f, { mode: a.mode, signal: ctx.signal });
        const plats = (a.platforms || ['instagram']).flatMap((p) => (writer.platformKey(p) !== 'generic' ? [p] : accounts.resolve(p).map((x) => x.channel?.service).filter(Boolean)));
        const c = await writer.write({ craft: { length: a.length, type: a.caption_type, tone: a.tone, structure: a.structure, boosters: a.boosters }, analysis: an, targets: plats.length ? plats : ['instagram'], style: a.style, language: a.language, instructions: a.instructions, keywords: a.keywords, signal: ctx.signal });
        prepared.set(f, c);
        out.push(`### ${path.basename(f)} (${c.language})\n${Object.values(c.platforms).map((p) => `**${writer.PLATFORMS[p.platform].label}**${p.title ? `\nTitle: ${p.title}` : ''}\n${p.text}${p.keywords?.length ? `\nTags: ${p.keywords.join(', ')}` : ''}`).join('\n\n')}`);
      }
      return ok(out.join('\n\n'));
    }
  },
  list_accounts: {
    desc: 'Show where posts can go: Buffer channels (YouTube, Instagram, TikTok, Facebook, LinkedIn...) and the platforms signed in for direct browser posting.', args: '{}',
    risk: () => 'read',
    run: async () => {
      const c = await channels(true);
      const b = await browser.statusAll();
      return ok(`POSTING ACCOUNTS (app browser, use the channel or account name as target)\n${accounts.summary() || '- none added yet (Accounts page)'}\n\nBUFFER API ${store.hasSecret('bufferKey') ? '' : '(not connected)'}${c.err ? ` ERROR: ${c.err}` : ''}\n${c.list.map((x) => `- ${x.name} [${x.service}]${x.paused ? ' (queue paused)' : ''} id=${x.id}`).join('\n') || '- none'}\nMEDIA HOSTING for Buffer: ${require('../posting/hosting').configured() ? store.get().hosting.provider : 'NOT SET (needed for Buffer videos/images)'}\nDIRECT BROWSER POSTING (target "browser:<id>")\n${Object.entries(b).map(([id, x]) => `- ${id}: ${x.label} ${x.loggedIn ? 'signed in' : 'not signed in'}`).join('\n')}`);
    }
  },
  create_post_job: {
    desc: 'Post or schedule files to one or more accounts in ONE job (bulk). The job analyzes, writes captions (or reuses previewed ones), asks for approval as set, uploads and schedules. Times are computed by the app.',
    args: '{"files": [...], "targets": ["instagram" | "youtube" | "<Buffer channel name>" | "all" | "browser:linkedin" ...], "schedule": {"mode": "now|queue|custom|draft", "start": "YYYY-MM-DD HH:mm"?, "every": "1d|12h|2d"?, "times": ["10:00","19:00"]?, "perDay": 1?, "dates": ["YYYY-MM-DD HH:mm", ...]?}, "style"?: "...", "language"?: "auto|bn|en|banglish|bn+en", "analysis_mode"?: "name|quick|smart|full", "instructions"?: "...", "keywords"?: "...", "approval"?: "autopilot|every|once", "draft"?: false, "youtube_privacy"?: "public|unlisted|private", "ig_type"?: "reel|post|story", "length"?: "short|medium|long", "caption_type"?: "auto|storytelling|educational|hook_question|emotional|humorous|promotional|minimal|hype", "tone"?: "positive|neutral|bold|controversial", "text_posts"?: ["text-only post 1", "..."], "title"?: "job name", "per_target"?: {"<channel, account or network name>": {"length","tone","structure","boosters","caption_type","language","style","instructions"}}, "confirmed"?: true}',
    risk: () => 'low',
    run: async (a, ctx) => {
      const files = a.files?.length ? checkFiles(a.files).slice(0, 300) : [];
      if (!files.length && !a.text_posts?.length) return bad('Give files and/or text_posts.');
      const { targets, notes } = await resolveTargets(a.targets);
      // the user confirms the plan in the chat first (autopilot skips this; Settings > Automation > "Show the plan and wait" can turn it off)
      if (!a.confirmed && store.get().mode !== 'autopilot' && store.get().planGate !== false) {
        const when = a.schedule?.mode === 'custom' || a.schedule?.start ? `${a.schedule.start || 'default times'}${a.schedule.every ? ` every ${a.schedule.every}` : ''}${a.schedule.times ? ` at ${a.schedule.times.join(', ')}` : ''}` : a.schedule?.mode || 'queue';
        const cap = [a.length || store.get().captionLength, a.tone || store.get().captionTone, a.structure && a.structure !== 'auto' ? a.structure : null, a.language || 'language of each video'].filter(Boolean).join(', ');
        const per = a.per_target ? Object.entries(a.per_target).map(([k, v]) => `${k}: ${Object.entries(v).map(([x, y]) => `${x}=${y}`).join(', ')}`).join('; ') : '';
        return bad(`NOT STARTED. Show this plan to the user and ask for the go-ahead with {"final": "...", "options": ["Start", "Change captions", "Change time"]}. Plan: ${files.length} file(s)${a.text_posts?.length ? ` + ${a.text_posts.length} text post(s)` : ''} -> ${targets.map(jobs.targetLabel).join(', ')}. When: ${when}. Video scan: ${a.analysis_mode || store.get().analysisMode}. Captions: ${cap}.${per ? ` Per channel: ${per}.` : ''} After the user agrees (or changes something), call create_post_job again with the same args plus "confirmed": true.`);
      }
      const prep = {};
      for (const f of files) if (prepared.has(f)) prep[f] = prepared.get(f);
      // different caption wishes per channel (even in the same network) -> one job per group of channels with the same wishes
      const texts = Array.isArray(a.text_posts) ? a.text_posts.map(String).filter(Boolean).slice(0, 100) : [];
      const options = { analysisMode: a.analysis_mode, style: a.style, language: a.language, instructions: a.instructions, keywords: a.keywords, draft: !!a.draft, youtubePrivacy: a.youtube_privacy, igType: a.ig_type, captionLength: a.length, captionType: a.caption_type, captionTone: a.tone, captionStructure: a.structure, captionBoosters: a.boosters };
      const made = jobs.createSplit({ title: a.title, chatId: ctx.chatId, files, texts, targets, schedule: a.schedule || { mode: 'queue' }, approval: a.approval || store.get().mode, prepared: prep, perTarget: a.per_target, options });
      if (made.length > 1) return ok(`${made.length} jobs started (one per caption setup): ${made.map((jj) => `${jj.id}: ${jj.targets.map(jobs.targetLabel).join(', ')}`).join(' | ')}. Progress is live in the Monitor page.`);
      const j = made[0];
      return ok(`Job ${j.id} started: ${files.length} file(s) -> ${j.targets.map(jobs.targetLabel).join(', ')}.\nTimes: ${j.items.map((it) => `${it.name}: ${sched.human(it.dueAt)}`).join('; ')}\nApproval: ${j.approval}. Progress is live in the Monitor page.${notes.length ? `\nNotes: ${notes.join(' ')}` : ''}`);
    }
  },
  list_buffer_posts: {
    desc: 'List the scheduled posts (view "schedule") or drafts (view "drafts") of one Buffer channel, with day, time and text.', args: '{"account": "account name", "channel": "channel name", "view"?: "schedule|drafts"}',
    risk: () => 'read',
    run: async (a) => {
      const acc = accounts.list().find((x) => x.kind === 'buffer' && x.name.toLowerCase() === String(a.account || '').toLowerCase()) || accounts.list().find((x) => x.kind === 'buffer' && (x.channels || []).some((c) => c.name.toLowerCase() === String(a.channel || '').toLowerCase()));
      if (!acc) return bad('Buffer account not found. Use list_accounts.');
      const l = await accounts.queueList(acc.id, a.channel, a.view);
      return ok(l.length ? l.map((p) => `${p.index}. ${p.day} ${p.time}: ${p.text.slice(0, 90)}`).join('\n') : 'No posts in that view.');
    }
  },
  delete_buffer_posts: {
    desc: 'DELETE scheduled posts or drafts from one Buffer channel. Select by "indexes" from list_buffer_posts, or "day" (e.g. "Friday, November 27"), or "match" (text in the post). The user must approve.', args: '{"account": "account name", "channel": "channel name", "view"?: "schedule|drafts", "indexes"?: [0,1], "day"?: "...", "match"?: "text"}',
    risk: () => 'high',
    run: async (a, ctx) => {
      const acc = accounts.list().find((x) => x.kind === 'buffer' && x.name.toLowerCase() === String(a.account || '').toLowerCase()) || accounts.list().find((x) => x.kind === 'buffer' && (x.channels || []).some((c) => c.name.toLowerCase() === String(a.channel || '').toLowerCase()));
      if (!acc) return bad('Buffer account not found. Use list_accounts.');
      const l = await accounts.queueList(acc.id, a.channel, a.view);
      const pick = l.filter((p) => (a.indexes || []).includes(p.index) || (a.day && p.day.toLowerCase().includes(String(a.day).toLowerCase())) || (a.match && p.text.toLowerCase().includes(String(a.match).toLowerCase())));
      if (!pick.length) return bad('No post matches. Nothing was deleted. Run list_buffer_posts and choose indexes.');
      if (pick.length > 20) return bad(`That matches ${pick.length} posts. Narrow it down (max 20 per call).`);
      const r = await accounts.queueRemove(acc.id, a.channel, a.view, pick, (t) => ctx.onStatus?.(t));
      return ok(`Deleted ${r.deleted} post(s)${r.failed ? `, ${r.failed} could not be deleted` : ''}: ${pick.map((p) => `${p.day} ${p.time}`).join('; ')}`);
    }
  },
  undo_job: {
    desc: 'UNDO a posting job: deletes only the scheduled posts and drafts that job created on Buffer (never other posts) and reports each post. Posts shared immediately cannot be undone. Use only when the user asks to undo or take back a job. The user must approve.', args: '{"id": "job id (from job_status)"}',
    risk: () => 'high',
    run: async (a, ctx) => {
      if (!a.id) return bad('Give the job id (see job_status).');
      try { const undo = require('./undo'); const r = await undo.undo(String(a.id), { onStatus: (t) => ctx.onStatus?.(t) }); return ok(undo.describeResult(r)); } catch (e) { return bad(e.message); }
    }
  },
  job_status: {
    desc: 'Status of posting jobs (the newest, or one id).', args: '{"id"?: "job id"}', risk: () => 'read',
    run: async (a) => {
      const list = a.id ? [jobs.get(a.id)].filter(Boolean) : jobs.list().slice(0, 5);
      if (!list.length) return ok('No jobs yet.');
      return ok(list.map((j) => `${j.id} "${j.title}" ${j.status} ${j.stats.done}/${j.stats.total} done${j.stats.failed ? `, ${j.stats.failed} failed` : ''}\n${j.items.map((it) => `  - ${it.name} [${it.stage}] ${sched.human(it.dueAt)} ${it.results.map((r) => `${r.label}: ${r.status}${r.error ? ` (${r.error})` : ''}`).join('; ')}`).join('\n')}`).join('\n\n'));
    }
  },
  control_job: {
    desc: 'Pause, resume (also retries failed posts), or stop a job.', args: '{"id": "job id", "action": "pause|resume|stop"}', risk: () => 'low',
    run: async (a) => { const fn = { pause: jobs.pause, resume: jobs.resume, stop: jobs.stop }[a.action]; if (!fn) return bad('action must be pause, resume or stop'); const j = fn(a.id); return ok(`Job ${a.id}: ${j?.status}`); }
  },
  list_caption_options: { desc: 'List caption tones, structure templates and engagement boosters the user can pick (including their own).', args: '{}', risk: () => 'read', run: async () => { const craft = require('../caption/craft'); return ok(`TONES: ${craft.list('tone').map((x) => `${x.id} (${x.name})`).join(', ')}\nSTRUCTURES: ${craft.list('structure').map((x) => `${x.id} (${x.name})`).join(', ')}\nBOOSTERS: ${craft.list('booster').map((x) => x.id).join(', ')}`); } },
  list_styles: { desc: 'List caption styles (presets, the user\'s own, learned ones).', args: '{}', risk: () => 'read', run: async () => ok(styles.list().map((s) => `- ${s.name} (id ${s.id}, ${s.source}, ${s.language}) ${s.tone}`).join('\n')) },
  save_style: {
    desc: 'Create or update a caption style from the user\'s description.', args: '{"id"?: "...", "name": "...", "language": "auto|bn|en|banglish|bn+en", "tone": "...", "length": "short|medium|long", "emoji": "none|light|medium|heavy", "hashtagCount": 5, "hook": "...", "structure": "...", "cta": "...", "dos": [], "donts": [], "fixedHashtags": [], "signature": "", "examples": []}',
    risk: () => 'low', run: async (a) => { const s = styles.save(a); return ok(`Saved style "${s.name}" (id ${s.id}).`); }
  },
  set_default_style: { desc: 'Make a style the default for new posts.', args: '{"style": "name or id"}', risk: () => 'low', run: async (a) => { const s = styles.get(a.style); if (!s) return bad('Style not found'); store.update({ defaultStyle: s.id }); return ok(`Default style is now "${s.name}".`); } },
  learn_style: {
    desc: 'Learn a caption style from real captions: the user\'s Buffer posts, a profile/channel URL (their account or a creator; opened in the app browser), or pasted captions.', args: '{"source": "buffer|url|text", "url"?: "https://...", "text"?: "captions separated by ---", "channel"?: "Buffer channel id", "name"?: "style name"}',
    risk: () => 'low',
    run: async (a, ctx) => {
      ctx.onStatus?.('Studying captions...');
      const r = a.source === 'buffer' ? await study.fromBuffer({ channelId: a.channel, name: a.name, signal: ctx.signal }) : a.source === 'url' ? await study.fromUrl({ url: a.url, name: a.name, signal: ctx.signal }) : await study.fromText({ text: a.text, name: a.name, signal: ctx.signal });
      return ok(`Learned style "${r.style.name}" (id ${r.style.id}) from ${r.count} captions.\nTone: ${r.style.tone}\nHook: ${r.style.hook}\nStructure: ${r.style.structure}\n${r.insights}`);
    }
  },
  search_knowledge: { desc: 'Search the Info notes and stored documents.', args: '{"query": "..."}', risk: () => 'read', run: async (a) => ok(kb.search(a.query, { budget: 5000, includeAlways: false }) || 'Nothing found.') },
  save_info: { desc: 'Save a piece of information to Knowledge > Info (brand details, offers, links, audience). always=true adds it to every caption.', args: '{"title": "...", "text": "...", "always": false}', risk: () => 'low', run: async (a) => { const n = kb.saveNote(a); return ok(`Saved info "${n.title}".`); } },
  save_location: { desc: 'Remember a folder on the PC by a short name (e.g. "reels" -> E:\\Videos\\Reels).', args: '{"name": "...", "path": "...", "note"?: "..."}', risk: () => 'low', run: async (a) => { if (!fs.existsSync(a.path)) return bad(`Path does not exist: ${a.path}`); const l = kb.saveLocation(a); return ok(`Saved location "${l.name}" = ${l.path}`); } },
  list_skills: { desc: 'List writing skills and whether they are on.', args: '{}', risk: () => 'read', run: async () => ok(skills.list().map((s) => `- ${s.name} (${s.id}, ${s.source}) ${s.enabled ? 'ON' : 'off'}: ${s.description}`).join('\n')) },
  toggle_skill: { desc: 'Turn a writing skill on or off.', args: '{"id": "...", "enabled": true}', risk: () => 'low', run: async (a) => { skills.setEnabled(a.id, a.enabled); return ok(`${a.id}: ${a.enabled ? 'on' : 'off'}`); } },
  import_skill: {
    desc: 'Import a writing skill (SKILL.md) from a GitHub link. The app checks it for unsafe instructions first.', args: '{"url": "https://github.com/...", "path"?: "file inside the repo if the link is a repo"}',
    risk: () => 'high',
    run: async (a, ctx) => {
      const d = await skills.discover(a.url);
      const pick = a.path ? d.files.find((f) => f.path === a.path) : d.files.length === 1 ? d.files[0] : d.files.find((f) => /SKILL\.md$/i.test(f.path) && d.files.filter((x) => /SKILL\.md$/i.test(x.path)).length === 1);
      if (!pick) return ok(`The repo has several skill files. Ask the user which one (or import from the Skills page):\n${d.files.map((f) => `- ${f.path}`).join('\n')}`);
      const r = await skills.fetchForReview({ owner: d.owner, repo: d.repo, branch: d.branch, path: pick.path });
      const high = r.flags.filter((f) => f.level === 'high');
      if (high.length) return bad(`Not imported: the skill has unsafe parts: ${high.map((f) => f.what).join('; ')}. The user can review it in the Skills page.`);
      const s = await skills.importReviewed({ text: r.text, name: r.name, description: r.description, url: r.url, license: d.license }, ctx.signal);
      return ok(`Imported skill "${s.name}" (${d.license || 'license unknown'}). ${r.flags.length ? `Notes: ${r.flags.map((f) => f.what).join('; ')}` : ''}`);
    }
  },
  post_history: { desc: 'Recent posts the app made (with status and links).', args: '{"limit"?: 20}', risk: () => 'read', run: async (a) => { const h = jobs.history().slice(0, Math.min(100, a.limit || 20)); return ok(h.map((x) => `${new Date(x.at).toLocaleString()} ${x.name} -> ${x.target}: ${x.status}${x.dueAt ? ` for ${sched.human(x.dueAt)}` : ''}${x.url ? ` ${x.url}` : ''}${x.error ? ` (${x.error})` : ''}`).join('\n') || 'No posts yet.'); } },
  web_search: {
    desc: 'Search the internet (Google with its AI overview when available, else Bing/DuckDuckGo). Use when you do not know something.', args: '{"query": "..."}', risk: () => 'read',
    run: async (a) => { const r = await web.search(String(a.query || '').slice(0, 200), 8); return ok(web.asData(`${r.engine} search: ${a.query}`, `${r.overview ? `AI overview:\n${r.overview}\n\n` : ''}${r.results.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.snippet}`).join('\n')}`)); }
  },
  read_url: { desc: 'Read a web page as text.', args: '{"url": "https://..."}', risk: () => 'read', run: async (a) => { const r = await web.fetchPage(a.url, 8000); return ok(web.asData(r.url, `${r.title}\n\n${r.text}`)); } },
  ask_web_ai: {
    desc: 'Ask ChatGPT, Gemini or Claude on their websites (accounts signed in under Accounts) when a task needs a stronger model. Never send passwords, keys or private data.', args: '{"question": "...", "site": "chatgpt|gemini|claude"?}',
    risk: () => (store.get().webAiFallback ? 'low' : 'high'),
    run: async (a, ctx) => {
      const list = accounts.aiAccounts().filter((x) => x.loggedIn && (!a.site || x.kind === a.site));
      if (!list.length) return bad('No signed-in ChatGPT/Gemini/Claude account. Add one in Accounts > AI accounts.');
      const acc = list[0];
      const ans = await require('../posting/browser').askWebAi(acc.kind, acc.partition, String(a.question).slice(0, 8000), { signal: ctx.signal });
      return ok(web.asData(`${acc.name}`, ans.slice(0, 12000)));
    }
  },
  workflow_create: {
    desc: 'Save a posting plan for a whole folder (e.g. 100 videos, gradually). Progress is tracked in a sheet. Then use workflow_next to schedule batches.',
    args: '{"name": "...", "folder": "name or path", "range"?: "1-100", "targets": ["channel or account names"], "times": ["20:00"], "every"?: "1d", "start"?: "YYYY-MM-DD HH:mm", "batch_size"?: 10, "style"?: "...", "language"?: "...", "analysis_mode"?: "...", "instructions"?: "..."}',
    risk: () => 'low',
    run: async (a, ctx) => {
      const folder = kb.findFolder(a.folder)[0]?.path || accounts.resolve(String(a.folder || ''))[0]?.account?.defaultFolder;
      if (!folder) return bad(`Folder "${a.folder}" not found.`);
      await resolveTargets(a.targets);
      const w = workflows.create({ name: a.name, folder, filter: { range: a.range }, targets: a.targets, cadence: { times: a.times, every: a.every }, startDate: a.start, batchSize: a.batch_size, options: { style: a.style, language: a.language, analysisMode: a.analysis_mode, instructions: a.instructions }, chatId: ctx.chatId });
      return ok(`Workflow "${w.name}" saved (id ${w.id}): ${w.stats.total} files from ${folder}. Sheet: ${w.sheet}. Nothing is scheduled yet; use workflow_next.`);
    }
  },
  workflow_next: {
    desc: 'Schedule the next N files of a workflow (continues after the last scheduled post). Starts one job.', args: '{"workflow": "name or id", "count"?: 10, "approval"?: "autopilot|every|once"}',
    risk: () => 'low',
    run: async (a, ctx) => {
      const plan = workflows.planNext(a.workflow, a.count);
      if (plan.done) return ok(`Workflow "${plan.workflow.name}" has no pending files left.`);
      const w = plan.workflow;
      const { targets, notes } = await resolveTargets(w.targets);
      const j = jobs.create({ title: `${w.name}: next ${plan.files.length}`, chatId: ctx.chatId, workflowId: w.id, files: plan.files, targets, schedule: { mode: 'custom', dates: plan.times }, approval: a.approval || w.approval || store.get().mode, options: { ...w.options } });
      workflows.markJob(w.id, plan.files, j.id, plan.times);
      return ok(`Job ${j.id} started for "${w.name}": ${plan.files.length} files.\n${j.items.map((it) => `${it.name}: ${sched.human(it.dueAt)}`).join('\n')}${notes.length ? `\nNotes: ${notes.join(' ')}` : ''}`);
    }
  },
  workflow_status: { desc: 'Show saved workflows and their progress (or one workflow in detail).', args: '{"workflow"?: "name or id"}', risk: () => 'read',
    run: async (a) => {
      if (!a.workflow) return ok(workflows.describe() || 'No workflows yet.');
      const rows = workflows.rows(a.workflow);
      if (!rows.length) return bad('Workflow not found or empty.');
      return ok(rows.slice(0, 120).map((r) => `${r.no}. ${path.basename(r.file)} [${r.status}] ${r.scheduled_for || ''} ${r.targets}`).join('\n'));
    }
  },
  study_profile: { desc: 'Study a competitor profile or channel link in depth (structure, strategy, posting times, hooks, keywords, story flow) and save the report.', args: '{"url": "https://...", "posts"?: 24}', risk: () => 'read',
    run: async (a, ctx) => { const r = await studyC.studyProfile({ url: a.url, posts: a.posts, signal: ctx.signal, onStep: (t) => ctx.onStatus?.(t) }); return ok(`Study saved (id ${r.id}). Open it in the Study tab.\n\n${r.report.slice(0, 3500)}`); }
  },
  study_viral: { desc: 'Find the viral posts of a YouTube, TikTok or Instagram profile (views far above the typical views around them), save the study and list the top ones. mode "journey" also builds the growth journey (start, take-off, game changers).', args: '{"url": "https://youtube.com/@name", "mode"?: "viral|journey", "factor"?: 3, "content"?: "videos|shorts|both"}', risk: () => 'read',
    run: async (a, ctx) => { require('../web/search').safeUrl(a.url); const r = await viralC.run({ url: a.url, mode: a.mode === 'journey' ? 'journey' : 'viral', factor: a.factor, content: a.content || 'videos', signal: ctx.signal, onStep: (t) => ctx.onStatus?.(t) }); return ok(`Study saved (id ${r.id}). Open it in Competitor study for charts, recent and all-time viral lists, the journey and one-post breakdowns.\n\n${viralC.summaryText(r)}`); }
  },
  study_clip: { desc: 'Study a viral clip file (timed speech, cuts, pacing) and save its structure as a reusable format.', args: '{"file": "full path", "name"?: "format name"}', risk: () => 'read',
    run: async (a, ctx) => { const [f] = checkFiles([a.file]); const r = await studyC.studyClip(f, { name: a.name, signal: ctx.signal, onStep: (t) => ctx.onStatus?.(t) }); return ok(`Saved format "${r.format.name}" (${r.cuts} cuts in ${Math.round(r.duration)} s). Use it with /${formats.slug(r.format.name)}.\n${formats.describe(r.format)}`); }
  },
  list_formats: { desc: 'List saved formats (structures for scripts and posts).', args: '{}', risk: () => 'read', run: async () => ok(formats.list().map((f) => `- /${f.id.startsWith('fmt-') ? formats.slug(f.name) : f.id}: ${f.name} (${f.kind}) ${f.summary || ''}`).join('\n')) },
  video_kit: { desc: 'From one video: transcript, 5 titles, thumbnail texts, keywords, YouTube description, LinkedIn post, Facebook status, Instagram caption, X post. Saved to Saved posts.', args: '{"file": "full path", "language"?: "auto|bn|en"}', risk: () => 'read',
    run: async (a, ctx) => { const [f] = checkFiles([a.file]); const k = await studio.videoKit(f, { language: a.language, signal: ctx.signal, onStep: (t) => ctx.onStatus?.(t) }); return ok(`Saved as "${k.saved}" in Saved posts.\nTitles:\n${k.titles.map((t) => `- ${t}`).join('\n')}\nThumbnail text: ${k.thumbnail_texts.join(' | ')}\nKeywords: ${k.keywords.join(', ')}`); }
  },
  remember: { desc: 'Remember a lasting preference of the user (e.g. "always post at 8 PM", "my page is about cooking").', args: '{"text": "..."}', risk: () => 'low', run: async (a) => { const m = store.get().memory.slice(); m.push({ text: String(a.text).slice(0, 300), at: Date.now() }); store.update({ memory: m.slice(-60) }); return ok('Remembered.'); } }
};

function describe() { return Object.entries(TOOLS).map(([n, t]) => `- ${n}: ${t.desc}\n  args: ${t.args}`).join('\n'); }

module.exports = { TOOLS, describe, channels, invalidateChannels, listMedia, resolveTargets, prepared };
