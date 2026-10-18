// The page templates (web-src/pages/*.html): a page as HTML with named slots, filled from the language catalogue (scripts/lib/i18n-catalogue.mjs) by the one zero-dependency build
// (scripts/legal-pages.mjs). The template holds the STRUCTURE; every visible string is a slot, and a template that holds one is a build failure (build-qc.md C-I18N-16, C-I18N-17, C-FMT-02).
//
// SLOTS (the only syntax; a slot is on one line and holds no space):
//   {{home.hero.title}}     the value of a catalogue key, as HTML text (its markup becomes tags)
//   {{=home.title}}         the value as an attribute value: plain text, escaped, no markup allowed
//   {{j:home.ld.text}}      the value as the inside of a JSON string (structured data), no markup allowed
//   {{block:site-header}}   a shared block of legal-render.mjs, between its markers (SYNC_BLOCKS)
//   {{raw:style}}           a named piece of code the build owns (the shared stylesheet of the pricing page)
//   {{lang th}} ... {{/lang}}  two directive lines (each alone on its line, the whole line is removed): the slots between them are read from that language's catalogue. Outside a region the
//                           default language (en) applies, which is the head of the page today (the page is one URL with both documents inside it).
//
// WHAT IT CHECKS (templateProblems), on the template with each slot masked and the rest read by the site's one HTML scan (html-tokens.mjs):
//   - no visible literal: a text node (the title and an SVG title included); an attribute a visitor sees or hears (`title` `alt` `placeholder`, `aria-label` `aria-description` `aria-roledescription`
//     `aria-valuetext` `aria-placeholder`, the `value` of a button input, the `label` of an option, optgroup or track); the content of a description, an application-name or a social meta; a CSS `content`
//     string in a <style> block or a style attribute; or a string of the structured data that is not a slot (a URL, an email address and the JSON-LD keywords @context @type @id @vocab @base @language
//     are data, not words; an @value or @comment is a word);
//   - no script: a template holds no executable <script> element and no inline event handler, so nothing a script writes into the page can be a string outside the catalogue; the page script comes in
//     whole as {{raw:script}};
//   - no join: two slots in one text node or one attribute, or a slot beside literal text, are joined fragments (a language that orders its words otherwise cannot be translated);
//   - the slot syntax is exact, the language regions are balanced and each language is a valid BCP 47 tag.
// And usageProblems reads the templates against the catalogue: a slot whose key is missing in a language, a page that reads another page's group, a slot that would show an empty value, and a
// key that nothing reads (a dead string is a lie about what the page says).
// Limits, stated: the lint reads the template, not the shared blocks of legal-render.mjs (their strings come from the catalogue through t() and a test marks every value to prove it); it reads no custom
// attribute (a data-* attribute is data the shared page script reads, `data-lang-set`, and is no text a visitor sees); it does not read the text a script writes into the page at run time, which is why a
// template holds no script; and the text of an <svg> or <math> element is read as any other text.
import { htmlTokens } from './html-tokens.mjs';
import { cssContentOf } from './rendered-text.mjs';
import { bcp47Problem, DEFAULT_LANG, valueHtml, valuePlain, valueJson, escAttr } from './i18n-catalogue.mjs';

