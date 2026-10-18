// The one HTML scan of the font checks (rendered-text.mjs) and the budget check (page-weight.mjs): the page walked the way the WHATWG tokenizer walks it, at the level these checks need.
//   data state      text, and `<` starting a tag, an end tag, a comment, or a bogus comment (`<!doctype>`, `<?x>`, `</ >`); a `<` that starts none of them is text.
//   comment         `<!--` opens one only in the data state; it ends at `-->`, at `--!>`, at once for `<!-->` and `<!--->`, or at the end of the input.
//   start tag       its attributes are read in order (a whole name; a value double-quoted, single-quoted or unquoted; the first of a repeated name wins). A `>` inside a quoted value does not end the tag, and a
//                   tag never ended before the end of the input is dropped, as the tokenizer drops it.
//   raw text        the body of `<script>` and `<style>` is text for nobody: nothing in it is a tag or a comment, and only its own end tag ends it.
//   RCDATA          the body of `<textarea>` and `<title>` is text the page can draw (its character references work), and nothing in it is a tag or a comment.
// Known limits: the other raw-text elements (`xmp`, `iframe`, `noembed`, `noframes`, `noscript` with scripting) are read as ordinary markup, and the double-escaped state of a script (`<!--<script>` inside a
// script) is not modelled. Neither occurs in this site. Zero dependencies.

const RAW = new Set(['script', 'style']);
const RCDATA = new Set(['textarea', 'title']);
const END_OF = Object.fromEntries([...RAW, ...RCDATA].map(name => [name, new RegExp('</' + name + '(?=[\\s/>])', 'gi')]));
const START_NAME = /<([a-z][^\s/>]*)/iy;
const END_NAME = /<\/([a-z][^\s/>]*)/iy;
const ATTR = /[\s/]*([^\s/>=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;

// The attributes of a start tag's text, as a Map of lower-case name -> value (an attribute with no value is the empty string).
export function attrsOf(text) {
  const attrs = new Map();
  for (const a of text.matchAll(ATTR)) { const name = a[1].toLowerCase(); if (!attrs.has(name)) attrs.set(name, a[2] ?? a[3] ?? a[4] ?? ''); }
  return attrs;
}

// The index of the `>` that closes the tag whose attribute text starts at `from`, or -1 when it never closes. A quote opens a value only right after `=` (and any spaces): there it runs to the
// same quote, and with no closing quote the tag is never closed (the browser reads the rest of the page as that value and drops the tag). In an unquoted value or in a name a quote is an ordinary
// character. One pass, no backtracking.
function tagEnd(html, from) {
  const n = html.length;
  for (let i = from; i < n; i++) {
    const c = html[i];
    if (c === '>') return i;
    if (c !== '=') continue;
    i++;
    while (i < n && /\s/.test(html[i])) i++;
    const q = html[i];
    if (q === '"' || q === "'") {
      const close = html.indexOf(q, i + 1);
      if (close < 0) return -1;
      i = close;
    } else {
      while (i < n && html[i] !== '>' && !/\s/.test(html[i])) i++;
      i--; // the loop's own i++ lands on the character that ended the value
    }
  }
  return -1;
}

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
// { type: 'raw', name, body } for the body of a script or a style, and { type: 'comment' } (a real or a bogus one).
export function htmlTokens(html) {
  const out = [];
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
      const gt = tagEnd(html, END_NAME.lastIndex);
      if (gt < 0) neverClosed(lt, '/' + m[1]); else emit({ type: 'tag', name: m[1].toLowerCase(), closing: true }, lt, gt + 1);
      continue;
    }
    if (/[a-z]/i.test(next)) {
      START_NAME.lastIndex = lt;
      const m = START_NAME.exec(html);
      const gt = tagEnd(html, START_NAME.lastIndex);
      if (gt < 0) { neverClosed(lt, m[1]); continue; }
      const name = m[1].toLowerCase();
      emit({ type: 'tag', name, attrs: attrsOf(html.slice(START_NAME.lastIndex, gt)) }, lt, gt + 1);
      if (RAW.has(name) || RCDATA.has(name)) {
        const end = END_OF[name];
        end.lastIndex = pos;
        const close = end.exec(html);
        const stop = close ? close.index : html.length;
        if (RAW.has(name) && stop > pos) emit({ type: 'raw', name, body: html.slice(pos, stop) }, pos, stop);
        else pos = stop; // an RCDATA body stays in the pending text; the scan resumes at its end tag
      }
      continue;
    }
    pos = lt + 1; // a `<` that starts nothing is text
  }
  flush(html.length);
  return out;
}
