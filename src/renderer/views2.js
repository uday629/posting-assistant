/* Posting Assistant - renderer: Library, Writer, Competitor study, Workflows. */
'use strict';
/* global pa, h, $, call, toast, modal, closeModal, confirmBox, promptBox, field, sel, seg, md, icon, fmtBytes, fmtDate, base, go, S, RENDER, setSetting, loadSettings, pill, attachSlash, DROP */

/* ================= LIBRARY: skills, formats, styles, info, docs, locations ================= */
const LIB_TABS = [['skills', 'Skills'], ['formats', 'Formats'], ['styles', 'Caption styles'], ['craft', 'Tones and structures'], ['knowledge', 'Info, docs and locations']];
RENDER.library = () => {
  const tab = S.libTab || 'skills';
  const v = $('#view-library');
  const body = h('section', { class: 'libbody', id: `view-${tab}` });
  v.replaceChildren(h('div', { class: 'head' }, h('h1', { text: 'Library' }), h('span', { class: 'muted small', text: 'Everything the writer uses. Type /name in any chat to use one item for that message.' })),
    h('div', { class: 'subtabs' }, ...LIB_TABS.map(([id, l]) => h('button', { class: tab === id ? 'on' : '', onclick: () => { S.libTab = id; RENDER.library(); } }, l))), body);
  RENDER[tab]();
};
DROP.library = async (paths) => {
  const zip = paths.find((p) => /\.zip$/i.test(p));
  if (zip) { S.libTab = 'skills'; RENDER.library(); return zipSkillModal(zip); }
  const added = await call('kb.addDocPaths', paths);
  if (added.length) { toast(`Added ${added.length} document(s) to Docs`, 'ok'); S.libTab = 'knowledge'; RENDER.library(); }
};
async function zipSkillModal(file) {
  const r = await call('skills.inspectZip', file);
  if (!r.skills.length) { toast('No skill (SKILL.md or Markdown file) found in that ZIP.', 'warn'); return; }
  modal([h('h2', { text: `Install from ${base(file)}` }),
    h('div', { class: 'muted small', text: `Only text is installed. ${r.skipped.length ? `Left out (never run): ${r.skipped.slice(0, 6).join(', ')}${r.skipped.length > 6 ? '...' : ''}` : ''}` }),
    ...r.skills.map((s) => h('div', { class: 'card', style: { marginTop: '10px' } },
      h('div', { class: 'row' }, h('b', { text: s.name }), h('span', { class: 'dim small', text: s.refs.length ? `${s.refs.length} reference file(s)` : '' })),
      h('div', { class: 'dim small', style: { margin: '4px 0' }, text: s.description.slice(0, 240) }),
      ...(s.flags.length ? s.flags.map((f) => h('div', { class: `flag ${f.level}`, text: `${f.level.toUpperCase()}: ${f.what}${f.sample ? ` - "${f.sample}"` : ''}` })) : [h('div', { class: 'flag low', text: 'Safety check: nothing suspicious found.' })]),
      h('details', null, h('summary', { class: 'small muted', text: 'Read the skill' }), h('div', { class: 'bodyprev', text: s.text.slice(0, 20000) })),
      h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: `btn ${s.flags.some((f) => f.level === 'high') ? '' : 'p'}`, onclick: async (e) => {
        if (s.flags.some((f) => f.level === 'high') && !(await confirmBox('Install anyway?', 'This skill has HIGH-risk parts (it mentions keys, overrides or sending data). Skills are only used as writing guidance and are never run, but install it only if you trust where it came from.', 'Install'))) return;
        e.target.disabled = true; e.target.textContent = 'Installing...';
        const saved = await call('skills.import', { text: s.text, name: s.name, description: s.description, url: `zip: ${base(file)}`, license: '' });
        toast(`Installed "${saved.name}". Use it with /${saved.id}`, 'ok'); e.target.textContent = 'Installed';
        if (S.libTab === 'skills') RENDER.library();
      } }, 'Install'))))
  ], { wide: true });
}

