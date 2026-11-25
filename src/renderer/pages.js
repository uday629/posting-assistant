/* Posting Assistant - renderer pages: Styles, Skills, Knowledge, Accounts, AI models, Settings. */
'use strict';
/* global pa, h, $, call, toast, modal, closeModal, confirmBox, promptBox, field, sel, seg, md, icon, fmtBytes, fmtDate, base, go, S, RENDER, setSetting, loadSettings, pill */

/* ================= CAPTION STYLES ================= */
let styleSel = null;
RENDER.styles = async () => {
  const list = await call('styles.list');
  if (!styleSel || !list.find((s) => s.id === styleSel)) styleSel = S.settings.defaultStyle || list[0]?.id;
  const v = $('#view-styles');
  const left = h('div', { class: 'left' },
    h('div', { class: 'col' },
      h('button', { class: 'btn p', onclick: () => { styleSel = '__new'; drawStyle(list); } }, icon('plus', 16), 'New style'),
      h('button', { class: 'btn', onclick: () => learnModal() }, 'Learn a style from captions')),
    h('div', { class: 'sect', text: 'Styles' }),
    ...list.map((s) => h('div', { class: `litem ${s.id === styleSel ? 'on' : ''}`, onclick: () => { styleSel = s.id; RENDER.styles(); } },
      h('span', { class: 'tt', text: s.name }), s.id === S.settings.defaultStyle ? h('span', { class: 'tag fits', text: 'default' }) : h('span', { class: 'tag', text: s.source }))));
  v.replaceChildren(h('div', { class: 'head' }, h('h1', { text: 'Caption styles' }), h('span', { class: 'muted small', text: 'How captions sound. Pick a preset, write your own, or learn one from your account or a creator.' })),
    h('div', { class: 'split' }, left, h('div', { class: 'right', id: 'styleRight' })));
  drawStyle(list);
};
function drawStyle(list) {
  const r = $('#styleRight');
  const s = styleSel === '__new' ? { id: '', name: '', language: 'auto', tone: '', length: 'medium', emoji: 'light', hashtagCount: 5, hook: '', structure: '', cta: '', dos: [], donts: [], examples: [], fixedHashtags: [], signature: '' } : list.find((x) => x.id === styleSel);
  if (!s) { r.replaceChildren(h('div', { class: 'empty', text: 'Pick a style' })); return; }
  const f = { ...s };
  const inp = (k, ph) => h('input', { type: 'text', value: f[k] || '', placeholder: ph || '', oninput: (e) => { f[k] = e.target.value; } });
  const area = (k, rows = 3, ph) => h('textarea', { rows, value: Array.isArray(f[k]) ? f[k].join('\n') : f[k] || '', placeholder: ph || '', oninput: (e) => { f[k] = e.target.value; } });
  const testOut = h('div', { class: 'col' });
  r.replaceChildren(h('div', { class: 'col', style: { maxWidth: '900px', gap: '14px' } },
    h('div', { class: 'row' }, h('h2', { style: { margin: 0 }, text: s.name || 'New style' }), s.learnedFrom ? h('span', { class: 'dim small', text: `learned from ${s.learnedFrom}` }) : null),
    h('div', { class: 'formgrid' },
      field('Name', inp('name', 'e.g. My cooking page')),
      field('Language', sel([['auto', 'Auto (match video)'], ['bn', 'Bangla'], ['en', 'English'], ['banglish', 'Banglish'], ['bn+en', 'Bangla + English']], f.language, (x) => { f.language = x; })),
      field('Length', sel(['short', 'medium', 'long'], f.length, (x) => { f.length = x; })),
      field('Emoji', sel(['none', 'light', 'medium', 'heavy'], f.emoji, (x) => { f.emoji = x; })),
      field('Hashtags', h('input', { type: 'number', min: 0, max: 30, value: f.hashtagCount, oninput: (e) => { f.hashtagCount = Number(e.target.value); } })),
      h('div', { class: 'wide' }, field('Tone', inp('tone', 'warm, funny, professional...'))),
      h('div', { class: 'wide' }, field('Hook (first line)', area('hook', 2))),
      h('div', { class: 'wide' }, field('Structure', area('structure', 2))),
      h('div', { class: 'wide' }, field('Call to action', inp('cta'))),
      field('Do (one per line)', area('dos', 4)), field('Avoid (one per line)', area('donts', 4)),
      field('Always use these hashtags', area('fixedHashtags', 2, '#mybrand')), field('Signature line', inp('signature', 'e.g. Follow @mypage for more')),
      h('div', { class: 'wide' }, field('Example captions (one block per example, separated by a blank line)', h('textarea', { rows: 6, value: (f.examples || []).join('\n\n'), oninput: (e) => { f.examples = e.target.value.split(/\n{2,}/); } })))),
    h('div', { class: 'row' },
      h('button', { class: 'btn p', onclick: async () => { const toArr = (x) => (Array.isArray(x) ? x : String(x || '').split('\n')); const saved = await call('styles.save', { ...f, dos: toArr(f.dos), donts: toArr(f.donts), fixedHashtags: toArr(f.fixedHashtags) }); styleSel = saved.id; toast('Style saved', 'ok'); RENDER.styles(); } }, s.source === 'preset' ? 'Save as my copy' : 'Save'),
      s.id ? h('button', { class: 'btn', onclick: async () => { await setSetting({ defaultStyle: s.id }); toast(`"${s.name}" is the default style`, 'ok'); RENDER.styles(); } }, 'Make default') : null,
      s.id ? h('button', { class: 'btn', onclick: async () => {
        const file = await call('dialog.file', { title: 'Pick a video or image to test this style', filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'mkv', 'webm', 'jpg', 'jpeg', 'png', 'webp'] }] });
        if (!file) return;
        testOut.replaceChildren(h('div', { class: 'dim', text: 'Writing a test caption...' }));
        try { const c = await call('styles.sample', { style: s.id, file, platform: 'instagram' }); const p = Object.values(c.platforms)[0]; testOut.replaceChildren(h('div', { class: 'card' }, h('h3', { text: `Test caption (${c.language})` }), h('div', { style: { whiteSpace: 'pre-wrap' }, text: p.text }))); }
        catch (e) { testOut.replaceChildren(h('div', { class: 'fi err', text: e.message })); }
      } }, 'Test on a video') : null,
      s.source !== 'preset' && s.id ? h('button', { class: 'btn d', onclick: async () => { if (await confirmBox(`Delete style "${s.name}"?`, '', 'Delete', true)) { await call('styles.remove', s.id); styleSel = null; RENDER.styles(); } } }, 'Delete') : null),
    testOut));
}
async function learnModal() {
  const st = { source: 'buffer', url: '', text: '', name: '' };
  const chans = await call('buffer.channels', null, { quiet: true }).catch(() => ({ list: [] }));
  const body = h('div', { class: 'col' });
  const chanSel = sel([['', 'All channels'], ...(chans.list || []).map((c) => [c.id, `${c.name} (${c.service})`])], '');
  const urlIn = h('input', { type: 'text', placeholder: 'https://www.instagram.com/<creator>/ or https://www.youtube.com/@channel/videos', style: { width: '100%' } });
  const txt = h('textarea', { rows: 10, placeholder: 'Paste 5-30 captions, separated by a line with ---', style: { width: '100%' } });
  const nameIn = h('input', { type: 'text', placeholder: 'Style name (optional)' });
  const draw = () => body.replaceChildren(
    seg([['buffer', 'My Buffer posts'], ['url', 'A profile / channel link'], ['text', 'Paste captions']], st.source, (x) => { st.source = x; draw(); }),
    st.source === 'buffer' ? field('Account', chanSel, chans.list?.length ? 'Reads your sent posts through the Buffer API.' : 'Connect Buffer in Accounts first.') : null,
    st.source === 'url' ? field('Link', urlIn, 'Opened in the app browser (signed in if you signed in under Accounts). The app reads the visible captions and learns the pattern, it never copies the words.') : null,
    st.source === 'text' ? field('Captions', txt) : null,
    field('Name', nameIn));
  draw();
  const out = h('div');
  modal([h('h2', { text: 'Learn a caption style' }), body, out,
    h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: closeModal }, 'Close'), h('button', { class: 'btn p', onclick: async (e) => {
      e.target.disabled = true;
      out.replaceChildren(h('div', { class: 'dim', style: { marginTop: '10px' }, text: 'Studying captions... this can take a minute.' }));
      try {
        const r = await call('styles.learn', { source: st.source, channelId: chanSel.value || undefined, url: urlIn.value.trim(), text: txt.value, name: nameIn.value.trim() || undefined });
        styleSel = r.style.id;
        out.replaceChildren(h('div', { class: 'fi ok', style: { marginTop: '10px' } }, h('b', { text: `Learned "${r.style.name}" from ${r.count} captions.` }), h('div', { class: 'small', style: { marginTop: '6px' }, text: r.insights })));
        RENDER.styles();
      } catch (err) { out.replaceChildren(h('div', { class: 'fi err', style: { marginTop: '10px' }, text: err.message })); }
      e.target.disabled = false;
    } }, 'Learn'))], { wide: true });
}

