// The page templates (web-src/pages/*.html): a page as HTML with named slots, filled from the language catalogue (scripts/lib/i18n-catalogue.mjs) by the one zero-dependency build
// (scripts/legal-pages.mjs). The template holds the STRUCTURE; every visible string is a slot, and a template that holds one is a build failure (build-qc.md C-I18N-16, C-I18N-17, C-FMT-02).
//
// SLOTS (the only syntax; a slot is on one line and holds no space):
//   {{home.hero.title}}     the value of a catalogue key, as HTML text (its markup becomes tags)
//   {{=home.title}}         the value as an attribute value: plain text, escaped, no markup allowed
//   {{j:home.ld.text}}      the value as the inside of a JSON string (structured data), no markup allowed
//   Each kind has its one place, and the lint refuses the others: {{key}} in a text node; {{=key}} in an attribute value; {{j:key}} in a JSON string of an application/ld+json block, and nowhere else (a JSON
//   string ends an attribute at its first quote, and an attribute escape writes entities into JSON that no script decodes); {{block:}} and {{raw:}} as whole lines of markup.
//   {{block:site-header}}   a shared block of legal-render.mjs, between its markers (SYNC_BLOCKS)
//   {{raw:style}}           a named piece of code the build owns (the shared stylesheet of the pricing page)
//   {{lang th}} ... {{/lang}}  two directive lines (each alone on its line, the whole line is removed): the slots between them are read from that language's catalogue. Outside a region the
//                           default language (en) applies, which is the head of the page today (the page is one URL with both documents inside it).
//
// WHAT IT CHECKS (templateProblems), on the template with each slot masked and the rest read by the site's one HTML scan (html-tokens.mjs):
//   - no visible literal: a text node (the title and an SVG title included); an attribute a visitor sees or hears (`title` `alt` `placeholder`, `aria-label` `aria-description` `aria-roledescription`
//     `aria-valuetext` `aria-placeholder`, the `value` of a button input or a text field (every input but hidden, checkbox, radio, range, color, file and image, whose value is data), the `label` of an option,
//     optgroup or track); the content of a description, an application-name or a social meta; a CSS `content`
//     string in a <style> block or a style attribute; or a string of the structured data that is not a slot (a URL, an email address and the JSON-LD keywords @context @type @id @vocab @base @language
//     are data, not words; an @value or @comment is a word);
//   - no script: a template holds no executable <script> element, no inline event handler and no javascript: URL (href, src, action, formaction, xlink:href, and the data of an object; the value is read as a browser reads it, with its character references decoded and its tabs, line breaks and leading spaces dropped), no srcdoc, no meta refresh to a javascript: URL and no data: document in an iframe, frame, embed or object, so nothing a script writes into the page can
//     be a string outside the catalogue; the page script comes in whole as {{raw:script}};
//   - each slot in its place (above), and no slot in an attribute name, a <style> block or a data block that is not structured data; an attribute slot is refused in a text node and in a `style`
//     attribute, a slot of any kind is refused between the strings of structured data, and a block or raw slot stands alone on its line (the one other form: the whole body of a <style> element);
//   - no join: two slots in one text node or one attribute, or a slot beside literal text, are joined fragments (a language that orders its words otherwise cannot be translated);
//   - the slot syntax is exact, the language regions are balanced and each language is a valid BCP 47 tag.
// And usageProblems reads the templates against the catalogue: a slot whose key is missing in a language, a page that reads another page's group, a slot that would show an empty value, and a
// key that nothing reads (a dead string is a lie about what the page says).
// Limits, stated: the lint reads the template, not the shared blocks of legal-render.mjs (their strings come from the catalogue through t() and a test marks every value to prove it); it reads no custom
// attribute (a data-* attribute is data the shared page script reads, `data-lang-set`, and is no text a visitor sees); it does not read the text a script writes into the page at run time, which is why a
// template holds no script; it reads a javascript: URL written in the template, not one a catalogue value would make through an {{=key}} slot in an href (the site's CSP, with no 'unsafe-inline', blocks it
// at run time, and no catalogue value holds a URL); it reads no other attribute as an address (poster, background, ping, cite, longdesc, manifest, codebase), no blob: or filesystem: URL, and not a <base href> that changes how a relative address resolves; a reference that is decoded twice by a layer outside the HTML (a script that unescapes an attribute) is outside it; it reads `<td abbr>` (assistive only) and the text of a comment as nothing; and the text of an <svg> or <math> element is read as any other text.
import { commentEnd, htmlTokens } from './html-tokens.mjs';
import { cssContentOf, decodeAttribute } from './rendered-text.mjs';
import { bcp47Problem, DEFAULT_LANG, valueHtml, valuePlain, valueJson, escAttr } from './i18n-catalogue.mjs';

