// Account health for the Accounts page, the Home page and the daily summary.
// Uses accounts.healthCheck(id) when the posting module provides it, otherwise a plain sign-in check.
const store = require('../store');
const jobs = require('../posting/jobs');
const accounts = require('../posting/accounts');
const browser = require('../posting/browser');

const saved = () => store.collection('account-health', {});
const isAi = (a) => browser.PLATFORMS[a.kind]?.group === 'ai';

// the newest finished post of an account and whether a newer attempt failed
function lastPostInfo(accountId, hist) {
  const pre = `acct:${accountId}:`;
  const mine = hist.filter((x) => String(x.targetKey || '').startsWith(pre));
  const lastDone = mine.find((x) => x.status === 'done') || null;
  const lastBad = mine.find((x) => ['failed', 'needs_user'].includes(x.status)) || null;
  return { lastDone, lastBad };
}

function all() {
  const hist = jobs.history();
  const checks = saved().all() || {};
  return accounts.list().filter((a) => !isAi(a)).map((a) => {
    const { lastDone, lastBad } = lastPostInfo(a.id, hist);
    const chk = checks[a.id] || null;
    const verified = lastDone ? (lastDone.verified === true ? 'yes' : lastDone.verified === false ? 'no' : 'unknown') : 'none';
    const problems = [];
    if (!a.loggedIn) problems.push('not signed in');
    if (chk && chk.ok === false) problems.push(chk.reason || 'the last health check failed');
    if (verified === 'no') problems.push('the last post could not be found on Buffer');
    if (lastBad && (!lastDone || lastBad.at > lastDone.at)) problems.push(`the last attempt failed${lastBad.error ? `: ${String(lastBad.error).slice(0, 100)}` : ''}`);
    return {
      id: a.id, name: a.name, kind: a.kind, signedIn: !!a.loggedIn, signedInAt: a.lastCheck || 0,
      lastPostAt: lastDone ? lastDone.at : 0, verified,
      check: chk ? { ok: chk.ok !== false, at: chk.at, text: chk.text || '' } : null,
      ok: problems.length === 0, problems
    };
  });
}

// accounts that need a look but are not simply "not signed in" (that has its own line on Home)
function broken() {
  return all().filter((x) => !x.ok).map((x) => ({ id: x.id, name: x.name, reason: x.problems[0], signedIn: x.signedIn }));
}

async function run(id) {
  const a = accounts.get(id);
  if (!a) throw new Error('Account not found');
  let r;
  if (typeof accounts.healthCheck === 'function') r = await accounts.healthCheck(id);
  else { const acc = await accounts.refresh(id, { channels: false }); r = { ok: !!acc.loggedIn, reason: acc.loggedIn ? '' : 'not signed in' }; }
  const x = r && typeof r === 'object' ? r : { ok: !!r };
  const ok = x.ok !== false && x.loggedIn !== false && x.healthy !== false;
  const text = String(x.reason || x.error || x.message || x.text || (ok ? 'Looks fine.' : 'The check failed.')).slice(0, 200);
  const log = saved(); const m = log.all() || {};
  m[id] = { ok, reason: ok ? '' : text, text, at: Date.now() };
  log.save(m);
  return all().find((h) => h.id === id);
}

module.exports = { all, broken, run };