/* ================= SKILLS ================= */
let skillSel = null;
RENDER.skills = async () => {
  const list = await call('skills.list');
  if (!skillSel || !list.find((s) => s.id === skillSel)) skillSel = list[0]?.id;
  const v = $('#view-skills');
  const left = h('div', { class: 'left' },
    h('div', { class: 'col' }, h('button', { class: 'btn p', onclick: () => importSkillModal() }, 'Import from GitHub'), h('button', { class: 'btn', onclick: async () => { const f = await call('dialog.file', { title: 'Choose a skill ZIP', filters: [{ name: 'ZIP', extensions: ['zip'] }] }); if (f) zipSkillModal(f); } }, 'Install from ZIP (or drop it here)'), h('button', { class: 'btn', onclick: async () => { const s = await call('skills.save', { name: 'My writing rules', description: 'My own rules', body: '# My writing rules\n\n- ', summary: '', appliesTo: ['caption'] }); skillSel = s.id; RENDER.skills(); } }, icon('plus', 16), 'Write my own')),
    h('div', { class: 'sect', text: 'Skills' }),
    ...list.map((s) => h('div', { class: `litem ${s.id === skillSel ? 'on' : ''}`, onclick: () => { skillSel = s.id; RENDER.skills(); } },
      h('span', { class: `dot ${s.enabled ? 'ok' : ''}` }), h('span', { class: 'tt', text: s.name }), h('span', { class: 'tag', text: s.source }))));
  v.replaceChildren(h('div', { class: 'head' }, h('h1', { text: 'Skills' }), h('span', { class: 'muted small', text: 'Writing guides the caption writer follows. Skills are text only: scripts from skill repos are never run.' })),
    h('div', { class: 'split' }, left, h('div', { class: 'right', id: 'skillRight' })));
  if (skillSel) drawSkill(await call('skills.get', skillSel));
};
function drawSkill(s) {
  const r = $('#skillRight');
  const f = { ...s };
  const bodyTa = h('textarea', { rows: 18, value: s.body, style: { width: '100%', fontFamily: 'Consolas,monospace', fontSize: '12.5px' }, oninput: (e) => { f.body = e.target.value; } });
  const sumTa = h('textarea', { rows: 8, value: s.summary || '', style: { width: '100%' }, oninput: (e) => { f.summary = e.target.value; } });
  r.replaceChildren(h('div', { class: 'col', style: { maxWidth: '980px', gap: '12px' } },
    h('div', { class: 'row' }, h('h2', { style: { margin: 0 }, text: s.name }), h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: s.enabled, onchange: async (e) => { await call('skills.toggle', { id: s.id, enabled: e.target.checked }); RENDER.skills(); } }), 'On')),
    h('div', { class: 'dim small' }, s.description, s.url ? ' · ' : '', s.url ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); call('shell.external', s.url); } }, s.url) : null, s.license ? ` · ${s.license} license` : ''),
    h('div', { class: 'formgrid' }, field('Name', h('input', { type: 'text', value: s.name, oninput: (e) => { f.name = e.target.value; } })),
      field('Used for', h('div', { class: 'chipsel' }, ...['caption', 'chat'].map((k) => h('label', null, h('input', { type: 'checkbox', checked: s.appliesTo.includes(k), onchange: (e) => { const set = new Set(f.appliesTo); e.target.checked ? set.add(k) : set.delete(k); f.appliesTo = [...set]; } }), k === 'caption' ? 'Caption writing' : 'Chat answers'))))),
    field('Short version used in prompts (keeps local models fast). Empty = the full text is used.', sumTa),
    field('Full skill text', bodyTa),
    h('div', { class: 'row' },
      h('button', { class: 'btn p', onclick: async () => { await call('skills.save', f); toast('Saved', 'ok'); RENDER.skills(); } }, 'Save'),
      h('button', { class: 'btn', onclick: async (e) => { e.target.disabled = true; try { const n = await call('skills.resummarize', s.id); sumTa.value = n.summary; f.summary = n.summary; toast('Short version rewritten', 'ok'); } finally { e.target.disabled = false; } } }, 'Make short version with AI'),
      ['builtin', 'github'].includes(s.source) ? null : h('button', { class: 'btn d', onclick: async () => { if (await confirmBox(`Delete "${s.name}"?`, '', 'Delete', true)) { await call('skills.remove', s.id); skillSel = null; RENDER.skills(); } } }, 'Delete'))));
}
async function importSkillModal() {
  const urlIn = h('input', { type: 'text', placeholder: 'https://github.com/owner/repo  or a link to a SKILL.md file', style: { width: '100%' } });
  const out = h('div', { class: 'col', style: { marginTop: '10px' } });
  const find = async () => {
    out.replaceChildren(h('div', { class: 'dim', text: 'Looking...' }));
    try {
      const d = await call('skills.discover', urlIn.value.trim());
      if (!d.files.length) { out.replaceChildren(h('div', { class: 'dim', text: 'No Markdown skill files found there.' })); return; }
      out.replaceChildren(h('div', { class: 'dim small', text: `${d.owner}/${d.repo} (${d.branch}) · license: ${d.license || 'unknown'} · pick a file to review:` }),
        ...d.files.map((f) => h('div', { class: 'litem', onclick: () => review(d, f.path) }, h('span', { class: 'tt', text: f.path }), f.size ? h('span', { class: 'dim small', text: fmtBytes(f.size) }) : null)));
    } catch (e) { out.replaceChildren(h('div', { class: 'fi err', text: e.message })); }
  };
  const review = async (d, p) => {
    out.replaceChildren(h('div', { class: 'dim', text: 'Downloading for review...' }));
    try {
      const r = await call('skills.review', { owner: d.owner, repo: d.repo, branch: d.branch, path: p });
      const high = r.flags.some((f) => f.level === 'high');
      out.replaceChildren(
        h('div', { class: 'row' }, h('b', { text: r.name }), h('span', { class: 'dim small', text: r.description.slice(0, 160) })),
        r.flags.length ? h('div', null, ...r.flags.map((f) => h('div', { class: `flag ${f.level}`, text: `${f.level.toUpperCase()}: ${f.what}${f.sample ? ` - "${f.sample}"` : ''}` }))) : h('div', { class: 'flag low', text: 'Safety check: nothing suspicious found.' }),
        h('div', { class: 'bodyprev', text: r.text.slice(0, 20000) }),
        h('div', { class: 'row' },
          h('button', { class: `btn ${high ? 'd' : 'p'}`, onclick: async (e) => {
            if (high && !(await confirmBox('Import anyway?', 'This skill has HIGH risk parts. It is only used as writing guidance (never run), and the short version keeps only writing advice. Import only if you trust the author.', 'Import', true))) return;
            e.target.disabled = true;
            out.append(h('div', { class: 'dim', text: 'Importing and writing a short version...' }));
            const s = await call('skills.import', { text: r.text, name: r.name, description: r.description, url: r.url, license: d.license });
            skillSel = s.id; closeModal(); toast(`Imported "${s.name}"`, 'ok'); RENDER.skills();
          } }, high ? 'Import anyway' : 'Import this skill'),
          h('button', { class: 'btn', onclick: find }, 'Back')));
    } catch (e) { out.replaceChildren(h('div', { class: 'fi err', text: e.message })); }
  };
  modal([h('h2', { text: 'Import a skill from GitHub' }), h('div', { class: 'muted small', style: { marginBottom: '10px' }, text: 'The file is checked for hidden instructions, keys, links and scripts before you decide. Only the text is stored.' }),
    h('div', { class: 'row' }, urlIn, h('button', { class: 'btn p', onclick: find }, 'Find')), out], { wide: true });
}

/* ================= KNOWLEDGE ================= */
let kbTab = 'info';
RENDER.knowledge = async () => {
  const v = $('#view-knowledge');
  const body = h('div', { class: 'scroll pad', id: 'kbBody' });
  v.replaceChildren(h('div', { class: 'head' }, h('h1', { text: 'Knowledge' }), h('span', { class: 'muted small', text: 'Info the writer uses, your documents, and where things are on this PC.' })),
    h('div', { class: 'tabs' }, ...[['info', 'Info'], ['docs', 'Documents'], ['locations', 'PC locations']].map(([id, l]) => h('button', { class: kbTab === id ? 'on' : '', onclick: () => { kbTab = id; RENDER.knowledge(); } }, l))), body);
  if (kbTab === 'info') drawNotes(body); else if (kbTab === 'docs') drawDocs(body); else drawLocations(body);
};
async function drawNotes(body) {
  const notes = await call('kb.notes');
  const edit = (n = { title: '', text: '', tags: [], always: false }) => {
    const f = { ...n };
    modal([h('h2', { text: n.id ? 'Edit info' : 'New info' }), h('div', { class: 'col' },
      field('Title', h('input', { type: 'text', value: f.title, placeholder: 'e.g. Brand details, Winter offer, Audience', oninput: (e) => { f.title = e.target.value; } })),
      field('Text', h('textarea', { rows: 10, value: f.text, placeholder: 'Facts the caption writer may use: brand name, products, prices, links, phone, audience, tone...', oninput: (e) => { f.text = e.target.value; } })),
      field('Tags (comma separated)', h('input', { type: 'text', value: (f.tags || []).join(', '), oninput: (e) => { f.tags = e.target.value; } })),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: f.always, onchange: (e) => { f.always = e.target.checked; } }), 'Use in every caption')),
    h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn p', onclick: async () => { await call('kb.saveNote', f); closeModal(); RENDER.knowledge(); } }, 'Save'))], { wide: true });
  };
  body.replaceChildren(h('div', { class: 'row', style: { marginBottom: '14px' } }, h('button', { class: 'btn p', onclick: () => edit() }, icon('plus', 16), 'Add info')),
    notes.length ? h('div', { class: 'grid2' }, ...notes.map((n) => h('div', { class: 'card' }, h('div', { class: 'row' }, h('h3', { style: { margin: 0, flex: 1 }, text: n.title }), n.always ? h('span', { class: 'tag fits', text: 'every caption' }) : null),
      h('div', { class: 'small muted', style: { whiteSpace: 'pre-wrap', maxHeight: '140px', overflow: 'hidden', margin: '8px 0' }, text: n.text }),
      h('div', { class: 'row' }, ...(n.tags || []).map((t) => h('span', { class: 'tag', text: t })), h('div', { style: { flex: 1 } }), h('button', { class: 'btn s', onclick: () => edit(n) }, 'Edit'), h('button', { class: 'btn s d', onclick: async () => { if (await confirmBox('Delete this info?', n.title, 'Delete', true)) { await call('kb.removeNote', n.id); RENDER.knowledge(); } } }, 'Delete'))))) : h('div', { class: 'empty', text: 'No info yet. Add your brand details, offers, links and audience so captions are accurate.' }));
}
async function drawDocs(body) {
  const docs = await call('kb.docs');
  const openDoc = async (d) => {
    const r = await call('kb.readDoc', d.name);
    if (r.binary) { call('kb.openDoc', d.name); return; }
    const ta = h('textarea', { rows: 22, value: r.text, style: { width: '100%', fontFamily: 'Consolas,monospace', fontSize: '12.5px' } });
    modal([h('h2', { text: d.name }), ta, h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: closeModal }, 'Close'), h('button', { class: 'btn p', onclick: async () => { await call('kb.writeDoc', { name: d.name, text: ta.value }); closeModal(); toast('Saved', 'ok'); RENDER.knowledge(); } }, 'Save'))], { wide: true });
  };
  body.replaceChildren(
    h('div', { class: 'row', style: { marginBottom: '14px' } },
      h('button', { class: 'btn p', onclick: async () => { const added = await call('kb.addDocs'); if (added.length) { toast(`Added ${added.length} document(s)`, 'ok'); RENDER.knowledge(); } } }, icon('plus', 16), 'Add documents'),
      h('button', { class: 'btn', onclick: async () => { const n = await promptBox('New document name', 'notes.md'); if (n) { await call('kb.writeDoc', { name: n, text: '' }); RENDER.knowledge(); } } }, 'New text document'),
      h('button', { class: 'btn ghost', onclick: () => call('shell.openFolder', `${S.settings.dataRoot}\\knowledge\\docs`) }, icon('folder', 15), 'Open folder'),
      h('span', { class: 'dim small', text: 'Text documents (txt, md, csv, json, srt) are searched by the writer and the chat.' })),
    docs.length ? h('div', { class: 'fgrid' }, ...docs.map((d) => h('div', { class: 'fcard', onclick: () => openDoc(d) }, h('div', { class: 'nm', text: d.name }), h('div', { class: 'dim small', text: `${fmtBytes(d.size)} · ${fmtDate(d.updatedAt)}${d.text ? '' : ' · opens in its app'}` }),
      h('div', { class: 'row' }, h('button', { class: 'btn s d', onclick: async (e) => { e.stopPropagation(); if (await confirmBox(`Delete ${d.name}?`, 'The file is removed from the app data folder.', 'Delete', true)) { await call('kb.removeDoc', d.name); RENDER.knowledge(); } } }, 'Delete'))))) : h('div', { class: 'empty', text: 'No documents yet.' }));
}
async function drawLocations(body) {
  const locs = await call('kb.locations');
  const edit = async (l = { name: '', path: '', note: '' }) => {
    const f = { ...l };
    const pathIn = h('input', { type: 'text', value: f.path, style: { flex: 1 }, oninput: (e) => { f.path = e.target.value; } });
    modal([h('h2', { text: l.id ? 'Edit location' : 'New location' }), h('div', { class: 'col' },
      field('Short name (what you will say in chat)', h('input', { type: 'text', value: f.name, placeholder: 'e.g. reels, shorts, client videos', oninput: (e) => { f.name = e.target.value; } })),
      field('Folder', h('div', { class: 'row' }, pathIn, h('button', { class: 'btn', onclick: async () => { const d = await call('dialog.folder', 'Choose the folder'); if (d) { pathIn.value = d; f.path = d; } } }, 'Browse'))),
      field('Note (optional)', h('input', { type: 'text', value: f.note, oninput: (e) => { f.note = e.target.value; } }))),
    h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn p', onclick: async () => { await call('kb.saveLocation', f); closeModal(); RENDER.knowledge(); } }, 'Save'))]);
  };
  body.replaceChildren(h('div', { class: 'row', style: { marginBottom: '14px' } }, h('button', { class: 'btn p', onclick: () => edit() }, icon('plus', 16), 'Add location'), h('span', { class: 'dim small', text: 'Then say "post 1-5 from the reels folder" and the app knows where that is.' })),
    locs.length ? h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ...['Name', 'Folder', 'Note', ''].map((x) => h('th', { text: x })))), h('tbody', null, ...locs.map((l) => h('tr', null, h('td', null, h('b', { text: l.name })), h('td', { class: 'small', text: l.path }), h('td', { class: 'small dim', text: l.note }),
      h('td', null, h('div', { class: 'row' }, h('button', { class: 'btn s', onclick: () => call('shell.openFolder', l.path) }, 'Open'), h('button', { class: 'btn s', onclick: () => edit(l) }, 'Edit'), h('button', { class: 'btn s d', onclick: async () => { await call('kb.removeLocation', l.id); RENDER.knowledge(); } }, 'Delete'))))))) : h('div', { class: 'empty', text: 'No saved locations yet.' }));
}