/* ---------- formats ---------- */
let fmtSel = null;
RENDER.formats = async () => {
  const list = await call('formats.list');
  if (!fmtSel || !list.find((f) => f.id === fmtSel)) fmtSel = list[0]?.id;
  const v = $('#view-formats');
  const left = h('div', { class: 'left' },
    h('div', { class: 'col' },
      h('button', { class: 'btn p', onclick: () => { fmtSel = '__new'; drawFormat(list); } }, icon('plus', 16), 'New format'),
      h('button', { class: 'btn', onclick: () => clipStudyModal() }, 'Learn from a viral clip')),
    h('div', { class: 'sect', text: 'Formats' }),
    ...list.map((f) => h('div', { class: `litem ${f.id === fmtSel ? 'on' : ''}`, onclick: () => { fmtSel = f.id; RENDER.formats(); } }, h('span', { class: 'tt', text: f.name }), h('span', { class: 'tag', text: f.kind }))));
  v.replaceChildren(h('div', { class: 'split' }, left, h('div', { class: 'right', id: 'fmtRight' })));
  drawFormat(list);
};
function drawFormat(list) {
  const r = $('#fmtRight');
  const f = fmtSel === '__new' ? { name: '', kind: 'script', summary: '', beats: [], rules: [], pacing: '' } : list.find((x) => x.id === fmtSel);
  if (!f) { r.replaceChildren(h('div', { class: 'empty', text: 'Pick a format' })); return; }
  const st = { ...f };
  const beatsTa = h('textarea', { rows: 9, value: (f.beats || []).map((b) => `${b.name}${b.seconds ? ` [${b.seconds}]` : ''}: ${b.purpose}${b.pattern ? ` | ${b.pattern}` : ''}`).join('\n') });
  const slug = (f.id && !String(f.id).startsWith('fmt-')) ? f.id : String(f.name || '').toLowerCase().replace(/[^a-z0-9ঀ-৿]+/g, '-').replace(/^-|-$/g, '');
  r.replaceChildren(h('div', { class: 'col', style: { maxWidth: '900px', gap: '12px' } },
    h('div', { class: 'row' }, h('h2', { style: { margin: 0 }, text: f.name || 'New format' }), slug ? h('span', { class: 'kbd', text: `/${slug}` }) : null, f.learnedFrom ? h('span', { class: 'dim small', text: `learned from ${f.learnedFrom}` }) : null),
    h('div', { class: 'formgrid' },
      field('Name', h('input', { type: 'text', value: f.name, oninput: (e) => { st.name = e.target.value; } })),
      field('Type', sel([['script', 'Video script'], ['clip', 'Viral clip structure'], ['post', 'Post'], ['newsletter', 'Newsletter'], ['caption', 'Caption']], f.kind, (x) => { st.kind = x; })),
      h('div', { class: 'wide' }, field('One-line summary', h('input', { type: 'text', value: f.summary || '', oninput: (e) => { st.summary = e.target.value; } }))),
      h('div', { class: 'wide' }, field('Beats, one per line: Name [seconds]: purpose | template line', beatsTa)),
      h('div', { class: 'wide' }, field('Pacing', h('input', { type: 'text', value: f.pacing || '', oninput: (e) => { st.pacing = e.target.value; } }))),
      h('div', { class: 'wide' }, field('Rules (one per line)', h('textarea', { rows: 3, value: (f.rules || []).join('\n'), oninput: (e) => { st.rules = e.target.value.split('\n'); } })))),
    h('div', { class: 'row' },
      h('button', { class: 'btn p', onclick: async () => {
        st.beats = beatsTa.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const m = /^([^:[]+?)\s*(?:\[([^\]]+)\])?\s*:\s*([^|]*)(?:\|\s*(.*))?$/.exec(l); return m ? { name: m[1].trim(), seconds: m[2]?.replace(/s$/, ''), purpose: m[3].trim(), pattern: m[4]?.trim() } : { name: l, purpose: '' }; });
        const saved = await call('formats.save', st); fmtSel = saved.id; toast('Format saved', 'ok'); RENDER.formats();
      } }, f.source === 'preset' ? 'Save as my copy' : 'Save'),
      f.id && f.source !== 'preset' ? h('button', { class: 'btn d', onclick: async () => { if (await confirmBox(`Delete "${f.name}"?`, '', 'Delete', true)) { await call('formats.remove', f.id); fmtSel = null; RENDER.formats(); } } }, 'Delete') : null,
      h('button', { class: 'btn', onclick: () => { S.writerPreset = { formatId: f.id }; go('writer'); } }, 'Write with this format'))));
}
async function clipStudyModal(file) {
  const f = file || (await call('dialog.file', { title: 'Choose a viral clip (video file)', filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'm4v'] }] }));
  if (!f) return;
  const nameIn = h('input', { type: 'text', placeholder: 'Format name (optional)' });
  const out = h('div');
  modal([h('h2', { text: 'Learn a structure from a viral clip' }), h('div', { class: 'muted small', text: `${base(f)}: the whole clip is read (timed speech, frames, cut pacing). This uses the local AI for a few minutes.` }),
    field('Name', nameIn), out,
    h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: closeModal }, 'Close'), h('button', { class: 'btn p', onclick: async (e) => {
      e.target.disabled = true;
      out.replaceChildren(h('div', { class: 'dim', id: 'clipStep', style: { marginTop: '10px' }, text: 'Starting...' }));
      try {
        const r = await call('study.clip', { file: f, name: nameIn.value.trim() || undefined });
        out.replaceChildren(h('div', { class: 'fi ok', style: { marginTop: '10px' } }, h('b', { text: `Saved format "${r.format.name}"` }), h('div', { class: 'small', text: `${r.cuts} cuts in ${Math.round(r.duration)} s. ${r.format.summary || ''}` })));
        fmtSel = r.format.id; S.libTab = 'formats'; if (S.view === 'library') RENDER.library();
      } catch (err) { out.replaceChildren(h('div', { class: 'fi err', text: err.message })); }
      e.target.disabled = false;
    } }, 'Study clip'))]);
}
pa.on('study:step', (t) => { const el = $('#clipStep') || $('#studyStep'); if (el) el.textContent = t; });

