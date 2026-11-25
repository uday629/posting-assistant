// "/name" commands in any chat: /humanizer, /hook-story-lesson, /bangla-storyteller ... pick a skill, a format or a
// caption style for this message. Unknown names are left in the text.
const skills = require('../caption/skills');
const formats = require('./formats');
const styles = require('../caption/styles');
const craft = require('../caption/craft');

const RE = /(^|\s)\/([a-z0-9ঀ-৿][\w\-ঀ-৿]{1,60})/gi;

function parse(text) {
  const used = { skills: [], formats: [], styles: [], tones: [], structures: [] };
  const clean = String(text || '').replace(RE, (m, pre, name) => {
    const sk = skills.find(name);
    if (sk) { used.skills.push(sk); return pre; }
    const f = formats.get(name);
    if (f && (formats.slug(f.name) === name.toLowerCase() || f.id === name.toLowerCase())) { used.formats.push(f); return pre; }
    const st = styles.list().find((s) => s.id === name.toLowerCase() || formats.slug(s.name) === name.toLowerCase());
    if (st) { used.styles.push(st); return pre; }
    const tn = craft.list('tone').find((x) => x.id === name.toLowerCase() || craft.slug(x.name) === name.toLowerCase());
    if (tn) { used.tones.push(tn); return pre; }
    const sx = craft.list('structure').find((x) => x.id === name.toLowerCase() || craft.slug(x.name) === name.toLowerCase());
    if (sx) { used.structures.push(sx); return pre; }
    return m;
  }).replace(/\s{2,}/g, ' ').trim();
  return { text: clean, ...used, any: used.skills.length + used.formats.length + used.styles.length + used.tones.length + used.structures.length > 0 };
}
// prompt block for what the user picked
function context(p, budget = 12000) {
  const parts = [];
  let left = budget;
  for (const s of p.skills) { const t = skills.fullPrompt(s.id, Math.max(1500, Math.floor(left / Math.max(1, p.skills.length)))); parts.push(t); left -= t.length; }
  for (const f of p.formats) parts.push(formats.describe(f));
  for (const s of p.styles) parts.push(styles.describe(s));
  for (const x of p.tones || []) parts.push(`Tone "${x.name}" (id ${x.id}): ${x.prompt}`);
  for (const x of p.structures || []) parts.push(`Caption structure "${x.name}" (id ${x.id}):\n${x.steps.map((y, i) => `${i + 1}. ${y}`).join('\n')}`);
  if ((p.tones || []).length || (p.structures || []).length) parts.push(`When you start a posting job for this message, pass ${(p.tones || []).length ? `"tone": "${p.tones[0].id}" ` : ''}${(p.structures || []).length ? `"structure": "${p.structures[0].id}"` : ''} to create_post_job.`);
  return parts.length ? `THE USER PICKED THESE FOR THIS MESSAGE (follow them closely):\n\n${parts.join('\n\n')}` : '';
}
// list for the "/" autocomplete in the UI
function catalog() {
  return [
    ...skills.list().map((s) => ({ type: 'skill', name: skills.slugOf(s.id), label: s.name, hint: s.description })),
    ...formats.list().map((f) => ({ type: 'format', name: f.id.startsWith('fmt-') ? formats.slug(f.name) : f.id, label: f.name, hint: f.summary })),
    ...styles.list().map((s) => ({ type: 'style', name: s.id.startsWith('style-') ? formats.slug(s.name) : s.id, label: s.name, hint: s.tone })),
    ...craft.list('tone').map((x) => ({ type: 'tone', name: x.id, label: x.name, hint: x.prompt.slice(0, 70) })),
    ...craft.list('structure').map((x) => ({ type: 'structure', name: x.id, label: x.name, hint: x.steps[0] }))
  ];
}

module.exports = { parse, context, catalog };
