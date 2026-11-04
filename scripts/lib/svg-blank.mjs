// Blanks every inline svg element of a page's visible text, keeping its line breaks, so no later pattern reads drawing markup as text.
// The search runs forward once. An opener with no closer after it ends the search, since no later opener can have a closer either. A closer with no greater-than after it ends it too,
// since no later closer can have one either. The pattern it replaces read the rest of the text again from each such opener and each such closer.
const OPEN = /<svg\b/gi;
const CLOSE = /<\/svg\b/gi;

export function blankSvgs(text) {
  let out = '';
  let at = 0;
  OPEN.lastIndex = 0;
  for (let m; (m = OPEN.exec(text));) {
    CLOSE.lastIndex = m.index + m[0].length;
    const c = CLOSE.exec(text);
    if (!c) break;
    const gt = text.indexOf('>', c.index + c[0].length);
    if (gt < 0) break;
    const end = gt + 1;
    out += text.slice(at, m.index) + text.slice(m.index, end).replace(/[^\n]/g, ' ');
    at = end;
    OPEN.lastIndex = end;
  }
  return at === 0 ? text : out + text.slice(at);
}