/* ================= WRITER ================= */
const W = { list: [], id: null, chat: null, status: '' };
const WMODES = [['script', 'Short video script'], ['longscript', 'Long YouTube script'], ['linkedin', 'LinkedIn post'], ['newsletter', 'Newsletter'], ['facebook', 'Facebook post'], ['caption', 'Captions'], ['thread', 'X / Threads thread'], ['free', 'Anything']];
RENDER.writer = async () => {
  W.list = await call('studio.list');
  if (S.writerPreset) { const c = await call('studio.create', S.writerPreset); W.id = c.id; S.writerPreset = null; W.list = await call('studio.list'); }
  if (W.id && !W.list.find((c) => c.id === W.id)) W.id = null;
  if (!W.id && W.list[0]) W.id = W.list[0].id;
  W.chat = W.id ? await call('studio.load', W.id) : null;
  const v = $('#view-writer');
  const left = h('div', { class: 'chatlist' },
    h('button', { class: 'btn p', style: { justifyContent: 'center' }, onclick: async () => { const c = await call('studio.create', { mode: W.chat?.mode || 'script' }); W.id = c.id; RENDER.writer(); } }, icon('plus', 16), 'New writing'),
    h('div', { class: 'row', style: { margin: '6px 0' } },
      h('button', { class: 'btn s', style: { flex: 1 }, onclick: () => draftsModal() }, 'Saved posts'),
      h('button', { class: 'btn s', style: { flex: 1 }, onclick: () => videoKitModal() }, 'Video kit')),
    ...W.list.map((c) => h('div', { class: `litem ${c.id === W.id ? 'on' : ''}`, onclick: () => { W.id = c.id; RENDER.writer(); } },
      h('span', { class: 'tt', text: c.title }), h('span', { class: 'tag', text: c.mode }),
      h('button', { class: 'btn ghost s', title: 'Delete', onclick: async (e) => { e.stopPropagation(); if (await confirmBox('Delete this writing chat?', c.title, 'Delete', true)) { await call('studio.remove', c.id); if (W.id === c.id) W.id = null; RENDER.writer(); } } }, icon('trash', 14)))));
  v.replaceChildren(h('div', { class: 'chatwrap' }, left, h('div', { class: 'chatmain', id: 'wMain' })));
  drawWriter();
};
async function drawWriter() {
  const main = $('#wMain');
  if (!main) return;
  const c = W.chat;
  if (!c) {
    main.replaceChildren(h('div', { class: 'welcome' }, h('h2', { class: 'gtext', text: 'Writer' }),
      h('div', { class: 'muted', text: 'Scripts, LinkedIn posts, newsletters and captions with your skills, formats and studies. Drop a video here for a full video kit.' }),
      h('div', { class: 'chips' }, ...WMODES.slice(0, 6).map(([m, l]) => h('button', { class: 'chip', onclick: async () => { const n = await call('studio.create', { mode: m }); W.id = n.id; RENDER.writer(); } }, l)))));
    return;
  }
  const [fmts, styles, studies] = await Promise.all([call('formats.list'), call('styles.list'), call('study.list')]);
  const upd = (patch) => call('studio.update', { id: c.id, patch }).then((x) => { W.chat = x; });
  const tools = h('div', { class: 'wtools' },
    sel(WMODES, c.mode, (x) => upd({ mode: x })),
    sel([['', 'No format'], ...fmts.map((f) => [f.id, `Format: ${f.name}`])], c.formatId, (x) => upd({ formatId: x })),
    sel([['', 'No caption style'], ...styles.map((s) => [s.id, `Style: ${s.name}`])], c.styleId, (x) => upd({ styleId: x })),
    sel([['', 'No study'], ...studies.map((s) => [s.id, `Study: ${s.title || s.url}`.slice(0, 60)])], c.studyId, (x) => upd({ studyId: x })),
    sel([['auto', 'Language: auto'], ['bn', 'Bangla'], ['en', 'English'], ['banglish', 'Banglish'], ['bn+en', 'Bangla + English']], c.language, (x) => upd({ language: x })),
    h('label', { class: 'chk small', title: 'Search the web before writing' }, h('input', { type: 'checkbox', checked: c.research, onchange: (e) => upd({ research: e.target.checked }) }), 'Web research'),
    h('button', { class: 'btn s', onclick: async () => { const fs = await call('dialog.files', { title: 'Attach videos, images or text files' }); for (const f of fs) await writerAttach(f); } }, icon('plus', 14), 'Attach'));
  const att = h('div', { class: 'attach' }, ...c.attachments.map((a) => h('span', { class: 'fchip', title: a.file }, a.name, h('button', { class: 'btn ghost s', onclick: async () => { W.chat = await call('studio.detach', { id: c.id, name: a.name }); drawWriter(); } }, 'x'))));
  const feed = h('div', { class: 'feed', id: 'wFeed' }, ...(c.messages.length ? c.messages.map(writerMsg) : [h('div', { class: 'empty', text: 'Tell me what to write. Example: "/short-video-pas script for my tea video in Bangla, 45 seconds". Type / for skills and formats.' })]));
  const ta = h('textarea', { rows: 2, placeholder: 'What should I write? Type / for skills, formats and styles. Drop a video or text file to attach it.' });
  ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendW(); } };
  const sendW = async () => {
    const t = ta.value.trim();
    if (!t || W.status) return;
    ta.value = '';
    W.chat.messages.push({ role: 'user', text: t, at: Date.now() });
    drawFeedOnly();
    await call('studio.send', { id: c.id, text: t });
  };
  main.replaceChildren(tools, att, feed, h('div', { class: 'statusline', id: 'wStatus', text: W.status }),
    h('div', { class: 'composer' }, h('div', { class: 'box' }, ta,
      h('button', { class: 'btn d', style: { display: W.status ? '' : 'none' }, id: 'wStop', onclick: () => call('studio.stop') }, 'Stop'),
      h('button', { class: 'btn p', onclick: sendW }, icon('send', 15), 'Write'))));
  attachSlash(ta);
  feed.scrollTop = feed.scrollHeight;
}
function writerMsg(m) {
  if (m.role === 'user') return h('div', { class: 'fi user', text: m.text });
  return h('div', { class: 'fi msg' }, md(m.text),
    m.used?.length ? h('div', { class: 'dim small', style: { marginTop: '6px' }, text: `Used: ${m.used.join(', ')}` }) : null,
    h('div', { class: 'msgact' },
      h('button', { class: 'btn s', onclick: () => { navigator.clipboard.writeText(m.text); toast('Copied', 'ok'); } }, 'Copy'),
      h('button', { class: 'btn s', onclick: async () => { const title = await promptBox('Save as post: title', m.text.split('\n')[0].replace(/[#*]/g, '').slice(0, 60)); if (title == null) return; const n = await call('studio.saveDraft', { title, text: m.text, kind: W.chat.mode }); toast(`Saved "${n}"`, 'ok'); } }, 'Save post')));
}
function drawFeedOnly() { const f = $('#wFeed'); if (!f || !W.chat) return; f.replaceChildren(...W.chat.messages.map(writerMsg)); f.scrollTop = f.scrollHeight; }
async function writerAttach(file) {
  if (!W.chat) { const c = await call('studio.create', {}); W.id = c.id; await RENDER.writer(); }
  W.status = `Reading ${base(file)}...`; const st = $('#wStatus'); if (st) st.textContent = W.status;
  try { W.chat = await call('studio.attach', { id: W.id, file, mode: 'smart' }); } finally { W.status = ''; }
  drawWriter();
}
DROP.writer = async (paths) => {
  const vids = paths.filter((p) => /\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(p));
  if (vids.length === 1 && paths.length === 1 && (!W.chat || !W.chat.messages.length)) return videoKitModal(vids[0]);
  for (const p of paths) await writerAttach(p);
};
pa.on('studio:update', (c) => { if (c.id === W.id) { W.chat = c; if (S.view === 'writer') drawFeedOnly(); } });
pa.on('studio:status', ({ id, status, error }) => {
  if (id === 'kit') { const el = $('#kitStep'); if (el) el.textContent = status; return; }
  W.status = status || '';
  const st = $('#wStatus'); if (st) st.textContent = W.status;
  const sb = $('#wStop'); if (sb) sb.style.display = W.status ? '' : 'none';
  if (error) toast(error, 'err');
});
async function draftsModal() {
  const list = await call('studio.drafts');
  const box = h('div', { class: 'col' });
  const open = async (d) => {
    const text = await call('studio.readDraft', d.name);
    const ta = h('textarea', { rows: 20, value: text, style: { width: '100%' } });
    box.replaceChildren(h('div', { class: 'row' }, h('b', { text: d.name }), h('div', { style: { flex: 1 } }), h('button', { class: 'btn s', onclick: () => { navigator.clipboard.writeText(ta.value.replace(/^---[\s\S]*?---\s*/, '')); toast('Copied', 'ok'); } }, 'Copy'), h('button', { class: 'btn s p', onclick: async () => { await call('studio.writeDraft', { name: d.name, text: ta.value }); toast('Saved', 'ok'); } }, 'Save'), h('button', { class: 'btn s', onclick: () => draftsModal() }, 'Back')), ta);
  };
  box.replaceChildren(...(list.length ? list.map((d) => h('div', { class: 'litem', onclick: () => open(d) }, h('span', { class: 'tt', text: d.name }), h('span', { class: 'dim small', text: fmtDate(d.updatedAt) }),
    h('button', { class: 'btn ghost s', onclick: async (e) => { e.stopPropagation(); if (await confirmBox(`Delete ${d.name}?`, '', 'Delete', true)) { await call('studio.removeDraft', d.name); draftsModal(); } } }, icon('trash', 14)))) : [h('div', { class: 'empty', text: 'No saved posts yet. Use "Save post" under any written text.' })]));
  modal([h('div', { class: 'row' }, h('h2', { style: { margin: 0, flex: 1 }, text: 'Saved posts' }), h('span', { class: 'dim small', text: S.settings.draftsDir || 'in the data folder' })), box], { wide: true });
}
async function videoKitModal(file) {
  const f = file || (await call('dialog.file', { title: 'Choose a video', filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi'] }] }));
  if (!f) return;
  const out = h('div', { class: 'col' });
  const lang = sel([['auto', 'Language: auto'], ['bn', 'Bangla'], ['en', 'English'], ['banglish', 'Banglish']], 'auto');
  const scan = sel([['full', 'Read the whole video'], ['smart', 'Smart (faster)']], 'full');
  modal([h('h2', { text: 'Video kit' }), h('div', { class: 'muted small', text: `${base(f)}: transcript, titles, thumbnail text, keywords, YouTube description, LinkedIn, Facebook, Instagram and X posts.` }),
    h('div', { class: 'row', style: { margin: '10px 0' } }, lang, scan, h('button', { class: 'btn p', onclick: async (e) => {
      e.target.disabled = true;
      out.replaceChildren(h('div', { class: 'dim', id: 'kitStep', text: 'Starting...' }));
      try {
        const k = await call('studio.videoKit', { file: f, language: lang.value, mode: scan.value });
        const block = (title, text) => h('div', { class: 'card' }, h('div', { class: 'row' }, h('h3', { style: { margin: 0, flex: 1 }, text: title }), h('button', { class: 'btn s', onclick: () => { navigator.clipboard.writeText(text); toast('Copied', 'ok'); } }, 'Copy')), h('div', { class: 'small', style: { whiteSpace: 'pre-wrap', marginTop: '6px' }, text }));
        out.replaceChildren(h('div', { class: 'fi ok' }, h('div', { text: `Saved as "${k.saved}" in Saved posts.` }),
            h('div', { class: 'row', style: { marginTop: '8px' } },
              h('button', { class: 'btn p s', onclick: () => targetsAndTime({ title: 'Post this video kit', intro: 'Each network gets its own text from the kit (YouTube: first title + description, Instagram/TikTok: Instagram caption, Facebook, LinkedIn, X).', files: [k.file], submitLabel: 'Post / schedule', onSubmit: async ({ targets, schedule, approval }) => { const j = await call('jobs.fromKit', { kit: k, targets, schedule, approval }); S.jobSel = j.id; go('monitor'); toast('Job started', 'ok'); } }) }, 'Post / schedule this'),
              h('button', { class: 'btn s', onclick: async () => { const c = await call('studio.fromKit', { kit: k }); closeModal(); W.id = c.id; go('writer'); } }, 'Continue in a Writer chat'))),
          block('Titles', k.titles.join('\n')), block('Thumbnail text', k.thumbnail_texts.join('\n')), block('Keywords', k.keywords.join(', ')),
          block('YouTube description', k.youtube_description), block('LinkedIn post', k.linkedin_post), block('Facebook status', k.facebook_status),
          block('Instagram caption', k.instagram_caption), block('X post', k.x_post), block('Transcript', k.transcript || '(no speech)'));
      } catch (err) { out.replaceChildren(h('div', { class: 'fi err', text: err.message })); }
      e.target.disabled = false;
    } }, 'Make kit')), out], { wide: true });
}

/* ================= COMPETITOR STUDY ================= */
let studySel = null;
RENDER.study = async () => {
  const list = await call('study.list');
  if (!studySel && list[0]) studySel = list[0].id;
  const v = $('#view-study');
  const accts = (await call('accounts.list')).filter((a) => !['chatgpt', 'gemini', 'claude'].includes(a.kind));
  const urlIn = h('input', { type: 'text', placeholder: 'Profile or channel link (Instagram, TikTok, YouTube, Facebook, LinkedIn, X)', style: { width: '100%' } });
  const postsIn = h('input', { type: 'number', min: 6, max: 80, value: 24, style: { width: '80px' } });
  const deepIn = h('input', { type: 'number', min: 0, max: 30, value: 8, style: { width: '70px' } });
  const viewWith = sel([['', 'View with: default browser'], ...accts.map((a) => [a.id, `View with: ${a.name}`])], '');
  const related = h('input', { type: 'checkbox', checked: true });
  const left = h('div', { class: 'left' },
    h('div', { class: 'card col' }, h('b', { text: 'New study' }), urlIn,
      h('div', { class: 'row small' }, 'Posts', postsIn, 'Open', deepIn), viewWith,
      h('label', { class: 'chk small' }, related, 'Also study top videos in the niche'),
      h('button', { class: 'btn p', onclick: async (e) => {
        if (!/^https?:\/\//.test(urlIn.value.trim())) { toast('Paste a full link (https://...)', 'warn'); return; }
        e.target.disabled = true;
        const right = $('#studyRight');
        right.replaceChildren(h('div', { class: 'col' }, h('div', { class: 'dim', id: 'studyStep', text: 'Starting...' }), h('div', { class: 'liveframe', id: 'studyFrame', style: { maxWidth: '760px' } }, 'The page shows here while it is read.')));
        try { const r = await call('study.profile', { url: urlIn.value.trim(), posts: Number(postsIn.value), deep: Number(deepIn.value), related: related.checked, accountId: viewWith.value || undefined }); studySel = r.id; RENDER.study(); }
        catch (err) { right.replaceChildren(h('div', { class: 'fi err', text: err.message })); }
        e.target.disabled = false;
      } }, 'Study profile'),
      h('button', { class: 'btn', onclick: () => clipStudyModal() }, 'Study a viral clip file')),
    h('div', { class: 'sect', text: 'Saved studies' }),
    ...list.map((s) => h('div', { class: `litem ${s.id === studySel ? 'on' : ''}`, onclick: () => { studySel = s.id; RENDER.study(); } }, h('span', { class: 'tt', text: s.title || s.url }), h('span', { class: 'tag', text: s.platform }))));
  v.replaceChildren(h('div', { class: 'head' }, h('h1', { text: 'Competitor study' }), h('span', { class: 'muted small', text: 'Learn the structure, strategy, posting times, hooks and story flow of any profile. Patterns only, never their words.' })),
    h('div', { class: 'split' }, left, h('div', { class: 'right', id: 'studyRight' })));
  if (studySel) drawStudy(await call('study.get', studySel));
  else $('#studyRight').replaceChildren(h('div', { class: 'empty', text: 'Paste a profile link to start.' }));
};
function drawStudy(s) {
  const r = $('#studyRight');
  if (!s) { r.replaceChildren(h('div', { class: 'empty', text: 'Study not found' })); return; }
  const st = s.stats || {};
  r.replaceChildren(h('div', { class: 'col', style: { maxWidth: '980px', gap: '12px' } },
    h('div', { class: 'row' }, h('h2', { style: { margin: 0, flex: 1 }, text: s.title || s.url }),
      h('button', { class: 'btn', onclick: async (e) => {
        const b = e.target; b.disabled = true; b.textContent = 'Making format...';
        try { const f = await call('study.toFormat', s.id); studyResult(`Format "${f.name}" saved in Library > Formats. Use it with /${String(f.name).toLowerCase().replace(/[^a-z0-9ঀ-৿]+/g, '-')} or pick it in Writer.`, () => { fmtSel = f.id; S.libTab = 'formats'; go('library'); }); }
        finally { b.disabled = false; b.textContent = 'Make a format'; }
      } }, 'Make a format'),
      h('button', { class: 'btn', onclick: async (e) => {
        const b = e.target; b.disabled = true; b.textContent = 'Learning style...';
        try { const r = await call('study.toStyle', s.id); studyResult(`Caption style "${r.style.name}" saved. ${r.insights || ''}`, async () => { await setSetting({ defaultStyle: r.style.id }); toast('Now the default caption style', 'ok'); }, 'Make it my default style'); }
        finally { b.disabled = false; b.textContent = 'Make a caption style'; }
      } }, 'Make a caption style'),
      h('button', { class: 'btn', onclick: async (e) => {
        const b = e.target; b.disabled = true; b.textContent = 'Making skill...';
        try { const k = await call('study.toSkill', s.id); studyResult(`Skill "${k.name}" saved and turned on. The chat and the writer follow it from now on. Edit it in Library > Skills.`, () => { S.libTab = 'skills'; go('library'); }, 'Open skill'); }
        finally { b.disabled = false; b.textContent = 'Make a skill'; }
      } }, 'Make a skill'),
      h('button', { class: 'btn', onclick: () => { S.writerPreset = { studyId: s.id, mode: 'script' }; go('writer'); } }, 'Write with this study'),
      h('button', { class: 'btn ghost', onclick: async () => { if (await confirmBox('Delete this study?', '', 'Delete', true)) { await call('study.remove', s.id); studySel = null; RENDER.study(); } } }, icon('trash', 15))),
    h('div', { class: 'dim small', text: `${s.url} · ${fmtDate(s.createdAt)} · viewed with ${s.viewedWith}` }),
    h('div', { id: 'studyResult' }),
    h('div', { class: 'stats', style: { gridTemplateColumns: 'repeat(4,1fr)' } },
      h('div', { class: 'stat' }, h('b', { text: String(st.posts ?? '-') }), h('span', { text: 'posts read' })),
      h('div', { class: 'stat' }, h('b', { text: st.postsPerWeek != null ? String(st.postsPerWeek) : '-' }), h('span', { text: 'posts per week' })),
      h('div', { class: 'stat' }, h('b', { text: (st.topHours || []).slice(0, 2).map((x) => x[0]).join(', ') || '-' }), h('span', { text: `top hours (${st.timezone || ''})` })),
      h('div', { class: 'stat' }, h('b', { text: (st.topDays || []).slice(0, 2).map((x) => x[0]).join(', ') || '-' }), h('span', { text: 'top days' }))),
    h('div', { class: 'card report' }, md(s.report)),
    st.topHashtags?.length ? h('div', { class: 'card' }, h('h3', { text: 'Hashtags used most' }), h('div', { class: 'row' }, ...st.topHashtags.map(([t, n]) => h('span', { class: 'tag', text: `${t} ${n}` })))) : null,
    s.related?.length ? h('div', { class: 'card' }, h('h3', { text: 'Top videos in this niche' }), ...s.related.map((x) => h('div', { class: 'small', style: { padding: '3px 0' } }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); call('shell.external', x.url); } }, x.title), h('span', { class: 'dim', text: `  ${x.meta.replace(/\s+/g, ' ')} · ${x.channel}` })))) : null));
}
function studyResult(text, action, actionLabel = 'Open') {
  const box = $('#studyResult');
  if (!box) { toast(text, 'ok', 8000); return; }
  box.replaceChildren(h('div', { class: 'fi ok' }, h('div', { text }), action ? h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn s p', onclick: action }, actionLabel)) : null));
}
pa.on('study:frame', (b64) => { const f = $('#studyFrame'); if (f) f.replaceChildren(h('img', { src: `data:image/jpeg;base64,${b64}` })); });
DROP.study = (paths) => { const v = paths.find((p) => /\.(mp4|mov|mkv|webm|m4v)$/i.test(p)); if (v) clipStudyModal(v); else toast('Drop a video file to study a clip.', 'warn'); };

/* ================= WORKFLOWS ================= */
let wfSel = null;
RENDER.workflows = async () => {
  const list = await call('workflows.list');
  if (!wfSel && list[0]) wfSel = list[0].id;
  const v = $('#view-workflows');
  const left = h('div', { class: 'left' },
    h('button', { class: 'btn p', style: { width: '100%', justifyContent: 'center' }, onclick: () => workflowModal() }, icon('plus', 16), 'New workflow'),
    h('div', { class: 'sect', text: 'Workflows' }),
    ...list.map((w) => h('div', { class: `jcard ${w.id === wfSel ? 'on' : ''}`, style: { marginBottom: '6px' }, onclick: () => { wfSel = w.id; RENDER.workflows(); } },
      h('div', { class: 'tt', text: w.name }),
      h('div', { class: 'dim small', text: `${w.stats.scheduled}/${w.stats.total} scheduled · ${w.stats.pending} left` }),
      h('div', { class: 'bar' }, h('div', { style: { width: `${w.stats.total ? Math.round((w.stats.scheduled / w.stats.total) * 100) : 0}%` } })))));
  v.replaceChildren(h('div', { class: 'head' }, h('h1', { text: 'Workflows' }), h('span', { class: 'muted small', text: 'Long posting plans for a folder. Schedule batches ("next 10") and track everything in a sheet on your PC.' })),
    h('div', { class: 'split' }, left, h('div', { class: 'right', id: 'wfRight' })));
  const w = list.find((x) => x.id === wfSel);
  if (!w) { $('#wfRight').replaceChildren(h('div', { class: 'empty', text: 'Create a workflow, or ask in Chat: "Make a workflow to post the 100 videos in my Reels folder every day at 8 PM, and schedule the first 10".' })); return; }
  const rows = await call('workflows.rows', w.id);
  const nIn = h('input', { type: 'number', min: 1, max: 100, value: w.batchSize, style: { width: '70px' } });
  $('#wfRight').replaceChildren(h('div', { class: 'col', style: { gap: '12px' } },
    h('div', { class: 'row' }, h('h2', { style: { margin: 0, flex: 1 }, text: w.name }),
      h('span', { class: 'small muted', text: 'Schedule next' }), nIn,
      h('button', { class: 'btn p', onclick: async () => { const j = await call('workflows.next', { id: w.id, count: Number(nIn.value) }); toast(`Job started: ${j.items.length} posts`, 'ok'); S.jobSel = j.id; go('monitor'); } }, 'Start'),
      h('button', { class: 'btn', onclick: () => call('workflows.openSheet', w.id) }, 'Open sheet'),
      h('button', { class: 'btn', onclick: () => workflowModal(w) }, 'Edit'),
      h('button', { class: 'btn ghost', onclick: async () => { if (await confirmBox(`Delete workflow "${w.name}"?`, 'The sheet file stays on your PC. Scheduled posts are not affected.', 'Delete', true)) { await call('workflows.remove', { id: w.id, keepSheet: true }); wfSel = null; RENDER.workflows(); } } }, icon('trash', 15))),
    h('div', { class: 'dim small', text: `${w.folder} · posts to ${w.targets.join(', ')} · ${w.cadence.times.join(', ')} every ${w.cadence.every} · sheet: ${w.sheet}` }),
    h('div', { class: 'stats', style: { gridTemplateColumns: 'repeat(4,1fr)' } }, ...[['total', 'files'], ['scheduled', 'scheduled'], ['pending', 'left'], ['failed', 'failed']].map(([k, l]) => h('div', { class: 'stat' }, h('b', { text: String(w.stats[k]) }), h('span', { text: l })))),
    h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ...['#', 'File', 'Status', 'Scheduled for', 'Accounts'].map((x) => h('th', { text: x })))),
      h('tbody', null, ...rows.slice(0, 400).map((r) => h('tr', null, h('td', { class: 'small dim', text: r.no }), h('td', { class: 'small', text: base(r.file) }), h('td', null, pill(r.status === 'scheduled' ? 'done' : r.status === 'queued' ? 'running' : r.status === 'waiting' ? 'paused' : r.status)), h('td', { class: 'small', text: r.scheduled_for }), h('td', { class: 'small dim', text: r.targets })))))));
};
async function workflowModal(w, presetFolder) {
  const accts = await call('accounts.list');
  const chans = accts.filter((a) => !['chatgpt', 'gemini', 'claude'].includes(a.kind)).flatMap((a) => (a.channels?.length ? a.channels.map((c) => `${a.name} ${c.name}`) : [a.name]));
  const st = w ? { ...w, targets: new Set(w.targets) } : { name: '', folder: presetFolder || S.settings.defaultMediaFolder || '', range: '', targets: new Set(), times: S.settings.timeSlots.join(', '), every: '1d', batchSize: 10, startDate: '', options: {} };
  const folderIn = h('input', { type: 'text', value: st.folder || '', style: { flex: 1 }, oninput: (e) => { st.folder = e.target.value; } });
  const instr = h('textarea', { rows: 2, value: st.options?.instructions || '', placeholder: 'Caption wishes for every post (optional)' });
  modal([h('h2', { text: w ? 'Edit workflow' : 'New workflow' }), h('div', { class: 'col' },
    field('Name', h('input', { type: 'text', value: st.name, placeholder: 'e.g. Cooking reels 100 days', oninput: (e) => { st.name = e.target.value; } })),
    w ? null : field('Folder', h('div', { class: 'row' }, folderIn, h('button', { class: 'btn', onclick: async () => { const d = await call('dialog.folder', 'Folder with the videos'); if (d) { folderIn.value = d; st.folder = d; } } }, 'Browse'))),
    w ? null : field('Only files numbered (optional)', h('input', { type: 'text', placeholder: '1-100', oninput: (e) => { st.range = e.target.value; } })),
    field('Post to', h('div', { class: 'chipsel' }, ...(chans.length ? chans.map((c) => h('label', null, h('input', { type: 'checkbox', checked: st.targets.has(c), onchange: (e) => (e.target.checked ? st.targets.add(c) : st.targets.delete(c)) }), c)) : [h('span', { class: 'dim small', text: 'Add accounts first (Accounts page).' })]))),
    h('div', { class: 'formgrid' },
      field('Daily times', h('input', { type: 'text', value: Array.isArray(st.times) ? st.times.join(', ') : st.cadence?.times?.join(', ') || st.times, oninput: (e) => { st.times = e.target.value; } })),
      field('Repeat', sel([['1d', 'Every day'], ['2d', 'Every 2 days'], ['3d', 'Every 3 days'], ['1w', 'Every week']], st.cadence?.every || st.every, (x) => { st.every = x; })),
      field('Default batch size', h('input', { type: 'number', min: 1, max: 100, value: st.batchSize, oninput: (e) => { st.batchSize = Number(e.target.value); } })),
      field('Start (optional)', h('input', { type: 'text', value: st.startDate || '', placeholder: 'YYYY-MM-DD HH:mm', oninput: (e) => { st.startDate = e.target.value; } }))),
    field('Instructions', instr)),
  h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn p', onclick: async () => {
    const times = String(st.times || '').split(/[,\s]+/).filter(Boolean);
    const cadence = { times: times.length ? times : undefined, every: st.every || st.cadence?.every || '1d' };
    const options = { ...(st.options || {}), instructions: instr.value.trim() };
    if (!st.targets.size) { toast('Choose where to post', 'warn'); return; }
    const r = w ? await call('workflows.update', { id: w.id, patch: { name: st.name, targets: [...st.targets], cadence, batchSize: st.batchSize, startDate: st.startDate, options } })
      : await call('workflows.create', { name: st.name, folder: st.folder, filter: { range: st.range }, targets: [...st.targets], cadence, batchSize: st.batchSize, startDate: st.startDate, options });
    wfSel = r.id; closeModal(); RENDER.workflows();
  } }, w ? 'Save' : 'Create'))], { wide: true });
}
DROP.workflows = (paths) => { const p = paths[0]; workflowModal(null, /\.[a-z0-9]{2,4}$/i.test(p) ? p.replace(/[\\/][^\\/]+$/, '') : p); };

/* ================= target + time picker (shared by New job and Video kit) ================= */
async function targetsAndTime({ title, intro, files = [], allowText = false, submitLabel = 'Start', onSubmit }) {
  const accts = (await call('accounts.list')).filter((a) => !['chatgpt', 'gemini', 'claude'].includes(a.kind));
  const opts = accts.flatMap((a) => (a.channels?.length ? a.channels.map((c) => ({ key: `${a.name} ${c.name}`, label: `${c.name} · ${c.service}`, acc: a.name })) : [{ key: a.name, label: a.name, acc: a.name }]));
  const chosen = new Set();
  const pad = (n) => String(n).padStart(2, '0');
  const tm = new Date(Date.now() + 86400000);
  const st = { mode: 'custom', date: `${tm.getFullYear()}-${pad(tm.getMonth() + 1)}-${pad(tm.getDate())}`, time: (S.settings.timeSlots || ['19:00'])[0], times: (S.settings.timeSlots || ['19:00']).join(', '), every: '1d', approval: S.settings.mode };
  const dateIn = h('input', { type: 'date', value: st.date, oninput: (e) => { st.date = e.target.value; preview(); } });
  const timesIn = h('input', { type: 'text', value: st.times, placeholder: '19:00 or 10:00, 19:00', oninput: (e) => { st.times = e.target.value; preview(); } });
  const prev = h('div', { class: 'dim small' });
  const textTa = allowText ? h('textarea', { rows: 4, placeholder: 'Text-only posts (optional): one post per block, separate posts with a line containing ---' }) : null;
  const spec = () => (st.mode !== 'custom' ? { mode: st.mode } : { mode: 'custom', start: `${st.date} ${String(st.times).split(/[,\s]+/)[0] || '19:00'}`, times: String(st.times).split(/[,\s]+/).filter(Boolean), every: st.every });
  const count = () => Math.max(1, files.length + (textTa ? textTa.value.split(/\n\s*---+\s*\n/).filter((x) => x.trim()).length : 0));
  const preview = async () => {
    if (st.mode !== 'custom') { prev.textContent = { now: 'Posts go out right away.', queue: 'Added to the Buffer queue (next free slots).', draft: 'Saved as drafts in Buffer.' }[st.mode]; return; }
    const t = await call('jobs.previewTimes', { schedule: spec(), count: count() }, { quiet: true }).catch(() => []);
    prev.textContent = t.slice(0, 8).map((x) => x.text.replace(/ \(.*\)$/, '')).join('  |  ') + (t.length > 8 ? ' ...' : '');
  };
  const timeRow = h('div', { class: 'formgrid' }, field('First day', dateIn), field('Times each day', timesIn, 'e.g. 19:00 or 10:00, 19:00'),
    field('Repeat', sel([['1d', 'Every day'], ['2d', 'Every 2 days'], ['3d', 'Every 3 days'], ['1w', 'Every week']], st.every, (x) => { st.every = x; preview(); })));
  modal([h('h2', { text: title }), intro ? h('div', { class: 'muted small', style: { marginBottom: '10px' }, text: intro }) : null,
    h('div', { class: 'col' },
      field('Post to', h('div', { class: 'chipsel' }, ...(opts.length ? opts.map((o) => h('label', { title: o.acc }, h('input', { type: 'checkbox', onchange: (e) => (e.target.checked ? chosen.add(o.key) : chosen.delete(o.key)) }), o.label)) : [h('span', { class: 'dim small', text: 'Add a Buffer account first (Accounts page).' })]))),
      field('When', seg([['custom', 'Pick days and times'], ['now', 'Now'], ['queue', 'Buffer queue'], ['draft', 'Draft']], st.mode, (x) => { st.mode = x; timeRow.style.display = x === 'custom' ? '' : 'none'; preview(); })),
      timeRow, prev,
      textTa ? field('Text posts', textTa) : null,
      field('Approval', sel([['once', 'Ask once for the job'], ['every', 'Ask for every post'], ['autopilot', 'Autopilot']], st.approval, (x) => { st.approval = x; }))),
    h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn p', onclick: async (e) => {
      if (!chosen.size) { toast('Choose where to post', 'warn'); return; }
      e.target.disabled = true;
      try { await onSubmit({ targets: [...chosen], schedule: spec(), approval: st.approval, texts: textTa ? textTa.value.split(/\n\s*---+\s*\n/).map((x) => x.trim()).filter(Boolean) : [] }); closeModal(); }
      finally { e.target.disabled = false; }
    } }, submitLabel))], { wide: true });
  if (textTa) textTa.oninput = () => preview();
  preview();
}

