// Small, safe Markdown parser shared by the app UI (HTML preview) and the DOCX exporter.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MD = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function inline(text) {
    // returns [{text, b, i, code, link}]
    const out = [];
    const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push({ text: text.slice(last, m.index) });
      const s = m[0];
      if (m[1]) out.push({ text: s.slice(1, -1), code: true });
      else if (m[2] || m[3]) out.push(...inline(s.slice(2, -2)).map((x) => ({ ...x, b: true })));
      else if (m[4] || m[5]) out.push(...inline(s.slice(1, -1)).map((x) => ({ ...x, i: true })));
      else if (m[6]) {
        const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(s);
        out.push({ text: mm[1], link: mm[2] });
      } else if (m[7]) out.push({ text: s, link: s });
      last = m.index + s.length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  }
  function splitRow(line) {
    let l = line.trim();
    if (l.startsWith('|')) l = l.slice(1);
    if (l.endsWith('|')) l = l.slice(0, -1);
    return l.split('|').map((c) => c.trim());
  }
  function parse(md) {
    const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*$/.test(line)) { i++; continue; }
      let m;
      if ((m = /^```/.exec(line))) {
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        blocks.push({ type: 'code', text: buf.join('\n') });
        continue;
      }
      if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { blocks.push({ type: 'h', level: m[1].length, inl: inline(m[2].trim()) }); i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        const header = splitRow(line).map(inline);
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(splitRow(lines[i++]).map(inline));
        blocks.push({ type: 'table', header, rows });
        continue;
      }
      if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
        blocks.push({ type: 'quote', inl: inline(buf.join(' ')) });
        continue;
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        const ordered = /^\s*\d+[.)]/.test(line);
        const items = [];
        while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
          const indent = /^\s*/.exec(lines[i])[0].length;
          let text = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
          i++;
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) text += ' ' + lines[i++].trim();
          const task = /^\[( |x|X)\]\s+/.exec(text);
          items.push({ inl: inline(task ? text.slice(task[0].length) : text), level: Math.min(3, Math.floor(indent / 2)), done: task ? task[1] !== ' ' : null });
        }
        blocks.push({ type: ordered ? 'ol' : 'ul', items });
        continue;
      }
      const buf = [line.trim()];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|```|\s*>|\s*([-*+]|\d+[.)])\s+|\s*\|)/.test(lines[i])) buf.push(lines[i++].trim());
      blocks.push({ type: 'p', inl: inline(buf.join(' ')) });
    }
    return blocks;
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function safeUrl(u) { return /^(https?:|mailto:)/i.test(u) ? u : '#'; }
  function inlHtml(inl) {
    return inl.map((x) => {
      let s = esc(x.text);
      if (x.code) s = `<code>${s}</code>`;
      if (x.b) s = `<strong>${s}</strong>`;
      if (x.i) s = `<em>${s}</em>`;
      if (x.link) s = `<a href="${esc(safeUrl(x.link))}" data-link="1">${s}</a>`;
      return s;
    }).join('');
  }
  function toHtml(md) {
    return parse(md).map((b) => {
      switch (b.type) {
        case 'h': return `<h${b.level}>${inlHtml(b.inl)}</h${b.level}>`;
        case 'p': return `<p>${inlHtml(b.inl)}</p>`;
        case 'hr': return '<hr>';
        case 'code': return `<pre><code>${esc(b.text)}</code></pre>`;
        case 'quote': return `<blockquote>${inlHtml(b.inl)}</blockquote>`;
        case 'ul': case 'ol':
          return `<${b.type}>${b.items.map((it) => `<li style="margin-left:${it.level * 18}px">${it.done != null ? (it.done ? '&#9745; ' : '&#9744; ') : ''}${inlHtml(it.inl)}</li>`).join('')}</${b.type}>`;
        case 'table':
          return `<table><thead><tr>${b.header.map((c) => `<th>${inlHtml(c)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${inlHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
        default: return '';
      }
    }).join('\n');
  }
  return { parse, inline, toHtml, esc };
});
