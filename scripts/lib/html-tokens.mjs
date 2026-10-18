// The one HTML scan of the font checks (rendered-text.mjs) and the budget check (page-weight.mjs): the page walked the way the WHATWG tokenizer walks it, at the level these checks need.
//   data state      text, and `<` starting a tag, an end tag, a comment, or a bogus comment (`<!doctype>`, `<?x>`, `</ >`); a `<` that starts none of them is text.
//   comment         `<!--` opens one only in the data state; it ends at `-->`, at `--!>`, at once for `<!-->` and `<!--->`, or at the end of the input.
//   start tag       its attributes are read by the tokenizer's own states (see scanTag): a quote opens a value only in the before-attribute-value state, that is after an attribute name and its `=`; the first
//                   of a repeated name wins. A `>` inside a quoted value does not end the tag, and a tag never ended before the end of the input is dropped, as the tokenizer drops it.
//   whitespace      exactly tab, line feed, form feed, carriage return and space (WHATWG "ASCII whitespace"); a no-break space or any other Unicode space is an ordinary character.
//   raw text        the body of `<script>` and `<style>` is text for nobody: nothing in it is a tag or a comment, and only its own end tag ends it. So is the body of `<noscript>` when scripting is on.
//   RCDATA          the body of `<textarea>` and `<title>` is text the page can draw (its character references work), and nothing in it is a tag or a comment.
// SCRIPTING. A browser with scripting on (the visitors the transfer-size budget counts) reads `<noscript>` as raw text, and draws and loads nothing of it. A visitor without script reads it as ordinary markup and
// draws it. `{ scripting: true }` (the default) is the first reading, `{ scripting: false }` the second; a check about what the page DRAWS to anyone (the font coverage) uses the second, a check about what a
// visitor LOADS (the budget) the first.
// Known limits: the other raw-text elements (`xmp`, `iframe`, `noembed`, `noframes`) are read as ordinary markup, and the double-escaped state of a script (`<!--<script>` inside a script) is not modelled.
// Neither occurs in this site. Zero dependencies.

const RAW = new Set(['script', 'style']);
const RCDATA = new Set(['textarea', 'title']);
const END_OF = Object.fromEntries([...RAW, ...RCDATA, 'noscript'].map(name => [name, new RegExp('</' + name + '(?=[\\t\\n\\f\\r />])', 'gi')]));
const START_NAME = /<([a-z][^\t\n\f\r />]*)/iy;
const END_NAME = /<\/([a-z][^\t\n\f\r />]*)/iy;
const WS = c => c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';

// The attributes of a start tag and the index of the `>` that ends it, read by the tokenizer's states from `from` (just after the tag name): { end, attrs }, with end -1 when the tag never closes
// (the end of the input, or a quoted value with no closing quote, which a browser reads to the end of the page). attrs is a Map of lower-case name -> value ('' when there is none).
//   before attribute name   whitespace and `/` are skipped; a `>` ends the tag; any other character, an `=` too, is the first character of a name (unexpected-equals-sign-before-attribute-name).
//   attribute name          runs to whitespace, `/`, `>` or `=`.
//   after attribute name    whitespace is skipped; `=` goes on to the value; anything else starts the next attribute.
//   before attribute value  whitespace is skipped; a quote starts a value to the same quote; a `>` is a missing value and ends the tag; anything else starts an unquoted value, which runs to whitespace or `>`
//                           and holds quotes and `=` as ordinary characters. After a quoted value the next character is read again as the start of an attribute, so `="` there begins a new NAME.
function scanTag(html, from) {
  const n = html.length;
  const attrs = new Map();
  let i = from;
  for (;;) {
    while (i < n && (WS(html[i]) || html[i] === '/')) i++;
    if (i >= n) return { end: -1, attrs };
    if (html[i] === '>') return { end: i, attrs };
    const nameFrom = i++; // the first character of a name is a name character, whatever it is
    while (i < n && !WS(html[i]) && html[i] !== '/' && html[i] !== '>' && html[i] !== '=') i++;
    const name = html.slice(nameFrom, i).toLowerCase();
    while (i < n && WS(html[i])) i++;
    if (i >= n) return { end: -1, attrs };
    let value = '';
    if (html[i] === '=') {
      i++;
      while (i < n && WS(html[i])) i++;
      if (i >= n) return { end: -1, attrs };
      const q = html[i];
      if (q === '"' || q === "'") {
        const close = html.indexOf(q, i + 1);
        if (close < 0) return { end: -1, attrs };
        value = html.slice(i + 1, close);
        i = close + 1;
      } else if (q !== '>') {
        const valueFrom = i;
        while (i < n && !WS(html[i]) && html[i] !== '>') i++;
        value = html.slice(valueFrom, i);
      }
    }
    if (!attrs.has(name)) attrs.set(name, value);
  }
}