// New posting job (button in Monitor): files and/or text posts, then the shared picker
async function newJobModal() {
  const st = { files: [] };
  const folderIn = h('input', { type: 'text', placeholder: 'Folder name or path', style: { flex: 1 } });
  const rangeIn = h('input', { type: 'text', placeholder: 'Numbers, e.g. 1-10', style: { width: '150px' } });
  const box = h('div', { class: 'filelist' }, h('div', { class: 'dim', text: 'No files yet (you can also post text only)' }));
  const draw = () => box.replaceChildren(...(st.files.length ? st.files.map((f) => h('div', { title: f, text: base(f) })) : [h('div', { class: 'dim', text: 'No files yet (you can also post text only)' })]));
  modal([h('h2', { text: 'New posting job: files' }), h('div', { class: 'col' },
    h('div', { class: 'row' }, folderIn, rangeIn, h('button', { class: 'btn', onclick: async () => { try { const r = await call('files.list', { folder: folderIn.value, range: rangeIn.value }); st.files = r.files; draw(); } catch (_) { /* toast shown */ } } }, 'Load'),
      h('button', { class: 'btn', onclick: async () => { const f = await call('dialog.files', { title: 'Choose videos or images' }); if (f.length) { st.files = f; draw(); } } }, 'Pick files')), box),
  h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn p', onclick: () => {
    closeModal();
    targetsAndTime({ title: 'Where and when', intro: `${st.files.length} file(s). Captions are written in your default style unless you add wishes in Chat.`, files: st.files, allowText: true, onSubmit: async ({ targets, schedule, approval, texts }) => {
      if (!st.files.length && !texts.length) { toast('Add files or text posts', 'warn'); throw new Error('nothing'); }
      const j = await call('jobs.create', { files: st.files, texts, targets, schedule, approval, options: {} });
      S.jobSel = j.id; go('monitor'); toast('Job started', 'ok');
    } });
  } }, 'Next'))], { wide: true });
}


