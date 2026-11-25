// Makes a local file reachable by a public HTTPS URL (Buffer fetches media from a URL when it publishes).
// Providers: Cloudinary (signed upload, chunked for big videos) and any S3-compatible bucket with public read
// (Cloudflare R2, AWS S3, Backblaze B2, Wasabi...). Uploaded files are deleted after N days (after Buffer has them).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('../store');

const hostedCol = store.collection('hosted-media', []);
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (k, s, enc) => crypto.createHmac('sha256', k).update(s).digest(enc);

function cfg() { return store.get().hosting; }
function configured() {
  const h = cfg();
  if (h.provider === 'cloudinary') return !!(h.cloudName && store.secret('cloudinaryKey') && store.secret('cloudinarySecret'));
  if (h.provider === 's3') return !!(h.endpoint && h.bucket && h.publicBase && store.secret('s3AccessKey') && store.secret('s3SecretKey'));
  return false;
}
function objectName(file) {
  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file, ext).normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').slice(0, 50) || 'media';
  return `${base}-${crypto.randomBytes(4).toString('hex')}${ext}`;
}
const isVideo = (f) => /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(f);
const MIME = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

/* ---------------- Cloudinary ---------------- */
function cloudSign(params, secret) {
  const s = Object.keys(params).filter((k) => params[k] !== '' && params[k] != null).sort().map((k) => `${k}=${params[k]}`).join('&');
  return sha1(s + secret);
}
async function cloudinaryUpload(file, onProgress, signal) {
  const h = cfg();
  const key = store.secret('cloudinaryKey'), secret = store.secret('cloudinarySecret');
  const rtype = isVideo(file) ? 'video' : 'image';
  const publicId = objectName(file).replace(/\.[^.]+$/, '');
  const params = { folder: h.folder || 'posting-assistant', public_id: publicId, timestamp: Math.floor(Date.now() / 1000) };
  const signature = cloudSign(params, secret);
  const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(h.cloudName)}/${rtype}/upload`;
  const size = fs.statSync(file).size;
  const CHUNK = 20 * 1024 * 1024;
  const uploadId = crypto.randomBytes(8).toString('hex');
  const fd = fs.openSync(file, 'r');
  let last = null;
  try {
    for (let start = 0; start < size || (size === 0 && start === 0); start += CHUNK) {
      const end = Math.min(size, start + CHUNK) - 1;
      const buf = Buffer.alloc(end - start + 1);
      fs.readSync(fd, buf, 0, buf.length, start);
      const form = new FormData();
      form.append('file', new Blob([buf]), path.basename(file));
      for (const [k, v] of Object.entries(params)) form.append(k, String(v));
      form.append('api_key', key);
      form.append('signature', signature);
      const headers = size > CHUNK ? { 'X-Unique-Upload-Id': uploadId, 'Content-Range': `bytes ${start}-${end}/${size}` } : {};
      const r = await fetch(url, { method: 'POST', body: form, headers, signal });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Cloudinary: ${j.error?.message || r.status}`);
      last = j;
      onProgress?.({ completed: end + 1, total: size });
      if (size === 0) break;
    }
  } finally { fs.closeSync(fd); }
  if (!last?.secure_url) throw new Error('Cloudinary did not return a URL.');
  return { url: last.secure_url, ref: { provider: 'cloudinary', publicId: last.public_id, rtype } };
}
async function cloudinaryDelete(ref) {
  const h = cfg();
  const params = { public_id: ref.publicId, timestamp: Math.floor(Date.now() / 1000) };
  const form = new FormData();
  for (const [k, v] of Object.entries(params)) form.append(k, String(v));
  form.append('api_key', store.secret('cloudinaryKey'));
  form.append('signature', cloudSign(params, store.secret('cloudinarySecret')));
  const r = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(h.cloudName)}/${ref.rtype}/destroy`, { method: 'POST', body: form });
  if (!r.ok) throw new Error(`Cloudinary delete: ${r.status}`);
}

/* ---------------- S3-compatible (SigV4) ---------------- */
function s3Request(method, key, { body, contentType, size } = {}) {
  const h = cfg();
  const ep = new URL(h.endpoint.replace(/\/+$/, ''));
  const region = h.region || 'auto';
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const canonicalUri = `${ep.pathname.replace(/\/$/, '')}/${encodeURIComponent(h.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const headers = { host: ep.host, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD', 'x-amz-date': amzDate };
  if (contentType) headers['content-type'] = contentType;
  if (size != null) headers['content-length'] = String(size);
  const signed = Object.keys(headers).sort();
  const canonical = [method, canonicalUri, '', signed.map((k) => `${k}:${headers[k]}\n`).join(''), signed.join(';'), 'UNSIGNED-PAYLOAD'].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kDate = hmac(`AWS4${store.secret('s3SecretKey')}`, day);
  const kSign = hmac(hmac(hmac(kDate, region), 's3'), 'aws4_request');
  const sig = hmac(kSign, toSign, 'hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${store.secret('s3AccessKey')}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${sig}`;
  delete headers.host;
  return fetch(`${ep.origin}${canonicalUri}`, { method, headers, body, ...(body ? { duplex: 'half' } : {}) });
}
async function s3Upload(file, onProgress) {
  const h = cfg();
  const key = `${(h.folder || 'posting-assistant').replace(/^\/|\/$/g, '')}/${objectName(file)}`;
  const size = fs.statSync(file).size;
  const { Readable } = require('stream');
  let done = 0;
  const stream = fs.createReadStream(file);
  stream.on('data', (c) => { done += c.length; onProgress?.({ completed: done, total: size }); });
  const r = await s3Request('PUT', key, { body: Readable.toWeb(stream), contentType: MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', size });
  if (!r.ok) throw new Error(`Bucket upload failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const url = `${h.publicBase.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
  return { url, ref: { provider: 's3', key } };
}
async function s3Delete(ref) { const r = await s3Request('DELETE', ref.key); if (!r.ok && r.status !== 404) throw new Error(`Bucket delete: ${r.status}`); }

/* ---------------- public API ---------------- */
async function upload(file, { onProgress, signal, keepDays } = {}) {
  const h = cfg();
  // dev-only test hook (ignored in the installed app)
  if (process.env.PA_HOSTING_MOCK && !require('electron').app.isPackaged) { onProgress?.({ completed: 1, total: 1 }); return `https://media.example.test/${encodeURIComponent(path.basename(file))}`; }
  if (!configured()) throw new Error('Buffer needs a public link for videos and images. Open Accounts > Media hosting and connect Cloudinary (free) or an S3/R2 bucket.');
  const r = h.provider === 'cloudinary' ? await cloudinaryUpload(file, onProgress, signal) : await s3Upload(file, onProgress, signal);
  // check that the link really is public before handing it to Buffer
  try { const head = await fetch(r.url, { method: 'HEAD' }); if (!head.ok) throw new Error(String(head.status)); }
  catch (e) { throw new Error(`The uploaded file is not publicly reachable (${e.message}). Make the bucket public or check the public URL setting.`); }
  const all = hostedCol.all();
  all.push({ url: r.url, ref: r.ref, file, at: Date.now(), deleteAfter: Date.now() + (keepDays ?? h.deleteAfterDays ?? 10) * 86400000 });
  hostedCol.save(all);
  return r.url;
}
// removes hosted copies whose time is up (and that are not needed by a later scheduled post)
async function cleanup(minKeepUntil = {}) {
  const all = hostedCol.all();
  const keep = [];
  for (const h of all) {
    const until = Math.max(h.deleteAfter, minKeepUntil[h.url] || 0);
    if (Date.now() < until) { keep.push(h); continue; }
    try { if (h.ref.provider === 'cloudinary') await cloudinaryDelete(h.ref); else if (h.ref.provider === 's3') await s3Delete(h.ref); }
    catch (_) { if (Date.now() - h.deleteAfter < 30 * 86400000) keep.push(h); }
  }
  hostedCol.save(keep);
  return all.length - keep.length;
}
function extend(url, untilMs) {
  const all = hostedCol.all();
  const h = all.find((x) => x.url === url);
  if (h && untilMs > h.deleteAfter) { h.deleteAfter = untilMs; hostedCol.save(all); }
}
async function test() {
  const tmp = path.join(require('../paths').sub('tmp'), 'posting-assistant-test.png');
  // 1x1 transparent PNG
  fs.writeFileSync(tmp, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
  const url = await upload(tmp, { keepDays: 0 });
  await cleanup();
  return { ok: true, url };
}

module.exports = { upload, cleanup, extend, configured, test, cloudSign };