/* ================= ACCOUNTS ================= */
const ACC = { q: '' };
RENDER.accounts = async () => {
  const v = $('#view-accounts');
  const [list, plats, healthList] = await Promise.all([call('accounts.list'), call('accounts.platforms'), call('accounts.health', null, { quiet: true }).catch(() => [])]);
  const healthOf = Object.fromEntries((healthList || []).map((x) => [x.id, x]));
  const posting = list.filter((a) => (plats.find((p) => p.id === a.kind) || {}).group !== 'ai');
  const ai = list.filter((a) => (plats.find((p) => p.id === a.kind) || {}).group === 'ai');
  const q = h('input', { type: 'text', placeholder: 'Search accounts', value: ACC.q, style: { width: '220px' }, oninput: (e) => { ACC.q = e.target.value; clearTimeout(RENDER.accounts.t); RENDER.accounts.t = setTimeout(() => { RENDER.accounts(); setTimeout(() => { const i = $('#accSearch'); if (i) { i.focus(); i.setSelectionRange(99, 99); } }, 30); }, 300); } });
  q.id = 'accSearch';
  const shown = posting.filter((a) => !ACC.q || `${a.name} ${a.kind} ${(a.channels || []).map((c) => c.name).join(' ')}`.toLowerCase().includes(ACC.q.toLowerCase()));
  const addBtn = (group, label) => h('button', { class: 'btn p', onclick: () => addAccountModal(plats.filter((p) => (group === 'ai' ? p.group === 'ai' : p.group !== 'ai'))) }, icon('plus', 16), label);
  v.replaceChildren(h('div', { class: 'head' }, h('h1', { text: 'Accounts' }), h('span', { class: 'muted small', text: 'Each account opens in its own private browser profile. Sign in once; passwords are never seen or stored by the app.' })),
    h('div', { class: 'scroll pad' }, h('div', { class: 'col', style: { gap: '16px', maxWidth: '1200px' } },
      h('div', { class: 'card' },
        h('div', { class: 'row', style: { marginBottom: '10px' } }, h('h3', { style: { margin: 0, flex: 1 }, text: `Posting accounts (${posting.length})` }), q, addBtn('posting', 'Add account')),
        h('div', { class: 'dim small', style: { marginBottom: '10px' }, text: 'Buffer first. Hootsuite, Publer, Later, Metricool, Zoho Social, YouTube Studio, Meta Business Suite, TikTok, LinkedIn, X, Threads and Pinterest work the same way. Give each a short name: you use it in chat ("Client A", "Cooking IG").' }),
        h('div', { class: 'col' }, ...(shown.length ? shown.map((a) => accountRow(a, plats, healthOf[a.id], true)) : [h('div', { class: 'empty', text: posting.length ? 'No match.' : 'No accounts yet. Click "Add account" and pick Buffer.' })]))),
      h('div', { class: 'card' },
        h('div', { class: 'row', style: { marginBottom: '10px' } }, h('h3', { style: { margin: 0, flex: 1 }, text: 'AI accounts (ChatGPT, Gemini, Claude websites)' }), addBtn('ai', 'Add AI account')),
        h('div', { class: 'dim small', style: { marginBottom: '10px' }, text: 'Optional helpers. The agent asks them only when Settings > "Let the agent ask web AI" is on, or when you ask it to. Nothing private is sent.' }),
        h('div', { class: 'col' }, ...(ai.length ? ai.map((a) => accountRow(a, plats)) : [h('div', { class: 'dim small', text: 'None added.' })]))),
      h('details', { class: 'details' }, h('summary', { text: 'Advanced: Buffer API and media hosting (only if you use the Buffer API instead of the browser)' }), h('div', { id: 'advAcc', style: { paddingBottom: '14px' } })))));
  drawAdvancedAccounts($('#advAcc'));
};

// scheduled posts and drafts of a Buffer channel: see them, tick, delete
function postsModal(a) {
  const chans = (a.channels || []).filter((c) => c.bufferId);
  const sel = h('select', null, ...chans.map((c) => h('option', { value: c.id, text: c.name + ' (' + c.service + ')' })));
  const viewSel = h('select', null, h('option', { value: 'schedule', text: 'Scheduled' }), h('option', { value: 'drafts', text: 'Drafts' }));
  const box = h('div', { class: 'col', style: { maxHeight: '55vh', overflow: 'auto', gap: '6px', marginTop: '10px' } });
  const info = h('div', { class: 'dim small', style: { marginTop: '6px' }, text: 'Pick a channel, then Load.' });
  let posts = []; const checked = new Set();
  const draw = () => {
    box.replaceChildren(...(posts.length ? posts.map((p) => h('label', { class: 'chk', style: { alignItems: 'flex-start', gap: '8px', padding: '8px', border: '1px solid var(--line,#2a2a35)', borderRadius: '10px' } },
      h('input', { type: 'checkbox', checked: checked.has(p.index), onchange: (e) => { if (e.target.checked) checked.add(p.index); else checked.delete(p.index); delBtn.disabled = !checked.size; delBtn.textContent = checked.size ? 'Delete ' + checked.size + ' selected' : 'Delete selected'; } }),
      h('div', null, h('b', { text: (p.day || '') + ' ' + (p.time || '') }), h('div', { class: 'dim small', text: p.text.slice(0, 160) })))) : [h('div', { class: 'empty', text: 'No posts here.' })]));
  };
  const load = async (b) => {
    b.disabled = true; info.textContent = 'Reading Buffer...';
    try { posts = await call('queue.list', { id: a.id, channel: sel.value, view: viewSel.value }); checked.clear(); delBtn.disabled = true; info.textContent = posts.length + ' post(s)'; draw(); }
    catch (_) { info.textContent = 'Could not read this channel. Check the sign-in.'; } finally { b.disabled = false; }
  };
  const delBtn = h('button', { class: 'btn d', disabled: true, onclick: async (e) => {
    const pick = posts.filter((p) => checked.has(p.index));
    if (!pick.length || !(await confirmBox('Delete ' + pick.length + ' post(s) from Buffer?', 'They are removed from Buffer and cannot be brought back.', 'Delete', true))) return;
    e.target.disabled = true; info.textContent = 'Deleting...';
    try { const r = await call('queue.remove', { id: a.id, channel: sel.value, view: viewSel.value, posts: pick }); toast('Deleted ' + r.deleted + (r.failed ? ', ' + r.failed + ' failed' : ''), r.failed ? 'warn' : 'ok'); await load(e.target); } catch (_) { /* toast shown */ }
  } }, 'Delete selected');
  const loadBtn = h('button', { class: 'btn p', onclick: (e) => load(e.target) }, 'Load');
  modal([h('h2', { text: 'Posts in ' + a.name }), h('div', { class: 'row' }, sel, viewSel, loadBtn), info, box, h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: closeModal }, 'Close'), delBtn)], { wide: true });
}