const KEY = '[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)*';
const NAME = '[a-z][a-z0-9:-]*';
const SLOT = new RegExp(`\\{\\{(?:(=|j:)(${KEY})|(block:|raw:)(${NAME})|(${KEY}))\\}\\}`, 'g');
const LANG_OPEN = /^\{\{lang ([^\s{}]+)\}\}$/;
const LANG_CLOSE = /^\{\{\/lang\}\}$/;
// Private-use characters stand in for a masked slot while the template is read as HTML (built from code points: the source holds no invisible text).
const TEXT_MASK = String.fromCharCode(0xe001), ATTR_MASK = String.fromCharCode(0xe002), CODE_MASK = String.fromCharCode(0xe003);
const MASKS = new RegExp('[' + TEXT_MASK + '-' + CODE_MASK + ']', 'g');
// The attributes whose value a visitor sees or hears: the accessible name and description, the tooltip, the alternative text, the placeholder, the role description and the value text of a widget.
const VISIBLE_ATTRS = ['aria-label', 'aria-description', 'aria-roledescription', 'aria-valuetext', 'aria-placeholder', 'title', 'alt', 'placeholder'];
const META_TEXT = new Set(['description', 'application-name', 'apple-mobile-web-app-title', 'og:title', 'og:description', 'og:site_name', 'og:image:alt', 'twitter:title', 'twitter:description', 'twitter:image:alt']);
const BUTTON_INPUTS = /^(?:button|submit|reset)$/i; // an <input> of these types shows its `value` as the button's label
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
  return keep.join('\n').replace(SLOT, (...a) => { const m = [a[0], ...a.slice(1, 6)]; const k = kindOf(m); return k === 'text' ? TEXT_MASK : k === 'attr' || k === 'json' ? ATTR_MASK : CODE_MASK; });
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
  // slot syntax: whatever braces remain once the valid slots and directives are taken out
  src.split('\n').forEach((line, i) => {
    if (LANG_OPEN.test(line) || LANG_CLOSE.test(line)) return;
    const rest = line.replace(SLOT, '');
    if (/\{\{/.test(rest)) out.push(`${at} line ${i + 1}: a slot that is not {{key}}, {{=key}}, {{j:key}}, {{block:name}} or {{raw:name}} (a key is lowercase dot-path, a slot holds no space and no expression)`);
  });
  // literals and joins
  let tokens;
  try { tokens = htmlTokens(masked(src)); } catch (e) { return [...out, `${at}: the HTML could not be read (${e.message.slice(0, 160)})`]; }
  let tag = null;
  const attrProblems = (what, value, kind = 'attribute') => {
    const rest = value.replace(MASKS, '').trim();
    const n = (value.match(MASKS) || []).length;
    if (rest !== '') out.push(`${at}: ${kind} ${what} holds the literal ${JSON.stringify(rest)}; a visible string is a catalogue slot`);
    else if (n >= 2) out.push(`${at}: ${kind} ${what} joins ${n} catalogue keys in one attribute; each catalogue string is a whole sentence`);
    else if (value.includes(TEXT_MASK)) out.push(`${at}: ${kind} ${what} reads a text slot; an attribute reads {{=key}}`);
  };
  // Text drawn by CSS (a `content` string) is a visible string that no slot can reach, so a template carries none.
  const cssProblems = (where, css) => {
    const shown = cssContentOf(`<style>${css}</style>`).replace(MASKS, '').trim();
    if (shown !== '') out.push(`${at}: a CSS content string ${JSON.stringify(shown.slice(0, 60))} in ${where} is text a visitor sees; a visible string is a catalogue slot`);
  };
  for (const t of tokens) {
    if (t.type === 'tag' && !t.closing) {
      tag = t;
      for (const a of VISIBLE_ATTRS) if (t.attrs.has(a) && t.attrs.get(a) !== '') attrProblems(a, t.attrs.get(a));
      if (t.name === 'input' && BUTTON_INPUTS.test(t.attrs.get('type') ?? '') && (t.attrs.get('value') ?? '') !== '') attrProblems('value of the button input', t.attrs.get('value'));
      if (LABELLED.has(t.name) && (t.attrs.get('label') ?? '') !== '') attrProblems(`label of the ${t.name}`, t.attrs.get('label'));
      const meta = t.name === 'meta' ? (t.attrs.get('name') ?? t.attrs.get('property') ?? '') : '';
      if (META_TEXT.has(meta) && t.attrs.has('content')) attrProblems(`content of the meta ${meta}`, t.attrs.get('content'));
      if (t.attrs.has('style')) cssProblems('a style attribute', `a{${t.attrs.get('style')}}`);
      for (const k of t.attrs.keys()) if (/^on[a-z]+$/.test(k)) out.push(`${at}: the ${t.name} element has an inline event handler (${k}); a template holds no script`);
      // A template holds no executable script: the page script is the shared block, taken whole as {{raw:script}}, so nothing a script writes into the page can be a string outside the catalogue.
      if (t.name === 'script' && !/^(?:application\/(?:ld\+)?json|importmap|speculationrules)$/i.test(t.attrs.get('type') ?? '')) out.push(`${at}: a <script> element in a template is executable script; the page script is the shared block {{raw:script}}`);
    } else if (t.type === 'raw' && t.name === 'style') {
      cssProblems('a <style> block', t.body);
    } else if (t.type === 'text') {
      const rest = t.text.replace(MASKS, '').trim();
      const n = (t.text.match(new RegExp(TEXT_MASK, 'g')) || []).length;
      if (rest !== '') out.push(`${at}: literal text ${JSON.stringify(rest.slice(0, 60))} in a text node; a visible string is a catalogue slot`);
      else if (n >= 2) out.push(`${at}: a text node joins ${n} catalogue keys in one text; each catalogue string is a whole sentence`);
    } else if (t.type === 'raw' && t.name === 'script' && tag?.attrs.get('type') === 'application/ld+json') {
      let owner = '';
      for (const m of t.body.matchAll(/"((?:[^"\\]|\\.)*)"(\s*:)?/g)) {
        if (m[2]) { owner = m[1]; continue; }
        const v = m[1];
        const data = v === ATTR_MASK || /^(?:https?:\/\/|mailto:)\S+$/.test(v) || /^[^\s@]+@[^\s@]+$/.test(v) || ENDORSED_KEYS.has(owner);
        if (!data) out.push(`${at}: structured data value ${JSON.stringify(v.replace(MASKS, '').trim() || v)} is a literal; a visible string is a {{j:key}} slot`);
      }
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
