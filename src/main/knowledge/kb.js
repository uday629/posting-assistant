// Knowledge: "Info" notes (brand, products, audience, offers, links), stored documents (test docs, briefs, scripts)
// and named PC locations ("reels folder" -> E:\Videos\Reels). The writer and the chat agent search these.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const store = require('../store');
const paths = require('../paths');

const rid = () => crypto.randomBytes(4).toString('hex');
const notesCol = store.collection('knowledge-notes', []);
const locCol = store.collection('locations', []);
const docsDir = () => paths.sub('knowledge', 'docs');

/* ---------------- notes ---------------- */
function notes() { return notesCol.all(); }
function saveNote(n) {
  const all = notes();
  const id = n.id || rid();
  const c = { id, title: String(n.title || 'Note').slice(0, 120), text: String(n.text || '').slice(0, 20000), tags: (Array.isArray(n.tags) ? n.tags : String(n.tags || '').split(',')).map((x) => String(x).trim()).filter(Boolean).slice(0, 12), always: !!n.always, updatedAt: Date.now() };
  const i = all.findIndex((x) => x.id === id);
  if (i >= 0) all[i] = c; else all.unshift(c);
  notesCol.save(all);
  return c;
}
function removeNote(id) { notesCol.save(notes().filter((n) => n.id !== id)); }