const KEY = '[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)*';
const NAME = '[a-z][a-z0-9:-]*';
const SLOT = new RegExp(`\\{\\{(?:(=|j:)(${KEY})|(block:|raw:)(${NAME})|(${KEY}))\\}\\}`, 'g');
const LANG_OPEN = /^\{\{lang ([^\s{}]+)\}\}$/;
const LANG_CLOSE = /^\{\{\/lang\}\}$/;
// A block or raw slot is whole markup or code the build owns: its line holds that slot and nothing else, or the slot is the whole body of a <style> element (the pricing page's `<style>{{raw:style}}</style>`).
const WHOLE_LINE = new RegExp(`^\\s*(?:\\{\\{(?:block:|raw:)${NAME}\\}\\}|<style>\\{\\{(?:block:|raw:)${NAME}\\}\\}</style>)\\s*$`);
// Private-use characters stand in for a masked slot while the template is read as HTML (built from code points: the source holds no invisible text).
// One mask per slot kind, so the lint can tell where each kind stands (a JSON string is escaped for JSON, not for an attribute or a text node).
const TEXT_MASK = String.fromCharCode(0xe001), ATTR_MASK = String.fromCharCode(0xe002), CODE_MASK = String.fromCharCode(0xe003), JSON_MASK = String.fromCharCode(0xe004);
const MASKS = new RegExp('[' + TEXT_MASK + '-' + JSON_MASK + ']', 'g');
const HAS_MASK = new RegExp('[' + TEXT_MASK + '-' + JSON_MASK + ']');
const TAG_NAME_SLOT = new RegExp('</?[^\\t\\n\\f\\r />]*[' + TEXT_MASK + '-' + JSON_MASK + ']');
const HAS_VALUE_MASK = new RegExp('[' + TEXT_MASK + ATTR_MASK + JSON_MASK + ']'); // a slot that writes a catalogue value (a block or raw slot writes code the build owns)
// The attributes whose value a visitor sees or hears: the accessible name and description, the tooltip, the alternative text, the placeholder, the role description and the value text of a widget.
const VISIBLE_ATTRS = ['aria-label', 'aria-description', 'aria-roledescription', 'aria-valuetext', 'aria-placeholder', 'title', 'alt', 'placeholder'];
const META_TEXT = new Set(['description', 'application-name', 'apple-mobile-web-app-title', 'og:title', 'og:description', 'og:site_name', 'og:image:alt', 'twitter:title', 'twitter:description', 'twitter:image:alt']);
const BUTTON_INPUTS = /^(?:button|submit|reset)$/i; // an <input> of these types shows its `value` as the button's label
// Every other <input> shows its `value` too (a text field, an email field, a type no browser knows reads as text), except these, whose value is submitted data or unused and is drawn nowhere.
const DATA_INPUTS = /^(?:hidden|checkbox|radio|range|color|file|image)$/i;
const JS_URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'data']); // data: the address an <object> loads
// A URL parser drops leading control characters and spaces and every tab and line break before it reads the scheme; the value it reads has had its character references decoded (decodeAttribute).
const urlText = v => v.replace(/[\t\n\r]/g, '').replace(/^[\x00-\x20]+/, '');
const isJsUrl = v => /^javascript:/i.test(urlText(v));
const isDataUrl = v => /^data:/i.test(urlText(v));
// An element that draws a whole document from its address: a data: URL there is a page of its own, markup and script the lint does not read.
const DOCUMENT_URL_ATTR = { iframe: 'src', frame: 'src', embed: 'src', object: 'data' };
// The address of a <meta http-equiv=refresh> (WHATWG HTML, shared declarative refresh steps): a time, then `;` or `,` or a space, then optionally `url=` and the address, which may be quoted.
const refreshUrl = content => {
  const m = /^\s*[0-9.]*\s*(?:[;,]\s*)?(?:url\s*=\s*)?(?:"([^"]*)"?|'([^']*)'?|(.*))$/is.exec(content);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
};
const scriptType = tag => (tag.attrs.get('type') ?? '').trim().toLowerCase(); // a MIME type is case-insensitive and the attribute is read without its surrounding spaces
const LABELLED = new Set(['option', 'optgroup', 'track']); // elements whose `label` attribute is shown
const ENDORSED_KEYS = new Set(['@context', '@type', '@id', '@vocab', '@base', '@language']); // JSON-LD keys whose value is data, not words (`@value` and `@comment` are words)