// small health line under an account: signed in, last post verified, last health check, and a "Run check" button
function healthLine(a, hl) {
  const ago = (t) => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
  const btn = h('button', { class: 'btn s', title: 'Open the account in the background and check that it works' }, 'Run check');
  btn.onclick = async () => { btn.disabled = true; btn.textContent = 'Checking...'; try { const r = await call('accounts.healthRun', a.id); toast(`${a.name}: ${r.ok ? 'looks fine' : r.problems[0] || 'needs a look'}`, r.ok ? 'ok' : 'warn'); } catch (_) { /* toast shown */ } RENDER.accounts(); };
  const bit = (kind, text) => h('span', { class: 'hbit' }, h('span', { class: `dot ${kind}` }), text);
  const ver = !hl ? null : hl.verified === 'yes' ? bit('ok', `Last post verified (${ago(hl.lastPostAt)})`) : hl.verified === 'no' ? bit('err', `Last post not found on Buffer (${ago(hl.lastPostAt)})`) : hl.verified === 'unknown' ? bit('', `Last post ${ago(hl.lastPostAt)}, not verified`) : bit('', 'No posts yet');
  const chk = !hl || !hl.check ? bit('', 'No health check yet') : bit(hl.check.ok ? 'ok' : 'err', `Check ${ago(hl.check.at)}: ${hl.check.ok ? 'fine' : (hl.check.text || 'failed')}`);
  return h('div', { class: 'acchealth' }, bit(a.loggedIn ? 'ok' : 'warn', a.loggedIn ? 'Signed in' : 'Not signed in'), ver, chk, hl && hl.problems?.length && a.loggedIn ? h('span', { class: 'hbit hprob', text: hl.problems.join('; ') }) : null, h('div', { style: { flex: 1 } }), btn);
}
function accountRow(a, plats, hl, showHealth) {
  const row = accountRowMain(a, plats);
  return showHealth ? h('div', { class: 'acctwrap' }, row, healthLine(a, hl)) : row;
}
function accountRowMain(a, plats) {
  const p = plats.find((x) => x.id === a.kind) || { label: a.kind };
  const status = h('span', { class: `dot ${a.loggedIn ? 'ok' : 'warn'}`, title: a.loggedIn ? 'signed in' : 'not signed in' });
  const busy = (btn, fn) => async () => { btn.disabled = true; const t = btn.textContent; btn.textContent = '...'; try { await fn(); } finally { btn.disabled = false; btn.textContent = t; } };
  const signBtn = h('button', { class: `btn s ${a.loggedIn ? '' : 'p'}` }, a.loggedIn ? 'Open' : 'Sign in');
  signBtn.onclick = busy(signBtn, async () => { toast('Sign in in the new window, then close it.', 'info', 7000); await call('accounts.signIn', a.id); RENDER.accounts(); });
  const chkBtn = h('button', { class: 'btn s' }, a.kind === 'buffer' ? 'Check + read channels' : 'Check');
  chkBtn.onclick = busy(chkBtn, async () => { const r = await call('accounts.refresh', a.id); toast(r.loggedIn ? `${r.name}: signed in${r.channels?.length ? `, ${r.channels.length} channels` : ''}` : `${r.name}: not signed in`, r.loggedIn ? 'ok' : 'warn'); RENDER.accounts(); });
  return h('div', { class: 'acctrow' }, status,
    h('div', null, h('b', { text: a.name }), h('div', { class: 'svc', text: p.label })),
    h('div', { class: 'small dim', title: a.defaultFolder || '' }, a.defaultFolder ? base(a.defaultFolder) : (p.group === 'ai' ? '' : 'default folder: none'), a.queueLimit ? h('div', { text: `queue limit ${a.queueLimit}/channel` }) : null),
    h('div', { class: 'chs' }, ...(a.channels || []).map((c) => h('span', { class: 'tag', text: `${c.name} · ${c.service}` }))),
    h('div', { class: 'row' }, signBtn, p.group === 'ai' ? null : chkBtn, a.kind === 'buffer' && (a.channels || []).some((c) => c.bufferId) ? h('button', { class: 'btn s', onclick: () => postsModal(a) }, 'Manage posts') : null, h('button', { class: 'btn s ghost', onclick: () => editAccountModal(a, p) }, 'Edit')));
}
function addAccountModal(plats) {
  const st = { kind: plats[0].id, name: '' };
  const nameIn = h('input', { type: 'text', placeholder: 'Short name, e.g. Client A, Cooking, Main' });
  modal([h('h2', { text: 'Add account' }), h('div', { class: 'col' },
    field('Type', sel(plats.map((p) => [p.id, p.label]), st.kind, (x) => { st.kind = x; })),
    field('Name (you use it in chat)', nameIn)),
  h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: closeModal }, 'Cancel'), h('button', { class: 'btn p', onclick: async () => {
    const a = await call('accounts.save', { kind: st.kind, name: nameIn.value.trim() });
    closeModal();
    toast('A sign-in window opens. Sign in there, then close it.', 'info', 8000);
    try { await call('accounts.signIn', a.id); } finally { RENDER.accounts(); }
  } }, 'Add and sign in'))]);
  setTimeout(() => nameIn.focus(), 50);
}
// caption wishes saved on an account or a channel; empty fields use the Settings defaults
function capBlock(holder) {
  const box = h('div', { class: 'col', style: { gap: '6px', marginTop: '6px' } });
  const cur = () => (holder.caption = holder.caption || {});
  const clean = () => { if (holder.caption && !Object.values(holder.caption).some(Boolean)) delete holder.caption; };
  const row = (label, options, key) => h('label', { class: 'row small' }, h('span', { style: { width: '90px' }, text: label }), sel([['', 'Settings default'], ...options], (holder.caption || {})[key] || '', (v) => { cur()[key] = v; clean(); }));
  Promise.all([call('craft.list', 'tone', { quiet: true }), call('craft.list', 'structure', { quiet: true }), call('styles.list', null, { quiet: true })]).then(([tones, structs, styles]) => {
    box.replaceChildren(
      row('Length', [['short', 'Short'], ['medium', 'Medium'], ['long', 'Long']], 'length'),
      row('Tone', tones.map((t) => [t.id, t.name]), 'tone'),
      row('Structure', structs.map((t) => [t.id, t.name]), 'structure'),
      row('Language', [['en', 'English'], ['bn', 'Bangla'], ['banglish', 'Banglish'], ['bn+en', 'Bangla + English']], 'language'),
      row('Style', styles.map((t) => [t.id, t.name]), 'style'),
      h('label', { class: 'row small' }, h('span', { style: { width: '90px' }, text: 'Extra notes' }), h('input', { type: 'text', style: { flex: 1 }, value: (holder.caption || {}).instructions || '', placeholder: 'e.g. always mention the channel name', oninput: (e) => { cur().instructions = e.target.value; clean(); } })));
  }).catch(() => box.replaceChildren(h('div', { class: 'dim small', text: 'Could not load the options.' })));
  return box;
}
function editAccountModal(a, p) {
  const st = { ...a, channels: (a.channels || []).map((c) => ({ ...c })) };
  const folderIn = h('input', { type: 'text', value: a.defaultFolder || '', style: { flex: 1 } });
  const chBox = h('div', { class: 'col' });
  const drawCh = () => chBox.replaceChildren(...st.channels.map((c, i) => h('div', { class: 'col', style: { gap: '4px' } }, h('div', { class: 'row' },
    h('input', { type: 'text', value: c.name, style: { flex: 1 }, oninput: (e) => { c.name = e.target.value; } }),
    sel(['instagram', 'facebook', 'youtube', 'tiktok', 'linkedin', 'twitter', 'threads', 'pinterest', 'bluesky', 'mastodon', 'google'], c.service, (x) => { c.service = x; }),
    h('button', { class: 'btn s ghost', onclick: (e) => { const nx = e.target.closest('.col').querySelector('.capwrap'); nx.classList.toggle('hidden'); } }, c.caption ? 'Captions: custom' : 'Captions'),
    h('button', { class: 'btn s ghost', onclick: () => { st.channels.splice(i, 1); drawCh(); } }, 'Remove')), h('div', { class: 'capwrap hidden' }, capBlock(c)))),
  h('button', { class: 'btn s', onclick: () => { st.channels.push({ name: '', service: 'instagram' }); drawCh(); } }, icon('plus', 14), 'Add channel'));
  drawCh();
  modal([h('h2', { text: `Edit ${a.name}` }), h('div', { class: 'col' },
    field('Name', h('input', { type: 'text', value: a.name, oninput: (e) => { st.name = e.target.value; } })),
    p.group === 'ai' ? null : field('Default folder (videos for this account)', h('div', { class: 'row' }, folderIn, h('button', { class: 'btn', onclick: async () => { const d = await call('dialog.folder', 'Default folder for this account'); if (d) folderIn.value = d; } }, 'Browse'))),
    p.group === 'ai' ? null : field('Scheduled posts allowed per channel (0 = no limit)', h('input', { type: 'number', min: 0, max: 1000, value: a.queueLimit, oninput: (e) => { st.queueLimit = Number(e.target.value); } }), 'Free Buffer allows about 10 per channel. The app stops before the limit and keeps the rest for later.'),
    p.group === 'ai' ? null : field('Caption setup for this account (used when a channel has none)', capBlock(st), 'Every channel can have its own setup too (Captions button on its row). Wishes you type in the chat still win.'),
    p.group === 'ai' ? null : field('Channels inside this account', chBox, a.kind === 'buffer' ? '"Check + read channels" fills this from Buffer. Names must match what Buffer shows.' : 'Optional.')),
  h('div', { class: 'acts' },
    h('button', { class: 'btn d', onclick: async () => { if (await confirmBox(`Remove ${a.name}?`, 'Its browser sign-in on this PC is deleted too. Nothing changes on the website.', 'Remove', true)) { await call('accounts.remove', a.id); closeModal(); RENDER.accounts(); } } }, 'Remove account'),
    h('div', { style: { flex: 1 } }),
    h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
    h('button', { class: 'btn p', onclick: async () => { await call('accounts.save', { id: a.id, name: st.name, defaultFolder: folderIn.value.trim(), queueLimit: st.queueLimit, caption: st.caption || null, channels: st.channels.filter((c) => c.name.trim()) }); closeModal(); RENDER.accounts(); } }, 'Save'))], { wide: true });
}

