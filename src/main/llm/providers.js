// One interface for every model source: Ollama, LM Studio, llama.cpp, any OpenAI-compatible API, Anthropic, Gemini.
const store = require('../store');

const PRESETS = [
  { preset: 'ollama', type: 'ollama', name: 'Ollama', baseUrl: 'http://127.0.0.1:11434', local: true },
  { preset: 'lmstudio', type: 'openai', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', local: true },
  { preset: 'llamacpp', type: 'openai', name: 'llama.cpp server', baseUrl: 'http://127.0.0.1:8080/v1', local: true },
  { preset: 'jan', type: 'openai', name: 'Jan', baseUrl: 'http://127.0.0.1:1337/v1', local: true },
  { preset: 'vllm', type: 'openai', name: 'vLLM', baseUrl: 'http://127.0.0.1:8000/v1', local: true },
  { preset: 'localai', type: 'openai', name: 'LocalAI', baseUrl: 'http://127.0.0.1:8080/v1', local: true },
  { preset: 'openai', type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', needsKey: true },
  { preset: 'anthropic', type: 'anthropic', name: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com/v1', needsKey: true },
  { preset: 'gemini', type: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', needsKey: true },
  { preset: 'openrouter', type: 'openai', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true },
  { preset: 'groq', type: 'openai', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true },
  { preset: 'mistral', type: 'openai', name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', needsKey: true },
  { preset: 'deepseek', type: 'openai', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', needsKey: true },
  { preset: 'xai', type: 'openai', name: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', needsKey: true },
  { preset: 'together', type: 'openai', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', needsKey: true },
  { preset: 'fireworks', type: 'openai', name: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1', needsKey: true },
  { preset: 'cerebras', type: 'openai', name: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', needsKey: true },
  { preset: 'perplexity', type: 'openai', name: 'Perplexity', baseUrl: 'https://api.perplexity.ai', needsKey: true },
  { preset: 'custom', type: 'openai', name: 'Custom (OpenAI-compatible)', baseUrl: '', needsKey: false }
];

const NOT_CHAT = /embed|whisper|tts|dall-?e|moderation|rerank|transcri|speech|audio|realtime|imagen|veo|sdxl|flux|stable-diffusion|clip|bge-|nomic|e5-|aqa|computer-use-preview|search-preview|image-(gen|1)|gpt-image|sora/i;
const VISION_HINT = /vision|[-_.:]vl\b|vl[-_:]|-vl|llava|bakllava|pixtral|gemma-?3|gemma-?4|minicpm-?v|qwen[\d.]*-?vl|qwen3\.5|qwen-?omni|internvl|moondream|phi-?3.*vision|phi-?4-multimodal|llama-?3\.2.*vision|llama-?4|mistral-small-?3\.[12]|mistral-medium|mistral-large-?3|magistral|gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|o1\b|o3\b|o4|claude|gemini|grok-(2-vision|4|vision)|granite.*vision|kimi-vl|glm-4\.?\dv|ui-tars|holo|smolvlm|idefics|cogvlm|molmo/i;

const caps = new Map(); // `${providerId}::${model}` -> {vision, thinking}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function timeoutSignal(signal, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error('timeout')), ms);
  if (signal) {
    if (signal.aborted) ac.abort(signal.reason);
    else signal.addEventListener('abort', () => ac.abort(signal.reason), { once: true });
  }
  return { signal: ac.signal, done: () => clearTimeout(t) };
}
async function http(url, { method = 'GET', headers = {}, body, signal, timeout = 30000 } = {}) {
  const ts = timeoutSignal(signal, timeout);
  let res;
  try {
    res = await fetch(url, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: ts.signal });
  } catch (e) {
    ts.done();
    if (signal?.aborted) throw new Error('ABORTED');
    const msg = String(e?.cause?.code || e?.message || e);
    if (/ECONNREFUSED|fetch failed/i.test(msg)) throw new Error(`Cannot reach ${new URL(url).host}. Is the server running?`);
    if (/timeout|abort/i.test(msg)) throw new Error(`Request to ${new URL(url).host} timed out.`);
    throw new Error(msg);
  }
  const text = await res.text();
  ts.done();
  let data = null;
  try { data = JSON.parse(text); } catch (_) { /* not json */ }
  if (!res.ok) {
    const m = data?.error?.message || data?.error || data?.message || text.slice(0, 300);
    const err = new Error(`${res.status}: ${typeof m === 'string' ? m : JSON.stringify(m)}`);
    err.status = res.status;
    throw err;
  }
  return data ?? text;
}
const authHeaders = (p) => (p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {});
const extraHeaders = (p) => (p.preset === 'openrouter' ? { 'X-Title': 'Posting Assistant' } : {});
const origin = (u) => { try { return new URL(u).origin; } catch (_) { return u; } };

function guessVision(id) { return VISION_HINT.test(id); }
function override(pid, model) { return store.get().modelOverrides[`${pid}::${model}`] || {}; }

/* ---------------- model listing ---------------- */
async function listModels(pid) {
  const p = store.provider(pid);
  if (!p) throw new Error('Unknown provider');
  if (p.type !== 'ollama' && !p.baseUrl) throw new Error('Set the base URL first.');
  let models = [];
  if (p.type === 'ollama') {
    const d = await http(`${p.baseUrl}/api/tags`, { timeout: 8000 });
    models = await Promise.all((d.models || []).map(async (m) => {
      const info = { id: m.name, size: m.size, params: m.details?.parameter_size, family: m.details?.family, local: true };
      try {
        const s = await http(`${p.baseUrl}/api/show`, { method: 'POST', body: { model: m.name }, timeout: 8000 });
        const c = s.capabilities || [];
        info.vision = c.length ? c.includes('vision') : guessVision(m.name) || !!s.projector_info;
        info.thinking = c.includes('thinking');
        info.chat = c.length ? c.includes('completion') : !NOT_CHAT.test(m.name);
        const mi = s.model_info || {};
        const ctxKey = Object.keys(mi).find((k) => k.endsWith('.context_length'));
        if (ctxKey) info.ctx = mi[ctxKey];
        const blk = Object.keys(mi).find((k) => k.endsWith('.block_count'));
        if (blk) info.layers = mi[blk];
      } catch (_) {
        info.vision = guessVision(m.name);
        info.chat = !NOT_CHAT.test(m.name);
      }
      return info;
    }));
  } else if (p.type === 'openai') {
    let types = {};
    if (p.preset === 'lmstudio') {
      try {
        const d0 = await http(`${origin(p.baseUrl)}/api/v0/models`, { timeout: 6000 });
        for (const m of d0.data || []) types[m.id] = m.type;
      } catch (_) { /* older LM Studio */ }
    }
    const d = await http(`${p.baseUrl}/models`, { headers: { ...authHeaders(p), ...extraHeaders(p) }, timeout: 15000 });
    const arr = Array.isArray(d) ? d : d.data || d.models || [];
    models = arr.map((m) => {
      const id = m.id || m.name;
      let vision = guessVision(id);
      if (types[id]) vision = types[id] === 'vlm';
      const mods = m.architecture?.input_modalities;
      if (Array.isArray(mods)) vision = mods.includes('image');
      const chat = types[id] ? types[id] !== 'embeddings' : !NOT_CHAT.test(id);
      return { id, vision, chat, ctx: m.context_length || m.max_context_length, local: !!PRESETS.find((x) => x.preset === p.preset)?.local };
    });
  } else if (p.type === 'anthropic') {
    const d = await http(`${p.baseUrl}/models?limit=1000`, { headers: { 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01' }, timeout: 15000 });
    models = (d.data || []).map((m) => ({ id: m.id, vision: true, chat: true, label: m.display_name }));
  } else if (p.type === 'gemini') {
    const d = await http(`${p.baseUrl}/models?pageSize=1000`, { headers: { 'x-goog-api-key': p.apiKey }, timeout: 15000 });
    models = (d.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), vision: !NOT_CHAT.test(m.name), chat: !NOT_CHAT.test(m.name), ctx: m.inputTokenLimit, label: m.displayName }));
  }
  for (const m of models) {
    const o = override(pid, m.id);
    if (o.vision != null) m.vision = o.vision;
    m.visionOverridden = o.vision != null;
    caps.set(`${pid}::${m.id}`, { vision: m.vision, thinking: !!m.thinking, size: m.size, layers: m.layers });
  }
  return models.filter((m) => m.chat !== false).sort((a, b) => a.id.localeCompare(b.id));
}
async function ensureCaps(pid, model) {
  if (!pid || !model || caps.has(`${pid}::${model}`)) return;
  try { await listModels(pid); } catch (_) { /* provider offline: fall back to name guess */ }
}
function modelCaps(pid, model) {
  const o = override(pid, model);
  const c = caps.get(`${pid}::${model}`) || { vision: guessVision(model), thinking: false };
  return { ...c, vision: o.vision != null ? o.vision : c.vision };
}

/* ---------------- chat ---------------- */
// "writer" and "vision" fall back to the main model when they are not set
function resolveRole(role) {
  if (role && typeof role === 'object') return role;
  const roles = store.get().roles;
  const rc = roles[role];
  if (rc && rc.model) return rc;
  return roles.main;
}
function roleCanSee(role) {
  const rc = resolveRole(role);
  if (!rc || !rc.model) return false;
  return !!modelCaps(rc.provider, rc.model).vision;
}
// msgs: [{role:'user'|'assistant', text, images?:[base64 jpeg]}]
async function chat(role, { system, messages, json = true, maxTokens = 1200, signal, temperature }) {
  const rc = resolveRole(role);
  if (!rc || !rc.model) throw new Error('No AI model chosen yet. Open Models and pick one (or add an API key).');
  const p = store.provider(rc.provider);
  if (!p) throw new Error('The chosen provider was removed. Pick a model again in Models.');
  if (!p.enabled) throw new Error(`Provider "${p.name}" is disabled.`);
  const temp = temperature ?? rc.temperature ?? 0.2;
  const local = p.type === 'ollama' || !!PRESETS.find((x) => x.preset === p.preset)?.local;
  const timeout = local ? 300000 : 180000;
  // local models: one call at a time (no GPU pile-up) and the heat guard decides when the next call may start
  if (local) return localLane(signal, () => callOnce(p, rc, { system, messages, json, maxTokens, signal, temp, timeout }));
  return callOnce(p, rc, { system, messages, json, maxTokens, signal, temp, timeout });
}
let lane = Promise.resolve();
function localLane(signal, fn) {
  const gpu = require('./gpuguard');
  const s = store.get().gpu || {};
  gpu.configure({ enabled: s.enabled !== false, warm: s.warm, hot: s.hot, stop: s.stop, cool: s.cool });
  const run = async () => {
    gpu.acquire();
    try { await gpu.gate(signal); return await fn(); } finally { gpu.release(); }
  };
  if (s.localOneAtATime === false) return run();
  const next = lane.then(run, run);
  lane = next.catch(() => {});
  return next;
}
async function callOnce(p, rc, { system, messages, json, maxTokens, signal, temp, timeout }) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (p.type === 'ollama') return await ollamaChat(p, rc, { system, messages, json, maxTokens, signal, temp, timeout });
      if (p.type === 'anthropic') return await anthropicChat(p, rc, { system, messages, maxTokens, signal, temp, timeout });
      if (p.type === 'gemini') return await geminiChat(p, rc, { system, messages, json, maxTokens, signal, temp, timeout });
      return await openaiChat(p, rc, { system, messages, json, maxTokens, signal, temp, timeout });
    } catch (e) {
      lastErr = e;
      if (signal?.aborted || e.message === 'ABORTED') throw new Error('ABORTED');
      const retryable = /timed out|ECONNRESET|socket|429|500|502|503|504|overloaded|rate/i.test(e.message);
      if (!retryable || attempt === 2) break;
      await sleep(1500 * (attempt + 1) * (/429|rate/.test(e.message) ? 4 : 1));
    }
  }
  throw lastErr;
}

async function ollamaChat(p, rc, o) {
  const c = modelCaps(p.id, rc.model);
  // roles that share one model use one context size, otherwise Ollama reloads the model on every switch
  const roles = store.get().roles;
  const same = Object.values(roles).filter((r) => r && r.provider === rc.provider && r.model === rc.model);
  const numCtx = Math.max(rc.numCtx || 8192, ...same.map((r) => r.numCtx || 8192));
  const body = {
    model: rc.model, stream: false, keep_alive: '30m',
    messages: [{ role: 'system', content: o.system }, ...o.messages.map((m) => ({ role: m.role, content: m.text, ...(m.images?.length ? { images: m.images } : {}) }))],
    options: { temperature: o.temp, num_ctx: numCtx, num_predict: o.maxTokens }
  };
  if (o.json) body.format = 'json';
  if (c.thinking) body.think = !!rc.think;
  let d;
  try {
    d = await http(`${p.baseUrl}/api/chat`, { method: 'POST', body, signal: o.signal, timeout: o.timeout });
  } catch (e) {
    if (/think/i.test(e.message) && 'think' in body) { delete body.think; d = await http(`${p.baseUrl}/api/chat`, { method: 'POST', body, signal: o.signal, timeout: o.timeout }); }
    else if (/not found|pull/i.test(e.message)) throw new Error(`Model "${rc.model}" is not installed in Ollama. Install it from Models.`);
    else throw e;
  }
  // some thinking models put the whole answer into "thinking" and leave "content" empty
  const text = d.message?.content || (o.json ? d.message?.thinking || '' : '');
  return { text, usage: { in: d.prompt_eval_count || 0, out: d.eval_count || 0 } };
}

async function openaiChat(p, rc, o) {
  const content = (m) => (m.images?.length
    ? [{ type: 'text', text: m.text }, ...m.images.map((b) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b}` } }))]
    : m.text);
  const reasoningModel = p.preset === 'openai' && /^(o\d|gpt-5)/i.test(rc.model);
  const body = {
    model: rc.model,
    messages: [{ role: 'system', content: o.system }, ...o.messages.map((m) => ({ role: m.role, content: content(m) }))]
  };
  if (!reasoningModel) body.temperature = o.temp;
  if (p.preset === 'openai') body.max_completion_tokens = reasoningModel ? Math.max(o.maxTokens * 4, 4000) : o.maxTokens;
  else body.max_tokens = o.maxTokens;
  if (o.json && ['openai', 'groq', 'deepseek', 'together', 'mistral', 'openrouter', 'xai', 'fireworks', 'cerebras'].includes(p.preset)) body.response_format = { type: 'json_object' };
  for (let i = 0; i < 4; i++) {
    try {
      const d = await http(`${p.baseUrl}/chat/completions`, { method: 'POST', headers: { ...authHeaders(p), ...extraHeaders(p) }, body, signal: o.signal, timeout: o.timeout });
      let text = d.choices?.[0]?.message?.content ?? '';
      if (Array.isArray(text)) text = text.map((x) => x.text || '').join('');
      return { text, usage: { in: d.usage?.prompt_tokens || 0, out: d.usage?.completion_tokens || 0 } };
    } catch (e) {
      if (e.status !== 400 && e.status !== 422) throw e;
      const m = e.message;
      if (/response_format|json/i.test(m) && body.response_format) { delete body.response_format; continue; }
      if (/temperature/i.test(m) && 'temperature' in body) { delete body.temperature; continue; }
      if (/max_tokens/i.test(m) && body.max_tokens) { body.max_completion_tokens = body.max_tokens; delete body.max_tokens; continue; }
      if (/image|vision|multimodal/i.test(m)) throw new Error(`Model "${rc.model}" does not accept images. Turn off "vision" for it in Models, or pick a vision model.`);
      throw e;
    }
  }
  throw new Error('The provider rejected the request.');
}

async function anthropicChat(p, rc, o) {
  const body = {
    model: rc.model, system: o.system, max_tokens: o.maxTokens, temperature: o.temp,
    messages: o.messages.map((m) => ({
      role: m.role,
      content: [...(m.images || []).map((b) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b } })), { type: 'text', text: m.text }]
    }))
  };
  const headers = { 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01' };
  let d;
  try {
    d = await http(`${p.baseUrl}/messages`, { method: 'POST', headers, body, signal: o.signal, timeout: o.timeout });
  } catch (e) {
    if (e.status === 400 && /temperature/i.test(e.message)) { delete body.temperature; d = await http(`${p.baseUrl}/messages`, { method: 'POST', headers, body, signal: o.signal, timeout: o.timeout }); }
    else throw e;
  }
  const text = (d.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  return { text, usage: { in: d.usage?.input_tokens || 0, out: d.usage?.output_tokens || 0 } };
}

async function geminiChat(p, rc, o) {
  const body = {
    systemInstruction: { parts: [{ text: o.system }] },
    contents: o.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text }, ...(m.images || []).map((b) => ({ inline_data: { mime_type: 'image/jpeg', data: b } }))]
    })),
    generationConfig: { temperature: o.temp, maxOutputTokens: o.maxTokens, ...(o.json ? { responseMimeType: 'application/json' } : {}) }
  };
  const d = await http(`${p.baseUrl}/models/${encodeURIComponent(rc.model)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': p.apiKey }, body, signal: o.signal, timeout: o.timeout });
  const parts = d.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((x) => !x.thought).map((x) => x.text || '').join('');
  if (!text && d.promptFeedback?.blockReason) throw new Error(`Gemini blocked the request: ${d.promptFeedback.blockReason}`);
  return { text, usage: { in: d.usageMetadata?.promptTokenCount || 0, out: d.usageMetadata?.candidatesTokenCount || 0 } };
}

/* ---------------- ollama management ---------------- */
async function ollamaStatus(baseUrl = 'http://127.0.0.1:11434') {
  try {
    const v = await http(`${baseUrl}/api/version`, { timeout: 3000 });
    return { running: true, version: v.version };
  } catch (_) { return { running: false }; }
}
async function ollamaPull(baseUrl, model, onProgress, signal) {
  const res = await fetch(`${baseUrl}/api/pull`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: true }), signal });
  if (!res.ok || !res.body) throw new Error(`Pull failed: ${res.status} ${await res.text().catch(() => '')}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let j;
      try { j = JSON.parse(line); } catch (_) { continue; }
      if (j.error) throw new Error(j.error);
      onProgress({ status: j.status, total: j.total, completed: j.completed });
    }
  }
  onProgress({ status: 'success' });
}
async function ollamaDelete(baseUrl, model) {
  await http(`${baseUrl}/api/delete`, { method: 'DELETE', body: { model }, timeout: 20000 });
}

/* ---------------- speech to text (OpenAI-compatible) ---------------- */
async function transcribe(pid, model, file, { language, signal } = {}) {
  const p = store.provider(pid);
  if (!p) throw new Error('Transcription provider not found. Pick one in Models > Speech to text.');
  if (p.type !== 'openai') throw new Error(`${p.name} has no speech-to-text endpoint here. Use OpenAI, Groq or a local OpenAI-compatible server.`);
  const buf = require('fs').readFileSync(file);
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'audio/wav' }), 'audio.wav');
  fd.append('model', model || 'whisper-1');
  fd.append('response_format', 'verbose_json');
  if (language && language !== 'auto') fd.append('language', language);
  const ts = timeoutSignal(signal, 600000);
  let res;
  try { res = await fetch(`${p.baseUrl}/audio/transcriptions`, { method: 'POST', headers: { ...authHeaders(p), ...extraHeaders(p) }, body: fd, signal: ts.signal }); }
  catch (e) { ts.done(); if (signal?.aborted) throw new Error('ABORTED'); throw new Error(`Transcription request failed: ${e.message}`); }
  const text = await res.text();
  ts.done();
  let d = null;
  try { d = JSON.parse(text); } catch (_) { /* plain */ }
  if (!res.ok) throw new Error(`Transcription ${res.status}: ${d?.error?.message || text.slice(0, 200)}`);
  if (!d) return { text: text.trim(), language: null };
  // response_format verbose_json is not supported everywhere; plain json has only text
  return { text: String(d.text || '').trim(), language: d.language || null, segments: d.segments || [] };
}

async function testProvider(pid) {
  const list = await listModels(pid);
  return { ok: true, count: list.length };
}

module.exports = { resolveRole, roleCanSee, transcribe, PRESETS, listModels, ensureCaps, modelCaps, chat, ollamaStatus, ollamaPull, ollamaDelete, testProvider, guessVision };