const kindOf = m => (m[1] === '=' ? 'attr' : m[1] === 'j:' ? 'json' : m[3] === 'block:' ? 'block' : m[3] === 'raw:' ? 'raw' : 'text');

// Every slot and directive of a template, in order: { kind: 'text' | 'attr' | 'json' | 'block' | 'raw', key | name, line, region } | { kind: 'lang', lang, line } | { kind: 'endlang', line }.
// `region` is the language of the enclosing {{lang}} region, or null.
export function slotsOf(src) {
  const out = [];
  let region = null;
  src.split('\n').forEach((line, i) => {
    const open = LANG_OPEN.exec(line);
    if (open) { out.push({ kind: 'lang', lang: open[1], line: i + 1 }); region = open[1]; return; }
    if (LANG_CLOSE.test(line)) { out.push({ kind: 'endlang', line: i + 1 }); region = null; return; }
    for (const m of line.matchAll(SLOT)) {
      const kind = kindOf(m);
      out.push(kind === 'block' || kind === 'raw' ? { kind, name: m[4], line: i + 1, region } : { kind, key: m[2] ?? m[5], line: i + 1, region });
    }
  });
  return out;
}

// The template with directive lines removed and every slot masked, ready for the HTML scan.
function masked(src) {
  const keep = [];
  for (const line of src.split('\n')) if (!LANG_OPEN.test(line) && !LANG_CLOSE.test(line)) keep.push(line);
  return keep.join('\n').replace(SLOT, (...a) => { const m = [a[0], ...a.slice(1, 6)]; const k = kindOf(m); return k === 'text' ? TEXT_MASK : k === 'attr' ? ATTR_MASK : k === 'json' ? JSON_MASK : CODE_MASK; });
}