async function drawAdvancedAccounts(box) {
  const s = S.settings;
  const bufBox = h('div', { class: 'card' });
  const hostBox = h('div', { class: 'card' });
  box.replaceChildren(h('div', { class: 'col', style: { gap: '14px' } }, bufBox, hostBox));
  // Buffer
  const keyIn = h('input', { type: 'password', placeholder: s.secrets.bufferKey ? 'Key saved (paste a new one to replace)' : 'Paste Buffer API key', style: { flex: 1, minWidth: '280px' } });
  const chanList = h('div', { class: 'col' });
  const loadChannels = async () => {
    chanList.replaceChildren(h('div', { class: 'dim', text: 'Loading channels...' }));
    const c = await call('buffer.channels', null, { quiet: true }).catch((e) => ({ list: [], err: e.message }));
    chanList.replaceChildren(...(c.err ? [h('div', { class: 'fi err', text: c.err })] : []), ...(c.list.length ? c.list.map((x) => h('div', { class: 'acct' }, h('div', { class: 'grow' }, h('b', { text: x.name }), h('div', { class: 'svc', text: `${x.service}${x.paused ? ' · queue paused' : ''}` })))) : [h('div', { class: 'dim small', text: s.secrets.bufferKey ? 'No channels found. Connect your social accounts inside Buffer first.' : 'Not connected.' })]));
  };
  bufBox.replaceChildren(h('h3', { text: 'Buffer (main posting route)' }),
    h('div', { class: 'muted small', text: 'Connect YouTube, Instagram, TikTok, Facebook, LinkedIn and more inside Buffer once. Create a key in Buffer: Settings > API (publish.buffer.com/settings/api).' }),
    h('div', { class: 'row', style: { margin: '10px 0' } }, keyIn,
      h('button', { class: 'btn p', onclick: async () => {
        if (keyIn.value.trim()) await call('secrets.set', { name: 'bufferKey', value: keyIn.value.trim() });
        keyIn.value = '';
        try { const t = await call('buffer.test'); const org = t.organizations[0]; if (org && !S.settings.buffer.organizationId) await call('buffer.setOrg', { id: org.id, name: org.name }); toast(`Buffer connected (${t.organizations.map((o) => o.name).join(', ')})`, 'ok'); } catch (_) { /* toast shown */ }
        await loadSettings(); RENDER.accounts();
      } }, s.secrets.bufferKey ? 'Save and test' : 'Connect'),
      s.secrets.bufferKey ? h('button', { class: 'btn d', onclick: async () => { if (await confirmBox('Disconnect Buffer?', 'The saved key is deleted from this PC.', 'Disconnect', true)) { await call('secrets.set', { name: 'bufferKey', value: '' }); await loadSettings(); RENDER.accounts(); } } }, 'Disconnect') : null,
      h('button', { class: 'btn ghost', onclick: () => call('shell.external', 'https://publish.buffer.com/settings/api') }, 'Get a key')),
    s.buffer.organizationName ? h('div', { class: 'dim small', style: { marginBottom: '8px' }, text: `Organization: ${s.buffer.organizationName}` }) : null,
    chanList);
  if (s.secrets.bufferKey) loadChannels(); else chanList.replaceChildren(h('div', { class: 'dim small', text: 'Not connected.' }));
  // hosting
  const hc = { ...s.hosting };
  const prov = sel([['none', 'Not set'], ['cloudinary', 'Cloudinary (free plan works)'], ['s3', 'S3-compatible bucket (Cloudflare R2, AWS S3, B2...)']], hc.provider, (x) => { hc.provider = x; drawHost(); });
  const hostFields = h('div', { class: 'formgrid' });
  const sec = {};
  const secIn = (name, ph) => h('input', { type: 'password', placeholder: s.secrets[name] ? 'saved (type to replace)' : ph, oninput: (e) => { sec[name] = e.target.value; } });
  const txtIn = (k, ph) => h('input', { type: 'text', value: hc[k] || '', placeholder: ph, oninput: (e) => { hc[k] = e.target.value; } });
  function drawHost() {
    if (hc.provider === 'cloudinary') hostFields.replaceChildren(field('Cloud name', txtIn('cloudName', 'from the Cloudinary dashboard')), field('API key', secIn('cloudinaryKey', 'API key')), field('API secret', secIn('cloudinarySecret', 'API secret')), field('Folder', txtIn('folder', 'posting-assistant')));
    else if (hc.provider === 's3') hostFields.replaceChildren(field('Endpoint', txtIn('endpoint', 'https://<account>.r2.cloudflarestorage.com')), field('Bucket', txtIn('bucket', 'my-media')), field('Region', txtIn('region', 'auto (R2) or us-east-1')), field('Public URL base', txtIn('publicBase', 'https://pub-xxxx.r2.dev or your domain')), field('Access key ID', secIn('s3AccessKey', 'access key')), field('Secret access key', secIn('s3SecretKey', 'secret')), field('Folder', txtIn('folder', 'posting-assistant')));
    else hostFields.replaceChildren(h('div', { class: 'dim small wide', text: 'Without hosting, Buffer cannot receive videos/images from your PC. Direct browser posting does not need it.' }));
  }
  drawHost();
  hostBox.replaceChildren(h('h3', { text: 'Media hosting (for Buffer)' }),
    h('div', { class: 'muted small', text: 'Buffer has no upload API: it downloads each video from a public link when it publishes. The app uploads the file, gives Buffer the link, and deletes the copy some days after the post time.' }),
    h('div', { class: 'row', style: { margin: '10px 0' } }, field('Provider', prov), field('Delete copies after (days)', h('input', { type: 'number', min: 1, max: 90, value: hc.deleteAfterDays || 10, oninput: (e) => { hc.deleteAfterDays = Number(e.target.value); } }))),
    hostFields,
    h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn p', onclick: async () => {
      for (const [k, val] of Object.entries(sec)) if (val) await call('secrets.set', { name: k, value: val });
      await setSetting({ hosting: hc });
      toast('Hosting saved', 'ok');
    } }, 'Save'), h('button', { class: 'btn', onclick: async () => { for (const [k, val] of Object.entries(sec)) if (val) await call('secrets.set', { name: k, value: val }); await setSetting({ hosting: hc }); try { const r = await call('hosting.test'); toast(`Upload works: ${r.url.slice(0, 60)}...`, 'ok', 7000); } catch (_) { /* shown */ } } }, 'Test upload')));
};