/* ---------------- documents ---------------- */
const TEXT_EXT = /\.(txt|md|markdown|csv|json|srt|vtt|html?|xml|ya?ml|log|tsv)$/i;
function docs() {
  const d = docsDir();
  return fs.readdirSync(d).filter((f) => !f.startsWith('.')).map((f) => {
    const st = fs.statSync(path.join(d, f));
    return { name: f, path: path.join(d, f), size: st.size, updatedAt: st.mtimeMs, text: TEXT_EXT.test(f) };
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}
function safeName(n) { return String(n).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').slice(0, 120) || 'doc.txt'; }
function addDocs(files) {
  const out = [];
  for (const f of files) {
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) continue;
    if (fs.statSync(f).size > 50 * 1024 * 1024) throw new Error(`${path.basename(f)} is larger than 50 MB.`);
    let dest = path.join(docsDir(), safeName(path.basename(f)));
    if (fs.existsSync(dest)) dest = dest.replace(/(\.[^.]+)?$/, `-${rid()}$1`);
    fs.copyFileSync(f, dest);
    out.push(path.basename(dest));
  }
  return out;
}
function docPath(name) {
  const p = path.join(docsDir(), safeName(name));
  if (!paths.inside(p)) throw new Error('Bad document name.');
  return p;
}
function readDoc(name) {
  const p = docPath(name);
  if (!TEXT_EXT.test(p)) return { name, binary: true, path: p };
  return { name, text: fs.readFileSync(p, 'utf8').slice(0, 2_000_000), path: p };
}
function writeDoc(name, text) {
  const n = safeName(/\.[a-z0-9]{1,6}$/i.test(name) ? name : `${name}.md`);
  fs.writeFileSync(path.join(docsDir(), n), String(text ?? ''));
  return n;
}
function removeDoc(name) { const p = docPath(name); if (fs.existsSync(p)) fs.unlinkSync(p); }

/* ---------------- locations ---------------- */
function locations() { return locCol.all(); }
function saveLocation(l) {
  const all = locations();
  const name = String(l.name || '').trim().slice(0, 80);
  if (!name || !l.path) throw new Error('A location needs a name and a path.');
  const c = { id: l.id || rid(), name, path: String(l.path).trim(), note: String(l.note || '').slice(0, 300), updatedAt: Date.now() };
  const i = all.findIndex((x) => x.id === c.id || x.name.toLowerCase() === name.toLowerCase());
  if (i >= 0) all[i] = { ...all[i], ...c, id: all[i].id }; else all.push(c);
  locCol.save(all);
  return c;
}
function removeLocation(id) { locCol.save(locations().filter((l) => l.id !== id)); }

/* ---------------- search ---------------- */
function tokens(s) {
  return String(s || '').toLowerCase().normalize('NFC').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOP.has(w));
}
const STOP = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'are', 'you', 'your', 'our', 'was', 'have', 'has', 'not', 'but', 'all', 'can', 'will', 'mp4', 'mov', 'jpg', 'png', 'video', 'post', 'এবং', 'এই', 'করে', 'আর', 'একটি', 'থেকে']);
function score(qt, text) {
  const t = String(text || '').toLowerCase();
  let s = 0;
  for (const w of qt) if (t.includes(w)) s += w.length > 4 ? 2 : 1;
  return s;
}
function chunks(text, size = 1200) {
  const out = [];
  const paras = String(text).split(/\n{2,}/);
  let cur = '';
  for (const p of paras) {
    if ((cur + '\n\n' + p).length > size && cur) { out.push(cur); cur = p.slice(0, size * 2); } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}
// returns the best snippets for a query, within a budget
function search(query, { budget = 3000, includeAlways = true } = {}) {
  const qt = [...new Set(tokens(query))];
  const hits = [];
  for (const n of notes()) {
    const s = score(qt, `${n.title} ${n.tags.join(' ')} ${n.text}`) + (n.always && includeAlways ? 100 : 0);
    if (s > 0) hits.push({ s, src: `Info: ${n.title}`, text: n.text });
  }
  for (const d of docs().filter((x) => x.text && x.size < 3_000_000)) {
    let txt = '';
    try { txt = fs.readFileSync(d.path, 'utf8'); } catch (_) { continue; }
    for (const c of chunks(txt)) { const s = score(qt, c) + (score(qt, d.name) ? 2 : 0); if (s >= 2) hits.push({ s, src: `Doc: ${d.name}`, text: c }); }
  }
  hits.sort((a, b) => b.s - a.s);
  const out = [];
  let used = 0;
  for (const h of hits) {
    const piece = `[${h.src}]\n${h.text.slice(0, 1500)}`;
    if (used + piece.length > budget) continue;
    out.push(piece);
    used += piece.length;
  }
  return out.join('\n\n');
}

/* ---------------- folders on the PC ---------------- */
function drives() {
  const out = [];
  for (const d of 'CDEFGHIJKLMNOPQRSTUVWXYZ') { try { if (fs.existsSync(`${d}:\\`)) out.push(`${d}:\\`); } catch (_) { /* skip */ } }
  return out;
}
// finds folders by name: saved locations first, then common folders and drive roots (a few levels deep)
function findFolder(name, { maxResults = 12 } = {}) {
  const q = String(name || '').trim();
  if (!q) return [];
  if (/^[a-z]:[\\/]/i.test(q) || q.startsWith('\\\\')) return fs.existsSync(q) ? [{ path: path.resolve(q), via: 'path' }] : [];
  const ql = q.toLowerCase();
  const res = [];
  for (const l of locations()) if (l.name.toLowerCase() === ql || l.name.toLowerCase().includes(ql) || ql.includes(l.name.toLowerCase())) res.push({ path: l.path, via: `saved location "${l.name}"` });
  if (res.length) return res;
  const home = os.homedir();
  const roots = [path.join(home, 'Videos'), path.join(home, 'Desktop'), path.join(home, 'Downloads'), path.join(home, 'Pictures'), path.join(home, 'Documents'), ...drives()];
  for (const gd of ['G:\\My Drive', path.join(home, 'Google Drive'), path.join(home, 'OneDrive')]) if (fs.existsSync(gd)) roots.unshift(gd);
  const seen = new Set();
  const SKIP = /^(windows|program files( \(x86\))?|programdata|\$recycle\.bin|system volume information|appdata|node_modules|\.git|\.cache|recovery|msocache|perflogs)$/i;
  const deadline = Date.now() + 6000;
  const walk = (d, depth) => {
    if (depth > 4 || res.length >= maxResults || Date.now() > deadline) return;
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (!e.isDirectory() || SKIP.test(e.name)) continue;
      const full = path.join(d, e.name);
      const key = full.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const nl = e.name.toLowerCase();
      if (nl === ql || nl.includes(ql)) res.push({ path: full, via: 'search' });
      if (res.length >= maxResults) return;
    }
    for (const e of ents) if (e.isDirectory() && !SKIP.test(e.name)) walk(path.join(d, e.name), depth + 1);
  };
  for (const r of roots) walk(r, 0);
  // exact name matches first
  return res.sort((a, b) => (path.basename(b.path).toLowerCase() === ql) - (path.basename(a.path).toLowerCase() === ql));
}

module.exports = { notes, saveNote, removeNote, docs, addDocs, readDoc, writeDoc, removeDoc, docPath, locations, saveLocation, removeLocation, search, findFolder, tokens };