/* ================= LIBRARY: tones, structures, boosters (ready-made + your own) ================= */
RENDER.craft = async () => {
  const body = $('#view-craft');
  const [tones, structures, boosters] = await Promise.all(['tone', 'structure', 'booster'].map((k) => call('craft.list', k)));
  const edit = (kind, item) => {
    const f = { ...(item || {}), steps: (item?.steps || []).join('\n') };
    const isS = kind === 'structure';
    modal([h('h2', { text: (item ? 'Edit ' : 'New ') + (isS ? 'structure' : kind) }),
      h('div', { class: 'col' },
        field('Name', h('input', { type: 'text', value: f.name || '', placeholder: isS ? 'e.g. My launch caption' : 'e.g. Cocky coach', oninput: (e) => { f.name = e.target.value; } })),
        isS ? field('Steps, one per line (in order)', h('textarea', { rows: 7, value: f.steps, placeholder: 'Line 1: a hook about the result\nNext: one detail\nLast: one ask', oninput: (e) => { f.steps = e.target.value; } }))
          : field('How it should sound', h('textarea', { rows: 4, value: f.prompt || '', placeholder: 'Describe the voice in one or two sentences. It goes straight into the caption prompt.', oninput: (e) => { f.prompt = e.target.value; } }), 'Keep it short: shorter prompts are faster and cheaper for the AI.')),
      h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn p', onclick: async () => { await call('craft.save', { kind, item: { ...f, source: item?.source } }); closeModal(); RENDER.craft(); } }, 'Save'))]);
  };
  const card = (kind, x) => h('div', { class: 'card' },
    h('div', { class: 'row' }, h('b', { style: { flex: 1 }, text: x.name }), h('span', { class: 'kbd', text: '/' + x.id }), h('span', { class: 'tag', text: x.source })),
    h('div', { class: 'small muted', style: { margin: '6px 0', whiteSpace: 'pre-wrap' }, text: kind === 'structure' ? x.steps.map((y, i) => (i + 1) + '. ' + y).join('\n') : x.prompt }),
    h('div', { class: 'row' },
      h('button', { class: 'btn s', onclick: () => edit(kind, x) }, x.source === 'preset' ? 'Copy and edit' : 'Edit'),
      kind === 'tone' ? h('button', { class: 'btn s', onclick: async () => { await setSetting({ captionTone: x.id }); toast('Default tone: ' + x.name, 'ok'); } }, 'Make default') : null,
      kind === 'structure' ? h('button', { class: 'btn s', onclick: async () => { await setSetting({ captionStructure: x.id }); toast('Default structure: ' + x.name, 'ok'); } }, 'Make default') : null,
      x.source === 'custom' ? h('button', { class: 'btn s d', onclick: async () => { if (await confirmBox('Delete "' + x.name + '"?', '', 'Delete', true)) { await call('craft.remove', { kind, id: x.id }); RENDER.craft(); } } }, 'Delete') : null));
  body.replaceChildren(h('div', { class: 'scroll pad' }, h('div', { class: 'col', style: { gap: '22px', maxWidth: '1200px' } },
    h('div', { class: 'dim small', text: 'Pick them in Settings, per job in chat ("make them aggressive, use AIDA"), or type / in any chat: /aggressive, /aida. Add your own with the buttons.' }),
    h('div', null, h('div', { class: 'row', style: { marginBottom: '10px' } }, h('h3', { style: { margin: 0, flex: 1 }, text: 'Tones' }), h('button', { class: 'btn p s', onclick: () => edit('tone') }, icon('plus', 14), 'Add tone')), h('div', { class: 'grid2' }, ...tones.map((x) => card('tone', x)))),
    h('div', null, h('div', { class: 'row', style: { marginBottom: '10px' } }, h('h3', { style: { margin: 0, flex: 1 }, text: 'Caption structures' }), h('button', { class: 'btn p s', onclick: () => edit('structure') }, icon('plus', 14), 'Add structure')), h('div', { class: 'grid2' }, ...structures.map((x) => card('structure', x)))),
    h('div', null, h('div', { class: 'row', style: { marginBottom: '10px' } }, h('h3', { style: { margin: 0, flex: 1 }, text: 'Engagement boosters' }), h('button', { class: 'btn p s', onclick: () => edit('booster') }, icon('plus', 14), 'Add booster')), h('div', { class: 'grid2' }, ...boosters.map((x) => card('booster', x)))))));
};