/* ================= AI MODELS ================= */
const MS = { filter: 'recommended', q: '', pulls: {}, data: null, ollama: null };
RENDER.models = async () => {
  const v = $('#view-models');
  v.replaceChildren(h('div', { class: 'head' }, h('h1', { text: 'AI models' }), h('span', { class: 'muted small', text: 'Local models run on your PC for free. API models need a key. Mix them: e.g. local for chat, API for Bangla captions.' })),
    h('div', { class: 'scroll pad' }, h('div', { class: 'col', style: { gap: '16px', maxWidth: '1200px' } },
      h('div', { class: 'card', id: 'rolesBox' }), h('div', { class: 'card', id: 'sttBox' }), h('div', { class: 'card', id: 'provBox' }), h('div', { class: 'card', id: 'olBox' }), h('div', { class: 'card', id: 'impBox' }), h('div', { class: 'card', id: 'catBox' }))));
  drawRoles(); drawStt(); drawProviders(); drawImport();
  MS.ollama = await call('ollama.status', null, { quiet: true }).catch(() => null); drawOllama();
  MS.data = await call('models.catalog', null, { quiet: true }).catch((e) => ({ error: e.message })); drawCatalog();
};
async function drawRoles() {
  const box = $('#rolesBox'); if (!box) return;
  const s = S.settings;
  const provs = s.providers.filter((p) => p.enabled);
  const roles = [['main', 'Main (chat + browser posting)', 'Understands your commands and drives the browser. qwen3-vl:8b-instruct works well locally.'], ['writer', 'Caption writer', 'Writes captions. Empty = main model. For the best Bangla, an API model (Claude, GPT, Gemini) is stronger than small local models.'], ['vision', 'Vision (looks at video frames)', 'Must see images. Empty = main model if it can see.']];
  box.replaceChildren(h('h3', { text: 'Which model does what' }), ...roles.map(([role, title, hint]) => {
    const rc = s.roles[role];
    const ps = sel(provs.map((p) => [p.id, p.name]), rc.provider);
    const ms = h('select', { style: { minWidth: '300px' } }, h('option', { text: rc.model || 'loading...' }));
    const fill = async () => {
      ms.replaceChildren(h('option', { text: 'loading...' }));
      let list;
      try { list = await call('providers.models', ps.value, { quiet: true }); } catch (e) { ms.replaceChildren(h('option', { value: '', text: e.message.slice(0, 80) })); return; }
      const cur = S.settings.roles[role].provider === ps.value ? S.settings.roles[role].model : '';
      ms.replaceChildren(h('option', { value: '', text: role === 'main' ? '- choose -' : '(same as main)' }), ...list.map((m) => h('option', { value: m.id, selected: m.id === cur, text: `${m.id}${m.vision ? '  [sees images]' : ''}${m.size ? `  ${fmtBytes(m.size)}` : ''}` })));
      if (cur && !list.some((m) => m.id === cur)) ms.append(h('option', { value: cur, selected: true, text: `${cur} (not found)` }));
    };
    ps.onchange = async () => { await setSetting({ roles: { [role]: { provider: ps.value, model: '' } } }); fill(); };
    ms.onchange = async () => { await setSetting({ roles: { [role]: { provider: ps.value, model: ms.value } } }); toast(`${title}: ${ms.value || 'same as main'}`, 'ok'); };
    fill();
    return h('div', { style: { margin: '10px 0' } }, h('div', null, h('b', { text: title }), h('span', { class: 'dim small', text: `  ${hint}` })),
      h('div', { class: 'row', style: { marginTop: '6px' } }, ps, ms, h('label', { class: 'small muted' }, 'Context ', sel([4096, 8192, 12288, 16384, 24576, 32768, 65536], rc.numCtx, (x) => setSetting({ roles: { [role]: { numCtx: Number(x) } } })))));
  }));
}
async function drawStt() {
  const box = $('#sttBox'); if (!box) return;
  const s = S.settings.transcribe;
  const st = await call('whisper.status', null, { quiet: true }).catch(() => ({ models: [], ready: false }));
  S.whisperReady = st.ready;
  const prog = h('div', { class: 'small muted', id: 'whProg' });
  const modelSel = sel(st.models.map((m) => [m.id, `${m.id} (${m.mb} MB)${m.installed ? ' - installed' : ''}: ${m.note}`]), s.localModel, (x) => setSetting({ transcribe: { localModel: x } }));
  const apiProvs = S.settings.providers.filter((p) => p.type === 'openai' && p.enabled);
  box.replaceChildren(h('h3', { text: 'Speech to text (understands Bangla / English speech)' }),
    h('div', { class: 'muted small', text: 'Used in "smart" and "full" scans. Videos with no speech are detected and captioned from the frames. Subtitle files next to a video (.srt) are used instead when present.' }),
    h('div', { class: 'row', style: { margin: '10px 0' } }, seg([['local', 'Local (whisper.cpp, free)'], ['api', 'API (OpenAI / Groq)'], ['off', 'Off']], s.engine, async (x) => { await setSetting({ transcribe: { engine: x } }); drawStt(); })),
    s.engine === 'local' ? h('div', { class: 'col' },
      h('div', { class: 'row' }, h('span', { class: `dot ${st.ready ? 'ok' : 'warn'}` }), st.ready ? `whisper.cpp installed (${st.variant})` : 'Not installed yet'),
      h('div', { class: 'small' }, h('b', { text: 'Folder: ' }), h('span', { class: 'dim', text: st.dir || '' })),
      h('div', { class: 'row' },
        h('button', { class: 'btn s', onclick: () => call('shell.openFolder', st.dir) }, icon('folder', 14), 'Open folder'),
        h('button', { class: 'btn s', onclick: async () => { const r = await call('whisper.chooseDir'); if (r) { await loadSettings(); toast('Speech folder changed', 'ok'); drawStt(); } } }, 'Change folder (or use an existing whisper folder)'),
        h('button', { class: 'btn s', onclick: async () => { const r = await call('whisper.useModelFile'); if (r) { await loadSettings(); toast('Using your model file', 'ok'); drawStt(); } } }, 'Use a model file I already have')),
      field('Model', modelSel),
      h('div', { class: 'row' },
        h('button', { class: 'btn p', onclick: async (e) => { e.target.disabled = true; try { await call('whisper.install', { variant: 'cpu', model: modelSel.value }); toast('Speech to text ready', 'ok'); } finally { e.target.disabled = false; drawStt(); } } }, st.ready ? 'Download model / update' : 'Install (CPU, works everywhere)'),
        h('button', { class: 'btn', onclick: async (e) => { e.target.disabled = true; try { await call('whisper.install', { variant: 'cuda', model: modelSel.value }); toast('GPU build installed', 'ok'); } finally { e.target.disabled = false; drawStt(); } } }, 'Install NVIDIA GPU build (faster)'),
        h('button', { class: 'btn ghost', onclick: () => call('whisper.cancel') }, 'Cancel download')), prog) : null,
    s.engine === 'api' ? h('div', { class: 'row' }, field('Provider', sel([['', '- choose -'], ...apiProvs.map((p) => [p.id, p.name])], s.provider, (x) => setSetting({ transcribe: { provider: x } }))),
      field('Model', h('input', { type: 'text', value: s.model, placeholder: 'whisper-large-v3 (Groq) or whisper-1 (OpenAI)', onchange: (e) => setSetting({ transcribe: { model: e.target.value.trim() } }) }))) : null);
}
pa.on('whisper:progress', (p) => { const el = $('#whProg'); if (el) el.textContent = p.status === 'success' ? 'Done.' : `${p.status || ''}${p.total ? ` ${Math.round((p.completed / p.total) * 100)}% (${fmtBytes(p.completed)} / ${fmtBytes(p.total)})` : ''}`; });
async function drawProviders() {
  const box = $('#provBox'); if (!box) return;
  const presets = await call('providers.presets');
  const preset = sel(presets.map((x) => [x.preset, `${x.name}${x.local ? ' (local)' : ''}`]), 'openai');
  const name = h('input', { type: 'text', placeholder: 'Name', style: { width: '170px' } });
  const url = h('input', { type: 'text', placeholder: 'Base URL', style: { width: '280px' } });
  const key = h('input', { type: 'password', placeholder: 'API key', style: { width: '240px' } });
  const fillP = () => { const x = presets.find((y) => y.preset === preset.value); name.value = x.name; url.value = x.baseUrl; key.style.display = x.local ? 'none' : ''; };
  preset.onchange = fillP; fillP();
  const list = h('div', { class: 'col' }, ...S.settings.providers.map((p) => h('div', { class: 'acct' }, h('span', { class: `dot ${p.enabled ? 'ok' : ''}` }), h('div', { class: 'grow' }, h('b', { text: p.name }), h('div', { class: 'dim small', text: `${p.baseUrl}${p.hasKey ? ' · key saved' : ''}` })),
    h('label', { class: 'chk small' }, h('input', { type: 'checkbox', checked: p.enabled, onchange: async (e) => { await call('providers.upsert', { ...p, enabled: e.target.checked, apiKey: '__keep__' }); await loadSettings(); } }), 'on'),
    h('button', { class: 'btn s', onclick: async () => { try { const t = await call('providers.test', p.id); toast(`${p.name}: ${t.count} models`, 'ok'); } catch (_) { /* shown */ } } }, 'Test'),
    p.type !== 'ollama' ? h('button', { class: 'btn s', onclick: async () => { const k = await promptBox(`New API key for ${p.name}`, '', { password: true }); if (k) { await call('providers.upsert', { ...p, apiKey: k }); await loadSettings(); toast('Key saved', 'ok'); drawProviders(); } } }, 'Key') : null,
    p.type !== 'ollama' ? h('button', { class: 'btn s d', onclick: async () => { if (await confirmBox(`Remove ${p.name}?`, 'Its key is deleted.', 'Remove', true)) { await call('providers.remove', p.id); await loadSettings(); drawProviders(); drawRoles(); } } }, 'Remove') : null)));
  box.replaceChildren(h('h3', { text: 'API keys and model servers' }), h('div', { class: 'muted small', text: 'OpenAI, Claude, Gemini, OpenRouter, Groq, DeepSeek, Mistral, xAI... or local servers (LM Studio, llama.cpp, Jan, vLLM). Keys are encrypted and stay on this PC.' }),
    h('div', { class: 'row', style: { margin: '10px 0' } }, preset, name, url, key, h('button', { class: 'btn p', onclick: async () => {
      const x = presets.find((y) => y.preset === preset.value);
      const id = await call('providers.upsert', { type: x.type, preset: x.preset, name: name.value || x.name, baseUrl: url.value, apiKey: key.value || undefined });
      key.value = '';
      await loadSettings();
      const t = await call('providers.test', id, { quiet: true }).catch((e) => ({ error: e.message }));
      toast(t.error ? `Added, but the test failed: ${t.error}` : `Connected: ${t.count} models`, t.error ? 'warn' : 'ok');
      drawProviders(); drawRoles(); drawStt();
    } }, 'Add and test')), list);
}
function drawOllama() {
  const box = $('#olBox'); if (!box) return;
  const o = MS.ollama || {};
  box.replaceChildren(h('h3', { text: 'Ollama (local model engine)' }),
    h('div', { class: 'row' }, h('span', { class: `dot ${o.running ? 'ok' : o.installed ? 'warn' : 'err'}` }), o.running ? `running (v${o.version})` : o.installed ? 'installed, not running' : 'not installed', o.exe ? h('span', { class: 'dim small', text: o.exe }) : null),
    h('div', { class: 'small', style: { marginTop: '4px' } }, h('b', { text: 'Models folder: ' }), o.modelsDir?.path || '?', h('span', { class: 'dim', text: ` (${o.modelsDir?.source || ''})` })),
    h('div', { class: 'row', style: { marginTop: '10px' } },
      !o.installed ? h('button', { class: 'btn p', onclick: async () => { const dir = await call('dialog.folder', 'Where should Ollama be installed? (e.g. E:\\Programs\\Ollama)'); if (!dir) return; try { MS.ollama = await call('ollama.install', dir); toast('Ollama installed', 'ok'); RENDER.models(); } catch (_) { /* shown */ } } }, 'Download and install Ollama') : null,
      o.installed && !o.running ? h('button', { class: 'btn p', onclick: async () => { try { MS.ollama = await call('ollama.start'); RENDER.models(); } catch (_) { /* shown */ } } }, 'Start Ollama') : null,
      h('button', { class: 'btn', onclick: async () => { const dir = await call('dialog.folder', 'Choose the folder for Ollama models'); if (!dir) return; if (!(await confirmBox('Change models folder?', `Ollama will use:\n${dir}\n\nOllama restarts.`, 'Change'))) return; try { MS.ollama = await call('ollama.setDir', dir); toast('Models folder changed', 'ok'); RENDER.models(); } catch (_) { /* shown */ } } }, 'Change models folder'),
      h('button', { class: 'btn ghost', onclick: async () => { MS.ollama = await call('ollama.status'); drawOllama(); } }, 'Refresh')),
    h('div', { class: 'small muted', id: 'olProg', style: { marginTop: '6px' } }));
}
pa.on('ollama:progress', (p) => { const el = $('#olProg') || $('#impProg'); if (el) el.textContent = p.status === 'success' ? 'Done.' : `${p.status || ''}${p.total ? ` ${Math.round((p.completed / p.total) * 100)}%` : ''}`; });
function drawImport() {
  const box = $('#impBox'); if (!box) return;
  const res = h('div', { style: { marginTop: '8px' } });
  const importOne = async (file) => {
    const name = await promptBox('Name for this model in Ollama', base(file).replace(/\.gguf$/i, '').toLowerCase());
    if (!name) return;
    try { const n = await call('ollama.import', { file, name }); toast(`Imported as ${n}`, 'ok'); RENDER.models(); } catch (_) { /* shown */ }
  };
  box.replaceChildren(h('h3', { text: 'Use models already on this PC' }), h('div', { class: 'muted small', text: 'Point to an Ollama models folder or .gguf files instead of downloading again.' }),
    h('div', { class: 'row', style: { marginTop: '8px' } },
      h('button', { class: 'btn', onclick: async () => {
        const dir = await call('dialog.folder', 'Choose a folder that contains models'); if (!dir) return;
        res.replaceChildren(h('div', { class: 'dim', text: 'Scanning...' }));
        const r = await call('ollama.scan', dir);
        res.replaceChildren(...(r.ollamaStore ? [h('div', { class: 'acct' }, h('div', { class: 'grow', text: `Ollama models folder: ${r.ollamaStore}` }), h('button', { class: 'btn s p', onclick: async () => { try { MS.ollama = await call('ollama.setDir', r.ollamaStore); toast('Ollama now uses that folder', 'ok'); RENDER.models(); } catch (_) { /* shown */ } } }, 'Use this folder'))] : []),
          ...r.gguf.map((g) => h('div', { class: 'row' }, h('span', { class: 'small', style: { flex: 1 }, text: `${g.path} · ${fmtBytes(g.size)}` }), h('button', { class: 'btn s', onclick: () => importOne(g.path) }, 'Import'))),
          ...(!r.ollamaStore && !r.gguf.length ? [h('div', { class: 'dim', text: 'No models found there.' })] : []));
      } }, 'Scan a folder for models'),
      h('button', { class: 'btn', onclick: async () => { const f = await call('dialog.file', { title: 'Choose a .gguf model file', filters: [{ name: 'GGUF models', extensions: ['gguf'] }] }); if (f) importOne(f); } }, 'Import one .gguf file')),
    res, h('div', { class: 'small muted', id: 'impProg' }));
}
function drawCatalog() {
  const box = $('#catBox'); if (!box) return;
  const d = MS.data;
  if (!d || d.error) { box.replaceChildren(h('h3', { text: 'Download models' }), h('div', { class: 'dim', text: d?.error || 'Start Ollama to see models.' })); return; }
  const fitText = { fits: 'fits your GPU', ram: 'GPU + RAM (slower)', cpu: 'CPU only (slow)', 'too-big': 'too big for this PC' };
  const tags = ['recommended', 'all', 'installed', 'vision', 'tools', 'reasoning', 'small'];
  const q = MS.q.toLowerCase();
  const list = d.catalog.filter((m) => (MS.filter === 'all' || (MS.filter === 'installed' ? m.installed : m.tags.includes(MS.filter))) && (!q || m.id.includes(q) || m.note.toLowerCase().includes(q)));
  const anyIn = h('input', { type: 'text', placeholder: 'Any Ollama model, e.g. gemma3:12b', style: { flex: 1, minWidth: '260px' } });
  const grid = h('div', { class: 'grid2' });
  for (const m of list) {
    const pr = MS.pulls[m.id];
    grid.append(h('div', { class: `card ${m.tags.includes('recommended') ? 'best' : ''}`, 'data-id': m.id },
      h('div', { class: 'row' }, h('b', { style: { fontFamily: 'Consolas,monospace' }, text: m.id }), h('div', { style: { flex: 1 } }), m.fit ? h('span', { class: `tag ${m.fit}`, text: fitText[m.fit] }) : null),
      h('div', { class: 'small muted', style: { margin: '6px 0' }, text: m.note }),
      h('div', { class: 'row small' }, ...m.tags.map((t) => h('span', { class: `tag ${t === 'vision' ? 'v' : ''}`, text: t })), h('span', { class: 'dim', text: `${m.gb.toFixed(1)} GB` })),
      h('div', { class: 'progress', style: { display: pr ? '' : 'none' } }, h('div', { style: { width: `${pr?.pct || 0}%` } })), h('div', { class: 'small dim pt', text: pr?.text || '' }),
      h('div', { class: 'row', style: { marginTop: '8px' } }, m.installed
        ? [h('span', { class: 'small', style: { color: 'var(--green)' }, text: 'Installed' }), h('div', { style: { flex: 1 } }), h('button', { class: 'btn s', onclick: async () => { await setSetting({ roles: { main: { provider: 'ollama', model: m.id } } }); toast(`Main model: ${m.id}`, 'ok'); drawRoles(); } }, 'Use as main'), h('button', { class: 'btn s d', onclick: async () => { if (await confirmBox(`Delete ${m.id}?`, 'The model files are removed.', 'Delete', true)) { await call('models.delete', m.id); RENDER.models(); } } }, 'Delete')]
        : pr ? h('button', { class: 'btn s', onclick: () => call('models.cancelPull') }, 'Cancel') : h('button', { class: 'btn s p', onclick: () => pull(m.id) }, `Download (${m.gb.toFixed(1)} GB)`))));
  }
  box.replaceChildren(h('h3', { text: 'Download models (one click)' }),
    h('div', { class: 'small muted', text: `Your PC: ${d.hw.gpus.map((g) => `${g.name} ${g.vramGB} GB`).join(', ') || 'no dedicated GPU'} · ${d.hw.ramGB} GB RAM` }),
    h('div', { class: 'row', style: { margin: '10px 0' } }, ...tags.map((t) => h('button', { class: `chip ${MS.filter === t ? 'on' : ''}`, style: MS.filter === t ? { borderColor: 'var(--blue)', color: '#fff' } : null, onclick: () => { MS.filter = t; drawCatalog(); } }, t)),
      h('input', { type: 'text', placeholder: 'search', value: MS.q, style: { width: '150px' }, oninput: (e) => { MS.q = e.target.value; clearTimeout(drawCatalog.t); drawCatalog.t = setTimeout(drawCatalog, 300); } })),
    h('div', { class: 'row', style: { marginBottom: '12px' } }, anyIn, h('button', { class: 'btn', onclick: () => { if (anyIn.value.trim()) pull(anyIn.value.trim()); } }, 'Download')), grid);
}
async function pull(name) {
  MS.pulls[name] = { pct: 0, text: 'Starting...' };
  drawCatalog();
  try { await call('models.pull', name); toast(`${name} downloaded`, 'ok'); delete MS.pulls[name]; MS.data = await call('models.catalog'); drawCatalog(); drawRoles(); }
  catch (_) { delete MS.pulls[name]; drawCatalog(); }
}
pa.on('pull:progress', (p) => {
  const st = MS.pulls[p.name] || (MS.pulls[p.name] = {});
  st.pct = p.total ? Math.round((p.completed / p.total) * 100) : st.pct || 0;
  st.text = p.status === 'error' ? p.error : `${p.status || ''}${p.total ? ` ${fmtBytes(p.completed)} / ${fmtBytes(p.total)}` : ''}`;
  const card = document.querySelector(`#catBox [data-id="${CSS.escape(p.name)}"]`);
  if (card) { card.querySelector('.progress').style.display = ''; card.querySelector('.progress > div').style.width = `${st.pct}%`; card.querySelector('.pt').textContent = st.text; }
});

