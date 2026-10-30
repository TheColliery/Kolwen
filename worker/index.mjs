// Kolwen's Worker. fetch hands every request to the ASSETS binding unchanged, with three exceptions: GET /status.json answers from the stored state (binding STATUS,
// when it exists), and /subscribe answers 404 unless SUBSCRIBE is "on" (binding SUBSCRIBERS). Only unmatched paths reach this function (run_worker_first stays off).
// scheduled runs every 15 minutes (triggers.crons in wrangler.jsonc): it probes the six sitemap pages on kolwen.com, writes ONE state object to STATUS (96 a day
// against Free's 1,000 writes), and mails an alert only when the result changes: all-OK to failing, and one recovery note from failing back to all-OK.
// Rules kept here: a probe reads no response body; the state, the alert and the log lines hold only paths, status codes, timings, ok flags and the UTC time (never a body,
// a header, an IP, an address or a secret); with ALERT_TO unset nothing is sent and the log line holds no address.
// The change rule compares this run with the stored state; the 15-minute schedule bounds the rate, and a failing run that cannot write the state alerts on every run.
// shortcut: whether a cron or a secret reaches a preview deployment is not on the Cloudflare pages read for this file; the ALERT_TO secret is the guard until a preview setting is read.
// shortcut: KV is eventually consistent; the window is not on the pages read, so /status.json can lag a run by that window.

export const PATHS = ['/', '/pricing', '/terms', '/privacy', '/refund', '/changelog'];
const ORIGIN = 'https://kolwen.com';
const TIMEOUT_MS = 10_000;
const HTML = 'text/html';
const STATE_KEY = 'state';

// One probe: the path, the status, the time taken, whether the content type is text/html, and ok (200 and text/html). A timeout or a network failure is named
// by its class only, never by its message.
export async function probe(path, fetchImpl, origin = ORIGIN) {
  const started = Date.now();
  try {
    const res = await fetchImpl(origin + path, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'kolwen-monitor' } });
    try { await res.body?.cancel(); } catch { /* the body is never read */ }
    // the media type is compared before its parameters, trimmed and lowercased: RFC 9110 §8.3.1 makes it case-insensitive
    const typeOk = ((res.headers.get('content-type') ?? '').split(';')[0] || '').trim().toLowerCase() === HTML;
    return { path, status: res.status, ms: Date.now() - started, typeOk, ok: res.status === 200 && typeOk };
  } catch (e) {
    return { path, status: 0, ms: Date.now() - started, typeOk: false, ok: false, error: e?.name === 'TimeoutError' ? 'timeout' : 'network error' };
  }
}

// The state this run leaves in STATUS: the time, and per probe only its path, status, time and ok.
export function buildState(results, when) {
  return { checked: when.toISOString(), probes: results.map(({ path, status, ms, ok }) => ({ path, status, ms, ok })) };
}

// What changed since the stored state: 'failing' (all OK before, a failure now), 'recovered' (a failure before, all OK now), or null. No stored state counts as all OK.
export function transition(prev, results) {
  const wasOk = prev ? prev.probes.every(p => p.ok) : true;
  const nowOk = results.every(r => r.ok);
  if (wasOk && !nowOk) return 'failing';
  if (prev && !wasOk && nowOk) return 'recovered';
  return null;
}

// The alert, from the probe results only. Each line names a path, what it answered and how long it took.
export function composeAlert(results, when) {
  const failed = results.filter(r => !r.ok);
  const lines = failed.map(r => `${r.path}: ${r.error ?? `HTTP ${r.status}`}, ${r.ms} ms${r.typeOk ? '' : ', content type not text/html'}`);
  return {
    subject: `Kolwen: ${failed.length} of ${results.length} page checks failed`,
    text: [`${failed.length} of ${results.length} page checks failed at ${when.toISOString()} (UTC).`, ...lines, '', 'The probe details above contain only the paths, the HTTP status or error, the timings and the content-type result; no response body or response header is included.'].join('\n'),
  };
}

// The recovery note: all checks pass again. It holds the count and the UTC time, nothing else.
export function composeRecovery(results, when) {
  return {
    subject: `Kolwen: all ${results.length} page checks pass again`,
    text: `All ${results.length} page checks passed again at ${when.toISOString()} (UTC). The count and the time above are all this note holds; no response body or response header is included.`,
  };
}

async function readState(env) {
  if (!env.STATUS) return null;
  try { return JSON.parse(await env.STATUS.get(STATE_KEY)) ?? null; } catch { return null; }
}

// One run: probe every path, store the state once, and mail one alert when the result changed. Returns { sent, dark, results }.
export async function monitor(env, { fetchImpl = fetch, now = new Date() } = {}) {
  const results = await Promise.all(PATHS.map(path => probe(path, fetchImpl)));
  // one JSON line per probe: the logs carry only these (no body, no header, no visitor request)
  for (const r of results) console.log(JSON.stringify({ probe: r.path, status: r.status, ms: r.ms, ok: r.ok, error: r.error }));
  const prev = await readState(env);
  if (env.STATUS) {
    try { await env.STATUS.put(STATE_KEY, JSON.stringify(buildState(results, now))); } catch (e) { console.log(`state write failed: ${e?.name ?? 'error'}`); }
  }
  const change = transition(prev, results);
  if (!change) return { sent: false, results };
  if (!env.ALERT_TO) {
    console.log('alert path dark: ALERT_TO is not set, so nothing was sent');
    return { sent: false, dark: true, results };
  }
  const { subject, text } = change === 'failing' ? composeAlert(results, now) : composeRecovery(results, now);
  try {
    await env.EMAIL.send({ to: env.ALERT_TO, from: env.ALERT_FROM, subject, text });
    console.log('alert sent');
    return { sent: true, results };
  } catch (e) {
    console.log(`alert send failed: ${e?.name ?? 'error'}`);
    return { sent: false, results };
  }
}

// GET /status.json: the stored state, or a plain line when no check has run yet.
export async function statusResponse(env) {
  const state = (await readState(env)) ?? { checked: null, message: 'no check has run yet' };
  return new Response(JSON.stringify(state), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}

const text = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_SHAPE = /^[0-9a-f]{48}$/;

// /subscribe, switched off by default: while SUBSCRIBE is not "on" both methods answer 404 and the store is not touched. Returns null for any other path.
// A subscriber is stored under a random token as { email, verified: false, created }; no mail is sent in this build.
export async function handleSubscription(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/subscribe') return null;
  const off = env.SUBSCRIBE !== 'on' || !env.SUBSCRIBERS;
  if (off) return new Response('not found', { status: 404 });
  if (request.method === 'POST') {
    const email = String((await request.formData().catch(() => null))?.get('email') ?? '').trim();
    if (!EMAIL_SHAPE.test(email)) return text('enter an email address', 400);
    const token = [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');
    await env.SUBSCRIBERS.put(token, JSON.stringify({ email, verified: false, created: new Date().toISOString() }));
    return text('subscribed; no confirmation mail is sent in this build');
  }
  if (request.method === 'DELETE') {
    const token = url.searchParams.get('token') ?? '';
    if (!TOKEN_SHAPE.test(token)) return text('bad token', 400);
    await env.SUBSCRIBERS.delete(token);
    return text('removed');
  }
  return new Response('not found', { status: 404 });
}

export default {
  fetch: async (request, env) => {
    if (request.method === 'GET' && new URL(request.url).pathname === '/status.json') return statusResponse(env);
    return (await handleSubscription(request, env)) ?? env.ASSETS.fetch(request);
  },
  scheduled: (_event, env, ctx) => ctx.waitUntil(monitor(env)),
};