// The attributes of a start tag's text, as a Map of lower-case name -> value (an attribute with no value is the empty string).
export const attrsOf = text => scanTag(text + '>', 0).attrs;

// Where the comment that opens at `at` (`<!--`) ends: the index after its last character.
function commentEnd(html, at) {
  const from = at + 4;
  if (html[from] === '>') return from + 1;
  if (html[from] === '-' && html[from + 1] === '>') return from + 2;
  const close = /--!?>/g;
  close.lastIndex = from;
  const m = close.exec(html);
  return m ? m.index + m[0].length : html.length;
}

// The tokens of an HTML text, in order: { type: 'text', text } (RCDATA bodies included), { type: 'tag', name, attrs } for a start tag, { type: 'tag', name, closing: true } for an end tag,
// { type: 'raw', name, body } for the body of a script, a style or (scripting on) a noscript, and { type: 'comment' } (a real or a bogus one).
export function htmlTokens(html, { scripting = true } = {}) {
  const out = [];
  const raw = new Set(scripting ? [...RAW, 'noscript'] : RAW);
  let pos = 0, textFrom = 0; // `pos` is where the scan is, `textFrom` where the pending text starts
  const flush = upto => { if (upto > textFrom) out.push({ type: 'text', text: html.slice(textFrom, upto) }); };
  const emit = (token, from, to) => { flush(from); out.push(token); pos = textFrom = to; };
  // A tag that never closes. With no `>` left in the text it is cut off by the end of the input, and the tokenizer drops it. With a `>` still ahead, something other than the end of the input
  // stopped it (a quoted value never closed, which a browser reads to the end of the page, or a scanner bug): the rest of the page would silently read as nothing, so this refuses out loud.
  const neverClosed = (at, name) => {
    if (html.indexOf('>', at) >= 0) throw new Error(`html-tokens: the tag at offset ${at} (<${name} ...) is never closed although a ">" follows: a quoted attribute value has no closing quote (a browser drops the rest of the page too), or the scanner is wrong. Fix the page; the checks will not read the rest of it as empty.`);
    flush(at);
    pos = textFrom = html.length;
  };
  while (true) {
    const lt = html.indexOf('<', pos);
    if (lt < 0) break;
    const next = html[lt + 1] ?? '';
    if (html.startsWith('<!--', lt)) { emit({ type: 'comment' }, lt, commentEnd(html, lt)); continue; }
    if (next === '!' || next === '?' || (next === '/' && !/[a-z]/i.test(html[lt + 2] ?? ''))) { // a bogus comment runs to the next `>`
      const gt = html.indexOf('>', lt);
      emit({ type: 'comment' }, lt, gt < 0 ? html.length : gt + 1);
      continue;
    }
    if (next === '/') {
      END_NAME.lastIndex = lt;
      const m = END_NAME.exec(html);
      const { end } = scanTag(html, END_NAME.lastIndex);
      if (end < 0) neverClosed(lt, '/' + m[1]); else emit({ type: 'tag', name: m[1].toLowerCase(), closing: true }, lt, end + 1);
      continue;
    }
    if (/[a-z]/i.test(next)) {
      START_NAME.lastIndex = lt;
      const m = START_NAME.exec(html);
      const { end, attrs } = scanTag(html, START_NAME.lastIndex);
      if (end < 0) { neverClosed(lt, m[1]); continue; }
      const name = m[1].toLowerCase();
      emit({ type: 'tag', name, attrs }, lt, end + 1);
      if (raw.has(name) || RCDATA.has(name)) {
        const endTag = END_OF[name];
        endTag.lastIndex = pos;
        const close = endTag.exec(html);
        const stop = close ? close.index : html.length;
        if (raw.has(name) && stop > pos) emit({ type: 'raw', name, body: html.slice(pos, stop) }, pos, stop);
        else pos = stop; // an RCDATA body stays in the pending text; the scan resumes at its end tag
      }
      continue;
    }
    pos = lt + 1; // a `<` that starts nothing is text
  }
  flush(html.length);
  return out;
}