/* ================= SETTINGS ================= */
RENDER.settings = async () => {
  const v = $('#view-settings');
  const s = S.settings;
  const [tones, structures, boosters] = await Promise.all(['tone', 'structure', 'booster'].map((k) => call('craft.list', k, { quiet: true }).catch(() => [])));
  const set = (k) => (val) => setSetting({ [k]: val });
  const chk = (k, label) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: s[k], onchange: (e) => setSetting({ [k]: e.target.checked }) }), label);
  const num = (k, min, max) => h('input', { type: 'number', min, max, value: s[k], onchange: (e) => setSetting({ [k]: Number(e.target.value) }) });
  v.replaceChildren(h('div', { class: 'head' }, h('h1', { text: 'Settings' })),
    h('div', { class: 'scroll pad' }, h('div', { class: 'grid2', style: { maxWidth: '1200px' } },
      h('div', { class: 'card' }, h('h3', { text: 'Posting' }), h('div', { class: 'col' },
        field('Approval', seg(MODES, s.mode, async (x) => { await setSetting({ mode: x }); RENDER.settings(); }), 'Autopilot: no questions. Ask every time: approve each post. Ask once: approve a whole job with one click.'),
        field('Default daily posting times', h('input', { type: 'text', value: s.timeSlots.join(', '), onchange: (e) => setSetting({ timeSlots: e.target.value.split(/[,\s]+/).filter(Boolean) }) }), 'Used when you say "schedule" without a time. Example: 10:00, 19:00'),
        field('Minimum seconds between two posts', num('minPostGapSec', 0, 600)),
        field('Maximum posts per hour', num('maxPostsPerHour', 1, 500)),
        chk('closeToTray', 'Closing the window keeps the app running in the tray'), chk('notifyDone', 'Windows notifications for approvals and finished jobs'))),
      automationCard(s),
      h('div', { class: 'card' }, h('h3', { text: 'Captions' }), h('div', { class: 'col' },
        field('Caption language', sel([['auto', 'Auto: match the video (Bangla, English...)'], ['bn', 'Always Bangla'], ['en', 'Always English'], ['banglish', 'Banglish'], ['bn+en', 'Bangla + English']], s.captionLanguage, set('captionLanguage'))),
        field('Caption length', sel([['short', 'Short (1-3 lines)'], ['medium', 'Medium (3-6 lines)'], ['long', 'Long (story or lesson)']], s.captionLength, set('captionLength'))),
        field('Caption type', sel([['auto', 'Auto: fit each video'], ['hype', 'Hype / fan'], ['storytelling', 'Storytelling'], ['educational', 'Educational'], ['hook_question', 'Hook + question'], ['emotional', 'Emotional'], ['humorous', 'Humorous'], ['promotional', 'Promotional'], ['minimal', 'Minimal']], s.captionType, set('captionType'))),
        field('Tone', sel(tones.map((x) => [x.id, x.name]), s.captionTone, set('captionTone')), 'Add your own in Library > Tones and structures.'),
        field('Caption structure', sel([['auto', 'Auto: fit each video'], ...structures.map((x) => [x.id, x.name])], s.captionStructure, set('captionStructure'))),
        field('Engagement boosters', h('div', { class: 'chipsel' }, ...boosters.map((b) => h('label', { title: b.prompt }, h('input', { type: 'checkbox', checked: (s.captionBoosters || []).includes(b.id), onchange: (e) => { const t = new Set(s.captionBoosters || []); e.target.checked ? t.add(b.id) : t.delete(b.id); setSetting({ captionBoosters: [...t] }); } }), b.name)))),
        field('Psychology to use', h('div', { class: 'chipsel' }, ...[['curiosity', 'Curiosity'], ['relatability', 'Relatability'], ['reward', 'Reward'], ['authority', 'Authority'], ['social_proof', 'Social proof'], ['fomo', 'FOMO'], ['controversy', 'Mild controversy']].map(([k, l]) => h('label', null, h('input', { type: 'checkbox', checked: (s.captionTriggers || []).includes(k), onchange: (e) => { const t = new Set(s.captionTriggers || []); e.target.checked ? t.add(k) : t.delete(k); setSetting({ captionTriggers: [...t] }); } }), l))), 'Say it in chat for one job too: "short hype captions in English".'),
        field('Default video scan', sel([['name', 'No scan: file name + notes (instant)'], ['quick', 'Quick: 1 frame'], ['smart', 'Smart: speech + 4 frames (recommended)'], ['full', 'Full: whole video, 12 frames (slow)']], s.analysisMode, set('analysisMode')), 'You can always say "scan the full video" or "no need to scan" in chat.'),
        field('Seconds of speech in smart scan', num('transcribeMaxSecSmart', 20, 1800)),
        field('Frames in smart / full scan', h('div', { class: 'row' }, num('framesSmart', 1, 12), num('framesFull', 4, 32))),
        field('Skill text budget (characters)', num('skillBudgetChars', 1000, 40000), 'Lower is faster for local models.'),
        h('div', { class: 'dim small', text: 'Tip: put a notes.txt in a video folder (or "<video name>.txt" next to a video) with details. The writer uses it and does not need to scan.' }))),
      h('div', { class: 'card' }, h('h3', { text: 'Chat' }), h('div', { class: 'col' },
        field('Reply language', sel([['auto', 'Same as I write'], ['Bangla', 'Bangla'], ['Banglish', 'Banglish'], ['English', 'English']], s.language, set('language'))),
        field('Max steps per request', num('maxSteps', 5, 200)),
        field('Browser posting: max steps per post', num('browserMaxSteps', 10, 150)),
        chk('sound', 'Sounds'),
        field('Things the assistant remembers', h('div', { class: 'col' }, ...(s.memory.length ? s.memory.map((m, i) => h('div', { class: 'row small' }, h('span', { style: { flex: 1 }, text: m.text }), h('button', { class: 'btn s ghost', onclick: async () => { const mm = s.memory.slice(); mm.splice(i, 1); await setSetting({ memory: mm }); RENDER.settings(); } }, 'Forget'))) : [h('span', { class: 'dim small', text: 'Nothing yet.' })]))))),
      h('div', { class: 'card' }, h('h3', { text: 'Folders' }), h('div', { class: 'col' },
        ...[['writerDir', 'writer', 'Writer chats'], ['draftsDir', 'drafts', 'Saved posts'], ['workflowsDir', 'workflows', 'Workflow sheets']].map(([k, kind, label]) => field(label, h('div', { class: 'row' }, h('span', { class: 'small', style: { flex: 1, wordBreak: 'break-all' }, text: s[k] || 'inside the data folder' }), h('button', { class: 'btn s', onclick: async () => { const r = await call('studio.chooseDir', kind); if (r) { S.settings = r; RENDER.settings(); } } }, 'Change'), s[k] ? h('button', { class: 'btn s ghost', onclick: () => call('shell.openFolder', s[k]) }, 'Open') : null))),
        field('Default media folder (when you do not name one)', h('div', { class: 'row' }, h('span', { class: 'small', style: { flex: 1, wordBreak: 'break-all' }, text: s.defaultMediaFolder || 'none' }), h('button', { class: 'btn s', onclick: async () => { const d = await call('dialog.folder', 'Default media folder'); if (d) { await setSetting({ defaultMediaFolder: d }); RENDER.settings(); } } }, 'Choose'))),
        h('div', { class: 'dim small', text: 'Chats, sheets and saved posts are read from disk when needed, so they do not sit in memory.' }))),
      h('div', { class: 'card' }, h('h3', { text: 'GPU, alerts, web' }), h('div', { class: 'col' },
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: s.gpu.enabled, onchange: (e) => setSetting({ gpu: { enabled: e.target.checked } }) }), 'GPU heat guard (NVIDIA)'),
        field('Slow down at / slow down more at / wait at / back to normal at (°C)', h('div', { class: 'row' }, ...['warm', 'hot', 'stop', 'cool'].map((k) => h('input', { type: 'number', min: 50, max: 95, value: s.gpu[k], style: { width: '80px' }, onchange: (e) => setSetting({ gpu: { [k]: Number(e.target.value) } }) }))), h('span', { id: 'gpuNow', class: 'dim small' })),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: s.gpu.localOneAtATime !== false, onchange: (e) => setSetting({ gpu: { localOneAtATime: e.target.checked } }) }), 'Run local AI one call at a time (less GPU load)'),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: s.alerts.popup !== false, onchange: (e) => setSetting({ alerts: { popup: e.target.checked } }) }), 'Red pop-up on problems, also when minimized'),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: s.showBrowserWhilePosting, onchange: (e) => setSetting({ showBrowserWhilePosting: e.target.checked }) }), 'Show the browser window while posting'),
        field('Web search', sel([['auto', 'Auto: Google (AI overview) then Bing'], ['bing', 'Bing'], ['brave', 'Brave API (key)'], ['tavily', 'Tavily API (key)'], ['searxng', 'SearXNG (your server)']], s.search.engine, (x) => setSetting({ search: { engine: x } }).then(() => RENDER.settings()))),
        ['brave', 'tavily'].includes(s.search.engine) ? field('Search API key', h('div', { class: 'row' }, h('input', { type: 'password', id: 'seKey', placeholder: s.secrets.searchKey ? 'saved' : 'key' }), h('button', { class: 'btn s', onclick: async () => { await call('secrets.set', { name: 'searchKey', value: $('#seKey').value.trim() }); await loadSettings(); toast('Saved', 'ok'); } }, 'Save'))) : null,
        s.search.engine === 'searxng' ? field('SearXNG URL', h('input', { type: 'text', value: s.search.searxngUrl, onchange: (e) => setSetting({ search: { searxngUrl: e.target.value.trim() } }) })) : null,
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: s.webAiFallback, onchange: (e) => setSetting({ webAiFallback: e.target.checked }) }), 'Let the agent ask ChatGPT / Gemini / Claude websites when stuck (AI accounts in Accounts)'))),
      h('div', { class: 'card', id: 'cleanCard' }),
      h('div', { class: 'card' }, h('h3', { text: 'Storage and security' }), h('div', { class: 'col' },
        h('div', { class: 'small' }, h('b', { text: 'Data folder: ' }), s.dataRoot),
        h('div', { class: 'dim small', text: 'Chats, jobs, styles, skills, documents, the browser sign-ins, speech models and caches are all here (never on C unless no other drive exists).' }),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => call('shell.openFolder', s.dataRoot) }, icon('folder', 15), 'Open'), h('button', { class: 'btn', onclick: async () => { const r = await call('settings.setDataRoot'); if (r) toast('Data folder changed. Restart the app to use it.', 'warn', 9000); } }, 'Change')),
        field('GitHub token (optional, for importing many skills)', h('div', { class: 'row' }, h('input', { type: 'password', id: 'ghTok', placeholder: s.secrets.githubToken ? 'saved' : 'read-only public token' }), h('button', { class: 'btn s', onclick: async () => { await call('secrets.set', { name: 'githubToken', value: $('#ghTok').value.trim() }); await loadSettings(); toast('Saved', 'ok'); RENDER.settings(); } }, 'Save'))),
        h('div', { class: 'dim small', text: 'All keys are encrypted with Windows (DPAPI) in the main process. The app window never receives them, and they are removed from logs and chats.' }),
        h('div', { class: 'dim small', text: `Version ${S.info.version}` }),
        h('div', { class: 'small' }, 'Made by ', h('b', { text: 'Bunnys Framelab' }), ' · ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); call('shell.external', 'https://www.instagram.com/bunnysframelab/'); } }, 'Instagram: @bunnysframelab')))))));
};

