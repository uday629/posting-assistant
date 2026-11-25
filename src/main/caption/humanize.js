// Deterministic clean-up of model text before it is posted: invisible characters, em dashes, curly quotes and the
// English "AI slop" lexicon from the bundled ig-human skill (slop.json, MIT, Jake Schincariol). Bangla text is safe:
// only typography is touched there.
const fs = require('fs');
const path = require('path');

let LEX = null;
function lex() {
  if (LEX) return LEX;
  try { LEX = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'assets', 'skills', 'github', 'slop.json'), 'utf8')); } catch (_) { LEX = { words: [], phrases: [], structures: [] }; }
  return LEX;
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function keepCase(src, rep) {
  if (!rep) return rep;
  if (src[0] === src[0].toUpperCase() && src[0] !== src[0].toLowerCase()) return rep[0].toUpperCase() + rep.slice(1);
  return rep;
}

function clean(text, { slop = true } = {}) {
  let t = String(text ?? '');
  // invisible / format characters
  t = t.replace(/[\u200b-\u200d\u2060-\u2064\ufeff\u00ad\u202a-\u202e\u2066-\u2069]|[\u{E0000}-\u{E007F}]/gu, '');
  // ZWNJ (U+200C) is legitimately used in some scripts, but not in Bangla captions here; ZWJ removed above too
  t = t.replace(/[   ]/g, ' ');
  // typography
  t = t.replace(/\s*—\s*/g, ', ').replace(/\s+–\s+/g, ' - ').replace(/–/g, '-')
    .replace(/[“”„‟]/g, '"').replace(/[‘’‚‛]/g, "'").replace(/…/g, '...').replace(/^\s*[•●▪]\s*/gm, '- ');
  if (slop) {
    const L = lex();
    // protect URLs and hashtags
    const keep = [];
    t = t.replace(/https?:\/\/\S+|#[\p{L}\p{M}\p{N}_]+/gu, (m) => { keep.push(m); return `\u0000${keep.length - 1}\u0000`; });
    for (const p of [...(L.phrases || []), ...(L.words || [])]) {
      if (!p.find) continue;
      const re = new RegExp(`\\b${esc(p.find)}\\b`, 'gi');
      t = t.replace(re, (m) => keepCase(m, p.replace || ''));
    }
    t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[Number(i)]);
  }
  // tidy what replacements leave behind
  t = t.replace(/ {2,}/g, ' ').replace(/ ([,.!?;:])/g, '$1').replace(/,\s*,/g, ',').replace(/,\s*\./g, '.').replace(/\.\s*\./g, '.').replace(/^[,\s]+/gm, (m) => m.replace(/,/g, ''));
  return t.trim();
}

// structural tells, reported (not rewritten)
function flags(text) {
  const out = [];
  for (const s of lex().structures || []) {
    try {
      // python regex syntax -> JS: inline flags and \UXXXXXXXX escapes
      let src = s.regex, fl = 'gu';
      const m = /^\(\?([imsx]+)\)/.exec(src);
      if (m) { src = src.slice(m[0].length); for (const f of m[1]) if ('ims'.includes(f) && !fl.includes(f)) fl += f; }
      src = src.replace(/\\U([0-9A-Fa-f]{8})/g, (_, hx) => `\\u{${parseInt(hx, 16).toString(16)}}`);
      if (s.id === 'hashtag-wall') continue; // hashtags are placed on their own line on purpose
      if (new RegExp(src, fl).test(text)) out.push(s.name);
    } catch (_) { /* python-only regex syntax */ }
  }
  return out;
}

module.exports = { clean, flags };
