// Minimal, safe ZIP reader (no dependency): reads the central directory and inflates text entries only.
// Guards: max entries, max total unpacked size, max ratio (zip bombs), and entry names are never used as paths
// (no extraction to disk, so no zip-slip).
const fs = require('fs');
const zlib = require('zlib');

const LIMITS = { maxEntries: 400, maxFile: 2 * 1024 * 1024, maxTotal: 20 * 1024 * 1024, maxRatio: 200 };

function readZip(file, { accept = /\.(md|markdown|txt|json)$/i } = {}) {
  const st = fs.statSync(file);
  if (st.size > 50 * 1024 * 1024) throw new Error('The ZIP is larger than 50 MB.');
  const buf = fs.readFileSync(file);
  // end of central directory record
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a valid ZIP file.');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (count > LIMITS.maxEntries) throw new Error(`The ZIP has too many files (${count}).`);
  const out = [];
  const skipped = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('Broken ZIP directory.');
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const usize = buf.readUInt32LE(off + 24);
    const nlen = buf.readUInt16LE(off + 28), xlen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nlen).toString('utf8').replace(/\\/g, '/');
    off += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    if (!accept.test(name) || name.split('/').some((p) => p === '..' || p.startsWith('.git'))) { skipped.push(name); continue; }
    if (usize > LIMITS.maxFile || (csize && usize / csize > LIMITS.maxRatio)) { skipped.push(`${name} (too large)`); continue; }
    total += usize;
    if (total > LIMITS.maxTotal) throw new Error('The ZIP unpacks to more than 20 MB of text.');
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('Broken ZIP entry.');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.slice(start, start + csize);
    let content;
    if (method === 0) content = data;
    else if (method === 8) content = zlib.inflateRawSync(data, { maxOutputLength: LIMITS.maxFile + 1 });
    else { skipped.push(`${name} (unsupported compression)`); continue; }
    out.push({ name, text: content.toString('utf8') });
  }
  return { files: out, skipped };
}

module.exports = { readZip, LIMITS };
