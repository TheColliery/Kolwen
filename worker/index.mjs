// Kolwen's Worker. fetch hands every request to the ASSETS binding unchanged: a request that matches no asset is answered with web/404.html exactly as before this file
// existed (run_worker_first stays off, so only unmatched paths reach this function). scheduled runs every 15 minutes (triggers.crons in wrangler.jsonc): it probes the six
// sitemap pages on kolwen.com and mails one alert when any probe fails.
// Rules kept here: a probe reads no response body; an alert carries only paths, status codes, timings and the UTC time, never a body, a header, an address or a secret;
// with ALERT_TO unset nothing is sent and the one log line holds no address; nothing here remembers an earlier alert, so the 15-minute schedule is the only limit on how
// often one goes out (the status page unit adds deduplication).
// shortcut: whether a cron or a secret reaches a preview deployment is not on the Cloudflare pages read for this file; the ALERT_TO secret is the guard until a preview setting is read.

export const PATHS = ['/', '/pricing', '/terms', '/privacy', '/refund', '/changelog'];
const ORIGIN = 'https://kolwen.com';
const TIMEOUT_MS = 10_000;
const HTML = 'text/html';

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

// The alert, from the probe results only. Each line names a path, what it answered and how long it took.
export function composeAlert(results, when) {
  const failed = results.filter(r => !r.ok);
  const lines = failed.map(r => `${r.path}: ${r.error ?? `HTTP ${r.status}`}, ${r.ms} ms${r.typeOk ? '' : ', content type not text/html'}`);
  return {
    subject: `Kolwen: ${failed.length} of ${results.length} page checks failed`,
    text: [`${failed.length} of ${results.length} page checks failed at ${when.toISOString()} (UTC).`, ...lines, '', 'Only the paths, the HTTP status or error, the timings and the content-type result above are recorded; no response body or header is included.'].join('\n'),
  };
}

// One run: probe every path, and mail one alert if any failed. Returns { sent, dark, results }.
export async function monitor(env, { fetchImpl = fetch, now = new Date() } = {}) {
  const results = await Promise.all(PATHS.map(path => probe(path, fetchImpl)));
  // one JSON line per probe: the only thing the logs carry (no body, no header, no visitor request)
  for (const r of results) console.log(JSON.stringify({ probe: r.path, status: r.status, ms: r.ms, ok: r.ok, error: r.error }));
  if (results.every(r => r.ok)) return { sent: false, results };
  if (!env.ALERT_TO) {
    console.log('alert path dark: ALERT_TO is not set, so nothing was sent');
    return { sent: false, dark: true, results };
  }
  const { subject, text } = composeAlert(results, now);
  try {
    await env.EMAIL.send({ to: env.ALERT_TO, from: env.ALERT_FROM, subject, text });
    console.log('alert sent');
    return { sent: true, results };
  } catch (e) {
    console.log(`alert send failed: ${e?.name ?? 'error'}`);
    return { sent: false, results };
  }
}

export default {
  fetch: (request, env) => env.ASSETS.fetch(request),
  scheduled: (_event, env, ctx) => ctx.waitUntil(monitor(env)),
};
