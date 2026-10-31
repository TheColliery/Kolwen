// The injected scripts a served page may carry, stripped before the deploy check compares it (post-deploy-check.mjs, K-16). The old pattern scanned to the end of the page from
// every `<script` opener, so a page of many openers cost a quadratic scan, and the fixed point repeated it. This is one pass over the page: the closing tag and the markers are
// found by cursors that only move forward, so the cost is linear in the page. The fixed point is bounded at MAX_PASSES: a page still changing after them is returned as it is,
// and the comparison then fails on it, which is the safe side (the strip is an improvement, not a sanitizer, as post-deploy-check.mjs says).
const MARKERS = ['/cdn-cgi/', '__CF$cv$params'];
const OPEN = '<script', CLOSE = '</script>', MAX_PASSES = 32;

// The first occurrence of `needle` at or after `start`, for callers whose `start` never decreases: -1 when there is none. A cached answer stays valid while it is not before `start`.
function cursor(t, needle) {
  let at = -2;
  return start => {
    if (at === -1) return -1;
    if (at < start) at = t.indexOf(needle, start);
    return at;
  };
}

// One pass: every element `<script` (a word boundary after it, then up to the first `>`, then a body up to the first closing tag) whose body holds a marker is removed.
export function stripInjected(t) {
  const nextGt = cursor(t, '>'), nextClose = cursor(t, CLOSE), nextMarker = MARKERS.map(m => cursor(t, m));
  let kept = '', keptFrom = 0, i = 0;
  for (;;) {
    const open = t.indexOf(OPEN, i);
    if (open < 0) break;
    i = open + 1;
    const after = t[open + OPEN.length];
    if (after !== undefined && /\w/.test(after)) continue; // `<scripts` is not an opener
    const gt = nextGt(open + OPEN.length);
    if (gt < 0) break; // no `>` after this opener, so none after any later one
    const close = nextClose(gt + 1);
    if (close < 0) break; // no closing tag after it, so none after any later one
    if (!nextMarker.some(next => { const at = next(gt + 1); return at >= 0 && at < close; })) continue;
    kept += t.slice(keptFrom, open);
    keptFrom = close + CLOSE.length;
    i = keptFrom;
  }
  return kept + t.slice(keptFrom);
}

// The fixed point of stripInjected, bounded at MAX_PASSES (each pass removes at least one element, so an unbounded loop could cost a pass per element).
export function stripEdge(t) {
  let prev, passes = 0;
  do { prev = t; t = stripInjected(t); } while (t !== prev && ++passes < MAX_PASSES);
  return t;
}