// The comments of a template text removed so that no comment opener survives: the quoted attribute values are masked first, then each comment
// is cut by an index scan and the scan starts again on what is left (a cut can join two halves into a new opener); an unclosed one cuts to the end.
export function withoutComments(text) {
  let t = text.replace(/=\s*("[^"]*"|'[^']*')/g, '=""');
  for (;;) {
    const open = t.indexOf('<!--');
    if (open < 0) return t;
    t = t.slice(0, open) + t.slice(commentEnd(t, open));
  }
}

export function templateProblems(src, name = 'template') {
  const out = [];
  const at = `template ${name}`;
  // directives
  let open = null;
  src.split('\n').forEach((line, i) => {
    const o = LANG_OPEN.exec(line);
    if (o) {
      const why = bcp47Problem(o[1]);
      if (why) out.push(`${at} line ${i + 1}: the region language ${o[1]} ${why}`);
      if (open !== null) out.push(`${at} line ${i + 1}: a {{lang}} region opens inside the one opened on line ${open}`);
      open = i + 1;
    } else if (LANG_CLOSE.test(line)) {
      if (open === null) out.push(`${at} line ${i + 1}: {{/lang}} closes no region`);
      open = null;
    } else if (/^\s*\{\{\/?lang/.test(line)) out.push(`${at} line ${i + 1}: a {{lang}} directive must stand alone on its line as {{lang <bcp47>}} or {{/lang}}`);
  });
  if (open !== null) out.push(`${at}: the {{lang}} region opened on line ${open} never closes`);
  // a slot in a tag name (an open or a close tag): the element name is code the build owns, never a catalogue value
  // a slot in a tag name is read as HTML reads a name: no HTML whitespace or / or > ends it, and a comment or a quoted attribute value is no tag, so it is not read
  if (TAG_NAME_SLOT.test(withoutComments(masked(src)))) out.push(`${at}: a tag name holds a slot; a slot fills a text node or an attribute value, never the name of an element`);
  // slot syntax: whatever braces remain once the valid slots and directives are taken out
  src.split('\n').forEach((line, i) => {
    if (LANG_OPEN.test(line) || LANG_CLOSE.test(line)) return;
    const rest = line.replace(SLOT, '');
    if ([...line.matchAll(SLOT)].some(m => m[3]) && !WHOLE_LINE.test(line)) out.push(`${at} line ${i + 1}: a {{block:}} or {{raw:}} slot must stand alone on its line (it is whole markup or code the build owns, and is not written into a paragraph or beside other markup or slots)`);
    if (/\{\{/.test(rest)) out.push(`${at} line ${i + 1}: a slot that is not {{key}}, {{=key}}, {{j:key}}, {{block:name}} or {{raw:name}} (a key is lowercase dot-path, a slot holds no space and no expression)`);
  });
  // literals and joins
  let tokens;
  // `scripting: false`: a visitor without script reads a <noscript> body as markup, so its text, attributes and styles are visible strings too. With the default (scripting on) the body is one raw token the lint never walks.
  try { tokens = htmlTokens(masked(src), { scripting: false }); } catch (e) { return [...out, `${at}: the HTML could not be read (${e.message.slice(0, 160)})`]; }
  let tag = null, rcdata = null; // rcdata: the title or textarea element that is open, whose body is text a page draws (markup written there is shown, not built)
  const attrProblems = (what, value, kind = 'attribute') => {
    const rest = value.replace(MASKS, '').trim();
    const n = (value.match(MASKS) || []).length;
    if (rest !== '') out.push(`${at}: ${kind} ${what} holds the literal ${JSON.stringify(rest)}; a visible string is a catalogue slot`);
    else if (n >= 2) out.push(`${at}: ${kind} ${what} joins ${n} catalogue keys in one attribute; each catalogue string is a whole sentence`);
  };
  // Text drawn by CSS (a `content` string) is a visible string that no slot can reach, so a template carries none.
  const cssProblems = (where, css) => {
    const shown = cssContentOf(`<style>${css}</style>`).replace(MASKS, '').trim();
    if (shown !== '') out.push(`${at}: a CSS content string ${JSON.stringify(shown.slice(0, 60))} in ${where} is text a visitor sees; a visible string is a catalogue slot`);
  };
  for (const t of tokens) {
    if (t.type === 'tag' && t.closing && (t.name === 'title' || t.name === 'textarea')) rcdata = null;
    if (t.type === 'tag' && !t.closing) {
      tag = t;
      rcdata = t.name === 'title' || t.name === 'textarea' ? t.name : null;
      for (const a of VISIBLE_ATTRS) if (t.attrs.has(a) && t.attrs.get(a) !== '') attrProblems(a, t.attrs.get(a));
      if (t.name === 'input' && (t.attrs.get('value') ?? '') !== '') {
        const type = t.attrs.get('type') ?? '';
        if (BUTTON_INPUTS.test(type)) attrProblems('value of the button input', t.attrs.get('value'));
        else if (!DATA_INPUTS.test(type)) attrProblems('value of the text field', t.attrs.get('value'));
      }
      // Each slot kind stands in its own place: a text slot or a JSON slot in an attribute (a JSON string ends the attribute at its first quote), a slot in an attribute NAME, and a javascript: URL.
      for (const [k, v] of t.attrs) {
        if (HAS_MASK.test(k)) out.push(`${at}: the ${t.name} element has an attribute name that holds a slot; a slot fills a value`);
        if (v.includes(JSON_MASK)) out.push(`${at}: attribute ${k} reads a {{j:key}} slot; an attribute reads {{=key}}`);
        else if (v.includes(TEXT_MASK)) out.push(`${at}: attribute ${k} reads a text slot; an attribute reads {{=key}}`);
        else if (k === 'style' && v.includes(ATTR_MASK)) out.push(`${at}: attribute style holds an attribute slot; a catalogue value is not written into inline CSS: remove the slot, or put the CSS the build owns in a <style> block as a {{block:}} or {{raw:}} slot`);
        // a block or raw slot is structure, never the text of an attribute: a line of its own inside a quoted value (even across lines) is still inside the attribute
        if (v.includes(CODE_MASK)) out.push(`${at}: attribute ${k} holds a block or raw slot; it is whole markup or code the build owns, and stands alone on its own line outside any tag`);
        // an address is read as a browser reads it: its character references decoded first. An unknown reference is a typo that hides what the address is, so it is a finding, not a guess.
        const decoded = (k) => { try { return decodeAttribute(t.attrs.get(k)); } catch { out.push(`${at}: attribute ${k} holds a character reference the check cannot read; write the character itself`); return null; } };
        if (JS_URL_ATTRS.has(k)) {
          const url = decoded(k);
          if (url !== null && isJsUrl(url)) out.push(`${at}: attribute ${k} is a javascript: URL; a template holds no script`);
          else if (url !== null && DOCUMENT_URL_ATTR[t.name] === k && isDataUrl(url)) out.push(`${at}: attribute ${k} is a data: URL on the ${t.name} element; it draws a document of its own, which the lint does not read`);
        }
      }
      if (t.attrs.has('srcdoc')) out.push(`${at}: the ${t.name} element has a srcdoc attribute; it holds a whole document the lint does not read, and a template holds no script`);
      // http-equiv is read as a browser reads it too (`refre&#115;h` is refresh), and as the spec matches it: ASCII case-insensitively, with no trimming.
      let equiv = '';
      if (t.name === 'meta' && t.attrs.has('http-equiv')) {
        try { equiv = decodeAttribute(t.attrs.get('http-equiv')); } catch { out.push(`${at}: attribute http-equiv holds a character reference the check cannot read; write the character itself`); }
      }
      if (/^refresh$/i.test(equiv) && t.attrs.has('content')) {
        let address = null;
        try { address = refreshUrl(decodeAttribute(t.attrs.get('content'))); } catch { out.push(`${at}: attribute content holds a character reference the check cannot read; write the character itself`); }
        if (address !== null && isJsUrl(address)) out.push(`${at}: the meta refresh goes to a javascript: URL; a template holds no script`);
      }
      if (LABELLED.has(t.name) && (t.attrs.get('label') ?? '') !== '') attrProblems(`label of the ${t.name}`, t.attrs.get('label'));
      const meta = t.name === 'meta' ? (t.attrs.get('name') ?? t.attrs.get('property') ?? '') : '';
      if (META_TEXT.has(meta) && t.attrs.has('content')) attrProblems(`content of the meta ${meta}`, t.attrs.get('content'));
      if (t.attrs.has('style')) cssProblems('a style attribute', `a{${t.attrs.get('style')}}`);
      for (const k of t.attrs.keys()) if (/^on[a-z]+$/.test(k)) out.push(`${at}: the ${t.name} element has an inline event handler (${k}); a template holds no script`);
      // A template holds no executable script: the page script is the shared block, taken whole as {{raw:script}}, so nothing a script writes into the page can be a string outside the catalogue.
      if (t.name === 'script' && !/^(?:application\/(?:ld\+)?json|importmap|speculationrules)$/.test(scriptType(t))) out.push(`${at}: a <script> element in a template is executable script; the page script is the shared block {{raw:script}}`);
    } else if (t.type === 'raw' && t.name === 'style') {
      cssProblems('a <style> block', t.body);
      if (HAS_VALUE_MASK.test(t.body)) out.push(`${at}: a <style> block holds a catalogue slot; only structured data takes one (the value would be written into the stylesheet)`);
    } else if (t.type === 'text') {
      const rest = t.text.replace(MASKS, '').trim();
      const n = (t.text.match(new RegExp(TEXT_MASK, 'g')) || []).length;
      if (rest !== '') out.push(`${at}: literal text ${JSON.stringify(rest.slice(0, 60))} in a text node; a visible string is a catalogue slot`);
      else if (n >= 2) out.push(`${at}: a text node joins ${n} catalogue keys in one text; each catalogue string is a whole sentence`);
      if (t.text.includes(JSON_MASK)) out.push(`${at}: a text node reads a {{j:key}} slot; a text node reads {{key}}`);
      if (rcdata && t.text.includes(CODE_MASK)) out.push(`${at}: a block or raw slot inside a <${rcdata}> element; its body is text the page draws, so markup written there would be shown as text`);
      if (t.text.includes(ATTR_MASK)) out.push(`${at}: a text node reads an {{=key}} slot; a text node reads {{key}} (an attribute value is plain text, and a text slot may hold markup)`);
    } else if (t.type === 'raw' && t.name === 'script' && scriptType(tag) === 'application/ld+json') {
      let owner = '';
      for (const m of t.body.matchAll(/"((?:[^"\\]|\\.)*)"(\s*:)?/g)) {
        if (m[2]) { owner = m[1]; continue; }
        const v = m[1];
        // a JSON string takes {{j:key}} and nothing else: an attribute escape writes &quot; and &#39; into it, which no script decodes, and a text slot writes markup
        const wrong = v.includes(ATTR_MASK) ? 'an attribute' : v.includes(TEXT_MASK) ? 'a text' : v.includes(CODE_MASK) ? 'a block or raw' : null;
        if (wrong) { out.push(`${at}: structured data reads ${wrong} slot; a JSON string reads {{j:key}}`); continue; }
        const joined = (v.match(new RegExp(JSON_MASK, 'g')) || []).length;
        if (joined >= 2 && v.replace(MASKS, '').trim() === '') { out.push(`${at}: a structured data string joins ${joined} catalogue keys; each catalogue string is a whole sentence`); continue; }
        const data = v === JSON_MASK || /^(?:https?:\/\/|mailto:)\S+$/.test(v) || /^[^\s@]+@[^\s@]+$/.test(v) || ENDORSED_KEYS.has(owner);
        if (!data) out.push(`${at}: structured data value ${JSON.stringify(v.replace(MASKS, '').trim() || v)} is a literal; a visible string is a {{j:key}} slot`);
      }
      // a slot between the strings (a bare value or a bare key) writes text that is no JSON string
      if (HAS_MASK.test(t.body.replace(/"(?:[^"\\]|\\.)*"/g, ''))) out.push(`${at}: structured data holds a slot outside a JSON string; a slot goes inside the quotes`);
    } else if (t.type === 'raw' && t.name === 'script') {
      // a data block that is not structured data (importmap, speculationrules, application/json) is no place for a slot; an executable script is already refused above
      if (HAS_VALUE_MASK.test(t.body) && /^(?:application\/json|importmap|speculationrules)$/.test(scriptType(tag))) out.push(`${at}: a <script type="${scriptType(tag)}"> block holds a catalogue slot; only structured data takes one`);
    }
  }
  return out;
}

// The templates ({ group: source }) read against the catalogue ({ lang: { key: value } }) and the keys the code reads (codeKeys, a Set).
export function usageProblems({ templates, messages, codeKeys = new Set() }) {
  const out = [];
  const langs = Object.keys(messages);
  const used = new Set(codeKeys);
  for (const [group, src] of Object.entries(templates)) {
    for (const s of slotsOf(src)) {
      if (s.kind === 'lang' && !langs.includes(s.lang)) { out.push(`template ${group} line ${s.line}: the region language ${s.lang} has no catalogue (${s.lang}.json)`); continue; }
      if (!s.key) continue;
      used.add(s.key);
      if (!['shared', group].includes(s.key.split('.')[0])) out.push(`template ${group} line ${s.line}: ${s.key} is outside its own group (a page's template reads its own group and shared only)`);
      const lacking = langs.filter(l => !(s.key in messages[l]));
      if (lacking.length) out.push(`template ${group} line ${s.line}: ${s.key} is missing in ${lacking.map(l => l + '.json').join(', ')}`);
      const shown = s.region ?? DEFAULT_LANG;
      if (messages[shown]?.[s.key] === '') out.push(`template ${group} line ${s.line}: ${s.key} would show an empty string in ${shown} (an empty value belongs only where no slot shows it)`);
    }
  }
  for (const key of new Set(langs.flatMap(l => Object.keys(messages[l])))) if (!used.has(key)) out.push(`${key} is used by no template and no code (remove it, or use it)`);
  return out;
}

// The page: the template with its directive lines removed and every slot filled. blocks: { name: () => string }, raw: { name: string }.
export function renderTemplate(src, { messages, blocks, raw }) {
  const lines = [];
  let region = null;
  const msg = (key, lang) => {
    const v = messages[lang]?.[key];
    if (v === undefined) throw new Error(`the slot ${key} has no value in ${lang}.json`);
    return v;
  };
  for (const [i, line] of src.split('\n').entries()) {
    const open = LANG_OPEN.exec(line);
    if (open) { region = open[1]; continue; }
    if (LANG_CLOSE.test(line)) { region = null; continue; }
    const lang = region ?? DEFAULT_LANG;
    const text = line.replace(SLOT, (...a) => {
      const m = [a[0], ...a.slice(1, 6)];
      const kind = kindOf(m);
      if (kind === 'block') { if (!blocks[m[4]]) throw new Error(`line ${i + 1}: no block named ${m[4]}`); return blocks[m[4]](); }
      if (kind === 'raw') { if (!(m[4] in raw)) throw new Error(`line ${i + 1}: no raw piece named ${m[4]}`); return raw[m[4]]; }
      const key = m[2] ?? m[5];
      if (kind === 'text') return valueHtml(msg(key, lang));
      if (kind === 'attr') return escAttr(valuePlain(msg(key, lang)));
      return valueJson(msg(key, lang));
    });
    if (/\{\{/.test(text)) throw new Error(`line ${i + 1}: a slot that is not valid is left in the page`);
    lines.push(text);
  }
  return lines.join('\n');
}
