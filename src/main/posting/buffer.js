// Buffer GraphQL API (https://api.buffer.com, Bearer API key from publish.buffer.com/settings/api).
// Buffer has no upload endpoint: images and videos are passed as public HTTPS URLs (see hosting.js).
const store = require('../store');

const ENDPOINT = process.env.PA_BUFFER_ENDPOINT && !require('electron').app?.isPackaged ? process.env.PA_BUFFER_ENDPOINT : 'https://api.buffer.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gql(query, variables = {}, { signal } = {}) {
  const key = store.secret('bufferKey');
  if (!key) throw new Error('Buffer is not connected. Open Accounts and paste your Buffer API key.');
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ query, variables }), signal });
    } catch (e) {
      if (signal?.aborted) throw new Error('ABORTED');
      if (attempt < 3) { await sleep(2000 * (attempt + 1)); continue; }
      throw new Error(`Cannot reach Buffer: ${e.message}`);
    }
    const text = await res.text();
    let j = null;
    try { j = JSON.parse(text); } catch (_) { /* not json */ }
    const code = j?.errors?.[0]?.extensions?.code;
    if (res.status === 429 || code === 'RATE_LIMIT_EXCEEDED') {
      const wait = Math.min(120, Number(res.headers.get('retry-after')) || 30);
      if (attempt < 3) { await sleep(wait * 1000); continue; }
      throw new Error(`Buffer rate limit reached (${j?.errors?.[0]?.extensions?.window || ''}). Try again later.`);
    }
    if (res.status === 401 || code === 'UNAUTHORIZED') throw new Error('Buffer rejected the API key. Create a new key in Buffer > Settings > API and paste it in Accounts.');
    if (code === 'FORBIDDEN') throw new Error(`Buffer: ${j.errors[0].message}`);
    if (j?.errors?.length && !j.data) throw new Error(`Buffer: ${j.errors.map((e) => e.message).join('; ')}`);
    if (!res.ok && !j) throw new Error(`Buffer HTTP ${res.status}: ${text.slice(0, 200)}`);
    if (res.status >= 500 && attempt < 3) { await sleep(3000 * (attempt + 1)); continue; }
    return j.data;
  }
  throw new Error('Buffer did not answer.');
}

async function organizations() {
  const d = await gql('query GetOrganizations { account { organizations { id name ownerEmail } } }');
  return (d?.account?.organizations || []).map((o) => ({ id: o.id, name: o.name }));
}
async function channels(organizationId) {
  const org = organizationId || store.get().buffer.organizationId || (await organizations())[0]?.id;
  if (!org) throw new Error('No Buffer organization found on this account.');
  // ids are inlined as string literals (the docs show them that way), so no custom scalar names are needed
  const d = await gql(`query GetChannels { channels(input: { organizationId: ${JSON.stringify(org)} }) { id name displayName service avatar isQueuePaused } }`);
  return (d?.channels || []).map((c) => ({ id: c.id, name: c.displayName || c.name, handle: c.name, service: String(c.service || '').toLowerCase(), avatar: c.avatar, paused: !!c.isQueuePaused, organizationId: org }));
}

// per-network metadata Buffer needs for a video/image post
function metadataFor(service, post) {
  const s = String(service).toLowerCase();
  const isVideo = post.kind === 'video';
  if (s.includes('youtube')) {
    return { youtube: { title: (post.title || post.text.split('\n')[0]).slice(0, 100), categoryId: String(post.youtubeCategory || '22'), privacy: post.youtubePrivacy || 'public', madeForKids: false, notifySubscribers: true, ...(post.aiGenerated != null ? { isAiGenerated: !!post.aiGenerated } : {}) } };
  }
  if (s.includes('instagram')) {
    return { instagram: { type: post.igType || (isVideo ? 'reel' : 'post'), shouldShareToFeed: true, ...(post.firstComment ? { firstComment: post.firstComment } : {}) } };
  }
  if (s.includes('facebook')) return { facebook: { type: post.fbType || (isVideo && post.vertical ? 'reel' : 'post'), ...(post.firstComment ? { firstComment: post.firstComment } : {}) } };
  if (s.includes('linkedin')) return post.firstComment ? { linkedin: { firstComment: post.firstComment } } : null;
  if (s.includes('tiktok')) return post.aiGenerated != null ? { tiktok: { isAiGenerated: !!post.aiGenerated } } : null;
  if (s.includes('pinterest') && post.title) return { pinterest: { title: post.title.slice(0, 100) } };
  return null;
}

const CREATE = `mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    ... on PostActionSuccess { post { id text dueAt } }
    ... on MutationError { message }
  }
}`;

// post: {channelId, service, text, title, kind, mediaUrl, dueAt (ISO) | null = add to queue | 'now', draft, firstComment, ...}
async function createPost(post, { signal } = {}) {
  const input = {
    channelId: post.channelId,
    text: post.text,
    schedulingType: 'automatic',
    mode: post.dueAt === 'now' ? 'shareNow' : post.dueAt ? 'customScheduled' : 'addToQueue',
    assets: []
  };
  if (post.dueAt && post.dueAt !== 'now') input.dueAt = new Date(post.dueAt).toISOString();
  if (post.draft) input.saveToDraft = true;
  if (post.mediaUrl) input.assets.push(post.kind === 'image' ? { image: { url: post.mediaUrl } } : { video: { url: post.mediaUrl, ...(post.thumbnailOffset != null ? { metadata: { thumbnailOffset: post.thumbnailOffset } } : {}) } });
  const md = metadataFor(post.service, post);
  if (md) input.metadata = md;
  let tries = 0;
  for (;;) {
    let d;
    try { d = await gql(CREATE, { input }, { signal }); }
    catch (e) {
      // schema differences across networks: drop the optional bits once and retry
      if (tries++ < 2 && /metadata|type|firstComment|isAiGenerated|notifySubscribers|Unknown field|not defined/i.test(e.message)) {
        if (input.metadata?.facebook?.type === 'reel') input.metadata.facebook.type = 'post';
        else if (input.metadata) { for (const v of Object.values(input.metadata)) { delete v.firstComment; delete v.isAiGenerated; delete v.notifySubscribers; } if (tries === 2) delete input.metadata; }
        continue;
      }
      throw e;
    }
    const r = d?.createPost;
    if (r?.post) return { id: r.post.id, dueAt: r.post.dueAt, text: r.post.text };
    const msg = r?.message || 'Buffer did not create the post.';
    if (tries++ < 2 && /facebook.*type|type.*facebook/i.test(msg) && input.metadata?.facebook) { input.metadata.facebook.type = input.metadata.facebook.type === 'reel' ? 'post' : 'reel'; continue; }
    throw new Error(`Buffer: ${msg}`);
  }
}

// the user's own sent posts, used to learn their caption style
async function sentPosts({ channelId, limit = 40 } = {}) {
  const org = store.get().buffer.organizationId || (await organizations())[0]?.id;
  const filter = `status: [sent]${channelId ? `, channelIds: [${JSON.stringify(channelId)}]` : ''}`;
  const d = await gql(`query Posts { posts(first: ${Math.min(100, Number(limit) || 40)}, input: { organizationId: ${JSON.stringify(org)}, filter: { ${filter} } }) { edges { node { id text dueAt channelId } } } }`);
  return (d?.posts?.edges || []).map((e) => e.node).filter((n) => n.text);
}

async function test() {
  const orgs = await organizations();
  return { ok: true, organizations: orgs };
}

module.exports = { gql, organizations, channels, createPost, sentPosts, metadataFor, test };
