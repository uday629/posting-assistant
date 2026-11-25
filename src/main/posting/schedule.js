// Turns a schedule request into exact times, in the PC's local time zone.
// spec: {mode:'now'|'queue'|'custom'|'draft', start:'2026-11-23 19:00' | ISO, every:'1d'|'12h'|'30m'|'1w', times:['10:00','19:00'], perDay:N, dates:[...]}
function parseLocal(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  const str = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(str)) return new Date(str);
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/i.exec(str);
  if (m) {
    let h = Number(m[4] || 0);
    if (m[6]) { const pm = /pm/i.test(m[6]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, Number(m[5] || 0), 0, 0);
  }
  const d = new Date(str);
  return isNaN(d) ? null : d;
}
function parseTime(t) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(String(t).trim());
  if (!m) return null;
  let h = Number(m[1]);
  if (m[3]) { const pm = /pm/i.test(m[3]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  if (h > 23) return null;
  return [h, Number(m[2] || 0)];
}
function parseEvery(e) {
  const m = /^(\d+(?:\.\d+)?)\s*(m|min|h|hr|d|day|w|week)s?$/i.exec(String(e || '').trim());
  if (!m) return null;
  const n = Number(m[1]), u = m[2].toLowerCase()[0];
  return n * { m: 60000, h: 3600000, d: 86400000, w: 604800000 }[u];
}

// returns an array (one entry per item) of ISO strings, 'now', null (= Buffer queue) or 'draft'
function compute(spec, count, defaults = {}) {
  spec = spec || {};
  const mode = spec.mode || (spec.start || spec.times || spec.dates ? 'custom' : 'queue');
  if (mode === 'now') return Array(count).fill('now');
  if (mode === 'queue') return Array(count).fill(null);
  if (mode === 'draft') return Array(count).fill('draft');
  if (Array.isArray(spec.dates) && spec.dates.length) {
    const out = spec.dates.map(parseLocal).filter(Boolean).map((d) => d.toISOString());
    while (out.length < count) out.push(new Date(new Date(out[out.length - 1] || Date.now()).getTime() + 86400000).toISOString());
    return out.slice(0, count);
  }
  const minLead = 5 * 60000;
  let start = parseLocal(spec.start) || new Date(Date.now() + 15 * 60000);
  const times = (spec.times?.length ? spec.times : spec.every ? null : defaults.timeSlots || ['19:00']);
  const out = [];
  if (times) {
    const slots = times.map(parseTime).filter(Boolean).sort((a, b) => a[0] * 60 + a[1] - (b[0] * 60 + b[1]));
    const perDay = Math.max(1, Math.min(slots.length, Number(spec.perDay) || slots.length));
    const use = slots.slice(0, perDay);
    const startHasTime = spec.start && /\d{1,2}:\d{2}|am|pm|T\d/i.test(String(spec.start));
    let day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const stepDays = Math.max(1, Math.round((parseEvery(spec.every) || 86400000) / 86400000));
    let first = true;
    while (out.length < count) {
      for (const [h, mi] of use) {
        const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, mi);
        if (first && startHasTime && d < start) continue;
        if (d.getTime() < Date.now() + minLead) continue;
        out.push(d.toISOString());
        if (out.length >= count) break;
      }
      first = false;
      day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + stepDays);
    }
    return out;
  }
  const every = parseEvery(spec.every) || 86400000;
  if (start.getTime() < Date.now() + minLead) start = new Date(Date.now() + minLead);
  for (let i = 0; i < count; i++) out.push(new Date(start.getTime() + i * every).toISOString());
  return out;
}

function human(iso) {
  if (iso === 'now') return 'now';
  if (iso === 'draft') return 'draft';
  if (!iso) return 'next free slot in Buffer queue';
  const d = new Date(iso);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })} (${tz}, UTC${sign}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')})`;
}

module.exports = { compute, human, parseLocal, parseTime, parseEvery };
