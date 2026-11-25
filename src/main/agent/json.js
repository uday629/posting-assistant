// Tolerant JSON extraction for model replies (fences, <think> blocks, trailing commas, extra prose).
function stripThink(t) {
  return String(t || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
}
function balanced(t, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return t.slice(start, i + 1); }
  }
  return null;
}
function repair(s) {
  return s
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/[“”]/g, '"')
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
}
function parseJson(text) {
  let t = stripThink(text);
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch (_) { /* continue */ }
  for (let i = t.indexOf('{'); i >= 0; i = t.indexOf('{', i + 1)) {
    const cand = balanced(t, i);
    if (!cand) continue;
    try { return JSON.parse(cand); } catch (_) { /* try repaired */ }
    try { return JSON.parse(repair(cand)); } catch (_) { /* next */ }
  }
  throw new Error('Model reply was not valid JSON');
}
module.exports = { parseJson, stripThink };