/* ---------- Settings > Automation: how much the app does without asking, quiet hours, phone alerts ---------- */
function automationCard(s) {
  const sw = (label, hint, on, fn) => h('label', { class: 'chk sw' }, h('input', { type: 'checkbox', checked: !!on, onchange: (e) => fn(e.target.checked) }), h('span', null, label, hint ? h('span', { class: 'dim small hint', text: hint }) : null));
  const put = async (patch) => { try { await setSetting(patch); } catch (_) { /* the error toast is already shown */ } };
  const q = s.quietHours || {}, tg = s.telegram || {};
  const timeIn = (val, fn) => h('input', { type: 'time', value: val || '', style: { width: '120px' }, onchange: (e) => fn(e.target.value) });
  const tok = h('input', { type: 'password', id: 'tgTok', autocomplete: 'off', placeholder: s.secrets.telegramToken ? 'Saved (hidden). Paste a new token to replace it.' : '123456789:AA... (from @BotFather)', style: { flex: 1, minWidth: '0' } });
  const saveTok = h('button', { class: 'btn s', onclick: async () => { const v = tok.value.trim(); if (!v) { toast('Paste the bot token first.', 'warn'); return; } try { await call('secrets.set', { name: 'telegramToken', value: v }); } catch (_) { return; } tok.value = ''; await loadSettings(); toast('Token saved. It stays hidden.', 'ok'); RENDER.settings(); } }, 'Save token');
  const delTok = s.secrets.telegramToken ? h('button', { class: 'btn s ghost', onclick: async () => { await call('secrets.set', { name: 'telegramToken', value: '' }); await loadSettings(); RENDER.settings(); } }, 'Remove') : null;
  const testBtn = h('button', { class: 'btn s', onclick: async (e) => { e.target.disabled = true; try { await call('telegram.test'); toast('Test message sent. Check your phone.', 'ok'); } catch (_) { /* toast shown */ } finally { e.target.disabled = false; } } }, 'Send test message');
  const chat = h('input', { type: 'text', value: tg.chatId || '', placeholder: 'Chat id, e.g. 123456789', style: { width: '200px' }, onchange: (e) => put({ telegram: { chatId: e.target.value.trim() } }) });
  return h('div', { class: 'card wide', id: 'autoCard' }, h('h3', { text: 'Automation' }),
    h('div', { class: 'dim small', style: { marginBottom: '10px' }, text: 'For running many accounts without sitting at the PC. Every switch can be turned off.' }),
    h('div', { class: 'autogrid' },
      h('div', { class: 'col' },
        sw('Show the plan and wait for Start', 'Chat shows what it will post and waits for your go-ahead. Off: it starts at once when nothing is missing.', s.planGate !== false, (v) => put({ planGate: v })),
        sw('Ask only about what is missing', 'The agent uses saved account caption setups and your defaults instead of asking.', s.askOnlyWhenMissing !== false, (v) => put({ askOnlyWhenMissing: v })),
        sw('Retry failed posts by itself', 'One failed post does not stop the job.', s.autoRetry !== false, (v) => put({ autoRetry: v })),
        sw('Check that each post really exists', 'After posting, look for it on Buffer and flag it when it is missing.', s.autoVerify !== false, (v) => put({ autoVerify: v })),
        sw('Keep the PC awake while a job runs', 'Stops by itself when the job is done.', s.keepAwake !== false, (v) => put({ keepAwake: v })),
        h('div', { class: 'col', style: { gap: '6px', marginTop: '4px' } },
          sw('Quiet hours', 'Only sounds, pop-ups and notifications are silenced. Jobs keep running.', q.enabled, async (v) => { await put({ quietHours: { enabled: v } }); }),
          h('div', { class: 'row small', style: { paddingLeft: '26px' } }, 'From', timeIn(q.start, (v) => put({ quietHours: { start: v } })), 'to', timeIn(q.end, (v) => put({ quietHours: { end: v } }))))),
      h('div', { class: 'col' },
        sw('Phone alerts (Telegram)', 'Failures that need you, finished jobs and a daily summary. Off by default.', tg.enabled, async (v) => { await put({ telegram: { enabled: v } }); }),
        h('div', { class: 'col', style: { gap: '8px', paddingLeft: '26px' } },
          h('div', { class: 'dim small', text: 'Make a bot with @BotFather, send it one message, then get your chat id from @userinfobot. Messages carry the job title, channel names and the reason, never file paths.' }),
          field('Bot token', h('div', { class: 'row' }, tok, saveTok, delTok)),
          field('Chat id', chat),
          h('div', { class: 'col', style: { gap: '4px' } },
            sw('Tell me when a post needs me', '', tg.onAttention !== false, (v) => put({ telegram: { onAttention: v } })),
            sw('Tell me when a job finishes', '', tg.onFinished !== false, (v) => put({ telegram: { onFinished: v } })),
            h('div', { class: 'row' }, sw('Daily summary at', '', tg.daily !== false, (v) => put({ telegram: { daily: v } })), timeIn(tg.dailyTime || '20:00', (v) => put({ telegram: { dailyTime: v } })))),
          h('div', { class: 'row' }, testBtn, h('span', { class: 'dim small', text: 'At most one message every 30 seconds.' }))))));
}

pa.on('gpu:reading', (r) => { const el = $('#gpuNow'); if (el) el.textContent = r ? `Now: ${r.temp}°C, ${r.util}% busy` : 'No NVIDIA GPU found'; });

/* ---------- storage cleanup ---------- */
const CLEAN = { preset: '15d', from: '', to: '', cats: new Set(['mediaCache', 'temp', 'browserCache']) };
async function drawCleanup() {
  const box = $('#cleanCard');
  if (!box) return;
  const info = h('div', { class: 'col', style: { gap: '6px' } }, h('div', { class: 'dim small', text: 'Checking sizes...' }));
  const fromIn = h('input', { type: 'text', placeholder: 'From YYYY-MM-DD', value: CLEAN.from, style: { width: '150px' }, oninput: (e) => { CLEAN.from = e.target.value; } });
  const toIn = h('input', { type: 'text', placeholder: 'To YYYY-MM-DD', value: CLEAN.to, style: { width: '150px' }, oninput: (e) => { CLEAN.to = e.target.value; } });
  const custom = h('div', { class: 'row', style: { display: CLEAN.preset === 'custom' ? '' : 'none' } }, fromIn, toIn, h('button', { class: 'btn s', onclick: () => load() }, 'Apply'));
  const opts = () => ({ preset: CLEAN.preset, from: CLEAN.from, to: CLEAN.to });
  const load = async () => {
    let pv;
    try { pv = await call('storage.preview', opts()); } catch (_) { return; }
    info.replaceChildren(...Object.entries(pv).map(([k, v]) => h('label', { class: 'chk small' }, h('input', { type: 'checkbox', checked: CLEAN.cats.has(k), onchange: (e) => (e.target.checked ? CLEAN.cats.add(k) : CLEAN.cats.delete(k)) }),
      h('span', { style: { flex: 1 }, text: v.label }), h('span', { class: 'dim', text: `${v.count != null ? `${v.count} item(s)` : ''}${v.bytes ? `  ${fmtBytes(v.bytes)}` : ''}${v.trash ? '  (to Recycle Bin)' : ''}` }))));
  };
  box.replaceChildren(h('h3', { text: 'Storage cleanup' }),
    h('div', { class: 'dim small', style: { marginBottom: '8px' }, text: 'Removes caches and app data from the chosen time range. Settings, keys, account sign-ins, skills, styles, formats, knowledge and speech models are never touched.' }),
    h('div', { class: 'row' }, seg([['15d', 'Last 15 days'], ['30d', 'Last month'], ['6m', 'Last 6 months'], ['all', 'All time'], ['custom', 'Custom']], CLEAN.preset, (x) => { CLEAN.preset = x; drawCleanup(); })),
    custom, info,
    h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn d', onclick: async (e) => {
      const cats = [...CLEAN.cats];
      if (!cats.length) { toast('Choose what to clean', 'warn'); return; }
      if (!(await confirmBox('Clean storage?', 'Caches and jobs are deleted for good. Chats, saved posts and studies go to the Recycle Bin. Scheduled posts on Buffer are not affected.', 'Clean', true))) return;
      e.target.disabled = true;
      try { const r = await call('storage.clean', { range: opts(), cats }); toast(`Cleaned: ${Object.entries(r).map(([k, v]) => `${k} ${v}`).join(', ')}`, 'ok', 7000); } finally { e.target.disabled = false; load(); }
    } }, 'Clean selected'), h('button', { class: 'btn ghost', onclick: () => load() }, 'Refresh sizes')));
  load();
}
const _renderSettings = RENDER.settings;
RENDER.settings = async () => { await _renderSettings(); drawCleanup(); };
