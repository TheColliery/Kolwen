// The bounded request and the unmatched-path name that scripts/post-deploy-check.mjs and scripts/availability-log.mjs share. Node builtins only.
//
// fetchBounded is the request scripts/post-deploy-check.mjs has always made: one GET with its share of a deadline, so no request outlasts the --wait budget.
// The share arithmetic stays with the caller (it knows its origins); this file holds only the per-request ceiling and the integer-millisecond floor.
// missPath is the cache-buster for the 404 check: a path no page is served at, so no edge copy can answer it.

export const REQUEST_CEILING_MS = 15_000;

// One GET, bounded by min(what is left of the share, the ceiling), floored to an integer ms because AbortSignal.timeout rejects a fraction. Not started at all once
// no share is left. A timeout is re-thrown with its own message, which the caller's report prints; any other error is re-thrown unchanged.
export async function fetchBounded(url, until, init = {}, fetchImpl = fetch) {
  const left = until - Date.now();
  if (left <= 0) throw new Error(`this origin's share of the --wait budget was used up before this request started`);
  const ms = Math.max(1, Math.floor(Math.min(left, REQUEST_CEILING_MS)));
  try {
    return await fetchImpl(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(ms), ...init });
  } catch (e) {
    if (e?.name === 'TimeoutError') throw new Error(`no answer within ${(ms / 1000).toFixed(1)}s`);
    throw e;
  }
}

export const missPath = () => `no-such-page-${Date.now()}`;
